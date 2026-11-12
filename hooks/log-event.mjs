#!/usr/bin/env node
// Claude Code hook: append one privacy-minimal line per tool call to
// cache/events.jsonl for the widget's activity map.
//
// Stored per line: ts, event, tool, station, status, sid (8 hex of sha256).
// NEVER stored: tool input/output, commands, file paths, cwd, prompt text.
//
// Must never break or slow Claude: no network, no stdout, always exit 0, every
// error goes to hooks/error.log (gitignored) and is swallowed.

import { appendFileSync, closeSync, openSync, renameSync, statSync, writeSync, constants } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTool, stationForEvent } from "../poller/stations-lib.mjs";

export const MAX_BYTES = 512 * 1024;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL_EVENTS = new Set(["PostToolUse", "PostToolUseFailure", "PermissionDenied"]);
const ERROR_EVENTS = new Set(["PostToolUseFailure", "PermissionDenied"]);
const SAFE_TOOL = /^[A-Za-z0-9_.:-]{1,80}$/;
const STDIN_LIMIT = 4 * 1024 * 1024;

/** Build the stored record from a hook payload, or null for events not logged. */
export function buildRecord(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object") return null;
  const event = payload.hook_event_name;
  if (typeof event !== "string") return null;

  let tool = null;
  let station;
  let status = "ok";
  // PostToolUse fires only on success (no is_error field is documented), so
  // failures come from PostToolUseFailure and refusals from PermissionDenied.
  if (TOOL_EVENTS.has(event)) {
    if (typeof payload.tool_name !== "string") return null;
    // Tool names are server-defined: store only a plain identifier, never free text.
    tool = SAFE_TOOL.test(payload.tool_name) ? payload.tool_name : "invalid";
    station = classifyTool(payload.tool_name, payload.tool_input);
    const r = payload.tool_response;
    if (ERROR_EVENTS.has(event) || (r && typeof r === "object" && r.is_error === true)) status = "err";
  } else {
    station = stationForEvent(event);
    if (!station) return null;
  }
  const sid =
    typeof payload.session_id === "string" && payload.session_id
      ? createHash("sha256").update(payload.session_id).digest("hex").slice(0, 8)
      : null;
  return { ts: now, event, tool, station, status, sid };
}

/** Append one line; rotate first when the file is over MAX_BYTES. */
export function appendRecord(rec, dir = join(ROOT, "cache"), maxBytes = MAX_BYTES) {
  const file = join(dir, "events.jsonl");
  try {
    if (statSync(file).size > maxBytes) renameSync(file, join(dir, "events.1.jsonl"));
  } catch {
    // no file yet
  }
  // O_APPEND + one write() keeps concurrent sessions' lines whole.
  const fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, 0o600);
  try {
    writeSync(fd, JSON.stringify(rec) + "\n");
  } finally {
    closeSync(fd);
  }
}

function logError(err) {
  try {
    // A JSON.parse message quotes the input, so never log it: fixed text only.
    const msg = err instanceof SyntaxError ? "bad stdin JSON" : String(err?.code ?? err?.name ?? "error");
    const dir = process.env.CLAUDE_USAGE_EVENTS_DIR ? join(process.env.CLAUDE_USAGE_EVENTS_DIR, "..") : join(ROOT, "hooks");
    appendFileSync(join(dir, "error.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // nothing left to try
  }
}

async function readStdin() {
  let n = 0;
  const chunks = [];
  for await (const c of process.stdin) {
    n += c.length;
    if (n > STDIN_LIMIT) throw new Error("stdin too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  try {
    const rec = buildRecord(JSON.parse(await readStdin()));
    if (rec) {
      const dir = process.env.CLAUDE_USAGE_EVENTS_DIR || join(ROOT, "cache");
      try {
        appendRecord(rec, dir);
      } catch (err) {
        if (err?.code !== "ENOENT") throw err;
        (await import("node:fs")).mkdirSync(dir, { recursive: true });
        appendRecord(rec, dir);
      }
    }
  } catch (err) {
    logError(err);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().finally(() => process.exit(0));
}
