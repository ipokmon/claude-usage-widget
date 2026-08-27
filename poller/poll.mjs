#!/usr/bin/env node
//
// PRIMARY data path: fetch Claude.ai plan-usage limits and write them to the
// local cache the widget reads.
//
// Contract with the widget:
//   - On success  -> cache holds fresh data, stale:false.
//   - On ANY failure -> the last known-good `data` is PRESERVED and only
//     flagged stale:true with a last_error. We never blank out good numbers
//     just because a poll failed, and we always exit 0 so launchd doesn't
//     start backing us off.
//
// CADENCE. launchd fires this script every `poll.minSeconds`; this script then
// decides whether to actually spend a request. Values move fast while you are
// working and not at all while you are not - measured over an early log, 60% of
// fixed-interval polls returned numbers identical to the previous one - so a
// fixed interval is either too slow when it matters or wasteful when it does
// not. Fetch at minSeconds while the numbers are moving, double the gap toward
// maxSeconds while they are not, and always fetch when a limit window has
// rolled over. Run with `--now` to bypass the gate entirely.
//
// The endpoint is undocumented and WILL break eventually. See README.

import {
  METRICS,
  LABELS,
  readConfig,
  fetchUsage,
  applyFieldMap,
  readCache,
  writeCache,
  redact,
  pollSettings,
  resetBoundaryPassed,
  metricsChanged,
  trimLog,
  stamp,
} from "./lib.mjs";

// A single failed poll is usually a sleeping laptop or a wifi handover, not a
// dead scraper. Flipping the badge on the first one made it flicker on and off
// at any cadence worth having; three consecutive failures (~3 minutes, given
// the failure backoff below) is no longer a blip. Note that this is about
// FAILURES, not age - how old the data is, the footer already shows.
const FAILURES_BEFORE_STALE = 3;

const log = (msg) => console.log(`[${stamp()}] ${msg}`);
const logErr = (msg) => console.error(`[${stamp()}] ${msg}`);

/** Geometric backoff off the floor: min, 2*min, 4*min … capped at max. */
function backoff(step, { min, max }) {
  return Math.min(min * 2 ** Math.max(0, step), max);
}

/**
 * The whole point of the 60s launchd cadence: most runs answer "no" here and
 * exit having made no request at all.
 */
function shouldFetch(cache, now) {
  if (!cache?.data) return true; // nothing to show yet - always worth a try
  const nextAt = Date.parse(cache?.poll?.next_at ?? "");
  if (!Number.isFinite(nextAt)) return true; // no state (e.g. after manual-entry)
  if (now >= nextAt) return true;
  return resetBoundaryPassed(cache, now); // window rolled over; we are stale by definition
}

function recordFailure(reason, settings) {
  const prev = readCache();
  const failures = (prev?.poll?.failures ?? 0) + 1;
  const interval = backoff(failures - 1, settings);
  const stale = failures >= FAILURES_BEFORE_STALE;

  writeCache({
    schema: 1,
    source: prev?.source ?? null,
    // Keep the timestamp of the last GOOD fetch, not this failed attempt.
    fetched_at: prev?.fetched_at ?? null,
    stale,
    last_error: redact(reason),
    last_error_at: new Date().toISOString(),
    data: prev?.data ?? null, // <- preserved, never destroyed
    poll: {
      next_at: new Date(Date.now() + interval * 1000).toISOString(),
      interval_s: interval,
      failures,
      last_change_at: prev?.poll?.last_change_at ?? null,
    },
  });

  logErr(
    `FAILED (${failures}x): ${redact(reason)} - retrying in ${interval}s${
      stale ? ", flagged stale" : ""
    }`
  );
  if (!prev?.data) {
    logErr(
      "No previous data to fall back on. Run 'node poller/manual-entry.mjs' to populate it by hand."
    );
  }
}

async function main() {
  trimLog();

  const cached = readCache();
  const forced = process.argv.includes("--now");
  if (!forced && !shouldFetch(cached, Date.now())) return; // silent, no request

  let cfg;
  let settings = pollSettings(null); // defaults, so a bad config can still back off
  try {
    cfg = readConfig();
    settings = pollSettings(cfg);
  } catch (e) {
    recordFailure(e.message, settings);
    return;
  }

  let payload;
  try {
    payload = await fetchUsage(cfg);
  } catch (e) {
    recordFailure(e.message, settings);
    return;
  }

  // Map the raw payload onto our three metrics.
  const data = {};
  const missing = [];
  for (const key of METRICS) {
    const mapped = applyFieldMap(payload, cfg.fieldMap?.[key]);
    if (mapped) {
      data[key] = { label: LABELS[key], ...mapped };
    } else {
      missing.push(key);
    }
  }

  // If we couldn't map ANY metric, the payload shape changed (or was never
  // configured). Treat that as a failure rather than writing an empty cache.
  if (Object.keys(data).length === 0) {
    recordFailure(
      `Response parsed but no metrics could be mapped (${missing.join(", ")}). The payload shape likely changed - run 'node poller/probe.mjs' to inspect it and update fieldMap in config.json.`,
      settings
    );
    return;
  }

  // Partial success: keep whatever previous values we had for unmapped metrics.
  // `carried_over` is what the widget uses to mark the bar as held rather than
  // live - without it a frozen number is indistinguishable from a fresh one.
  const prev = cached;
  for (const key of missing) {
    if (prev?.data?.[key]) data[key] = { ...prev.data[key], carried_over: true };
  }

  const changed = metricsChanged(prev?.data, data);
  const recovered = (prev?.poll?.failures ?? 0) > 0;
  const now = Date.now();
  // Movement means you are mid-session and watching: drop straight back to the
  // floor. Stillness compounds the gap instead.
  const interval = changed
    ? settings.min
    : Math.min(Math.max(prev?.poll?.interval_s ?? settings.min, settings.min) * 2, settings.max);

  writeCache({
    schema: 1,
    source: "scrape",
    fetched_at: new Date(now).toISOString(),
    stale: false,
    last_error: missing.length
      ? `Partially mapped; missing: ${missing.join(", ")}`
      : null,
    last_error_at: missing.length ? new Date(now).toISOString() : null,
    data,
    poll: {
      next_at: new Date(now + interval * 1000).toISOString(),
      interval_s: interval,
      failures: 0,
      last_change_at: changed
        ? new Date(now).toISOString()
        : (prev?.poll?.last_change_at ?? null),
    },
  });

  // Log CHANGES, not heartbeats. An entry per poll buried the interesting lines
  // in hundreds of identical ones and told you nothing the cache's fetched_at
  // does not already say.
  if (changed || recovered) {
    const summary = METRICS.filter((k) => data[k])
      .map((k) => `${k}=${data[k].pct}%`)
      .join("  ");
    log(`OK  ${summary}  (next in ${interval}s)`);
  }

  // Only when the missing set actually changes - otherwise a metric that stays
  // absent for a week writes the same warning every poll.
  const prevMissing = METRICS.filter((k) => prev?.data?.[k]?.carried_over);
  if (missing.join() !== prevMissing.join()) {
    if (missing.length) {
      logErr(
        `WARNING: could not map ${missing.join(", ")} - showing the last known value, marked held in the widget.`
      );
    } else {
      log(`Recovered: all metrics mapping again.`);
    }
  }
}

// Belt and braces: nothing below should ever throw a non-zero exit at launchd.
main().catch((e) => {
  try {
    recordFailure(`Unexpected error: ${e?.message ?? e}`, pollSettings(null));
  } catch {
    logErr("Failed even while handling failure.");
  }
});
