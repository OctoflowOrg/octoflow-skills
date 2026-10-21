---
name: octosync-enrichment
description: >
  Load when an OctoSync agent needs verified contact data for a target
  company — a business phone and a named work email. Calls the
  approval-broker's /enrich/contact endpoint over HTTP; the broker holds
  the provider keys and does the lookups, and also answers whether the
  company is already in the CRM. Used by any agent gating prospects into
  Outbound-ready vs Needs verification vs Contact gap.
---

# OctoSync contact enrichment — broker HTTP contract

The agent-side surface for resolving contact details from **licensed
sources and the company's own published pages**, instead of guessing them
from search results. Requiring a business phone and preferring a named
work email is the point; this skill is the only sanctioned source of that
data.

Heavy lifting and the secrets live in the **approval-broker** sidecar
(`services/approval-broker/`). The broker resolves a phone from a
waterfall and an email from a licensed provider, and answers the CRM
dedup question on the same call.

**Agents reach the broker over HTTP. Never look for a script.** The
`.mjs` file under `scripts/` is the reference implementation of this
request, kept for readability — it is NOT runnable from an agent run
(see "There is no script to locate" below).

**No provider key ever reaches the agent.** They live in the broker's
secrets bundle. The agent carries only the broker bearer token, the same
trust model as the `octosync-emails` endpoints.

## Endpoint

`POST /enrich/contact` — resolve one company's phone, published email and
CRM status. One call per candidate company. (Was `enrich-contact.mjs`.)

```http
POST {EMAIL_APPROVAL_PUBLIC_URL}/enrich/contact
Authorization: Bearer {EMAIL_APPROVAL_INTERNAL_TOKEN}
Content-Type: application/json

{
  "companyName": "Acme Logistics",
  "region": "Oregon",
  "domain": "acme.com",
  "personName": "Jane Doe"
}
```

| Field | Required | Purpose |
|-------|----------|---------|
| `companyName` | yes | Search subject |
| `region` | no | Biases the lookup (pass `"Oregon"`) |
| `domain` | no | Email-lookup domain; derived from the resolved website when omitted. **Pass it when you know it** — it is also what lets CRM dedup match on domain rather than falling back to a weaker name match. |
| `personName` | no | When set, the email finder targets that person |

**There is no script to locate.** Skill script mounts are not reachable
from an agent run — `local_path` skills are never materialized into
`$OCTOSYNC_SKILLS_RUNTIME` (that directory holds only github/skills_sh
skills), and searching with `find / -name` is forbidden (the OCT-409
retry-storm pattern). The HTTP endpoint above IS the interface; the
`.mjs` file in this skill is kept only as the reference implementation of
that request.

## Env (agent side)

| Var | Required | Description |
|-----|----------|-------------|
| `EMAIL_APPROVAL_PUBLIC_URL` | yes | Broker base URL; `/enrich/contact` is hit on the same host |
| `EMAIL_APPROVAL_INTERNAL_TOKEN` | yes | Bearer token shared with the broker |

`OCTOSYNC_SKILLS_RUNTIME` is **not** needed by this skill any more — it
was only there to locate the script.

The provider keys are **broker env, not agent env**. Each provider degrades independently
broker-side: if a key is unset or a provider errors, that provider's
fields come back `null` with a note in `notes` and the field listed in
`missing`, and the call still returns `200`. This lets you bring
enrichment up incrementally (e.g. Places-only first) and lets the agent
route a company to `Contact gap` rather than failing. A malformed call
(missing `companyName`) returns a non-2xx with a blocker message — quote
it verbatim in your `@`-blocker rather than paraphrasing.

## Output (stdout, JSON — the broker's response)

```json
{
  "companyName": "Acme Logistics",
  "region": "Oregon",
  "phone": "+1 503-555-0142",
  "phoneSource": "google_places",
  "website": "https://acme.com",
  "domain": "acme.com",
  "email": "jane.doe@acme.com",
  "emailType": "personal",
  "emailDeliverable": "valid",
  "emailConfidence": 94,
  "name": "Jane Doe",
  "role": "Head of Operations",
  "alreadyInCrm": false,
  "crmChecked": true,
  "crmRecordId": null,
  "sources": ["google_places:searchText", "hunter:email-finder"],
  "missing": [],
  "notes": []
}
```

### `phoneSource` — always report it

The phone comes from a waterfall, and `phoneSource` names which step
answered:

| Value | Meaning |
|-------|---------|
| `google_places` | The licensed listing. Strongest. |
| `company_website` | The number the company publishes on its own contact page. Also acceptable — it is their own published main line. |
| `null` | No phone resolved. The company is a **Contact gap**. |

Places is an **enhancement, not a requirement**: when its key is unset
or the provider fails, the waterfall falls through to the company's own
site and the call still succeeds. A phone found by *the agent's own* web
research has no `phoneSource` and is **not** an acceptable substitute —
carrying one into a handoff as if it were verified is the error, however
plausible the number.

### `crmChecked` — "not in the CRM" vs "never checked"

`alreadyInCrm: false` on its own is **not** a clear CRM check. Read it
together with `crmChecked`:

| `crmChecked` | `alreadyInCrm` | Means |
|---|---|---|
| `true` | `false` | Verified: the company is not in Attio. Safe to pursue. |
| `true` | `true` | Already in the pipeline. **Drop the company.** |
| `false` | `false` | **Unknown** — Attio was never queried. Not safe to treat as new. |

When `crmChecked` is `false`, `crm_check` also appears in `missing`.
Call this endpoint for every company you intend to list — never carry a
phone forward from prior context. Skipping the call skips this check.

**`alreadyInCrm` is not the whole duplicate story.** It only goes `true`
once an approval was decided and synced to the CRM. A company that was
already **sent to a client** and then rejected, or left undecided, is
absent from the CRM yet must still never be sent again — re-sending
either clutters the client's CRM with duplicates or spends a digest slot
on something they have already seen.

That second exclusion lives in the orchestrator's prior-prospecting
context, not in this skill's response: this endpoint answers "is it in
the CRM", not "have we sent it". A consuming agent must check both, and
drop on either.

### Bucketing

- `phone` present (with a `phoneSource`) + `crmChecked: true` +
  `alreadyInCrm: false` + **not previously sent** (the orchestrator's
  prior-prospecting context, which this skill cannot see) →
  **Outbound-ready**.
- `phone` present but `crmChecked: false`, or the phone has no
  `phoneSource` → **Needs verification**, stating which.
- `phone` missing → **Contact gap**.
- `alreadyInCrm: true` → drop entirely.
- `emailType === "generic"` → keep only as a flagged fallback (set
  `isGenericInbox` in the handoff); prefer a `personal` email when one
  exists.

## Free-tier notes

- The phone waterfall tries Google Places first when its key is live,
  then the company's own published contact page, which is free and needs
  no account. Places was a hard dependency until an expired GCP free
  trial took it offline for 38 days (ENG-27); it is now an enhancement.
- Hunter free tier is ~25 searches + 50 verifications/month — enough for
  a 5–15 company weekly run. A broker-side cache could stretch it
  further. Upgrade only when weekly volume outgrows it.
- No scraping, no login-only sources, no personal cells — both providers
  are licensed B2B data.

## Broker side

- `services/approval-broker/enrich.mjs` — phone waterfall, email lookup,
  CRM dedup.
- `POST /enrich/contact` in `services/approval-broker/index.mjs` — bearer
  auth (same token as the other outbound routes), holds the provider keys.
