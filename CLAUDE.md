# CLAUDE.md

Übersicht desktop widget showing Claude.ai usage limits, with a pixel-art
character whose activity follows the time of day. Read `README.md` first for
install and usage; this file covers what is easy to get wrong when editing.

## Layout

```
widget/claude-usage.jsx   the entire widget - markup, state machine, art, CSS
tools/spritegen.mjs       character pipeline; REWRITES part of the widget (see below)
tools/propgen.mjs         scenery pipeline; REWRITES part of the widget (see below)
poller/                   data layer: poll.mjs, manual-entry.mjs, probe.mjs, lib.mjs
config/config.json        gitignored; holds the claude.ai session cookie
cache/usage.json          gitignored; the only thing the widget reads
sprite/                   source sheets; sprite/out/ and sprite/out/props/ are generated
```

## Ground rules

**Never hand-edit the generated blocks** in `widget/claude-usage.jsx`. Two
regions are machine-written and hand edits are lost on the next run:

| Block | Generator | Contents |
| --- | --- | --- |
| `/* SPRITES:BEGIN */ … END */` | `node tools/spritegen.mjs` | character animation strips |
| `/* PROPS:BEGIN */ … END */` | `node tools/propgen.mjs` | background scenery |

Scenery is authored *in* `propgen.mjs` (ASCII grid for the plant, rectangles for
everything else) — that file is the source, not the PNGs it emits.

**The widget never makes a network request.** It shells out to `cat` on
`cache/usage.json` and nothing else. Keep it that way: a flaky endpoint must not
be able to wedge the desktop. All fetching belongs in `poller/`.

**`poller/manual-entry.mjs` shares no code with the scraper** — that is
deliberate, so the fallback still works when the scraper path is broken. Do not
"refactor" the duplication away.

**`poll.mjs` always exits 0.** launchd treats a non-zero exit as a failure worth
retrying; a failed poll is a normal, expected state that should just flip
`stale: true` and keep the last good numbers.

**Secrets.** `config/config.json` holds a live session cookie. It is gitignored;
verify with `git check-ignore -v config/config.json` before committing. Log
output is scrubbed by `redact()` in `poller/lib.mjs` — keep using it.

## Git workflow

Ivan granted standing permission (2026-07-28) to push and open PRs without
asking each time. `gh` is authed as `ipokmon`; pushes use the macOS keychain.

**Straight to main** — small, self-contained changes you have actually
verified: a colour or position tweak, a prop tuned and screenshotted, a doc
correction, a one-file fix. Commit with a message that says *why*, push, and
report the SHA.

**Branch + PR** — anything larger: multi-file refactors, changes to the poller
or data layer, anything touching `config/` or secrets handling, new
dependencies, or a change you could not verify end-to-end. Branch, push, open
the PR with `gh pr create`, and hand back the URL.

The dividing line is **verifiability, not line count**. A 200-line prop
regeneration you screenshotted is small; a 5-line change to `poll.mjs` error
handling you could not exercise is not.

Still ask first, every time, regardless of size:

- force-pushing or rewriting history (`--force`, `rebase`, `filter-branch`)
- deleting anything remote — branches, the repo
- merging or closing a PR
- making the repo public, or anything that changes its visibility
- committing when `git status` shows changes you did not make

These are configured as prompts in `.claude/settings.local.json` rather than
blocked outright, so they stay possible but never silent.

## Sprite pipeline gotchas

`tools/spritegen.mjs` implements PNG decode/encode itself against `node:zlib`.
This machine has no ImageMagick, PIL or ffmpeg, and `sips` cannot key
transparency. Don't assume an image tool exists.

The source art in `sprite/` has four known defects that the tool corrects — the
gradient backgrounds, ground-line crumbs, a systematic ~7% size difference
between the top and bottom rows of every sheet, and a `work` sheet that mixes
idle and desk poses. `README.md` has the table of what each fix does. If output
starts looking wrong, suspect a tolerance in `removeBackground()` before
suspecting the widget.

**Two constants must agree.** `spritegen` leaves 2px of padding under the feet
inside the 56px frame box, and `.cw-floor` sits at `bottom: 21px`, so
`.cw-actor` is pinned to `bottom: 19px`. Change one and the character floats or
sinks. Verify padding with the lowest-opaque-row check rather than by eye.

## The stylesheet is a template literal

`const CSS = ` … `` is one big JS template literal, so **a stray backtick or
`${` anywhere inside it — including in a CSS comment — terminates the string and
breaks the whole widget.** Übersicht surfaces this as a syntax error card on the
desktop rather than a silent failure, but it is easy to introduce while writing
explanatory comments. Cheap check before saving:

```bash
node -e "const s=require('fs').readFileSync('widget/claude-usage.jsx','utf8');console.log([...s].filter(c=>c==='\`').length%2===0?'balanced':'ODD - broken')"
```

## Animation model

Every sprite state stays mounted and keeps cycling; the per-activity CSS
timeline only cross-fades `opacity`. Mounting on demand would restart the fast
walk and typing cycles from frame 0 each time a state appeared.

Four nested elements, each owning exactly one thing: `.cw-actor` traverses
(`translateX`) **and carries the cast shadow**, `.cw-flip` faces (`scaleX`),
`.cw-sprite` fades, `.cw-film` runs the frame cycle. Collapsing these makes the
transforms and the `animation` shorthand collide.

**`.cw-flip` exists specifically so the shadow is not mirrored.** CSS applies
`filter` *before* `transform`, so if the element carrying the drop-shadow also
carried the `scaleX(-1)`, the shadow would flip with the character and light it
from the wrong side for the whole return walk. Keeping the flip one level in
makes the shadow correct by construction rather than by sign-juggling in the
keyframes.

## Lighting

One dominant light per theme: the window (x≈120) by day, the fire (x≈277) after
dark. Props throw away from it via per-prop `drop-shadow` filters, hand-set
rather than computed — there are only a handful, and eyeballing beats a formula
at this scale. The ceiling string is deliberately excluded.

The character's shadow flips as it walks past the window, so `cw-*-shadow`
keyframes exist for the three activities that occur in the light theme
(morning, day, evening). The flip points are where the character's centre
(`translateX + 28`) crosses x=120, solved along each walk segment — if you
retime a walk, recompute them. After dark the character is always left of the
fire, so the dark theme just uses one static filter.

Card height is deliberately **not** fixed. It adapts to however many metrics the
payload returns — pinning it leaves a dead band when a metric is unmapped.

## Verifying changes

Übersicht mirrors the canvas at `http://127.0.0.1:41416/`, which is the
practical way to see the widget when windows cover the desktop. Widgets arrive
over a websocket on connect, so reload the page rather than touching the `.jsx`.
`README.md` has a devtools snippet for scrubbing to a specific activity state.

## Current state

Live scrape works. Only **two** bars render, not three — by choice, not because
the data is missing.

The payload carries a `limits` array (easy to miss: it sits after the
`seven_day_*` keys, and an early truncated capture hid it). The entry with
`kind: "weekly_scoped"` and `scope.model.display_name == "Fable"` **is** the
weekly Fable limit. It reads 0% with `is_active: false`, which is also why every
`seven_day_*` key is `null`.

Ivan chose to leave it unmapped while it reads zero. To enable it, point
`weekly_fable.pct` at that entry's `percent` — match on
`scope.model.display_name`, not a fixed index like `limits[2]`, since nothing
guarantees the array order.

**There is no token count anywhere in the payload** — only percentages, reset
times and dollar/credit amounts. Asked for in this session and confirmed absent;
don't go looking again. Claude Code's own transcripts under
`~/.claude/projects/**/*.jsonl` do carry per-message token usage, but that is
this machine's Claude Code activity only, not the account.
