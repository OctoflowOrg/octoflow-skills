#!/usr/bin/env node

// Thin client for the approval-broker's POST /approvals/send endpoint.
// Replaces the per-workflow helper that used to run the entire
// outbound flow inside the agent's container. Now the broker owns
// approval creation, email send, audit comment, and the in_review
// patch — this script just POSTs the workflow's prospecting/linkedin
// payload and prints the broker's response.
//
// Usage:
//   send-approval.mjs \
//     --workflow prospecting \
//     --parent-id OCT-XXX \
//     --agent-id $PAPERCLIP_AGENT_ID \
//     --payload /tmp/prospecting-payload.json \
//     [--company-id $PAPERCLIP_COMPANY_ID]
//
// Env vars (required):
//   EMAIL_APPROVAL_PUBLIC_URL     — public base URL of the broker
//                                    (e.g. https://agents.octosync.dev/approvals)
//   EMAIL_APPROVAL_INTERNAL_TOKEN — bearer token shared with the broker
//   PAPERCLIP_COMPANY_ID          — only if --company-id is omitted

import { readFile } from "node:fs/promises";

function usage() {
  process.stderr.write(
    "Usage: node send-approval.mjs \\\n" +
      "  --workflow <prospecting|linkedin> \\\n" +
      "  --parent-id <id> \\\n" +
      "  --agent-id <id> \\\n" +
      "  --payload <path-to-json> \\\n" +
      "  [--company-id <id>]\n"
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

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    usage();
  }
  const flags = parseFlags(argv);
  const workflow = requireFlag(flags, "workflow");
  const parentId = requireFlag(flags, "parent-id");
  const agentId = requireFlag(flags, "agent-id");
  const payloadPath = requireFlag(flags, "payload");
  const companyId = flags["company-id"] || requireEnv("PAPERCLIP_COMPANY_ID");

  const publicUrl = requireEnv("EMAIL_APPROVAL_PUBLIC_URL").replace(/\/+$/, "");
  const token = requireEnv("EMAIL_APPROVAL_INTERNAL_TOKEN");
  // From: and To: live on the agent (so multi-tenant deployments
  // don't have to compound `EMAIL_TO_<workflow>_<company>` env vars
  // in the broker's bundle). The broker uses whatever the request
  // body supplies.
  const outboundEmail = requireEnv("PAPERCLIP_OUTBOUND_EMAIL");
  const recipientList = requireEnv("WORKFLOW_EMAIL_TO");
  const payload = await readPayload(payloadPath);

  const url = `${publicUrl}/send`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        workflow,
        parentId,
        agentId,
        companyId,
        outboundEmail,
        recipientList,
        payload
      })
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
  // Success path — broker has already created approvals, sent the
  // email, posted the audit comment, and patched parent → in_review.
  // The agent should stop cleanly here.
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
}

main().catch((err) => {
  blocker(err instanceof Error ? err.message : String(err));
});
