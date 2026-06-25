# Attio CRM integration

Attio is OctoSync's CRM. The approval-broker writes decided
prospects (approved + rejected both) into Attio so the CRM becomes
the source of truth for prospect lifecycle. Paperclip hands off
ownership at decision time; downstream workflows (outreach drafter,
follow-up sequences) read Attio rather than re-querying Paperclip.

The CSO **never** calls Attio directly. All Attio traffic goes
through the broker's `/attio/sync-decision` endpoint, invoked via
the `attio-sync.mjs` thin client in the `octosync-emails` skill.

## Objects we touch

Two standard Attio objects, plus broker-managed custom attributes:

### Companies (`companies`)

Standard attributes used:
- `domains` (multi-value) — **matching attribute for upserts**
- `name`

Custom attributes (Paperclip-managed; one-time provision in Attio UI):
- `paperclip_opportunity_id` — Text. Opportunity id from the weekly
  prospecting payload.
- `paperclip_last_decision_at` — Timestamp. Updated on every sync,
  so the latest decision overwrites older ones.

### People (`people`)

Standard attributes used:
- `email_addresses` (multi-value) — **matching attribute for upserts**
- `phone_numbers` (multi-value) — the prospect's business/direct line,
  required by the prospecting flow. Standard Attio attribute; **no
  workspace provisioning needed** (unlike the `paperclip_*` customs).
- `name`
- `job_title`
- `company` — record reference back to the Company, set as
  `{target_object: "companies", target_record_id: <id>}`

Custom attributes (Paperclip-managed; one-time provision in Attio UI):
- `paperclip_decision` — Select. Options: `approved`, `rejected`.
- `paperclip_decided_at` — Timestamp.
- `paperclip_approval_id` — Text. The Paperclip approval id that
  produced this decision.
- `paperclip_opportunity_id` — Text. Same id as on the Company.
- `is_generic_inbox` — Checkbox. True when the prospect record is a
  role-based inbox (info@, contact@) used as a fallback rather than an
  individual. The prospecting flow now requires a phone but still allows
  a flagged generic inbox when no named work email is found.

## Upsert semantics

The broker uses Attio's `matching_attribute` query param to pick
"match-or-create" by a specific attribute:
- Companies match on `domains`. If a company record already has the
  prospect's domain in its `domains` array, the broker updates that
  record; otherwise it creates a new one.
- People match on `email_addresses`. Same logic — match by email,
  update if present, create if not.

Emails and domains are lowercased before being sent to Attio so
matching is stable across casings.

## Idempotency

The broker writes a sentinel audit comment on the parent issue on
success:

```
Attio sync recorded approval=<approvalId> company=<companyRecordId> person=<personRecordId> decision=<approved|rejected>
```

On every sync the broker scans the parent's comments first. If that
line is present for the current `approvalId`, the broker returns the
cached ids and skips both upserts. This makes re-running the CSO
heartbeat on the same parent free — no duplicate Attio writes, no
duplicate audit comments.

## When the broker fails

The broker returns `400` with `BLOCKER: <reason>` on:
- Invalid input (missing fields, bad decision value, etc).
- Attio 4xx (most commonly: attribute slug not provisioned in the
  Attio workspace — fix the workspace per the runbook above, do
  **not** invent new attribute names in the broker).
- Attio returned a record without `id.record_id` (schema mismatch).

The broker returns `503` with `attio integration disabled` when
`ATTIO_ACCESS_TOKEN` is unset in the broker's env. This usually
means the secrets bundle wasn't updated before the broker restarted.

The CSO's reaction on any non-zero exit from the thin client is to
post `Attio sync blocked: <reason>` on the parent and **stop**. Do
not attempt to patch parent → done while any prospect is unsynced;
re-running the heartbeat will pick up where the previous run left
off thanks to the audit-comment idempotency anchor.

## What the CSO never does

- Calls Attio's REST API directly. The broker holds the API key.
- Invents new Attio attribute slugs to paper over a 4xx. The schema
  is fixed; fix the workspace.
- Writes to Attio for any approval that is still pending. Only
  decided approvals (approved or rejected) sync.

## See also

- `services/approval-broker/attio.mjs` — orchestrator (validation,
  idempotency, upsert sequencing, audit comment).
- `services/approval-broker/attio-client.mjs` — REST wrapper.
- `companies/octosync/skills/octosync-emails/scripts/attio-sync.mjs` —
  thin client the CSO invokes.
