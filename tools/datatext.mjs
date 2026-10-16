#!/usr/bin/env node
// Text stored in the CG archives' data blocks (not in the executable or event file):
//   - CG_01 roster/country name records (0x38 stride) and faction records (0x8C stride),
//     18-byte name fields
//   - CG_01 package string blocks (record type 9): bytes stored minus 0x80, strings
//     consecutive and found at runtime by counting NULs
//   - CG_02 biography block: 16-bit offset table followed by NUL-terminated strings
//
//   node tools/datatext.mjs extract <extracted-dir> <data-strings.json>
//   node tools/datatext.mjs insert <extracted-dir> <catalog.json> <CG_01 in> <CG_02 in> <out-dir>
//
// insert takes the CG_01/CG_02 files to patch (they may already carry graphics edits)
// and verifies the original text bytes at every location before writing. Translations
// are written in place: never longer than the original bytes, padded with spaces inside
// NUL-counted blocks (so string indexes do not shift) and with NULs elsewhere.
import fs from 'node:fs';
import path from 'node:path';

const [command, extractedDir, catalogPath, ...rest] = process.argv.slice(2);
const usage = 'Usage:\n  node tools/datatext.mjs extract <extracted-dir> <data-strings.json>\n  node tools/datatext.mjs insert <extracted-dir> <catalog.json> <CG_01 in> <CG_02 in> <out-dir>';
if (!['extract', 'insert'].includes(command) || !extractedDir || !catalogPath) { console.error(usage); process.exit(2); }

const decoder = new TextDecoder('shift_jis', { fatal: true });
const FIELDS = [
  { file: 'CG_01.DAT', table: 'roster', start: 0xc0e080, end: 0xc11a78, stride: 0x38 },
  { file: 'CG_01.DAT', table: 'faction', start: 0xc11a78, end: 0xc130e4, stride: 0x8c },
];
const FIELD_SIZE = 18, FIELD_TEXT = 16;
const FLIP_BLOCKS = [
  { file: 'CG_01.DAT', id: 'country-desc-a', data: 0xfb0a0, size: 3290, count: 40 },
  { file: 'CG_01.DAT', id: 'country-name', data: 0xfbd7a, size: 444, count: 40 },
  { file: 'CG_01.DAT', id: 'country-desc-b', data: 0xfc840, size: 3290, count: 40 },
];
const OFFSET_BLOCKS = [{ file: 'CG_02.DAT', id: 'bio', base: 0x86c800, count: 225 }];

const sjisRe = /[぀-ヿ一-鿿]/;
function* flipStrings(buf, block) {
  const data = Buffer.from(buf.subarray(block.data, block.data + block.size).map(v => (v + 0x80) & 0xff));
  let at = 0;
  for (let i = 0; i < block.count; i++) {
    const end = data.indexOf(0, at);
    if (end < 0) throw new Error(`${block.id}: string ${i} unterminated`);
    yield { index: i, offset: block.data + at, length: end - at, text: decoder.decode(data.subarray(at, end)) };
    at = end + 1;
  }
  if (at > block.size) throw new Error(`${block.id}: parsed past the block (${at} > ${block.size})`);
}
function* offsetStrings(buf, block) {
  for (let i = 0; i < block.count; i++) {
    const offset = block.base + buf.readUInt16LE(block.base + i * 2);
    const end = buf.indexOf(0, offset);
    yield { index: i, offset, length: end - offset, text: decoder.decode(buf.subarray(offset, end)) };
  }
}
function* fieldStrings(buf, spec) {
  for (let offset = spec.start, i = 0; offset < spec.end; offset += spec.stride, i++) {
    const end = buf.indexOf(0, offset);
    if (end - offset > FIELD_TEXT) throw new Error(`${spec.table} record ${i}: name longer than ${FIELD_TEXT} bytes`);
    yield { index: i, offset, length: end - offset, text: decoder.decode(buf.subarray(offset, end)) };
  }
}

function extractAll(dir) {
  const files = { 'CG_01.DAT': fs.readFileSync(path.join(dir, 'CG_01.DAT')), 'CG_02.DAT': fs.readFileSync(path.join(dir, 'CG_02.DAT')) };
  const entries = [];
  const add = (kind, group, file, s, extra = {}) => entries.push({
    id: `${group}_${String(s.index).padStart(3, '0')}`, kind, group, file, offset: `0x${s.offset.toString(16)}`,
    index: s.index, length: s.length,
    maxBytes: kind === 'field' || group === 'country-name' ? FIELD_TEXT : Math.max(s.length, 110), original: s.text, ...extra,
  });
  for (const spec of FIELDS) for (const s of fieldStrings(files[spec.file], spec)) add('field', spec.table, spec.file, s);
  for (const block of FLIP_BLOCKS) for (const s of flipStrings(files[block.file], block)) add('flip', block.id, block.file, s);
  for (const block of OFFSET_BLOCKS) for (const s of offsetStrings(files[block.file], block)) add('offset', block.id, block.file, s);
  return entries;
}

function encode(text) {
  const bytes = Buffer.from(text, 'latin1');
  if (/[^\x20-\x7e]/.test(text)) throw new Error(`Non-ASCII translation: ${JSON.stringify(text)}`);
  return bytes;
}

if (command === 'extract') {
  const entries = extractAll(extractedDir);
  fs.mkdirSync(path.dirname(path.resolve(catalogPath)), { recursive: true });
  fs.writeFileSync(catalogPath, `${JSON.stringify({ format: 'spectral-force-data-strings-v1', entries }, null, 2)}\n`);
  const kinds = {};
  for (const e of entries) kinds[e.group] = (kinds[e.group] ?? 0) + 1;
  console.log(JSON.stringify({ output: path.resolve(catalogPath), entries: entries.length, groups: kinds, withJapanese: entries.filter(e => sjisRe.test(e.original)).length }, null, 2));
} else {
  const [cg01In, cg02In, outDir] = rest;
  if (!outDir) { console.error(usage); process.exit(2); }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const items = catalog.items ?? catalog.entries;
  const byId = new Map(items.map(i => [i.id, i]));
  const original = extractAll(extractedDir);
  const out = { 'CG_01.DAT': Buffer.from(fs.readFileSync(cg01In)), 'CG_02.DAT': Buffer.from(fs.readFileSync(cg02In)) };
  const pristine = { 'CG_01.DAT': fs.readFileSync(path.join(extractedDir, 'CG_01.DAT')), 'CG_02.DAT': fs.readFileSync(path.join(extractedDir, 'CG_02.DAT')) };
  let written = 0;
  const repack = new Map([...FLIP_BLOCKS, ...OFFSET_BLOCKS].map(b => [b.id, new Map()]));
  for (const e of original) {
    const item = byId.get(e.id);
    if (!item || !item.translation) continue;
    if (item.original !== e.original) throw new Error(`${e.id}: catalog original does not match the archive`);
    const buf = out[e.file], offset = Number(e.offset);
    const span = e.kind === 'field' ? FIELD_SIZE : e.length;
    if (!buf.subarray(offset, offset + span).equals(pristine[e.file].subarray(offset, offset + span))) throw new Error(`${e.id}: target bytes were already modified`);
    const text = encode(item.translation);
    if (text.length > e.maxBytes) throw new Error(`${e.id}: ${text.length} bytes > ${e.maxBytes}`);
    if (e.kind === 'field') {
      buf.fill(0, offset, offset + FIELD_SIZE);
      text.copy(buf, offset);
    } else {
      repack.get(e.group).set(e.index, text);
    }
    written++;
  }
  for (const block of FLIP_BLOCKS) writeFlipBlock(out[block.file], pristine[block.file], block, repack.get(block.id));
  for (const block of OFFSET_BLOCKS) writeOffsetBlock(out[block.file], pristine[block.file], block, repack.get(block.id));
  fs.mkdirSync(outDir, { recursive: true });
  for (const [file, buf] of Object.entries(out)) fs.writeFileSync(path.join(outDir, file), buf);
  console.log(JSON.stringify({ written, outDir: path.resolve(outDir) }));
}

// Rebuild a NUL-counted block: strings back to back, unused tail filled with spaces so
// the string count found by the loader stays exactly the same.
function writeFlipBlock(buf, pristine, block, translated) {
  const parts = [...flipStrings(pristine, block)].map(s => translated.get(s.index) ?? pristine.subarray(s.offset, s.offset + s.length).map(v => (v + 0x80) & 0xff));
  const plain = Buffer.concat(parts.flatMap(p => [Buffer.from(p), Buffer.alloc(1)]));
  if (plain.length > block.size) throw new Error(`${block.id}: ${plain.length} bytes > block size ${block.size}`);
  const full = Buffer.concat([plain, Buffer.alloc(block.size - plain.length, 0x20)]);
  for (let i = 0; i < full.length; i++) buf[block.data + i] = (full[i] - 0x80) & 0xff;
  const check = [...flipStrings(buf, { ...block, size: plain.length })].length;
  if (check !== block.count) throw new Error(`${block.id}: string count changed`);
}

// Rebuild an offset-table block: strings packed after the table, offsets rewritten, and
// everything must end before the original block end.
function writeOffsetBlock(buf, pristine, block, translated) {
  const strings = [...offsetStrings(pristine, block)];
  const end = Math.max(...strings.map(s => s.offset + s.length + 1));
  let at = block.base + block.count * 2;
  const start = at;
  for (const s of strings) {
    const bytes = translated.get(s.index) ?? pristine.subarray(s.offset, s.offset + s.length);
    if (at + bytes.length + 1 > end) throw new Error(`${block.id}: packed strings overflow the block (${end - start} bytes)`);
    buf.writeUInt16LE(at - block.base, block.base + s.index * 2);
    Buffer.from(bytes).copy(buf, at);
    buf[at + bytes.length] = 0;
    at += bytes.length + 1;
  }
  buf.fill(0, at, end);
}
