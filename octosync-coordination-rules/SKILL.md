---
name: octosync-coordination-rules
description: >
  ALWAYS load at the start of every heartbeat. Defines the OctoSync
  Paperclip workflow ownership model (which agent can write where),
  worker-to-orchestrator handoff procedures (success path + blocker
  path), voice conventions, comment-writing rules, idempotency
  conventions, branch hygiene, and stop-cleanly semantics. Required
  reading for every OctoSync workflow agent before any other action.
  Load this even when the task seems unrelated to coordination — most
  agent failures are coordination failures.
---

# OctoSync coordination rules

These rules apply to every OctoSync Paperclip workflow agent. Load
this skill at the start of every heartbeat. If anything in your
agent prompt conflicts with these rules, the rules win unless the
prompt explicitly names the override.

## Paperclip skill is the only API surface

Before any Paperclip coordination action, follow the upstream
`paperclip` skill at
`/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/server/skills/paperclip/SKILL.md`.

It is upstream-maintained and documents:

- Auto-injected env vars (`PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`,
  `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_RUN_ID`,
  plus wake-context vars)
- The full heartbeat procedure (identity → assignments → checkout →
  work → exit)
- Every API endpoint we use (`/api/issues/*`, `/api/companies/*`,
  `/api/approvals/*`, `/api/agents/me/inbox-lite`, etc.)
- Auth (`Authorization: Bearer $PAPERCLIP_API_KEY`) and audit
  (`X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` on mutating calls)

Use it for all Paperclip API access. Never hard-code the API URL.
Each agent prompt declares the subset of Paperclip actions its role
is permitted to call; do not call API endpoints outside that subset.

## Comment ownership and handoff model

Paperclip 2026.428.0 hardened comment ownership: an agent can only
`POST /api/issues/{id}/comments` and `PATCH /api/issues/{id}` on
issues it owns. Owners:

- **Parent issue** — owned by the orchestrator (CMO for LinkedIn,
  CSO for opportunity).
- **Child issue** — owned by the worker assigned to that child.

Each agent writes only on the issue it owns. Orchestrators never
post on a worker's child; workers never post on the parent.

### Worker → orchestrator handoff (success path)

1. Worker does the work.
2. Worker posts the canonical handoff comment on its **own child**
   (`POST /api/issues/{PAPERCLIP_TASK_ID}/comments`). The body is the
   full, self-contained handoff content. Do NOT prefix with `@CMO` or
   `@CSO`.
3. Worker patches its own child to `done`
   (`PATCH /api/issues/{PAPERCLIP_TASK_ID}` with `{ "status": "done" }`).
4. Paperclip fires `issue_children_completed` on the orchestrator.
   The orchestrator wakes, reads the just-completed child's last
   comment, and continues the workflow.

The success path uses NO `@AgentName` mention. The
`issue_children_completed` event is the wake signal. Do not
@-mention the orchestrator on a successful handoff — that fires a
redundant wake.

### Worker → orchestrator handoff (blocker path)

1. Worker hits a blocker (missing upstream context, weak sources,
   downstream API failure, etc.).
2. Worker posts a blocker comment on its **own child** starting with
   `@CMO Blocker: <reason>` (use `@CSO` for opportunity workers).
3. Worker patches its own child to `blocked` with `unblockOwner` and
   `unblockAction` set per the upstream SKILL.md.
4. Paperclip fires `issue_comment_mentioned` on the named
   orchestrator. The orchestrator wakes, reads the comment, acts.

The blocker path is the ONLY case in which a worker @-mentions the
orchestrator. There is no scheduled-heartbeat fallback in this
deployment, so the mention is the wake mechanism — without it, the
blocker sits silent until the next routine fires.

### Other rules

- Children do not — and must not — checkout the parent. The
  orchestrator's checkout of the parent is what makes the workflow's
  ownership model work. A child that tries to checkout the parent
  will get `409 Conflict`; that's expected. Do not retry it
  (per upstream rule "never retry a 409").
- Comment bodies are plain readable text or markdown. Use the skill's
  documented request shape (`{ "body": "<text>" }`); do not
  hand-build JSON in a shell heredoc and pipe it through `curl`.
- Keep comments short and factual. Plain, operator-grade voice. No
  marketing register. No raw `curl` commands, no raw approval JSON,
  no operator instructions inside comments.
- Never leave unresolved shell placeholders such as `$CHILD_ID` in a
  user-facing comment.
- Never @-mention yourself: an orchestrator that posts `@CMO
  Researcher started` self-wakes. CMO/CSO status notes on the parent
  (e.g. `Researcher started`, `LinkedIn review email sent`, `Weekly
  digest sent`, `Opportunity strategy started`) MUST omit the
  self-mention.

## Files and state

- Workflow state lives in Paperclip. Do not create or rely on local
  files such as `issues/*.json`, `approvals/*.json`, `*.status`, or
  `notes.md` as workflow state.
- Do not create a standalone markdown report, draft file, or notes
  file as the primary deliverable.

## OctoSync identity

The current Paperclip company and parent issue are authoritative for
what `OctoSync` means in this run. For positioning, ICP, industries
in/out of scope, and geographic focus, load the `octosync-profile`
skill — it is the canonical source. Do not infer positioning from
parent-issue context.

## Stop cleanly

"Stop cleanly" means:

1. Post any blocker or progress comment the procedure mandates.
2. Update issue statuses the procedure mandates.
3. Emit no further plan, narrative, "next step," or "if you want"
   text.
4. Return.

A run that produced only a plan, narrative, or preamble has not
stopped cleanly. Re-enter the procedure at the appropriate step
instead of stopping.

## Branch hygiene

- The currently assigned issue and wake context are authoritative.
  Do not ask the human to confirm branch, parent, company, or wake
  context that should already be present in the run.
- Operate only on the current workflow branch. Do not switch to
  older parent issues, older child issues, or older approvals from a
  different batch.

## Voice

- Comments, briefs, and review packages: plain, factual,
  operator-grade. No marketing register.
- Final LinkedIn post text (Drafter only): sharp technical operator
  voice as specified in the Drafter prompt.

## Failure escalation

- Leave at most one short blocker comment per distinct failure on the
  parent issue. Do not post the same blocker twice for the same
  parent.
- A normal Paperclip API call may be retried once if the operation is
  idempotent. After that, leave a blocker and stop.

## References

For niche detail loaded on demand:

- `references/bundled-scripts.md` — invocation pattern for in-skill
  scripts (relevant when the agent invokes a script from
  `octosync-linkedin-publish`, `octosync-opportunity-digest`, or
  `octosync-approval-emails`).
- `references/idempotency-keys.md` — deterministic construction of
  idempotency keys for approvals, emails, and publisher payloads.
- `references/forbidden-tools.md` — tools/commands banned because
  they were used out-of-band to mine state or implement workflow
  logic.
