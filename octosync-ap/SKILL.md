---
name: octosync-ap
description: >
  ALWAYS load at the start of every heartbeat for any OctoSync agent
  working accounts payable — invoice capture, controls/coding, posting to
  QuickBooks, or AP orchestration. Canonical AP reference: the broker's
  invoice endpoints (/invoice/fetch read, /invoice/ledger read,
  /invoice/post write) and how to call them directly; the GL coding chart;
  and the anomaly rules (duplicate / bank-change / new-payee /
  out-of-band). Prose only — no shipped scripts; agents call the broker
  directly. Not for the outbound marketing/sales agents.
---

# OctoSync accounts payable — domain + broker-client skill

The agent-side surface for OctoSync's accounts-payable (AP) workflow: how
to reach the finance systems (through the broker, never directly), how to
**code** an invoice to the general ledger, and how to **flag anomalies**
before a human approves it. This is a **prose** skill — it ships no
scripts. Heavy lifting and all finance credentials live broker-side in
`services/approval-broker/`; agents hold no Gmail or QuickBooks creds.

> **No auto-approval, ever.** A human approves **every** invoice via the
> signed approval email. AP agents capture, code, flag, package, and post
> — they never approve, and **payment release stays a separate human
> action** outside this system. See
> `docs/design/accounts-payable-pipeline.md` for the full pipeline.

## Division of labor

- **Broker holds all finance creds** (Gmail read, QuickBooks read+write)
  and exposes three narrow AP endpoints. Agents call them over HTTP with
  the shared broker bearer token — the same auth `octosync-emails` uses.
- **The capture step** reads new invoices via `/invoice/fetch`.
- **The controls step** validates + codes using `/invoice/ledger` (live
  QuickBooks prior-bill/vendor history) **and** the wiki prior-vendor
  context (consulted first, via the Wiki Maintainer), then applies the
  coding chart + anomaly rules below.
- **The posting step** writes the approved, coded bill via
  `/invoice/post` (QuickBooks Bill create). This is the only path that
  reaches a QuickBooks **write**.
- The **approval email** for each invoice is sent through the existing
  `octosync-emails` skill's `send-approval.mjs` with `--workflow
  ap-invoice` — it is **not** part of this skill. This skill covers only
  the invoice fetch/ledger/post endpoints and the coding/anomaly rules.

## Broker AP endpoints

All three are `POST`, authenticated with the broker bearer token, on the
broker base URL. They mirror the `octosync-emails` auth model — the same
`EMAIL_APPROVAL_PUBLIC_URL` + `EMAIL_APPROVAL_INTERNAL_TOKEN`.

| Endpoint | Access | Caller | Purpose |
|---|---|---|---|
| `/invoice/fetch` | Gmail read | capture | list new invoices from the AP inbox + configured labels/folders |
| `/invoice/ledger` | QuickBooks read | controls | prior bills + vendor history for duplicate / bank-change / new-payee checks |
| `/invoice/post` | QuickBooks **write** | bookkeeper | create the coded QuickBooks Bill (idempotent on invoice #) |

### `/invoice/fetch`

Two modes, same endpoint. The inbox address + label/folder set is
broker-configured, not passed by the agent.

**List mode** (intake, used by the CFA) — `{ "companyId": "<id>",
"since": "<ISO8601 UTC, optional>", "maxResults": <int, optional> }`.
Returns light metadata only: `{ "label": "<AP label>", "invoices": [
{ "messageId", "receivedAt", "from", "subject", "vendorGuess" } ] }` —
enough to create one Invoice issue per message. The Gmail label polled is
broker-configured (`AP_INBOX_LABEL`), not passed by the agent.

**Single mode** (used by the capture step) — `{ "companyId": "<id>",
"messageId": "<id>" }`. Returns that one message's full content:
`{ "messageId", "receivedAt", "from", "subject", "bodyText",
"attachments": [ { "filename", "mimeType", "size", "data" } ] }`, where
`data` is the attachment **base64**. The capture step extracts canonical
fields (vendor, invoice #, dates, amount, line items) from `bodyText` and
the attachments. Invoices are usually **PDF attachments** — to read one,
write it to a temp file and open it with the `Read` tool (Claude reads
PDFs, including scanned ones, directly):

```sh
# from the capture agent, for a PDF attachment's base64 `data`:
printf '%s' "<data>" | base64 -d > /tmp/invoice.pdf
# then Read /tmp/invoice.pdf and extract the fields
```

Keeping the content-heavy call here (not in the issue brief) is
deliberate — the brief carries only the `sourceMessageId`.

### `/invoice/ledger`

Request body: `{ "companyId": "<id>", "vendorName": "<name>",
"invoiceNumber": "<n, optional>" }`. Response: `{ "vendor": { "known":
<bool>, "priorBills": [ { "invoiceNumber", "date", "amount",
"remittanceHash" } ], "remittanceHash": "<latest known>" } }`.
`remittanceHash` is the broker's stable hash of the vendor's last-known
bank/remittance details — the **bank-change** signal (see anomalies).

### `/invoice/post`

Request body — the coded bill:

```json
{
  "companyId": "<id>",
  "sourceMessageId": "<gmail messageId>",
  "approvalId": "<the approved approval id>",
  "invoice": {
    "vendorName": "<name>",
    "invoiceNumber": "<n>",
    "invoiceDate": "<ISO date>",
    "dueDate": "<ISO date>",
    "currency": "USD",
    "amount": <number>,
    "memo": "<short>",
    "lineItems": [
      { "description": "<text>", "amount": <number>, "glAccount": "<name>" }
    ]
  }
}
```

Response: `{ "billId": "<qb id>", "status": "created" | "duplicate",
"qbUrl": "<link, optional>" }`. **Idempotent on `invoiceNumber` per
vendor** — a repeat call returns `status: "duplicate"` with the existing
`billId`, never a second Bill. The broker maps `glAccount` names to
QuickBooks account ids server-side.

## Invocation (direct, no shipped script)

AP endpoints are called directly — build the JSON, write it to a temp
file, and `curl` the file (never hand-build JSON in a `curl` heredoc; use
`--data @file` so there are no unresolved placeholders). Path values are
plain filesystem paths.

```sh
: "${EMAIL_APPROVAL_PUBLIC_URL:?EMAIL_APPROVAL_PUBLIC_URL not set; \
  broker base URL missing — ask operator to set adapterConfig.env}"
: "${EMAIL_APPROVAL_INTERNAL_TOKEN:?EMAIL_APPROVAL_INTERNAL_TOKEN not set}"

# e.g. post a coded bill (bookkeeper). Build /tmp/invoice-post.json first.
curl -sS -X POST "$EMAIL_APPROVAL_PUBLIC_URL/invoice/post" \
  -H "Authorization: Bearer $EMAIL_APPROVAL_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/invoice-post.json
```

The two `:?` guards produce one-line named blockers when the broker env
is missing (agent misconfigured). On any non-2xx, the broker returns
`{ "error": "<reason>" }`; treat it as a blocker — post the reason
verbatim on the issue you own and stop. Do not retry a 4xx.

> Calling the broker over HTTP is the sanctioned path for the finance
> systems, distinct from the Paperclip API (which always goes through the
> `paperclip` skill, never raw `curl`). The broker validates the bearer
> token and the payload shape server-side.

## GL coding chart

Every line item is coded to a general-ledger account. The `glAccount`
value you assign is the **exact QuickBooks account name** from the table
below — the broker resolves it to the QB account id at post time
(case-insensitive), falling back to **Uncategorized Expense** if a name
doesn't resolve. Match the vendor + line description to one account; when
a line is ambiguous, code to the closest account and **note the
uncertainty in the handoff** for the human to confirm at approval — never
guess silently.

Reconciled to OctoSync's live QuickBooks chart (2026-07 — the QBO default
chart, keyed by name; there are **no account numbers**). This is the
curated subset a software-services company actually uses; the full QB
chart has many accounts (home-office, vehicle, personal, mortgage) that AP
invoices must not touch.

| QuickBooks account (`glAccount`) | Use for |
|---|---|
| Apps and software | SaaS subscriptions, hosting, cloud / infra, APIs, developer tools |
| Contract labor | 1099 contractors — dev / design / engineering |
| Legal and professional services | lawyers, accountants, bookkeepers, consultants, agencies |
| Advertising and Marketing | ad spend, sponsorships, content, marketing tools |
| Subscriptions and memberships | professional memberships, dues, publications |
| Commissions and fees | referral / affiliate / commission payments |
| Transaction fees | payment processing, wire / ACH, platform / bank fees |
| Office Expenses | office supplies, small non-capital items, general admin |
| Materials and supplies | project / delivery materials and supplies |
| Communications | phone, internet, connectivity |
| Utilities (business property) | utilities for an office |
| Property rents and leases | office rent, coworking, facilities |
| Equipment rent and lease | equipment rental / lease |
| Business licenses | licenses, registrations, filing / franchise fees |
| Liability insurance | general liability, E&O / professional, cyber |
| Continued education | courses, conferences, certifications, training |
| Airfare | flights |
| Lodging | hotels / lodging |
| Other travel expenses | ground transport, rideshare, parking, other travel |
| Meals with clients | business / client meals (kept separate for the 50% rule) |
| Travel meals | meals while traveling |
| Shipping fees | postage, shipping, courier |
| Repairs and maintenance | repairs, maintenance |
| Uncategorized Expense | fallback — code here only when nothing fits, and flag for human review |

Coding guidance:

- **Use the exact name** as `glAccount` (the broker matches on it). Don't
  invent account names or numbers — this QuickBooks chart has none.
- **Split mixed invoices** across accounts by line item rather than
  forcing the whole invoice into one account.
- **Capital purchases (> ~$200).** QuickBooks has separate *Fixed Asset*
  accounts for big-ticket items (e.g. "Computer (> $200)", "Apps and
  software (> $200)"). AP does **not** auto-capitalize — for a single item
  clearly over ~$200 that looks like equipment/hardware, code to the
  nearest expense account and **flag it for the human** to capitalize if
  appropriate.
- **No cost-of-revenue split.** OctoSync's QB chart doesn't separate
  delivery cost-of-revenue from operating expense, so don't try to — pick
  the best-fit account above. (Adding COGS accounts for gross-margin
  tracking is a future QB-side setup task.)
- **Vendor defaults** speed repeat coding — once a vendor is confirmed
  (e.g. a known SaaS tool → Apps and software), the wiki prior-vendor
  context carries that default forward. Apply a known default, but still
  flag a first-time vendor for human confirmation.

## Anomaly rules

The controls step raises a flag (it never blocks on its own — the human
decides at approval) for any of the following. Each flag names the
signal, the evidence, and the recommended disposition in the handoff.

- **Duplicate** — same vendor + `invoiceNumber` already in the ledger, OR
  same vendor + amount within a short window (default **±3 days**). Prior
  bill exists in `/invoice/ledger`. Recommend: hold, likely already paid.
- **Bank/remittance change** — the vendor's current remittance details
  hash differs from the last-known `remittanceHash` from `/invoice/ledger`.
  This is the highest-priority fraud signal. Recommend: **verify out of
  band** with the vendor before approving; never approve on the strength
  of the invoice email alone.
- **New payee** — vendor not present in `/invoice/ledger` and not in the
  wiki prior-vendor context. Recommend: confirm the vendor is legitimate
  and expected before first payment.
- **Out-of-band amount** — amount materially above the vendor's historical
  range, or above an absolute review threshold. First-pass defaults: any
  single invoice **≥ $2,500**, or **> 2× the vendor's median prior bill**
  (whichever triggers). Recommend: extra scrutiny; confirm the amount is
  expected. (Thresholds are tunable — reconcile to OctoSync's actual spend
  patterns.)

Wiki prior-vendor context (via the Wiki Maintainer) is consulted **first**
for every invoice — it can pre-empt a false "new payee" flag (vendor known
in the wiki but not yet in QB) and carries human notes on known-good
vendors.

## Idempotency & audit

- `/invoice/post` is idempotent on `invoiceNumber` per vendor — safe to
  retry; a duplicate returns the existing `billId`.
- The invoice **issue thread** is the live audit trail; the decided
  outcome (vendor, amount, coding, decision) is also folded into the
  **wiki** via the Wiki Maintainer for durable audit and future prior-
  vendor lookups.
- Never write local files as workflow state; the issue + wiki are the
  record.

## Required env (on the agent's container)

- `EMAIL_APPROVAL_PUBLIC_URL` — broker public base URL (e.g.
  `https://agents.octosync.dev/approvals`)
- `EMAIL_APPROVAL_INTERNAL_TOKEN` — broker bearer token
- `PAPERCLIP_COMPANY_ID` — passed through to the broker

**Not** on the agent (broker-side only, in Secrets Manager): the Gmail
read creds and the QuickBooks OAuth (read + write) creds. Agents never see
or send finance credentials — that separation is the trust boundary.
