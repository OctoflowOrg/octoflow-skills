#!/usr/bin/env node

// Thin client for the approval-broker's POST /attio/sync-decision
// endpoint. The CSO calls this once per decided prospecting
// approval (approved or rejected); the broker upserts the prospect's
// Company + Person records in Attio with paperclip_* attributes and
// posts an audit comment on the parent.
//
// Idempotent at the broker. Safe to re-run: a prior audit comment
// (`Attio sync recorded approval=<id> ...`) short-circuits the
// upsert and returns the cached ids.
//
// Usage:
//   attio-sync.mjs --payload /tmp/attio-payload-<approvalId>.json
//
// Payload JSON shape (all fields required unless noted):
//   {
//     "parentId":        "OCT-XXX",
//     "approvalId":      "appr-uuid",
//     "opportunityId":   "1-acme",
//     "companyName":     "Acme Corp",
//     "domain":          "acme.test",          // optional; derived from email if absent
//     "person": {
//       "email":         "jane@acme.test",
//       "name":          "Jane Doe",           // optional for generic inboxes
//       "role":          "Head of Ops",
//       "phone":         "+1 503-555-0142",    // required; business/direct line
//       "isGenericInbox": false
//     },
//     "decision":        "approved" | "rejected",
//     "decidedAt":       "2026-05-19T17:42:00Z"
//   }
//
// Env vars (required):
//   EMAIL_APPROVAL_PUBLIC_URL     — broker base URL (e.g.
//                                    https://agents.octosync.dev/approvals).
//                                    The /approvals suffix is stripped so
//                                    we can hit /attio/sync-decision on
//                                    the same host.
//   EMAIL_APPROVAL_INTERNAL_TOKEN — bearer token shared with the broker

import { readFile } from "node:fs/promises";

function usage() {
  process.stderr.write(
    "Usage: node attio-sync.mjs --payload <path-to-json>\n"
  );
  process.exit(2);
}

function blocker(message) {
  const line = `BLOCKER: ${message}\n`;
  process.stderr.write(line);
  process.stdout.write(line);
  process.exit(2);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) blocker(`unexpected positional argument: ${arg}`);
    const name = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      blocker(`flag --${name} requires a value`);
    }
    flags[name] = value;
    i++;
  }
  return flags;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== "string" || value.trim() === "") {
    blocker(`missing required flag --${name}`);
  }
  return value;
}

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    blocker(`missing required env var: ${name}`);
  }
  return value;
}

async function readPayload(filePath) {
  const resolvedPath = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  let raw;
  try {
    raw = await readFile(resolvedPath, "utf8");
  } catch (err) {
    blocker(`cannot read payload file at ${resolvedPath}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    blocker(`payload file at ${resolvedPath} is not valid JSON`);
  }
}

// EMAIL_APPROVAL_PUBLIC_URL is conventionally ".../approvals"; the
// Attio route lives at "/attio/sync-decision" on the same host. Strip
// "/approvals" (or a trailing slash) so we can build the Attio URL
// without introducing a second env var that would have to be kept in
// sync across deploys.
function brokerRoot(publicUrl) {
  return publicUrl.replace(/\/+$/, "").replace(/\/approvals$/, "");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    usage();
  }
  const flags = parseFlags(argv);
  const payloadPath = requireFlag(flags, "payload");

  const publicUrl = requireEnv("EMAIL_APPROVAL_PUBLIC_URL");
  const token = requireEnv("EMAIL_APPROVAL_INTERNAL_TOKEN");
  const payload = await readPayload(payloadPath);

  const url = `${brokerRoot(publicUrl)}/attio/sync-decision`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    blocker(`broker request failed: ${err.message}`);
  }

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const reason =
      (body && typeof body === "object" && body.error) ||
      (typeof body === "string" ? body.slice(0, 200) : `HTTP ${response.status}`);
    blocker(`broker rejected request: ${reason}`);
  }
  // Success path — broker upserted Company + Person and posted the
  // audit comment. The agent can move on to the next prospect.
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
}

main().catch((err) => {
  blocker(err instanceof Error ? err.message : String(err));
});
