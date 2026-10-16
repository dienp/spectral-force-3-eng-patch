#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [command, inputPath, outputDir] = process.argv.slice(2);
if (!['scan', 'extract'].includes(command) || !inputPath || (command === 'extract' && !outputDir)) {
  console.error('Usage: node tools/timtool.mjs <scan|extract> <file> [output-dir]');
  process.exit(2);
}

const data = fs.readFileSync(inputPath);

function parseTim(offset) {
  if (offset + 20 > data.length || data.readUInt32LE(offset) !== 0x10) return null;
  const flags = data.readUInt32LE(offset + 4);
  const mode = flags & 7;
  if (mode > 3 || (flags & ~0x0f) !== 0) return null;
  let at = offset + 8;
  let palette = null;
  let clutWidth = 0;
  let clutHeight = 0;
  if (flags & 8) {
    if (at + 12 > data.length) return null;
    const size = data.readUInt32LE(at);
    clutWidth = data.readUInt16LE(at + 8);
    clutHeight = data.readUInt16LE(at + 10);
    if (size < 12 || at + size > data.length || !clutWidth || !clutHeight || size !== 12 + clutWidth * clutHeight * 2) return null;
    palette = data.subarray(at + 12, at + size);
    at += size;
  } else if (mode < 2) return null;
  if (at + 12 > data.length) return null;
  const imageSize = data.readUInt32LE(at);
  const x = data.readUInt16LE(at + 4);
  const y = data.readUInt16LE(at + 6);
  const words = data.readUInt16LE(at + 8);
  const height = data.readUInt16LE(at + 10);
  if (imageSize < 12 || at + imageSize > data.length || !words || !height || imageSize !== 12 + words * 2 * height) return null;
  const width = mode === 0 ? words * 4 : mode === 1 ? words * 2 : mode === 2 ? words : Math.floor(words * 2 / 3);
  if (!width || width > 4096 || height > 4096) return null;
  return { offset, flags, mode, x, y, width, height, words, clutWidth, clutHeight, pixelsOffset: at + 12, totalSize: at + imageSize - offset, palette };
}

function color555(value) {
  const r = (value & 31) * 255 / 31;
  const g = ((value >>> 5) & 31) * 255 / 31;
  const b = ((value >>> 10) & 31) * 255 / 31;
  const alpha = value === 0 ? 0 : 255;
  return [Math.round(b), Math.round(g), Math.round(r), alpha];
}

function toBmp(tim) {
  const rowBytes = tim.width * 4;
  const out = Buffer.alloc(54 + rowBytes * tim.height);
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(tim.width, 18);
  out.writeInt32LE(tim.height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(32, 28);
  out.writeUInt32LE(rowBytes * tim.height, 34);
  const src = data.subarray(tim.pixelsOffset, tim.pixelsOffset + tim.words * 2 * tim.height);
  const palette = [];
  if (tim.palette) for (let i = 0; i < tim.clutWidth; i++) palette.push(color555(tim.palette.readUInt16LE(i * 2)));
  for (let y = 0; y < tim.height; y++) {
    const dstRow = 54 + (tim.height - 1 - y) * rowBytes;
    for (let x = 0; x < tim.width; x++) {
      let bgra;
      if (tim.mode === 0) {
        const packed = src[y * tim.words * 2 + (x >>> 1)];
        bgra = palette[(x & 1) ? packed >>> 4 : packed & 15] ?? [255, 0, 255, 255];
      } else if (tim.mode === 1) {
        bgra = palette[src[y * tim.words * 2 + x]] ?? [255, 0, 255, 255];
      } else if (tim.mode === 2) {
        bgra = color555(src.readUInt16LE((y * tim.width + x) * 2));
      } else {
        const p = y * tim.words * 2 + x * 3;
        bgra = [src[p], src[p + 1], src[p + 2], 255];
      }
      Buffer.from(bgra).copy(out, dstRow + x * 4);
    }
  }
  return out;
}

const images = [];
let at = 0;
while ((at = data.indexOf(Buffer.from([0x10, 0, 0, 0]), at)) !== -1) {
  const tim = parseTim(at);
  if (tim) images.push(tim);
  at++;
}

const summary = images.map(({ palette, pixelsOffset, ...item }, index) => ({ index, ...item, offset: `0x${item.offset.toString(16)}`, mode: ['4bpp', '8bpp', '16bpp', '24bpp'][item.mode] }));
if (command === 'scan') {
  console.log(JSON.stringify(summary, null, 2));
} else {
  fs.mkdirSync(outputDir, { recursive: true });
  for (let i = 0; i < images.length; i++) {
    const tim = images[i];
    const name = `${i.toString().padStart(4, '0')}_0x${tim.offset.toString(16)}_${tim.width}x${tim.height}_${['4', '8', '16', '24'][tim.mode]}bpp.bmp`;
    fs.writeFileSync(path.join(outputDir, name), toBmp(tim));
  }
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Extracted ${images.length} TIM images to ${path.resolve(outputDir)}`);
}
