# Forbidden tools

The following commands and patterns are banned in OctoSync workflow
agents. Each entry has been used at least once to mine Paperclip
state out-of-band, implement workflow logic in shell, or guess at
runtime config — all of which produced incorrect or unsafe results.

## Banned outright

- `rg` / `ripgrep` — used to grep agent run logs and other Paperclip
  internals. Use the `paperclip` skill's API endpoints to query
  Paperclip state.
- `python` / `python3` — used to implement workflow logic that
  should live in a bundled script with proper testing, or to script
  Paperclip API calls outside the documented surface.
- `env`, `printenv`, `set`, `grep PAPERCLIP` — used to enumerate
  injected env vars rather than relying on `PAPERCLIP_*` vars by
  name as documented. The four wake-context vars (`PAPERCLIP_TASK_ID`,
  `PAPERCLIP_APPROVAL_ID`, `PAPERCLIP_WAKE_REASON`,
  `PAPERCLIP_WAKE_COMMENT_ID`) may be expanded via the documented
  4-variable `printf` bootstrap in the CMO prompt; nothing broader.

## Banned for broad use

- Broad `find` against `/paperclip` — used to mine historical run
  logs. Out-of-band; don't.
- Raw `curl` against Paperclip API endpoints — use the `paperclip`
  skill's documented invocation patterns instead. The skill handles
  auth, headers, and run-id tagging correctly.

## Permitted with constraint

- `jq` and `awk` — permitted for parsing the structured output of
  Paperclip API responses. Do not use them to scan files outside
  that output.
