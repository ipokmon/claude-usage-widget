#!/usr/bin/env node
// Activity map: classifier, aggregation, hook privacy, rotation, never-throws.
//
//   node tools/check-activity.mjs

import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { classifyTool, stationForEvent, STATIONS } from "../poller/stations-lib.mjs";
import { buildRecord, appendRecord, MAX_BYTES } from "../hooks/log-event.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "hooks", "log-event.mjs");
// The widget cannot import modules, so its aggregation is tested where it lives.
const widget = readFileSync(join(ROOT, "widget", "claude-usage.jsx"), "utf8");
function grab(startsWith, end) {
  const i = widget.indexOf(startsWith);
  const j = i < 0 ? -1 : widget.indexOf(end, i);
  if (j < 0) throw new Error(`not found in widget: ${startsWith}`);
  return widget.slice(i, j + end.length);
}
const { parseEvents, aggregate, ACT_STATIONS, ACT_WINDOW_MS } = new Function(
  [
    grab("const ACT_WINDOW_MS", ";"),
    grab("const ACT_PULSE_MS", ";"),
    grab("const ACT_STATIONS", ";"),
    grab("function parseEvents(", "\n}"),
    grab("function aggregate(", "\n}"),
    "return { parseEvents, aggregate, ACT_STATIONS, ACT_WINDOW_MS };",
  ].join("\n"),
)();
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures += 1;
};
const eq = (got, want, msg) => check(JSON.stringify(got) === JSON.stringify(want), `${msg}${JSON.stringify(got) === JSON.stringify(want) ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);

console.log("classifier");
for (const t of ["Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit"]) eq(classifyTool(t, { file_path: "/x/y.txt" }), "files", `${t} -> files`);
eq(classifyTool("Bash"), "shell", "Bash -> shell");
eq(classifyTool("WebFetch"), "web", "WebFetch -> web");
eq(classifyTool("WebSearch"), "web", "WebSearch -> web");
eq(classifyTool("mcp__Claude_Browser__navigate"), "browser", "built-in browser -> browser");
eq(classifyTool("mcp__claude-in-chrome__computer"), "browser", "chrome -> browser");
eq(classifyTool("Agent"), "agents", "Agent -> agents");
eq(classifyTool("TaskCreate"), "agents", "Task* -> agents");
eq(classifyTool("Skill"), "skills", "Skill -> skills");
eq(classifyTool("mcp__memory__store"), "memory", "mcp memory -> memory");
eq(classifyTool("mcp__basic-Memory__read"), "memory", "memory match is case-insensitive");
eq(classifyTool("Write", { file_path: "/Users/a/.claude/projects/-p/memory/x.md" }), "memory", "Write into memory dir -> memory");
eq(classifyTool("Edit", { file_path: "/Users/a/.claude/projects/-p/memory/x.md" }), "memory", "Edit into memory dir -> memory");
eq(classifyTool("Read", { file_path: "/Users/a/.claude/projects/-p/memory/x.md" }), "files", "Read of a memory file stays files");
eq(classifyTool("Write", { file_path: "/Users/a/.claude/projects/-p/other.md" }), "files", "Write outside memory/ -> files");
eq(classifyTool("Write", { file_path: "/a/.claude/projects/p/memory/../../../x" }), "files", "traversal out of memory/ -> files");
eq(classifyTool("Write", null), "files", "Write with no input -> files");
eq(classifyTool("mcp__vercel__list_projects"), "web", "other mcp -> web");
eq(classifyTool("SomethingNew"), "other", "unknown -> other");
eq(classifyTool(undefined), "other", "non-string -> other");
eq(classifyTool(""), "other", "empty -> other");
eq(stationForEvent("UserPromptSubmit"), "you", "UserPromptSubmit -> you");
eq(stationForEvent("Stop"), "model", "Stop -> model");
eq(stationForEvent("SessionStart"), null, "unlogged event -> null");
check(STATIONS.length === 10, "ten stations");
eq(ACT_STATIONS, STATIONS, "widget stations match the classifier's list");
check(ACT_WINDOW_MS === 15 * 60 * 1000, "window is 15 min");
check(/@@CW_EVENTS@@[\s\S]*tail -n \$\{EVENTS_TAIL_LINES\}/.test(widget), "widget command reads only the log tail");
check(!/<>|<\/>/.test(widget), "no JSX fragments in widget");

console.log("aggregation");
const NOW = 1_000_000_000;
const ev = (agoS, station, status = "ok") => ({ ts: NOW - agoS * 1000, station, status });
{
  const a = aggregate([ev(1, "files"), ev(30, "files", "err"), ev(100, "shell"), ev(16 * 60, "web"), ev(-5, "web")], NOW);
  eq(a.byStation.files.count, 2, "counts per station");
  eq(a.byStation.files.errors, 1, "errors counted");
  eq(a.byStation.files.lastTs, NOW - 1000, "last hit");
  eq(a.byStation.web.count, 0, "older than window and future events are excluded");
  eq(a.total, 3, "total");
  eq(a.max, 2, "max");
  check(a.byStation.files.pulsing && !a.byStation.shell.pulsing, "pulse only within PULSE_MS");
  eq(aggregate([ev(1, "bogus")], NOW).total, 0, "unknown station ignored");
  const pr = aggregate([ev(1, "__proto__"), ev(1, "constructor"), ev(1, "files")], NOW);
  eq([pr.total, pr.max], [1, 1], "prototype-key stations are ignored, not counted");
  eq(aggregate([], NOW).total, 0, "empty -> zero");
}
{
  const p = parseEvents(`${JSON.stringify(ev(1, "files"))}\nnot json\n{"ts":"x","station":"files"}\n\n[]\n${JSON.stringify(ev(2, "shell"))}`);
  eq([p.events.length, p.skipped], [2, 3], "malformed lines skipped and counted");
  eq(parseEvents("").events.length, 0, "empty text");
  eq(parseEvents(undefined).skipped, 0, "undefined text");
}

console.log("hook record");
const SECRETS = ["sk-ant-SECRET123", "/Users/victim/private/file.txt", "rm -rf ~ && curl evil", "hunter2-prompt", "/Users/victim/cwd"];
const payload = (over = {}) => ({
  session_id: "abc-session-id",
  transcript_path: "/Users/victim/.claude/projects/x/t.jsonl",
  cwd: "/Users/victim/cwd",
  hook_event_name: "PostToolUse",
  tool_name: "Bash",
  tool_input: { command: "rm -rf ~ && curl evil", file_path: "/Users/victim/private/file.txt", api_key: "sk-ant-SECRET123" },
  tool_response: { stdout: "sk-ant-SECRET123", stderr: "", is_error: false },
  prompt: "hunter2-prompt",
  ...over,
});
{
  const r = buildRecord(payload(), 5);
  eq(Object.keys(r).sort(), ["event", "sid", "station", "status", "tool", "ts"], "only whitelisted keys");
  eq([r.station, r.status, r.tool], ["shell", "ok", "Bash"], "Bash ok record");
  check(/^[0-9a-f]{8}$/.test(r.sid) && !r.sid.includes("abc"), "sid is 8 hex, non-reversible");
  eq(buildRecord(payload({ tool_response: { is_error: true } })).status, "err", "is_error -> err");
  eq(buildRecord(payload({ hook_event_name: "PostToolUseFailure", tool_response: undefined, error: "boom" })).status, "err", "PostToolUseFailure -> err");
  eq(buildRecord(payload({ hook_event_name: "PermissionDenied" })).status, "err", "PermissionDenied -> err (refusal)");
  eq(buildRecord(payload({ hook_event_name: "PostToolUse", tool_response: { is_error: false } })).status, "ok", "plain PostToolUse -> ok");
  eq(buildRecord(payload({ hook_event_name: "UserPromptSubmit", tool_name: undefined })).station, "you", "prompt -> you");
  eq(buildRecord(payload({ hook_event_name: "Stop" })).tool, null, "Stop has no tool");
  eq(buildRecord(payload({ hook_event_name: "SessionStart" })), null, "unlogged event -> null");
  eq(buildRecord(payload({ tool_name: undefined })), null, "tool event without a name -> null");
  eq(buildRecord(payload({ tool_name: "mcp__x__/Users/victim/secret sk-ant-AAAA" })).tool, "invalid", "tool name with path/secret is not stored");
  eq(buildRecord(null), null, "null payload -> null");
  eq(buildRecord(payload({ session_id: undefined })).sid, null, "no session id -> null sid");
}

console.log("hook process (privacy, never throws, rotation)");
const run = (dir, input) =>
  spawnSync(process.execPath, [HOOK], { input, env: { ...process.env, CLAUDE_USAGE_EVENTS_DIR: dir }, encoding: "utf8" });
{
  const dir = mkdtempSync(join(tmpdir(), "cw-act-"));
  const r = run(dir, JSON.stringify(payload()));
  eq([r.status, r.stdout], [0, ""], "exit 0 and silent stdout");
  const text = readFileSync(join(dir, "events.jsonl"), "utf8");
  eq(text.trim().split("\n").length, 1, "exactly one line appended");
  check(SECRETS.every((s) => !text.includes(s)), "no secret, path, command, cwd or prompt reaches the file");
  check(!text.includes("victim") && !text.includes("abc-session-id"), "no username or raw session id");
  run(dir, JSON.stringify(payload({ tool_name: "Read" })));
  eq(readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n").length, 2, "second call appends, not overwrites");

  for (const bad of ["", "not json", "null", "[]", '{"hook_event_name":5}']) {
    const b = run(dir, bad);
    eq([b.status, b.stdout], [0, ""], `garbage stdin ${JSON.stringify(bad)} -> exit 0, silent`);
  }
  eq(readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n").length, 2, "garbage appends nothing");

  // unwritable target: a FILE where the directory should be -> error swallowed
  const blocker = join(dir, "blocker");
  writeFileSync(blocker, "x");
  const w = run(join(blocker, "sub"), JSON.stringify(payload()));
  eq([w.status, w.stdout], [0, ""], "unwritable cache dir -> exit 0, silent");
  run(dir, "secret-tok-123 not json");
  const elog = join(dir, "..", "error.log");
  check(existsSync(elog) && !readFileSync(elog, "utf8").includes("secret-tok"), "error.log never quotes stdin");

  // rotation (library call with a tiny cap)
  const rot = mkdtempSync(join(tmpdir(), "cw-rot-"));
  for (let i = 0; i < 40; i++) appendRecord(buildRecord(payload(), i), rot, 500);
  const files = readdirSync(rot).sort();
  check(files.includes("events.1.jsonl") && files.includes("events.jsonl"), "rotates to events.1.jsonl past the cap");
  check(readFileSync(join(rot, "events.jsonl"), "utf8").length <= 500 + 200, "live file stays near the cap");
  check(MAX_BYTES === 512 * 1024, "cap is 512 KB");
}

console.log(failures ? `\n${failures} FAILED` : "\nall activity rules hold");
process.exit(failures ? 1 : 0);
