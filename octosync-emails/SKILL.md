---
name: octosync-emails
description: >
  Load when an OctoSync agent needs to send a workflow approval email
  (LinkedIn review or weekly prospecting digest), or sync a decided
  prospect into Attio. Ships thin POST clients that call the
  approval-broker; the broker owns approval creation, HTML rendering,
  Resend send, audit comment, parent → in_review patch, and the
  Attio CRM upserts. Used by the CMO at LinkedIn step 7, the CSO at
  Opportunity step 12, and the CSO at Opportunity step 13.
---

# OctoSync approval emails — broker HTTP contract

The agent-side surface for the OctoSync approval-email flow. Heavy
lifting (approval creation, React Email rendering, Resend, audit
comments, parent.status transitions) lives in the approval-broker
sidecar at `services/approval-broker/`.

**Agents reach the broker over HTTP. Never look for a script.** The
`.mjs` files under `scripts/` are the reference implementation of
these requests, kept for readability — they are NOT runnable from an
agent run (see "There is no script to locate" below).

## Endpoints

- `POST /approvals/send` — create approvals, send the review email,
  post the audit comment, patch parent → `in_review`. One call per
  persona for content review. (Was `send-approval.mjs`.)
- `POST /attio/sync-decision` — upsert a decided prospect's Company +
  Person in Attio and post the audit comment. One call per prospect.
  (Was `attio-sync.mjs`.)
- `GET /approvals/content-engine/schedule?companyId=&personaId=&decidedAt=`
  — deterministic publish time from the persona's cadence, DST-aware.
  Replaces in-prompt date math (OCT-512) and `compute-schedule.mjs`.
- `GET /approvals/content-engine/config?companyId=` — the persona and
  channel roster.

All take `Authorization: Bearer $EMAIL_APPROVAL_INTERNAL_TOKEN`.

## Invocation

```sh
jq -n --slurpfile pkg /tmp/<workflow>-payload.json \
  --arg parentId "<parentIssueId>" --arg agentId "$PAPERCLIP_AGENT_ID" \
  --arg companyId "$PAPERCLIP_COMPANY_ID" \
  --arg outboundEmail "$COMPANY_OUTBOUND_EMAIL" \
  --arg recipientList "$WORKFLOW_EMAIL_TO" \
  '{workflow:"<prospecting|linkedin|ap-invoice>", parentId:$parentId,
    agentId:$agentId, companyId:$companyId, outboundEmail:$outboundEmail,
    recipientList:$recipientList, payload:$pkg[0]}' \
| curl -fsS -X POST "${EMAIL_APPROVAL_PUBLIC_URL%/}/send" \
    -H "Authorization: Bearer ${EMAIL_APPROVAL_INTERNAL_TOKEN}" \
    -H "Content-Type: application/json" --data @-
```

For a content-engine revision (v2) send, the `payload` carries its own
`revision: { version: 2, mode: "seed"|"reroll", clientNotes }` block —
the broker derives everything from it; there is no extra flag.

**There is no script to locate.** Skill script mounts are not
reachable from an agent run — `local_path` skills are never
materialized into `$OCTOSYNC_SKILLS_RUNTIME` (that directory holds only
github/skills_sh skills), and searching with `find / -name` is
forbidden (the OCT-409 retry-storm pattern). The HTTP endpoint above
IS the interface; the `.mjs` files in this skill are kept only as the
reference implementation of that request.

## Response semantics

**2xx** — the broker created approvals, sent the email, posted the
audit comment on the parent, and patched parent → `in_review`. Stop
cleanly; post nothing further.
**Non-2xx** — the response body carries the broker's error text. Quote
it verbatim in one short blocker comment on the parent and stop. The
broker is idempotent; a later run can retry.

## Required env (on the agent's container)

- `EMAIL_APPROVAL_PUBLIC_URL` — broker public base URL, e.g.
  `https://agents.octosync.dev/approvals`
- `EMAIL_APPROVAL_INTERNAL_TOKEN` — bearer token shared with the
  broker
- `PAPERCLIP_COMPANY_ID` — passed through to the broker
- `COMPANY_OUTBOUND_EMAIL` — From: + Reply-To: for this agent's
  emails (per-company verified domain)
- `WORKFLOW_EMAIL_TO` — review-email recipient(s) for this agent's
  workflow (LinkedIn for CMO, prospecting for CSO). Single address
  or JSON-array string. The broker reads whichever value the agent
  passes in the request body, not the env directly.

**Not** needed on the agent (server-side, broker only):
`RESEND_API_KEY`, `EMAIL_APPROVAL_SIGNING_KEY`. Removing these from
the agent's Paperclip-UI env is defense in depth — even if an agent
improvised, it couldn't send through Resend or sign a valid form
token.

## Approval shapes per workflow

The broker constructs the approval payloads at `/approvals/send`
time; agents do not POST to `/api/companies/{id}/approvals`
directly. The broker enforces this with a schema guard — if pre-
existing approvals for the current emailRef are found with a
non-broker payload shape, the broker refuses the request and lists
the offending ids. The agent must post the blocker text verbatim
and stop; a human cleans up before the next run.

See `services/approval-broker/workflows/<name>.mjs` for the source
of truth on each workflow's approval shape, email payload shape, and
schema-guard rules.

## Email + decide flow

Both workflows now render emails with a single `<form method="GET"
action=".../approvals/stage">` wrapping all items. The GET submission
goes to the broker's same-origin staging page, which displays the
selection in full detail (per-item, not just counts) and lets the
user confirm via a same-origin `<form method="POST"
action="/approvals/receive">`. This avoids Gmail's "submitting to an
external page" warning that fires on cross-origin POSTs from email
clients.

- LinkedIn email → radio buttons (single_select). Submitting with no
  selection = skip this week (all options get rejected on confirm).
- Prospecting email → checkboxes (multi_select). Each checked
  prospect approved, each unchecked rejected.

## Attio sync (Phase 3a)

After a prospecting approval is decided (approved or rejected), the
CSO syncs the prospect into Attio via `POST /attio/sync-decision`. One
invocation per prospect; broker upserts both the Company (by
`domains`) and Person (by `email_addresses`) and posts an audit
comment on the parent. The audit comment is the idempotency anchor —
re-running for the same approvalId is a no-op once the comment
exists.

Invocation:

```sh
curl -fsS -X POST "${EMAIL_APPROVAL_PUBLIC_URL%/}/../attio/sync-decision" \
  -H "Authorization: Bearer ${EMAIL_APPROVAL_INTERNAL_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @/tmp/attio-payload-<approvalId>.json
```

Payload JSON contains `parentId`, `approvalId`, `opportunityId`,
`company {name, domain, website, phone}`,
`contact {email, name, role, isGenericInbox}`, `decision`, `decidedAt`.
The business phone lives on the **Company**, the person on the
**Contact**. See the script header for the full schema.

Uses the same env (`EMAIL_APPROVAL_PUBLIC_URL`,
`EMAIL_APPROVAL_INTERNAL_TOKEN`). The
Attio access token is broker-side only (`ATTIO_ACCESS_TOKEN`) — the
agent never sees it and never calls Attio directly. When the
broker's token is unset, the route returns `503 attio integration
disabled`; the agent should treat this as a blocker and stop.

See `services/approval-broker/attio.mjs` for the orchestrator and
`companies/octosync/skills/octosync-coordination-rules/references/attio-crm.md`
for the Attio object/attribute reference.

## References

- `references/brand-shell.md` — OctoSync header/palette/footer used by
  the rendered emails
- `references/approval-button-card.md` — per-card layout used by both
  workflows
- `references/sidecar-protocol.md` — broker contract (`/approvals/send`,
  `/approvals/stage`, `/approvals/receive`, `/approvals/confirm`,
  `/approvals/act`)
- `references/approval-payload.md` — what the broker writes into each
  approval's payload per workflow
