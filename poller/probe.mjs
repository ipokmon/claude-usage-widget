#!/usr/bin/env node
//
// DEV / REPAIR TOOL. Fetches the configured endpoint once, prints the raw JSON,
// and suggests dot-paths that look like usage percentages or reset timestamps.
// Use it to fill in `fieldMap` in config.json - both on first setup and later,
// when Anthropic changes the payload and the widget goes stale.
//
// Does NOT touch the cache. Safe to run ad hoc.

import { readConfig, fetchUsage, resolveEndpoint, redact } from "./lib.mjs";

const PCT_HINT = /(utiliz|usage|used|remaining|percent|pct|ratio|limit|quota)/i;
const TIME_HINT = /(reset|refresh|expire|renew|until|next)/i;

/** Walk the payload and collect leaf paths that smell like our three metrics. */
function suggest(node, path = "", out = { pct: [], time: [] }, depth = 0) {
  if (depth > 8 || node == null) return out;

  if (Array.isArray(node)) {
    node.forEach((v, i) => suggest(v, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      suggest(v, path ? `${path}.${k}` : k, out, depth + 1);
    }
    return out;
  }

  const key = path.split(".").pop() ?? "";

  if (typeof node === "number" && PCT_HINT.test(key)) {
    const guess =
      node >= 0 && node <= 1
        ? "looks 0.0-1.0 -> use scale:100"
        : node >= 0 && node <= 100
          ? "looks 0-100 -> use scale:1"
          : "raw count, not a percentage?";
    out.pct.push({ path, value: node, guess });
  }

  if (typeof node === "string" && (TIME_HINT.test(key) || /^\d{4}-\d{2}-\d{2}T/.test(node))) {
    out.time.push({ path, value: node });
  }
  if (typeof node === "number" && TIME_HINT.test(key) && node > 1e9) {
    out.time.push({ path, value: `${node} (epoch?)` });
  }

  return out;
}

const cfg = readConfig();
console.log(`Probing: ${resolveEndpoint(cfg)}\n`);

const payload = await fetchUsage(cfg);

console.log("=== RAW RESPONSE ===");
console.log(redact(JSON.stringify(payload, null, 2)));

const { pct, time } = suggest(payload);

console.log("\n=== CANDIDATE PERCENTAGE PATHS ===");
if (pct.length) {
  for (const c of pct) console.log(`  ${c.path}  = ${c.value}   (${c.guess})`);
} else {
  console.log("  none found - inspect the raw response above by hand.");
}

console.log("\n=== CANDIDATE RESET-TIME PATHS ===");
if (time.length) {
  for (const c of time) console.log(`  ${c.path}  = ${c.value}`);
} else {
  console.log("  none found - inspect the raw response above by hand.");
}

console.log(`
Next: copy the right paths into fieldMap in config/config.json, e.g.

  "session": { "pct": "five_hour.utilization", "resets_at": "five_hour.resets_at", "scale": 100, "invert": false }

Set invert:true if the value is what's LEFT rather than what's USED.
Then run: node poller/poll.mjs
`);
