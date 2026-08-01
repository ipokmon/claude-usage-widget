#!/usr/bin/env node
/**
 * propgen.mjs - hand-authored pixel-art scenery for the widget's stage.
 *
 * The character sprites come from AI-generated sheets via spritegen.mjs; the
 * background props are authored here instead, because they are small, regular
 * shapes that are easier to draw in code than to generate and then clean up.
 * Both end up as inlined data URIs at the same 1-art-pixel-per-output-pixel
 * scale, which is what keeps them looking like one set.
 *
 * Run:  node tools/propgen.mjs
 * It rewrites the PROPS block in widget/claude-usage.jsx in place.
 */

import zlib from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'sprite', 'out', 'props');

/* ------------------------------------------------------------- PNG encoder */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePNG({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------ drawing API */

const C = {
  k: [58, 42, 34],     // outline / dark wood
  w: [140, 100, 70],   // wood mid
  W: [170, 124, 84],   // wood light
  g: [108, 140, 104],  // leaf
  G: [132, 166, 126],  // leaf highlight
  p: [181, 101, 75],   // terracotta (matches --coral-dim)
  P: [206, 126, 98],   // terracotta light
  c: [242, 231, 220],  // cream
  y: [242, 208, 132],  // warm light / sun
  b: [126, 162, 196],  // day sky
  B: [158, 191, 216],  // day sky light
  n: [52, 60, 92],     // night sky
  s: [236, 240, 248],  // moon / star
  r: [178, 120, 98],   // book spine A
  R: [138, 148, 158],  // book spine B
  m: [150, 118, 96],   // book spine C
  u: [150, 122, 112],  // rug, muted on purpose - a saturated rug pulls the eye
  U: [178, 150, 138],  // rug light
  e: [88, 80, 78],     // stone dark
  E: [122, 112, 108],  // stone light
  f: [232, 118, 50],   // flame
  F: [250, 198, 98],   // flame core
  v: [84, 102, 90],    // armchair; muted green balances the terracotta and
  V: [110, 130, 116],  // orange already in the room
  // Seasonal decorations only. Kept at the same muted saturation as the rest
  // of the room - a pure #FF0000 heart beside this palette reads as a UI
  // element rather than a piece of the set.
  d: [186, 72, 76],    // red - hearts, watermelon flesh
  D: [220, 108, 112],  // red highlight
  h: [206, 122, 156],  // pink - blossom, balloon
  H: [236, 172, 196],  // pink highlight
  l: [88, 122, 176],   // blue - umbrella, beach ball
  L: [128, 162, 206],  // blue highlight
  t: [156, 100, 58],   // roast brown
  T: [194, 138, 86],   // roast highlight
};

const mk = (w, h) => ({ width: w, height: h, data: Buffer.alloc(w * h * 4) });

function px(img, x, y, c) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height || !c) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
}
function rect(img, x, y, w, h, c) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(img, xx, yy, c);
}
/** Like px() but with explicit alpha, for shadows. */
function pxa(img, x, y, c, a) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = a;
}

/*
 * The character sprites carry a hard dark outline and a contact shadow. Props
 * drawn without either read as flat stickers sitting next to a rendered
 * character, so the three helpers below retrofit the same treatment.
 */

/** 1px dark outline around every opaque pixel. */
function outline(img, c = C.k) {
  const out = mk(img.width, img.height);
  img.data.copy(out.data, 0);
  const solid = (x, y) =>
    x >= 0 && y >= 0 && x < img.width && y < img.height && img.data[(y * img.width + x) * 4 + 3] > 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (solid(x, y)) continue;
      if (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1)) px(out, x, y, c);
    }
  }
  return out;
}

/** Soft shadow beneath an object, so it sits ON the floor rather than above it. */
function withContactShadow(img, { pad = 2, alphas = [96, 48] } = {}) {
  const out = mk(img.width, img.height + pad);
  img.data.copy(out.data, 0);
  let minX = img.width, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return out;
  for (let i = 0; i < pad; i++) {
    for (let x = minX + i + 1; x <= maxX - i - 1; x++) {
      pxa(out, x, maxY + 1 + i, C.k, alphas[i] ?? alphas[alphas.length - 1]);
    }
  }
  return out;
}

/** Offset drop shadow, for the props mounted on the wall. */
function withDropShadow(img, { dx = 1, dy = 2, alpha = 64 } = {}) {
  const out = mk(img.width + dx, img.height + dy);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 0) pxa(out, x + dx, y + dy, C.k, alpha);
    }
  }
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] > 0) px(out, x, y, [img.data[i], img.data[i + 1], img.data[i + 2]]);
    }
  }
  return out;
}

/** Blit `src` onto `dst` at (ox, oy), skipping transparent source pixels. */
function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      if (src.data[i + 3] === 0) continue;
      px(dst, ox + x, oy + y, [src.data[i], src.data[i + 1], src.data[i + 2]]);
    }
  }
}

/** ASCII grid -> image. Validates row lengths so a typo fails loudly. */
function fromAscii(rows) {
  const w = rows[0].length;
  rows.forEach((r, i) => {
    if (r.length !== w) throw new Error(`ascii row ${i} is ${r.length}, expected ${w}`);
  });
  const img = mk(w, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== '.') {
        if (!C[ch]) throw new Error(`unknown colour key "${ch}" at ${x},${y}`);
        px(img, x, y, C[ch]);
      }
    });
  });
  return img;
}

/* ----------------------------------------------------------------- props */

// Organic shape, so authored as a grid rather than rectangles. Sized to about
// half the character's height so it actually registers at 1x.
const plant = () => fromAscii([
  '........gg........',
  '......ggGGgg......',
  '....ggGGGGGGgg....',
  '...gGGGGGGGGGGg...',
  '..gGGGGgGGgGGGGg..',
  '..gGGGGGGGGGGGGg..',
  '...gGGGGGGGGGGg...',
  '....gGGGGGGGGg....',
  '.....ggGGGGgg.....',
  '.......gGGg.......',
  '........gg........',
  '........gg........',
  '........gg........',
  '....kkkkkkkkkk....',
  '....kPPPPPPPPk....',
  '....kPPPPPPPPk....',
  '....kPPPPPPPPk....',
  '.....kPPPPPPk.....',
  '.....kPPPPPPk.....',
  '.....kppppppk.....',
  '.....kppppppk.....',
  '......kppppk......',
  '......kppppk......',
  '......kkkkkk......',
]);

/* ------------------------------------------------- seasonal decorations --
 *
 * One per month; see seasonFor() in the widget for the mapping. Only ever one
 * is on screen at a time, which is why several of them share a spot - five sit
 * on the windowsill and two float on the wall above the armchair.
 *
 * These are authored here like the rest of the scenery. The AI sprite pipeline
 * in spritegen.mjs is only for the two characters, and it exists mostly to
 * undo defects in generated sheets; for shapes this small, drawing them
 * directly is both quicker and the only way they stay on-palette.
 */

/*
 * October. Organic like the plant, so authored the same way - an ASCII grid
 * rather than rectangles. Uses the flame colours (f/F) rather than the
 * terracotta (p/P) used elsewhere: terracotta reads brown at this size, flame
 * orange reads as a pumpkin. outline() (applied in BUILD) gives it the dark
 * edge the other organic shape (the plant) also needs.
 */
const pumpkin = () => fromAscii([
  '....w....',
  '...www...',
  '.fffffff.',
  'fFpfffpff',
  'fFpfffpff',
  'ffpfffpff',
  '.fffffff.',
  '..fffff..',
]);

const heart = () => fromAscii([
  '.dd.dd.',
  'dDDDDDd',
  'dDDDDDd',
  '.dDDDd.',
  '..dDd..',
  '...d...',
]);

/*
 * February. Three copies of the same heart at staggered heights: at 7px across
 * three *identical* hearts read as a cluster, where three drawn-differently
 * ones just read as noise. 1px margin all round so outline() has somewhere to
 * put the edge - it draws into a same-size canvas and silently clips.
 */
function hearts() {
  const img = mk(24, 15);
  for (const [x, y] of [[1, 8], [9, 1], [16, 7]]) blit(img, heart(), x, y);
  return img;
}

/*
 * The balloon silhouette, in a caller-chosen colour so one shape serves all
 * three. The dark ring is baked in as C.k rather than left to outline(),
 * because outline() would also fatten the strings into 3px cables.
 */
function balloonShape(dark, light) {
  const img = mk(7, 8);
  const rows = [
    '..kkk..',
    '.k###k.',
    'k#***#k',
    'k#***#k',
    'k#***#k',
    '.k###k.',
    '..kkk..',
    '...k...',
  ];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === 'k') px(img, x, y, C.k);
    else if (ch === '#') px(img, x, y, dark);
    else if (ch === '*') px(img, x, y, light);
  }));
  return img;
}

/*
 * March. Strings are drawn first so the balloons paint over their own knots.
 * The middle balloon is deliberately off the tie point's column: with its knot
 * directly above the tie its string is a straight vertical line, and the
 * cluster reads as two balloons on strings plus one on a stick.
 */
function balloons() {
  const img = mk(24, 20);
  const TIE_X = 12, TIE_Y = 18;
  const set = [
    { x: 1, y: 1, dark: C.d, light: C.D },
    { x: 8, y: 3, dark: C.h, light: C.H },
    { x: 16, y: 0, dark: C.l, light: C.L },
  ];
  for (const b of set) {
    const kx = b.x + 3, ky = b.y + 8;          // where the knot sits
    for (let y = ky; y <= TIE_Y; y++) {
      const t = (y - ky) / (TIE_Y - ky);
      px(img, Math.round(kx + (TIE_X - kx) * t), y, C.k);
    }
  }
  for (const b of set) blit(img, balloonShape(b.dark, b.light), b.x, b.y);
  return img;
}

/** April. Open and drying, which is far more legible than a furled one. */
function umbrella() {
  const img = mk(21, 17);
  for (let y = 0; y < 6; y++) {                 // canopy
    const half = Math.round((y / 5) * 9);
    for (let x = 10 - half; x <= 10 + half; x++) {
      px(img, x, y, Math.floor((x + 2) / 4) % 2 ? C.l : C.L);
    }
  }
  // The rim dips between the ribs. That scallop is what says "umbrella"
  // rather than "dome" once the shape is only 21px across.
  for (const cx of [1, 5, 10, 15, 19]) {
    rect(img, cx - 1, 6, 3, 1, C.l);
    px(img, cx, 7, C.l);
  }
  rect(img, 10, 5, 1, 10, C.w);                 // shaft
  px(img, 9, 14, C.w);                          // crook
  rect(img, 8, 15, 3, 1, C.w);
  return img;
}

/*
 * May. Same terracotta pot as the plant, so they read as the same set.
 * The stems fan out from a single point in the pot rather than running
 * parallel - three vertical lines of equal length read as a fence, not a
 * bunch. The blooms need the full 5px rosette for the same reason: a 3px one
 * is just a dot on a stick.
 */
function flowers() {
  const img = mk(13, 16);
  const stem = (bx, by) => {
    const steps = 11 - by;
    for (let i = 0; i <= steps; i++) {
      px(img, Math.round(6 + ((bx - 6) * i) / steps), 11 - i, C.g);
    }
  };
  stem(2, 6); stem(6, 5); stem(10, 6);
  px(img, 4, 9, C.G); px(img, 8, 9, C.G);       // leaves
  const bloom = (cx, cy, petal) => {
    rect(img, cx - 1, cy - 1, 3, 3, petal);
    px(img, cx - 2, cy, petal); px(img, cx + 2, cy, petal);
    px(img, cx, cy - 2, petal); px(img, cx, cy + 2, petal);
    px(img, cx, cy, C.y);                       // warm centre
  };
  bloom(6, 3, C.H); bloom(2, 5, C.h); bloom(10, 5, C.H);
  rect(img, 2, 11, 9, 1, C.P);                  // pot
  rect(img, 3, 12, 7, 4, C.p);
  rect(img, 3, 12, 7, 1, C.P);
  return img;
}

/** June. The waffle lattice is what reads at this size, not the cone taper. */
const icecream = () => fromAscii([
  '...HHH...',
  '..HHHHH..',
  '.HHHHHHH.',
  '.ccccccc.',
  'ccccccccc',
  'ccccccccc',
  '.ccccccc.',
  '.WWWWWWW.',
  '..WwWwW..',
  '..WwWwW..',
  '...WwW...',
  '...WwW...',
  '....W....',
  '....W....',
]);

/** July. Six wedges swept by angle - hand-placing them never looks round. */
function beachball() {
  const img = mk(13, 13);
  const wedges = [C.d, C.c, C.l, C.c, C.F, C.c];
  for (let y = 0; y < 13; y++) {
    for (let x = 0; x < 13; x++) {
      const dx = x - 6, dy = y - 6;
      if (dx * dx + dy * dy > 37) continue;
      const a = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
      px(img, x, y, wedges[Math.floor(a * 6) % 6]);
    }
  }
  return img;
}

/** August. A wedge standing on its rind, seeds picked out in the outline dark. */
const watermelon = () => fromAscii([
  '.....d.....',
  '....ddd....',
  '...ddkdd...',
  '..ddddddd..',
  '.ddkdddkdd.',
  'ddddddddddd',
  'ccccccccccc',
  '.ggggggggg.',
]);

/*
 * September. Reuses the bookcase's three spine colours, so the pile reads as
 * books pulled off that shelf rather than as unrelated blocks.
 */
function books() {
  const img = mk(21, 13);
  // `pages` is which end the leaves face. A full-width light band on every
  // book turns the pile into a striped layer cake; a short block at
  // alternating ends reads as books stacked facing different ways.
  const layers = [
    { x: 0, w: 20, c: C.r, pages: 'r' },
    { x: 2, w: 17, c: C.R, pages: 'l' },
    { x: 1, w: 18, c: C.m, pages: 'r' },
    { x: 3, w: 14, c: C.p, pages: 'l' },
  ];
  let y = 12;
  for (const L of layers) {
    y -= 3;
    rect(img, L.x, y, L.w, 3, L.c);
    rect(img, L.pages === 'r' ? L.x + L.w - 3 : L.x, y, 3, 3, C.U);
    rect(img, L.x, y + 2, L.w, 1, C.k);         // shadow line under each
  }
  return img;
}

/*
 * November. On a platter, cooling on the sill - the classic cartoon staging.
 * The drumsticks are drawn BEFORE the body and stand proud of it at the top,
 * with a cream bone tip. Tucked against the body's side they disappear into
 * the silhouette and the whole thing reads as a loaf of bread.
 */
function turkey() {
  const img = mk(15, 11);
  // Mostly the golden tone, with the darker brown kept to the bottom two rows
  // as shading. Weighted the other way the bird is a dark lump: it is seen
  // against the sky from the sill, not against the wall like everything else.
  for (let y = 0; y < 6; y++) {                 // body dome
    const half = 2 + Math.round((y / 5) * 4);
    rect(img, 7 - half, y + 2, half * 2 + 1, 1, y < 4 ? C.T : C.t);
  }
  // Drumsticks rise in a V from the top of the bird with the bone tips out.
  // Standing them upright BESIDE the body instead just reads as two posts on
  // a slab - the splay is what makes them legs.
  rect(img, 3, 1, 2, 1, C.T); rect(img, 2, 0, 2, 1, C.c);
  rect(img, 10, 1, 2, 1, C.T); rect(img, 11, 0, 2, 1, C.c);
  rect(img, 0, 8, 15, 1, C.c);                  // platter
  rect(img, 1, 9, 13, 1, C.R);
  return img;
}

/** Floor lamp. The shade stays cream; the warm spill at night is CSS. */
function lamp() {
  const img = mk(14, 36);
  // Shade: cream trapezoid, but outlined - unoutlined cream is invisible
  // against the light theme's pale stage.
  for (let y = 0; y < 8; y++) {
    const half = 3 + Math.round((y / 7) * 4);
    const x0 = 7 - half, w = half * 2;
    rect(img, x0, y, w, 1, y === 7 ? C.y : C.c);
    px(img, x0, y, C.k);
    px(img, x0 + w - 1, y, C.k);
  }
  rect(img, 4, 0, 6, 1, C.k);             // top cap
  rect(img, 6, 8, 2, 24, C.w);            // pole
  rect(img, 6, 8, 1, 24, C.W);
  rect(img, 4, 32, 6, 1, C.w);            // base
  rect(img, 3, 33, 8, 2, C.k);
  return img;
}

/**
 * Full-height bookcase standing on the floor, four bays deep in books.
 *
 * The book layout is pseudo-random from a fixed seed rather than hand-placed:
 * forty-odd spines is too many to author by hand, and a fixed seed keeps the
 * output identical on every regeneration, so the art never shifts underneath
 * the widget.
 */
function bookcase() {
  const W = 44, H = 52;
  const img = mk(W, H);

  rect(img, 0, 0, W, H, C.w);                    // carcass
  rect(img, 2, 2, W - 4, H - 5, [32, 26, 24]);   // recessed interior

  const spines = [C.r, C.R, C.m, C.p, C.v, C.P, C.u];
  let seed = 11;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 9) % n;

  for (const top of [2, 14, 26, 38]) {
    const boardY = top + 11;
    let x = 3;
    for (;;) {
      const bw = 2 + rnd(3);
      if (x + bw > W - 3) break;
      const bh = 7 + rnd(5);
      const y = boardY - bh;
      rect(img, x, y, bw, bh, spines[rnd(spines.length)]);
      rect(img, x, y, bw, 1, C.k);               // dark top edge
      if (bw > 2) rect(img, x + 1, y + 3, bw - 2, 1, C.c);  // title band
      x += bw;
    }
    rect(img, 2, boardY, W - 4, 1, C.W);         // shelf board
    rect(img, 2, boardY + 1, W - 4, 1, C.k);     // shadow under it
  }

  rect(img, 0, 0, W, 2, C.w);                    // top
  rect(img, 0, 0, W, 1, C.W);
  rect(img, 0, 0, 2, H, C.w);                    // side panels
  rect(img, W - 2, 0, 2, H, C.w);
  rect(img, 0, 0, 1, H, C.W);
  rect(img, W - 1, 0, 1, H, C.k);
  rect(img, 0, H - 3, W, 3, C.w);                // plinth
  rect(img, 0, H - 3, W, 1, C.W);
  rect(img, 0, H - 1, W, 1, C.k);
  return img;
}

/**
 * A string of bulbs draped across the top of the wall. Spans nearly the full
 * width, which is the point - the band above the shelf and window was the one
 * genuinely empty part of the stage.
 *
 * The wire is a run of shallow arcs rather than one long sag; a single deep
 * catenary would drop into the character's headroom at mid-span.
 */
function lights() {
  const W = 326, H = 16, SEG = 54, DIP = 6;
  const img = mk(W, H);
  for (let x = 0; x < W; x++) {
    const t = (x % SEG) / SEG;
    px(img, x, Math.round(Math.sin(Math.PI * t) * DIP), C.k);
  }
  const bulbs = [C.y, C.c, C.P];
  for (let s = 0, i = 0; s * SEG + SEG / 2 < W; s++, i++) {
    const bx = Math.round(s * SEG + SEG / 2);
    const by = DIP + 1;
    const col = bulbs[i % bulbs.length];
    px(img, bx, by, C.k);                       // where it hangs from the wire
    rect(img, bx - 1, by + 1, 3, 2, col);       // bulb
    px(img, bx - 2, by + 1, C.k); px(img, bx + 2, by + 1, C.k);
    px(img, bx - 2, by + 2, C.k); px(img, bx + 2, by + 2, C.k);
    rect(img, bx - 1, by + 3, 3, 1, C.k);
  }
  return img;
}

/** Stone fireplace with a lit fire. The warm spill onto the room is CSS. */
function fireplace() {
  const W = 46, H = 46;
  const img = mk(W, H);

  rect(img, 2, 4, W - 4, H - 8, C.E);                 // surround
  for (let y = 8; y < H - 8; y += 4) {                // mortar courses
    rect(img, 2, y, W - 4, 1, C.e);
    const off = ((y / 4) | 0) % 2 ? 7 : 0;            // stagger the joints
    for (let x = 4 + off; x < W - 4; x += 14) rect(img, x, y + 1, 1, 3, C.e);
  }
  rect(img, 2, 4, 1, H - 8, C.k);                     // side edges
  rect(img, W - 3, 4, 1, H - 8, C.k);

  const fx = 10, fy = 14, fw = W - 20, fh = H - 22;
  rect(img, fx - 1, fy - 1, fw + 2, fh + 2, C.k);     // firebox opening
  rect(img, fx, fy, fw, fh, [26, 20, 22]);

  const base = fy + fh - 4;
  const flame = (cx, h) => {
    for (let i = 0; i < h; i++) {
      const half = Math.max(0, Math.round((h - i) / 2.4));
      rect(img, cx - half, base - i, half * 2 + 1, 1, i < h * 0.5 ? C.F : C.f);
    }
  };
  flame(17, 8); flame(23, 11); flame(29, 7);
  rect(img, 13, base + 1, 20, 3, C.w);                // logs
  rect(img, 13, base + 1, 20, 1, C.W);
  rect(img, 12, base + 4, 22, 1, C.k);

  rect(img, 0, 0, W, 3, C.w);                         // mantel
  rect(img, 0, 0, W, 1, C.W);
  rect(img, 0, 3, W, 1, C.k);
  rect(img, 0, H - 4, W, 4, C.E);                     // hearth
  rect(img, 0, H - 4, W, 1, C.e);
  rect(img, 0, H - 1, W, 1, C.k);
  return img;
}

/** Armchair, side view, facing right towards the fire. */
function armchair() {
  const W = 30, H = 28;
  const img = mk(W, H);
  rect(img, 2, 3, 8, 21, C.v);        // backrest
  rect(img, 2, 3, 8, 2, C.V);         // lit top edge
  rect(img, 8, 13, 18, 9, C.v);       // seat block
  rect(img, 8, 13, 18, 3, C.V);       // cushion
  rect(img, 10, 16, 14, 1, C.v);      // cushion seam
  rect(img, 20, 9, 7, 8, C.V);        // near armrest
  rect(img, 20, 9, 7, 2, C.v);
  rect(img, 9, 22, 3, 4, C.e);        // legs
  rect(img, 22, 22, 3, 4, C.e);
  return img;
}

/*
 * The cat's basket, for the alcove between the armchair and the fireplace.
 *
 * Two pieces on purpose. The sleeping cat is 46px wide and would completely
 * hide a basket drawn as one sprite behind it, so the far rim and cushion go
 * BEHIND the cat and the near rim goes IN FRONT - which is also how a real
 * basket occludes its occupant. The widget renders `catbedRim` after the cat
 * (see FOREGROUND_PROPS) and nudges the sleeping pose down so the rim crosses
 * its paws.
 */
const BED_W = 52;

function catbed() {
  const H = 9;
  const img = mk(BED_W, H);
  rect(img, 0, 0, BED_W, 3, C.p);              // far rim
  rect(img, 1, 1, BED_W - 2, 1, [201, 126, 100]); // lit edge along the far rim
  rect(img, 3, 3, BED_W - 6, 6, C.u);          // cushion, same muted tone as the rug
  rect(img, 5, 3, BED_W - 10, 2, C.c);         // lit top of the cushion
  return img;
}

/*
 * The near rim, drawn over the cat so it reads as sitting down inside.
 * The end caps stand 3px taller than the rim band: at this size the band alone
 * just looks like a plank laid across the cat, and it is the raised sides that
 * make the shape read as a container.
 */
function catbedRim() {
  const H = 8;
  const img = mk(BED_W, H);
  rect(img, 4, 3, BED_W - 8, 5, C.p);          // rim band, covers the cat's paws
  rect(img, 5, 4, BED_W - 10, 1, [201, 126, 100]); // lit band
  rect(img, 0, 0, 5, H, C.w);                  // woven sides, standing proud
  rect(img, BED_W - 5, 0, 5, H, C.w);
  rect(img, 1, 1, 3, 1, [170, 124, 88]);       // lit top on each side
  rect(img, BED_W - 4, 1, 3, 1, [170, 124, 88]);
  return img;
}

/** Window frame; `night` swaps the sky and the sun for a moon and stars. */
function windowPane(night) {
  const W = 42, H = 34;
  const SKY_B = H - 6;                           // sky bottom, leaving the sill
  const img = mk(W, H);
  rect(img, 0, 0, W, H, C.w);                    // frame
  rect(img, 1, 1, W - 2, H - 2, C.k);            // inner shadow line
  rect(img, 2, 2, W - 4, SKY_B - 2, night ? C.n : C.b);
  if (night) {
    rect(img, 27, 6, 7, 7, C.s);                 // moon
    rect(img, 26, 7, 1, 5, C.s);
    rect(img, 34, 7, 1, 5, C.s);
    rect(img, 29, 5, 3, 1, C.s);
    for (const [sx, sy] of [[6, 7], [12, 4], [17, 10], [8, 16], [21, 19], [14, 23],
                            [31, 20], [35, 16], [5, 22], [24, 6]]) px(img, sx, sy, C.s);
  } else {
    rect(img, 2, 2, W - 4, 11, C.B);             // brighter band near the top
    rect(img, 27, 5, 8, 8, C.y);                 // sun
    rect(img, 26, 6, 1, 6, C.y);
    rect(img, 35, 6, 1, 6, C.y);
    rect(img, 6, 20, 12, 4, C.c);                // cloud
    rect(img, 9, 17, 7, 3, C.c);
  }
  rect(img, 20, 2, 2, SKY_B - 2, C.w);           // mullions
  rect(img, 2, 15, W - 4, 2, C.w);
  rect(img, 0, SKY_B, W, 3, C.W);                // sill
  rect(img, 0, H - 1, W, 1, C.k);
  return img;
}

/*
 * Seen side-on there is no perspective to work with, so a thick rug just reads
 * as a floating lozenge. Drawn instead as a wide, thin band lying on the floor
 * plane, with fringe at each end to say "rug" rather than "shape".
 *
 * Terracotta rather than the muted taupe this started as: against the warm
 * wood floor the muted version disappeared. It only needed toning down back
 * when it sat against the wall.
 */
function rug() {
  const W = 112;
  const img = mk(W, 5);
  rect(img, 3, 0, W - 6, 1, C.P);
  rect(img, 2, 1, W - 4, 1, C.p);
  rect(img, 2, 2, W - 4, 1, C.P);
  rect(img, 3, 3, W - 6, 1, C.p);
  rect(img, 5, 4, W - 10, 1, C.k);                                    // contact shadow
  for (let x = 12; x < W - 12; x += 14) rect(img, x, 2, 5, 1, C.c);   // pattern
  for (let x = 0; x < 3; x++) {                                       // fringe
    px(img, x, 2, C.P); px(img, W - 1 - x, 2, C.P);
  }
  return img;
}

/*
 * Floor-standing props get a contact shadow; wall-mounted ones get an offset
 * drop shadow. The plant also gets an auto outline - its leaves were the only
 * shape with no dark edge, which made it read as flat beside the character.
 * Each helper grows the canvas downward, so the matching `bottom` in the
 * widget CSS is offset by the same amount.
 */
const BUILD = {
  lights: lights(),                                  // hangs, so no shadow
  rug: rug(),                                        // has its own shadow row
  fireplace: withContactShadow(fireplace()),         // bottom -2
  lamp: withContactShadow(lamp()),                   // bottom -2
  bookcase: withContactShadow(bookcase()),           // bottom -2
  // No baked drop shadow on the window: its cast shadow is now a directional
  // CSS filter that follows the room's light, and a second baked one pointing
  // a fixed way would fight it.
  windowDay: windowPane(false),
  windowNight: windowPane(true),
  armchair: withContactShadow(outline(armchair())),  // bottom -2
  // plant: dropped from the scene when the cat's basket took the right-hand
  // side. plant() above is deliberately kept so it can be put back by adding
  // one line here - the ASCII art is the only source for it.
  // plant: withContactShadow(outline(plant())),
  catbed: withContactShadow(outline(catbed())),      // bottom -2
  // no contact shadow: the rim is the front of the same object, not a second
  // thing resting on the floor
  catbedRim: outline(catbedRim()),
  // Seasonal, one per month. Anything resting on a surface (sill or floor)
  // gets the same contact shadow as the permanent props; the two that float
  // on the wall get neither, and `balloons` skips outline() as well since its
  // dark ring is drawn in and outline() would fatten the strings.
  pumpkin: withContactShadow(outline(pumpkin())),        // bottom -2
  hearts: outline(hearts()),
  balloons: balloons(),
  umbrella: withContactShadow(outline(umbrella())),      // bottom -2
  flowers: withContactShadow(outline(flowers())),        // bottom -2
  icecream: withContactShadow(outline(icecream())),      // bottom -2
  beachball: withContactShadow(outline(beachball())),    // bottom -2
  watermelon: withContactShadow(outline(watermelon())),  // bottom -2
  books: withContactShadow(outline(books())),            // bottom -2
  turkey: withContactShadow(outline(turkey())),          // bottom -2
};

/* ------------------------------------------------------ write + inject */

mkdirSync(OUT, { recursive: true });
const uris = {};
let total = 0;
for (const [name, img] of Object.entries(BUILD)) {
  const png = encodePNG(img);
  writeFileSync(join(OUT, `${name}.png`), png);
  uris[name] = { w: img.width, h: img.height, src: `data:image/png;base64,${png.toString('base64')}` };
  total += png.length;
  console.log(`${name.padEnd(12)} ${img.width}x${img.height}  ${png.length} bytes`);
}
console.log(`\ntotal ${total} bytes raw, ~${Math.round((total * 4) / 3)} bytes base64`);

const WIDGET = join(HERE, '..', 'widget', 'claude-usage.jsx');
const BEGIN = '/* PROPS:BEGIN */';
const END = '/* PROPS:END */';
let src = readFileSync(WIDGET, 'utf8');
const a = src.indexOf(BEGIN), b = src.indexOf(END);
if (a < 0 || b < 0) {
  console.warn('\n!! PROPS markers not found in widget - skipped injection');
} else {
  const body = Object.entries(uris)
    .map(([k, v]) => `  ${k}: { w: ${v.w}, h: ${v.h}, src: "${v.src}" },`)
    .join('\n');
  src = src.slice(0, a) + BEGIN + '\nconst PROPS = {\n' + body + '\n};\n' + src.slice(b);
  writeFileSync(WIDGET, src);
  console.log(`injected ${Object.keys(uris).length} props into widget/claude-usage.jsx`);
}
