#!/usr/bin/env node

// Atomic LinkedIn approval+email helper for the CMO. Collapses what used to
// be five separate procedure steps into one non-skippable invocation:
//
//   1. Ensure per-option approvals exist on the parent (creates missing,
//      keeps existing — idempotent on (parent-id, option-id)).
//   2. Build the review-email payload with approvalIds populated.
//   3. Invoke the shared approval-email renderer to send the email.
//   4. Post the `LinkedIn review email sent` comment on the parent.
//   5. Post the `Approvals ready ...` comment on the parent.
//   6. Patch the parent to `in_review`.
//
// On full success, exits 0 with a JSON summary on stdout.
// On any failure, prints `BLOCKER: <reason>` to stderr and exits non-zero.
// Every step is idempotent: re-running on a parent that already has all
// approvals + comments + in_review is a noop with exit 0.

import { readFile } from "node:fs/promises";
import { sendApprovalEmail } from "./render-approval-email.mjs";

const OPTION_ID_PATTERN = /^option[1-9][0-9]?$/;
// CMO-authored status comments deliberately omit `@CMO` to avoid waking
// the CMO itself. Children that need to wake the CMO (Researcher, Drafter,
// Buffer Scheduler) post their handoff/blocker comments with `@CMO`.
const SUCCESS_COMMENT_PREFIX = "LinkedIn review email sent";
const READY_COMMENT_PREFIX = "Approvals ready";
const READY_COMMENT_BODY =
  "Approvals ready — action via email buttons or Paperclip inbox; scheduling waits on approval.";

function usage() {
  process.stderr.write(
    "Usage: node ./linkedin-finalize-batch.mjs \\\n" +
      "  --parent-id <id> \\\n" +
      "  --cmo-agent-id <id> \\\n" +
      "  --review-package <path-to-json> \\\n" +
      "  [--company-id <id>]\n",
  );
  process.exit(2);
}

function blocker(message, exitCode = 2) {
  // Write to BOTH stderr and stdout so agent runners that only capture
  // stdout still see the failure reason. Stderr is the canonical channel;
  // the stdout mirror is defensive.
  const line = `BLOCKER: ${message}\n`;
  process.stderr.write(line);
  process.stdout.write(line);
  process.exit(exitCode);
}

function progress(message) {
  process.stderr.write(`[finalize-batch] ${message}\n`);
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

async function readReviewPackage(filePath) {
  // Tolerate a leading "@" (curl convention some agents reach for) so a
  // hallucinated `--review-package @/tmp/foo.json` doesn't faceplant.
  const resolvedPath = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  let raw;
  try {
    raw = await readFile(resolvedPath, "utf8");
  } catch (err) {
    blocker(`cannot read review-package file at ${resolvedPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    blocker(`review-package file at ${resolvedPath} is not valid JSON`);
  }
  validateReviewPackage(parsed);
  return parsed;
}

function validateReviewPackage(rp) {
  if (!rp || typeof rp !== "object") {
    throw new BlockerError("review-package must be a JSON object");
  }
  for (const field of ["companyName", "generatedAt", "summary", "parentIssueIdentifier"]) {
    if (typeof rp[field] !== "string" || rp[field].trim() === "") {
      throw new BlockerError(`review-package field ${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(rp.options) || rp.options.length === 0) {
    throw new BlockerError("review-package.options must be a non-empty array");
  }
  if (rp.options.length > 2) {
    throw new BlockerError(`review-package.options has ${rp.options.length} items; cap is 2`);
  }
  rp.options.forEach((option, index) => {
    if (!option || typeof option !== "object") {
      throw new BlockerError(`review-package.options[${index}] must be an object`);
    }
    if (!OPTION_ID_PATTERN.test(option.id ?? "")) {
      throw new BlockerError(
        `review-package.options[${index}].id must match /^option[1-9][0-9]?$/ (got "${option.id}")`,
      );
    }
    for (const field of ["title", "text", "rationale"]) {
      if (typeof option[field] !== "string" || option[field].trim() === "") {
        throw new BlockerError(
          `review-package.options[${index}].${field} must be a non-empty string`,
        );
      }
    }
    if (!Array.isArray(option.sources) || option.sources.length === 0) {
      throw new BlockerError(
        `review-package.options[${index}].sources must be a non-empty array`,
      );
    }
  });
}

function commentWithPrefixExists(comments, prefix) {
  return comments.some((c) => (c?.body ?? "").startsWith(prefix));
}

// Build the approval-email payload from the LinkedIn review-package shape.
// This is the bridge between LinkedIn's `options` and the generic `cards`
// shape consumed by render-approval-email.mjs.
function buildEmailPayload(reviewPackage, optionsWithApprovals, parentId) {
  return {
    eyebrowLabel: "LinkedIn Draft Review",
    subject: `LinkedIn Draft Options Ready for Review — ${reviewPackage.companyName} — ${reviewPackage.generatedAt}`,
    companyName: reviewPackage.companyName,
    generatedAt: reviewPackage.generatedAt,
    summary: reviewPackage.summary,
    parentIssueIdentifier: reviewPackage.parentIssueIdentifier,
    idempotencyKey: `linkedin-review:${parentId}`,
    from: process.env.PAPERCLIP_OUTBOUND_EMAIL,
    to:
      process.env.LINKEDIN_REVIEW_EMAIL_TO ??
      process.env.WORKFLOW_EMAIL_TO,
    replyTo: process.env.PAPERCLIP_OUTBOUND_EMAIL,
    cards: optionsWithApprovals.map((o) => ({
      id: o.id,
      title: o.title,
      body: o.text,
      rationale: o.rationale,
      sources: o.sources,
      approvalId: o.approvalId,
    })),
  };
}

// Core orchestration. Pure dependency injection so tests can call this
// directly with mocked fetch + mailer.
export async function finalize({
  parentId,
  cmoAgentId,
  reviewPackage,
  companyId,
  fetchImpl,
  runMailer,
  log = () => {},
}) {
  const ctx = { fetchImpl, baseUrl: globalBaseUrl, headers: globalHeaders };
  validateReviewPackage(reviewPackage);
  log(`parent=${parentId} company=${companyId} options=${reviewPackage.options.length}`);

  const parent = await getIssueWith(ctx, parentId);
  if (!parent) throw new BlockerError(`parent issue ${parentId} not found`);

  const allApprovals = await listApprovalsWith(ctx, companyId);
  const optionsWithApprovals = [];
  for (const option of reviewPackage.options) {
    const existing = findExistingApproval(allApprovals, parentId, option.id);
    if (existing) {
      log(`approval for ${option.id} already exists (id=${existing.id})`);
      optionsWithApprovals.push({ ...option, approvalId: existing.id });
    } else {
      log(`creating approval for ${option.id}…`);
      const created = await createApprovalWith(ctx, companyId, parentId, cmoAgentId, option);
      if (!created?.id) {
        throw new BlockerError(
          `create-approval for ${option.id} returned no id: ${JSON.stringify(created)}`,
        );
      }
      optionsWithApprovals.push({ ...option, approvalId: created.id });
    }
  }

  const comments = await getCommentsWith(ctx, parentId);
  const successAlreadyPosted = commentWithPrefixExists(comments, SUCCESS_COMMENT_PREFIX);
  let emailSent = false;
  if (successAlreadyPosted) {
    log(`success comment already exists; skipping email send (idempotent)`);
  } else {
    const emailPayload = buildEmailPayload(reviewPackage, optionsWithApprovals, parentId);
    log(`sending review email…`);
    const emailResult = await runMailer(emailPayload);
    if (emailResult.code !== 0) {
      throw new BlockerError(
        `send approval email failed (code=${emailResult.code}): ${(emailResult.stderr ?? "").trim() || (emailResult.stdout ?? "").trim()}`,
      );
    }
    emailSent = true;
    log(`posting success comment…`);
    await postCommentWith(ctx, parentId, SUCCESS_COMMENT_PREFIX);
  }

  const readyAlreadyPosted = commentWithPrefixExists(comments, READY_COMMENT_PREFIX);
  if (!readyAlreadyPosted) {
    log(`posting ready comment…`);
    await postCommentWith(ctx, parentId, READY_COMMENT_BODY);
  } else {
    log(`ready comment already exists; skipping`);
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
    approvals: optionsWithApprovals.map((o) => ({
      optionId: o.id,
      approvalId: o.approvalId,
    })),
  };
}

export class BlockerError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockerError";
  }
}

function findExistingApproval(approvals, parentId, optionId) {
  return approvals.find(
    (a) =>
      a?.payload?.reviewIssueId === parentId &&
      a?.payload?.optionId === optionId,
  );
}

// Context-aware helpers that accept fetchImpl + auth + baseUrl from a ctx
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
  if (!resp.ok) throw new BlockerError(`get-issue ${issueId} failed: HTTP ${resp.status} ${describeError(resp)}`);
  return resp.body;
}
async function listApprovalsWith(ctx, companyId) {
  const resp = await fetchJsonWith(ctx, "GET", `/api/companies/${companyId}/approvals`);
  if (!resp.ok) throw new BlockerError(`list-approvals failed: HTTP ${resp.status} ${describeError(resp)}`);
  return Array.isArray(resp.body) ? resp.body : resp.body?.approvals ?? [];
}
async function createApprovalWith(ctx, companyId, parentId, cmoAgentId, option) {
  const body = {
    type: "approve_ceo_strategy",
    requestedByAgentId: cmoAgentId,
    issueIds: [parentId],
    payload: {
      title: option.title,
      optionId: option.id,
      optionTitle: option.title,
      text: option.text,
      rationale: option.rationale,
      sources: option.sources,
      reviewIssueId: parentId,
      sourceBatchIssueId: parentId,
      selectionMode: "single_select",
    },
  };
  const resp = await fetchJsonWith(ctx, "POST", `/api/companies/${companyId}/approvals`, body);
  if (!resp.ok) {
    throw new BlockerError(`create-approval for ${option.id} failed: HTTP ${resp.status} ${describeError(resp)}`);
  }
  return resp.body;
}
async function getCommentsWith(ctx, issueId) {
  const resp = await fetchJsonWith(ctx, "GET", `/api/issues/${issueId}/comments`);
  if (!resp.ok) throw new BlockerError(`get-comments failed: HTTP ${resp.status} ${describeError(resp)}`);
  return Array.isArray(resp.body) ? resp.body : resp.body?.comments ?? [];
}
async function postCommentWith(ctx, issueId, body) {
  const resp = await fetchJsonWith(ctx, "POST", `/api/issues/${issueId}/comments`, { body });
  if (!resp.ok) throw new BlockerError(`post-comment to ${issueId} failed: HTTP ${resp.status} ${describeError(resp)}`);
  return resp.body;
}
async function patchIssueStatusWith(ctx, issueId, status) {
  const resp = await fetchJsonWith(ctx, "PATCH", `/api/issues/${issueId}`, { status });
  if (!resp.ok) throw new BlockerError(`patch-issue ${issueId} status=${status} failed: HTTP ${resp.status} ${describeError(resp)}`);
  return resp.body;
}

// Production mailer: wraps the in-skill renderer/sender as a
// `{ code, stdout, stderr }`-returning function to preserve the
// test-friendly runMailer interface.
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

// CLI entry point — wires real implementations.
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    usage();
  }

  const flags = parseFlags(argv);
  const parentId = requireFlag(flags, "parent-id");
  const cmoAgentId = requireFlag(flags, "cmo-agent-id");
  const reviewPackagePath = requireFlag(flags, "review-package");
  const companyId = flags["company-id"] || requireEnv("PAPERCLIP_COMPANY_ID");

  const reviewPackage = await readReviewPackage(reviewPackagePath);

  try {
    const result = await finalize({
      parentId,
      cmoAgentId,
      reviewPackage,
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

// Only run main() when invoked as a CLI; allow import as a module for tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    blocker(err instanceof Error ? err.message : String(err));
  });
}
