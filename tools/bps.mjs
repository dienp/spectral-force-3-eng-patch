#!/usr/bin/env node
// Create or apply BPS patches (byuu's beat format), dependency-free.
//
//   node tools/bps.mjs create <original.bin> <modified.bin> <patch.bps> [metadata-text]
//   node tools/bps.mjs apply  <original.bin> <patch.bps> <output.bin>
//
// The patch stores only changed bytes (TargetRead) between unchanged runs
// (SourceRead), so it never contains original disc data. Source, target and patch
// CRC32s are checked on apply, as every BPS patcher does.
import fs from 'node:fs';
import path from 'node:path';

const [command, ...args] = process.argv.slice(2);

const CRC_TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf, crc = 0xffffffff) {
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}
const finish = crc => (crc ^ 0xffffffff) >>> 0;

function encodeNumber(n) {
  const bytes = [];
  for (;;) {
    const x = n % 128; // avoid 32-bit bitwise limits for large sizes
    n = Math.floor(n / 128);
    if (n === 0) { bytes.push(0x80 | x); break; }
    bytes.push(x);
    n -= 1;
  }
  return Buffer.from(bytes);
}
function decodeNumber(buf, state) {
  let data = 0, shift = 1;
  for (;;) {
    const x = buf[state.at++];
    data += (x & 0x7f) * shift;
    if (x & 0x80) break;
    shift *= 128;
    data += shift;
  }
  return data;
}

function create(sourcePath, targetPath, patchPath, metadata = '') {
  const source = fs.readFileSync(sourcePath);
  const target = fs.readFileSync(targetPath);
  const chunks = [Buffer.from('BPS1'), encodeNumber(source.length), encodeNumber(target.length)];
  const meta = Buffer.from(metadata, 'utf8');
  chunks.push(encodeNumber(meta.length), meta);
  const action = (cmd, length) => chunks.push(encodeNumber(((length - 1) * 4) + cmd));
  const MERGE_GAP = 8; // short unchanged gaps are cheaper as literal bytes
  let at = 0, changed = 0;
  while (at < target.length) {
    // unchanged run
    let same = at;
    while (same < target.length && same < source.length && source[same] === target[same]) same++;
    if (same > at) { action(0, same - at); at = same; }
    if (at >= target.length) break;
    // changed run, absorbing tiny unchanged gaps
    let end = at;
    for (;;) {
      while (end < target.length && (end >= source.length || source[end] !== target[end])) end++;
      let gap = end;
      while (gap < target.length && gap < source.length && source[gap] === target[gap] && gap - end < MERGE_GAP) gap++;
      if (gap < target.length && gap - end < MERGE_GAP && (gap >= source.length || source[gap] !== target[gap])) { end = gap; continue; }
      break;
    }
    action(1, end - at);
    chunks.push(target.subarray(at, end));
    changed += end - at;
    at = end;
  }
  const sourceCrc = finish(crc32(source));
  const targetCrc = finish(crc32(target));
  const footer = Buffer.alloc(8);
  footer.writeUInt32LE(sourceCrc, 0);
  footer.writeUInt32LE(targetCrc, 4);
  const body = Buffer.concat([...chunks, footer]);
  const patchCrc = Buffer.alloc(4);
  patchCrc.writeUInt32LE(finish(crc32(body)), 0);
  const patch = Buffer.concat([body, patchCrc]);
  fs.mkdirSync(path.dirname(path.resolve(patchPath)), { recursive: true });
  fs.writeFileSync(patchPath, patch);
  return { patch: path.resolve(patchPath), patchBytes: patch.length, changedBytes: changed, sourceCrc32: sourceCrc.toString(16).padStart(8, '0'), targetCrc32: targetCrc.toString(16).padStart(8, '0') };
}

function apply(sourcePath, patchPath, outputPath) {
  const source = fs.readFileSync(sourcePath);
  const patch = fs.readFileSync(patchPath);
  if (patch.subarray(0, 4).toString('latin1') !== 'BPS1') throw new Error('Not a BPS patch');
  if (finish(crc32(patch.subarray(0, patch.length - 4))) !== patch.readUInt32LE(patch.length - 4)) throw new Error('Patch file is corrupted (patch CRC32 mismatch)');
  const expectSource = patch.readUInt32LE(patch.length - 12);
  if (finish(crc32(source)) !== expectSource) throw new Error(`This patch needs a different source file (CRC32 ${expectSource.toString(16).padStart(8, '0')}); check that you use the original, unmodified BIN`);
  const state = { at: 4 };
  const sourceSize = decodeNumber(patch, state), targetSize = decodeNumber(patch, state), metaSize = decodeNumber(patch, state);
  if (sourceSize !== source.length) throw new Error('Source size mismatch');
  state.at += metaSize;
  const target = Buffer.alloc(targetSize);
  let out = 0, sourceRel = 0, targetRel = 0;
  const end = patch.length - 12;
  while (state.at < end) {
    const data = decodeNumber(patch, state);
    const cmd = data % 4, length = Math.floor(data / 4) + 1;
    if (cmd === 0) { source.copy(target, out, out, out + length); out += length; }
    else if (cmd === 1) { patch.copy(target, out, state.at, state.at + length); state.at += length; out += length; }
    else {
      const raw = decodeNumber(patch, state);
      const delta = (raw & 1 ? -1 : 1) * Math.floor(raw / 2);
      if (cmd === 2) { sourceRel += delta; source.copy(target, out, sourceRel, sourceRel + length); sourceRel += length; out += length; }
      else { targetRel += delta; for (let i = 0; i < length; i++) target[out++] = target[targetRel++]; }
    }
  }
  if (out !== targetSize) throw new Error('Patch ended early');
  if (finish(crc32(target)) !== patch.readUInt32LE(patch.length - 8)) throw new Error('Output CRC32 mismatch; the patch did not apply cleanly');
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, target);
  return { output: path.resolve(outputPath), bytes: target.length };
}

if (command === 'create' && args.length >= 3) console.log(JSON.stringify(create(...args), null, 2));
else if (command === 'apply' && args.length === 3) console.log(JSON.stringify(apply(...args), null, 2));
else {
  console.error('Usage:\n  node tools/bps.mjs create <original.bin> <modified.bin> <patch.bps> [metadata]\n  node tools/bps.mjs apply <original.bin> <patch.bps> <output.bin>');
  process.exit(2);
}
