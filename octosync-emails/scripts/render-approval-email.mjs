// OctoSync approval email renderer + sender.
//
// Single source of truth for the OctoSync brand shell + per-card
// layout + Resend send call. Both linkedin-finalize-batch.mjs and
// opportunity-digest.mjs delegate to this script via spawn (or import
// renderApprovalEmail / sendApprovalEmail directly).
//
// HTML rendering is delegated to the React Email bundle at
// ../templates/dist/render.mjs. Run `npm install && npm run build` in
// the templates directory after editing the .tsx sources.
//
// Payload shape (passed as JSON path on argv[2] when invoked as CLI):
//
// {
//   "subject": "<email subject>",
//   "eyebrowLabel": "LinkedIn Draft Review" | "Weekly Opportunity Digest",
//   "companyName": "OctoSync",
//   "generatedAt": "2026-05-11",         // ISO date or human-friendly
//   "summary": "<2-3 sentence summary>",
//   "parentIssueIdentifier": "OCT-241",  // optional
//   "parentIssueUrl": "...",             // optional; derived if absent
//   "cards": [
//     {
//       "id": "option1" | "1-renewables-procurement",
//       "title": "...",
//       "body": "<plain text or markdown>",       // optional
//       "details": [                              // optional
//         { "label": "Target buyer", "value": "Ops Manager" }
//       ],
//       "rationale": "<one-line>",                // optional
//       "sources": [{ "label": "...", "url": "..." }],  // optional
//       "approvalId": "<uuid>",                   // optional; if present, buttons render
//       "approveLabel": "Approve" | "Pursue",     // optional override
//       "rejectLabel": "Reject" | "Skip"          // optional override
//     }
//   ],
//   "idempotencyKey": "linkedin-review:OCT-241",
//   "from": "...",
//   "to": "string or [string,...] or comma-separated string",
//   "replyTo": "..."                              // optional
// }

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { signApprovalUrl } from "./sign-approval-link.mjs";

const RESEND_URL = "https://api.resend.com/emails";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_BUNDLE_PATH = resolve(__dirname, "../templates/dist/render.mjs");

let renderApprovalEmailHtmlCache = null;
async function loadHtmlRenderer() {
  if (!renderApprovalEmailHtmlCache) {
    const mod = await import(TEMPLATE_BUNDLE_PATH);
    if (typeof mod.renderApprovalEmailHtml !== "function") {
      throw new Error(
        `renderApprovalEmailHtml not found in ${TEMPLATE_BUNDLE_PATH}. Did you run 'npm install && npm run build' in templates/?`,
      );
    }
    renderApprovalEmailHtmlCache = mod.renderApprovalEmailHtml;
  }
  return renderApprovalEmailHtmlCache;
}

// ---------- helpers ----------

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, field) {
  if (value == null || value === "") return null;
  return requiredString(value, field);
}

function optionalTrimmedString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function parseRecipientList(value, field) {
  if (Array.isArray(value)) {
    const cleaned = value.map((entry) => requiredString(entry, field));
    if (cleaned.length === 0) {
      throw new Error(`${field} must contain at least one recipient`);
    }
    return cleaned;
  }

  const single = requiredString(value, field);

  if (single.startsWith("[")) {
    let parsed = null;
    try {
      parsed = JSON.parse(single);
    } catch {
      throw new Error(
        `${field} must be a valid JSON array string or email string`,
      );
    }
    return parseRecipientList(parsed, field);
  }

  if (single.includes(",")) {
    const parsed = single
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return parseRecipientList(parsed, field);
  }

  return single;
}

function deriveParentIssueUrl(explicitUrl, issueIdentifier) {
  const direct = optionalTrimmedString(explicitUrl);
  if (direct) return direct;

  const publicBaseUrl = optionalTrimmedString(process.env.PAPERCLIP_PUBLIC_URL);
  const companyRouteKey = optionalTrimmedString(
    process.env.PAPERCLIP_COMPANY_ROUTE_KEY ??
      process.env.PAPERCLIP_COMPANY_URL_KEY,
  );
  const identifier = optionalTrimmedString(issueIdentifier);

  if (!publicBaseUrl || !companyRouteKey || !identifier) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/+$/, "")}/${companyRouteKey}/issues/${identifier}`;
}

function normalizeSource(source, contextField, index) {
  if (typeof source === "string") {
    return {
      label: `Source ${index + 1}`,
      url: requiredString(source, `${contextField}[${index}]`),
    };
  }
  if (!source || typeof source !== "object") {
    throw new Error(`${contextField}[${index}] must be a string or object`);
  }
  return {
    label: requiredString(
      source.label ?? `Source ${index + 1}`,
      `${contextField}[${index}].label`,
    ),
    url: requiredString(source.url, `${contextField}[${index}].url`),
  };
}

// ---------- card normalization ----------

function normalizeCard(card, index, { signingKey, approvalBaseUrl }) {
  if (!card || typeof card !== "object") {
    throw new Error(`cards[${index}] must be an object`);
  }
  const id = requiredString(card.id, `cards[${index}].id`);
  const title = requiredString(card.title, `cards[${index}].title`);
  const body = optionalString(card.body, `cards[${index}].body`);
  const rationale = optionalString(card.rationale, `cards[${index}].rationale`);
  const details = Array.isArray(card.details)
    ? card.details.map((d, i) => {
        if (!d || typeof d !== "object") {
          throw new Error(`cards[${index}].details[${i}] must be an object`);
        }
        return {
          label: requiredString(d.label, `cards[${index}].details[${i}].label`),
          value: requiredString(d.value, `cards[${index}].details[${i}].value`),
        };
      })
    : [];
  const sources = Array.isArray(card.sources)
    ? card.sources.map((s, i) => normalizeSource(s, `cards[${index}].sources`, i))
    : [];
  const approvalId = optionalString(card.approvalId, `cards[${index}].approvalId`);

  let approveUrl = null;
  let rejectUrl = null;
  if (approvalId && signingKey && approvalBaseUrl) {
    approveUrl = signApprovalUrl({
      approvalId,
      action: "approve",
      baseUrl: approvalBaseUrl,
      signingKey,
    });
    rejectUrl = signApprovalUrl({
      approvalId,
      action: "reject",
      baseUrl: approvalBaseUrl,
      signingKey,
    });
  }

  return {
    id,
    title,
    body,
    details,
    rationale,
    sources,
    approvalId,
    approveLabel: optionalTrimmedString(card.approveLabel) ?? `Approve ${id}`,
    rejectLabel: optionalTrimmedString(card.rejectLabel) ?? `Reject ${id}`,
    approveUrl,
    rejectUrl,
  };
}

// ---------- card text rendering (for text/plain alt) ----------

function renderCardText(card) {
  const lines = [`${card.id} — ${card.title}`];
  if (card.body) lines.push(card.body);
  for (const d of card.details) lines.push(`${d.label}: ${d.value}`);
  if (card.rationale) lines.push(`Rationale: ${card.rationale}`);
  for (const s of card.sources) lines.push(`- ${s.label}: ${s.url}`);
  if (card.approveUrl && card.rejectUrl) {
    lines.push(`${card.approveLabel}: ${card.approveUrl}`);
    lines.push(`${card.rejectLabel}: ${card.rejectUrl}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------- full email render ----------

export async function renderApprovalEmail(payload) {
  const eyebrowLabel = requiredString(payload.eyebrowLabel, "eyebrowLabel");
  const companyName = requiredString(
    payload.companyName ?? "OctoSync",
    "companyName",
  );
  const generatedAt = requiredString(
    payload.generatedAt ?? new Date().toISOString().slice(0, 10),
    "generatedAt",
  );
  const summary = requiredString(payload.summary, "summary");

  const signingKey = optionalTrimmedString(process.env.EMAIL_APPROVAL_SIGNING_KEY);
  const approvalBaseUrl = optionalTrimmedString(process.env.EMAIL_APPROVAL_PUBLIC_URL);
  const buttonsConfigured = Boolean(signingKey && approvalBaseUrl);
  if (!buttonsConfigured) {
    if (!signingKey)
      console.warn(
        "EMAIL_APPROVAL_SIGNING_KEY not set; sending email without action buttons.",
      );
    if (!approvalBaseUrl)
      console.warn(
        "EMAIL_APPROVAL_PUBLIC_URL not set; sending email without action buttons.",
      );
  }

  if (!Array.isArray(payload.cards) || payload.cards.length === 0) {
    throw new Error("cards must be a non-empty array");
  }
  const cards = payload.cards.map((card, i) =>
    normalizeCard(card, i, { signingKey, approvalBaseUrl }),
  );

  const parentIssueIdentifier = optionalString(
    payload.parentIssueIdentifier,
    "parentIssueIdentifier",
  );
  const parentIssueUrl = deriveParentIssueUrl(
    payload.parentIssueUrl,
    parentIssueIdentifier,
  );

  const subject =
    optionalString(payload.subject, "subject") ??
    `${eyebrowLabel} — ${companyName} — ${generatedAt}`;

  const anyButtons = cards.some((c) => c.approveUrl);
  const iconUrl = approvalBaseUrl
    ? `${approvalBaseUrl}/static/octosync-icon.png`
    : null;

  const textBody = [
    subject,
    "",
    summary,
    "",
    anyButtons
      ? "Approve or reject directly from the links below — Paperclip records the decision and the buttons expire in 7 days."
      : "Paperclip approvals remain the canonical approval path for this batch.",
    "",
    ...cards.flatMap((c) => [renderCardText(c)]),
    ...(parentIssueIdentifier || parentIssueUrl
      ? [
          "Review thread:",
          parentIssueIdentifier && parentIssueUrl
            ? `- ${parentIssueIdentifier}: ${parentIssueUrl}`
            : parentIssueUrl
              ? `- ${parentIssueUrl}`
              : `- ${parentIssueIdentifier}`,
        ]
      : []),
  ].join("\n");

  const renderHtml = await loadHtmlRenderer();
  const html = await renderHtml({
    eyebrowLabel,
    companyName,
    generatedAt,
    summary,
    cards,
    parentIssueIdentifier,
    parentIssueUrl,
    iconUrl,
    anyButtons,
  });

  return { subject, text: textBody, html };
}

// ---------- Resend send ----------

export async function sendApprovalEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");

  const rendered = await renderApprovalEmail(payload);

  const from = requiredString(payload.from, "from");
  const to = parseRecipientList(payload.to, "to");
  const replyTo = optionalString(payload.replyTo, "replyTo");

  const requestBody = {
    from,
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  };
  if (replyTo) requestBody.reply_to = replyTo;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (payload.idempotencyKey) {
    headers["Idempotency-Key"] = requiredString(
      payload.idempotencyKey,
      "idempotencyKey",
    );
  }

  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      `Resend request failed with status ${response.status}`;
    throw new Error(message);
  }
  return data;
}

// ---------- CLI entrypoint ----------

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error("Usage: node render-approval-email.mjs <payload.json>");
    process.exit(1);
  }
  const raw = await readFile(payloadPath, "utf8");
  const payload = JSON.parse(raw);
  const data = await sendApprovalEmail(payload);
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

// Only run main() when invoked as a CLI; allow import as a module.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
