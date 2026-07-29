#!/usr/bin/env node
/**
 * check-cat-rules.mjs - asserts the cat's movement rules against the actual
 * CSS in the widget, rather than trusting that the hand-written percentages
 * still line up.
 *
 *   rule 1  the cat only TRAVERSES while the character is standing still
 *   rule 2  it does not traverse during every such window
 *   rule 3  its range is shorter than the character's
 *
 * Rules 1 and 3 are hard failures. Rule 2 is reported, since "some but not
 * all" is a judgement call that only needs to stay true in spirit.
 *
 * Both actors' positions come from the same `translateX` keyframes the browser
 * uses, sampled on a shared clock - the timelines share a duration per
 * activity, which is what makes the windows comparable at all. Retiming a
 * character walk without retiming the cat will fail this.
 *
 *   node tools/check-cat-rules.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'widget', 'claude-usage.jsx'), 'utf8');

const ACTIVITIES = [
  { name: 'morning', seconds: 26, actor: 'cw-mor-move', cat: 'cw-cat-mor-move' },
  { name: 'day', seconds: 48, actor: 'cw-day-move', cat: 'cw-cat-day-move' },
  { name: 'evening', seconds: 40, actor: 'cw-eve-move', cat: 'cw-cat-eve-move' },
  { name: 'bedtime', seconds: 20, actor: 'cw-bed-move', cat: null },
  { name: 'night', seconds: 0, actor: null, cat: null },
];

/** Pull one @keyframes block out and return sorted [percent, x] stops. */
function parseTrack(name) {
  const at = src.indexOf(`@keyframes ${name} {`);
  if (at < 0) return null;

  // Walk to the matching brace: a keyframes block contains one nested block per
  // stop, so stopping at the first '}' would only ever see the first stop.
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return null;
  const body = src.slice(at, end + 1);

  // Each stop is its own line:  0%,49.5%   { transform: translateX(30px); }
  // The ^ anchor matters: without it the percent group happily backtracks to a
  // single space and every percentage parses as NaN.
  const stops = [];
  const rule = /^\s*([\d.%,\s]+?)\s*\{[^}]*translateX\((-?[\d.]+)px\)/gm;
  let m;
  while ((m = rule.exec(body))) {
    const x = parseFloat(m[2]);
    for (const p of m[1].split(',')) {
      const pct = parseFloat(p);
      if (!Number.isNaN(pct)) stops.push([pct, x]);
    }
  }
  if (!stops.length) return null;
  stops.sort((a, b) => a[0] - b[0]);
  return stops;
}

/** Linear interpolation, matching how the browser tweens between stops. */
function xAt(stops, pct) {
  if (pct <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (pct <= stops[i][0]) {
      const [p0, x0] = stops[i - 1], [p1, x1] = stops[i];
      if (p1 === p0) return x1;
      return x0 + ((x1 - x0) * (pct - p0)) / (p1 - p0);
    }
  }
  return stops[stops.length - 1][1];
}

/** Contiguous [from,to] windows where the track is actually travelling. */
function movingWindows(stops, step = 0.05, eps = 1e-6) {
  if (!stops) return [];
  const out = [];
  let open = null;
  for (let p = 0; p < 100; p += step) {
    const moving = Math.abs(xAt(stops, p + step) - xAt(stops, p)) > eps;
    if (moving && open === null) open = p;
    if (!moving && open !== null) { out.push([open, p]); open = null; }
  }
  if (open !== null) out.push([open, 100]);
  return out;
}

const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
const range = (stops) => {
  if (!stops) return 0;
  const xs = stops.map((s) => s[1]);
  return Math.max(...xs) - Math.min(...xs);
};
const fmt = (w) => `${w[0].toFixed(1)}-${w[1].toFixed(1)}%`;

let failures = 0;
let catEverStill = false;

for (const a of ACTIVITIES) {
  const actor = a.actor ? parseTrack(a.actor) : null;
  const cat = a.cat ? parseTrack(a.cat) : null;

  if (a.actor && !actor) {
    console.log(`${a.name.padEnd(8)} !! keyframes ${a.actor} not found`);
    failures++;
    continue;
  }
  if (a.cat && !cat) {
    console.log(`${a.name.padEnd(8)} !! keyframes ${a.cat} not found`);
    failures++;
    continue;
  }

  const actorMoves = movingWindows(actor);
  const catMoves = movingWindows(cat);
  const clashes = [];
  for (const cw of catMoves) {
    for (const aw of actorMoves) {
      if (overlap(cw, aw) > 0.05) clashes.push([cw, aw]);
    }
  }

  const stillButStill = catMoves.length === 0 && (actorMoves.length > 0 || !a.actor);
  if (stillButStill) catEverStill = true;

  console.log(
    `${a.name.padEnd(8)} ${String(a.seconds).padStart(2)}s  ` +
    `character moves ${actorMoves.length ? actorMoves.map(fmt).join(' ') : '(never)'}  ` +
    `| cat moves ${catMoves.length ? catMoves.map(fmt).join(' ') : '(never)'}  ` +
    `| range ${range(actor).toFixed(0)}px vs ${range(cat).toFixed(0)}px`
  );

  for (const [cw, aw] of clashes) {
    console.log(`         !! RULE 1: cat travels ${fmt(cw)} while the character travels ${fmt(aw)}`);
    failures++;
  }
  if (cat && range(cat) >= range(actor)) {
    console.log(`         !! RULE 3: cat range ${range(cat)}px is not shorter than ${range(actor)}px`);
    failures++;
  }
}

// Rule 2, stated across the whole day rather than per activity: there has to be
// at least one activity where the character stands still and the cat still
// stays put, otherwise "only when idle" has quietly become "whenever idle".
console.log(
  catEverStill
    ? '\nrule 2 ok: at least one activity leaves the cat parked throughout'
    : '\n!! RULE 2: the cat travels in every activity - it should sit some out'
);
if (!catEverStill) failures++;

console.log(failures ? `\nFAILED (${failures})` : '\nAll cat movement rules hold.');
process.exit(failures ? 1 : 0);
