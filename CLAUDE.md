# CLAUDE.md

Übersicht desktop widget showing Claude.ai usage limits, with a pixel-art
character whose activity follows the time of day. Read `README.md` first for
install and usage; this file covers what is easy to get wrong when editing.

## Layout

```
widget/claude-usage.jsx   the entire widget - markup, state machine, art, CSS
tools/spritegen.mjs       character pipeline; REWRITES part of the widget (see below)
tools/propgen.mjs         scenery pipeline; REWRITES part of the widget (see below)
tools/install-launchd.sh  generates the launchd plist from the current checkout
poller/                   data layer: poll.mjs, manual-entry.mjs, probe.mjs, lib.mjs
config/config.json        gitignored; holds the claude.ai session cookie
cache/usage.json          gitignored; the only thing the widget reads
sprite/                   source sheets, named per state; sprite/out/** is generated
```

**Nothing in the repo may hardcode a home directory.** The widget's `PROJECT`
constant is the single exception - Übersicht gives it nothing to infer the path
from - and it is commented as an edit-me. The launchd plist is a `.template`
with `__NODE__`/`__PROJECT__` placeholders filled in at install time; do not
commit a resolved copy. This repo is public, and the previous hardcoded plist
installed a job pointing at a path that existed on exactly one machine.

## Ground rules

**Never hand-edit the generated blocks** in `widget/claude-usage.jsx`. Two
regions are machine-written and hand edits are lost on the next run:

| Block | Generator | Contents |
| --- | --- | --- |
| `/* SPRITES:BEGIN */ … END */` | `node tools/spritegen.mjs` | character animation strips |
| `/* CAT:BEGIN */ … END */` | `node tools/spritegen.mjs` | cat animation strips |
| `/* PROPS:BEGIN */ … END */` | `node tools/propgen.mjs` | background scenery |

`spritegen.mjs` runs two **jobs** through one pipeline - `character` and `cat` -
each with its own grid, palette and scale. Sharing a palette would force the
rabbit's orange ramp onto a grey cat; sharing a scale would size the cat
against the rabbit's tallest pose. The cat's whole 4x3 sheet is one file, so
its three states are selected by frame index (`use:`), not by sheet.

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

**Secrets.** `config/config.json` holds a live session cookie — a bearer
credential for the whole account, not just usage data. It is gitignored; verify
with `git check-ignore -v config/config.json` before committing. It should be
mode `600`, and `readConfig()` warns when it is not. Log output is scrubbed by
`redact()` in `poller/lib.mjs` — keep using it, and note it now also masks
UUIDs and emails because `probe.mjs` dumps a whole API response and that output
gets pasted into bug reports.

**The endpoint allowlist is load-bearing.** `assertSafeEndpoint()` in
`poller/lib.mjs` restricts where the cookie may be sent to HTTPS on `claude.ai`
or `anthropic.com`. `endpoint` is hand-pasted from DevTools, so it is the one
config value likely to be copied from an untrusted source; without the check a
single wrong hostname exfiltrates the session cookie every 10 minutes while the
widget still shows green. Widen `ALLOWED_HOSTS` only for a real Anthropic host.

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

**Handoffs must land on the same percentage.** `steps(1)` means the value on
`[p_i, p_i+1)` is the value declared *at* `p_i`, so if the outgoing state
switches off at 56.1% and the incoming switches on at 56.2%, nothing is on
screen for that tenth of a percent. At a 48s cycle that is ~48ms and it reads
on the desktop as the character **flashing off and back**. Two states both on
is the same class of bug in the other direction - the poses ghost through each
other. Check with:

```bash
node tools/check-sprite-coverage.mjs
```

It sweeps every activity for both actors and asserts exactly one sprite is
visible at all times. Run it after touching any timeline. The timelines are
written as one keyframe per phase boundary for exactly this reason - do not
reintroduce "off at X, on at X+0.1" pairs.

Pose, motion and facing should all change on the same instant too. A walk pose
that outlasts its `*-move` segment leaves the character walking on the spot,
and a facing flip that lands late mirrors the desk for a few frames.

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

## The cat

The cat obeys three rules, and they are **machine-checked** - run it after
touching any `*-move` keyframes, the character's included:

```bash
node tools/check-cat-rules.mjs
```

1. it only *traverses* while the character is standing still
2. it does not traverse during every such window (bedtime and night it never
   moves at all; the others use one of the character's several still windows)
3. its range (67px) is far shorter than the character's (142-220px)

Rule 1 holds by construction only because **each cat timeline shares its
activity's duration** with the character's. Retime a character walk without
retiming the cat and the windows silently drift into each other - which is
exactly what the checker catches. It parses the real `translateX` keyframes out
of the widget and samples both actors on a shared clock, so it cannot fall out
of date with the CSS.

**Sleep uses only source frames 6 and 7**, not all of row 1. Frames 4 and 5 are
a cat rising with its rear in the air - 4 reads as standing outright - so
cycling the full row made the cat look like it kept waking up. Only 6 and 7 are
properly curled, and alternating those two at 3.5s a frame reads as breathing.
If the cat ever looks restless again, check `use:` on the sleep sheet first.

The cat's cadences are all slower than the character's equivalents on purpose:
a brisk cat beside a stationary rabbit reads as agitated.

The basket is two sprites, `catbed` and `catbedRim`. The sleeping cat is 46px
wide and would completely hide a one-piece basket drawn behind it, so the near
rim is listed in `FOREGROUND_PROPS` and rendered *after* the cat. Two things
that look wrong if disturbed:

- **Do not nudge the sleeping pose down** to "sit it in" the basket. That puts
  its paws *below* the rim and the whole thing reads as a plank lying across
  the cat. The cat sits on the floor line like every other state; the rim
  occludes it.
- The rim's end caps stand 3px proud of the rim band on purpose. At this size
  the band alone also reads as a plank - the raised sides are what make it a
  container.

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

Live scrape works. All **three** bars render — session, weekly (all models),
and weekly (Fable).

The payload carries a `limits` array (easy to miss: it sits after the
`seven_day_*` keys, and an early truncated capture hid it). The entry with
`kind: "weekly_scoped"` and `scope.model.display_name == "Fable"` **is** the
weekly Fable limit. It started at 0% with `is_active: false` on 2026-07-28
(which is also why every `seven_day_*` key was `null` then); by 2026-07-29 it
was reading a nonzero percent with `is_active` still `false` — usage accrues
before Anthropic flips the limit "active".

`config/config.json`'s `weekly_fable.pct` is mapped to that entry's `percent`,
matched on `scope.model.display_name` rather than a fixed index like
`limits[2]`, since nothing guarantees the array order. This match-by-field
lookup is a small addition to `getPath` in `poller/lib.mjs` — see the
`[field=value]` filter syntax documented there and in
`config/config.example.json`.

**There is no token count anywhere in the payload** — only percentages, reset
times and dollar/credit amounts. Asked for in this session and confirmed absent;
don't go looking again. Claude Code's own transcripts under
`~/.claude/projects/**/*.jsonl` do carry per-message token usage, but that is
this machine's Claude Code activity only, not the account.
