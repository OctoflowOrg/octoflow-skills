#!/usr/bin/env node
// Deterministic publish-time computation for the LinkedIn workflow.
//
// WHY THIS EXISTS: the CMO used to compute `scheduledAt` with in-prompt
// date arithmetic ("decidedAt + 28 days at noon Pacific"). LLMs are
// unreliable at date math — on OCT-512 the CMO produced decidedAt + 7
// instead of + 28, caught only by the Buffer Scheduler's validation and
// an expensive supersede-recovery. This helper moves the arithmetic into
// deterministic code so neither the CMO nor the Scheduler has to do it.
//
// CONTRACT:
//   node compute-schedule.mjs --decided-at <ISO8601 UTC> [--offset-days N]
//   → prints the scheduledAt ISO8601 UTC timestamp to stdout, nothing else.
//   Non-zero exit + stderr message on bad input.
//
// RULE: scheduledAt = (UTC calendar date of decidedAt + OFFSET_DAYS),
// at 12:00 noon America/Los_Angeles, expressed as UTC (DST-aware).
// e.g. decidedAt 2026-06-02 → 2026-06-30T19:00:00.000Z (noon PDT, UTC-7).
//
// OFFSET: defaults to 28 days, matching the current LinkedIn publish
// cadence. If that cadence is wrong (e.g. the routine is daily and the
// intended lead time differs), change OFFSET_DAYS here — one line, in
// code, instead of re-teaching the formula to an LLM. Can also be
// overridden per-call with --offset-days.
const OFFSET_DAYS = 28;

const NOON_LOCAL_HOUR = 12;
const TZ = "America/Los_Angeles";

// Minutes that `TZ` is offset from UTC at the given instant (negative for
// the Americas). DST-aware: derived from Intl, not a hard-coded table.
function tzOffsetMinutes(instant) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const p = Object.fromEntries(
    dtf.formatToParts(instant).map((x) => [x.type, x.value])
  );
  // 24:xx can appear for midnight in some environments; normalize.
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    hour,
    Number(p.minute),
    Number(p.second)
  );
  return (asUTC - instant.getTime()) / 60000;
}

export function computeScheduledAt(decidedAtIso, offsetDays = OFFSET_DAYS) {
  const decided = new Date(decidedAtIso);
  if (Number.isNaN(decided.getTime())) {
    throw new Error(`invalid --decided-at: ${JSON.stringify(decidedAtIso)}`);
  }
  if (!Number.isInteger(offsetDays)) {
    throw new Error(`offset-days must be an integer (got ${offsetDays})`);
  }
  // Target calendar day: UTC date of decidedAt + offset.
  const y = decided.getUTCFullYear();
  const m = decided.getUTCMonth();
  const d = decided.getUTCDate() + offsetDays;
  // Normalize the calendar date (handles month/year rollover).
  const target = new Date(Date.UTC(y, m, d));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const td = target.getUTCDate();
  // Find LA's UTC offset around noon on the target date (DST stable at noon;
  // transitions occur at 02:00 local). Probe near midday UTC, then solve.
  const probe = new Date(Date.UTC(ty, tm, td, 19, 0, 0));
  const offMin = tzOffsetMinutes(probe);
  // noon local → UTC ms = (calendar noon as if UTC) - localOffset.
  const scheduled = new Date(
    Date.UTC(ty, tm, td, NOON_LOCAL_HOUR, 0, 0) - offMin * 60000
  );
  return scheduled.toISOString();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--decided-at") out.decidedAt = argv[++i];
    else if (argv[i] === "--offset-days") out.offsetDays = Number(argv[++i]);
  }
  return out;
}

// Only run as CLI when invoked directly (allows import in tests).
import { fileURLToPath } from "node:url";
import { argv, stdout, stderr, exit } from "node:process";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(argv.slice(2));
  if (!args.decidedAt) {
    stderr.write("usage: compute-schedule.mjs --decided-at <ISO8601 UTC> [--offset-days N]\n");
    exit(2);
  }
  try {
    const result = computeScheduledAt(
      args.decidedAt,
      args.offsetDays === undefined ? OFFSET_DAYS : args.offsetDays
    );
    stdout.write(result + "\n");
  } catch (err) {
    stderr.write(`BLOCKER: ${err.message}\n`);
    exit(1);
  }
}
