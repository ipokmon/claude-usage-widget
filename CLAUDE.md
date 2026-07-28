# CLAUDE.md

Übersicht desktop widget showing Claude.ai usage limits, with a pixel-art
character whose activity follows the time of day. Read `README.md` first for
install and usage; this file covers what is easy to get wrong when editing.

## Layout

```
widget/claude-usage.jsx   the entire widget - markup, state machine, sprites, CSS
tools/spritegen.mjs       sprite pipeline; REWRITES part of the widget (see below)
poller/                   data layer: poll.mjs, manual-entry.mjs, probe.mjs, lib.mjs
config/config.json        gitignored; holds the claude.ai session cookie
cache/usage.json          gitignored; the only thing the widget reads
sprite/                   source sheets; sprite/out/ is generated
```

## Ground rules

**Never hand-edit the `SPRITES` block** in `widget/claude-usage.jsx`. Everything
between `/* SPRITES:BEGIN */` and `/* SPRITES:END */` is generated — run
`node tools/spritegen.mjs`, which rewrites it in place. Hand edits are lost on
the next run.

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

## Animation model

Every sprite state stays mounted and keeps cycling; the per-activity CSS
timeline only cross-fades `opacity`. Mounting on demand would restart the fast
walk and typing cycles from frame 0 each time a state appeared.

Three nested elements, each owning one thing: `.cw-actor` traverses
(`translateX`) and faces (`scaleX`), `.cw-sprite` fades, `.cw-film` runs the
frame cycle. Collapsing these makes the transforms and the `animation`
shorthand collide.

Card height is deliberately **not** fixed. It adapts to however many metrics the
payload returns — pinning it leaves a dead band when a metric is unmapped.

## Verifying changes

Übersicht mirrors the canvas at `http://127.0.0.1:41416/`, which is the
practical way to see the widget when windows cover the desktop. Widgets arrive
over a websocket on connect, so reload the page rather than touching the `.jsx`.
`README.md` has a devtools snippet for scrubbing to a specific activity state.

## Current state

Live scrape works. Only **two** bars render, not three: the payload has no
`fable` key and every per-model weekly bucket was `null` on this account, so
`weekly_fable` is intentionally left unmapped in `config/config.json` rather
than guessed. If one populates, `node poller/probe.mjs` surfaces its path — then
set the label in `poller/lib.mjs` to match whichever model it actually is.
