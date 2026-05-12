# Invoking scripts from skills

Some OctoSync skills ship executable scripts that an agent invokes
during its procedure (the LinkedIn `linkedin-finalize-batch.mjs`, the
opportunity `opportunity-digest.mjs`, the shared
`render-approval-email.mjs` and `sign-approval-link.mjs`).

When an agent is told to invoke a script from a skill, the script is
available at the skill's mount path on disk. The exact path is
adapter-dependent (the `claude_local` adapter uses a temp directory
with symlinks and `--add-dir`; the `codex_local` adapter uses a
global skills directory). The skill's own SKILL.md documents the
invocation snippet the agent should use.

General pattern:

```sh
node "$SKILL_DIR/scripts/<script-name>.mjs" [--flags <values>]
```

where `$SKILL_DIR` is the skill's mount path (the agent can resolve
this from the `Skill` tool's invocation context, or the SKILL.md
exposes a concrete shell snippet).

Rules:

- Do not assume `./<script>.mjs` works. The runtime `cwd` is a
  project workspace dir that's empty by design.
- Do not search the filesystem for the script. Use the skill's
  documented invocation snippet.
- Scripts use only native Node modules (`fetch`, `node:fs`,
  `node:fs/promises`, `node:child_process`, `node:crypto`). No
  `npm install` step.
- If a script exits non-zero, follow the procedure in the calling
  skill's SKILL.md for what to do (typically: blocker comment +
  stop).

For agents that don't invoke any in-skill scripts (most workers),
this reference is irrelevant — they only read the skill prose.
