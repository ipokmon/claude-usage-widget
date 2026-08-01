#!/usr/bin/env node
/**
 * check-seasons.mjs - asserts that the four places defining a seasonal
 * decoration still agree with each other:
 *
 *   1. BUILD in tools/propgen.mjs   the art exists, and was generated
 *   2. SEASONS in the widget        the month maps to a name
 *   3. SEASONAL_PROPS in the widget the prop is hidden by default
 *   4. the stylesheet               a `.cw-prop-*` position rule, and a
 *                                   `[data-season="..."]` show rule
 *
 * Miss 1, 2 or 4 and the decoration is simply absent, which you notice. Miss 3
 * and it is the other way round: `.cw-seasonal { opacity: 0 }` is the only
 * thing holding these off screen, so a prop that has a position and a show rule
 * but no SEASONAL_PROPS membership is not missing at all - it is on screen
 * every day of the year, next to whatever this month's decoration is. That
 * asymmetry is what this checker exists for, because that failure does not look
 * like a bug, it looks like the room.
 *
 * Everything is read out of the real sources - propgen's BUILD, the generated
 * PROPS block, the SEASONS array, the Set, and the CSS the browser actually
 * applies - so it cannot drift the way a second copy of the month list would.
 *
 *   node tools/check-seasons.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const widget = readFileSync(join(HERE, '..', 'widget', 'claude-usage.jsx'), 'utf8');
const propgen = readFileSync(join(HERE, 'propgen.mjs'), 'utf8');

/* The two seasons that are not props at all, and what they are instead. Both
 * must stay OUT of SEASONAL_PROPS: `lights` is the permanent ceiling string
 * (putting it in the Set would hide the string for the other eleven months),
 * and `frost` has no prop to hide. */
const NON_PROP = new Map([
  ['frost', 'CSS overlay over the window (.cw-frost)'],
  ['lights', 'a filter on the permanent ceiling string'],
]);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Body of the brace block that opens at or after `from`. */
function braceBlock(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

/**
 * Top-level keys of an object literal, one per source line. The line anchor is
 * what makes this safe: it skips nested keys (`{ w: 326, h: 16 }` on the same
 * line as its prop) and commented-out entries alike - propgen keeps `plant`
 * parked behind a `//` and it must not count as generated art.
 */
function objectKeys(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return null;
  const body = braceBlock(src, at);
  if (body === null) return null;
  return [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
}

/** Quoted strings from a bracketed literal - the SEASONS array, the Set. */
function stringList(src, decl, close) {
  const at = src.indexOf(decl);
  if (at < 0) return null;
  const end = src.indexOf(close, at);
  if (end < 0) return null;
  return [...src.slice(at + decl.length, end).matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

const propNames = objectKeys(widget, 'const PROPS = {');
const buildNames = objectKeys(propgen, 'const BUILD = {');
const seasons = stringList(widget, 'const SEASONS = [', '];');
const seasonalList = stringList(widget, 'const SEASONAL_PROPS = new Set([', ']);');

for (const [what, got] of [
  ['PROPS block in widget/claude-usage.jsx', propNames],
  ['BUILD in tools/propgen.mjs', buildNames],
  ['SEASONS in widget/claude-usage.jsx', seasons],
  ['SEASONAL_PROPS in widget/claude-usage.jsx', seasonalList],
]) {
  if (!got || !got.length) {
    console.log(`!! could not parse ${what} - has it been renamed?`);
    process.exit(1);
  }
}

const props = new Set(propNames);
const build = new Set(buildNames);
const seasonal = new Set(seasonalList);

/* The stylesheet is one template literal, so it ends at the next backtick.
 * Comments come out first: they name classes in prose ("`.cw-floor` sits at
 * 21px") and would otherwise read as selectors. */
const cssAt = widget.indexOf('const CSS = ');
const cssOpen = widget.indexOf('`', cssAt);
const cssClose = widget.indexOf('`', cssOpen + 1);
if (cssAt < 0 || cssClose < 0) {
  console.log('!! could not find the CSS template literal in widget/claude-usage.jsx');
  process.exit(1);
}
const css = widget.slice(cssOpen + 1, cssClose).replace(/\/\*[\s\S]*?\*\//g, '');

/* Flat `selectors { declarations }` pairs. Nested blocks (@keyframes stops)
 * match as their own inner rules, which is harmless - none of them carry a
 * .cw-prop- selector. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1], body: m[2] }));

const decl = (body, prop) => body.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`))?.[1].trim();

/** name -> "left:Xpx bottom:Ypx", from whichever rule actually places it. */
const placed = new Map();
for (const { sel, body } of rules) {
  const left = decl(body, 'left');
  const bottom = decl(body, 'bottom');
  if (left === undefined || bottom === undefined) continue;
  for (const m of sel.matchAll(/\.cw-prop-(\w+)/g)) placed.set(m[1], `left:${left} bottom:${bottom}`);
}

/** season -> prop, from the `{ opacity: 1 }` show-rule selector list. */
const shown = new Map();
for (const { sel, body } of rules) {
  if (!/(?:^|[;{\s])opacity\s*:\s*1\s*(?:;|$)/.test(body)) continue;
  for (const m of sel.matchAll(/\[data-season="([\w-]+)"\]\s*\.cw-prop-(\w+)/g)) shown.set(m[1], m[2]);
}

/** Every season the CSS mentions at all - enough for the two non-prop ones. */
const styled = new Set([...css.matchAll(/\[data-season="([\w-]+)"\]/g)].map((m) => m[1]));

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

let failures = 0;
let permanentScenery = false; // the asymmetric failure, called out again at the end
const fail = (msg) => { console.log(`         !! ${msg}`); failures++; };

for (let i = 0; i < Math.max(seasons.length, MONTHS.length); i++) {
  const name = seasons[i];
  const month = MONTHS[i] ?? `#${i + 1}`;
  if (name === undefined) {
    console.log(`${month}  (missing)`);
    fail(`SEASONS has no entry for ${month} - that month would render undecorated`);
    continue;
  }

  const label = `${month}  ${name.padEnd(11)}`;

  if (NON_PROP.has(name)) {
    console.log(`${label} non-prop  ${NON_PROP.get(name)}`);
    if (!styled.has(name)) fail(`no [data-season="${name}"] rule in the CSS - nothing would appear`);
    if (seasonal.has(name)) {
      fail(`"${name}" is in SEASONAL_PROPS, but it is not a seasonal prop - .cw-seasonal would hide it`);
    }
    continue;
  }

  if (!props.has(name)) {
    console.log(`${label} MISSING`);
    fail(`"${name}" is neither a key in PROPS nor one of ${[...NON_PROP.keys()].join('/')} - ` +
         `the widget silently shows nothing. Add it to BUILD in tools/propgen.mjs and re-run it.`);
    continue;
  }

  const isSeasonal = seasonal.has(name);
  const pos = placed.get(name);
  const show = shown.get(name);
  const ok = isSeasonal && pos && show === name;

  console.log(
    `${label} prop      ` +
    `${isSeasonal ? 'SEASONAL_PROPS ok' : 'NOT SEASONAL'}  ` +
    `${(pos ?? 'no position').padEnd(28)}  ` +
    `${show === name ? 'show-rule ok' : show ? `show-rule -> ${show}` : 'no show-rule'}` +
    (ok ? '' : '  <-')
  );

  // The asymmetric one: this is the failure that renders as permanent scenery.
  if (!isSeasonal) {
    fail(`"${name}" is missing from SEASONAL_PROPS, so it never gets .cw-seasonal - ` +
         `it is visible EVERY DAY OF THE YEAR, not just in ${month}`);
    permanentScenery = true;
  }
  if (!pos) fail(`no .cw-prop-${name} rule carrying both left: and bottom: - it would sit at 0,0`);
  if (!show) fail(`"${name}" is not in the [data-season=...] show-rule list - it would never turn on`);
  else if (show !== name) fail(`[data-season="${name}"] switches on .cw-prop-${show}, not .cw-prop-${name}`);
}

// Seasonal props no month asks for: hidden by .cw-seasonal and never switched
// on, so they are dead weight rather than a visible fault - but still wrong.
for (const name of seasonal) {
  if (NON_PROP.has(name) || seasons.includes(name)) continue;
  console.log(`--   ${name.padEnd(11)} orphan`);
  fail(`"${name}" is in SEASONAL_PROPS but in no month of SEASONS - hidden all year`);
  if (!props.has(name)) fail(`"${name}" is not in PROPS either - <Prop> renders nothing for it`);
  else if (!placed.has(name)) fail(`no .cw-prop-${name} rule carrying both left: and bottom:`);
}

console.log('');

if (seasons.length !== 12) {
  console.log(`!! SEASONS has ${seasons.length} entries, not 12`);
  failures++;
} else {
  console.log('12 months, one entry each.');
}

const dupes = seasons.filter((n, i) => seasons.indexOf(n) !== i);
if (dupes.length) {
  console.log(`!! SEASONS repeats: ${[...new Set(dupes)].join(', ')} - two months share one decoration`);
  failures++;
} else {
  console.log('No repeated season names.');
}

/* The generated block is only as fresh as the last propgen run: a name added to
 * BUILD but not present in PROPS means nobody re-ran the generator. */
const ungenerated = [...build].filter((n) => !props.has(n));
const orphanArt = propNames.filter((n) => !build.has(n));
if (ungenerated.length) {
  console.log(`!! in propgen's BUILD but not in the PROPS block: ${ungenerated.join(', ')} - run: node tools/propgen.mjs`);
  failures++;
}
if (orphanArt.length) {
  console.log(`!! in the PROPS block but not in propgen's BUILD: ${orphanArt.join(', ')} - stale generated art`);
  failures++;
}
if (!ungenerated.length && !orphanArt.length) {
  console.log(`PROPS block matches propgen's BUILD (${props.size} props).`);
}

console.log(
  failures
    ? `\nFAILED (${failures})` +
      (permanentScenery
        ? ' - and note that the SEASONAL_PROPS one is not a missing decoration:\n' +
          '   that prop is on screen every day of the year until it is fixed.'
        : '')
    : '\nEvery season agrees across propgen, SEASONS, SEASONAL_PROPS and the CSS.'
);
process.exit(failures ? 1 : 0);
