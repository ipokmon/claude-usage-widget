#!/usr/bin/env node
/**
 * check-sprite-coverage.mjs - proves that exactly one sprite is on screen at
 * every instant, for both actors, in every activity.
 *
 * The failure this exists to catch: the per-activity timelines cross-fade by
 * animating `opacity` on each state with `steps(1)`. If the outgoing state
 * switches off at 56.1% and the incoming switches on at 56.2%, nothing is
 * visible for that 0.1% - which at a 48s cycle is a ~48ms hole and reads on
 * screen as the character flashing out and back.
 *
 * `steps(1)` (i.e. steps(1, end)) means the value on [p_i, p_i+1) is the value
 * declared AT p_i, so a handoff is only seamless when the outgoing state's
 * "off" keyframe and the incoming state's "on" keyframe sit at the SAME
 * percentage. Off-by-one-tenth is invisible in the source and obvious on the
 * desktop.
 *
 * Reports both directions:
 *   GAP   nothing visible  -> the actor flashes off
 *   OVER  2+ visible       -> poses ghost through each other
 *
 *   node tools/check-sprite-coverage.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'widget', 'claude-usage.jsx'), 'utf8');

const ACTOR = { s: 'character', c: 'cat' };

/* Which state of which actor is driven by which keyframes, per activity. Read
 * out of the stylesheet rather than hardcoded, so adding a state cannot leave
 * this check silently behind. */
const driven = {};   // activity -> actor -> [{state, kf}]
const statics = {};  // activity -> actor -> [{state, opacity}]

const animRe = /\[data-activity="(\w+)"\]\s+\.cw-([sc])-([\w-]+)\s*\{\s*animation:\s*([\w-]+)\s/g;
for (let m; (m = animRe.exec(src)); ) {
  const [, activity, kind, state, kf] = m;
  ((driven[activity] ??= {})[ACTOR[kind]] ??= []).push({ state, kf });
}
const staticRe = /\[data-activity="(\w+)"\]\s+\.cw-([sc])-([\w-]+)\s*\{\s*opacity:\s*([\d.]+)/g;
for (let m; (m = staticRe.exec(src)); ) {
  const [, activity, kind, state, op] = m;
  ((statics[activity] ??= {})[ACTOR[kind]] ??= []).push({ state, opacity: parseFloat(op) });
}

/** Opacity stops from one @keyframes block, as sorted [percent, value]. */
function parseOpacity(kf) {
  const at = src.indexOf(`@keyframes ${kf} `);
  if (at < 0) return null;
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return null;
  const body = src.slice(at, end + 1);

  const stops = [];
  const stopRe = /((?:[\d.]+%\s*,?\s*)+)\{\s*opacity\s*:\s*([\d.]+)\s*\}/g;
  for (let m; (m = stopRe.exec(body)); ) {
    const v = parseFloat(m[2]);
    for (const p of m[1].split(',')) {
      const pct = parseFloat(p);
      if (!Number.isNaN(pct)) stops.push([pct, v]);
    }
  }
  if (!stops.length) return null;
  stops.sort((a, b) => a[0] - b[0]);
  return stops;
}

/** steps(1, end): hold the value declared at the last keyframe at or before t. */
function valueAt(stops, t) {
  let v = stops[0][1];
  for (const [p, val] of stops) {
    if (p <= t + 1e-9) v = val;
    else break;
  }
  return v;
}

const DURATIONS = { morning: 26, day: 48, evening: 40, bedtime: 20, night: 0 };
const STEP = 0.01; // percent; 0.01% of 48s is ~5ms, finer than any real handoff

let problems = 0;

for (const activity of Object.keys(DURATIONS)) {
  for (const actor of ['character', 'cat']) {
    const anims = driven[activity]?.[actor] ?? [];
    const stat = statics[activity]?.[actor] ?? [];

    if (!anims.length) {
      const on = stat.filter((s) => s.opacity > 0.5).map((s) => s.state);
      const ok = on.length === 1;
      if (!ok) problems++;
      console.log(
        `${activity.padEnd(8)} ${actor.padEnd(10)} static: ${on.length ? on.join(',') : '(nothing)'}` +
        (ok ? '' : `  !! ${on.length ? 'more than one' : 'nothing'} visible`)
      );
      continue;
    }

    const tracks = anims.map((a) => ({ state: a.state, stops: parseOpacity(a.kf), kf: a.kf }));
    const missing = tracks.filter((t) => !t.stops);
    if (missing.length) {
      console.log(`${activity.padEnd(8)} ${actor.padEnd(10)} !! no opacity stops in ${missing.map((t) => t.kf).join(', ')}`);
      problems += missing.length;
      continue;
    }

    // sweep the cycle, collecting runs where the visible count is not 1
    const runs = [];
    let open = null;
    for (let t = 0; t <= 100 + 1e-9; t += STEP) {
      const on = tracks.filter((tr) => valueAt(tr.stops, t) > 0.5);
      const kind = on.length === 0 ? 'GAP' : on.length > 1 ? 'OVER' : null;
      if (kind && (!open || open.kind !== kind)) {
        if (open) runs.push(open);
        open = { kind, from: t, to: t, who: on.map((o) => o.state).join('+') };
      } else if (kind) {
        open.to = t;
      } else if (open) {
        runs.push(open); open = null;
      }
    }
    if (open) runs.push(open);

    const secs = DURATIONS[activity];
    if (!runs.length) {
      console.log(`${activity.padEnd(8)} ${actor.padEnd(10)} ok - exactly one of ${tracks.length} states visible throughout`);
    } else {
      for (const r of runs) {
        const ms = Math.round(((r.to - r.from + STEP) / 100) * secs * 1000);
        console.log(
          `${activity.padEnd(8)} ${actor.padEnd(10)} !! ${r.kind} ${r.from.toFixed(2)}-${(r.to + STEP).toFixed(2)}% ` +
          `(~${ms}ms)` + (r.kind === 'OVER' ? `  ${r.who}` : '  nothing visible')
        );
        problems++;
      }
    }
  }
}

console.log(
  problems
    ? `\nFAILED - ${problems} coverage problem(s). A GAP is the character flashing off screen.`
    : '\nEvery actor shows exactly one sprite at every instant, in every activity.'
);
process.exit(problems ? 1 : 0);
