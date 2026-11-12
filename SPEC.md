# SPEC: claude-usage-widget

**Created:** 2026-10-20 | **Last revised:** 2026-10-20

The widget predates this file; `README.md` and `CLAUDE.md` describe the shipped
behaviour. This spec starts with the battery-mode change and grows from here.

## Problem
A 2026-10-20 battery audit measured the widget's WebKit renderer at ~10% CPU
continuously on battery (6:21 CPU in 1:18 uptime), the largest steady drain on
the laptop. Cause: every sprite film, timeline and cast-shadow keyframe runs
forever, and the card's `backdrop-filter: blur(30px)` is re-composited under
each repaint.

## User and context
Ivan, MacBook on battery for part of the day. The widget is glanced at, not
watched; a frozen pose on battery costs nothing he uses.

## Non-goals
- Changing the AC-power look or the animation model.
- Converting films to transform-based animation (needs spritegen work).
- Static cast shadows (conflicts with the Animation model section of CLAUDE.md).

## Acceptance criteria
- [x] AC1: `command` appends a third segment after `@@CW_POWER@@` holding the first line of `pmset -g batt`; usage and stats parsing is unchanged.
- [x] AC2: a pure `powerSourceFor(text)` returns `"battery"` only for a line naming `'Battery Power'`, `"ac"` for `'AC Power'` / `'UPS Power'`, and `null` for empty or unrecognised input.
- [x] AC3: `.cw-root` carries `data-power` from AC2; `null` renders no attribute (behaves as AC).
- [x] AC4: with `data-power="battery"`, every animation inside `.cw-root` (elements and pseudo-elements, including inline `style` animations) has `animation-play-state: paused`.
- [x] AC5: with `data-power="battery"`, `.cw-card` has no `backdrop-filter` / `-webkit-backdrop-filter`, and its background is more opaque than on AC in both themes so text stays legible.
- [x] AC6: on AC power, computed styles and behaviour are unchanged: every rule added for battery mode requires `data-power="battery"`, and the rest of the stylesheet is identical to `abba21e` (diffed once at build time).
- [x] AC7: a new `tools/check-power.mjs` asserts AC1-AC5 against the real widget source, and all `tools/check-*.mjs` pass.
- [x] AC8: measured on battery, the widget's WebKit renderer drops well below its 9.7% baseline (target under 2%).

## Data sources
`pmset -g batt` (macOS, local, no network). Read every refresh (30s), so a
plug/unplug takes effect within 30s.

## Architecture
All changes in `widget/claude-usage.jsx` outside the generated blocks, plus one
checker. No poller change.

## Design direction
Battery mode freezes the room in whatever pose it was in; the card trades its
frosted glass for a near-opaque panel in the same colours.

## Assumptions
- A Mac without a battery reports `'AC Power'` and so never pauses. Falsifiable by running `pmset -g batt` on a desktop Mac.
- Pausing an animation mid-timeline leaves exactly one sprite visible, because `check-sprite-coverage` asserts that holds at every instant.

## Open questions
- none

---

# Activity map (2026-11-12)

## Problem
Ivan wants to see what Claude Code is doing right now (files, shell, web...) on the desktop, not just how much quota is used.

## Non-goals
Recording tool inputs/outputs or paths; any network call; a Hooks station feed; history beyond the last 300 log lines.

## Acceptance criteria
- [ ] AM1: `poller/stations-lib.mjs` `classifyTool` maps every rule in the brief (files, shell, web, browser, agents, skills, memory incl. memory-path Write/Edit, other mcp to web, unknown to other); each branch has a test that fails without it.
- [ ] AM2: `hooks/log-event.mjs` appends exactly one JSON line with only `ts,event,tool,station,status,sid`; a secrets-laden payload leaves no input, output, command, path, cwd, prompt or raw session id in the file.
- [ ] AM3: the hook exits 0 with empty stdout for garbage stdin, empty stdin and an unwritable cache dir; no network.
- [ ] AM4: the log rotates to `events.1.jsonl` past a named size constant (512 KB).
- [ ] AM5: PostToolUseFailure and PermissionDenied record `status: err`; UserPromptSubmit records You, Stop/SubagentStop record Model.
- [ ] AM6: wall time per hook run is under 60 ms, measured and recorded in STATUS.
- [ ] AM7: the widget command reads only `tail -n 300` of the log and still exits 0 when it is missing; usage, stats and power parsing are unchanged.
- [ ] AM8: pure `aggregate` gives per-station count, errors, last hit within a 15-min window, ignores future-dated and out-of-window events; `parseEvents` skips and counts malformed lines.
- [ ] AM9: the card renders a radial SVG map (spoke weight by count, glow within 8 s, red error dot) in both themes; missing/empty log renders "no activity yet" with no fake data.
- [ ] AM10: on battery the glow is paused (existing rule) and `check-power` passes; refresh cost on AC measured and recorded.
- [ ] AM11: `tools/check-activity.mjs` is in the gate; README has the settings snippet; `cache/events*.jsonl` and `hooks/error.log` are gitignored.

## Design direction
Same coral-on-cobalt palette as the bars: cold stations, coral when hit, red only for errors. Faint skeleton when empty so the layout does not jump.

## Assumptions
- PostToolUse has no documented error field, so errors come only from the failure and denial events (docs via claude-code-guide, not verified by a live hook run).
- Refresh 5 s is affordable: command costs ~14 ms per tick.
