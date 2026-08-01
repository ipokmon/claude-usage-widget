// Shared helpers for the SCRAPER path (poll.mjs + probe.mjs).
//
// NOTE: manual-entry.mjs deliberately does NOT import this file. The manual
// fallback must keep working even if the scraper path is broken, so it carries
// its own small copy of the cache-writing logic. That duplication is on purpose.

import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CONFIG_PATH = join(ROOT, "config", "config.json");
export const CACHE_PATH = join(ROOT, "cache", "usage.json");

export const METRICS = ["session", "weekly", "weekly_fable"];

export const LABELS = {
  session: "5-hour limit",
  weekly: "Weekly (all models)",
  weekly_fable: "Weekly (Fable)",
};

/**
 * Strip anything that looks like a credential or an account identifier before
 * it can reach a log file - or, more importantly, a pasted bug report. The
 * last two patterns matter for probe.mjs, which dumps a whole API response:
 * that payload carries org/account UUIDs and sometimes an email, and the one
 * time you run probe.mjs is the one time you are about to paste output into a
 * public issue.
 */
export function redact(text) {
  return String(text)
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***REDACTED***")
    .replace(/sessionKey=[^;\s"]+/g, "sessionKey=***REDACTED***")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "***UUID-REDACTED***"
    )
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "***EMAIL-REDACTED***");
}

export function readConfig() {
  let raw;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(
      "No config/config.json found. Copy config/config.example.json to config/config.json and fill in your session cookie."
    );
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`config/config.json is not valid JSON: ${e.message}`);
  }
  if (!cfg.sessionCookie || cfg.sessionCookie.includes("REPLACE-ME")) {
    throw new Error("config/config.json has no real sessionCookie yet.");
  }
  warnIfWorldReadable();
  return cfg;
}

/**
 * This file holds a live session cookie in plaintext. At the default 0644 any
 * other account or unsandboxed process on the machine can read it. Warn rather
 * than throw: a noisy poll is better than a dead widget, and the fix is one
 * command.
 */
function warnIfWorldReadable() {
  try {
    const mode = statSync(CONFIG_PATH).mode & 0o077;
    if (mode !== 0) {
      console.warn(
        `[config] WARNING: config/config.json is readable by other users on this machine (mode ${(
          statSync(CONFIG_PATH).mode & 0o777
        ).toString(8)}). It holds a live session cookie. Fix with:\n  chmod 600 "${CONFIG_PATH}"`
      );
    }
  } catch {
    // Not worth failing a poll over a stat() we could not perform.
  }
}

/** Accepts either a bare cookie value or a full "sessionKey=..." string. */
export function cookieHeader(cfg) {
  const c = String(cfg.sessionCookie).trim();
  return c.includes("=") ? c : `sessionKey=${c}`;
}

/**
 * Hosts we are willing to send the session cookie to.
 *
 * fetchUsage() attaches a live sessionKey - a bearer credential for the whole
 * account - to whatever URL this returns. `endpoint` is captured by hand from
 * DevTools and pasted in, so it is exactly the kind of value that gets copied
 * out of a fork, a blog post or an issue thread. Without this check a single
 * wrong hostname silently exfiltrates the cookie every poll, and the widget
 * keeps showing a healthy green bar while it happens. Fail closed instead.
 */
const ALLOWED_HOSTS = ["claude.ai", "anthropic.com"];

function assertSafeEndpoint(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`'endpoint' is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Refusing to send the session cookie over ${parsed.protocol}// - 'endpoint' must be https.`
    );
  }
  const host = parsed.hostname.toLowerCase();
  const ok = ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!ok) {
    throw new Error(
      `Refusing to send the session cookie to '${host}'. 'endpoint' must be on ${ALLOWED_HOSTS.join(" or ")}. If this is a legitimate new Anthropic host, add it to ALLOWED_HOSTS in poller/lib.mjs.`
    );
  }
  return parsed;
}

export function resolveEndpoint(cfg) {
  const url = String(cfg.endpoint || "").trim();
  if (!url) {
    throw new Error(
      "config/config.json has no 'endpoint' yet. Capture it from DevTools > Network on the claude.ai usage page (see README), then paste it in."
    );
  }
  const resolved = url.replace(/\{orgId\}/g, cfg.orgId || "");
  assertSafeEndpoint(resolved);
  return resolved;
}

export async function fetchUsage(cfg) {
  const url = resolveEndpoint(cfg);
  const res = await fetch(url, {
    headers: {
      Cookie: cookieHeader(cfg),
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `HTTP ${res.status} - session cookie is expired or invalid. Re-extract it (see README).`
    );
  }
  if (res.status === 404) {
    throw new Error(
      `HTTP 404 - endpoint no longer exists. Anthropic likely changed it; re-capture from DevTools (see README "Known-fragile points").`
    );
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Almost always means we got an HTML login page instead of JSON.
    throw new Error(
      "Response was not JSON (usually means the session cookie expired and we were served a login page)."
    );
  }
}

/**
 * Read a dot/bracket path like "five_hour.utilization" or "limits[0].pct".
 * A bracket may also hold a filter, "limits[scope.model.display_name=Fable]",
 * which finds the first array element whose (possibly nested) field equals
 * the given value - for arrays whose order isn't guaranteed across requests.
 */
export function getPath(obj, path) {
  if (!path) return undefined;
  const tokens = String(path).match(/[^.[\]]+|\[[^\]]*\]/g) || [];
  return tokens.reduce((acc, tok) => {
    if (acc == null) return undefined;
    if (tok[0] !== "[") return acc[tok];
    const inner = tok.slice(1, -1);
    const eq = inner.indexOf("=");
    if (eq === -1) return acc[inner]; // plain numeric index, e.g. [0]
    if (!Array.isArray(acc)) return undefined;
    const field = inner.slice(0, eq);
    const value = inner.slice(eq + 1);
    return acc.find((item) => String(getPath(item, field)) === value);
  }, obj);
}

/** Apply a fieldMap entry to the raw payload -> {pct, resets_at} or null. */
export function applyFieldMap(payload, spec) {
  if (!spec || !spec.pct) return null;
  const raw = getPath(payload, spec.pct);
  if (raw == null || typeof raw !== "number" || Number.isNaN(raw)) return null;

  let pct = raw * (typeof spec.scale === "number" ? spec.scale : 1);
  if (spec.invert) pct = 100 - pct;
  pct = Math.max(0, Math.min(100, Math.round(pct)));

  const resets = spec.resets_at ? getPath(payload, spec.resets_at) : null;
  return {
    pct,
    resets_at: resets != null ? String(resets) : null,
  };
}

export function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

/** Atomic write so the widget never reads a half-written file mid-refresh. */
export function writeCache(obj) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  const tmp = `${CACHE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
  renameSync(tmp, CACHE_PATH);
}
