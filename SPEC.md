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
