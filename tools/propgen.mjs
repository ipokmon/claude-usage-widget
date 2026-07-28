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

// A plank with books of varying height leaning on it.
function shelf() {
  const img = mk(30, 15);
  const books = [
    { x: 2, w: 4, h: 10, c: C.r },
    { x: 7, w: 3, h: 8, c: C.R },
    { x: 11, w: 4, h: 11, c: C.p },
    { x: 16, w: 3, h: 9, c: C.m },
    { x: 20, w: 4, h: 7, c: C.R },
    { x: 25, w: 3, h: 10, c: C.r },
  ];
  for (const b of books) {
    const top = 12 - b.h;
    rect(img, b.x, top, b.w, b.h, b.c);
    rect(img, b.x, top, b.w, 1, C.k);          // dark top edge
    rect(img, b.x, top + 2, b.w, 1, C.c);      // title band
  }
  rect(img, 0, 12, 30, 2, C.w);                 // plank
  rect(img, 0, 12, 30, 1, C.W);                 // lit top of plank
  rect(img, 0, 14, 30, 1, C.k);                 // shadow under plank
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

/** Window frame; `night` swaps the sky and the sun for a moon and stars. */
function windowPane(night) {
  const img = mk(32, 26);
  rect(img, 0, 0, 32, 26, C.w);                 // frame
  rect(img, 1, 1, 30, 24, C.k);                 // inner shadow line
  rect(img, 2, 2, 28, 22, night ? C.n : C.b);   // sky
  if (night) {
    rect(img, 20, 5, 5, 5, C.s);                // moon
    rect(img, 19, 6, 1, 3, C.s);
    rect(img, 25, 6, 1, 3, C.s);
    rect(img, 22, 4, 1, 1, C.s);
    for (const [sx, sy] of [[6, 6], [10, 4], [14, 9], [7, 13], [17, 15], [12, 18], [24, 16]]) {
      px(img, sx, sy, C.s);
    }
  } else {
    rect(img, 2, 2, 28, 8, C.B);                // brighter band near the top
    rect(img, 20, 4, 6, 6, C.y);                // sun
    rect(img, 19, 5, 1, 4, C.y);
    rect(img, 26, 5, 1, 4, C.y);
    rect(img, 6, 14, 9, 3, C.c);                // cloud
    rect(img, 8, 12, 5, 2, C.c);
  }
  rect(img, 15, 2, 2, 22, C.w);                 // mullions
  rect(img, 2, 12, 28, 2, C.w);
  rect(img, 0, 24, 32, 2, C.W);                 // sill
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
  shelf: withDropShadow(shelf()),                    // bottom -2
  windowDay: withDropShadow(windowPane(false)),      // bottom -2
  windowNight: withDropShadow(windowPane(true)),     // bottom -2
  armchair: withContactShadow(outline(armchair())),  // bottom -2
  plant: withContactShadow(outline(plant())),        // bottom -2
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
