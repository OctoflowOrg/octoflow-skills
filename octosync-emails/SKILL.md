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

This skill is the **agent-side surface** of the OctoSync approval-email
flow. The heavy lifting moved to the `approval-broker` sidecar
(`services/approval-broker/`); the skill now ships a thin client
plus the still-agent-owned LinkedIn helper. Two scripts are
agent-invoked:

- `scripts/send-approval.mjs` — workflow-agnostic thin client. POSTs
  the payload to the approval-broker's `POST /approvals/send`
  endpoint and prints the broker's response. Used by the CSO at
  step 12 of the weekly opportunity procedure for the prospecting
  flow. The broker creates the approvals, renders+sends the email
  via Resend, posts the audit comment, and patches parent →
  `in_review` — none of that runs inside the agent's container
  anymore.
- `scripts/linkedin-finalize-batch.mjs` — CMO uses this for the
  LinkedIn review flow. **Still runs the legacy in-container
  pattern** (creates approvals, sends email, patches `in_review`).
  Will be replaced with a `send-approval.mjs --workflow linkedin`
  invocation in a follow-up PR once the broker's
  `workflows/linkedin.mjs` lands.

Shared support scripts kept in the skill for the surviving LinkedIn
helper:

- `scripts/render-approval-email.mjs` — normalises the payload, signs
  approve/reject URLs (single-action LinkedIn buttons) or the email
  token (prospecting checkbox form), generates the text/plain alt,
  and POSTs to Resend. The broker has its own copy at
  `services/approval-broker/email-render.mjs` so prospecting no
  longer needs the skill copy at runtime.
- `scripts/sign-approval-link.mjs` — HMAC-SHA256 token signer for the
  single-action `${baseUrl}/confirm?token=...` URLs used by the
  LinkedIn review email.
- `scripts/sign-batch-link.mjs` — HMAC-SHA256 token signer for the
  prospecting form. Kept for parity with the broker's
  `services/approval-broker/token.mjs`; not used by `send-approval.mjs`
  (the broker signs prospecting tokens itself now).

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
`linkedin-finalize-batch.mjs` from step 7 of its LinkedIn procedure
(legacy in-container path until the broker's LinkedIn workflow
lands). CSO invokes `send-approval.mjs` from step 12 of its weekly
opportunity procedure (broker-owned path).

## Invocation pattern

The agent passes a JSON payload **file path** on the command line.
For the thin client (`send-approval.mjs`), the agent additionally
passes `--workflow <name>` so the broker can route to the right
workflow handler.

Skill mount paths are adapter-dependent — `claude_local` materialises
under `~/.claude/skills/octosync-emails--<hash>/`, `codex_local` uses a
global skills directory. Discover the script dynamically rather than
hard-coding either:

```sh
# CMO — LinkedIn finalize-batch (still legacy in-container path):
HELPER=$(find / -name linkedin-finalize-batch.mjs \
  -path "*octosync-emails*" 2>/dev/null | head -1)
node "$HELPER" \
  --parent-id "<parentIssueId>" \
  --cmo-agent-id "$PAPERCLIP_AGENT_ID" \
  --review-package /tmp/review-package.json

# CSO — weekly prospecting approval (broker-owned):
CLIENT=$(find / -name send-approval.mjs \
  -path "*octosync-emails*" 2>/dev/null | head -1)
node "$CLIENT" \
  --workflow prospecting \
  --parent-id "<parentIssueId>" \
  --agent-id "$PAPERCLIP_AGENT_ID" \
  --payload /tmp/prospecting-payload.json
```

Path-flag values are plain filesystem paths — **no `@` prefix**. (The
scripts will tolerate a leading `@` if one slips in, but the canonical
form omits it.)

## Exit semantics

Both `linkedin-finalize-batch.mjs` and `send-approval.mjs` exit `0`
on success and non-zero on a blocker. On non-zero exit, they print
`BLOCKER: <reason>` to stderr (and `send-approval.mjs` echoes the
broker's error text). The calling agent posts a short blocker
comment on the parent (per `octosync-coordination-rules`).

## Required env vars

Different for the two scripts now that the broker owns the
prospecting outbound:

**`send-approval.mjs` (CSO, prospecting):**
- `EMAIL_APPROVAL_PUBLIC_URL` — broker's public base URL, e.g.
  `https://agents.octosync.dev/approvals`.
- `EMAIL_APPROVAL_INTERNAL_TOKEN` — shared bearer token for the
  broker's `POST /approvals/send` endpoint.
- `PAPERCLIP_COMPANY_ID` — passed through to the broker.
- `PAPERCLIP_OUTBOUND_EMAIL` — From: + Reply-To: for the outbound
  email. Per-agent (multi-tenant deployments use different
  verified domains per company).
- `WORKFLOW_EMAIL_TO` — recipient list for the prospecting form.
  Per-agent (who reviews differs by workflow and tenant).

**`linkedin-finalize-batch.mjs` (CMO, LinkedIn — legacy path):**
- `RESEND_API_KEY`
- `EMAIL_APPROVAL_SIGNING_KEY`
- `EMAIL_APPROVAL_PUBLIC_URL`
- `PAPERCLIP_OUTBOUND_EMAIL`
- `LINKEDIN_REVIEW_EMAIL_TO`
- `PAPERCLIP_PUBLIC_URL` / `PAPERCLIP_COMPANY_ROUTE_KEY` (optional,
  for `parentIssueUrl` derivation)
- `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`

These will collapse to the same `send-approval.mjs` env set once the
LinkedIn workflow ships in the broker.

## References

For niche detail loaded on demand:

- `references/brand-shell.md` — the unified OctoSync header/palette/
  footer used by both emails. Single source of truth for brand colors
  and the compact 64px header layout.
- `references/approval-button-card.md` — per-card layout (id chip,
  title, body, rationale, sources, Approve/Reject buttons). Same
  layout for both workflows.
- `references/sidecar-protocol.md` — the `/approvals/confirm` and
  `/approvals/act` contract the LinkedIn buttons hit. (Legacy
  `/email-approval/*` paths are kept aliased for one release.) Token
  shape, HMAC algorithm, TTL.
- `references/approval-payload.md` — what goes into a Paperclip
  approval's `payload` field per workflow (LinkedIn
  `approve_ceo_strategy` / single-select, prospecting
  `approve_prospect_outreach` / multi-select).
