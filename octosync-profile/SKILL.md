---
name: octosync-profile
description: >
  ALWAYS load at the start of every heartbeat for content-producing
  agents (Researcher, Drafter, Buffer Scheduler, Opportunity workers,
  CMO, CSO). Canonical source of truth for what OctoSync sells, who
  we sell to, and what's out of scope: positioning paragraph (seeds
  outreach copy), ICP filter table, included industries, excluded
  industries, geographic focus. Treat as the yardstick for every
  "OctoSync fit" / targeting / scoping decision. Do not improvise
  positioning, ICP, or industries outside this skill.
---

# OctoSync company profile

The canonical source of truth for what OctoSync sells, who we sell to,
and what's out of scope. Every content-producing agent reads this at
the start of every run alongside `octosync-coordination-rules`.

When editing in repo: keep the Positioning paragraph readable as
outreach copy (it seeds cold-email intros). Keep ICP / industries /
geographic sections scannable — agents apply them as filters, not as
prose to quote.

---

## Positioning

OctoSync engineers secure, reliable custom automations for small to
medium businesses. We replace complex manual workflows with multi-step
routines that run on their own, coordinate with the tools you already
use, and pause for human input where it matters. Bank-grade security,
isolated data processing, integration with your existing software
stack. Engineering pedigree includes mission-critical AI work at one
of the world's largest AI organizations, enterprise platforms at Nike
and Kroger, and intuitive system design from Microsoft.

Tagline: *Intelligent automation, naturally.*

## ICP

A prospect qualifies for the weekly opportunity research workflow if
**all** of the following are true:

| Filter | Criterion |
|---|---|
| Headcount | 10–75 employees |
| Annual revenue | $1M–$10M |
| Decision-maker shape | Single accessible decision-maker preferred. Procurement committees stretch our 30-day demo→deal expectation; deprioritize. |
| Monthly budget for workflow automation | $1,000–$1,500 |
| Geography | Has at least one Oregon address (see Geographic focus below) |

Below the band: too small to comfortably justify $1.5K/mo recurring on
a single workflow tool. Above the band: typically has IT staff with
their own preferences and slow procurement.

## Industries we serve

We sell into operational pain, not into industries directly. The
operational categories where automation reliably pays off:

- Recruiting coordination
- Sales admin & CRM hygiene
- Customer support triage
- Accounts payable & receivable operations
- Executive and administrative operations
- Marketing operations
- Procurement & internal approvals
- Industry-specific back-office workflows when evidence is strong

**Green energy / sustainability companies are explicitly in scope**
where they otherwise meet the ICP and have one of the operational
pain points above. This isn't a separate operational category — it's
a values-aligned industry preference. When considering opportunities,
include green-energy-aligned prospects on equal footing or better.

## Industries we exclude

**Principle**: exclude verticals where (a) regulatory landscape
changes faster than a typical implementation cycle, (b) vendor
certification is required for the software vendor itself, or (c)
procurement is gated by compliance review boards. The workflow
automation's value evaporates if any of those conditions stall the
build or change underneath it.

Excluded:

- Healthcare / medical / dental (HIPAA, state regs, slow procurement)
- Tax preparation / CPA-regulated work (state-by-state certification overhead)
- Financial services — broker-dealer, RIA, banking, insurance
  (heavy compliance, licensing)
- Legal services (bar regulations, privilege/conflict implications)
- Cannabis (volatile state/federal divergence)
- Government / K-12 education (FERPA, district procurement cycles)
- Pharmacy / biotech (FDA)
- Childcare (state licensing)

If a prospect is partially in one of these — e.g., a medical-adjacent
SaaS company that doesn't directly process PHI — assess against the
principle, not the keyword. When in doubt, exclude.

## Geographic focus

V1 of the opportunity workflow is geographically constrained for
in-person demo accessibility.

- **Required**: prospect has at least one Oregon address.
- **Preferred**: Portland metro area. The Portland corridor is
  tech-forward, in driving distance for in-person demos, and our
  primary target geography.
- **Hard test for ICP fit**: a decision-maker reachable for an
  in-person demo in the Portland / Willamette Valley corridor within
  30 days of first meeting.
- **Out of scope**: national chains where the Oregon location is a
  franchisee with no buying authority (decision rolls up to corporate
  outside Oregon).

When this loosens: once we close 2–3 Oregon deals on remote demos and
the in-person constraint is no longer load-bearing.

## Contact

octosync.dev · hello@octosync.dev

## References

For niche detail loaded on demand:

- `references/delivery-tracks.md` — full Track 1 / Track 2 pricing
  detail, support blocks, AI-compute conventions, Founding Partner
  promo. Relevant when the Strategist picks which track to recommend
  per opportunity, or the Drafter needs grounded pricing claims.
- `references/example-routines.md` — recognizable workflow shapes
  from the Capabilities Deck (inbound lead triage, invoice
  processing, support ticket triage, weekly ops reporting, CRM
  hygiene, meeting follow-up). Useful when an agent needs concrete
  example shapes; explicitly **not a menu** — actual scope per
  customer is defined in their Phase 1 audit or discovery call.
