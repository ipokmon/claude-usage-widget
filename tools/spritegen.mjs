#!/usr/bin/env node
/**
 * spritegen.mjs - turns the AI-rendered sheets in ../sprite/ into clean,
 * transparent, baseline-aligned sprite strips for the widget.
 *
 * Dependency-free: PNG decode/encode is done here against node:zlib, because
 * the machine has no ImageMagick/PIL/ffmpeg and sips cannot key transparency.
 *
 * Pipeline per source sheet (1024x1024, 2x2 grid of poses):
 *   split into 4 quadrants -> remove background -> trim -> uniform scale
 *   -> bottom-centre align onto a fixed frame box -> append into one strip.
 *
 * Background removal is region-growing seeded from the border. Each candidate
 * is compared to the NEIGHBOUR IT SPREAD FROM, not to a fixed reference
 * colour. The sheets have smooth gradient backgrounds plus a glow around each
 * sprite, so a global colour key fails; a local delta follows the gradient and
 * the glow but stops at the sprite's hard dark outline.
 */

import zlib from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'sprite');
const OUT = join(HERE, '..', 'sprite', 'out');

/* ---------------------------------------------------------------- PNG codec */

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8, idat = [], ihdr = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  if (ihdr.bitDepth !== 8) throw new Error('only 8-bit supported, got ' + ihdr.bitDepth);
  if (ihdr.interlace !== 0) throw new Error('interlaced png unsupported');
  const channels = ihdr.colorType === 6 ? 4 : ihdr.colorType === 2 ? 3 : 0;
  if (!channels) throw new Error('only RGB/RGBA supported, colorType ' + ihdr.colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width: w, height: h } = ihdr;
  const stride = w * channels;
  const out = Buffer.alloc(w * h * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  prev.fill(0);

  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    raw.copy(line, 0, p, p + stride);
    p += stride;
    // unfilter in place
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff; break;
        }
        default: throw new Error('bad filter ' + filter);
      }
      line[i] = v;
    }
    line.copy(prev);
    // expand to RGBA
    for (let x = 0; x < w; x++) {
      const s = x * channels, d = (y * w + x) * 4;
      out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
  }
  return { width: w, height: h, data: out };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- image helpers */

function crop(img, sx, sy, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    img.data.copy(out, y * w * 4, ((sy + y) * img.width + sx) * 4, ((sy + y) * img.width + sx + w) * 4);
  }
  return { width: w, height: h, data: out };
}

/**
 * Region-grow from the border, clearing background to alpha 0.
 * localTol : max per-channel distance from the pixel we spread FROM (follows gradients)
 * hardFloor: pixels darker than this are never cleared (protects the outline)
 */
function removeBackground(img, { localTol = 26, hardFloor = 110 } = {}) {
  const { width: w, height: h, data } = img;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (!seen[i]) { seen[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  const lum = (i) => (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  const clear = new Uint8Array(w * h);
  while (stack.length) {
    const i = stack.pop();
    if (lum(i) < hardFloor) continue;     // hit the dark outline: stop
    clear[i] = 1;
    const x = i % w, y = (i / w) | 0;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const tryN = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const j = ny * w + nx;
      if (seen[j]) return;
      const dr = Math.abs(data[j * 4] - r), dg = Math.abs(data[j * 4 + 1] - g), db = Math.abs(data[j * 4 + 2] - b);
      if (dr <= localTol && dg <= localTol && db <= localTol) { seen[j] = 1; stack.push(j); }
    };
    tryN(x + 1, y); tryN(x - 1, y); tryN(x, y + 1); tryN(x, y - 1);
  }
  const out = Buffer.from(data);
  for (let i = 0; i < w * h; i++) if (clear[i]) out[i * 4 + 3] = 0;
  return { width: w, height: h, data: out };
}

/** Drop faint leftovers (halo crumbs) and fully-transparent-ish pixels. */
function cleanAlpha(img, minAlpha = 40) {
  const out = Buffer.from(img.data);
  for (let i = 0; i < img.width * img.height; i++) {
    if (out[i * 4 + 3] < minAlpha) out[i * 4 + 3] = 0;
  }
  return { ...img, data: out };
}

function bbox(img) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 0) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Box-filter downscale, alpha-premultiplied so edges don't darken. */
function resize(img, dw, dh) {
  const { width: sw, height: sh, data } = img;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy0 = (y * sh) / dh, sy1 = ((y + 1) * sh) / dh;
    for (let x = 0; x < dw; x++) {
      const sx0 = (x * sw) / dw, sx1 = ((x + 1) * sw) / dw;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = Math.floor(sy0); yy < Math.ceil(sy1); yy++) {
        for (let xx = Math.floor(sx0); xx < Math.ceil(sx1); xx++) {
          if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
          const i = (yy * sw + xx) * 4, al = data[i + 3] / 255;
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al;
          a += data[i + 3]; n++;
        }
      }
      if (!n) continue;
      const d = (y * dw + x) * 4;
      const aa = a / n;
      const norm = a > 0 ? a / 255 : 1;
      out[d] = Math.round(r / norm); out[d + 1] = Math.round(g / norm);
      out[d + 2] = Math.round(b / norm); out[d + 3] = Math.round(aa);
    }
  }
  return { width: dw, height: dh, data: out };
}

/**
 * The source art draws a small ground line / contact shadow under the feet,
 * which survives keying as loose crumbs. Drop disconnected blobs that sit at
 * or below the feet, while keeping the ones ABOVE the body - those are the
 * sleep "z" and the coffee sparkles, which we want.
 */
function dropGroundBits(img) {
  const { width: w, height: h, data } = img;
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] === 0 || label[i] !== -1) continue;
    const id = comps.length;
    let count = 0, minY = h, maxY = -1;
    const stack = [i];
    label[i] = id;
    while (stack.length) {
      const j = stack.pop();
      count++;
      const y = (j / w) | 0, x = j % w;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (label[k] === -1 && data[k * 4 + 3] > 0) { label[k] = id; stack.push(k); }
      }
    }
    comps.push({ id, count, minY, maxY });
  }
  if (!comps.length) return img;
  const body = comps.reduce((a, b) => (b.count > a.count ? b : a));
  const bodyH = body.maxY - body.minY + 1;
  const footLine = body.maxY - Math.round(bodyH * 0.08);
  const kill = new Set(
    comps.filter((c) => c.id !== body.id && c.minY >= footLine).map((c) => c.id)
  );
  if (!kill.size) return img;
  const out = Buffer.from(data);
  for (let i = 0; i < w * h; i++) if (kill.has(label[i])) out[i * 4 + 3] = 0;
  return { width: w, height: h, data: out };
}

/**
 * Median-cut palette over every opaque pixel of every strip. One shared
 * palette keeps the character's colours identical across states, and folding
 * thousands of resampling artifacts down to PALETTE_SIZE tones both restores
 * the hard pixel-art read and lets deflate do its job.
 */
function buildPalette(images, k) {
  const px = [];
  for (const img of images) {
    for (let i = 0; i < img.width * img.height; i++) {
      if (img.data[i * 4 + 3] < 128) continue;
      px.push([img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]]);
    }
  }
  if (!px.length) return [[0, 0, 0]];
  let boxes = [px];
  while (boxes.length < k) {
    // split the box with the widest single-channel spread
    let bi = -1, bestSpread = -1, bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
        if (hi - lo > bestSpread) { bestSpread = hi - lo; bi = i; bestCh = ch; }
      }
    });
    if (bi < 0 || bestSpread <= 0) break;
    const box = boxes[bi];
    box.sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter((b) => b.length).map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)];
  });
}

/** Snap to the shared palette and make alpha binary for a crisp sprite edge. */
function quantize(img, palette) {
  const out = Buffer.from(img.data);
  for (let i = 0; i < img.width * img.height; i++) {
    if (out[i * 4 + 3] < 128) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 0; out[i * 4 + 3] = 0; continue; }
    const r = out[i * 4], g = out[i * 4 + 1], b = out[i * 4 + 2];
    let best = 0, bestD = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = p; }
    }
    out[i * 4] = palette[best][0]; out[i * 4 + 1] = palette[best][1];
    out[i * 4 + 2] = palette[best][2]; out[i * 4 + 3] = 255;
  }
  return { ...img, data: out };
}

function blank(w, h) { return { width: w, height: h, data: Buffer.alloc(w * h * 4) }; }

function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4, d = (ty * dst.width + tx) * 4;
      if (src.data[s + 3] === 0) continue;
      dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2]; dst.data[d + 3] = src.data[s + 3];
    }
  }
}

/* ------------------------------------------------------------------ pipeline */

/*
 * Two jobs run through the identical pipeline: the rabbit (2x2 sheets, one
 * state per sheet) and the cat (a single 4x3 sheet holding all three states).
 * The cat art has the same four defects as the rabbit art - gradient
 * background, glow, contact-shadow crumbs, per-row size drift - so it wants
 * the same corrections rather than a second bespoke path.
 *
 * Each job keeps its OWN palette and scale. Sharing them would force the
 * rabbit's orange ramp onto a grey cat, and would size the cat against the
 * rabbit's tallest pose instead of its own.
 *
 * Frames are indexed in reading order across the grid: row * cols + col.
 */
const JOBS = [
  {
    name: 'character',
    dir: SRC,
    out: OUT,
    grid: { cols: 2, rows: 2 },
    frame: 56,        // frame box in px (also the CSS display size)
    contentH: 48,     // tallest sprite maps to this inside the box
    paletteSize: 24,
    marker: 'SPRITES',
    constName: 'SPRITES',
    sheets: [
      { file: 'ChatGPT Image Jul 28, 2026, 12_13_10 PM (1).png', state: 'idle' },
      { file: 'ChatGPT Image Jul 28, 2026, 12_13_10 PM (2).png', state: 'walk' },
      { file: 'ChatGPT Image Jul 28, 2026, 12_13_11 PM (3).png', state: 'stretch' },
      { file: 'ChatGPT Image Jul 28, 2026, 12_13_11 PM (4).png', state: 'coffee' },
      // Frames 0/1 of this sheet are plain front-facing idle with no desk; only
      // 2/3 actually show the character at the desk, so cycling all four would
      // teleport them in and out of the scene.
      { file: 'ChatGPT Image Jul 28, 2026, 12_13_11 PM (5).png', state: 'work', use: [2, 3] },
      { file: 'ChatGPT Image Jul 28, 2026, 12_13_11 PM (6).png', state: 'read' },
      { file: 'ChatGPT Image Jul 28, 2026, 12_13_11 PM (7).png', state: 'yawn' },
      { file: 'ChatGPT Image Jul 28, 2026, 12_13_12 PM (8).png', state: 'sleep' },
    ],
  },
  {
    name: 'cat',
    dir: join(SRC, 'cat'),
    out: join(OUT, 'cat'),
    grid: { cols: 4, rows: 3 },
    // Roomier box than the rabbit's relative to its content: the sleeping and
    // walking poses are far wider than they are tall, and blit() clips in
    // silence, so the box is sized off the widest pose rather than the tallest.
    frame: 48,
    contentH: 28,     // deliberately about half the rabbit - it reads as a pet
    paletteSize: 16,  // greys, cream and an outline; 24 buys nothing here
    marker: 'CAT',
    constName: 'CAT',
    sheets: [
      // One sheet, three states. Row 0 mixes two standing/trotting poses with
      // two lying ones, so walk takes only 0-1; rows 1 and 2 are clean runs.
      { file: 'ChatGPT Image Jul 28, 2026, 08_05_20 PM.png', state: 'walk', use: [0, 1] },
      // Row 1 is nominally the sleep run, but frames 4 and 5 are a cat rising
      // with its rear in the air - 4 especially reads as standing up. Cycling
      // them makes the cat look like it keeps waking. Only 6 and 7 are properly
      // curled, and alternating those two reads as breathing.
      { file: 'ChatGPT Image Jul 28, 2026, 08_05_20 PM.png', state: 'sleep', use: [6, 7] },
      { file: 'ChatGPT Image Jul 28, 2026, 08_05_20 PM.png', state: 'clean', use: [8, 9, 10, 11] },
    ],
  },
];

const WIDGET = join(HERE, '..', 'widget', 'claude-usage.jsx');

function runJob(job) {
  const { cols, rows } = job.grid;
  const FRAME = job.frame;
  console.log(`\n=== ${job.name} ===`);
  mkdirSync(job.out, { recursive: true });

  // Pass 1: cut, key out the background, trim. Everything stays in memory so a
  // single scale can be derived across the job - per-sheet scaling would make
  // the subject change size between states.
  const cut = [];
  const decoded = new Map();
  for (const sheet of job.sheets) {
    if (!decoded.has(sheet.file)) {
      decoded.set(sheet.file, decodePNG(readFileSync(join(job.dir, sheet.file))));
    }
    const img = decoded.get(sheet.file);
    const cw = Math.floor(img.width / cols), ch = Math.floor(img.height / rows);
    const frames = [];
    for (const q of sheet.use ?? [...Array(cols * rows).keys()]) {
      const cell = crop(img, (q % cols) * cw, Math.floor(q / cols) * ch, cw, ch);
      const keyed = dropGroundBits(cleanAlpha(removeBackground(cell)));
      const bb = bbox(keyed);
      if (!bb) { console.warn(`  !! ${sheet.state} frame ${q}: nothing left after keying`); continue; }
      frames.push({ img: crop(keyed, bb.x, bb.y, bb.w, bb.h), bb });
    }
    cut.push({ ...sheet, frames });
    console.log(`${sheet.state.padEnd(8)} ${frames.length} frames  heights ${frames.map((f) => f.bb.h).join(',')}`);
  }

  const globalMaxH = Math.max(...cut.flatMap((s) => s.frames.map((f) => f.bb.h)));
  const scale = job.contentH / globalMaxH;
  console.log(`\nmax sprite height ${globalMaxH}px -> scale ${scale.toFixed(4)}\n`);

  /*
   * Scaling is two-level, because the source has a systematic flaw: the lower
   * grid row renders ~7% smaller than the upper one. That is a rendering
   * artifact, not intent - left alone the subject visibly pulses mid-cycle.
   *   within a state : normalise every frame to that state's tallest, killing
   *                    the jitter
   *   across states  : keep each state's natural size via the job scale, so a
   *                    curled-up sleep pose stays shorter than a standing one
   */
  const strips = [];
  for (const sheet of cut) {
    const stateMaxH = Math.max(...sheet.frames.map((f) => f.bb.h));
    const strip = blank(FRAME * sheet.frames.length, FRAME);
    sheet.frames.forEach((f, i) => {
      const norm = (stateMaxH / f.bb.h) * scale;
      const dw = Math.max(1, Math.round(f.bb.w * norm));
      const dh = Math.max(1, Math.round(f.bb.h * norm));
      if (dw > FRAME || dh > FRAME) {
        console.warn(`  !! ${sheet.state} frame ${i} is ${dw}x${dh}, larger than the ${FRAME}px box - blit will clip it`);
      }
      blit(strip, resize(f.img, dw, dh), i * FRAME + Math.round((FRAME - dw) / 2), FRAME - dh - 2);
    });
    strips.push({ state: sheet.state, frames: sheet.frames.length, img: strip });
  }

  const palette = buildPalette(strips.map((s) => s.img), job.paletteSize);
  console.log(`palette: ${palette.length} colours\n`);

  const manifest = {};
  const uris = {};
  for (const s of strips) {
    const q = quantize(s.img, palette);
    const png = encodePNG(q);
    writeFileSync(join(job.out, `${s.state}.png`), png);
    manifest[s.state] = { frames: s.frames, w: q.width, h: q.height, bytes: png.length };
    uris[s.state] = `data:image/png;base64,${png.toString('base64')}`;
    console.log(`wrote ${s.state.padEnd(8)} ${q.width}x${q.height}  ${s.frames} frames  ${png.length} bytes`);
  }
  writeFileSync(join(job.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const total = Object.values(manifest).reduce((a, m) => a + m.bytes, 0);
  console.log(`total ${total} bytes raw, ~${Math.round((total * 4) / 3)} bytes base64`);

  /* ------------------------------------------------- inject into the widget */
  // The widget is a single self-contained .jsx (it is symlinked into
  // Übersicht's widgets dir, so relative asset URLs would not resolve). Art
  // therefore goes in as data URIs, rewritten in place between the markers so
  // regenerating it never means hand-editing the widget.
  const BEGIN = `/* ${job.marker}:BEGIN */`;
  const END = `/* ${job.marker}:END */`;
  let src = readFileSync(WIDGET, 'utf8');
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < 0) {
    console.warn(`!! ${job.marker} markers not found in widget - skipped injection`);
    return;
  }
  const body = Object.entries(uris)
    .map(([k, v]) => `  ${k}: { frames: ${manifest[k].frames}, src: "${v}" },`)
    .join('\n');
  src = src.slice(0, a) + BEGIN + `\nconst ${job.constName} = {\n` + body + '\n};\n' + src.slice(b);
  writeFileSync(WIDGET, src);
  console.log(`injected ${Object.keys(uris).length} ${job.name} strips into widget/claude-usage.jsx`);
}

for (const job of JOBS) runJob(job);
