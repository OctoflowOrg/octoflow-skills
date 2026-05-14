#!/usr/bin/env node

// Atomic Weekly Prospecting Approval helper for the CSO.
//
// Replaces the per-opportunity Approve/Reject flow with a single email
// that lists every researched prospect across every opportunity, each
// with its own checkbox. The human submits one form; the sidecar's
// batch-action endpoint records an `approved` decision for each checked
// approval and `rejected` for each unchecked one.
//
// Collapses the per-prospect approval-creation + email-send +
// status-patch into one non-skippable invocation:
//
//   1. Ensure one approval per prospect (`approve_prospect_outreach`,
//      multi_select) — idempotent on (parentId, opportunityId,
//      prospectEmail).
//   2. Build the prospecting-email payload with approvalIds populated.
//   3. Send the email via the prospecting email renderer.
//   4. Post the `Weekly prospecting approval sent` comment on the parent.
//   5. Patch the parent to `in_review`.
//
// On full success, exits 0 with a JSON summary on stdout.
// On any failure, prints `BLOCKER: <reason>` to stderr and exits non-zero.
// Every step is idempotent.

import { readFile } from "node:fs/promises";
import { sendProspectingApprovalEmail } from "./render-approval-email.mjs";

const SUCCESS_COMMENT_PREFIX = "Weekly prospecting approval sent";

function usage() {
  process.stderr.write(
    "Usage: node ./prospecting-approval-send.mjs \\\n" +
      "  --parent-id <id> \\\n" +
      "  --cso-agent-id <id> \\\n" +
      "  --prospecting <path-to-json> \\\n" +
      "  [--company-id <id>]\n",
  );
  process.exit(2);
}

function blocker(message, exitCode = 2) {
  const line = `BLOCKER: ${message}\n`;
  process.stderr.write(line);
  process.stdout.write(line);
  process.exit(exitCode);
}

function progress(message) {
  process.stderr.write(`[prospecting-approval-send] ${message}\n`);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) blocker(`unexpected positional argument: ${arg}`);
    const name = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--"))
      blocker(`flag --${name} requires a value`);
    flags[name] = value;
    i++;
  }
  return flags;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== "string" || value.trim() === "")
    blocker(`missing required flag --${name}`);
  return value;
}

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "")
    blocker(`missing required env var: ${name}`);
  return value;
}

function baseUrl() {
  return requireEnv("PAPERCLIP_API_URL").replace(/\/+$/, "");
}

function authHeaders({ mutating = false } = {}) {
  const result = {
    Authorization: `Bearer ${requireEnv("PAPERCLIP_API_KEY")}`,
    Accept: "application/json",
  };
  if (mutating) {
    result["Content-Type"] = "application/json";
    const runId = process.env.PAPERCLIP_RUN_ID;
    if (runId) result["X-Paperclip-Run-Id"] = runId;
  }
  return result;
}

function describeError(resp) {
  if (typeof resp.body === "string") return resp.body;
  return resp.body?.error || JSON.stringify(resp.body ?? {});
}

function normaliseEmail(value) {
  return String(value).trim().toLowerCase();
}

export class BlockerError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockerError";
  }
}

export function validateProspectingPayload(d) {
  if (!d || typeof d !== "object") {
    throw new BlockerError("prospecting payload must be a JSON object");
  }
  for (const field of ["generatedAt", "parentIssueIdentifier"]) {
    if (typeof d[field] !== "string" || d[field].trim() === "") {
      throw new BlockerError(`payload.${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(d.opportunities) || d.opportunities.length === 0) {
    throw new BlockerError("payload.opportunities must be a non-empty array");
  }
  d.opportunities.forEach((opp, i) => {
    if (!opp || typeof opp !== "object") {
      throw new BlockerError(`opportunities[${i}] must be an object`);
    }
    for (const f of ["id", "companyName", "whyNow"]) {
      if (typeof opp[f] !== "string" || opp[f].trim() === "") {
        throw new BlockerError(`opportunities[${i}].${f} must be a non-empty string`);
      }
    }
    if (!Array.isArray(opp.prospects) || opp.prospects.length === 0) {
      throw new BlockerError(`opportunities[${i}].prospects must be a non-empty array`);
    }
    opp.prospects.forEach((p, j) => {
      if (!p || typeof p !== "object") {
        throw new BlockerError(`opportunities[${i}].prospects[${j}] must be object`);
      }
      for (const f of ["role", "email"]) {
        if (typeof p[f] !== "string" || p[f].trim() === "") {
          throw new BlockerError(
            `opportunities[${i}].prospects[${j}].${f} must be a non-empty string`,
          );
        }
      }
    });
  });
}

async function readPayload(filePath) {
  const resolvedPath = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  let raw;
  try {
    raw = await readFile(resolvedPath, "utf8");
  } catch (err) {
    blocker(`cannot read prospecting file at ${resolvedPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    blocker(`prospecting file at ${resolvedPath} is not valid JSON`);
  }
  validateProspectingPayload(parsed);
  return parsed;
}

function commentWithPrefixExists(comments, prefix) {
  return comments.some((c) => (c?.body ?? "").startsWith(prefix));
}

function emailRefFor(parentId) {
  return `prospecting-approval:${parentId}`;
}

function findExistingApproval(approvals, emailRef, opportunityId, email) {
  return approvals.find(
    (a) =>
      a?.payload?.emailRef === emailRef &&
      a?.payload?.opportunityId === opportunityId &&
      normaliseEmail(a?.payload?.prospect?.email ?? "") === normaliseEmail(email),
  );
}

export async function prospectingApprovalSend({
  parentId,
  csoAgentId,
  prospectingPayload,
  companyId,
  fetchImpl,
  runMailer,
  log = () => {},
}) {
  const ctx = { fetchImpl, baseUrl: globalBaseUrl, headers: globalHeaders };
  validateProspectingPayload(prospectingPayload);
  const opportunityCount = prospectingPayload.opportunities.length;
  const prospectCount = prospectingPayload.opportunities.reduce(
    (sum, opp) => sum + opp.prospects.length,
    0,
  );
  log(
    `parent=${parentId} company=${companyId} opportunities=${opportunityCount} prospects=${prospectCount}`,
  );

  const parent = await getIssueWith(ctx, parentId);
  if (!parent) throw new BlockerError(`parent issue ${parentId} not found`);

  const emailRef = emailRefFor(parentId);
  const allApprovals = await listApprovalsWith(ctx, companyId);

  // Ensure one approval per prospect — payload.emailRef is baked in
  // at creation so the sidecar can walk back to the batch by emailRef
  // alone.
  const oppsWithApprovals = [];
  for (const opp of prospectingPayload.opportunities) {
    const enrichedProspects = [];
    for (const prospect of opp.prospects) {
      const existing = findExistingApproval(
        allApprovals,
        emailRef,
        opp.id,
        prospect.email,
      );
      if (existing) {
        log(
          `approval for ${opp.id}/${prospect.email} already exists (id=${existing.id})`,
        );
        enrichedProspects.push({ ...prospect, approvalId: existing.id });
      } else {
        log(`creating approval for ${opp.id}/${prospect.email}…`);
        const created = await createApprovalWith(
          ctx,
          companyId,
          parentId,
          csoAgentId,
          opp,
          prospect,
          emailRef,
        );
        if (!created?.id) {
          throw new BlockerError(
            `create-approval for ${opp.id}/${prospect.email} returned no id: ${JSON.stringify(created)}`,
          );
        }
        enrichedProspects.push({ ...prospect, approvalId: created.id });
      }
    }
    oppsWithApprovals.push({ ...opp, prospects: enrichedProspects });
  }

  const comments = await getCommentsWith(ctx, parentId);
  const successAlreadyPosted = commentWithPrefixExists(
    comments,
    SUCCESS_COMMENT_PREFIX,
  );
  let emailSent = false;
  let resendEmailId = null;
  if (successAlreadyPosted) {
    log(`success comment already exists; skipping email send (idempotent)`);
  } else {
    const emailPayload = buildEmailPayload(
      prospectingPayload,
      oppsWithApprovals,
      emailRef,
      companyId,
    );
    log(`sending prospecting approval email…`);
    const emailResult = await runMailer(emailPayload);
    if (emailResult.code !== 0) {
      throw new BlockerError(
        `send prospecting email failed (code=${emailResult.code}): ${(emailResult.stderr ?? "").trim() || (emailResult.stdout ?? "").trim()}`,
      );
    }
    emailSent = true;
    // runMailer's stdout is JSON.stringify of the Resend response;
    // capture the emailId so we can record it on the parent comment.
    try {
      const parsedStdout = JSON.parse(emailResult.stdout ?? "");
      if (parsedStdout && typeof parsedStdout.id === "string") {
        resendEmailId = parsedStdout.id;
      }
    } catch {
      /* non-JSON stdout (e.g. mock) — leave resendEmailId null */
    }
    log(`posting success comment…`);
    const commentBody = resendEmailId
      ? `${SUCCESS_COMMENT_PREFIX} (resend=${resendEmailId}, ref=${emailRef})`
      : `${SUCCESS_COMMENT_PREFIX} (ref=${emailRef})`;
    await postCommentWith(ctx, parentId, commentBody);
  }

  if (parent.status !== "in_review") {
    log(`patching parent status ${parent.status} → in_review…`);
    await patchIssueStatusWith(ctx, parentId, "in_review");
  } else {
    log(`parent already in_review; skipping patch`);
  }

  return {
    ok: true,
    parentId,
    emailRef,
    resendEmailId,
    emailSent,
    opportunities: oppsWithApprovals.map((o) => ({
      opportunityId: o.id,
      companyName: o.companyName,
      prospects: o.prospects.map((p) => ({
        approvalId: p.approvalId,
        email: p.email,
      })),
    })),
  };
}

function buildEmailPayload(
  prospectingPayload,
  oppsWithApprovals,
  emailRef,
  companyId,
) {
  return {
    emailRef,
    companyId,
    generatedAt: prospectingPayload.generatedAt,
    parentIssueIdentifier: prospectingPayload.parentIssueIdentifier,
    parentIssueUrl: prospectingPayload.parentIssueUrl,
    idempotencyKey: emailRef,
    from: process.env.PAPERCLIP_OUTBOUND_EMAIL,
    to: process.env.WORKFLOW_EMAIL_TO,
    replyTo: process.env.PAPERCLIP_OUTBOUND_EMAIL,
    tags: [
      { name: "workflow", value: "prospecting-approval" },
      { name: "emailRef", value: emailRef },
    ],
    opportunities: oppsWithApprovals.map((o) => ({
      id: o.id,
      companyName: o.companyName,
      industry: o.industry,
      location: o.location,
      whyNow: o.whyNow,
      workflow: o.workflow,
      confidence: o.confidence,
      sources: Array.isArray(o.sources) ? o.sources : [],
      prospects: o.prospects.map((p) => ({
        approvalId: p.approvalId,
        name: p.name ?? null,
        role: p.role,
        email: p.email,
        isGenericInbox: Boolean(p.isGenericInbox),
      })),
    })),
  };
}

function globalBaseUrl() {
  return baseUrl();
}
function globalHeaders(opts) {
  return authHeaders(opts);
}

async function fetchJsonWith(ctx, method, urlPath, body) {
  const response = await ctx.fetchImpl(`${ctx.baseUrl()}${urlPath}`, {
    method,
    headers: ctx.headers({ mutating: body !== undefined }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

async function getIssueWith(ctx, issueId) {
  const resp = await fetchJsonWith(ctx, "GET", `/api/issues/${issueId}`);
  if (resp.status === 404) return null;
  if (!resp.ok)
    throw new BlockerError(
      `get-issue ${issueId} failed: HTTP ${resp.status} ${describeError(resp)}`,
    );
  return resp.body;
}

async function listApprovalsWith(ctx, companyId) {
  const resp = await fetchJsonWith(
    ctx,
    "GET",
    `/api/companies/${companyId}/approvals`,
  );
  if (!resp.ok)
    throw new BlockerError(
      `list-approvals failed: HTTP ${resp.status} ${describeError(resp)}`,
    );
  return Array.isArray(resp.body) ? resp.body : resp.body?.approvals ?? [];
}

async function createApprovalWith(
  ctx,
  companyId,
  parentId,
  csoAgentId,
  opp,
  prospect,
  emailRef,
) {
  const body = {
    type: "approve_prospect_outreach",
    requestedByAgentId: csoAgentId,
    issueIds: [parentId],
    payload: {
      type: "approve_prospect_outreach",
      emailRef,
      opportunityId: opp.id,
      opportunityName: String(opp.companyName),
      prospect: {
        name: prospect.name ?? null,
        role: String(prospect.role),
        email: normaliseEmail(prospect.email),
        isGenericInbox: Boolean(prospect.isGenericInbox),
      },
      rationale: String(opp.whyNow),
      sourceDigestIssueId: parentId,
      selectionMode: "multi_select",
    },
  };
  const resp = await fetchJsonWith(
    ctx,
    "POST",
    `/api/companies/${companyId}/approvals`,
    body,
  );
  if (!resp.ok) {
    throw new BlockerError(
      `create-approval for ${opp.id}/${prospect.email} failed: HTTP ${resp.status} ${describeError(resp)}`,
    );
  }
  return resp.body;
}

async function getCommentsWith(ctx, issueId) {
  const resp = await fetchJsonWith(ctx, "GET", `/api/issues/${issueId}/comments`);
  if (!resp.ok)
    throw new BlockerError(
      `get-comments failed: HTTP ${resp.status} ${describeError(resp)}`,
    );
  return Array.isArray(resp.body) ? resp.body : resp.body?.comments ?? [];
}

async function postCommentWith(ctx, issueId, body) {
  const resp = await fetchJsonWith(
    ctx,
    "POST",
    `/api/issues/${issueId}/comments`,
    { body },
  );
  if (!resp.ok)
    throw new BlockerError(
      `post-comment to ${issueId} failed: HTTP ${resp.status} ${describeError(resp)}`,
    );
  return resp.body;
}

async function patchIssueStatusWith(ctx, issueId, status) {
  const resp = await fetchJsonWith(ctx, "PATCH", `/api/issues/${issueId}`, {
    status,
  });
  if (!resp.ok)
    throw new BlockerError(
      `patch-issue ${issueId} status=${status} failed: HTTP ${resp.status} ${describeError(resp)}`,
    );
  return resp.body;
}

async function runRealMailer(payload) {
  try {
    const result = await sendProspectingApprovalEmail(payload);
    return { code: 0, stdout: JSON.stringify(result), stderr: "" };
  } catch (err) {
    return {
      code: 1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    usage();
  }

  const flags = parseFlags(argv);
  const parentId = requireFlag(flags, "parent-id");
  const csoAgentId = requireFlag(flags, "cso-agent-id");
  const prospectingPath = requireFlag(flags, "prospecting");
  const companyId = flags["company-id"] || requireEnv("PAPERCLIP_COMPANY_ID");

  const prospectingPayload = await readPayload(prospectingPath);

  try {
    const result = await prospectingApprovalSend({
      parentId,
      csoAgentId,
      prospectingPayload,
      companyId,
      fetchImpl: (...args) => fetch(...args),
      runMailer: runRealMailer,
      log: progress,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    if (err instanceof BlockerError) {
      blocker(err.message);
    } else {
      blocker(err instanceof Error ? err.message : String(err));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    blocker(err instanceof Error ? err.message : String(err));
  });
}
