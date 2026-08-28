# CLAUDE.md

Übersicht desktop widget showing Claude.ai usage limits, with a pixel-art
character whose activity follows the time of day and a room that redecorates
itself by month. Read `README.md` first for install and usage; this file covers
what is easy to get wrong when editing.

Three independent axes, all from local `Date`, none of them talking to the
network: **theme** (dark 20:00–07:00), **activity** (morning → night), and
**season** (one decoration per month).

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

Scenery is authored *in* `propgen.mjs` — that file is the source, not the PNGs
it emits. Organic silhouettes are ASCII grids, everything else is rectangles
and loops. Don't reach for the AI pipeline for a prop: at this size hand-drawn
is faster than generate-then-clean-up, and it is the only way a new prop stays
on the room's palette.

**The widget never makes a network request.** It shells out to `cat` on
`cache/usage.json` and nothing else. Keep it that way: a flaky endpoint must not
be able to wedge the desktop. All fetching belongs in `poller/`.

**`poller/manual-entry.mjs` shares no code with the scraper** — that is
deliberate, so the fallback still works when the scraper path is broken. Do not
"refactor" the duplication away.

**`poll.mjs` always exits 0.** launchd treats a non-zero exit as a failure worth
retrying; a failed poll is a normal, expected state that should just keep the
last good numbers.

**launchd's `StartInterval` is a tick, not a poll interval.** It fires
`poll.mjs` every `poll.minSeconds`; `poll.mjs` then decides whether to spend a
request, and most runs exit before touching the network. That gate is the only
reason a 60s tick is affordable against an undocumented endpoint — do not read
the plist interval as the request rate.

The cadence rules, and why each exists, are asserted by:

```bash
node tools/check-poll-cadence.mjs
```

It spawns the real `poll.mjs` with `fetch` stubbed and the cache, log and config
paths redirected into a temp dir via `CLAUDE_USAGE_CACHE` / `CLAUDE_USAGE_LOG` /
`CLAUDE_USAGE_CONFIG` — those env vars exist *only* for that, and nothing sets
them in normal operation. Run it after touching the gate, the backoff, or the
failure path.

Three things in there are easy to "simplify" back into bugs:

- **Stale is about consecutive failures, not age.** Three in a row, not one. A
  laptop that slept or a wifi handover produces exactly one, and a badge that
  flickers on those is one you stop reading. How *old* the data is, the footer
  already says.
- **Failures back off too**, so an expired cookie settles at `maxSeconds` rather
  than retrying every tick forever.
- **Unchanged polls log nothing.** The log is a change journal now; an entry per
  poll buried the interesting lines and duplicated what `fetched_at` says. Every
  line is timestamped — the absence of timestamps is what made the original
  "how often does this actually change?" question unanswerable.

**`carried_over` is load-bearing.** When one metric is missing from an otherwise
good response, `poll.mjs` re-uses the previous value and sets this flag; the
widget draws that bar hatched with a **HELD** chip. Without it the poll succeeds,
no stale flag is set, and a frozen number is pixel-identical to a live one —
which is exactly what happened while the Fable weekly limit was absent from the
payload during a plan lapse.

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

## No JSX fragments

**Never use `<>` / `</>` in the widget.** Übersicht's JSX transform routes normal
tags through its own pragma, but the fragment shorthand compiles to
`React.Fragment`, and `React` is not a variable in the widget's scope. The result
is a `Can't find variable: React` error card on the desktop. Use a real wrapper
element instead — `<span>` inside inline text, `<div>` elsewhere.

This is nastier than it sounds because it fails **only on the branch that uses
it**. The two fragments that caused it lived in the no-data empty state, so the
widget rendered perfectly for weeks and then crashed at the one moment it was
supposed to explain itself — a missing or unreadable `cache/usage.json`. Neither
the checkers nor the backtick check catches this; the mirror does not either,
unless you force the branch. Grep before committing:

```bash
grep -n "<>\|</>" widget/claude-usage.jsx
```

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
3. its range (103px) is far shorter than the character's (142-220px)

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

## Seasonal decoration

One per month, driven only by `Date().getMonth()`. Ten are props; `frost`
(January) and `lights` (December) are not — frost is a CSS overlay on the
window, and December just leaves the ceiling string's existing night-time halo
switched on all day.

**Each season is named after the thing that appears**, not the holiday, so the
CSS is a flat 1:1 mapping onto a `.cw-prop-*` class. Renaming these back to
`halloween`/`valentines` breaks that mapping and puts a culture-specific label
on months like May that are only decorated for the season.

**Adding or renaming a month means four places must agree**, and the failure
mode is asymmetric:

| Place | If you miss it |
| --- | --- |
| `BUILD` in `propgen.mjs` | Prop never exists; the widget silently shows nothing |
| `SEASONS` in the widget | Month renders undecorated |
| `SEASONAL_PROPS` in the widget | **Prop shows every day of the year** |
| CSS position + the show-rule list | Prop sits at 0,0 or never turns on |

The third row is the one that bites. `.cw-seasonal` is what holds these at
`opacity: 0`, and membership of that set is the only thing that applies it — a
prop added to `PROPS` and given a position but left out of `SEASONAL_PROPS`
becomes permanent scenery. The other three rows fail by showing nothing, which
you notice; that one fails by showing something all year, which just looks like
the room. All four are machine-checked — run it after touching any of them:

```bash
node tools/check-seasons.mjs
```

It reads the real sources (propgen's `BUILD`, the generated `PROPS` block, both
widget lists, and the CSS rules themselves), so it cannot drift the way a second
copy of the month list would. It also catches the inverse mistakes: `frost` or
`lights` added to `SEASONAL_PROPS` (which would hide the ceiling string for
eleven months), a name in the set that no month asks for, and a `BUILD` entry
that predates the last `propgen` run.

Only one is ever on screen, so they **share stations** rather than each getting
their own spot: five on the windowsill (`bottom: 36px` puts every one of them on
it, whatever its height, because they all carry 2px of contact shadow), three on
the floor, two on the wall above the armchair.

Four things that had to be redrawn after looking at them rendered, all
commented at their definitions — they generalise to any new prop at this size:

- **The turkey's drumsticks must splay.** Upright beside the body they vanish
  into the silhouette and it reads as a loaf of bread.
- **The flower stems must fan** from one point in the pot. Three parallel stems
  of equal length read as a fence.
- **The book pile's page-edges alternate ends.** A light band running the full
  width of every book turns the stack into a layer cake.
- **Nothing goes directly under the window.** The gap below the sill is about
  as tall as these props are, so anything there touches the frame and reads as
  stuck to the glass. That is why the beach ball sits on the left floor.

`outline()` draws into a **same-size** canvas, so art touching the edge loses
its outline silently. Leave a 1px margin — `hearts()` does.

## Lighting

One dominant light per theme: the window (x≈120) by day, the fire (x≈277) after
dark. Props throw away from it via per-prop `drop-shadow` filters, hand-set
rather than computed — eyeballing beats a formula at this scale. The ceiling
string is deliberately excluded.

The seasonal props follow the same rule, with two shortcuts that only work
because of where they sit: the five on the windowsill get **no** light-theme
shadow at all (they are sitting in the daytime light source, same as the window
itself), and after dark every seasonal prop is left of the fire, so they share
one `[data-theme="dark"] .cw-seasonal` rule instead of ten.

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

Two things about that mirror, both learned by wasting time on them:

- **Setting `data-*` by hand only lasts until the next refresh** — 30s now, not
  60 — which re-renders from real `Date` and wipes it. For anything longer than
  a glance, set `DEBUG_HOUR` / `DEBUG_MONTH` in the file instead.
- The page is empty for a moment after a reload while the websocket delivers
  the widget, so a devtools snippet run immediately finds no `.cw-root`.
- **A tab that stays empty is not a broken widget.** Übersicht pushes widgets
  only on websocket connect, and a hard/forced reload can leave the tab with the
  container `<div id="claude-usage-jsx">` present but never filled — no error
  card, no console message, indistinguishable from a widget rendering `null`.
  Open a **new tab** rather than reloading the old one. Confirm the widget
  itself is fine first by running its `command` by hand (`cat cache/usage.json`);
  reverting the `.jsx` to chase a phantom regression is the trap here.

To compare many states at once — twelve seasons in two themes, say — **clone
`.cw-root`** into a plain container, set different `data-season`/`data-theme` on
each clone, drop the header/metrics/footer, and screenshot the strip. The
stylesheet is global once the widget has rendered, so every clone styles itself
correctly. That turns 24 screenshot round-trips into one, and side-by-side is
the only way spacing and shadow-direction mistakes are actually visible.

## Current state

Live scrape works. All **three** bars render — session, weekly (all models),
and weekly (Fable).

Polling is adaptive (2026-08-27): launchd ticks every 60s, `poll.mjs` fetches
between 60s and 10 min depending on whether the numbers are moving. Roughly 10x
fresher mid-session than the old fixed 10-minute interval, at the same or lower
average request rate.

The seasonal axis is complete: all twelve months are decorated, so there is no
"undecorated month" case left to design for. The four-place agreement described
above is now checked by `tools/check-seasons.mjs`, so all four of the repo's
invariants — the cat's rules, sprite coverage, the seasonal wiring, and the poll
cadence — are machine-verified rather than manual.

**The Fable limit disappears from the payload when the plan lapses.** Cancelling
Max removed the `weekly_scoped` entry entirely, which read as a `fieldMap` bug
and was not one — the array simply had no such element, and matching by
`display_name` correctly found nothing. It came back on reactivation
(2026-08-27). This is what `carried_over` and the **HELD** chip are for; expect
the same shape on any future lapse rather than re-debugging the lookup.

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
