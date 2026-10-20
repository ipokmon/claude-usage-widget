# QA log

## 2026-10-19 | remove weekly (Fable) bar | PASS WITH ISSUES

qa-redteam verdict, verbatim summary:
- All 6 acceptance criteria VERIFIED (no rendered Fable metric; all four checkers pass and carry-over test still exercises the held path; manual-entry validates 2 fields, tested in a sandbox copy; jsx backticks balanced, no fragments; a stale cache with `weekly_fable` is ignored by the widget and dropped on next poll; carried_over/HELD intact).
- MED: README.md:82, :136 and manual-entry.mjs:10 still showed the 3-arg form `42 61 12`. **Fixed** (now `42 61`).
- LOW: carry-over test value equals the stub's live weekly value. **Not changed**: in `noweekly` mode the stub omits `seven_day` entirely, so pct 2 can only come from carry-over.
- LOW: filter-syntax examples still use `display_name=Fable`. Left as generic syntax docs.
- Not tested by QA: Übersicht render. Verified separately in the Übersicht mirror (two bars, 0 held/errors) after a live `poll.mjs --now`.
