#!/usr/bin/env node
// Replaces small kanji labels baked into CG_01.DAT interface TIMs with English
// abbreviations drawn in a 5x7 pixel font. Dimensions, bit depth, CLUTs and the
// archive layout are unchanged; each TIM is checked against its original hash.
//
//   node tools/ui-label-patch.mjs <CG_01.DAT> <output CG_01.DAT> [preview-dir]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const [inputPath, outputPath, previewDir] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node tools/ui-label-patch.mjs <CG_01.DAT> <output CG_01.DAT> [preview-dir]');
  process.exit(2);
}

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['111', '010', '010', '010', '010', '010', '111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};

// Label cells located by dumping the pixel data (see RESEARCH.md).
const TIMS = [
  {
    name: 'status labels (cg01 #1)', offset: 0x54360, background: 0x0, ink: 0x1, shadow: 0xe,
    labels: [
      { rect: [128, 0, 16, 16], text: 'G' },
      { rect: [128, 16, 32, 16], text: 'GEMS' },
      { rect: [128, 32, 32, 16], text: 'HERD' },
      { rect: [128, 48, 32, 16], text: 'IMPS' },
      { rect: [128, 64, 16, 16], text: 'Y' },
      { rect: [144, 64, 16, 16], text: 'M' },
      { rect: [128, 80, 32, 16], text: 'TAX' },
      { rect: [128, 96, 32, 16], text: 'CREW' },
      { rect: [128, 112, 32, 16], text: 'WAR' },
      { rect: [128, 128, 32, 16], text: 'GOVT' },
      { rect: [128, 144, 32, 16], text: 'DIPL' },
    ],
  },
  {
    name: 'date/status bar (cg01 #14)', offset: 0x121900, background: 58, ink: 45, shadow: 55,
    labels: [
      { rect: [40, 22, 15, 15], text: 'Y' },
      { rect: [72, 22, 15, 15], text: 'M' },
      { rect: [119, 22, 22, 15], text: 'TOT' },
      { rect: [0, 62, 19, 15], text: 'PWR' },
    ],
  },
];

const EXPECTED = {
  0x54360: '39eecf2dd20a22fbe6d396aa0f9f68e933d29378ed764678e36ac96892088024',
  0x121900: '582fd7337b164a34e7ecdecbb5e21988962fb2b8ad1c6327b024db1d73e37926',
};

const cg = Buffer.from(fs.readFileSync(inputPath));

function openTim(offset) {
  if (cg.readUInt32LE(offset) !== 0x10) throw new Error(`No TIM at 0x${offset.toString(16)}`);
  const flags = cg.readUInt32LE(offset + 4);
  const mode = flags & 7;
  let at = offset + 8;
  let clut = null;
  if (flags & 8) { const size = cg.readUInt32LE(at); clut = { at: at + 12, count: (size - 12) / 2 }; at += size; }
  const words = cg.readUInt16LE(at + 8), height = cg.readUInt16LE(at + 10);
  const width = mode === 0 ? words * 4 : mode === 1 ? words * 2 : words;
  const pixels = at + 12;
  const end = pixels + words * 2 * height;
  return {
    mode, width, height, clut, start: offset, end,
    get: (x, y) => mode === 0 ? (cg[pixels + y * words * 2 + (x >> 1)] >> ((x & 1) * 4)) & 15 : cg[pixels + y * words * 2 + x],
    set: (x, y, v) => {
      if (mode === 0) {
        const i = pixels + y * words * 2 + (x >> 1);
        cg[i] = (x & 1) ? (cg[i] & 0x0f) | (v << 4) : (cg[i] & 0xf0) | v;
      } else cg[pixels + y * words * 2 + x] = v;
    },
  };
}

function drawText(tim, [rx, ry, rw, rh], text, ink, shadow) {
  const glyphs = [...text].map(ch => { const g = FONT[ch]; if (!g) throw new Error(`No pixel glyph for ${ch}`); return g; });
  const width = glyphs.reduce((sum, g) => sum + g[0].length + 1, -1);
  if (width + 1 > rw) throw new Error(`"${text}" (${width}px) does not fit ${rw}px`);
  let x = rx + Math.floor((rw - width - 1) / 2);
  const y = ry + Math.floor((rh - 8) / 2);
  for (const g of glyphs) {
    g.forEach((row, dy) => [...row].forEach((bit, dx) => {
      if (bit !== '1') return;
      if (tim.get(x + dx + 1, y + dy + 1) !== ink) tim.set(x + dx + 1, y + dy + 1, shadow);
      tim.set(x + dx, y + dy, ink);
    }));
    x += g[0].length + 1;
  }
}

const report = [];
for (const spec of TIMS) {
  const tim = openTim(spec.offset);
  const hash = crypto.createHash('sha256').update(cg.subarray(tim.start, tim.end)).digest('hex');
  if (hash !== EXPECTED[spec.offset]) throw new Error(`${spec.name}: TIM does not match the original CG_01.DAT`);
  for (const { rect: [rx, ry, rw, rh], text } of spec.labels) {
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) tim.set(x, y, spec.background);
    drawText(tim, [rx, ry, rw, rh], text, spec.ink, spec.shadow);
  }
  report.push({ tim: spec.name, labels: spec.labels.map(l => l.text) });
  if (previewDir) writePreview(tim, path.join(previewDir, `ui-${spec.offset.toString(16)}.png`));
}

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, cg);
console.log(JSON.stringify({ output: path.resolve(outputPath), report }, null, 2));

function writePreview(tim, file) {
  const color = i => { const c = cg.readUInt16LE(tim.clut.at + i * 2); return [(c & 31) << 3, ((c >> 5) & 31) << 3, ((c >> 10) & 31) << 3]; };
  const S = 3, W = tim.width * S, H = tim.height * S;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw.set(color(tim.get((x / S) | 0, (y / S) | 0)), y * (W * 3 + 1) + 1 + x * 3);
  const table = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const v of buf) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(W, 0); header.writeUInt32BE(H, 4); header[8] = 8; header[9] = 2;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
