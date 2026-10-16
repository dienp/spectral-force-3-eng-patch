#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [command, inputPath, jsonPath, outputPath] = process.argv.slice(2);
if (!['extract', 'insert', 'extract-raw', 'insert-raw', 'extract-raw-grouped', 'insert-raw-grouped'].includes(command) || !inputPath || !jsonPath || (command.startsWith('insert') && !outputPath)) {
  console.error('Usage:\n  node tools/texttool.mjs extract <PS-X-EXE> <strings.json>\n  node tools/texttool.mjs insert <PS-X-EXE> <strings.json> <patched-exe>\n  node tools/texttool.mjs extract-raw[-grouped] <container> <strings.json>\n  node tools/texttool.mjs insert-raw[-grouped] <container> <strings.json> <patched-container>');
  process.exit(2);
}

const decoder = new TextDecoder('shift_jis', { fatal: true });
const isJapanese = ch => /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}々〆ヶー。、・「」『』【】！？]/u.test(ch);

function buildEncoderMap() {
  const map = new Map();
  for (let b = 0x20; b <= 0x7e; b++) map.set(String.fromCharCode(b), Buffer.from([b]));
  map.set('\n', Buffer.from([0x0a]));
  for (let b = 0xa1; b <= 0xdf; b++) {
    const bytes = Buffer.from([b]);
    try { map.set(decoder.decode(bytes), bytes); } catch {}
  }
  for (const leadRange of [[0x81, 0x9f], [0xe0, 0xef]]) {
    for (let lead = leadRange[0]; lead <= leadRange[1]; lead++) {
      for (let trail = 0x40; trail <= 0xfc; trail++) {
        if (trail === 0x7f) continue;
        const bytes = Buffer.from([lead, trail]);
        try {
          const value = decoder.decode(bytes);
          if (value && value !== '�' && !map.has(value)) map.set(value, bytes);
        } catch {}
      }
    }
  }
  return map;
}

function encodeSjis(text, encoderMap) {
  const chunks = [];
  for (const ch of text) {
    const bytes = encoderMap.get(ch);
    if (!bytes) throw new Error(`Character ${JSON.stringify(ch)} is not representable in Shift-JIS`);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function parseHeader(data) {
  if (data.length < 0x800 || data.subarray(0, 8).toString('ascii') !== 'PS-X EXE') throw new Error('Input is not a PS-X EXE');
  return { loadAddress: data.readUInt32LE(0x18), payloadSize: data.readUInt32LE(0x1c) };
}

function pointerReferences(data, address) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(address >>> 0);
  const refs = [];
  let at = 0;
  while ((at = data.indexOf(needle, at)) !== -1) {
    refs.push(`0x${at.toString(16)}`);
    at += 4;
  }
  return refs;
}

const input = fs.readFileSync(inputPath);
const isRaw = command.includes('-raw');
const header = isRaw ? null : parseHeader(input);

if (command.startsWith('extract')) {
  const strings = [];
  let start = isRaw ? 0 : 0x800;
  while (start < input.length) {
    const end = input.indexOf(0, start);
    if (end === -1) break;
    const length = end - start;
    if (length >= 2 && length <= 1024) {
      try {
        const text = decoder.decode(input.subarray(start, end));
        const chars = [...text];
        const jpCount = chars.filter(isJapanese).length;
        const controlsOkay = chars.every(ch => ch === '\n' || ch === '\r' || ch === '\t' || ch.charCodeAt(0) >= 0x20);
        if (jpCount >= 1 && controlsOkay && !text.includes('\ufffd')) {
          const address = isRaw ? null : (header.loadAddress + start - 0x800) >>> 0;
          const record = {
            id: `${isRaw ? 'raw' : 'exe'}_${start.toString(16).padStart(8, '0')}`,
            offset: `0x${start.toString(16)}`,
            maxBytes: length,
            original: text,
            translation: '',
          };
          if (!isRaw) {
            record.address = `0x${address.toString(16)}`;
            record.pointerReferences = pointerReferences(input, address);
          }
          strings.push(record);
        }
      } catch {}
    }
    start = end + 1;
  }
  const grouped = command === 'extract-raw-grouped';
  const result = {
    format: 'spectral-force-translation-v1',
    source: path.resolve(inputPath),
    targetKind: isRaw ? 'raw-container' : 'ps-x-exe',
    encoding: 'Shift-JIS',
    controlCodes: { '#n': 'line break' },
    insertionMode: 'in-place; translations must fit maxBytes',
  };
  if (grouped) {
    const groups = new Map();
    for (const item of strings) {
      if (/ダミーイベント|○ボタン押してね/.test(item.original)) continue;
      let group = groups.get(item.original);
      if (!group) {
        group = { id: `text_${groups.size.toString().padStart(5, '0')}`, original: item.original, translation: '', occurrences: [] };
        groups.set(item.original, group);
      }
      group.occurrences.push({ offset: item.offset, maxBytes: item.maxBytes });
    }
    result.groups = [...groups.values()];
    result.insertionMode = 'in-place; each translation must fit every occurrence maxBytes';
  } else {
    result.strings = strings;
  }
  fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Extracted ${grouped ? result.groups.length + ' unique groups from ' : ''}${strings.length} candidate strings to ${path.resolve(jsonPath)}`);
} else {
  const catalog = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (catalog.format !== 'spectral-force-translation-v1' || (!Array.isArray(catalog.strings) && !Array.isArray(catalog.groups))) throw new Error('Unsupported translation catalog');
  const encoderMap = buildEncoderMap();
  const patched = Buffer.from(input);
  let changed = 0;
  const items = catalog.strings ?? catalog.groups.flatMap(group => group.occurrences.map(occurrence => ({ ...occurrence, id: group.id, original: group.original, translation: group.translation })));
  for (const item of items) {
    if (!item.translation) continue;
    const offset = Number.parseInt(item.offset, 16);
    const expected = encodeSjis(item.original, encoderMap);
    if (!patched.subarray(offset, offset + expected.length).equals(expected)) throw new Error(`${item.id}: original bytes do not match`);
    const replacement = encodeSjis(item.translation, encoderMap);
    if (replacement.length > item.maxBytes) throw new Error(`${item.id}: translation is ${replacement.length} bytes; slot allows ${item.maxBytes}`);
    if (isRaw) {
      // Event scripts (IV_DAT.EVE) continue with the next opcode right after
      // the string's NUL, so a NUL inside the slot would end the event. Keep
      // the original terminator and fill the gap with "# " pairs, which the
      // text builder 0x80079E28 skips without drawing (a '#' code outside its
      // table, 0x8007A040 -> 0x8007A130). See RESEARCH.md ("Event slot padding").
      if (patched[offset + item.maxBytes] !== 0) throw new Error(`${item.id}: no NUL terminator at ${item.offset}+${item.maxBytes}`);
      let pos = 0;
      while (pos < replacement.length) pos += replacement[pos] === 0x23 || replacement[pos] >= 0x80 ? 2 : 1;
      const pad = [];
      const gap = item.maxBytes - replacement.length;
      if (gap > 0 && pos > replacement.length) pad.push(0x20); // completes a trailing lone '#'
      if ((gap - pad.length) % 2 === 1) pad.push(0x20);
      while (pad.length < gap) pad.push(0x23, 0x20);
      const filled = Buffer.concat([replacement, Buffer.from(pad)]);
      if (filled.length !== item.maxBytes) throw new Error(`${item.id}: padding produced ${filled.length} bytes for a ${item.maxBytes}-byte slot`);
      filled.copy(patched, offset);
    } else {
      patched.fill(0, offset, offset + item.maxBytes);
      replacement.copy(patched, offset);
    }
    changed++;
  }
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, patched);
  console.log(`Patched ${changed} strings into ${path.resolve(outputPath)}`);
}
