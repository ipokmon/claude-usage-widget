#!/usr/bin/env node
//
// Asserts the derived-stat rules in poller/stats-lib.mjs: pace, streak, top
// tool, peak hour. Every boundary is pinned with an explicit `now`, and the
// timezone is pinned to one with DST so the calendar-date logic is exercised
// across a clock change rather than just in UTC.
//
//   node tools/check-stats.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const TZ = "America/New_York";
if (process.env.TZ !== TZ) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, TZ },
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

const {
  paceFor,
  topTool,
  peakHour,
  streak,
  shortToolName,
  firstCompleteDay,
  recentDateKeys,
  PACE_MIN_ELAPSED_MS,
} = await import("../poller/stats-lib.mjs");

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
  if (!ok) failed += 1;
}

const H = 3600 * 1000;
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime(); // local time

// --- pace -----------------------------------------------------------------
console.log("pace");
const start = "2026-10-16T10:00:00Z";
const reset = "2026-10-23T10:00:00Z";
const startMs = Date.parse(start);

let p = paceFor({ pct: 50, windowStart: start, resetsAt: reset, now: startMs + 3.5 * 24 * H });
check("half used at half-time projects 100%", p.status === "ok" && p.projected_pct === 100, JSON.stringify(p));
check("...and hits the limit right at reset", p.limit_at === reset.replace("Z", ".000Z"), p.limit_at);

p = paceFor({ pct: 7, windowStart: start, resetsAt: reset, now: startMs + 3.5 * 24 * H });
check("7% at half-time projects 14%, no limit time", p.projected_pct === 14 && p.limit_at === null, JSON.stringify(p));

p = paceFor({ pct: 60, windowStart: start, resetsAt: reset, now: startMs + 2 * 24 * H });
check("over pace: projects above 100%", p.projected_pct === 210, JSON.stringify(p));
check("over pace: limit lands before reset", p.limit_at !== null && Date.parse(p.limit_at) < Date.parse(reset), p.limit_at);

p = paceFor({ pct: 0, windowStart: start, resetsAt: reset, now: startMs + 2 * 24 * H });
check("0% is a real 0, not unknown", p.status === "ok" && p.projected_pct === 0 && p.limit_at === null, JSON.stringify(p));

p = paceFor({ pct: 5, windowStart: start, resetsAt: reset, now: startMs + PACE_MIN_ELAPSED_MS - 1 });
check("one ms before the minimum elapsed is too_early", p.status === "too_early", JSON.stringify(p));
p = paceFor({ pct: 5, windowStart: start, resetsAt: reset, now: startMs + PACE_MIN_ELAPSED_MS });
check("exactly the minimum elapsed projects", p.status === "ok", JSON.stringify(p));

check("null pct is unknown", paceFor({ pct: null, windowStart: start, resetsAt: reset, now: startMs + 48 * H }).status === "unknown");
check("missing window start is unknown", paceFor({ pct: 5, windowStart: null, resetsAt: reset, now: startMs + 48 * H }).status === "unknown");
check("garbage dates are unknown", paceFor({ pct: 5, windowStart: "x", resetsAt: reset, now: startMs + 48 * H }).status === "unknown");
check("100% used is at_limit, not a limit time of now", paceFor({ pct: 100, windowStart: start, resetsAt: reset, now: startMs + 48 * H }).status === "at_limit");
check("now past reset is unknown", paceFor({ pct: 5, windowStart: start, resetsAt: reset, now: Date.parse(reset) + 1 }).status === "unknown");

// --- calendar dates -------------------------------------------------------
console.log("calendar");
// DST ends in New York at 02:00 on 2026-11-01: that day is 25 hours long.
const keys = recentDateKeys(at(2026, 11, 2, 0, 30), 3);
check("date keys step by calendar day across DST", keys.join() === "2026-11-02,2026-11-01,2026-10-31", keys.join());
check("first complete day is the day after the oldest mtime", firstCompleteDay(at(2026, 8, 28, 23, 59)) === "2026-08-29");
check("no transcripts means no complete day", firstCompleteDay(undefined) === null);

// --- streak ---------------------------------------------------------------
console.log("streak");
const now = at(2026, 10, 19, 21);
const fcd = "2026-08-29";
let s = streak([at(2026, 10, 17), at(2026, 10, 18), at(2026, 10, 19, 9)], now, fcd);
check("three consecutive days ending today", s.days === 3 && s.active_today && !s.capped, JSON.stringify(s));

s = streak([at(2026, 10, 17), at(2026, 10, 18)], now, fcd);
check("nothing yet today keeps yesterday's streak alive", s.days === 2 && !s.active_today, JSON.stringify(s));

s = streak([at(2026, 10, 16), at(2026, 10, 17)], now, fcd);
check("a fully missed day breaks it", s.days === 0, JSON.stringify(s));

s = streak([at(2026, 10, 18, 23, 59), at(2026, 10, 19, 0, 1)], now, fcd);
check("two minutes either side of midnight is two days", s.days === 2, JSON.stringify(s));

s = streak([at(2026, 10, 18), at(2026, 10, 19), at(2026, 10, 25)], now, fcd);
check("future timestamps are ignored", s.days === 2, JSON.stringify(s));

const longRun = Array.from({ length: 10 }, (_, i) => at(2026, 10, 10 + i));
s = streak(longRun, now, "2026-10-10");
check("a run reaching the first complete day is capped", s.days === 10 && s.capped, JSON.stringify(s));
s = streak(longRun, now, "2026-10-09");
check("a run that ends after a complete, empty day is not capped", s.days === 10 && !s.capped, JSON.stringify(s));
check("no activity at all is 0, not capped", streak([], now, fcd).days === 0 && !streak([], now, fcd).capped);

// --- top tool -------------------------------------------------------------
console.log("top tool");
const calls = [
  ...Array.from({ length: 5 }, () => ({ ts: at(2026, 10, 19), name: "Bash" })),
  ...Array.from({ length: 3 }, () => ({ ts: at(2026, 10, 15), name: "Edit" })),
  ...Array.from({ length: 9 }, () => ({ ts: at(2026, 10, 12), name: "Read" })), // 8 days back: outside
];
let t = topTool(calls, now, fcd);
check("only the last 7 local dates count", t.name === "Bash" && t.count === 5 && t.total === 8, JSON.stringify(t));

t = topTool([...calls, ...Array.from({ length: 9 }, () => ({ ts: at(2026, 10, 13, 0, 1), name: "Read" }))], now, fcd);
check("the 7th day back is inside the window", t.name === "Read" && t.count === 9, JSON.stringify(t));

t = topTool([{ ts: at(2026, 10, 19), name: "Write" }, { ts: at(2026, 10, 19), name: "Edit" }], now, fcd);
check("ties break alphabetically", t.name === "Edit", JSON.stringify(t));

t = topTool([], now, fcd);
check("no calls is insufficient, not a zero-count winner", t.status === "insufficient", JSON.stringify(t));

t = topTool(calls, now, "2026-10-16");
check("a window older than the record is flagged partial", t.partial === true, JSON.stringify(t));

check("mcp names shorten to the tool", shortToolName("mcp__ccd_turn__update_plan") === "update_plan");
check("plain names pass through", shortToolName("Bash") === "Bash");

// --- peak hour ------------------------------------------------------------
console.log("peak hour");
const replies = [
  ...Array.from({ length: 12 }, () => at(2026, 10, 18, 22, 10)),
  ...Array.from({ length: 10 }, () => at(2026, 10, 18, 9, 10)),
];
let ph = peakHour(replies, now, fcd);
check("busiest local hour wins", ph.status === "ok" && ph.hour === 22 && ph.count === 12, JSON.stringify(ph));

ph = peakHour(replies.slice(0, 19), now, fcd);
check("19 replies is below the minimum sample", ph.status === "insufficient" && ph.sample === 19, JSON.stringify(ph));
ph = peakHour(replies.slice(0, 20), now, fcd);
check("20 replies is enough", ph.status === "ok", JSON.stringify(ph));

ph = peakHour([...Array(10).fill(at(2026, 10, 18, 9)), ...Array(10).fill(at(2026, 10, 18, 22))], now, fcd);
check("ties go to the earlier hour", ph.hour === 9, JSON.stringify(ph));

// --- scanner (real poller/stats.mjs against a fixture projects dir) ---------
console.log("scanner");
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), "stats-check-"));
const projects = join(dir, "projects");
mkdirSync(join(projects, "a"), { recursive: true });
mkdirSync(join(projects, "b"));
const iso = new Date().toISOString();
const reply = (id, tools = [], model = "claude-opus-5-5") =>
  JSON.stringify({
    type: "assistant",
    timestamp: iso,
    message: { id, model, content: tools.map(([tid, name]) => ({ type: "tool_use", id: tid, name })) },
  });
writeFileSync(
  join(projects, "a", "s1.jsonl"),
  [
    reply("m1", [["t1", "Bash"]]),
    reply("m1", []), // same reply, second content block
    reply("syn", [["t9", "Bash"]], "<synthetic>"),
    "{not json",
    JSON.stringify({ type: "user", timestamp: iso, message: { content: "hi" } }),
  ].join("\n")
);
// A resumed session repeats m1/t1 in a second file.
writeFileSync(join(projects, "b", "s2.jsonl"), [reply("m1", [["t1", "Bash"]]), reply("m2", [["t2", "Edit"]])].join("\n"));
// Backdate mtimes so the record counts as complete for every window; otherwise
// everything is `partial` from the coverage rule and the checks below are moot.
const old = new Date(Date.now() - 40 * 24 * H);
utimesSync(join(projects, "a", "s1.jsonl"), old, old);
utimesSync(join(projects, "b", "s2.jsonl"), old, old);
symlinkSync(join(projects, "a"), join(projects, "a-link")); // the Desktop-era alias shape
symlinkSync(join(projects, "a", "s1.jsonl"), join(projects, "b", "s1-link.jsonl"));

const runScan = (projectsDir) => {
  const r = spawnSync(process.execPath, [join(ROOT, "poller", "stats.mjs")], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECTS_DIR: projectsDir, CLAUDE_USAGE_CACHE: join(dir, "cache", "usage.json") },
  });
  return { code: r.status, stats: JSON.parse(readFileSync(join(dir, "cache", "stats.json"), "utf8")) };
};

let sc = runScan(projects);
check("symlinked dirs and files are skipped", sc.stats.scanned.files === 2, JSON.stringify(sc.stats.scanned));
check("a reply split over lines and repeated across files counts once", sc.stats.scanned.replies === 2, JSON.stringify(sc.stats.scanned));
check("tool calls dedupe on tool_use id; synthetic lines are skipped", sc.stats.scanned.tool_calls === 2, JSON.stringify(sc.stats.scanned));
check("a bad line is counted, not fatal", sc.stats.scanned.bad_lines === 1 && sc.code === 0, JSON.stringify(sc.stats.scanned));
check("a complete record is not partial", sc.stats.top_tool.partial === false && sc.stats.peak_hour.status === "insufficient" && sc.stats.streak.partial === undefined, JSON.stringify(sc.stats.top_tool));
check("active today gives a 1-day streak", sc.stats.streak.days === 1 && sc.stats.streak.active_today, JSON.stringify(sc.stats.streak));

// A file parsed earlier that turns unreadable keeps its last good parse.
chmodSync(join(projects, "b", "s2.jsonl"), 0o000);
utimesSync(join(projects, "b", "s2.jsonl"), new Date(old.getTime() + 1000), new Date(old.getTime() + 1000));
sc = runScan(projects);
check(
  "an unreadable file parsed before keeps its counts",
  sc.stats.scanned.replies === 2 && sc.stats.top_tool.partial === false && sc.stats.last_error !== null,
  JSON.stringify({ s: sc.stats.scanned, e: sc.stats.last_error })
);
chmodSync(join(projects, "b", "s2.jsonl"), 0o644);
utimesSync(join(projects, "b", "s2.jsonl"), old, old);

writeFileSync(join(projects, "b", "locked.jsonl"), reply("m3", [["t3", "Read"]]));
utimesSync(join(projects, "b", "locked.jsonl"), old, old);
chmodSync(join(projects, "b", "locked.jsonl"), 0o000);
sc = runScan(projects);
check(
  "an unreadable transcript with no earlier parse flags every stat partial",
  sc.stats.top_tool.partial === true && sc.stats.peak_hour.partial === true && sc.stats.streak.partial === true && sc.stats.last_error !== null,
  JSON.stringify({ t: sc.stats.top_tool, e: sc.stats.last_error })
);
chmodSync(join(projects, "b", "locked.jsonl"), 0o644);

sc = runScan(join(dir, "does-not-exist"));
check(
  "a failed scan keeps the previous stats and records the error",
  sc.code === 1 && sc.stats.streak.days === 1 && /stats scan failed/.test(sc.stats.last_error ?? ""),
  JSON.stringify({ code: sc.code, err: sc.stats.last_error })
);
rmSync(dir, { recursive: true, force: true });

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall stats rules hold");
process.exit(failed ? 1 : 0);
