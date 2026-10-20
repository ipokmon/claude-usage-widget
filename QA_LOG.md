# QA log

## 2026-10-20 | battery mode (pause animations, drop blur on battery) | PASS WITH ISSUES

qa-redteam (Sonnet) verdict, verbatim summary: AC1-AC5, AC7 VERIFIED; AC8 re-measured (renderer pid 1454 at 0.0% over 3 samples vs 9.7% baseline); AC6 FAILED as worded, benign in effect. No backtick or `${` in the CSS literal; generated blocks untouched; missing stats.json / missing pmset / old-format output all parse.
- MED: AC6 claimed the CSS text was unchanged and the checker only guarded one leak. **Fixed**: AC6 reworded to behavioural equivalence; check-power now asserts every battery-block selector requires `data-power="battery"`; the rest of the CSS was diffed against abba21e once and was identical (not kept in the gate, it would fail on any later CSS edit).
- LOW: live pmset check accepted either value. **Fixed**: expected value now read from pmset directly.
- LOW: sprite-coverage argument unconfirmed for the cat. **No change needed**: check-sprite-coverage sweeps both `character` and `cat` (line 93).
- LOW: checker is source-string matching, no DOM render. **Accepted**; runtime verified separately in the Übersicht mirror (data-power="battery", 0 running / 24 paused animations, backdrop none, bg alpha 0.94).
- Not tested: AC path live (machine on battery), plug/unplug switch, non-English pmset output.

## 2026-10-19 | remove weekly (Fable) bar | PASS WITH ISSUES

qa-redteam verdict, verbatim summary:
- All 6 acceptance criteria VERIFIED (no rendered Fable metric; all four checkers pass and carry-over test still exercises the held path; manual-entry validates 2 fields, tested in a sandbox copy; jsx backticks balanced, no fragments; a stale cache with `weekly_fable` is ignored by the widget and dropped on next poll; carried_over/HELD intact).
- MED: README.md:82, :136 and manual-entry.mjs:10 still showed the 3-arg form `42 61 12`. **Fixed** (now `42 61`).
- LOW: carry-over test value equals the stub's live weekly value. **Not changed**: in `noweekly` mode the stub omits `seven_day` entirely, so pct 2 can only come from carry-over.
- LOW: filter-syntax examples still use `display_name=Fable`. Left as generic syntax docs.
- Not tested by QA: Übersicht render. Verified separately in the Übersicht mirror (two bars, 0 held/errors) after a live `poll.mjs --now`.

## 2026-10-19 | derived stats (pace, streak, top tool, peak hour) | PASS WITH ISSUES

Round 1: PASS WITH ISSUES. All 7 criteria verified; independent recount matched stats.json exactly (files, replies, tool calls, streak, top tool, peak hour). 4 MED:
- stats failure in catch path escaped into the usage poll (EISDIR repro) -> **fixed**: own try/catch in poll.mjs, non-throwing catch path.
- unreadable transcript silently dropped -> **fixed**: keeps previous parse, else every stat flagged partial.
- no scanner tests -> **fixed**: fixture section in check-stats.
- subagent inclusion undisclosed -> **fixed**: deliberately included, stated in README.
LOWs fixed: failure tooltips, config help text, at_limit status at 100%, widget window fallbacks, shared date helper, ties/"including today" documented, stale-row dimming, ENOENT skip.

Round 2 (re-verify): PASS WITH ISSUES. All MEDs confirmed fixed by re-running repros; recount still exact (Bash 336/530, peak 22h 260/509, streak 2). Remaining LOWs:
- partial checks could not fail (fixture mtimes = now) -> **fixed**: fixtures backdated, asserts partial false before / true after.
- keep-previous-parse path untested -> **fixed**: added check.
- symlink guard itself not pinned (Dirent already excludes links) -> accepted.
Not tested by QA: real Übersicht render (verified separately in the mirror), DST on streak/peak, Claude Code's mtime pruning assumption.

## 2026-10-19 | tool thought bubble | PASS WITH ISSUES

Round 1: PASS WITH ISSUES, 8/8 criteria verified (propgen deterministic, PROPS byte-identical, bubble never scenery, null/fallback safe, no mirroring, night hidden, in-stage geometry, sprite coverage intact).
- MED tail covered the ear (idle 19px, stretch 31px, yawn 19px overlap) -> **fixed**: offset 42/-10 found by sweeping every offset against all upright frames both facings; QA's own PNG decode confirms 0 overlap.
- MED tooltip said "this week" and ignored staleness/partial -> **fixed**: "last N days", partial note, hidden when stats are stale (shared statsStale()).
- LOW prototype-key lookup -> **fixed** (Object.hasOwn). LOW raw MCP name in title -> **fixed** (display_name).
- LOW tail dots fused -> improved (blank rows added); outlines still touch diagonally, **accepted** as style (more spacing would grow the art and void the verified offset).
- LOW tests -> **fixed**: TOOLS/art key parity and stage-bounds checks.

Round 2: PASS WITH ISSUES. Remaining LOWs:
- bounds check read the cat's 294px park, not the actor, and could pass silently -> **fixed**: limited to cw-*-move (non-cat) blocks (max 250), fails if any input is missing.
- "matches" check compares keys only -> renamed to say so.
- title "last undefined days" -> **fixed** guard.
Not tested by QA: real Übersicht pixels; verified separately via mirror clones at 2x in day/morning/evening.
