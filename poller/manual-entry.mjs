#!/usr/bin/env node
//
// FALLBACK data path: type the three percentages in by hand.
//
// This file is INTENTIONALLY self-contained - it imports nothing from lib.mjs
// and never touches the network. If the scraper breaks completely (endpoint
// moved, cookie dead, payload reshaped), this still works. Keep it that way.
//
//   Usage:  node poller/manual-entry.mjs
//     or:   node poller/manual-entry.mjs 42 61 12

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv } from "node:process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CACHE_PATH = join(ROOT, "cache", "usage.json");

const FIELDS = [
  ["session", "5-hour limit"],
  ["weekly", "Weekly (all models)"],
  ["weekly_fable", "Weekly (Fable)"],
];

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(obj) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  const tmp = `${CACHE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
  renameSync(tmp, CACHE_PATH);
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

const prev = readCache();
const data = {};

// Non-interactive mode: three numbers as arguments.
const args = argv.slice(2).filter((a) => a !== "");
if (args.length) {
  if (args.length !== 3) {
    console.error("Usage: node poller/manual-entry.mjs <5hour%> <weekly%> <fable%>");
    process.exit(1);
  }
  FIELDS.forEach(([key, label], i) => {
    const n = Number(args[i]);
    if (Number.isNaN(n)) {
      console.error(`"${args[i]}" is not a number.`);
      process.exit(1);
    }
    data[key] = { label, pct: clamp(n), resets_at: prev?.data?.[key]?.resets_at ?? null };
  });
} else {
  console.log("Enter current usage percentages (blank = keep existing value).\n");

  // Collect one answer per field. Piped stdin is read in one go: readline's
  // question() never settles once a pipe hits EOF, which would silently skip
  // the write and leave the cache untouched.
  let answers;
  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    answers = [];
    for (const [key, label] of FIELDS) {
      const old = prev?.data?.[key]?.pct;
      const hint = old != null ? ` [${old}]` : "";
      answers.push((await rl.question(`  ${label}%${hint}: `)).trim());
    }
    rl.close();
  } else {
    const chunks = [];
    for await (const c of stdin) chunks.push(c);
    const lines = Buffer.concat(chunks).toString().split("\n");
    answers = FIELDS.map((_, i) => (lines[i] ?? "").trim());
  }

  FIELDS.forEach(([key, label], i) => {
    const old = prev?.data?.[key]?.pct;
    const answer = answers[i] ?? "";

    let pct;
    if (answer === "") {
      if (old == null) {
        console.error(`  ${label}: no existing value to keep - enter a number.`);
        process.exit(1);
      }
      pct = old;
    } else {
      const n = Number(answer.replace("%", ""));
      if (Number.isNaN(n)) {
        console.error(`  ${label}: "${answer}" is not a number.`);
        process.exit(1);
      }
      pct = clamp(n);
    }
    data[key] = { label, pct, resets_at: prev?.data?.[key]?.resets_at ?? null };
  });
}

writeCache({
  schema: 1,
  source: "manual",
  fetched_at: new Date().toISOString(),
  stale: false,
  last_error: null,
  last_error_at: null,
  data,
});

console.log(
  `\nSaved: ${FIELDS.map(([k]) => `${k}=${data[k].pct}%`).join("  ")}`
);
console.log("The widget will pick this up on its next refresh (<= 60s).");
