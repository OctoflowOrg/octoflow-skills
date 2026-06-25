---
name: octosync-enrichment
description: >
  Load when an OctoSync agent needs verified contact data for a target
  company — a business phone and a named work email. Ships one thin POST
  client (enrich-contact.mjs) that calls the approval-broker's
  /enrich/contact endpoint; the broker holds the Google Places + Hunter
  keys and does the lookups. Used by the Opportunity Prospecting
  Researcher at step 6 to gate prospects into Outbound-ready vs Contact
  gap.
---

# OctoSync contact enrichment — thin-client skill

The agent-side surface for resolving contact details from **licensed,
free-tier APIs** instead of guessing them from search results. The
Prospecting Researcher must require a business phone and prefer a named
work email; this skill is the only sanctioned source of that data.

Like the `octosync-emails` skill, the heavy lifting and the secrets live
in the **approval-broker** sidecar (`services/approval-broker/`). This
skill ships exactly one HTTP client. The broker calls two providers,
both agent-callable on their free tiers:

- **Google Places** → the company's business phone + website for its
  Oregon location. Phone is business-facing by definition (no personal
  cells).
- **Hunter.io** → a named work email for the domain, each classified
  `personal` vs `generic` with a deliverability check. This is what
  enforces "prefer a named work email, avoid generalized inboxes."

**The Google Places + Hunter keys never reach this agent** — they live
in the broker's secrets bundle (`GOOGLE_PLACES_API_KEY`,
`HUNTER_API_KEY`). The agent only carries the broker bearer token, same
trust model as `send-approval.mjs` / `attio-sync.mjs`.

## Scripts

- `scripts/enrich-contact.mjs` — thin POST client for the broker's
  `/enrich/contact`. Node built-ins only (global `fetch`); no deps.

## Invocation

```sh
: "${OCTOSYNC_SKILLS_RUNTIME:?OCTOSYNC_SKILLS_RUNTIME not set; \
  octosync-enrichment skill not provisioned for this agent}"
CLIENT=$(ls "$OCTOSYNC_SKILLS_RUNTIME"/octosync-enrichment--*/scripts/enrich-contact.mjs \
  2>/dev/null | head -1)
: "${CLIENT:?enrich-contact.mjs not present in octosync-enrichment skill runtime}"
node "$CLIENT" --company-name "Acme Logistics" --region "Oregon" \
  [--domain "acme.com"] [--person-name "Jane Doe"]
```

Flags:

| Flag | Required | Purpose |
|------|----------|---------|
| `--company-name` | yes | Place search query subject |
| `--region` | no | Biases the Places search (pass `"Oregon"`) |
| `--domain` | no | Hunter lookup domain; derived from the Places website when omitted |
| `--person-name` | no | When set, Hunter Email Finder targets that person |

## Env (agent side)

| Var | Required | Description |
|-----|----------|-------------|
| `EMAIL_APPROVAL_PUBLIC_URL` | yes | Broker base URL; `/enrich/contact` is hit on the same host |
| `EMAIL_APPROVAL_INTERNAL_TOKEN` | yes | Bearer token shared with the broker |

The provider keys (`GOOGLE_PLACES_API_KEY`, `HUNTER_API_KEY`) are
**broker env, not agent env**. Each provider degrades independently
broker-side: if a key is unset or a provider errors, that provider's
fields come back `null` with a note in `notes` and the field listed in
`missing`, and the call still returns `200`. This lets you bring
enrichment up incrementally (e.g. Places-only first) and lets the agent
route a company to `Contact gap` rather than failing. A malformed call
(missing `--company-name`) exits `2` with a `BLOCKER:` line.

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
  "sources": ["google_places:searchText", "hunter:email-finder"],
  "missing": [],
  "notes": []
}
```

The Prospecting Researcher uses this to bucket the company:

- `phone` present + a usable `email` → **Outbound-ready**.
- `phone` missing (or no usable email) → **Contact gap**.
- `emailType === "generic"` → keep only as a flagged fallback (set
  `isGenericInbox` in the handoff); prefer a `personal` email when one
  exists.

## Free-tier notes

- Google Places business phone is the cleanest free, ToS-safe phone
  source for local Oregon SMBs (most have a Google Business Profile).
- Hunter free tier is ~25 searches + 50 verifications/month — enough for
  a 5–15 company weekly run. A broker-side cache could stretch it
  further. Upgrade only when weekly volume outgrows it.
- No scraping, no login-only sources, no personal cells — both providers
  are licensed B2B data.

## Broker side

- `services/approval-broker/enrich.mjs` — Places + Hunter orchestrator.
- `POST /enrich/contact` in `services/approval-broker/index.mjs` — bearer
  auth (same token as the other outbound routes), holds the provider keys.
