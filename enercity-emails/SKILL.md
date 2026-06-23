---
name: enercity-emails
description: >
  Load when the EnerCity Collaborative CMA needs to send the LinkedIn
  review approval email. Ships one thin POST client (send-approval.mjs)
  that calls the shared approval-broker; the broker owns approval
  creation, HTML rendering, Resend send, the audit comment, and the
  parent → in_review patch. Used by the CMA at LinkedIn step 7.
---

# EnerCity Collaborative approval emails — thin-client skill

The agent-side surface for EnerCity's review-email flow. All heavy
lifting (approval creation, email rendering, Resend, audit comments,
parent.status transitions) lives in the shared `approval-broker` sidecar
at `services/approval-broker/` — the same broker that serves OctoSync,
keyed per request by `companyId` + `outboundEmail` + `recipientList`.
This skill ships exactly one script — an HTTP client.

EnerCity's workflow is review-only: there is no publisher, so this skill
does **not** ship `compute-schedule.mjs` (Buffer scheduling) or
`attio-sync.mjs` (prospecting CRM sync). Only the LinkedIn review email
path exists.

## Scripts

- `scripts/send-approval.mjs` — workflow-agnostic thin POST client.
  Reads the agent's payload JSON, POSTs it to
  `${EMAIL_APPROVAL_PUBLIC_URL}/send` with bearer auth, prints the
  broker's response. ~50 lines.

## Invocation

```sh
: "${ENERCITY_SKILLS_RUNTIME:?ENERCITY_SKILLS_RUNTIME not set; \
  enercity-emails skill not provisioned for this agent — \
  ask operator to set adapterConfig.env.ENERCITY_SKILLS_RUNTIME}"
CLIENT=$(ls "$ENERCITY_SKILLS_RUNTIME"/enercity-emails--*/scripts/send-approval.mjs \
  2>/dev/null | head -1)
: "${CLIENT:?send-approval.mjs not present in enercity-emails skill runtime}"
node "$CLIENT" \
  --workflow linkedin \
  --parent-id "<parentIssueId>" \
  --agent-id "$PAPERCLIP_AGENT_ID" \
  --payload /tmp/review-package.json
```

Path-flag values are plain filesystem paths — **no `@` prefix**.

`ENERCITY_SKILLS_RUNTIME` is the company-scoped skill runtime root (e.g.
`/paperclip/instances/default/skills/<companyId>/__runtime__`) that the
Paperclip operator sets in the CMA's adapterConfig.env at agent
registration time. The two `:?` guards above produce one-line, named
blockers: env-var-unset (agent misconfigured) vs script-not-present
(skill not mirrored or scripts missing). Don't fall back to
`find / -name` — it walks the whole filesystem, returns empty for opaque
reasons, and triggers same-blocker retry storms.

## Exit semantics

`0` on success (broker created approvals, sent email, posted audit
comment on parent, patched parent → `in_review`). Non-zero on a blocker;
client prints `BLOCKER: <reason>` to stderr (and stdout) with the
broker's error text. The CMA posts a short blocker comment on the parent
and stops.

## Required env (on the CMA's container)

- `EMAIL_APPROVAL_PUBLIC_URL` — broker public base URL, e.g.
  `https://agents.octosync.dev/approvals` (the shared broker)
- `EMAIL_APPROVAL_INTERNAL_TOKEN` — bearer token shared with the broker
- `PAPERCLIP_COMPANY_ID` — passed through to the broker
- `ENERCITY_OUTBOUND_EMAIL` — From: + Reply-To: for the review email
  (reuses OctoSync's verified Resend sender; review emails are internal)
- `WORKFLOW_EMAIL_TO` — review-email recipient(s) — the EnerCity contact
  who validates the posts. Single address or JSON-array string. The
  broker reads whichever value the agent passes in the request body.

**Not** needed on the agent (server-side, broker only):
`RESEND_API_KEY`, `EMAIL_APPROVAL_SIGNING_KEY`. Removing these from the
agent's Paperclip-UI env is defense in depth.

## Approval shape

The broker constructs the approval payloads at `/approvals/send` time;
agents do not POST to `/api/companies/{id}/approvals` directly. The
broker enforces this with a schema guard — if pre-existing approvals for
the current emailRef are found with a non-broker payload shape, the
broker refuses the request and lists the offending ids. The agent must
post the blocker text verbatim and stop; a human cleans up before the
next run.

The LinkedIn email renders radio buttons (single_select). Submitting with
no selection = skip (all options rejected on confirm). See
`services/approval-broker/workflows/linkedin.mjs` for the source of truth
on the approval shape and schema-guard rules.

## Email + decide flow

The email renders a single `<form method="GET"
action=".../approvals/stage">` wrapping the options. The GET submission
goes to the broker's same-origin staging page, which displays the
selection in full detail and lets the user confirm via a same-origin
`<form method="POST" action="/approvals/receive">`. This avoids Gmail's
"submitting to an external page" warning that fires on cross-origin POSTs
from email clients.

## Broker internals (source of truth)

This skill ships no reference docs — the email rendering, approval
payload shapes, card layout, and sidecar protocol all live broker-side
and the CMA never needs them (it just calls `send-approval.mjs`). If you
need those details, read the shared broker directly:

- `services/approval-broker/workflows/linkedin.mjs` — LinkedIn approval
  + email payload shape and the schema guard.
- `services/approval-broker/email-render.mjs` — email rendering,
  including the per-company brand map (logo + help-email).
- `services/approval-broker/index.mjs` — the `/approvals/*` routes.

Email branding note: the company **name + logo + help-email** are
per-company (EnerCity's logo is wired via the broker brand map). The
email's **color palette** is still the shared broker palette (currently
OctoSync's teal/orange) — not yet per-company. Acceptable for an
internal review email; revisit if EnerCity wants its own palette.
