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

## Opportunity prospecting — `approve_prospect_outreach`

Created by `prospecting-approval-send.mjs` once per researched
prospect (typically 3–4 prospects across 3–5 opportunities per
weekly run). **Multi-select**: each approval is independent. The
user submits a single form whose checkboxes map 1-to-1 onto these
approvals. Checked → approved, unchecked → rejected.

**Top-level `type` is `request_board_approval`** (the only generic
value in Paperclip's `APPROVAL_TYPES` whitelist that fits — using
our own `approve_prospect_outreach` here causes the create call to
return HTTP 400). The internal discriminator lives at
`payload.type` so the CSO's wake handler and sidecar `/decide`
endpoint route correctly:

```json
{
  "type": "request_board_approval",
  "requestedByAgentId": "<cso-agent-id>",
  "issueIds": ["<parent issue id>"],
  "payload": {
    "type": "approve_prospect_outreach",
    "emailRef": "prospecting-approval:<parentIssueId>",
    "opportunityId": "<rank>-<slug>",
    "opportunityName": "<canonical company name>",
    "prospect": {
      "name": "<person name or null>",
      "role": "<role or generic-inbox label>",
      "email": "<contact email>",
      "isGenericInbox": false
    },
    "rationale": "<one-line why this prospect — derived from the opportunity's whyNow>",
    "sourceDigestIssueId": "<parent issue id>",
    "selectionMode": "multi_select"
  }
}
```

`emailRef` is the trunk that ties every approval in one weekly email
together. The sidecar's `/decide` endpoint walks the tree by querying
all approvals where `payload.emailRef` matches the token's signed
emailRef. Resend's own emailId is recorded on the parent issue's
"Weekly prospecting approval sent" comment (`resend=<uuid>`) for
cross-system trace into Resend logs and webhooks.

When approved: CSO wakes on `approval_approved`, records the
approved prospect (via comment on parent), and the next-branch
outreach flow drafts a cold outreach email for that prospect.

When rejected: CSO wakes on `approval_rejected`, records that the
prospect was explicitly skipped this week.

## Idempotency keys

(See `octosync-coordination-rules/references/idempotency-keys.md`
for the full list.)

- LinkedIn approval idempotency: built inside
  `linkedin-finalize-batch.mjs`; agents don't author the key
  directly.
- Prospecting approval idempotency: keyed on `(parentId,
  opportunityId, prospectEmail)` — `prospecting-approval-send.mjs`
  matches against existing approvals before creating new ones.

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
