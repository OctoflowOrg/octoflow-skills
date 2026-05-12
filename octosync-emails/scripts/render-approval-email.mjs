// OctoSync approval email renderer + sender.
//
// Single source of truth for the OctoSync brand shell + per-card
// layout + Resend send call. Both linkedin-finalize-batch.mjs and
// opportunity-digest.mjs delegate to this script via spawn (or import
// renderApprovalEmail / sendApprovalEmail directly).
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
import { signApprovalUrl } from "./sign-approval-link.mjs";

const RESEND_URL = "https://api.resend.com/emails";

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

// ---------- HTML rendering ----------

// OctoSync brand palette (canonical — see references/brand-shell.md)
const BRAND_TEAL = "#2d6065";
const BRAND_TEAL_DARK = "#234d52";
const BRAND_ORANGE = "#d97543";
const BRAND_CREAM = "#e8d8b8";
const TEXT_BODY = "#1f2937";
const TEXT_MUTED = "#6b7280";
const CARD_BORDER = "#e5e7eb";
const PAGE_BG = "#fafaf7";
const APPROVE_BG = "#0d8857";
const REJECT_BG = "#9b2c2c";
const LINK = BRAND_TEAL_DARK;

function renderCardHtml(card) {
  const buttonsHtml =
    card.approveUrl && card.rejectUrl
      ? `
            <div style="margin-top:16px;padding-top:14px;border-top:1px solid ${CARD_BORDER};">
              <a href="${escapeHtml(card.approveUrl)}" style="display:inline-block;margin-right:8px;padding:9px 16px;border-radius:6px;background:${APPROVE_BG};color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;">${escapeHtml(card.approveLabel)}</a>
              <a href="${escapeHtml(card.rejectUrl)}" style="display:inline-block;padding:9px 16px;border-radius:6px;background:${REJECT_BG};color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;">${escapeHtml(card.rejectLabel)}</a>
            </div>`
      : "";

  const detailsHtml =
    card.details.length > 0
      ? `<div style="margin:0 0 12px;font-size:14px;color:${TEXT_BODY};line-height:1.7;">
              ${card.details
                .map(
                  (d) =>
                    `<div><strong style="color:${BRAND_TEAL_DARK};">${escapeHtml(d.label)}:</strong> ${escapeHtml(d.value)}</div>`,
                )
                .join("")}
            </div>`
      : "";

  const bodyHtml = card.body
    ? `<p style="margin:0 0 12px;color:${TEXT_BODY};line-height:1.65;white-space:pre-wrap;font-size:15px;">${escapeHtml(card.body)}</p>`
    : "";

  const rationaleHtml = card.rationale
    ? `<p style="margin:0 0 12px;color:${TEXT_BODY};font-size:14px;"><strong style="color:${BRAND_TEAL_DARK};">Rationale:</strong> ${escapeHtml(card.rationale)}</p>`
    : "";

  const sourcesHtml =
    card.sources.length > 0
      ? `<div style="font-size:13px;color:${TEXT_MUTED};">
            <strong style="color:${BRAND_TEAL_DARK};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;">Sources</strong>
            <ul style="padding-left:18px;margin:6px 0 0;">
              ${card.sources
                .map(
                  (source) =>
                    `<li style="margin:0 0 4px;"><a href="${escapeHtml(source.url)}" style="color:${LINK};text-decoration:none;">${escapeHtml(source.label)}</a></li>`,
                )
                .join("")}
            </ul>
          </div>`
      : "";

  return `
        <section style="border:1px solid ${CARD_BORDER};border-radius:10px;padding:20px;margin:0 0 14px;background:#ffffff;">
          <div style="display:inline-block;padding:4px 9px;border-radius:4px;background:${BRAND_ORANGE};color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px;">${escapeHtml(card.id)}</div>
          <h3 style="margin:0 0 10px;font-size:18px;line-height:1.3;color:${TEXT_BODY};font-weight:600;">${escapeHtml(card.title)}</h3>
          ${bodyHtml}
          ${detailsHtml}
          ${rationaleHtml}
          ${sourcesHtml}${buttonsHtml}
        </section>`;
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

export function renderApprovalEmail(payload) {
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

  const iconUrl = approvalBaseUrl
    ? `${approvalBaseUrl}/static/octosync-icon.png`
    : null;
  const iconImg = iconUrl
    ? `<img src="${escapeHtml(iconUrl)}" alt="OctoSync" width="40" height="32" style="display:block;border:0;outline:none;width:40px;height:auto;">`
    : "";

  const parentIssueBlock =
    parentIssueUrl || parentIssueIdentifier
      ? `
        <p style="margin:18px 0 0;font-size:13px;color:${TEXT_MUTED};">
          Review thread:
          ${
            parentIssueUrl
              ? `<a href="${escapeHtml(parentIssueUrl)}" style="color:${LINK};text-decoration:none;font-weight:600;">${escapeHtml(parentIssueIdentifier ?? "Open in Paperclip")}</a>`
              : escapeHtml(parentIssueIdentifier)
          }
        </p>`
      : "";

  const html = `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;padding:0;background:${PAGE_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${TEXT_BODY};">
        <div style="max-width:640px;margin:0 auto;padding:24px 16px 32px;">
          <header style="background:${BRAND_TEAL};border-radius:8px 8px 0 0;padding:14px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td valign="middle" style="width:48px;">${iconImg}</td>
                <td valign="middle" style="padding-left:12px;">
                  <div style="font-size:15px;font-weight:700;letter-spacing:0.04em;color:#ffffff;line-height:1.1;">OCTOSYNC</div>
                  <div style="font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND_CREAM};margin-top:2px;">${escapeHtml(eyebrowLabel)}</div>
                </td>
              </tr>
            </table>
          </header>

          <div style="background:#ffffff;border:1px solid ${CARD_BORDER};border-top:0;border-radius:0 0 8px 8px;padding:24px 20px 20px;margin-bottom:18px;">
            <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:${TEXT_BODY};font-weight:600;">${escapeHtml(companyName)}</h1>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${TEXT_BODY};">${escapeHtml(summary)}</p>
            <p style="margin:0;padding-top:14px;border-top:1px solid ${CARD_BORDER};font-size:14px;line-height:1.6;color:${TEXT_MUTED};">
              ${
                anyButtons
                  ? "Approve or reject directly from the buttons below. Paperclip records the decision; the inbox remains the audit surface."
                  : "Approvals remain in Paperclip. This email is a notification copy so the items are easier to scan outside the thread."
              }
            </p>
          </div>

          <section>${cards.map((c) => renderCardHtml(c)).join("")}</section>

          ${parentIssueBlock}

          <footer style="margin-top:24px;padding-top:14px;border-top:1px solid ${CARD_BORDER};color:${TEXT_MUTED};font-size:12px;line-height:1.5;">
            ${
              anyButtons
                ? "Action links expire in 7 days. After that, action via the Paperclip inbox.<br>"
                : ""
            }Generated ${escapeHtml(generatedAt)} by the OctoSync workflow.
          </footer>
        </div>
      </body>
    </html>`;

  return { subject, text: textBody, html };
}

// ---------- Resend send ----------

export async function sendApprovalEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");

  const rendered = renderApprovalEmail(payload);

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
