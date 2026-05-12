#!/usr/bin/env node

// Atomic Weekly Opportunity Digest helper for the CSO. Collapses the
// per-opportunity approval-creation + email-send + status-patch into one
// non-skippable invocation:
//
//   1. Ensure per-opportunity approvals exist on the parent (creates
//      missing, keeps existing — idempotent on (parent-id,
//      opportunity-id)).
//   2. Build the digest-email payload with approvalIds populated.
//   3. Send the digest email via the shared approval-email renderer.
//   4. Post the `Weekly digest sent` comment on the parent.
//   5. Patch the parent to `in_review` (waiting on human Approve/Reject
//      per opportunity).
//
// Per-opportunity approvals are multi_select: each is independent. A
// human can approve any subset; approved opportunities become outreach
// triggers in the next workflow stage.
//
// On full success, exits 0 with a JSON summary on stdout.
// On any failure, prints `BLOCKER: <reason>` to stderr and exits non-zero.
// Every step is idempotent.

import { readFile } from "node:fs/promises";
import { sendApprovalEmail } from "./render-approval-email.mjs";

const SUCCESS_COMMENT_PREFIX = "Weekly digest sent";

function usage() {
  process.stderr.write(
    "Usage: node ./opportunity-digest.mjs \\\n" +
      "  --parent-id <id> \\\n" +
      "  --cso-agent-id <id> \\\n" +
      "  --digest <path-to-json> \\\n" +
      "  [--company-id <id>]\n",
  );
  process.exit(2);
}

function blocker(message, exitCode = 2) {
  process.stderr.write(`BLOCKER: ${message}\n`);
  process.exit(exitCode);
}

function progress(message) {
  process.stderr.write(`[opportunity-digest] ${message}\n`);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) blocker(`unexpected positional argument: ${arg}`);
    const name = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) blocker(`flag --${name} requires a value`);
    flags[name] = value;
    i++;
  }
  return flags;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== "string" || value.trim() === "") blocker(`missing required flag --${name}`);
  return value;
}

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") blocker(`missing required env var: ${name}`);
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

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function readDigest(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    blocker(`cannot read digest file at ${filePath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    blocker(`digest file at ${filePath} is not valid JSON`);
  }
  validateDigest(parsed);
  return parsed;
}

function validateDigest(d) {
  if (!d || typeof d !== "object") {
    throw new BlockerError("digest must be a JSON object");
  }
  for (const field of ["companyName", "generatedAt", "summary", "parentIssueIdentifier"]) {
    if (typeof d[field] !== "string" || d[field].trim() === "") {
      throw new BlockerError(`digest field ${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(d.opportunities) || d.opportunities.length === 0) {
    throw new BlockerError("digest.opportunities must be a non-empty array");
  }
  if (d.opportunities.length > 5) {
    throw new BlockerError(`digest.opportunities has ${d.opportunities.length} items; cap is 5`);
  }
  d.opportunities.forEach((opp, i) => {
    if (!opp || typeof opp !== "object") {
      throw new BlockerError(`digest.opportunities[${i}] must be an object`);
    }
    for (const field of ["rank", "name", "targetBuyer", "workflow", "whyNow", "octoSyncFit"]) {
      const v = opp[field];
      if (typeof v !== "string" && typeof v !== "number") {
        throw new BlockerError(
          `digest.opportunities[${i}].${field} must be a string or number`,
        );
      }
      if (String(v).trim() === "") {
        throw new BlockerError(`digest.opportunities[${i}].${field} must not be empty`);
      }
    }
    if (!Array.isArray(opp.sourceUrls) || opp.sourceUrls.length === 0) {
      throw new BlockerError(
        `digest.opportunities[${i}].sourceUrls must be a non-empty array`,
      );
    }
  });
}

// --------- HTTP helpers (same shape as linkedin-finalize-batch) ---------

function commentWithPrefixExists(comments, prefix) {
  return comments.some((c) => (c?.body ?? "").startsWith(prefix));
}

export async function digest({
  parentId,
  csoAgentId,
  digestPayload,
  companyId,
  fetchImpl,
  runMailer,
  log = () => {},
}) {
  const ctx = { fetchImpl, baseUrl: globalBaseUrl, headers: globalHeaders };
  validateDigest(digestPayload);
  log(
    `parent=${parentId} company=${companyId} opportunities=${digestPayload.opportunities.length}`,
  );

  const parent = await getIssueWith(ctx, parentId);
  if (!parent) throw new BlockerError(`parent issue ${parentId} not found`);

  // Ensure one approval per opportunity (multi_select).
  const allApprovals = await listApprovalsWith(ctx, companyId);
  const oppsWithApprovals = [];
  for (const opp of digestPayload.opportunities) {
    const opportunityId = `${opp.rank}-${slugify(opp.name)}`;
    const existing = findExistingApproval(allApprovals, parentId, opportunityId);
    if (existing) {
      log(`approval for ${opportunityId} already exists (id=${existing.id})`);
      oppsWithApprovals.push({ ...opp, opportunityId, approvalId: existing.id });
    } else {
      log(`creating approval for ${opportunityId}…`);
      const created = await createApprovalWith(
        ctx,
        companyId,
        parentId,
        csoAgentId,
        opp,
        opportunityId,
      );
      if (!created?.id) {
        throw new BlockerError(
          `create-approval for ${opportunityId} returned no id: ${JSON.stringify(created)}`,
        );
      }
      oppsWithApprovals.push({ ...opp, opportunityId, approvalId: created.id });
    }
  }

  const comments = await getCommentsWith(ctx, parentId);
  const successAlreadyPosted = commentWithPrefixExists(comments, SUCCESS_COMMENT_PREFIX);
  let emailSent = false;
  if (successAlreadyPosted) {
    log(`success comment already exists; skipping email send (idempotent)`);
  } else {
    const emailPayload = buildEmailPayload(digestPayload, oppsWithApprovals, parentId);
    log(`sending digest email…`);
    const emailResult = await runMailer(emailPayload);
    if (emailResult.code !== 0) {
      throw new BlockerError(
        `send digest email failed (code=${emailResult.code}): ${(emailResult.stderr ?? "").trim() || (emailResult.stdout ?? "").trim()}`,
      );
    }
    emailSent = true;
    log(`posting success comment…`);
    await postCommentWith(ctx, parentId, SUCCESS_COMMENT_PREFIX);
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
    emailSent,
    approvals: oppsWithApprovals.map((o) => ({
      opportunityId: o.opportunityId,
      approvalId: o.approvalId,
      name: o.name,
    })),
  };
}

export class BlockerError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockerError";
  }
}

function findExistingApproval(approvals, parentId, opportunityId) {
  return approvals.find(
    (a) =>
      a?.payload?.sourceDigestIssueId === parentId &&
      a?.payload?.opportunityId === opportunityId,
  );
}

// Build the approval-email payload from the CSO digest shape.
function buildEmailPayload(digestPayload, oppsWithApprovals, parentId) {
  return {
    eyebrowLabel: "Weekly Opportunity Digest",
    subject: `Weekly Research and Strategy for ${digestPayload.companyName} — ${digestPayload.generatedAt}`,
    companyName: digestPayload.companyName,
    generatedAt: digestPayload.generatedAt,
    summary: digestPayload.summary,
    parentIssueIdentifier: digestPayload.parentIssueIdentifier,
    parentIssueUrl: digestPayload.parentIssueUrl,
    idempotencyKey: `opportunity-digest:${parentId}`,
    from: process.env.WORKFLOW_EMAIL_FROM,
    to: process.env.WORKFLOW_EMAIL_TO,
    replyTo: process.env.WORKFLOW_EMAIL_REPLY_TO,
    cards: oppsWithApprovals.map((o) => ({
      id: String(o.rank),
      title: o.name,
      body: o.octoSyncFit,
      details: [
        { label: "Target buyer", value: String(o.targetBuyer) },
        { label: "Workflow", value: String(o.workflow) },
        { label: "Why now", value: String(o.whyNow) },
        ...(o.keyRisks
          ? [{ label: "Key risks", value: String(o.keyRisks) }]
          : []),
        ...(o.confidence
          ? [{ label: "Confidence", value: String(o.confidence) }]
          : []),
      ],
      sources: o.sourceUrls,
      approvalId: o.approvalId,
      approveLabel: "Pursue",
      rejectLabel: "Skip",
    })),
  };
}

// --------- context-aware HTTP helpers ---------

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
  const resp = await fetchJsonWith(ctx, "GET", `/api/companies/${companyId}/approvals`);
  if (!resp.ok)
    throw new BlockerError(`list-approvals failed: HTTP ${resp.status} ${describeError(resp)}`);
  return Array.isArray(resp.body) ? resp.body : resp.body?.approvals ?? [];
}
async function createApprovalWith(ctx, companyId, parentId, csoAgentId, opp, opportunityId) {
  const body = {
    type: "approve_opportunity_pursuit",
    requestedByAgentId: csoAgentId,
    issueIds: [parentId],
    payload: {
      type: "approve_opportunity_pursuit",
      opportunityId,
      opportunityName: String(opp.name),
      targetBuyer: String(opp.targetBuyer),
      workflow: String(opp.workflow),
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
      `create-approval for ${opportunityId} failed: HTTP ${resp.status} ${describeError(resp)}`,
    );
  }
  return resp.body;
}
async function getCommentsWith(ctx, issueId) {
  const resp = await fetchJsonWith(ctx, "GET", `/api/issues/${issueId}/comments`);
  if (!resp.ok)
    throw new BlockerError(`get-comments failed: HTTP ${resp.status} ${describeError(resp)}`);
  return Array.isArray(resp.body) ? resp.body : resp.body?.comments ?? [];
}
async function postCommentWith(ctx, issueId, body) {
  const resp = await fetchJsonWith(ctx, "POST", `/api/issues/${issueId}/comments`, {
    body,
  });
  if (!resp.ok)
    throw new BlockerError(
      `post-comment to ${issueId} failed: HTTP ${resp.status} ${describeError(resp)}`,
    );
  return resp.body;
}
async function patchIssueStatusWith(ctx, issueId, status) {
  const resp = await fetchJsonWith(ctx, "PATCH", `/api/issues/${issueId}`, { status });
  if (!resp.ok)
    throw new BlockerError(
      `patch-issue ${issueId} status=${status} failed: HTTP ${resp.status} ${describeError(resp)}`,
    );
  return resp.body;
}

async function runRealMailer(payload) {
  try {
    const result = await sendApprovalEmail(payload);
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
  const digestPath = requireFlag(flags, "digest");
  const companyId = flags["company-id"] || requireEnv("PAPERCLIP_COMPANY_ID");

  const digestPayload = await readDigest(digestPath);

  try {
    const result = await digest({
      parentId,
      csoAgentId,
      digestPayload,
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
