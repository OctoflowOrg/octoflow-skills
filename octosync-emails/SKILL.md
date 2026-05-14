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
- `scripts/prospecting-approval-send.mjs` — CSO uses this to create
  one Paperclip approval per researched prospect, send the weekly
  prospecting approval email (one checkbox-form covering every
  prospect across every opportunity), then patch parent → `in_review`
  to wait for human decisions.

Both orchestrators compose on top of shared scripts in the same skill:

- `scripts/render-approval-email.mjs` — normalizes the payload, signs
  approve/reject URLs (single-action LinkedIn) or the email token
  (prospecting checkbox form),
  generates the text/plain alt, and POSTs to Resend. HTML generation
  is delegated to the React Email bundle at `templates/dist/render.mjs`
  (see "Email templates" below).
- `scripts/sign-approval-link.mjs` — HMAC-SHA256 token signer for the
  single-action `${baseUrl}/confirm?token=...` URLs used by the
  LinkedIn review email.
- `scripts/sign-batch-link.mjs` — HMAC-SHA256 token signer for the
  prospecting form. Signs `{emailRef, companyId, expiresAt}`. The
  signed `emailRef` is the trunk: the sidecar's `/decide` endpoint
  asks Paperclip for every approval whose `payload.emailRef` matches,
  and that authoritative list is what gets approved/rejected. The
  form's submitted approval IDs only filter that list — any id not
  found in Paperclip is ignored.

## Email templates

The brand shell + per-card layout lives in `templates/src/*.tsx` and
is rendered via `@react-email/components`. esbuild bundles the
templates to `templates/dist/render.mjs`, which the JS renderer
imports at runtime.

`templates/dist/` is **gitignored**. The mirror workflow
(`.github/workflows/mirror-skills.yml`) runs `npm install && npm run
build` before rsyncing skills to `octoflow-skills`, so production
always ships a fresh bundle. For local development:

```sh
cd config/paperclip/skills/octosync-emails/templates
npm install
npm run build
```

After editing any `templates/src/*.tsx` file, rebuild to refresh
`dist/render.mjs`. Smoke-test with `node scripts/smoke.mjs` from the
templates directory.

For visual iteration without rebuilding, run the React Email dev
server with hot reload:

```sh
npm run dev          # http://localhost:3001
```

Sample payloads live in `templates/previews/*.tsx` — each exports a
default component that renders an `ApprovalEmail` with realistic
data. Edit either the previews (to change sample data) or the
components in `src/` (to change layout) and the browser refreshes.

External dependency: the upstream `resend` skill
(`https://skills.sh/resend/resend-skills/resend`) for Resend's API
patterns. Both orchestrators read `RESEND_API_KEY` directly via the
renderer; agents do not call Resend API endpoints from the prompt.

## When to invoke which script

The agent prompt names which script to invoke. CMO invokes
`linkedin-finalize-batch.mjs` from step 7 of its LinkedIn procedure.
CSO invokes `prospecting-approval-send.mjs` from step 12 of its
weekly opportunity procedure. Neither agent invokes the shared
scripts directly — the orchestrators spawn them internally.

## Invocation pattern

The agent passes a JSON payload **file path** on the command line; the
orchestrator script reads, validates, and runs to completion.

Skill mount paths are adapter-dependent — `claude_local` materialises
under `~/.claude/skills/octosync-emails--<hash>/`, `codex_local` uses a
global skills directory. Discover the helper dynamically rather than
hard-coding either:

```sh
# CMO — LinkedIn finalize-batch:
HELPER=$(find / -name linkedin-finalize-batch.mjs \
  -path "*octosync-emails*" 2>/dev/null | head -1)
node "$HELPER" \
  --parent-id "<parentIssueId>" \
  --cmo-agent-id "$PAPERCLIP_AGENT_ID" \
  --review-package /tmp/review-package.json

# CSO — weekly prospecting approval:
HELPER=$(find / -name prospecting-approval-send.mjs \
  -path "*octosync-emails*" 2>/dev/null | head -1)
node "$HELPER" \
  --parent-id "<parentIssueId>" \
  --cso-agent-id "$PAPERCLIP_AGENT_ID" \
  --prospecting /tmp/prospecting-payload.json
```

Path-flag values are plain filesystem paths — **no `@` prefix**. (The
scripts will tolerate a leading `@` if one slips in, but the canonical
form omits it.)

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
- `PAPERCLIP_OUTBOUND_EMAIL` — single canonical From: and Reply-To: for
  every workflow email (LinkedIn review + prospecting approval). Domain
  must be verified in Resend.
- `LINKEDIN_REVIEW_EMAIL_TO` — CMO review-email recipient(s).
- `WORKFLOW_EMAIL_TO` — CSO prospecting-email recipient(s).
- `PAPERCLIP_PUBLIC_URL` / `PAPERCLIP_COMPANY_ROUTE_KEY` — used to
  derive `parentIssueUrl` if not provided explicitly.

If `EMAIL_APPROVAL_SIGNING_KEY` or `EMAIL_APPROVAL_PUBLIC_URL` is
unset for the LinkedIn review email, the renderer omits buttons and
sends a notification-only copy (the prior behavior). The prospecting
flow requires both — `prospecting-approval-send.mjs` blockers with a
clear error if either is missing.

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
  `approve_ceo_strategy` / single-select, prospecting
  `approve_prospect_outreach` / multi-select).
