#!/usr/bin/env node
//
// Derived stats from this Mac's Claude Code transcripts: streak, top tool,
// peak hour. Writes cache/stats.json next to usage.json; the widget reads both.
//
// SCOPE: ~/.claude/projects only - this machine's Claude Code sessions. Not
// claude.ai chats, not other machines, not cloud sessions. The card says so.
//
// COST: the transcripts run to hundreds of MB, so each file is parsed once and
// its replies and tool calls kept in cache/stats-index.json keyed by path,
// mtime and size. A normal run re-reads only the session file being written.
//
// Run directly (`node poller/stats.mjs`) or let poll.mjs call runStatsIfDue().

import { readdirSync, readFileSync, statSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE_PATH } from "./lib.mjs";
import { topTool, peakHour, streak, firstCompleteDay } from "./stats-lib.mjs";

export const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || join(homedir(), ".claude", "projects");
export const STATS_PATH = join(dirname(CACHE_PATH), "stats.json");
const INDEX_PATH = join(dirname(CACHE_PATH), "stats-index.json");
const INDEX_VERSION = 1;

/** Streak and top tool move on the scale of hours; no need to rescan per poll. */
export const STATS_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Every transcript under the projects dir. Symlinks are SKIPPED, not followed:
 * the workspace move left `-Users-ivanwu-Desktop-claude*` links pointing at the
 * real folders, and following them counts every session twice.
 */
export function listTranscripts(root) {
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      // Explicit, though a Dirent for a link is already neither file nor dir.
      if (ent.isSymbolicLink()) continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
        let st;
        try {
          st = statSync(p);
        } catch (e) {
          if (e.code === "ENOENT") continue; // deleted mid-scan by Claude Code's cleanup
          throw e;
        }
        out.push({ path: p, mtimeMs: st.mtimeMs, size: st.size });
      }
    }
  };
  walk(root);
  return out;
}

/**
 * One transcript -> its replies and tool calls, keyed by their own ids so the
 * same message seen in two files (a resumed session) merges instead of counting
 * twice. A reply is written as several lines, one per content block; the
 * message id ties them together.
 */
export function parseTranscript(text) {
  const replies = {};
  const tools = {};
  let badLines = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      badLines += 1; // a half-written last line of a live session, usually
      continue;
    }
    if (e?.type !== "assistant") continue;
    const ts = Date.parse(e.timestamp ?? "");
    const id = e.message?.id;
    if (Number.isNaN(ts) || !id) continue;
    if (e.message?.model === "<synthetic>") continue; // client-made, not a reply
    replies[id] = ts;
    for (const b of Array.isArray(e.message.content) ? e.message.content : []) {
      if (b?.type === "tool_use" && b.id && b.name) tools[b.id] = [ts, b.name];
    }
  }
  return { replies, tools, badLines };
}

function readIndex() {
  try {
    const idx = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    return idx?.version === INDEX_VERSION ? idx : { version: INDEX_VERSION, files: {} };
  } catch {
    return { version: INDEX_VERSION, files: {} }; // first run, or deleted: rebuild
  }
}

function writeJsonAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj)}\n`, "utf8");
  renameSync(tmp, path);
}

/** A transcript we could not read at all leaves every count short. */
function markPartial(stat, missingFiles) {
  return missingFiles > 0 ? { ...stat, partial: true } : stat;
}

/** Rescan changed files, then compute every stat from the merged index. */
export function computeStats(now = Date.now()) {
  const listed = listTranscripts(PROJECTS_DIR);
  const prev = readIndex();
  const files = {};
  const unreadable = [];
  let reparsed = 0;
  let missingFiles = 0;

  for (const f of listed) {
    const old = prev.files[f.path];
    if (old && old.mtimeMs === f.mtimeMs && old.size === f.size) {
      files[f.path] = old;
      continue;
    }
    try {
      const parsed = parseTranscript(readFileSync(f.path, "utf8"));
      files[f.path] = { mtimeMs: f.mtimeMs, size: f.size, ...parsed };
      reparsed += 1;
    } catch (e) {
      unreadable.push(`${f.path}: ${e.message}`);
      // Last good parse beats nothing; with no previous parse the counts are
      // missing a file, and every stat below is flagged partial.
      if (old) files[f.path] = old;
      else missingFiles += 1;
    }
  }
  writeJsonAtomic(INDEX_PATH, { version: INDEX_VERSION, files });

  const replies = new Map();
  const tools = new Map();
  let badLines = 0;
  for (const entry of Object.values(files)) {
    for (const [id, ts] of Object.entries(entry.replies)) replies.set(id, ts);
    for (const [id, [ts, name]] of Object.entries(entry.tools)) tools.set(id, { ts, name });
    badLines += entry.badLines;
  }

  const oldest = listed.length ? Math.min(...listed.map((f) => f.mtimeMs)) : undefined;
  const complete = firstCompleteDay(oldest);
  const replyTimes = [...replies.values()];

  return {
    schema: 1,
    computed_at: new Date(now).toISOString(),
    scope: "this Mac's Claude Code transcripts",
    first_complete_day: complete,
    streak: markPartial(streak(replyTimes, now, complete), missingFiles),
    top_tool: markPartial(topTool([...tools.values()], now, complete), missingFiles),
    peak_hour: markPartial(peakHour(replyTimes, now, complete), missingFiles),
    scanned: {
      files: listed.length,
      reparsed,
      replies: replies.size,
      tool_calls: tools.size,
      bad_lines: badLines,
      unreadable,
    },
    last_error: unreadable.length ? `${unreadable.length} transcript(s) unreadable` : null,
  };
}

function readStats() {
  try {
    return JSON.parse(readFileSync(STATS_PATH, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Recompute when the last result is older than STATS_INTERVAL_MS. A failure
 * keeps the previous numbers and records the error on them, the same contract
 * usage.json has: never blank good data because one run failed.
 * Returns the error message, or null.
 */
export function runStatsIfDue(now = Date.now(), { force = false } = {}) {
  const prev = readStats();
  const age = now - Date.parse(prev?.computed_at ?? "");
  if (!force && age >= 0 && age < STATS_INTERVAL_MS) return null;
  try {
    writeJsonAtomic(STATS_PATH, computeStats(now));
    return null;
  } catch (e) {
    const msg = `stats scan failed: ${e.message}`;
    try {
      writeJsonAtomic(STATS_PATH, {
        ...(prev ?? { schema: 1 }),
        computed_at: prev?.computed_at ?? null,
        last_error: msg,
        last_error_at: new Date(now).toISOString(),
      });
    } catch (writeErr) {
      return `${msg}; could not record it either: ${writeErr.message}`;
    }
    return msg;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const err = runStatsIfDue(Date.now(), { force: true });
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const s = readStats();
  console.log(JSON.stringify({ ...s, scanned: { ...s.scanned, unreadable: s.scanned.unreadable.length } }, null, 2));
}
