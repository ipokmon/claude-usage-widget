// ============================================================================
//  Claude Usage — an Übersicht desktop widget
//
//  Reads ONLY from the local JSON cache written by poller/poll.mjs (or by
//  poller/manual-entry.mjs). This file never touches the network: the render
//  loop must stay cheap and must never be the thing that hammers an endpoint.
//
//  Two independent time-of-day axes, both computed from local `Date`:
//    theme     — dark 20:00-07:00, light otherwise
//    activity  — morning / day / evening / bedtime / night
//
//  All motion lives in the injected <style> block below as plain CSS
//  animations. Nothing here computes animation-delay from the clock: Übersicht
//  re-renders every 60s and React keeps the DOM nodes, so the CSS animations
//  run continuously across refreshes. Feeding a fresh delay in on each render
//  would make them visibly jump instead.
// ============================================================================

// ---------------------------------------------------------------------------
// EDIT THIS after cloning — the absolute path to your checkout of this repo.
// Übersicht runs `command` from its own directory, and this file is normally
// installed as a symlink, so neither a relative path nor __dirname resolves to
// anything useful. `tools/install-launchd.sh` prints the line to paste here.
// ---------------------------------------------------------------------------
const PROJECT = "/Users/ivanwu/Desktop/claude/claudetoken widget";

// A missing cache file is REPORTED, not swallowed. The previous `|| true` gave
// empty output, which rendered as the ordinary "no usage data yet" state — so
// a wrong PROJECT above looked exactly like a poller that had not run yet, and
// left no clue anywhere on the desktop.
export const command = `cat "${PROJECT}/cache/usage.json" 2>/dev/null || echo '{"__nocache":true}'`;

export const refreshFrequency = 60000;

// ---------------------------------------------------------------------------
// Set to an hour 0-23 to force a time of day (e.g. 3 = night, 13 = day).
// Leave null for real time. Used for verifying every state without waiting.
// ---------------------------------------------------------------------------
const DEBUG_HOUR = null;

// ---------------------------------------------------------------------------
// Set to a month 0-11 to force the seasonal decoration (e.g. 9 = October).
// Leave null for the real month. Independent of DEBUG_HOUR.
// ---------------------------------------------------------------------------
const DEBUG_MONTH = null;

export const className = `
  top: 10px;
  left: 10px;
  width: 350px;
  font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
`;

// ---------------------------------------------------------------------------
// Time-of-day state machine
// ---------------------------------------------------------------------------

function currentHour() {
  if (DEBUG_HOUR !== null) return DEBUG_HOUR;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

/** Theme boundary per spec: dark 20:00-07:00. Independent of activity. */
function themeFor(h) {
  return h >= 20 || h < 7 ? "dark" : "light";
}

function activityFor(h) {
  if (h >= 6 && h < 11) return "morning"; // waking, stretching, coffee
  if (h >= 11 && h < 18) return "day"; // working at the desk, walks about
  if (h >= 18 && h < 21) return "evening"; // strolling, reading, winding down
  if (h >= 21 && h < 22) return "bedtime"; // getting ready for bed
  return "night"; // asleep, zzz
}

const ACTIVITY_LABEL = {
  morning: "waking up",
  day: "working",
  evening: "winding down",
  bedtime: "heading to bed",
  night: "asleep",
};

function currentMonth() {
  if (DEBUG_MONTH !== null) return DEBUG_MONTH;
  return new Date().getMonth();
}

/**
 * Purely calendar-driven decoration, independent of theme and activity - no
 * network request, no poller, just a month check. Most months have no
 * decoration at all.
 */
function seasonFor(m) {
  if (m === 9) return "halloween"; // October: pumpkin on the windowsill
  if (m === 11) return "holiday"; // December: string lights lit all day
  if (m === 0) return "frost"; // January: frost creeping over the window
  return null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtReset(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = t - Date.now();
  if (diff <= 0) return "resetting now";
  const mins = Math.round(diff / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `resets in ${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `resets in ${h}h ${m}m`;
  return `resets in ${m}m`;
}

function fmtAgo(iso) {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Bar colour ramps within the brand family as usage climbs. */
function levelFor(pct) {
  if (pct >= 90) return "crit";
  if (pct >= 70) return "warn";
  return "ok";
}

const METRIC_ORDER = ["session", "weekly", "weekly_fable"];

// ---------------------------------------------------------------------------
// Scenery
//
// Hand-authored pixel art from tools/propgen.mjs, drawn at the same scale as
// the character so the stage reads as one set. Purely decorative and always
// behind the actor. Regenerate with:  node tools/propgen.mjs
// ---------------------------------------------------------------------------

/* PROPS:BEGIN */
const PROPS = {
  lights: { w: 326, h: 16, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUYAAAAQCAYAAABqd9auAAAAvklEQVR42u3YzQ2CQBCA0a2FoyVYjoVwsj5DAd6904BGEvdG4s+A7PC+ZK6wL0wgoRwP3f05JVEvExcXF9dPrtaxc+fn4uLiCnnJt4L99JxcXFxcIefcGjbqPFxcXFzhF18LvMY9ubi4uBa7eeRX5p9fGy4uLq7F0e9OK/8luLi4uELxJWFcXFxcX8HG4VwnC3Ry3a51Mrku/alOqudlD+2hhbSQFtIe2sNG/iFwcXFx7dklSZIkSZIkSZK0qx7WJKw120g8OwAAAABJRU5ErkJggg==" },
  rug: { w: 112, h: 5, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAAAFCAYAAACdD2g5AAAAQElEQVR42mNgQALn6pL+j+LBjxmwga2p3v9H8dDBZOe6T8/vYOBRffTXhzU3jqbsIZb7cAErLaX/o3jwYWxxBQALPgYpg3ZDlQAAAABJRU5ErkJggg==" },
  fireplace: { w: 46, h: 48, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC4AAAAwCAYAAABuZUjcAAABDklEQVR42u3ZMQoCMRAF0BxCLCwtrWRLD2ApFhaWIpZbWFmIR/AkHsSzeAabaIqAhp24xskkH0f44MIuvM0Ov0jM5bSyiDHn3dwiBhc+m4wtYoz/uYvjvq06b2CFKzwBvl4uqk50xd0NKash8ZzCq4FDzzj1ppKhvkYSfDQYiuS/4LHZkoSz9XipFf+5DhWeCw4941qHCi8w47dDg9fjDu0DVYcQ8BD3iv4WL9bjXbhP8NiLiPV4iLtft2T6jJBIHXatLAQ8huwb8R7nQFPwrD3OBQ/x2esQEs59LCLW49ynC2I9nhvOWoeQG0KS+4Ox5/REoii89h1aKqb2VaaCC4c+WX7+2SAlbJUpQrz3AahWZWR8X51pAAAAAElFTkSuQmCC" },
  lamp: { w: 14, h: 38, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAmCAYAAAD0t6qKAAAAZElEQVR42mNgQANWWkr/sWEGfACk4NPzO1gxXs1kacSnCa9msjQSowmrZrI0gjVdaCEJ4w3hVTUh/3tS3PDH36jGUY2jGkc1jmokCECKsWGC9SM+TD2NQMEEUjC6ZgNiMAOlAABhBJ8ycWJs/AAAAABJRU5ErkJggg==" },
  bookcase: { w: 44, h: 54, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAA2CAYAAAC8yXv8AAACMElEQVR42u2aMU7DQBBFfQxEhSipqDkADW0qqigCaiqEEOIAiBKl5ACUSFwjJ6Cn5wIma+mj8WdnvTsbY6/YSF/EWXv9GE9m/tppXu8X7dPFaev+zlmO8eTosG2wUYJ6wAf7e90HIbl9pEJjOfLN6QV+vzzraX2z7IknDo1ZAKH13XWn2QJvHlY9AVhGWgX++vzoBGBsu/d8qTDuA05JLw0Y2+YIPz6/dPq5dGKMgRiCxfsiMKMAY0I5trg672kIOKTJgGXUfNuTAwMoNsIafE2JCmwBLs78DBX6qeVNCRZSAIr1ArsyPINewgrM+WsBHjo2yl46SNTWFOAYa6rNoR3rBeYTc4S1/OKmIasHKs5QjuKc2F9WDTMwlx/eH/IBv92ueuKSaQaWkcoBhu3MAUbrzoqwNDCpEcaxAJZe+/+kRAUeC7h6iSm8hNbv5aWy+AOkRYofCbZmbRKcSAPm/bnLhYCH7oF4gTGRtlRnYK298heIfQKfh28ZJANrKwEe16qEBoxqwxXD10jMwLKzxQDL1p4K/CcRloCWCMtWXVxKVOAKnANcvcQcvESO2KpqtwaQRqZlfmh5nvpkKRU4apmPL5Nvaa89kNEMEnsFvsfBTYeBpZKAfSeXZoUjJYE5qqEIs8NLBkYktFIXAka7TQHG5xIUT7NMEQ4By0vLEcY/bgHOSolfj6Z2nBKjAMemRAUuHrgkNaX8uANq5m56WI17bd8sS1AjX9sPjucscH4De9GLbG8DAAsAAAAASUVORK5CYII=" },
  windowDay: { w: 42, h: 34, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACoAAAAiCAYAAAApkEs2AAAAkElEQVR42mPoSXH7PxQwA4iw0lIa1BjFofP236AKhoUAtcwbdeiwcOinCy148aBwKCFH4nLsqENHHTrq0KHqUKoVT3WLjlAFwxxKLfOGrkMHa/Nu6DoUX/B/en4HJx5UaXTUodRwKD7H4XPwqENHHTria6ZRh444h66qCfk/FPCoQ6nu0CE3mjfoHTrYHQnDAHPT5LyX0A80AAAAAElFTkSuQmCC" },
  windowNight: { w: 42, h: 34, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACoAAAAiCAYAAAApkEs2AAAAmklEQVR42mPoSXH7PxQwA4iw0lIa1BjFoSY2MVTBsBCglnnD36FvPvwYOSEK8iwMDxqHIjsG2YHomGyHEuNbUkIUnyPxOZbuUT/qUFIwsiWjIUrP4okmuX60CqXUoYO1eTd0HTqaRkcdSkeHDqpmHk1DlNwm3qCMelyeGc1Mow4dsQ5dVRPyfyjgUYdS3aFDbjRv0Dt0sDsShgH64wUKJwBlawAAAABJRU5ErkJggg==" },
  armchair: { w: 30, h: 30, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB4AAAAeCAYAAAA7MK6iAAAAhklEQVR42mNgGLHASkvpPz5MM0vzmkrwYppYPqAWh6RF4cWjFg86i0nKGdSymJA5GGYMC4tJypLEWkwMpprFhAoWUvCoxUTFMbF4wCwmKVeMWjxqcUSAHxwTW4Kh6yGrcCfKEDTziNZDsevJtZiahlDFYvTQoLoeoIIEWmN8lhvQCg+aLhMAguPYRYSHP5cAAAAASUVORK5CYII=" },
  catbed: { w: 52, h: 11, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADQAAAALCAYAAAAwVK6TAAAAUklEQVR42mPYmur9fzhhBhBxsi5lWGC4h4ZVDFlpKf2H4WlVBWD86fmdIYFh7kX2AwMMDHUPMaADZA8NNTzqoVEPDbSHgAIJwwGje8pgKGOYPwB6YACUP18r8QAAAABJRU5ErkJggg==" },
  catbedRim: { w: 52, h: 8, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADQAAAAICAYAAAC2wNw9AAAAR0lEQVR42mPoSXH7j46ttJT+MwxyAHIjNrczgIhVNRFwPNQ8hO52BlwxNBQwzhhCx1tTvYcEJtpDJ+tShgQeuTE06qFB5CEAGkj5yRivxIcAAAAASUVORK5CYII=" },
  pumpkin: { w: 9, h: 10, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAKCAYAAABmBXS+AAAAS0lEQVR42mNgQAJWWkr/e1Lc/oNoBnQAEoQpgGGYGFzBr2NJODFYIYzzoswIKw3CDOgC2NjEmUSUm/A5HiUogJwEXBg9rAzQMUwOAOWBr7VzDARJAAAAAElFTkSuQmCC" },
};
/* PROPS:END */

/**
 * Props that must sit IN FRONT of the cat rather than behind it. The basket's
 * near rim is the only one: drawn behind, it would be entirely hidden by the
 * sleeping cat, which is wider than the basket.
 */
const FOREGROUND_PROPS = new Set(["catbedRim"]);

const Prop = ({ name }) => {
  const p = PROPS[name];
  if (!p) return null;
  return (
    <div
      className={`cw-prop cw-prop-${name}`}
      style={{
        backgroundImage: `url(${p.src})`,
        width: `${p.w}px`,
        height: `${p.h}px`,
      }}
    />
  );
};

const Scenery = () => (
  <div className="cw-scenery">
    <div className="cw-glow" />
    <div className="cw-fireglow" />
    {Object.keys(PROPS)
      .filter((name) => !FOREGROUND_PROPS.has(name))
      .map((name) => (
        <Prop key={name} name={name} />
      ))}
    {/* January: frost creeping over the window, drawn in CSS rather than as a
        sprite - it needs to sit above the window art either theme, and a
        gradient reads fine at this size without new art. */}
    <div className="cw-frost" />
  </div>
);

// ---------------------------------------------------------------------------
// Character sprites
//
// Pixel-art strips built from sprite/*.png by tools/spritegen.mjs and inlined
// as data URIs: the widget is symlinked into Übersicht's widgets dir, so a
// relative asset path would resolve against that dir and 404. Regenerate the
// art (and this block, which is rewritten in place) with:
//     node tools/spritegen.mjs
// ---------------------------------------------------------------------------

/* SPRITES:BEGIN */
const SPRITES = {
  idle: { frames: 4, src: "data:image/png;base64,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" },
  walk: { frames: 4, src: "data:image/png;base64,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" },
  stretch: { frames: 4, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAOAAAAA4CAYAAADkQPSjAAALdElEQVR42u1dLa8lRRB9PwEsAokAgSQkBMEGi0EgEQSD4Q+gCKtIgGUdFrcJGgR/gE0AhyVBkYAEQfh4bE3euTnvbFV3z71zu+puppPO3n1v5r6qqTr11dU9V1f72Mc+9rGPfexjH/vYxz72sY997GMf+9jHPvaxj4HxwlNPX3vzXPdV5HfL66vRX+37t9DNY+VWTkeNmA9fffb627efvzXtZxGhvXuqgtDoeuO5Z27RbP+PaPaut5nJIz/7h3dfX/799M0XN6PHvse+j/nd8vuPpcV4Bb+gCbLz7rXf2TV8z8h9KQwakf89eGuZ1x+/cv3PRy9f//zBSy4IoQB8j11vszIIjS7mlWn2BGI/s3u+vPvO9b/37xyu5+eSpZRGs9FidBkvxpPRu8X32/f8/smdW7KF0ckwlva8/7z3iJ6H7y/0QBYtJwHZgQ+7R/V6q+d1MpMLkcbczQShkXJCARYBOfcYg2UsDAlEaWZ61SrCenrXY2aBkAF4oO/Rv5EhWavw+r0ZAISRX2iBbpLRxPS8GZ7PYpwC2fUivKnCbDEYAfC7L94N78mymD2FhVJ5tKrnZvCxcek9m9kANNpM0f6+/9ry/ycNgOz1PDnAeKp+WtRi9y73fX5n6L6UPAIWhkMsJVQV7RIBuNBL4XULgAxWT3iVAOh55WNogj6YUlaQJwMwMoAjAFxzXyoAW0yGAAwUujIAI1q50HAAYHA9jFImAE12RsdWoRW8/pbfuVX+F+nlsQCE/C4GgJrT9RT6UgH4mAfsXJ8NQM8LRoWzU7wqnk1WtXoUgDwvAoCwMMgfWpNL9QcGLwiALeWCguF5/PLVe13vng1AFIk8vtbQBXlGyg5lzfKAxwDQ7rOqcC+tSi3CjDLoVfxaCn3pADTQcam7Bb7ZAITMeCKK8RSst4DNMwo/7fsx8Tdn8HssAHFPK3TdAVgMgFy46D2HTPCZoplhsMmhpgcepA0orEQTPES5H+ebqLbOCt1Af0vX1gKQwZe6DrgD8HEAjjwL7YaZyYMpmnloq8zq2qXSbmu7PU/A62gegDnU5d/PzJ16urYWgCNdXlMVEwz2BLUGgBkKOiJEXhPiSuYIAPn6TAAua3+PeLDOEA414Skgx2jNU+dhsfom59UCBb6T1+F2AJ6BwR4AtQhzaQA0IZlXUADCA6wFYEZRAgDkCi17KoAQv28VyTCR8zIAkfM91nFz830ZAIx0FAAEvWgkaMmvVKskM9gDFQslehhZHmLtuhk3GLTyDM/zZZSvORz0AAj+LEdrVXBHJntW7jlF/pdhfCKjz/JBXjtSbCvTJqmd7z2hIB9oAbCMe+/kuyy8XtJeQYBQRPPkqNKi2HIIT08AnreUoc9ltueAcYkaD0YNCutmSRD2qk2jjFZw77rnq9U5sibn8wQ3c48Z/oZ68i1kFzVfZAJQczrs/BgJrUeWIMrshgCTvHVjDVMojXNhILtDhGmA144ac9fkfbwWptHDuUPT2QD0jNYsALJeIqSOdt8c6+FTO2E0tl72W1EH/Jo8grcyafd8VqGCAWhK1NpWNBrCaIWQ864ZSy8RADkEPRcAwf8smfLyh+7M2GpCR1I939JxjqoZKegaC8P3svfMWKy2v2m0c2sZC3Ctd2+tcR6+e/KWHc5nFYCoCmKOeEbveg1BZxbV8Gx5P1+0HelUI5MVrV2x0Hrbbk6ZM2Nt9oBcEQMAtwAfL4BnAZArgtzxwksEmF6rmmdM9HoF4OylBwXgOXQzbfM4K+q558yqKIeFW+dEalC8iuosJVX5cQVb81btYPHCVb1eK95ZAOQ1ynPq6BMNwJnC0yLMOQEYdQplVK2Rr6FVzcvfOX/z1tSws94mwjIAcvbSUtSbugOwOAARWp+jKsjg857dbAVVOgBAhG0abnPHjCd/bklTAM4+RazVHD6a13Iu3NsZMR2Aa5qwL63atLbJfK2ljNYTM7pDmBYsMEcFNM4VPSMSecCZRQqNYPg5c64atZtFvcuRs0lZnB/p/QRBo7sDep0K3NqUAUC0T/W8PvdBery09t9lbljldcqWsvE+wlbrHcs/A4BmDLYEYFSI4lrBNBn2AMiM9ipoay1NFgA59xmtCHq8eACssisedLSUE3JoGV/uAZ19iG2riLY1ALnYhM9nByCHUFE/51oAaldIaxF7xpKEAlCLDyO5qseLFxXwOlLmWq63rWpkh0vvXJzZzRReCIqiEntw1kuu+nqGEc8D4TWW2/ieKTtc2L3zvq9ze0B9OOe2MufygF6/LHuICgBEqM2KOjo5PM0CoBeloTjUO5u1lzJ5nVoM9rN7P88zKDhAXJQDep5Tc0BdmOaq1axwDQJB8y4/7FY4pjkg76vTogeHfVdJg2Vqp7799tODcP749b3lGp7eNZjZAITeQA6nFtDQq4yTAljHpxRgNGfgCtDhGIPvP2u2+4DoVjEDlobXpjQEndWu1doV3itpL6EP9bjqrvMKAGRlBaD+/eMHd/716zfLBNjss15jPzcdsGnfl9msDG/M+nPK2qDuguCK8FQjo3E2fzbrcKql0R0R/P0zhQnPcGr/IHeFeCeiXRUY9oztKEUDjges1jRvZ/fifgMhPs8+C1T1lPuVYcxVBqOTK+H4nLJ1To8vYIvg7YxHzhh5CfxOFVPzkNmVwiihj/hgfpgn79mU2MoiiorDh+HB1oBQPaXdbyDMBKDyhrdU8fROedNr+Dr7DGPDBbe03IHdsHfe5LFJPEIHPm8lawf5qTxB8FV2xfe8xXL2zQ0IWyGpNwE84xfPrAp/yyvigpAZeWtkePA8qoTXjwnNThE2opAn6ERYwhN5hF6niX7mG0n5FG+m1+NH+UDRAuGYfWYQVztyA7kgT6OdCyutqV6jioGBjhpNkE/PkHAuy6CEd2f+0kEI5nr5g4LN+5kqr31vhVc5e9Yz4gdFCngQfIbQKno/DZNb4ZiGZvYvZIXPNivwyV4dtI54da3uQrYwNBzllAAhGDsmZFFLAytjs4Kiqgfs5T5e+AYPqGejVgGgvircqr9WDItOw2blA+jYgMLgZHp6rVUAiAaiNYUm8IWwU41Vmo4yg5o7rK2kqfVhF59tSTUMXcuP5gzgqSIAj9kJjsINRwNVAMjHi/C5n0azATFa84Qee6E1DNDUFrSe4NgyAIgjIGShIezUdZbsYwq9AsUIT8hn+dkwT5cMQO/oCvb8XISpAkDQwnrKoXMvzEYuD964CWO6fno7qnXJALkhphVqdLJFwRoLlFatTNZhtlg7iviKLCT4gWEBELNfTbYVALXzxwtRqwGQt1FxN4tOL+Jhz+5t5UoDoLdozovPnmA4bNWWpsjKZHgN7ilkmj2+IGAOb+ANsW7EPKW/4tgB4DGdIronjhe8KwCQNwSPnO0KPePCIkdpDEDWjRQAakuVx6AeS8dxs4Z0sDJQTG17yzwnlDesRvzYM/DCbwVgpW6Y1ibWLTZRVzlgee0pDuwgMHnpQZvPpzPndamsCWPgIWFpeJFT4/XMU4i1QSBSUt7QikVdTM0DK3iIqFroGdDRGZ2UViXP1WMTW1NfwsKGSl80dFXJwqzdQ9aKw6sIsaekUSimHTFqPautBWob4Sl9k9WWWrgP1HttQGtqFFfu/SXeKVsjUxd+vdd3Veqm4PytxY/X+Dt7N8cx8lNPpuG11yrI/OEgp6xtSCMAxOsTsK1IC2wcdYF/feVCSQCCOTQiq0JGkwWIBWB9R3klAOLNQlxo8njiF11qc3ZVAPJ7/HBcvvduR416br2a4Gb/ZEUALjpGJ2XrnkWdkCGf+Mb7AUt6QFteUOBFDPI7yPleWNdqIZpHp6ecHk8l3y3nhNhRx4tHc+u+ar2ureUSj7/oHq56X1UTYm+ecn11Hi+Zr2PpflJkt5a3ynLcxz72sY997OMyxv+chHEFw2DYjQAAAABJRU5ErkJggg==" },
  coffee: { frames: 4, src: "data:image/png;base64,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" },
  work: { frames: 2, src: "data:image/png;base64,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" },
  read: { frames: 4, src: "data:image/png;base64,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" },
  yawn: { frames: 4, src: "data:image/png;base64,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" },
  sleep: { frames: 4, src: "data:image/png;base64,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" },
};
/* SPRITES:END */

const SPRITE_W = 56; // frame box; must match FRAME in tools/spritegen.mjs

/** Seconds per full cycle, per state. Slow states read as calm, not stalled. */
const CYCLE_SECONDS = {
  idle: 2.0, walk: 0.62, stretch: 2.6, coffee: 2.0,
  work: 0.55, read: 2.8, yawn: 3.0, sleep: 3.6,
};

/**
 * Every state stays mounted and keeps cycling; the per-activity CSS timeline
 * only cross-fades opacity. Mounting on demand would restart the fast walk and
 * typing cycles from frame 0 each time a state appeared.
 *
 * Two nested elements on purpose: the outer one owns the opacity timeline and
 * the inner one owns the frame cycle, so the two animations never collide on
 * the `animation` shorthand.
 */
// ---------------------------------------------------------------------------
// The cat
//
// Generated by the same tools/spritegen.mjs run as the character (its `cat`
// job), from the single 4x3 sheet in sprite/cat/. Three states: walk, sleep,
// clean.
// ---------------------------------------------------------------------------

/* CAT:BEGIN */
const CAT = {
  walk: { frames: 2, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAYAAADuFn/PAAADu0lEQVR42u2arY4VQRCF9xFISLAIwhsgQCEIbgWWIDAIBA6HQaBB4EBhNigEAkWCw4HCEB4AiUEiLvkmOaS2Uj23Z253zyWpSir3Z2d2T1Wdrr+dk5OUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJTOcvHCpZ30f8Z+VPhrQNlrrly+OunWRixxpsV+49r1o8B/DtTtm7eKoLzzufb+vbvT+61xW2fWYOf6p08eT/g3DYB36McPZxMwH4TI+VzH9VsEwDvz5fNnk0ZB8CmHa3D8l8/vp3uOJgB3Tk93f35/3/36+fVcELyxKAF49/bV7se3T9PnLdOOiANuHwSfLi15CACv3QJQkxejAKA4F6DWCDneKtdteQKEiwCAG0J48sjpXjkF2NwlAPwBIoyDSn/AMxswsAjFGIwS4yPnS0cXMs9qEUHkQbGlhNcqdjXthsQInC9G7CtMMgLQOJ17VAtqjBgdhIjZSodg5n1tAGwQmoEjD4oJtQEQw7l3qQHNjViYfoQbXYK5WwDIbTAYffTwwT8n7xtISrmyVkcMNh5zqTZtGgDYqx5Xv5xAcCJ6OX9UGuqBu2kd8MBsACiuc4NJrZNt8bO1Y0QaWst8DWoeu+2EugVAzLSrgzUsskyxkzCnjdPVOwCHsL+E/c3rF5POTdEHdwh+TI8MqWFTZARFXgX/0ADsWyGUsK8JAAVb7TZNR/M0FAXA9vSlKdcPKrAbJYXZFOSHHxV+DGsdAHuaraPmyANmdUa2FvouEefzGRs4Cc3TkHVYlBNrA6CZgO8ADFgZAZP0mSC0CkDNaS4FQM4XbvK8vrOnFrzMTJohmnZDNUc0MiaafPksluvoetUepiX+Umr0J6F0je7XaY2UAHDCm69U5sB5kHO1QdvGyPFagMGelku5mk7Hk8crrIfZJcLoBHRrn2sCEBnjWz2c6w1R2mnaws1M6EsJpBplcesVxtv7urdsSzoFn4KUH6Vyes/BK1of1/b4wm7Zj1r8Q9YmawctrwBW3le303PlEP2Xay12NQ/Cz6tWJps63w5kpS4pCoT2Sr2xg0VtrxgeTbNzHZ6dcqXDVubaB+E0FccIfClIOsJi/6hFm7Brb6WVuidN6T9dKrxKm9wr0gx9AkJGKAfaSm93/mq9IoNkvIaVUft+bXNt8bRpD8wihl8hqOGw2NViDn8ERUdZw4cKD4A1JUatowzSsIVqzz563y9n+y5H35ceHtCqAeKgmz35UHoAad+RjNrRY8G+72dLrklJSVkqfwFNibF+2maXpAAAAABJRU5ErkJggg==" },
  sleep: { frames: 2, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAYAAADuFn/PAAADTElEQVR42u2ZL4/VQBTF9yOQkKxFEL4BYlEIgluBJQjMCgQOh0GgQeBAYTYoBAJFglsHCkP4AEgMEvHIr8khh7vTzrRv+vZB7klutu2bac/9O3NnDw4SiUQikUgkEolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJHaPy5cON5I5Y1vG75sOkf+F6yECV69cmyTjZBl75/i4OmeXOsBljg4tOq8OCNy+eWsw5o3rR38RGhPGPXn8aPPr59dzTriIyOIb9+/dHTihy5hR3ejo8O3Lx83DByfn+MuR7tDViEMAQ354f/rHASKIRMPzm4wfHeDzSs5cSwe+BX/4wK3Ex+9x0qezd6Pj+V3iNumuBy+TMX98/zxci7AT8GevXz0fxkYHKJMi+eiItR2AkA2Ri4vzdwdMzZE+XfVwB6AA2VAjwRicQPrWHBCjaG0HwKlmfOkg/l6CWhzQNZh4CQZ88ezp8LdGICqheZ7CY5kTS1pvB8CnxfgI43AYwrXX+1IJihWhSzB5XZ9j+DHxLJiqqb0zITq+VUqGlT1i3R8rr4uDKS6sPRxQIl16d+8s6KWD+HuE1967tQN6GT8at7Ye7KMDYoa2rAmL9PC9bk/jxzRuzZR9Mn4sny0lbLYesRkpLVCSWCdLuyEW4paaGdNczirxa9Vlit9Yrffn8Ee0/W6tDKX1bvaiVer6vMHyLjE2WOo6tXMqtfdjpH1XtK0DYscqkWG1tY6/Sw8FUHRAS18jPRY5gIlv37wcDKluGLI0KHSIulZT4+QZyxg1MFKEOTEbSorHcrWNA7SFVhDAiXuCB/3UnImXc4Oz5vEe5kq4LwVSNP5iB+gsB2Py17tIGVIOwNhOHHKKKuZ6V4niOo8p9QIta8DcEgQfGRAuCiI5w7tj/7YCi+/hLI1DuG8pb4vXMqUaxDGaG1HCMxSAKAoxLh5exWMJnNe6aPXYBek93tlGwZieGQjXmutdvfRWdrTulrY+gtaBnAukStGBMyAoAj5Xz2stfG8HSBRMHhR839c26SYnqBxr3tRxTHc9fL8LCReMqbpa+k1EyCI993Vh6lS095mQ3olR4eZctWkY009BpIVbx/IlWe2ovXb+31N29R+xf1mPROL/wW+bZTanpj/8fQAAAABJRU5ErkJggg==" },
  clean: { frames: 4, src: "data:image/png;base64,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" },
};
/* CAT:END */

const CAT_W = 48; // frame box; must match the cat job's `frame` in spritegen

const CAT_CYCLE_SECONDS = {
  // Slower than the rabbit's equivalents on purpose - the cat is the calmer of
  // the two, and a brisk cat next to a stationary rabbit reads as agitated.
  walk: 1.0, sleep: 7.0, clean: 3.6,
};

/**
 * Same four-level structure as Actor: .cw-cat traverses, .cw-cat-flip faces,
 * .cw-cat-sprite fades, .cw-cat-film cycles. See CLAUDE.md for why the flip is
 * its own level rather than folded into the element carrying the shadow.
 */
const CatActor = () => (
  <div className="cw-cat">
    <div className="cw-cat-flip">
      {Object.entries(CAT).map(([state, s]) => (
        <div className={`cw-cat-sprite cw-c-${state}`} key={state}>
          <div
            className="cw-cat-film"
            style={{
              backgroundImage: `url(${s.src})`,
              backgroundSize: `${s.frames * CAT_W}px ${CAT_W}px`,
              animation: `cw-catcycle${s.frames} ${CAT_CYCLE_SECONDS[state] || 2}s steps(${s.frames}) infinite`,
            }}
          />
        </div>
      ))}
    </div>
  </div>
);

const Actor = () => (
  <div className="cw-actor">
    <div className="cw-flip">
    {Object.entries(SPRITES).map(([state, s]) => (
      <div className={`cw-sprite cw-s-${state}`} key={state}>
        <div
          className="cw-film"
          style={{
            backgroundImage: `url(${s.src})`,
            backgroundSize: `${s.frames * SPRITE_W}px ${SPRITE_W}px`,
            animation: `cw-cycle${s.frames} ${CYCLE_SECONDS[state] || 2}s steps(${s.frames}) infinite`,
          }}
        />
      </div>
    ))}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export const render = ({ output }) => {
  const hour = currentHour();
  const theme = themeFor(hour);
  const activity = activityFor(hour);
  const season = seasonFor(currentMonth());

  let cache = null;
  let parseError = false;
  const raw = (output || "").trim();
  if (raw) {
    try {
      cache = JSON.parse(raw);
    } catch {
      parseError = true;
    }
  }

  const data = cache?.data ?? null;
  const hasData = data && METRIC_ORDER.some((k) => data[k]);
  const stale = Boolean(cache?.stale);
  const noCache = Boolean(cache?.__nocache);

  return (
    <div className="cw-root" data-theme={theme} data-activity={activity} data-season={season}>
      <style>{CSS}</style>

      <div className="cw-card">
        <header className="cw-header">
          <div className="cw-title">Claude Usage</div>
          {hasData && stale && (
            <div
              className="cw-badge"
              title={
                cache?.last_error
                  ? `Stale — showing last known-good data.\n${cache.last_error}`
                  : "Stale — showing last known-good data."
              }
            >
              <span className="cw-dot" />
              stale
            </div>
          )}
        </header>

        <div className="cw-metrics">
          {!hasData && (
            <div className="cw-empty">
              {parseError
                ? "Cache file is unreadable."
                : noCache
                  ? "No cache file at that path."
                  : "No usage data yet."}
              <span className="cw-empty-hint">
                {noCache ? (
                  <>
                    Check <code>PROJECT</code> at the top of{" "}
                    <code>claude-usage.jsx</code> points at your checkout.
                  </>
                ) : (
                  <>
                    Run <code>node poller/poll.mjs</code> — or{" "}
                    <code>manual-entry.mjs</code> to enter it by hand.
                  </>
                )}
              </span>
            </div>
          )}

          {hasData &&
            METRIC_ORDER.map((key) => {
              const m = data[key];
              if (!m) return null;
              const pct = Math.max(0, Math.min(100, Number(m.pct) || 0));
              const reset = fmtReset(m.resets_at);
              return (
                <div className="cw-metric" key={key}>
                  <div className="cw-metric-top">
                    <span className="cw-metric-label">{m.label || key}</span>
                    {reset && <span className="cw-metric-reset">{reset}</span>}
                    <span className="cw-metric-pct">{pct}%</span>
                  </div>
                  <div className="cw-track">
                    <div
                      className="cw-fill"
                      data-level={levelFor(pct)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
        </div>

        {/* ---- character stage: kept visually separate from the data ---- */}
        <div className="cw-stage">
          <div className="cw-floor" />
          <div className="cw-scene">
            <Scenery />
            <CatActor />
            {/* basket rim occludes the sleeping cat - see FOREGROUND_PROPS */}
            <Prop name="catbedRim" />
            <Actor />
          </div>
        </div>

        <footer className="cw-footer">
          <span>{ACTIVITY_LABEL[activity]}</span>
          <span className="cw-foot-right">
            {hasData
              ? `${cache?.source === "manual" ? "manual" : "synced"} · ${fmtAgo(cache?.fetched_at)}`
              : "—"}
          </span>
        </footer>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles + animation. Injected as a plain <style> tag so keyframes are not
// rewritten by Übersicht's Emotion/stylis pipeline.
// ---------------------------------------------------------------------------

const CSS = `
.cw-root { --coral:#CC785C; --coral-dim:#B5654B; --cream:#F2E7DC; }

/*
 * Both themes run dark chrome, tinted cobalt to sit with the desktop wallpaper
 * rather than glowing against it. The day/night difference now lives in the
 * STAGE - a warm lit room by day, a dark one at night - instead of in the card.
 *
 * The wall and floor are near-opaque on purpose. They used to be thin washes
 * that took their lightness from the card behind them, so darkening the card
 * would have dragged the room down with it; at these alphas the room keeps its
 * own colour no matter what the chrome does.
 */
.cw-root[data-theme="light"] {
  --card-bg: rgba(16,24,46,0.72);
  --card-brd: rgba(255,255,255,0.10);
  --text: #F2F4F8;
  --text-2: rgba(226,232,244,0.60);
  --track: rgba(226,232,244,0.16);
  /* Wall: same warm-to-cool hue you liked, taken down to a mid tone. At its
     original lightness it became a glaring slab once the chrome went dark. */
  --stage-a: rgba(150,142,136,0.95);
  --stage-b: rgba(136,146,164,0.94);
  /* floor: warm wood, clearly darker than the wall so the room has a ground */
  --floor-a: rgba(126,103,84,0.96);
  --floor-b: rgba(100,81,66,0.98);
  --floor-edge: rgba(58,40,28,0.50);
  --shadow: 0 10px 30px rgba(0,0,0,0.42);
}
.cw-root[data-theme="dark"] {
  --card-bg: rgba(9,14,30,0.78);
  --card-brd: rgba(255,255,255,0.09);
  --text: #F2F4F8;
  --text-2: rgba(226,232,244,0.56);
  --track: rgba(226,232,244,0.14);
  --stage-a: rgba(26,30,54,0.94);
  --stage-b: rgba(44,32,46,0.92);
  /* One shade up from (42,32,36)/(24,18,22): at those values the floor sank
     into the wall after dark and the floor line all but vanished. */
  --floor-a: rgba(58,45,48,0.96);
  --floor-b: rgba(38,29,32,0.98);
  --floor-edge: rgba(255,255,255,0.12);
  --shadow: 0 10px 32px rgba(0,0,0,0.55);
}

.cw-card {
  position: relative;
  /* Height adapts to however many metrics the payload actually returns.
     Fixed at 250px it leaves a dead band when a metric is unmapped. */
  width: 350px;
  box-sizing: border-box;
  display: flex; flex-direction: column;
  background: var(--card-bg);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  backdrop-filter: blur(30px) saturate(180%);
  border: 0.5px solid var(--card-brd);
  border-radius: 22px;
  box-shadow: var(--shadow);
  color: var(--text);
  overflow: hidden;
}

.cw-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 13px 16px 8px;
}
.cw-title { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }

.cw-badge {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 500; color: var(--text-2);
}
.cw-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #E8A33D;
  animation: cw-pulse 2.4s ease-in-out infinite;
}
@keyframes cw-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }

.cw-metrics { padding: 0 16px; display: flex; flex-direction: column; gap: 9px; }

.cw-metric-top {
  display: flex; align-items: baseline; gap: 6px;
  margin-bottom: 4px;
}
.cw-metric-label { font-size: 12.5px; font-weight: 500; letter-spacing: -0.01em; }
.cw-metric-reset { font-size: 10.5px; color: var(--text-2); }
.cw-metric-pct {
  margin-left: auto;
  font-size: 12.5px; font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.cw-track { height: 5px; border-radius: 3px; background: var(--track); overflow: hidden; }
.cw-fill {
  height: 100%; border-radius: 3px;
  background: var(--coral);
  transition: width 0.6s cubic-bezier(0.4,0,0.2,1);
}
.cw-fill[data-level="warn"] { background: #D9924A; }
.cw-fill[data-level="crit"] { background: #C4553F; }

.cw-empty { font-size: 12px; color: var(--text-2); line-height: 1.5; padding: 6px 0 2px; }
.cw-empty-hint { display: block; font-size: 11px; opacity: 0.85; }
.cw-empty code {
  font-family: "SF Mono", ui-monospace, monospace; font-size: 10.5px;
  background: var(--track); padding: 1px 4px; border-radius: 3px;
}

/* ---- stage ---- */
.cw-stage {
  position: relative; margin-top: 13px;
  height: 92px; overflow: hidden;
  background: linear-gradient(160deg, var(--stage-a), var(--stage-b));
}
.cw-scene { position: absolute; inset: 0; z-index: 1; }
/* The floor is a filled plane rather than a hairline, so the stage reads as a
   room with a ground instead of one flat wash. It has to paint BEHIND the
   scenery: the rug tucks under the floor line and would be covered otherwise. */
.cw-floor {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 0;
  height: 21px; box-sizing: border-box;
  background: linear-gradient(180deg, var(--floor-a), var(--floor-b));
  border-top: 1px solid var(--floor-edge);
}

/* ---- scenery ----
   Decorative only, and always behind .cw-actor. Positions are tuned so the
   middle of the stage stays clear: the character traverses x=26..250 and
   passes in front of everything here.                                      */
.cw-scenery { position: absolute; inset: 0; z-index: 0; }
.cw-prop {
  position: absolute;
  background-repeat: no-repeat;
  image-rendering: pixelated;
}
/* Each of these carries 2px of shadow below the artwork (see propgen's
   withContactShadow / withDropShadow), so the bottom value is 2px lower than
   the surface the prop actually rests on.
   NB: no backticks in this block - the whole stylesheet is a JS template
   literal, so one would terminate it and break the widget. */
/* Layout, left to right: lamp, the character's working area, window, shelf,
   armchair on the rug, fireplace, the cat's basket. The plant that used to
   close the right end was dropped when the basket took that space - it is
   still in propgen.mjs, one commented line away from coming back. Window,
   shelf and rug all stay put: the character's shadow flips against the window
   at x=120 and the flip points are solved per walk segment, so moving it would
   mean recomputing every cw-*-shadow keyframe. */
.cw-prop-lights      { left: 12px;  bottom: 74px; }
.cw-prop-lamp        { left: 6px;   bottom: 19px; }
/* wider window sits further left so it keeps clear of the shelf at x=152 */
.cw-prop-windowDay,
.cw-prop-windowNight { left: 96px;  bottom: 34px; }
.cw-prop-bookcase    { left: 146px; bottom: 19px; }
.cw-prop-armchair    { left: 196px; bottom: 19px; }
.cw-prop-fireplace   { left: 236px; bottom: 19px; }
/* The basket closes the right end of the room, just past the fire, so the cat
   still sleeps in the warmest corner. */
.cw-prop-catbed      { left: 292px; bottom: 19px; }
/* the rim shares the basket's left edge and sits on the floor line itself,
   since unlike the base it carries no contact shadow of its own */
.cw-prop-catbedRim   { left: 292px; bottom: 21px; }
/* the rug lies flat ON the floor plane, so it sits well below the floor line
   that everything else stands on; the armchair sits on its right end */
.cw-prop-rug         { left: 112px; bottom: 11px; }
/* seasonal (October) - sits on the windowsill's right pane, clear of the
   central mullion at x~116-118 */
.cw-prop-pumpkin     { left: 118px; bottom: 36px; opacity: 0; }

/* ---- seasonal decoration ----
   A third axis, independent of theme and activity: purely a calendar check,
   no network involved. Most months show nothing at all. */
[data-season="halloween"] .cw-prop-pumpkin { opacity: 1; }
/* same treatment as the window it sits beside: no shadow in the light theme,
   since it sits right at the room's daytime light source, but a normal
   dark-theme drop-shadow like every other prop gets */
[data-theme="dark"][data-season="halloween"] .cw-prop-pumpkin {
  filter: drop-shadow(-2px 1px 1px rgba(0,0,0,0.50));
}

/* Firelight. Unlike the lamp this is lit in BOTH themes - the fire is burning
   either way - just stronger after dark when there is less to compete with. */
.cw-fireglow {
  position: absolute; left: 213px; bottom: 14px;
  width: 92px; height: 76px; opacity: 0.55;
  background: radial-gradient(ellipse at 50% 55%, rgba(240,146,70,0.30), rgba(240,146,70,0) 70%);
}
[data-theme="dark"] .cw-fireglow { opacity: 1; }

/* the bulbs pick up a warm halo after dark, same idea as the lamp spill */
[data-theme="dark"] .cw-prop-lights {
  filter: drop-shadow(0 0 2px rgba(242,208,132,0.55));
}
/* December: the same halo, but lit all day rather than only after dark -
   the string is switched on for the season, not just for the night */
[data-season="holiday"] .cw-prop-lights {
  filter: drop-shadow(0 0 2px rgba(242,208,132,0.55));
}

/* one window at a time, following the theme rather than the activity, so it
   agrees with the card around it */
.cw-prop-windowNight { opacity: 0; }
[data-theme="dark"] .cw-prop-windowDay   { opacity: 0; }
[data-theme="dark"] .cw-prop-windowNight { opacity: 1; }

/* January: frost creeping in from the window's top corners. Sits directly on
   top of the window prop (same box, painted after it in DOM order), under
   both themes - the cold doesn't care which one is running. */
.cw-frost {
  position: absolute; left: 96px; bottom: 34px;
  width: 42px; height: 34px; opacity: 0;
  /* fixed-radius circles rather than keyword sizing (farthest-corner etc.) -
     those spread the white across nearly the whole pane and read as a hazy
     smudge instead of frost sitting in the corners */
  background:
    radial-gradient(circle 15px at 0% 0%,   rgba(255,255,255,0.85), rgba(255,255,255,0) 100%),
    radial-gradient(circle 15px at 100% 0%, rgba(255,255,255,0.85), rgba(255,255,255,0) 100%),
    radial-gradient(circle 9px at 0% 100%,   rgba(255,255,255,0.55), rgba(255,255,255,0) 100%),
    radial-gradient(circle 9px at 100% 100%, rgba(255,255,255,0.55), rgba(255,255,255,0) 100%);
}
[data-season="frost"] .cw-frost { opacity: 1; }

/* Warm spill from the lamp, lit only in the dark theme. Cheap way to make the
   night scene feel occupied without drawing a second lit-shade sprite. */
.cw-glow {
  /* centred on the lamp shade, which sits at x≈15, y≈53 above the floor */
  position: absolute; left: -21px; bottom: 26px;
  width: 72px; height: 60px; opacity: 0;
  background: radial-gradient(ellipse at 50% 48%, rgba(242,208,132,0.22), rgba(242,208,132,0) 70%);
}
[data-theme="dark"] .cw-glow { opacity: 1; }

/* ---- sprite actor ----
   .cw-actor  walks the width of the stage (translateX) and faces left/right
              (scaleX). .cw-sprite fades a state in or out. .cw-film runs the
              frame cycle. Three levels so the transforms never fight.        */
.cw-actor {
  position: absolute; left: 0; z-index: 1;
  /* spritegen leaves 2px of padding under the feet inside the 56px box, and
     .cw-floor sits at 21px, so 19px puts the feet exactly on the line */
  bottom: 19px;
  width: 56px; height: 56px;
}
/* Facing lives here, NOT on .cw-actor. A filter is applied before transform,
   so a scaleX(-1) on the element carrying the shadow would mirror the shadow
   with it and the character would light from the wrong side mid-walk. */
.cw-flip { position: absolute; inset: 0; }
.cw-sprite { position: absolute; inset: 0; opacity: 0; }

/* ---- cast shadows ----
   One dominant light per theme: the window (x~120) by day, the fire (x~277)
   after dark. Everything throws away from it, and the offsets are hand-set per
   prop rather than computed - there are only a handful and eyeballing beats a
   formula at this scale. The ceiling string is deliberately excluded.        */
[data-theme="light"] .cw-prop-lamp       { filter: drop-shadow(-3px 1px 1px rgba(28,20,14,0.40)); }
[data-theme="light"] .cw-prop-bookcase   { filter: drop-shadow(3px 2px 1px rgba(28,20,14,0.40)); }
[data-theme="light"] .cw-prop-armchair   { filter: drop-shadow(3px 1px 1px rgba(28,20,14,0.42)); }
[data-theme="light"] .cw-prop-fireplace  { filter: drop-shadow(2px 1px 1px rgba(28,20,14,0.32)); }

[data-theme="dark"] .cw-prop-windowDay,
[data-theme="dark"] .cw-prop-windowNight { filter: drop-shadow(-3px 2px 1px rgba(0,0,0,0.50)); }
[data-theme="dark"] .cw-prop-bookcase    { filter: drop-shadow(-3px 2px 1px rgba(0,0,0,0.50)); }
[data-theme="dark"] .cw-prop-armchair    { filter: drop-shadow(-4px 1px 1px rgba(0,0,0,0.55)); }

/* After dark the character is always left of the fire, so its shadow never
   needs to flip - only the daytime walk crosses the window. */
[data-theme="dark"] .cw-actor { filter: drop-shadow(-3px 2px 1px rgba(0,0,0,0.50)); }

[data-theme="light"][data-activity="day"] .cw-actor {
  animation: cw-day-move 48s linear infinite, cw-day-shadow 48s steps(1) infinite;
}
[data-theme="light"][data-activity="evening"] .cw-actor {
  animation: cw-eve-move 40s linear infinite, cw-eve-shadow 40s steps(1) infinite;
}
[data-theme="light"][data-activity="morning"] .cw-actor {
  animation: cw-mor-move 26s linear infinite, cw-mor-shadow 26s steps(1) infinite;
}
/* Flip points are where the character's centre (translateX + 28) passes the
   window at x=120, i.e. translateX = 92, solved along each walk segment. */
@keyframes cw-day-shadow {
  0%    { filter: drop-shadow(-3px 2px 1px rgba(28,20,14,0.45)); }
  46.8% { filter: drop-shadow(3px 2px 1px rgba(28,20,14,0.45)); }
  74.7% { filter: drop-shadow(-3px 2px 1px rgba(28,20,14,0.45)); }
}
@keyframes cw-eve-shadow {
  0%,11.4%    { filter: drop-shadow(-3px 2px 1px rgba(28,20,14,0.45)); }
  11.6%,62.3% { filter: drop-shadow(3px 2px 1px rgba(28,20,14,0.45)); }
  62.5%,100%  { filter: drop-shadow(-3px 2px 1px rgba(28,20,14,0.45)); }
}
@keyframes cw-mor-shadow {
  0%,30.3%    { filter: drop-shadow(-3px 2px 1px rgba(28,20,14,0.45)); }
  30.5%,82.2% { filter: drop-shadow(3px 2px 1px rgba(28,20,14,0.45)); }
  82.4%,100%  { filter: drop-shadow(-3px 2px 1px rgba(28,20,14,0.45)); }
}
.cw-film {
  position: absolute; inset: 0;
  background-repeat: no-repeat;
  /* strips are authored at 1 device px per art px, so keep the edges hard
     instead of letting the compositor resample them */
  image-rendering: pixelated;
}

@keyframes cw-cycle4 { from { background-position-x: 0px } to { background-position-x: -224px } }
@keyframes cw-cycle2 { from { background-position-x: 0px } to { background-position-x: -112px } }

/* =========================== DAY (48s) ===========================
   At the desk, then a walk across the stage, a coffee and a stretch
   at the far end, and a walk back. Real traversal, not a frame swap. */
[data-activity="day"] .cw-actor     { animation: cw-day-move 48s linear infinite; }
[data-activity="day"] .cw-flip      { animation: cw-day-face 48s steps(1) infinite; }
[data-activity="day"] .cw-s-work    { animation: cw-day-work 48s steps(1) infinite; }
[data-activity="day"] .cw-s-walk    { animation: cw-day-walk 48s steps(1) infinite; }
[data-activity="day"] .cw-s-stretch { animation: cw-day-stretch 48s steps(1) infinite; }
[data-activity="day"] .cw-s-coffee  { animation: cw-day-coffee 48s steps(1) infinite; }

@keyframes cw-day-coffee { 0%{opacity:0} 51.5%{opacity:1} 62%{opacity:0} }
@keyframes cw-day-move {
  0%,45%     { transform: translateX(30px); }
  51.5%,70%  { transform: translateX(250px); }
  76.5%,100% { transform: translateX(30px); }
}
@keyframes cw-day-face { 0%{transform:scaleX(1)} 70%{transform:scaleX(-1)} 76.5%{transform:scaleX(1)} }
@keyframes cw-day-work { 0%{opacity:1} 45%{opacity:0} 76.5%{opacity:1} }
@keyframes cw-day-walk { 0%{opacity:0} 45%{opacity:1} 51.5%{opacity:0} 70%{opacity:1} 76.5%{opacity:0} }
@keyframes cw-day-stretch { 0%{opacity:0} 62%{opacity:1} 70%{opacity:0} }

/* ========================= EVENING (40s) =========================
   Strolls out, reads a while, stretches, strolls back.             */
[data-activity="evening"] .cw-actor     { animation: cw-eve-move 40s linear infinite; }
[data-activity="evening"] .cw-flip      { animation: cw-eve-face 40s steps(1) infinite; }
[data-activity="evening"] .cw-s-idle    { animation: cw-eve-idle 40s steps(1) infinite; }
[data-activity="evening"] .cw-s-walk    { animation: cw-eve-walk 40s steps(1) infinite; }
[data-activity="evening"] .cw-s-read    { animation: cw-eve-read 40s steps(1) infinite; }
[data-activity="evening"] .cw-s-stretch { animation: cw-eve-stretch 40s steps(1) infinite; }

@keyframes cw-eve-move {
  0%,8%      { transform: translateX(26px); }
  17%,57%    { transform: translateX(196px); }
  66%,100%   { transform: translateX(26px); }
}
@keyframes cw-eve-face { 0%{transform:scaleX(1)} 57%{transform:scaleX(-1)} 66%{transform:scaleX(1)} }
@keyframes cw-eve-idle { 0%{opacity:1} 8%{opacity:0} 66%{opacity:1} }
@keyframes cw-eve-walk { 0%{opacity:0} 8%{opacity:1} 17%{opacity:0} 57%{opacity:1} 66%{opacity:0} }
@keyframes cw-eve-read { 0%{opacity:0} 17%{opacity:1} 49%{opacity:0} }
@keyframes cw-eve-stretch { 0%{opacity:0} 49%{opacity:1} 57%{opacity:0} }

/* ========================= MORNING (26s) =========================
   Wakes and stretches, walks over for coffee, sips, wanders back.  */
[data-activity="morning"] .cw-actor     { animation: cw-mor-move 26s linear infinite; }
[data-activity="morning"] .cw-flip      { animation: cw-mor-face 26s steps(1) infinite; }
[data-activity="morning"] .cw-s-stretch { animation: cw-mor-stretch 26s steps(1) infinite; }
[data-activity="morning"] .cw-s-walk    { animation: cw-mor-walk 26s steps(1) infinite; }
[data-activity="morning"] .cw-s-coffee  { animation: cw-mor-coffee 26s steps(1) infinite; }
[data-activity="morning"] .cw-s-idle    { animation: cw-mor-idle 26s steps(1) infinite; }

@keyframes cw-mor-move {
  0%,25.5%   { transform: translateX(26px); }
  36%,77%    { transform: translateX(168px); }
  87%,100%   { transform: translateX(26px); }
}
@keyframes cw-mor-face { 0%{transform:scaleX(1)} 77%{transform:scaleX(-1)} 87%{transform:scaleX(1)} }
@keyframes cw-mor-stretch { 0%{opacity:0} 2%{opacity:1} 25.5%{opacity:0} }
@keyframes cw-mor-walk { 0%{opacity:0} 25.5%{opacity:1} 36%{opacity:0} 77%{opacity:1} 87%{opacity:0} }
@keyframes cw-mor-coffee { 0%{opacity:0} 36%{opacity:1} 77%{opacity:0} }
@keyframes cw-mor-idle { 0%{opacity:1} 2%{opacity:0} 87%{opacity:1} }

/* ========================= BEDTIME (20s) =========================
   Ambles over, yawns, ambles back and settles. Lower energy than the
   day loop, but a full round trip.                                 */
[data-activity="bedtime"] .cw-actor  { animation: cw-bed-move 20s linear infinite; }
[data-activity="bedtime"] .cw-flip { animation: cw-bed-face 20s steps(1) infinite; }
[data-activity="bedtime"] .cw-s-idle { animation: cw-bed-idle 20s steps(1) infinite; }
[data-activity="bedtime"] .cw-s-walk { animation: cw-bed-walk 20s steps(1) infinite; }
[data-activity="bedtime"] .cw-s-yawn { animation: cw-bed-yawn 20s steps(1) infinite; }

@keyframes cw-bed-move {
  0%,10%   { transform: translateX(30px); }
  30%,60%  { transform: translateX(150px); }
  80%,100% { transform: translateX(30px); }
}
@keyframes cw-bed-face { 0%{transform:scaleX(1)} 60%{transform:scaleX(-1)} 80%{transform:scaleX(1)} }
@keyframes cw-bed-idle { 0%{opacity:1} 10%{opacity:0} 80%{opacity:1} }
@keyframes cw-bed-walk { 0%{opacity:0} 10%{opacity:1} 30%{opacity:0} 60%{opacity:1} 80%{opacity:0} }
@keyframes cw-bed-yawn { 0%{opacity:0} 30%{opacity:1} 60%{opacity:0} }

/* ========================== NIGHT ================================
   Curled up asleep. The sprite carries its own zzz. Minimal motion. */
[data-activity="night"] .cw-actor   { transform: translateX(146px); }
[data-activity="night"] .cw-s-sleep { opacity: 1; }

/* ============================ THE CAT =============================
   Rules, in the order they matter:
     1. the cat only TRAVERSES while the character is standing still
     2. it does not traverse during every such window - day and morning use
        the first, evening the last, bedtime and night none at all
     3. its range (67px) is far shorter than the character's (220px)
   Each cat timeline shares its activity's duration, which is what makes the
   windows below line up with the character's stationary stretches by
   construction rather than by luck. Retime a character walk and these must be
   rechecked - the pairs are listed above each block.                       */
.cw-cat {
  position: absolute; left: 0; bottom: 19px;   /* same floor line as .cw-actor */
  width: 48px; height: 48px;
  transform: translateX(294px);                /* parked in the basket */
}
.cw-cat-flip { position: absolute; inset: 0; }
.cw-cat-sprite { position: absolute; inset: 0; opacity: 0; }
.cw-cat-film {
  position: absolute; inset: 0;
  background-repeat: no-repeat;
  image-rendering: pixelated;
}
/* NB: no translateY on the sleeping pose. Nudging it down puts its paws BELOW
   the basket rim, which then reads as a plank lying across the cat. The cat
   sits on the floor line like every other state and the rim occludes it. */

@keyframes cw-catcycle4 { from { background-position-x: 0px } to { background-position-x: -192px } }
@keyframes cw-catcycle2 { from { background-position-x: 0px } to { background-position-x: -96px } }

/* The cat never crosses either light source - it stays right of the window and
   left of the fire - so one static shadow per theme is enough, no keyframes. */
.cw-cat { filter: drop-shadow(2px 1px 1px rgba(28,20,14,0.30)); }
[data-theme="dark"] .cw-cat { filter: drop-shadow(-2px 1px 1px rgba(10,6,4,0.45)); }

/* --- day: character is at the desk (x=30) for 0-49.5%; the cat uses the
       middle of that window and leaves the other two still stretches alone --- */
[data-activity="day"] .cw-cat       { animation: cw-cat-day-move 48s linear infinite; }
[data-activity="day"] .cw-cat-flip  { animation: cw-cat-day-face 48s steps(1) infinite; }
[data-activity="day"] .cw-c-sleep   { animation: cw-cat-day-sleep 48s steps(1) infinite; }
[data-activity="day"] .cw-c-walk    { animation: cw-cat-day-walk 48s steps(1) infinite; }
[data-activity="day"] .cw-c-clean   { animation: cw-cat-day-clean 48s steps(1) infinite; }

@keyframes cw-cat-day-move {
  0%,14%   { transform: translateX(294px); }
  20%,30%  { transform: translateX(191px); }
  36%,100% { transform: translateX(294px); }
}
@keyframes cw-cat-day-face { 0%{transform:scaleX(1)} 14%{transform:scaleX(-1)} 30%{transform:scaleX(1)} }
@keyframes cw-cat-day-sleep { 0%{opacity:1} 14%{opacity:0} 36%{opacity:1} }
@keyframes cw-cat-day-walk { 0%{opacity:0} 14%{opacity:1} 20%{opacity:0} 30%{opacity:1} 36%{opacity:0} }
@keyframes cw-cat-day-clean { 0%{opacity:0} 20%{opacity:1} 30%{opacity:0} }

/* --- evening: character reads at x=196 for 17-56.5%, which is right on top of
       the alcove, so the cat waits for the idle stretch at 66.5-100% --- */
[data-activity="evening"] .cw-cat      { animation: cw-cat-eve-move 40s linear infinite; }
[data-activity="evening"] .cw-cat-flip { animation: cw-cat-eve-face 40s steps(1) infinite; }
[data-activity="evening"] .cw-c-sleep  { animation: cw-cat-eve-sleep 40s steps(1) infinite; }
[data-activity="evening"] .cw-c-walk   { animation: cw-cat-eve-walk 40s steps(1) infinite; }
[data-activity="evening"] .cw-c-clean  { animation: cw-cat-eve-clean 40s steps(1) infinite; }

@keyframes cw-cat-eve-move {
  0%,70%   { transform: translateX(294px); }
  76%,88%  { transform: translateX(191px); }
  94%,100% { transform: translateX(294px); }
}
@keyframes cw-cat-eve-face { 0%{transform:scaleX(1)} 70%{transform:scaleX(-1)} 88%{transform:scaleX(1)} }
@keyframes cw-cat-eve-sleep { 0%{opacity:1} 70%{opacity:0} 94%{opacity:1} }
@keyframes cw-cat-eve-walk { 0%{opacity:0} 70%{opacity:1} 76%{opacity:0} 88%{opacity:1} 94%{opacity:0} }
@keyframes cw-cat-eve-clean { 0%{opacity:0} 76%{opacity:1} 88%{opacity:0} }

/* --- morning: character stretches in place at x=26 for 0-25.5%; the cat is
       back in the basket by 24%, before the character walks at 25.5% --- */
[data-activity="morning"] .cw-cat      { animation: cw-cat-mor-move 26s linear infinite; }
[data-activity="morning"] .cw-cat-flip { animation: cw-cat-mor-face 26s steps(1) infinite; }
[data-activity="morning"] .cw-c-sleep  { animation: cw-cat-mor-sleep 26s steps(1) infinite; }
[data-activity="morning"] .cw-c-walk   { animation: cw-cat-mor-walk 26s steps(1) infinite; }
[data-activity="morning"] .cw-c-clean  { animation: cw-cat-mor-clean 26s steps(1) infinite; }

@keyframes cw-cat-mor-move {
  0%,8%    { transform: translateX(294px); }
  14%,18%  { transform: translateX(191px); }
  24%,100% { transform: translateX(294px); }
}
@keyframes cw-cat-mor-face { 0%{transform:scaleX(1)} 8%{transform:scaleX(-1)} 18%{transform:scaleX(1)} }
@keyframes cw-cat-mor-sleep { 0%{opacity:1} 8%{opacity:0} 24%{opacity:1} }
@keyframes cw-cat-mor-walk { 0%{opacity:0} 8%{opacity:1} 14%{opacity:0} 18%{opacity:1} 24%{opacity:0} }
@keyframes cw-cat-mor-clean { 0%{opacity:0} 14%{opacity:1} 18%{opacity:0} }

/* --- bedtime and night: no traversal at all. The character is winding down or
       asleep, and a cat trotting about would fight that. It grooms, then
       settles. This is also rule 2 at its clearest - the character is still
       for most of bedtime and the cat still does not go anywhere. --- */
[data-activity="bedtime"] .cw-c-clean { animation: cw-cat-bed-clean 20s steps(1) infinite; }
[data-activity="bedtime"] .cw-c-sleep { animation: cw-cat-bed-sleep 20s steps(1) infinite; }
@keyframes cw-cat-bed-clean { 0%{opacity:1} 35%{opacity:0} }
@keyframes cw-cat-bed-sleep { 0%{opacity:0} 35%{opacity:1} }

[data-activity="night"] .cw-c-sleep { opacity: 1; }

/* ---- footer ---- */
.cw-footer {
  display: flex; justify-content: space-between;
  padding: 6px 16px 9px;
  font-size: 10.5px; color: var(--text-2);
}
.cw-foot-right { font-variant-numeric: tabular-nums; }
`;
