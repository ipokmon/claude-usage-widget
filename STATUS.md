# STATUS: claude-usage-widget

**State:** shipped (live), change on branch `remove-fable-bar` awaiting merge
**Last session:** 2026-10-19 | **Last QA:** PASS WITH ISSUES (2026-10-19, issues fixed)

## Working (verified)
- Live scrape, adaptive polling, two bars: 5-hour and weekly (all models). Verified via live poll + Übersicht mirror 2026-10-19.
- All four checkers pass.

## In progress
- PR removing the weekly (Fable) bar. The local checkout already runs it (launchd reads this working tree).

## Known issues
| Sev | Issue | Since |
|---|---|---|

## Blocked on / needs CEO
- Merge the remove-fable-bar PR.
- Pick any additional stat to add (candidates: weekly breakdown by surface, `iguana_necktie` $250 credit bucket, extra-usage spend).

## Mocked or stubbed (must be replaced before ship)
- none

## Next 3 actions
1. Merge PR once approved.
2. Add whichever extra stat the CEO picks.

## Session log (newest first, 1-2 lines each)
- 2026-10-19: removed weekly (Fable) bar; fixed PROJECT path after the move off ~/Desktop.
