#!/usr/bin/env node
//
// Asserts the adaptive-cadence rules in poller/poll.mjs, the same way
// check-cat-rules.mjs asserts the cat's: by driving the real thing rather than
// re-implementing its arithmetic here, so this cannot quietly fall out of date.
//
//   node tools/check-poll-cadence.mjs
//
// Every case spawns the actual poll.mjs with `fetch` replaced by a stub and
// with CLAUDE_USAGE_CACHE / CLAUDE_USAGE_LOG pointed at a scratch directory, so
// it never makes a request, never touches the cache the widget is reading, and
// never appends to the log launchd owns.
//
// The rules, and why each one is here:
//
//   1. A run inside the interval makes NO request. This is the whole reason a
//      60s launchd tick is affordable against an undocumented endpoint.
//   2. Values moving drops the gap back to the floor. Movement means you are
//      mid-session and actually looking at the widget.
//   3. Values not moving doubles the gap, capped at maxSeconds. 60% of the
//      old fixed-interval polls returned an unchanged number.
//   4. A limit window rolling over forces a fetch regardless of the backoff -
//      the numbers we hold are certainly wrong at that point.
//   5. One or two failures do NOT flag stale. Sleeping laptops and wifi
//      handovers are routine; a badge that flickers on them means nothing.
//   6. Three consecutive failures DO flag stale, and repeated failure backs off
//      to maxSeconds rather than hammering a dead endpoint every tick.
//   7. A metric missing from an otherwise-good response is carried over and
//      marked `carried_over`, which is what the widget draws as "held".

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), "poll-cadence-"));
const CACHE = join(dir, "usage.json");
const LOG = join(dir, "poller.log");
const STUB = join(dir, "stub.mjs");
const CONFIG = join(dir, "config.json");

// A config with the shipped defaults and a deliberately fake-but-allowed
// endpoint: `fetch` is stubbed, so it is never actually called.
writeFileSync(
  CONFIG,
  JSON.stringify({
    sessionCookie: "sessionKey=test-not-a-real-cookie",
    endpoint: "https://claude.ai/api/organizations/test/usage",
    poll: { minSeconds: 60, maxSeconds: 600 },
    fieldMap: {
      session: { pct: "five_hour.utilization", resets_at: "five_hour.resets_at", scale: 1 },
      weekly: { pct: "seven_day.utilization", resets_at: "seven_day.resets_at", scale: 1 },
      weekly_fable: {
        pct: "limits[scope.model.display_name=Fable].percent",
        resets_at: "limits[scope.model.display_name=Fable].resets_at",
        scale: 1,
      },
    },
  })
);
// Not a real credential, but readConfig() warns about a world-readable config
// and that warning would be noise on every line of this run.
chmodSync(CONFIG, 0o600);

writeFileSync(
  STUB,
  `
const mode = process.env.STUB_MODE || "ok";
const pct = Number(process.env.SESSION_PCT ?? 10);
globalThis.__fetched = false;
globalThis.fetch = async () => {
  globalThis.__fetched = true;
  process.env.STUB_HIT_FILE && (await import("node:fs")).writeFileSync(process.env.STUB_HIT_FILE, "hit");
  if (mode === "netfail") throw new TypeError("fetch failed");
  const limits = [];
  if (mode !== "nofable") {
    limits.push({ kind: "weekly_scoped", scope: { model: { display_name: "Fable" } }, percent: 5, resets_at: null });
  }
  return new Response(JSON.stringify({
    five_hour: { utilization: pct, resets_at: "2099-01-01T00:00:00Z" },
    seven_day: { utilization: 2, resets_at: "2099-01-01T00:00:00Z" },
    limits,
  }), { status: 200, headers: { "content-type": "application/json" } });
};
`
);

const HIT = join(dir, "hit");

/** Run one poll. Returns { cache, fetched, out }. */
function poll({ pct = 10, mode = "ok", args = [] } = {}) {
  rmSync(HIT, { force: true });
  const res = spawnSync(
    process.execPath,
    ["--import", STUB, join(ROOT, "poller", "poll.mjs"), ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_USAGE_CACHE: CACHE,
        CLAUDE_USAGE_LOG: LOG,
        CLAUDE_USAGE_CONFIG: CONFIG,
        STUB_MODE: mode,
        SESSION_PCT: String(pct),
        STUB_HIT_FILE: HIT,
      },
    }
  );
  let fetched = true;
  try {
    readFileSync(HIT);
  } catch {
    fetched = false;
  }
  let cache = null;
  try {
    cache = JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {}
  return { cache, fetched, out: `${res.stdout}${res.stderr}` };
}

/** Open the gate without waiting out a real interval. */
function expireGate() {
  const c = JSON.parse(readFileSync(CACHE, "utf8"));
  c.poll.next_at = "2000-01-01T00:00:00.000Z";
  writeFileSync(CACHE, JSON.stringify(c, null, 2));
}

let failed = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "  ok  " : "  FAIL"}  ${name}${cond || !detail ? "" : `\n         ${detail}`}`);
  if (!cond) failed++;
}

console.log("poll cadence");

// --- 1. the gate -----------------------------------------------------------
let r = poll({ pct: 10 });
check("first run with no cache fetches", r.fetched);
check("floor interval after a change", r.cache?.poll?.interval_s === 60, `got ${r.cache?.poll?.interval_s}`);

r = poll({ pct: 11 });
check("a run inside the interval makes NO request", !r.fetched);

// --- 2/3. backoff ----------------------------------------------------------
const seen = [];
for (let i = 0; i < 5; i++) {
  expireGate();
  seen.push(poll({ pct: 10 }).cache.poll.interval_s); // same value every time
}
check(
  "unchanged values double the gap, capped at maxSeconds",
  JSON.stringify(seen) === JSON.stringify([120, 240, 480, 600, 600]),
  `got ${JSON.stringify(seen)}`
);

expireGate();
r = poll({ pct: 42 }); // value moves
check("a change drops straight back to the floor", r.cache.poll.interval_s === 60, `got ${r.cache.poll.interval_s}`);

// --- 4. reset boundary -----------------------------------------------------
{
  const c = JSON.parse(readFileSync(CACHE, "utf8"));
  c.poll.next_at = "2099-01-01T00:00:00.000Z"; // gate firmly shut
  c.fetched_at = new Date(Date.now() - 3600e3).toISOString();
  c.data.session.resets_at = new Date(Date.now() - 300e3).toISOString(); // rolled over 5 min ago
  writeFileSync(CACHE, JSON.stringify(c, null, 2));
}
check("a limit window rolling over overrides the backoff", poll({ pct: 0 }).fetched);

// --- 5/6. failure hysteresis ----------------------------------------------
const states = [];
for (let i = 0; i < 5; i++) {
  expireGate();
  const c = poll({ mode: "netfail" }).cache;
  states.push([c.poll.failures, c.poll.interval_s, c.stale]);
}
check("one failure does not flag stale", states[0][2] === false, `got ${JSON.stringify(states[0])}`);
check("two failures do not flag stale", states[1][2] === false, `got ${JSON.stringify(states[1])}`);
check("three consecutive failures flag stale", states[2][2] === true, `got ${JSON.stringify(states[2])}`);
check(
  "repeated failure backs off instead of hammering",
  states.map((s) => s[1]).join() === "60,120,240,480,600",
  `got ${states.map((s) => s[1]).join()}`
);
{
  const c = JSON.parse(readFileSync(CACHE, "utf8"));
  check("last known-good data survives every failure", c.data?.session?.pct === 0, `got ${c.data?.session?.pct}`);
}

expireGate();
r = poll({ pct: 42 });
check("recovery clears stale and the failure count", r.cache.stale === false && r.cache.poll.failures === 0);

// --- 7. carried-over metric ------------------------------------------------
expireGate();
r = poll({ pct: 43, mode: "nofable" });
check(
  "a metric missing from the response is carried over and marked held",
  r.cache.data.weekly_fable?.carried_over === true && r.cache.data.weekly_fable?.pct === 5,
  JSON.stringify(r.cache.data.weekly_fable)
);
check("the other metrics still update", r.cache.data.session.pct === 43);
expireGate();
r = poll({ pct: 44 });
check("the mark clears when the metric comes back", r.cache.data.weekly_fable?.carried_over === undefined);

rmSync(dir, { recursive: true, force: true });

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall cadence rules hold");
process.exit(failed ? 1 : 0);
