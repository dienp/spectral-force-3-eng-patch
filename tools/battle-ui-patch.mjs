#!/usr/bin/env node
// Replaces kanji baked into the battle interface TIMs of CG_02.DAT:
//   TIM 373 (0x849060, 8bpp): command buttons 退却/武将/偵察/戦場
//   TIM 374 (0x859280, 4bpp): formation/result banners (通常陣形 ... 退却)
// Dimensions, bit depth, CLUTs and archive layout are unchanged. Each TIM is
// checked against its original hash before editing.
//
//   node tools/battle-ui-patch.mjs <CG_02.DAT> <SLPS_022.33> <output CG_02.DAT> [preview-dir]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const [cgPath, exePath, outputPath, previewDir] = process.argv.slice(2);
if (!cgPath || !exePath || !outputPath) {
  console.error('Usage: node tools/battle-ui-patch.mjs <CG_02.DAT> <SLPS_022.33> <output CG_02.DAT> [preview-dir]');
  process.exit(2);
}
const cg = Buffer.from(fs.readFileSync(cgPath));
const exe = fs.readFileSync(exePath);
const EXPECTED = { 0x849060: 'acc7f445f421035e5fe97abed5a66ff9cac953859c8ae1c00785d660c375aa89', 0x859280: '4b3d9d8b3c6a437497decb4656be6abebf940915a8cd85b74c48cec66ccb2e81' };

function openTim(offset) {
  if (cg.readUInt32LE(offset) !== 0x10) throw new Error(`No TIM at 0x${offset.toString(16)}`);
  const flags = cg.readUInt32LE(offset + 4), mode = flags & 7;
  let at = offset + 8, clut = null;
  if (flags & 8) { const size = cg.readUInt32LE(at); clut = { at: at + 12, width: cg.readUInt16LE(at + 8), rows: cg.readUInt16LE(at + 10) }; at += size; }
  const words = cg.readUInt16LE(at + 8), height = cg.readUInt16LE(at + 10);
  const width = mode === 0 ? words * 4 : words * 2;
  const pixels = at + 12, end = pixels + words * 2 * height;
  const hash = crypto.createHash('sha256').update(cg.subarray(offset, end)).digest('hex');
  if (hash !== EXPECTED[offset]) throw new Error(`TIM 0x${offset.toString(16)} does not match the original CG_02.DAT`);
  const color = (i, row = 0) => { const c = cg.readUInt16LE(clut.at + (row * clut.width + i) * 2); return [(c & 31) << 3, ((c >> 5) & 31) << 3, ((c >> 10) & 31) << 3]; };
  return {
    mode, width, height, color,
    get: (x, y) => mode === 0 ? (cg[pixels + y * words * 2 + (x >> 1)] >> ((x & 1) * 4)) & 15 : cg[pixels + y * words * 2 + x],
    set: (x, y, v) => {
      if (mode === 0) { const i = pixels + y * words * 2 + (x >> 1); cg[i] = (x & 1) ? (cg[i] & 0x0f) | (v << 4) : (cg[i] & 0xf0) | v; }
      else cg[pixels + y * words * 2 + x] = v;
    },
  };
}

// Latin glyphs from the game's dialogue font (11 rows x 16 bits per glyph).
const FONT = 0x800d8774 - 0x80010000 + 0x800;
function gameGlyph(ch) {
  const c = ch.charCodeAt(0);
  const index = c >= 0x41 && c <= 0x5a ? 157 + c - 0x41 : c >= 0x61 && c <= 0x7a ? 183 + c - 0x61 : ch === '-' ? 29 : ch === ' ' ? 0 : -1;
  if (index < 0) throw new Error(`No glyph for ${ch}`);
  const rows = [...Array(11)].map((_, r) => exe.readUInt16BE(FONT + 22 * index + r * 2));
  let left = 16, right = -1;
  rows.forEach(bits => { for (let x = 0; x < 16; x++) if ((bits >> (15 - x)) & 1) { left = Math.min(left, x); right = Math.max(right, x); } });
  return right < 0 ? { rows, left: 0, width: 3, blank: true } : { rows, left, width: right - left + 1 };
}
function layoutGame(text) {
  const glyphs = [...text].map(gameGlyph);
  const width = glyphs.reduce((sum, g) => sum + g.width + 1, -1);
  return { glyphs, width };
}

const PIXEL = {
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  I: ['111', '010', '010', '010', '010', '010', '111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
};

// ---- TIM 373: command buttons ------------------------------------------------
const buttons = openTim(0x849060);
const BUTTONS = [['FLEE', 121], ['GENS', 141], ['SCOUT', 161], ['FIELD', 181]];
const luma = i => { const [r, g, b] = buttons.color(i); return r + g + b; };
let white = 0, dark = 0;
for (let i = 0; i < 256; i++) { if (luma(i) > luma(white)) white = i; if (luma(i) < luma(dark) || luma(dark) === 0) dark = luma(i) > 0 ? i : dark; }
for (const [text, top] of BUTTONS) {
  const x0 = 13, x1 = 46, y0 = top, y1 = top + 13;
  const mask = new Set();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (luma(buttons.get(x, y)) > 560) mask.add(`${x},${y}`);
  if (mask.size < 20) throw new Error(`Button text not found at y=${top}`);
  let pending = [...mask];
  while (pending.length) {
    const next = [];
    for (const key of pending) {
      const [x, y] = key.split(',').map(Number);
      const near = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => !mask.has(`${nx},${ny}`));
      if (near.length) { const [nx, ny] = near[(x + y) % near.length]; buttons.set(x, y, buttons.get(nx, ny)); mask.delete(key); } else next.push(key);
    }
    if (next.length === pending.length) throw new Error('Button fill did not converge');
    pending = next;
  }
  const glyphs = [...text].map(ch => PIXEL[ch]);
  const width = glyphs.reduce((s, g) => s + g[0].length + 1, -1);
  let x = x0 + Math.floor((x1 - x0 - width) / 2);
  const y = y0 + 3;
  for (const g of glyphs) {
    g.forEach((row, dy) => [...row].forEach((bit, dx) => { if (bit === '1') { buttons.set(x + dx + 1, y + dy + 1, dark); } }));
    g.forEach((row, dy) => [...row].forEach((bit, dx) => { if (bit === '1') buttons.set(x + dx, y + dy, white); }));
    x += g[0].length + 1;
  }
}

// ---- TIM 374: banners ------------------------------------------------------
const banners = openTim(0x859280);
const BG = 0xf, SHADOW = 0xd;
const BANNERS = [
  { box: [1, 1, 79, 18], text: 'Normal' }, { box: [80, 1, 75, 18], text: 'Immobile' },
  { box: [1, 21, 79, 18], text: 'Attack' }, { box: [80, 21, 75, 18], text: 'Melee' },
  { box: [1, 41, 76, 18], text: 'Anti-Magic' },
  { box: [1, 61, 76, 18], text: 'Assassin' },
  { box: [1, 81, 76, 18], text: 'Skywave' },
  { box: [1, 101, 76, 18], text: 'Triguard' },
  { box: [1, 121, 77, 18], text: 'Wave Attack' },
  { box: [1, 141, 76, 18], text: 'Disrupt' },
  { box: [1, 161, 76, 18], text: 'Special' },
  { box: [1, 181, 77, 18], text: 'Cornered' },
  { box: [1, 201, 76, 18], text: 'Failed' },
  { box: [1, 221, 76, 18], text: 'Retreat' },
];
for (const { box: [bx, by, bw, bh], text } of BANNERS) {
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) banners.set(x, y, BG);
  const { glyphs, width } = layoutGame(text);
  if (width + 1 > bw) throw new Error(`Banner "${text}" is ${width}px; box is ${bw}px`);
  let x = bx + Math.floor((bw - width - 1) / 2);
  const y = by + Math.floor((bh - 12) / 2);
  const ink = [];
  for (const g of glyphs) {
    if (!g.blank) g.rows.forEach((bits, row) => { for (let col = g.left; col < 16; col++) if ((bits >> (15 - col)) & 1) ink.push([x + col - g.left, y + row, row]); });
    x += g.width + 1;
  }
  for (const [px, py] of ink) banners.set(px + 1, py + 1, SHADOW);
  // vertical gradient: highlight at the top, darker toward the bottom (palette ramps 1..12)
  for (const [px, py, row] of ink) banners.set(px, py, Math.min(12, 1 + row));
}

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, cg);
if (previewDir) {
  preview(buttons, path.join(previewDir, 'battle-buttons.png'), [0, 110, 64, 92], 0);
  preview(banners, path.join(previewDir, 'battle-banners.png'), [0, 0, 160, 240], 3);
}
console.log(JSON.stringify({ output: path.resolve(outputPath), buttons: BUTTONS.map(b => b[0]), banners: BANNERS.map(b => b.text) }, null, 2));

function preview(tim, file, [x0, y0, w, h], clutRow) {
  const S = 3, W = w * S, H = h * S, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw.set(tim.color(tim.get(x0 + ((x / S) | 0), y0 + ((y / S) | 0)), clutRow), y * (W * 3 + 1) + 1 + x * 3);
  const table = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const v of buf) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(W, 0); header.writeUInt32BE(H, 4); header[8] = 8; header[9] = 2;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
