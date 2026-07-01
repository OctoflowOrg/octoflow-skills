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
3. Worker sets the final disposition on its own child via
   `PATCH /api/issues/{PAPERCLIP_TASK_ID}`. For leaf workers the
   success-path disposition is `{ "status": "done" }`; if a worker hit
   a blocker it cannot resolve, the disposition is
   `{ "status": "blocked" }` with the named-owner `@CMO/@CSO Blocker:`
   comment in step 2 (see the Blocker path below). See the canonical
   paperclip skill's final-disposition checklist for the full set of
   valid dispositions; workers should only ever exit with `done` or
   `blocked`.
4. Paperclip fires `issue_children_completed` on the orchestrator
   (success path) or `issue_comment_mentioned` (blocker path). The
   orchestrator wakes, reads the just-completed child's last
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

A heartbeat only ends cleanly when the issue you own has a **valid
final disposition** recorded. Paperclip 2026.525.0 added a hard
contract: a "successful" run that leaves its issue in an ambiguous
state (e.g. `in_progress` with no explicit continuation path) triggers
the `successful_run_missing_state` recovery and escalates to the
recovery owner (in OctoSync, the CEO by fallback). Failure to honor
this contract is the most common cause of recovery churn.

The canonical paperclip skill at
`/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/server/skills/paperclip/SKILL.md`
is the source of truth for the final-disposition checklist. Load it
and follow it. Summary for OctoSync agents:

- **Leaf workers** (non-orchestrator agents) only ever exit with
  `done` (success) or `blocked` (with a `@CMO/@CSO Blocker:` comment
  naming the unblock owner). Both satisfy the contract.
- **Orchestrators** (CMO, CSO) exit with:
  - `in_progress` only when a child issue is running AND the parent's
    `blockedByIssueIds` references that child. The blocker is the
    explicit continuation path; without it, the parent looks stranded
    to the recovery system.
  - `in_review` when a human approval / review path is in flight
    (the approval-broker patches this transition for the
    LinkedIn/prospecting approval flows).
  - `done` when all work is complete.
  - `blocked` (with named owner) when continuation requires human
    action that isn't an in-flight approval.

Concretely, "stop cleanly" means:

1. Post any blocker or progress comment the procedure mandates.
2. Set the disposition on the issue you own per the canonical
   checklist. For orchestrators delegating to a child: PATCH the
   parent's `blockedByIssueIds` to include the child id so the
   continuation path is explicit.
3. Emit no further plan, narrative, "next step," or "if you want"
   text.
4. Return.

A run that produced only a plan, narrative, or preamble — or that
left its issue at `in_progress` with no explicit continuation path —
has not stopped cleanly. Re-enter the procedure at the appropriate
step instead of stopping.

## Self-wake detection

When you post a comment on an issue, Paperclip fires
`issue_commented` on the issue's assignee — which is you if you own
the issue. That wake is a side effect of your own prior heartbeat,
not a new event for you to act on. Apply these rules at the start of
every heartbeat, before any procedure step:

- **If `PAPERCLIP_WAKE_REASON` is `issue_commented` AND the latest
  comment on the assigned issue was authored by you (the same agent
  ID as your own) within the last 10 minutes, exit immediately with
  zero comments and zero further work.** Your previous heartbeat
  posted that comment; this wake is the echo. Do not re-evaluate the
  procedure, do not post an acknowledgment, do not "verify" anything.
- **If `PAPERCLIP_WAKE_REASON` is `issue_commented` AND the latest
  comment was authored by the approval-broker service user, exit
  immediately with zero comments and zero further work** — exactly
  like the self-echo above. Broker audit comments are recognizable by
  their prefix: `LinkedIn review email sent`, `Weekly prospecting
  approval sent`, or `Attio sync recorded approval=`. The broker has
  already recorded the authoritative state AND patched the parent's
  status, so there is nothing for this heartbeat to do. This positive
  exit is the structural replacement for the per-agent "do not narrate
  / do not comment about the broker's comment" prohibitions: the agent
  exits before reaching the procedure, so there is no narration left to
  forbid.

This is the OCT-494 / OCT-495 failure pattern: an `issue_commented`
wake (from the orchestrator's own comment OR the broker's audit
comment) → orchestrator wakes → posts a clarifying comment about the
comment → wakes again. The loop only terminates when the agent stops
finding something to say. Catching BOTH the self-echo and the
broker-comment wake at the top of the heartbeat short-circuits the
loop structurally — which is what lets the downstream per-agent
narration prohibitions become belt-and-suspenders rather than
load-bearing.

## Terminal-state exit

If the assigned issue's status is already `done` or `cancelled` when
your heartbeat starts, the workflow is complete. **Exit immediately
with zero comments.** Specifically forbidden in this state:

- Posting a "workflow complete" / "all done" / "all synced" summary.
- Posting an updated tally even if the wording differs from a
  previous summary (e.g., a terser "5 approved, 0 rejected" after
  you've already posted "5 approved, 0 rejected, 0 expired. All
  prospects synced to Attio.").
- Re-running idempotent verification steps (re-listing approvals,
  re-checking Attio sync state, re-reading worker handoffs) just to
  confirm the terminal state.

The terminal status itself IS the signal that the work is done. The
parent already records the canonical summary your prior heartbeat
posted; there is no second summary to post. This is the OCT-494
post-approval failure pattern: a duplicate "5 approved, 0 rejected,
0 expired" comment 3.5 minutes after the parent was already `done`.

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
- **Same-blocker retry cap.** If you posted a blocker (`<workflow>
  blocked: <reason>`, `Worker blocker on …`, etc.) on an issue in your
  previous heartbeat AND no human comment has intervened, stop cleanly
  with zero new comments — the existing blocker is the disposition.
  Bound retries on the same `<reason>` substring to 2 per 30-minute
  window. (OCT-409.)

## Narration discipline

When the procedure says to stop, stop with zero comments. Do not post
comments that narrate your own decision to stop ("This is…", "Per
procedure…", "Stopping cleanly because…", "The new comment is the
broker's…", "Wake reason: …"), and do not post a comment explaining
that you are choosing not to post a comment — that comment is itself
the thing forbidden. Either you have one concrete observation to
record (post it as one statement), or you stop silently. There is no
third category. (OCT-495.) This rule is the single home for the
stopping/narration discipline; agent prompts inherit it and must not
restate it.

## References

For niche detail loaded on demand:

- `references/bundled-scripts.md` — invocation pattern for in-skill
  scripts (relevant when the agent invokes `send-approval.mjs` or
  `attio-sync.mjs` from the `octosync-emails` skill).
- `references/idempotency-keys.md` — deterministic construction of
  idempotency keys for approvals, emails, and publisher payloads.
- `references/forbidden-tools.md` — tools/commands banned because
  they were used out-of-band to mine state or implement workflow
  logic.
