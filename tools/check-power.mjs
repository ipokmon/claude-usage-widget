#!/usr/bin/env node
// Battery mode (SPEC AC1-AC5): on battery the room freezes and the card drops
// its blur. Reads the real widget source, so it cannot drift from it.
//
//   node tools/check-power.mjs

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "widget", "claude-usage.jsx"), "utf8");

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures += 1;
};

/** Source of a top-level declaration, from its first line to the closing `}`/`;` at column 0. */
function topLevel(startsWith, end) {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error(`not found in widget: ${startsWith}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`no end ${JSON.stringify(end)} after: ${startsWith}`);
  return src.slice(i, j + end.length);
}

// ---- AC2: powerSourceFor ---------------------------------------------------
const powerSourceFor = new Function(`${topLevel("function powerSourceFor(", "\n}")}; return powerSourceFor;`)();
const cases = [
  ["Now drawing from 'Battery Power'", "battery"],
  ["Now drawing from 'AC Power'", "ac"],
  ["Now drawing from 'UPS Power'", "ac"],
  ["\nNow drawing from 'Battery Power'\n", "battery"],
  ["", null],
  [undefined, null],
  ["pmset: command not found", null],
];
for (const [input, want] of cases) {
  check(powerSourceFor(input) === want, `powerSourceFor(${JSON.stringify(input)}) === ${JSON.stringify(want)}`);
}

// ---- AC1: command emits a power segment, and render splits it off ----------
const consts = ["const STATS_SEPARATOR", "const POWER_SEPARATOR"].map((s) => topLevel(s, ";\n")).join("\n");
// `return` would hit ASI before the expression's first line break, so rebind it.
const commandDecl = topLevel("export const command =", ";\n").replace("export const command =", "const command =");
const command = new Function(`const PROJECT = ${JSON.stringify(ROOT)};\n${consts}\n${commandDecl}\nreturn command;`)();
const run = spawnSync("/bin/sh", ["-c", command], { encoding: "utf8" });
check(run.status === 0, `command exits 0 (got ${run.status}: ${run.stderr.trim()})`);

const POWER_SEPARATOR = new Function(`${consts}; return POWER_SEPARATOR;`)();
const STATS_SEPARATOR = new Function(`${consts}; return STATS_SEPARATOR;`)();
// Mirror render's split exactly; check the real render uses the same two lines.
const [usageRaw = "", rest = ""] = run.stdout.split(STATS_SEPARATOR);
const [statsRaw = "", powerRaw = ""] = rest.split(POWER_SEPARATOR);
check(
  src.includes('const [usageRaw = "", rest = ""] = (output || "").split(STATS_SEPARATOR);') &&
    src.includes('const [statsRaw = "", powerRaw = ""] = rest.split(POWER_SEPARATOR);'),
  "render splits usage | stats | power in that order",
);
check(!statsRaw.includes("pmset") && !statsRaw.includes("Power'"), "power line does not leak into stats segment");
check(!usageRaw.includes(POWER_SEPARATOR), "power separator does not leak into usage segment");
// Needs pmset (any Mac). The expected value comes from pmset directly, so a
// wrong mapping fails on whichever power source the machine is on right now.
const pmset = spawnSync("/bin/sh", ["-c", "pmset -g batt | head -n 1"], { encoding: "utf8" }).stdout;
const expected = pmset.includes("'Battery Power'") ? "battery" : "ac";
const live = powerSourceFor(powerRaw);
check(live === expected, `live pmset line parses to ${expected} (got ${JSON.stringify(live)} from ${JSON.stringify(powerRaw.trim())})`);
for (const raw of [usageRaw.trim(), statsRaw.trim()]) {
  let ok = true;
  try {
    JSON.parse(raw);
  } catch {
    ok = false;
  }
  check(ok, `segment still parses as JSON: ${raw.slice(0, 40)}...`);
}

// ---- AC3: root carries data-power, null renders no attribute ---------------
check(src.includes("data-power={power ?? undefined}"), ".cw-root sets data-power, omitting it for null");

// ---- AC4 / AC5: CSS --------------------------------------------------------
const css = topLevel("const CSS = `", "`;");
const norm = css.replace(/\s+/g, " ");
check(
  norm.includes(
    '.cw-root[data-power="battery"] *, .cw-root[data-power="battery"] *::before, .cw-root[data-power="battery"] *::after { animation-play-state: paused !important; }',
  ),
  "battery pauses every animation, pseudo-elements included, beating inline styles",
);
check(
  /\.cw-root\[data-power="battery"\] \.cw-card \{ -webkit-backdrop-filter: none; backdrop-filter: none; \}/.test(norm),
  "battery removes both backdrop-filter properties from the card",
);
const alpha = (re) => {
  const m = norm.match(re);
  return m ? Number(m[1]) : NaN;
};
for (const theme of ["light", "dark"]) {
  const ac = alpha(new RegExp(`\\.cw-root\\[data-theme="${theme}"\\] \\{[^}]*--card-bg: rgba\\([^)]*,([0-9.]+)\\)`));
  const batt = alpha(
    new RegExp(`\\.cw-root\\[data-power="battery"\\]\\[data-theme="${theme}"\\] \\{ --card-bg: rgba\\([^)]*,([0-9.]+)\\)`),
  );
  check(batt > ac, `${theme}: battery card alpha ${batt} > AC alpha ${ac}`);
}
// AC6: the battery block cannot change anything on AC. Every selector in it
// requires data-power="battery". (At build time the CSS minus this block was
// also diffed against abba21e and was identical; that diff is not repeated
// here because it would fail on every later, unrelated CSS edit.)
const BLOCK_START = "/* ---- battery mode ----";
const blockAt = css.indexOf(BLOCK_START);
const blockEnd = css.indexOf(".cw-header {", blockAt);
check(blockAt > 0 && blockEnd > blockAt, "battery block found as one contiguous region");
const block = css.slice(blockAt, blockEnd).replace(/\/\*[\s\S]*?\*\//g, "");
const selectors = [...block.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
check(
  selectors.length > 0 && selectors.every((s) => s.startsWith('.cw-root[data-power="battery"]')),
  `every battery-block selector requires data-power="battery" (${selectors.length} selectors)`,
);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall power checks passed");
