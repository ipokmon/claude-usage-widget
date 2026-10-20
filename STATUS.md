# STATUS: claude-usage-widget

**State:** shipped (live), main at abba21e
**Last session:** 2026-10-19 | **Last QA:** PASS WITH ISSUES (2026-10-19, issues fixed)

## Working (verified)
- Live scrape, adaptive polling, two bars: 5-hour and weekly (all models). Verified via live poll + Übersicht mirror 2026-10-19.
- Derived stats (2026-10-19): weekly pace line, streak, top tool (7d), peak hour (14d). Stats match an independent recount by qa-redteam. Rendered in Übersicht mirror.
- All five checkers pass (stats, poll cadence, seasons, sprites, cat rules).

## In progress
- none

## Known issues
| Sev | Issue | Since |
|---|---|---|
| low | Übersicht does not rebundle when a git checkout replaces the symlinked widget file; restart Übersicht after merges/pulls | 2026-10-19 |

## Blocked on / needs CEO
- none

## Mocked or stubbed (must be replaced before ship)
- none

## Next 3 actions
1. Glance at the tool bubble on the real desktop in daytime (verified only in mirror clones; hidden at night).
2. Stale local branches (remove-fable-bar, usage-stats, tool-icon) can be pruned; remote ones left in place.

## Session log (newest first, 1-2 lines each)
- 2026-10-19: desktop showed pre-merge widget; Übersicht (up since 21:54) missed the 22:45 checkout. Restarted it; new layout confirmed by screenshot.
- 2026-10-19: merged PRs #5, #6, #7 to main (CEO approval in chat); checkout on main, live poll OK.
- 2026-10-19: added tool thought bubble (7 icons, zero-overlap placement found by pixel sweep).
- 2026-10-19: added pace, streak, top tool, peak hour (transcript scanner with per-file index; symlink-safe).
- 2026-10-19: removed weekly (Fable) bar; fixed PROJECT path after the move off ~/Desktop.
