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
} from "./lib.mjs";

function markStale(reason) {
  const prev = readCache();
  const next = {
    schema: 1,
    source: prev?.source ?? null,
    // Keep the timestamp of the last GOOD fetch, not this failed attempt.
    fetched_at: prev?.fetched_at ?? null,
    stale: true,
    last_error: redact(reason),
    last_error_at: new Date().toISOString(),
    data: prev?.data ?? null, // <- preserved, never destroyed
  };
  writeCache(next);
  console.error(`[poll] FAILED: ${redact(reason)}`);
  console.error(
    prev?.data
      ? "[poll] Kept last known-good data and flagged it stale."
      : "[poll] No previous data to fall back on. Run 'node poller/manual-entry.mjs' to populate it by hand."
  );
}

async function main() {
  let cfg;
  try {
    cfg = readConfig();
  } catch (e) {
    markStale(e.message);
    return;
  }

  let payload;
  try {
    payload = await fetchUsage(cfg);
  } catch (e) {
    markStale(e.message);
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
    markStale(
      `Response parsed but no metrics could be mapped (${missing.join(", ")}). The payload shape likely changed - run 'node poller/probe.mjs' to inspect it and update fieldMap in config.json.`
    );
    return;
  }

  // Partial success: keep whatever previous values we had for unmapped metrics.
  const prev = readCache();
  for (const key of missing) {
    if (prev?.data?.[key]) data[key] = { ...prev.data[key], carried_over: true };
  }

  writeCache({
    schema: 1,
    source: "scrape",
    fetched_at: new Date().toISOString(),
    stale: false,
    last_error: missing.length
      ? `Partially mapped; missing: ${missing.join(", ")}`
      : null,
    last_error_at: missing.length ? new Date().toISOString() : null,
    data,
  });

  const summary = METRICS.filter((k) => data[k])
    .map((k) => `${k}=${data[k].pct}%`)
    .join("  ");
  console.log(`[poll] OK  ${summary}`);
  if (missing.length) {
    console.warn(`[poll] WARNING: could not map ${missing.join(", ")}`);
  }
}

// Belt and braces: nothing below should ever throw a non-zero exit at launchd.
main().catch((e) => {
  try {
    markStale(`Unexpected error: ${e?.message ?? e}`);
  } catch {
    console.error("[poll] Failed even while handling failure.");
  }
});
