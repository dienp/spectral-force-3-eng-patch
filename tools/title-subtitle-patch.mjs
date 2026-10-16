#!/usr/bin/env node
// Replaces the baked Japanese subtitle (愛しき邪悪) on the title screen TIM in
// CG_01.DAT with an English subtitle drawn with the game's own font glyphs.
// The TIM keeps its dimensions, bit depth, CLUT and archive position.
//
//   node tools/title-subtitle-patch.mjs <CG_01.DAT> <SLPS_022.33> <output CG_01.DAT> [preview.png] [text]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const [cgPath, exePath, outputPath, previewPath, textArg] = process.argv.slice(2);
if (!cgPath || !exePath || !outputPath) {
  console.error('Usage: node tools/title-subtitle-patch.mjs <CG_01.DAT> <SLPS_022.33> <output CG_01.DAT> [preview.png] [text]');
  process.exit(2);
}
const TEXT = textArg ?? 'Lovely Wickedness';
const TIM_OFFSET = 0x12a0a0;                    // title screen, 320x240 8bpp (exported as cg01 #15)
const COPY_OFFSET = 0xbe7000;                   // identical second copy (cg01 #407)
const TIM_LENGTH = 20 + 512 + 12 + 320 * 240;
const REGION = { x0: 120, y0: 144, x1: 200, y1: 164 }; // box around the baked subtitle

const cg = Buffer.from(fs.readFileSync(cgPath));
const TIM_SHA256 = '5bf13fb236eaa638531f909b3b8064e42184560f8b40196e95da9bbfb739f198';
for (const at of [TIM_OFFSET, COPY_OFFSET]) {
  if (crypto.createHash('sha256').update(cg.subarray(at, at + TIM_LENGTH)).digest('hex') !== TIM_SHA256) throw new Error(`Title TIM at 0x${at.toString(16)} does not match the original CG_01.DAT`);
}
const exe = fs.readFileSync(exePath);
if (cg.readUInt32LE(TIM_OFFSET) !== 0x10 || cg.readUInt32LE(TIM_OFFSET + 4) !== 0x09) throw new Error('Title TIM header not found');
const clutSize = cg.readUInt32LE(TIM_OFFSET + 8);
const clutColors = cg.readUInt16LE(TIM_OFFSET + 16) * cg.readUInt16LE(TIM_OFFSET + 18);
const clut = [...Array(clutColors)].map((_, i) => cg.readUInt16LE(TIM_OFFSET + 20 + i * 2));
const imageAt = TIM_OFFSET + 8 + clutSize;
const width = cg.readUInt16LE(imageAt + 8) * 2;
const height = cg.readUInt16LE(imageAt + 10);
if (width !== 320 || height !== 240) throw new Error(`Unexpected title size ${width}x${height}`);
const pixels = imageAt + 12;
const rgb = index => { const c = clut[index]; return [(c & 31) << 3, ((c >> 5) & 31) << 3, ((c >> 10) & 31) << 3]; };
const get = (x, y) => cg[pixels + y * width + x];
const set = (x, y, v) => { cg[pixels + y * width + x] = v; };

// 1. Mask the red subtitle pixels (red clearly dominant over green and blue).
const isRed = index => { const [r, g, b] = rgb(index); return r >= 96 && r > g * 1.6 && r > b * 1.6; };
const mask = new Set();
const redCount = new Map();
for (let y = REGION.y0; y < REGION.y1; y++) for (let x = REGION.x0; x < REGION.x1; x++) {
  const v = get(x, y);
  if (isRed(v)) { mask.add(y * width + x); redCount.set(v, (redCount.get(v) ?? 0) + 1); }
}
if (mask.size < 100) throw new Error(`Subtitle not found (only ${mask.size} red pixels); input may already be patched`);
const textColor = [...redCount].sort((a, b) => b[1] - a[1])[0][0];

// 2. Fill the masked pixels from their unmasked neighbours, growing inward.
let remaining = [...mask];
while (remaining.length) {
  const next = [];
  const fills = [];
  for (const p of remaining) {
    const x = p % width, y = (p / width) | 0;
    const around = [];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
      const q = (y + dy) * width + x + dx;
      if (!mask.has(q)) around.push(get(x + dx, y + dy));
    }
    if (around.length) fills.push([p, around[(x + y) % around.length]]); else next.push(p);
  }
  if (!fills.length) throw new Error('Fill did not converge');
  for (const [p, v] of fills) { cg[pixels + p] = v; mask.delete(p); }
  remaining = next;
}

// 3. Draw the English subtitle with the font's Latin glyphs and a dark outline.
const FONT = 0x800d8774 - 0x80010000 + 0x800;
const glyphIndex = ch => {
  const c = ch.charCodeAt(0);
  if (c >= 0x41 && c <= 0x5a) return 157 + c - 0x41;
  if (c >= 0x61 && c <= 0x7a) return 183 + c - 0x61;
  if (c >= 0x30 && c <= 0x39) return 147 + c - 0x30;
  if (ch === ' ') return 0;
  throw new Error(`Unsupported subtitle character ${JSON.stringify(ch)}`);
};
const glyphRows = ch => [...Array(11)].map((_, row) => exe.readUInt16BE(FONT + 22 * glyphIndex(ch) + row * 2));
const layout = [];
let pen = 0;
for (const ch of TEXT) {
  const rows = glyphRows(ch);
  let left = 16, right = -1;
  rows.forEach(bits => { for (let x = 0; x < 16; x++) if ((bits >> (15 - x)) & 1) { left = Math.min(left, x); right = Math.max(right, x); } });
  if (right < 0) { pen += 4; continue; }
  layout.push({ rows, x: pen - left });
  pen += right - left + 2;
}
const textWidth = pen - 1;
const originX = Math.round(160 - textWidth / 2);
const originY = 148;
let darkest = 0, darkestLuma = Infinity;
clut.forEach((_, i) => { const [r, g, b] = rgb(i); const l = r + g + b; if (l < darkestLuma) { darkestLuma = l; darkest = i; } });
const ink = new Set();
for (const { rows, x } of layout) rows.forEach((bits, row) => {
  for (let col = 0; col < 16; col++) if ((bits >> (15 - col)) & 1) ink.add((originY + row) * width + originX + x + col);
});
for (const p of ink) {
  const x = p % width, y = (p / width) | 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const q = (y + dy) * width + x + dx;
    if (!ink.has(q)) set(x + dx, y + dy, darkest);
  }
}
for (const p of ink) cg[pixels + p] = textColor;

cg.copy(cg, COPY_OFFSET, TIM_OFFSET, TIM_OFFSET + TIM_LENGTH);
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, cg);

if (previewPath) {
  const scale = 2, W = width * scale, H = height * scale;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(get((x / scale) | 0, (y / scale) | 0));
    raw.set([r, g, b], y * (W * 3 + 1) + 1 + x * 3);
  }
  const table = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const v of buf) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(W, 0); header.writeUInt32BE(H, 4); header[8] = 8; header[9] = 2;
  fs.writeFileSync(previewPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
console.log(JSON.stringify({ output: path.resolve(outputPath), text: TEXT, replacedRedPixels: redCount.size && [...redCount.values()].reduce((a, b) => a + b, 0), textWidth, originX, textColor, outlineColor: darkest }, null, 2));
