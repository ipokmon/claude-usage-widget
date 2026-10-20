# STATUS: claude-usage-widget

**State:** shipped (live); branches `remove-fable-bar` (PR #5) and `usage-stats` awaiting merge
**Last session:** 2026-10-19 | **Last QA:** PASS WITH ISSUES (2026-10-19, issues fixed)

## Working (verified)
- Live scrape, adaptive polling, two bars: 5-hour and weekly (all models). Verified via live poll + Übersicht mirror 2026-10-19.
- Derived stats (2026-10-19): weekly pace line, streak, top tool (7d), peak hour (14d). Stats match an independent recount by qa-redteam. Rendered in Übersicht mirror.
- All five checkers pass (stats, poll cadence, seasons, sprites, cat rules).

## In progress
- PRs for Fable removal and usage stats. launchd runs this working tree, so both are already live on the desktop.
- Tool thought bubble over the rabbit (branch `tool-icon`, stacked on `usage-stats`): shows the 7-day top tool; hidden at night and when stats are stale.

## Known issues
| Sev | Issue | Since |
|---|---|---|

## Blocked on / needs CEO
- Merge the remove-fable-bar PR.
- Merge the usage-stats PR.
- Merge the tool-icon PR (after #5 and #6).

## Mocked or stubbed (must be replaced before ship)
- none

## Next 3 actions
1. Merge PRs once approved.
2. Glance at the bubble in daytime on the real desktop (only verified in the mirror; it is hidden at night).

## Session log (newest first, 1-2 lines each)
- 2026-10-19: added tool thought bubble (7 icons, zero-overlap placement found by pixel sweep).
- 2026-10-19: added pace, streak, top tool, peak hour (transcript scanner with per-file index; symlink-safe).
- 2026-10-19: removed weekly (Fable) bar; fixed PROJECT path after the move off ~/Desktop.
