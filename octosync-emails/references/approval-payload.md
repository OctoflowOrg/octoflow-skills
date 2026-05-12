# Approval payload shapes per workflow

The Paperclip approval's `payload` field is workflow-specific. Each
workflow defines its own `type` discriminator and the fields the
orchestrator wakes on need to make decisions.

## LinkedIn — `approve_ceo_strategy`

Created by `linkedin-finalize-batch.mjs` once per option in the
review batch (cap: 2 options). Single-select: the first approval to
flip `approved` wins; subsequent approvals on the same parent are
stale.

```json
{
  "type": "approve_ceo_strategy",
  "optionId": "option1",
  "optionTitle": "Option 1: <short title>",
  "optionTextHash": "<sha256 of post text>",
  "reviewIssueId": "<parent issue id>",
  "selectionMode": "single_select"
}
```

When approved: CMO wakes on `approval_approved`, picks the winning
option, creates the Buffer Scheduler publisher child.

## Opportunity — `approve_opportunity_pursuit`

Created by `opportunity-digest.mjs` once per ranked opportunity in
the digest (typically 3–5 per weekly run, per the Researcher's
Output format). **Multi-select**: each approval is independent. A
user can approve any subset (1, all, none). No "first wins"
semantics — every approval the user clicks Approve on becomes a
pursued opportunity.

```json
{
  "type": "approve_opportunity_pursuit",
  "opportunityId": "<rank>-<slug>",
  "opportunityName": "<canonical name>",
  "targetBuyer": "<role>",
  "workflow": "<operational category — recruiting / sales-admin / ...>",
  "rationale": "<one-line why now>",
  "sourceDigestIssueId": "<parent issue id>",
  "selectionMode": "multi_select"
}
```

When approved: CSO wakes on `approval_approved`, records the
approved opportunity (via comment on parent), and prepares the
outreach trigger for the next-branch outreach flow.

When rejected: CSO wakes on `approval_rejected`, records that the
opportunity was explicitly skipped this week.

## Idempotency keys

(See `octosync-coordination-rules/references/idempotency-keys.md`
for the full list.)

- LinkedIn approval idempotency: built inside
  `linkedin-finalize-batch.mjs`; agents don't author the key
  directly.
- Opportunity approval idempotency:
  `opportunity-pursuit:<parentIssueId>:<opportunityId>` — built by
  `opportunity-digest.mjs`.

## Future workflows

When adding a new workflow with approval emails, follow the same
pattern:

1. Define a new `type` discriminator (e.g.
   `approve_outreach_message`).
2. Pick `single_select` vs `multi_select` semantics.
3. Document the `payload` shape here.
4. Add a new orchestrator script in `octosync-emails/scripts/` that
   creates the approvals and calls the shared
   `render-approval-email.mjs`.

The sidecar doesn't care about the `type` — it just hits Paperclip's
approve/reject endpoint. The orchestrator's `payload` is the
canonical record of intent.
