# Idempotency keys

Construct idempotency keys deterministically. Two runs with the same
inputs MUST produce the same key. Do not include timestamps, run ids,
or random suffixes.

## Approval keys

- **LinkedIn publisher payload** (Buffer Scheduler triggers a Buffer
  post for one approved option):
  `<parentIssueId>:<optionId>:<approvalId>`
- **LinkedIn review approvals** (one per option in the review batch,
  created by `linkedin-finalize-batch.mjs`):
  Constructed inside the helper. Agents do not author these directly.
- **Opportunity-pursuit approvals** (one per ranked opportunity in
  the weekly digest, created by `opportunity-digest.mjs`):
  `opportunity-pursuit:<parentIssueId>:<opportunityId>`

## Email send keys

Idempotency keys passed to the Resend API to prevent duplicate sends
on retry. Resend honors these for 24 hours.

- **LinkedIn review email**: `linkedin-review:<parentIssueId>`
- **Weekly opportunity digest email**:
  `opportunity-digest:<parentIssueId>`

## Comment idempotency

Paperclip's approval-creation endpoint accepts an `idempotencyKey`
field; reuse it across retries. For comments, Paperclip does not
expose a key — agents must check the issue's comment thread for a
prior matching comment before posting, and skip if found (per
"failure escalation: leave at most one short blocker comment per
distinct failure").

## Why this matters

Workflows retry on flaky API responses, on heartbeat re-spawns, and
on recovery wakes. Without deterministic keys, retries create
duplicate approvals, duplicate emails, and duplicate comments — all
of which break the workflow's audit-trail invariants and confuse
human reviewers.
