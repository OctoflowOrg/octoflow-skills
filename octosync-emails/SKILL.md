---
name: octosync-emails
description: >
  Load when authoring or sending OctoSync workflow emails that include
  HMAC-signed Approve/Reject buttons backed by Paperclip approvals.
  Covers both the LinkedIn review email (CMO) and the Weekly
  Opportunity Digest (CSO). Wraps the external `resend` skill with
  OctoSync brand shell, HMAC button signing, and the email-approvals
  sidecar protocol. Required by the CMO during the LinkedIn finalize-
  batch step and by the CSO during the weekly opportunity digest send.
---

# OctoSync approval emails

This skill packages the shared email-rendering and HMAC-signing logic
that backs every workflow email with Approve/Reject buttons. Two
workflow-specific orchestrator scripts ship inside this skill:

- `scripts/linkedin-finalize-batch.mjs` — CMO uses this to create per-
  option approvals, send the review email, post audit-trail comments
  on the parent, and patch parent → `in_review`. Same atomic helper
  the CMO procedure has always invoked at step 7; now lives here.
- `scripts/opportunity-digest.mjs` — CSO uses this to create one
  Paperclip approval per ranked opportunity, send the weekly digest
  email with one Approve/Reject card per opportunity, then patch
  parent → `in_review` to wait for human decisions.

Both orchestrators compose on top of two shared scripts in the same
skill:

- `scripts/render-approval-email.mjs` — renders the unified OctoSync
  brand shell, the per-card approval layout, and POSTs to Resend.
- `scripts/sign-approval-link.mjs` — HMAC-SHA256 token signer that
  produces the `${baseUrl}/confirm?token=...` URLs the email-approvals
  sidecar verifies.

External dependency: the upstream `resend` skill
(`https://skills.sh/resend/resend-skills/resend`) for Resend's API
patterns. Both orchestrators read `RESEND_API_KEY` directly via the
renderer; agents do not call Resend API endpoints from the prompt.

## When to invoke which script

The agent prompt names which script to invoke. CMO invokes
`linkedin-finalize-batch.mjs` from step 7 of its LinkedIn procedure.
CSO invokes `opportunity-digest.mjs` from step 12 of its weekly
opportunity procedure. Neither agent invokes the shared scripts
directly — the orchestrators spawn them internally.

## Invocation pattern

The agent passes a JSON payload path on the command line; the
orchestrator script reads, validates, and runs to completion.

```sh
INSTRUCTIONS_DIR="$PAPERCLIP_HOME/instances/$PAPERCLIP_INSTANCE_ID/companies/$PAPERCLIP_COMPANY_ID/agents/$PAPERCLIP_AGENT_ID/instructions"
# CMO:
node "$INSTRUCTIONS_DIR/octosync-emails/scripts/linkedin-finalize-batch.mjs" \
  --parent-id "<parentIssueId>" \
  --cmo-agent-id "$PAPERCLIP_AGENT_ID" \
  --review-package @review-package.json
# CSO:
node "$INSTRUCTIONS_DIR/octosync-emails/scripts/opportunity-digest.mjs" \
  --parent-id "<parentIssueId>" \
  --cso-agent-id "$PAPERCLIP_AGENT_ID" \
  --digest @digest-payload.json
```

The exact mount path depends on the adapter. The convention above
matches what `claude_local` exposes today; if it changes, update this
section.

## Exit semantics

Both orchestrators exit `0` on success and non-zero on a blocker. On
non-zero exit, the orchestrator prints `BLOCKER: <reason>` to stderr
and the calling agent posts a short blocker comment on the parent
(per `octosync-coordination-rules`).

## Required env vars (set on CMO and CSO)

- `RESEND_API_KEY` — Resend API key (via the upstream `resend` skill's
  convention)
- `EMAIL_APPROVAL_SIGNING_KEY` — shared HMAC secret. Same secret the
  email-approvals sidecar uses to verify tokens.
- `EMAIL_APPROVAL_PUBLIC_URL` — sidecar's public base URL (e.g.
  `https://agents.octosync.dev/email-approval`).
- `LINKEDIN_REVIEW_EMAIL_FROM` / `LINKEDIN_REVIEW_EMAIL_TO` /
  `LINKEDIN_REVIEW_EMAIL_REPLY_TO` (or `WORKFLOW_EMAIL_*` fallbacks) —
  CMO sender/recipient routing.
- `WORKFLOW_EMAIL_FROM` / `WORKFLOW_EMAIL_TO` /
  `WORKFLOW_EMAIL_REPLY_TO` — CSO sender/recipient routing.
- `PAPERCLIP_PUBLIC_URL` / `PAPERCLIP_COMPANY_ROUTE_KEY` — used to
  derive `parentIssueUrl` if not provided explicitly.

If `EMAIL_APPROVAL_SIGNING_KEY` or `EMAIL_APPROVAL_PUBLIC_URL` is
unset, the renderer omits buttons and sends a notification-only
email (the prior behavior).

## References

For niche detail loaded on demand:

- `references/brand-shell.md` — the unified OctoSync header/palette/
  footer used by both emails. Single source of truth for brand colors
  and the compact 64px header layout.
- `references/approval-button-card.md` — per-card layout (id chip,
  title, body, rationale, sources, Approve/Reject buttons). Same
  layout for both workflows.
- `references/sidecar-protocol.md` — the `/email-approval/confirm`
  and `/email-approval/action` contract the buttons hit. Token shape,
  HMAC algorithm, TTL.
- `references/approval-payload.md` — what goes into a Paperclip
  approval's `payload` field per workflow (LinkedIn
  `approve_ceo_strategy` / single-select, opportunity
  `approve_opportunity_pursuit` / multi-select).
