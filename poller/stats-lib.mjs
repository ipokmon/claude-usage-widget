// Pure functions behind the widget's derived stats: weekly pace, streak, top
// tool and peak hour. No I/O and no clock reads - every function takes `now`
// as an argument - so tools/check-stats.mjs can pin each boundary.
//
// Null-vs-zero: a stat that cannot be computed honestly comes back with a
// `status` naming why ("too_early", "insufficient", "unknown"), never as 0.

const HOUR_MS = 3600 * 1000;

/** Projections in the first day of the week swing wildly on one session. */
export const PACE_MIN_ELAPSED_MS = 24 * HOUR_MS;

export const TOP_TOOL_WINDOW_DAYS = 7;
export const PEAK_HOUR_WINDOW_DAYS = 14;

/** Below this many replies, "your busiest hour" is noise. */
export const PEAK_HOUR_MIN_SAMPLE = 20;

/**
 * Where the weekly limit is heading if the rest of the window goes like the
 * part already behind us: a straight-line projection of used % at reset.
 *
 * Window bounds come from the payload itself (start and reset), not an assumed
 * 7 days, so a changed window length cannot skew the fraction.
 *
 * @param {{ pct: number|null, windowStart: string|null, resetsAt: string|null, now: number }} input
 * @returns {{ status: "ok", projected_pct: number, limit_at: string|null, elapsed_fraction: number }
 *          | { status: "at_limit" | "too_early" | "unknown" }}
 */
export function paceFor({ pct, windowStart, resetsAt, now }) {
  if (typeof pct !== "number" || Number.isNaN(pct)) return { status: "unknown" };
  const start = Date.parse(windowStart ?? "");
  const end = Date.parse(resetsAt ?? "");
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return { status: "unknown" };

  const elapsed = now - start;
  if (elapsed < 0 || now > end) return { status: "unknown" };
  if (pct >= 100) return { status: "at_limit" };
  if (elapsed < PACE_MIN_ELAPSED_MS) return { status: "too_early" };

  const fraction = elapsed / (end - start);
  const projected = pct / fraction;
  // When the line crosses 100% before the reset, say when.
  const limitMs = pct > 0 ? start + (elapsed * 100) / pct : null;
  const limitAt = limitMs !== null && limitMs <= end ? new Date(Math.max(limitMs, now)).toISOString() : null;

  return {
    status: "ok",
    projected_pct: Math.round(projected),
    limit_at: limitAt,
    elapsed_fraction: Number(fraction.toFixed(4)),
  };
}

/** Local calendar date, "YYYY-MM-DD". Local because "a day" means your day. */
export function localDateKey(ms) {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * The `days` local calendar dates ending today, newest first. Stepped by
 * calendar date rather than 24h so a DST change cannot skip or repeat a day.
 */
export function recentDateKeys(now, days) {
  return Array.from({ length: days }, (_, i) => dateKeyDaysAgo(now, i));
}

function dateKeyDaysAgo(now, i) {
  const t = new Date(now);
  return localDateKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() - i).getTime());
}

/**
 * Does the transcript record cover every one of these dates? Claude Code
 * deletes old transcripts, so a window reaching past the oldest complete day
 * is computed from part of the data and must say so.
 */
function windowCovered(keys, firstCompleteDay) {
  return firstCompleteDay !== null && keys[keys.length - 1] >= firstCompleteDay;
}

/** `mcp__server__tool` reads as just `tool` on a 350px card. */
export function shortToolName(name) {
  const parts = String(name).split("__");
  return parts.length >= 3 && parts[0] === "mcp" ? parts.slice(2).join("__") : String(name);
}

/**
 * Most-called tool over the last `days` local dates. Every tool call counts,
 * Claude's own bookkeeping tools included: filtering some out would be a
 * definition nobody can see on the card.
 *
 * @param {Array<{ ts: number, name: string }>} calls  deduplicated tool calls
 */
export function topTool(calls, now, firstCompleteDay, days = TOP_TOOL_WINDOW_DAYS) {
  const keys = recentDateKeys(now, days);
  const inWindow = new Set(keys);
  const counts = new Map();
  for (const c of calls) {
    if (c.ts > now || !inWindow.has(localDateKey(c.ts))) continue;
    counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return { status: "insufficient", window_days: days, total: 0 };

  // Ties break alphabetically so the answer is stable between scans.
  const [name, count] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return {
    status: "ok",
    name,
    display_name: shortToolName(name),
    count,
    total,
    window_days: days,
    partial: !windowCovered(keys, firstCompleteDay),
  };
}

/**
 * Local hour (0-23) with the most Claude replies over the last `days` dates.
 * Replies, not prompts: one prompt can drive an hour of agentic work.
 *
 * @param {number[]} replyTimes  deduplicated assistant-message timestamps
 */
export function peakHour(replyTimes, now, firstCompleteDay, days = PEAK_HOUR_WINDOW_DAYS, minSample = PEAK_HOUR_MIN_SAMPLE) {
  const keys = recentDateKeys(now, days);
  const inWindow = new Set(keys);
  const byHour = new Array(24).fill(0);
  let sample = 0;
  for (const ts of replyTimes) {
    if (ts > now || !inWindow.has(localDateKey(ts))) continue;
    byHour[new Date(ts).getHours()] += 1;
    sample += 1;
  }
  if (sample < minSample) return { status: "insufficient", sample, window_days: days };

  // Earliest hour wins a tie.
  const count = Math.max(...byHour);
  return {
    status: "ok",
    hour: byHour.indexOf(count),
    count,
    sample,
    window_days: days,
    partial: !windowCovered(keys, firstCompleteDay),
  };
}

/**
 * Consecutive local days with at least one Claude reply, ending today. A day
 * with nothing yet does not break the streak until it is over, so the run may
 * end yesterday (`active_today: false`).
 *
 * `capped` means the run reaches the oldest day the transcripts fully cover:
 * the true streak is at least `days` and may be longer.
 */
export function streak(replyTimes, now, firstCompleteDay) {
  const active = new Set();
  for (const ts of replyTimes) if (ts <= now) active.add(localDateKey(ts));

  const keyAt = (i) => dateKeyDaysAgo(now, i);
  const activeToday = active.has(keyAt(0));

  let i = activeToday ? 0 : 1;
  let days = 0;
  while (active.has(keyAt(i))) {
    days += 1;
    i += 1;
  }
  const earliest = days > 0 ? keyAt(i - 1) : null;
  const capped = earliest !== null && (firstCompleteDay === null || earliest <= firstCompleteDay);
  return { status: "ok", days, active_today: activeToday, capped };
}

/**
 * The first local date the transcript record is complete for. Claude Code
 * deletes a transcript once its last write (mtime) ages out, so every file
 * holding activity on a day after the oldest surviving file's mtime still
 * exists; that mtime's own day may have lost a file.
 */
export function firstCompleteDay(oldestMtimeMs) {
  if (typeof oldestMtimeMs !== "number" || !Number.isFinite(oldestMtimeMs)) return null;
  const d = new Date(oldestMtimeMs);
  return localDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime());
}
