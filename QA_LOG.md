# QA log

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
