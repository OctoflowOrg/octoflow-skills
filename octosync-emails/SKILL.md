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

# OctoSync approval emails — thin-client skill

The agent-side surface for the OctoSync approval-email flow. Heavy
lifting (approval creation, React Email rendering, Resend, audit
comments, parent.status transitions) lives in the approval-broker
sidecar at `services/approval-broker/`. This skill ships exactly
one script — a HTTP client.

## Scripts

- `scripts/send-approval.mjs` — workflow-agnostic thin POST client.
  Reads the agent's payload JSON, POSTs it to
  `${EMAIL_APPROVAL_PUBLIC_URL}/send` with bearer auth, prints the
  broker's response. ~50 lines.
- `scripts/attio-sync.mjs` — Attio CRM sync thin client. Used by the
  CSO post-decision (step 13). One call per decided prospecting
  approval; broker upserts the prospect's Company + Person in Attio
  and posts an audit comment on the parent. See "Attio sync" below.

## Invocation

```sh
CLIENT=$(find / -name send-approval.mjs \
  -path "*octosync-emails*" 2>/dev/null | head -1)
node "$CLIENT" \
  --workflow <prospecting|linkedin> \
  --parent-id "<parentIssueId>" \
  --agent-id "$PAPERCLIP_AGENT_ID" \
  --payload /tmp/<workflow>-payload.json
```

Path-flag values are plain filesystem paths — **no `@` prefix**.

## Exit semantics

`0` on success (broker created approvals, sent email, posted audit
comment on parent, patched parent → `in_review`). Non-zero on a
blocker; client prints `BLOCKER: <reason>` to stderr (and stdout)
with the broker's error text. Calling agent posts a short blocker
comment on the parent and stops.

## Required env (on the agent's container)

- `EMAIL_APPROVAL_PUBLIC_URL` — broker public base URL, e.g.
  `https://agents.octosync.dev/approvals`
- `EMAIL_APPROVAL_INTERNAL_TOKEN` — bearer token shared with the
  broker
- `PAPERCLIP_COMPANY_ID` — passed through to the broker
- `PAPERCLIP_OUTBOUND_EMAIL` — From: + Reply-To: for this agent's
  emails (per-company verified domain)
- For prospecting: `WORKFLOW_EMAIL_TO` — recipients
- For LinkedIn: `LINKEDIN_REVIEW_EMAIL_TO` — recipients (the broker
  reads whichever the agent passes in the request body, not the env
  directly)

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
CSO syncs the prospect into Attio via `scripts/attio-sync.mjs`. One
invocation per prospect; broker upserts both the Company (by
`domains`) and Person (by `email_addresses`) and posts an audit
comment on the parent. The audit comment is the idempotency anchor —
re-running for the same approvalId is a no-op once the comment
exists.

Invocation:

```sh
CLIENT=$(find / -name attio-sync.mjs \
  -path "*octosync-emails*" 2>/dev/null | head -1)
node "$CLIENT" --payload /tmp/attio-payload-<approvalId>.json
```

Payload JSON contains `parentId`, `approvalId`, `opportunityId`,
`companyName`, `domain`, `person {email, name, role, isGenericInbox}`,
`decision`, `decidedAt`. See the script header for the full schema.

Reads the same env as `send-approval.mjs`
(`EMAIL_APPROVAL_PUBLIC_URL`, `EMAIL_APPROVAL_INTERNAL_TOKEN`). The
Attio access token is broker-side only (`ATTIO_ACCESS_TOKEN`) — the
agent never sees it and never calls Attio directly. When the
broker's token is unset, the route returns `503 attio integration
disabled`; the agent should treat this as a blocker and stop.

See `services/approval-broker/attio.mjs` for the orchestrator and
`config/paperclip/skills/octosync-coordination-rules/references/attio-crm.md`
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
