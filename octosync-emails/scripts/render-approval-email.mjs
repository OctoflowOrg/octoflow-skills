// OctoSync approval email renderer + sender.
//
// Single source of truth for the OctoSync brand shell + per-card
// layout + Resend send call. Both linkedin-finalize-batch.mjs and
// prospecting-approval-send.mjs import renderApprovalEmail /
// sendApprovalEmail or renderProspectingApprovalEmail /
// sendProspectingApprovalEmail from here.
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
import { signEmailToken } from "./sign-batch-link.mjs";

const RESEND_URL = "https://api.resend.com/emails";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_BUNDLE_PATH = resolve(__dirname, "../templates/dist/render.mjs");

let templateBundleCache = null;
async function loadTemplateBundle() {
  if (!templateBundleCache) {
    templateBundleCache = await import(TEMPLATE_BUNDLE_PATH);
  }
  return templateBundleCache;
}

async function loadHtmlRenderer() {
  const mod = await loadTemplateBundle();
  if (typeof mod.renderApprovalEmailHtml !== "function") {
    throw new Error(
      `renderApprovalEmailHtml not found in ${TEMPLATE_BUNDLE_PATH}. Did you run 'npm install && npm run build' in templates/?`,
    );
  }
  return mod.renderApprovalEmailHtml;
}

async function loadProspectingHtmlRenderer() {
  const mod = await loadTemplateBundle();
  if (typeof mod.renderProspectingApprovalEmailHtml !== "function") {
    throw new Error(
      `renderProspectingApprovalEmailHtml not found in ${TEMPLATE_BUNDLE_PATH}. Rebuild templates/.`,
    );
  }
  return mod.renderProspectingApprovalEmailHtml;
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

// ---------- prospecting approval (checkbox-form) ----------

function normalizeProspect(p, field) {
  if (!p || typeof p !== "object") {
    throw new Error(`${field} must be an object`);
  }
  return {
    approvalId: requiredString(p.approvalId, `${field}.approvalId`),
    name: optionalString(p.name, `${field}.name`),
    role: requiredString(p.role, `${field}.role`),
    email: requiredString(p.email, `${field}.email`),
    isGenericInbox: Boolean(p.isGenericInbox),
  };
}

function normalizeOpportunity(opp, index) {
  if (!opp || typeof opp !== "object") {
    throw new Error(`opportunities[${index}] must be an object`);
  }
  if (!Array.isArray(opp.prospects) || opp.prospects.length === 0) {
    throw new Error(`opportunities[${index}].prospects must be a non-empty array`);
  }
  return {
    id: requiredString(opp.id, `opportunities[${index}].id`),
    companyName: requiredString(opp.companyName, `opportunities[${index}].companyName`),
    industry: optionalString(opp.industry, `opportunities[${index}].industry`),
    location: optionalString(opp.location, `opportunities[${index}].location`),
    whyNow: requiredString(opp.whyNow, `opportunities[${index}].whyNow`),
    workflow: optionalString(opp.workflow, `opportunities[${index}].workflow`),
    confidence: optionalString(opp.confidence, `opportunities[${index}].confidence`),
    sources: Array.isArray(opp.sources)
      ? opp.sources.map((s, j) =>
          normalizeSource(s, `opportunities[${index}].sources`, j),
        )
      : [],
    prospects: opp.prospects.map((p, j) =>
      normalizeProspect(p, `opportunities[${index}].prospects[${j}]`),
    ),
  };
}

function renderProspectingTextAlt({
  generatedAt,
  opportunities,
  totalProspects,
  parentIssueIdentifier,
  parentIssueUrl,
}) {
  const lines = [
    `Weekly Prospecting Approval — ${generatedAt}`,
    "",
    `${opportunities.length} ${opportunities.length === 1 ? "opportunity" : "opportunities"} · ${totalProspects} ${totalProspects === 1 ? "prospect" : "prospects"} ready for outreach.`,
    "",
    "Open the HTML version of this email to use the checkbox form. If you are reading plain text, action via the Paperclip inbox.",
    "",
  ];
  for (const opp of opportunities) {
    const meta = [opp.industry, opp.location].filter(Boolean).join(", ");
    lines.push(meta ? `${opp.companyName} (${meta})` : opp.companyName);
    lines.push(`  Why now: ${opp.whyNow}`);
    const wc = [
      opp.workflow ? `Workflow: ${opp.workflow}` : null,
      opp.confidence ? `Confidence: ${opp.confidence}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (wc) lines.push(`  ${wc}`);
    for (const s of opp.sources) lines.push(`  Source: ${s.label} — ${s.url}`);
    lines.push("  Prospects:");
    for (const p of opp.prospects) {
      const who = p.name ? `${p.name}, ${p.role}` : `(no individual found) ${p.role}`;
      lines.push(
        `    - ${who} <${p.email}>${p.isGenericInbox ? " [generic inbox]" : ""}`,
      );
    }
    lines.push("");
  }
  if (parentIssueIdentifier || parentIssueUrl) {
    lines.push("Review thread:");
    if (parentIssueIdentifier && parentIssueUrl) {
      lines.push(`- ${parentIssueIdentifier}: ${parentIssueUrl}`);
    } else if (parentIssueUrl) {
      lines.push(`- ${parentIssueUrl}`);
    } else {
      lines.push(`- ${parentIssueIdentifier}`);
    }
  }
  return lines.join("\n");
}

export async function renderProspectingApprovalEmail(payload) {
  const generatedAt = requiredString(
    payload.generatedAt ?? new Date().toISOString().slice(0, 10),
    "generatedAt",
  );
  const emailRef = requiredString(payload.emailRef, "emailRef");
  const companyId = requiredString(payload.companyId, "companyId");

  if (
    !Array.isArray(payload.opportunities) ||
    payload.opportunities.length === 0
  ) {
    throw new Error("opportunities must be a non-empty array");
  }
  const opportunities = payload.opportunities.map((opp, i) =>
    normalizeOpportunity(opp, i),
  );
  const totalProspects = opportunities.reduce(
    (sum, o) => sum + o.prospects.length,
    0,
  );
  if (totalProspects === 0) {
    throw new Error("at least one prospect is required");
  }

  const signingKey = optionalTrimmedString(
    process.env.EMAIL_APPROVAL_SIGNING_KEY,
  );
  const approvalBaseUrl = optionalTrimmedString(
    process.env.EMAIL_APPROVAL_PUBLIC_URL,
  );
  if (!signingKey) {
    throw new Error(
      "EMAIL_APPROVAL_SIGNING_KEY required to sign the email token",
    );
  }
  if (!approvalBaseUrl) {
    throw new Error(
      "EMAIL_APPROVAL_PUBLIC_URL required to build the /decide URL",
    );
  }

  const parentIssueIdentifier = optionalString(
    payload.parentIssueIdentifier,
    "parentIssueIdentifier",
  );
  const parentIssueUrl = deriveParentIssueUrl(
    payload.parentIssueUrl,
    parentIssueIdentifier,
  );

  const token = signEmailToken({
    emailRef,
    companyId,
    signingKey,
  });
  const trimmedBase = approvalBaseUrl.replace(/\/+$/, "");
  const actionUrl = `${trimmedBase}/decide`;
  const iconUrl = `${trimmedBase}/static/octosync-icon.png`;

  const subject =
    optionalString(payload.subject, "subject") ??
    `Weekly Prospecting Approval — ${generatedAt}`;

  const renderHtml = await loadProspectingHtmlRenderer();
  const html = await renderHtml({
    generatedAt,
    parentIssueIdentifier,
    parentIssueUrl,
    iconUrl,
    token,
    actionUrl,
    opportunities,
    totalProspects,
  });

  const text = renderProspectingTextAlt({
    generatedAt,
    opportunities,
    totalProspects,
    parentIssueIdentifier,
    parentIssueUrl,
  });

  return { subject, text, html };
}

export async function sendProspectingApprovalEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");

  const rendered = await renderProspectingApprovalEmail(payload);

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
  if (Array.isArray(payload.tags) && payload.tags.length > 0) {
    requestBody.tags = payload.tags;
  }

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
