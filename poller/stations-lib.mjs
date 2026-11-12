// Pure helpers for the activity map hook: tool name -> station. No I/O.
// (Window aggregation lives in the widget itself: Übersicht cannot import it.)
//
// Privacy: classifyTool may READ a file path to spot a memory write, but only
// ever returns a station name. Callers must never store the path.

import { posix } from "node:path";

export const STATIONS = ["you", "model", "files", "shell", "web", "browser", "agents", "skills", "memory", "hooks"];

const FILE_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "NotebookEdit", "NotebookRead"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "BashOutput", "KillShell", "KillBash", "PowerShell"]);
const WEB_TOOLS = new Set(["WebFetch", "WebSearch"]);
const AGENT_TOOLS = new Set(["Agent", "Task"]);

const MEMORY_PATH = /\/\.claude\/projects\/.*\/memory\//;

/**
 * Station for one tool call. `toolInput` is only inspected for a memory path.
 * @param {unknown} toolName
 * @param {unknown} [toolInput]
 * @returns {string} one of STATIONS or "other"
 */
export function classifyTool(toolName, toolInput) {
  if (typeof toolName !== "string" || !toolName) return "other";
  const lower = toolName.toLowerCase();

  if (toolName.startsWith("mcp__")) {
    if (lower.includes("memory")) return "memory";
    if (toolName.startsWith("mcp__Claude_Browser__") || toolName.startsWith("mcp__claude-in-chrome__")) return "browser";
    return "web";
  }
  if (WRITE_TOOLS.has(toolName)) {
    const p = toolInput && typeof toolInput === "object" ? toolInput.file_path ?? toolInput.notebook_path : null;
    if (typeof p === "string" && MEMORY_PATH.test(posix.normalize(p))) return "memory";
  }
  if (FILE_TOOLS.has(toolName)) return "files";
  if (SHELL_TOOLS.has(toolName)) return "shell";
  if (WEB_TOOLS.has(toolName)) return "web";
  if (AGENT_TOOLS.has(toolName) || toolName.startsWith("Task")) return "agents";
  if (toolName === "Skill") return "skills";
  return "other";
}

/** Station for a non-tool hook event, or null when the event is not logged. */
export function stationForEvent(event) {
  if (event === "UserPromptSubmit") return "you";
  if (event === "Stop" || event === "SubagentStop") return "model";
  return null;
}
