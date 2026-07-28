# Claude Usage — animated desktop widget

An Übersicht desktop widget showing your Claude.ai plan usage limits (5-hour,
weekly all-models, weekly Fable), with a small original character whose activity
follows the time of day.

```
┌─────────────────────────────────┐
│  Claude Usage            ● stale│
│  5-hour limit   resets in 2h 24m│  42%
│  Weekly (all models)            │  73%
│  Weekly (Fable)                 │  94%
│ ┌─────────────────────────────┐ │
│ │  🖥   ╭─╮                    │ │  <- character stage
│ │ ═════ ╰─╯ ══════════════════│ │
│ └─────────────────────────────┘ │
│  working            synced · 4m │
└─────────────────────────────────┘
```

## Why Übersicht and not a native widget

macOS WidgetKit widgets are periodic snapshots — the system budgets their
refreshes (roughly hourly) and there is no continuous animation loop. A
persistent character that walks around needs a process that keeps rendering, so
this runs as an Übersicht widget: a JSX file Übersicht keeps alive and re-renders
on an interval we control.

## Architecture

Data collection and rendering are deliberately separate. **The widget never
makes a network request** — it only reads a local JSON cache. That keeps the
render loop cheap and means a flaky endpoint can never wedge your desktop.

```
launchd (every 10 min)
   └─ poller/poll.mjs ──fetch──> claude.ai internal usage endpoint
          success → cache/usage.json  {stale:false, source:"scrape"}
          failure → keep old data, flip stale:true, record last_error
          ▼
   cache/usage.json  ◄── poller/manual-entry.mjs   (independent fallback)
          ▲
          │ widget runs: cat cache/usage.json
   widget/claude-usage.jsx   (refreshes every 60s)
```

## Install

1. **Übersicht** (already installed if you ran the build):
   ```bash
   brew install --cask ubersicht
   ```
   Launch it once, then grant it Screen Recording permission if macOS asks —
   Übersicht needs it to sample the desktop wallpaper behind the widget.

2. **Link the widget** into Übersicht's widgets folder (a symlink means edits
   here go live without copying):
   ```bash
   ln -sf "$PWD/widget/claude-usage.jsx" "$HOME/Library/Application Support/Übersicht/widgets/claude-usage.jsx"
   ```

3. **Seed some data** so the widget has something to show:
   ```bash
   node poller/manual-entry.mjs 42 61 12
   ```

4. **Configure the live scraper** — see below — then load the poller:
   ```bash
   cp launchd/com.ivan.claude-usage-poller.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.ivan.claude-usage-poller.plist
   ```

## Setting up the live data path

The usage numbers come from the same internal endpoint claude.ai's own settings
page calls. It is **not a public or documented API**, so you have to capture it
once by hand.

1. Open claude.ai, go to the settings page that shows *Plan usage limits*.
2. Open DevTools → **Network**, filter to **Fetch/XHR**, and reload.
3. Find the request whose JSON response contains the usage percentages.
4. Copy its **URL** into `endpoint` in `config/config.json`. If the URL contains
   your organization UUID, replace it with `{orgId}` and set `orgId` separately.
5. Copy your session cookie: DevTools → **Application** → Cookies → `claude.ai`
   → the **`sessionKey`** value. Put it in `sessionCookie`.
6. Work out the field mapping:
   ```bash
   node poller/probe.mjs
   ```
   This prints the raw response and suggests dot-paths that look like
   percentages and reset timestamps. Copy the right ones into `fieldMap`.
   - `scale`: `100` if the API returns `0.0–1.0`, `1` if it already returns `0–100`.
   - `invert`: `true` if the value is what's **remaining** rather than **used**.
7. Test it:
   ```bash
   node poller/poll.mjs
   ```

`config/config.json` is gitignored. Never commit it — it grants access to your
account.

### When the cookie expires

Sessions don't last forever. The symptom is the widget showing the amber
**stale** dot and `poller.log` reporting `HTTP 401`. Redo step 5 above; nothing
else needs to change.

## Manual fallback

Works with the scraper completely broken, and shares no code with it:

```bash
node poller/manual-entry.mjs           # prompts for each value
node poller/manual-entry.mjs 42 61 12  # or pass them directly
```

**If you want to run manual-only, don't load the launchd job.** The poller flags
the cache stale whenever it can't reach the endpoint — including when it simply
isn't configured — which would put a stale dot on numbers you just typed in
yourself. Manual entry always clears the flag, so with the job unloaded the
widget stays clean.

## Refresh intervals, and why

| Thing | Interval | Reasoning |
|---|---|---|
| Poller → endpoint | **10 min** | Undocumented internal endpoint. Usage limits move slowly; polling harder buys nothing and raises rate-limit/flagging risk. |
| Widget → cache file | **60 s** | Just a local `cat`. Cheap, and keeps the "resets in…" countdowns honest. |
| Character animation | continuous | Pure CSS, independent of both. |

## Time-of-day behaviour

Both axes are computed from local `Date` — no location lookup, no system
appearance API.

**Theme:** dark 20:00–07:00, light 07:00–20:00.

**Character activity:**

| Hours | State | What it does |
|---|---|---|
| 06:00–09:00 | morning | stretches awake, walks over for coffee, sips, wanders back |
| 09:00–18:00 | day | works at the desk; periodically gets up, walks the width of the widget, stretches, walks back |
| 18:00–22:00 | evening | strolls out, reads on a stool, stretches, strolls back |
| 22:00–23:00 | bedtime | ambles across and yawns |
| 23:00–06:00 | night | curled up asleep with a `z`, no traversal |

Props (desk, mug, book, stool, the `z`) are drawn **into** the sprites rather
than composited separately, so the desk only appears while the character is
actually working. That is intentional, not a missing element.

Note the axes are independent on purpose: 06:00–07:00 is "morning" activity
while still in the dark theme, which is correct — it's dark out but you're up.

### Testing all states without waiting

Set `DEBUG_HOUR` near the top of `widget/claude-usage.jsx` to an hour `0–23`
(e.g. `3`, `7.5`, `13`, `19`, `22.5`), save, and Übersicht reloads instantly.
Set it back to `null` for real time.

To inspect it without minimising every window, Übersicht mirrors the widget
canvas over HTTP:

```bash
open http://127.0.0.1:41416/
```

Widgets are pushed over a websocket **on connect**, so if the page comes up
empty, reload it — touching the `.jsx` afterwards will not repopulate an
already-loaded page. In devtools you can scrub a state without waiting for its
slot in the cycle:

```js
const r = document.querySelector('.cw-root');
r.setAttribute('data-activity', 'evening');   // or morning/day/bedtime/night
r.setAttribute('data-theme', 'dark');
document.querySelectorAll('.cw-sprite, .cw-actor').forEach(el =>
  el.getAnimations().forEach(a => { a.currentTime = 40000 * 0.30; a.pause(); }));
```

## The character

A pixel-art rabbit, built from the eight AI-generated sheets in `sprite/`. Each
sheet is a 2×2 grid of poses for one state: idle, walk, stretch, coffee, work,
read, yawn, sleep.

### Regenerating the sprites

```bash
node tools/spritegen.mjs
```

That reads `sprite/*.png`, writes cleaned strips to `sprite/out/`, and rewrites
the `SPRITES` block inside `widget/claude-usage.jsx` in place. Never hand-edit
that block — it is generated. Sprites are inlined as base64 data URIs because
the widget is symlinked into Übersicht's widgets dir, where a relative asset
path would resolve against that dir and 404.

`tools/spritegen.mjs` does its own PNG decode/encode against `node:zlib`. This
machine has no ImageMagick, PIL or ffmpeg, and `sips` cannot key transparency,
so the pipeline is dependency-free on purpose.

What it fixes, and why (all four were real defects in the source art):

| Problem in the source | Fix |
| --- | --- |
| Backgrounds are grey **gradients**, not transparent, with a glow around each sprite | Region-grow from the border comparing each pixel to *the neighbour it spread from*, so it follows a gradient but stops at the hard dark outline. A flat colour key fails here. |
| A ground line under the feet survives keying as loose crumbs | Connected-component pass drops disconnected blobs at or below the feet — while keeping ones **above** the body, which are the sleep "z" and the coffee sparkles |
| Bottom-row poses render ~7% smaller than top-row in every sheet, so the character visibly pulses mid-cycle | Two-level scaling: normalise frames *within* a state to kill the jitter, keep each state's natural size *across* states so the curled-up sleep pose stays shorter than idle |
| The `work` sheet mixes two front-facing idle poses with two desk poses | `use: [2, 3]` in `SHEETS` takes only the desk frames; cycling all four teleported the character in and out of the scene |

Frames are rendered at the art's own pixel grid (~48px tall) and quantised to a
shared 24-colour palette. That restores a hard pixel-art read *and* takes the
inlined payload from 366 KB to 21 KB — the earlier 112px box-filtered version
was neither crisp nor small.

Alignment depends on two numbers agreeing: `spritegen` leaves 2px under the feet
inside the 56px frame box, and `.cw-floor` sits at 21px, so `.cw-actor` is
pinned to `bottom: 19px` to put the feet on the line. Change one, change both.

## ⚠️ Known-fragile points

Read this before filing a bug against yourself.

1. **The usage endpoint is undocumented.** Anthropic can change the URL, the
   payload shape, or the auth scheme at any time with no notice or changelog.
   This is the single most likely thing to break. When it does, the widget keeps
   showing the last good numbers with a stale flag — it does not crash. Recover
   with `node poller/probe.mjs` and update `fieldMap`, or fall back to
   `manual-entry.mjs`.
2. **Session cookies expire.** Expect to re-extract yours periodically. Symptom:
   persistent stale dot + `HTTP 401` in `poller.log`.
3. **Polling an internal endpoint is not a supported use case.** 10 minutes is
   deliberately conservative. Don't lower it.
4. **`fieldMap` is a guess until you verify it.** If percentages look wrong
   (inverted, or 100× off), you've got `invert` or `scale` wrong — not a bug in
   the poller.
5. **launchd needs absolute paths.** The plist hardcodes
   `/opt/homebrew/bin/node` and this project's path. Moving the folder breaks
   the job; re-copy the plist after editing the paths.

## Files

```
widget/claude-usage.jsx    the widget: layout, state machine, sprites, all CSS
tools/spritegen.mjs        sprite pipeline; rewrites the SPRITES block in the widget
sprite/*.png               source sheets (2x2 poses each)
sprite/out/                generated strips + manifest
poller/poll.mjs            primary scraper; degrades gracefully, always exits 0
poller/probe.mjs           dev/repair tool: dump response, suggest field paths
poller/manual-entry.mjs    fallback; self-contained, no network, no shared code
poller/lib.mjs             shared helpers for the scraper path only
config/config.example.json template — copy to config.json (gitignored)
cache/usage.json           last-known-good data (gitignored)
launchd/*.plist            the 10-minute poll job
```
