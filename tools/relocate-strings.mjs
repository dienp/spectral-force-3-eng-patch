#!/usr/bin/env node
// Opt-in string relocation for SLPS_022.33: lets an executable translation be
// longer than the Japanese slot by writing it into a verified-unused region
// and repointing every reference to the slot.
//
//   node tools/relocate-strings.mjs scan  <SLPS_022.33> <memory.en.json> <id>...
//   node tools/relocate-strings.mjs apply <SLPS_022.33> <memory.en.json> <relocations.json> <output> [report.json]
//
// relocations.json opts items in, keyed by translation-memory id:
//   { "format": "spectral-force-relocations-v1", "items": {
//     "tm_05750": {
//       "text": "Tactician ",                  // full translation, any length
//       "references": {                        // per location address, every reference
//         "0x80104e14": ["pair:0x80042674+0x80042678", "pair:0x8004299c+0x800429a0"]
//       } } } }
// The memory item's "translation" stays the in-place fallback that fits
// maxBytes; texttool still writes it to the original slot. A location not
// listed under "references" keeps the in-place text. `scan` prints the
// references the static scan finds, ready to review and paste.
//
// apply fails, writing nothing, when:
//   - the input executable or the pool region does not match the expected bytes,
//   - the slot does not hold the in-place translation,
//   - the static scan finds a reference not listed, misses a listed one, or
//     finds one that points inside the slot rather than at its start,
//   - a reference cannot be repointed: a load/store that copies the bytes
//     inline, a $gp-relative reference out of $gp range, a lui shared with
//     other addresses, or a branch target between lui and its low half,
//   - the pool is full.
// Evidence for the pool regions is in RESEARCH.md ("String relocation").
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseExe, decode } from './mips.mjs';
import { scanReferences, indexByTarget, reachableCode, describeRef, hex, GP_VALUE } from './exe-refs.mjs';
import { encodeSjis } from './glyph-budget.mjs';

// Unreferenced code, never reached from the entry point or from any address
// the executable forms. Hash = original bytes.
export const POOLS = [
  {
    start: 0x800ace08, end: 0x800ae214,
    sha256: '4f9ab8470b39c089880e921420d7ad6063d16dceb2eabb1e43a81c2abcfba71a',
    note: 'Psy-Q TMD/primitive debug routines (printf "analizing TMD..." at 0x80030938); no calls, jumps, pointers or lui/addiu references',
  },
];
const CODE_START = 0x80031440;
const CODE_END = 0x800c8ae4;
const ALIGN = 4;

const [command, exePath, memoryPath, ...rest] = process.argv.slice(2);
if (!['scan', 'apply'].includes(command) || !exePath || !memoryPath || (command === 'apply' && !rest[1])) {
  console.error('Usage:\n  node tools/relocate-strings.mjs scan <SLPS_022.33> <memory.en.json> <id>...\n  node tools/relocate-strings.mjs apply <SLPS_022.33> <memory.en.json> <relocations.json> <output> [report.json]');
  process.exit(2);
}

const input = fs.readFileSync(exePath);
const exe = parseExe(input);
if (exe.load !== 0x80010000 || input.length !== 1007616) throw new Error('Unexpected executable revision');
const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
const words = i => input.readUInt32LE(exe.offsetOf(i)) >>> 0;

function locationsOf(item) {
  return item.locations.filter(l => l.target === 'SLPS_022.33' && l.address).map(l => ({ ...l, addr: Number(l.address) >>> 0 }));
}

const { refs } = scanReferences(input);
const index = indexByTarget(refs);
const slotRefs = loc => index.range(loc.addr, loc.addr + loc.maxBytes + 1);

if (command === 'scan') {
  const ids = new Set(rest);
  for (const item of memory.items.filter(i => ids.has(i.id))) {
    const out = { id: item.id, original: item.original, translation: item.translation, references: {} };
    for (const loc of locationsOf(item)) {
      out.references[loc.address] = slotRefs(loc).map(r => {
        const label = describeRef(r);
        const notes = [];
        if (r.target !== loc.addr) notes.push(`interior +${r.target - loc.addr}`);
        if (r.access === 'load' || r.access === 'store') notes.push(`inline ${r.use}`);
        if (r.kind === 'gp') notes.push('gp-relative');
        if (r.sharedLui) notes.push('shared lui');
        return notes.length ? `${label} (${notes.join(', ')})` : label;
      });
    }
    console.log(JSON.stringify(out, null, 2));
  }
  process.exit(0);
}

// ---- apply -----------------------------------------------------------------
const [relocationsPath, outputPath, reportPath] = rest;
const relocations = JSON.parse(fs.readFileSync(relocationsPath, 'utf8'));
if (relocations.format !== 'spectral-force-relocations-v1' || typeof relocations.items !== 'object') throw new Error('Unsupported relocations file');
const memoryById = new Map(memory.items.map(item => [item.id, item]));
for (const id of Object.keys(relocations.items)) if (!memoryById.has(id)) throw new Error(`${id}: not in the translation memory`);
const output = Buffer.from(input);
const offsetOf = exe.offsetOf;
const readWord = a => output.readUInt32LE(offsetOf(a)) >>> 0;
const writeWord = (a, w) => output.writeUInt32LE(w >>> 0, offsetOf(a));

// Pools: original bytes, still unreferenced, still unreachable.
const reachable = reachableCode(input, refs, CODE_START, CODE_END);
const branchTargets = new Set();
for (let a = CODE_START; a < CODE_END; a += 4) { const ins = decode(words(a), a); if (ins.target !== undefined) branchTargets.add(ins.target); }
for (const pool of POOLS) {
  const bytes = input.subarray(offsetOf(pool.start), offsetOf(pool.end));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== pool.sha256) throw new Error(`Pool ${hex(pool.start)} does not hold its original bytes`);
  const into = index.range(pool.start, pool.end);
  if (into.length) throw new Error(`Pool ${hex(pool.start)} is referenced: ${into.map(describeRef).join(', ')}`);
  for (let a = pool.start; a < pool.end; a += 4) if (reachable(a)) throw new Error(`Pool ${hex(pool.start)} is reachable at ${hex(a)}`);
  pool.next = pool.start;
}
function allocate(bytes) {
  for (const pool of POOLS) {
    const at = pool.next;
    if (at + bytes.length + 1 <= pool.end) {
      pool.next = at + Math.ceil((bytes.length + 1) / ALIGN) * ALIGN;
      return at;
    }
  }
  throw new Error(`Relocation pool is full (${bytes.length + 1} bytes needed)`);
}

const hi = a => ((a + 0x8000) >>> 16) & 0xffff;
const report = { input: path.resolve(exePath), relocations: [] };
const placed = new Map(); // identical texts share one copy
const touched = new Set();

for (const [id, reloc] of Object.entries(relocations.items)) {
  const item = memoryById.get(id);
  if (typeof reloc.text !== 'string' || !reloc.text || typeof reloc.references !== 'object') throw new Error(`${item.id}: relocation needs "text" and "references"`);
  const locations = locationsOf(item);
  const fallback = encodeSjis(item.translation || item.original);
  const text = encodeSjis(reloc.text);
  if (text.includes(0)) throw new Error(`${item.id}: relocation text contains NUL`);
  for (const key of Object.keys(reloc.references)) {
    if (!locations.some(l => l.addr === (Number(key) >>> 0))) throw new Error(`${item.id}: ${key} is not a location of this item`);
  }
  for (const loc of locations) {
    const expected = reloc.references[loc.address];
    if (!expected) continue; // this location keeps the in-place translation
    // The slot must hold the in-place text written by texttool insert.
    const slot = output.subarray(offsetOf(loc.addr), offsetOf(loc.addr) + loc.maxBytes + 1);
    const want = Buffer.alloc(loc.maxBytes + 1); fallback.copy(want);
    if (!slot.equals(want)) throw new Error(`${item.id} @ ${loc.address}: slot does not hold the in-place translation (run texttool insert first)`);
    // Reference set must match exactly.
    const found = slotRefs(loc);
    const foundLabels = found.map(describeRef).sort();
    const wantLabels = [...expected].sort();
    const interior = found.filter(r => r.target !== loc.addr);
    if (interior.length) throw new Error(`${item.id} @ ${loc.address}: references point inside the slot: ${interior.map(r => `${describeRef(r)}->${hex(r.target)}`).join(', ')}`);
    if (foundLabels.join() !== wantLabels.join()) {
      throw new Error(`${item.id} @ ${loc.address}: reference mismatch\n  listed: ${wantLabels.join(', ') || '(none)'}\n  found:  ${foundLabels.join(', ') || '(none)'}`);
    }
    if (!found.length) throw new Error(`${item.id} @ ${loc.address}: no references found; nothing to repoint`);
    const key = text.toString('hex');
    let target = placed.get(key);
    if (target === undefined) {
      target = allocate(text);
      // NUL terminator plus alignment padding; the rest of the pool keeps its original bytes.
      output.fill(0, offsetOf(target), offsetOf(target) + Math.ceil((text.length + 1) / ALIGN) * ALIGN);
      text.copy(output, offsetOf(target));
      placed.set(key, target);
    }
    const patched = [];
    for (const r of found) {
      const label = describeRef(r);
      if (touched.has(r.site)) throw new Error(`${item.id}: ${label} was already repointed by another relocation`);
      if (r.kind === 'ptr') {
        if (readWord(r.site) !== loc.addr) throw new Error(`${item.id}: ${label} does not hold ${loc.address}`);
        writeWord(r.site, target);
      } else if (r.kind === 'gp') {
        if (r.access !== 'address') throw new Error(`${item.id}: ${label} copies the bytes inline (${r.use}); it cannot be repointed`);
        const delta = target - GP_VALUE;
        if (delta < -0x8000 || delta > 0x7fff) throw new Error(`${item.id}: ${label} is $gp-relative and ${hex(target)} is out of $gp range`);
        writeWord(r.site, (readWord(r.site) & 0xffff0000 | (delta & 0xffff)) >>> 0);
      } else {
        if (r.access !== 'address') throw new Error(`${item.id}: ${label} copies the bytes inline (${r.use}); it cannot be repointed`);
        const lui = decode(readWord(r.lui), r.lui);
        const low = decode(readWord(r.site), r.site);
        if (lui.name !== 'lui' || (low.name !== 'addiu' && low.name !== 'ori')) throw new Error(`${item.id}: ${label} is not a lui/addiu or lui/ori pair`);
        for (let a = r.lui + 4; a <= r.site; a += 4) if (branchTargets.has(a)) throw new Error(`${item.id}: ${label} has a branch target at ${hex(a)} between lui and its low half`);
        const newHi = low.name === 'ori' ? (target >>> 16) : hi(target);
        if (newHi !== lui.imm) {
          if (r.sharedLui) throw new Error(`${item.id}: ${label} shares its lui with other addresses; the high half cannot change`);
          if (touched.has(r.lui)) throw new Error(`${item.id}: ${label} lui was already changed`);
          writeWord(r.lui, ((readWord(r.lui) & 0xffff0000) | newHi) >>> 0);
          touched.add(r.lui);
        }
        writeWord(r.site, ((readWord(r.site) & 0xffff0000) | (target & 0xffff)) >>> 0);
      }
      touched.add(r.site);
      patched.push(label);
    }
    report.relocations.push({ id: item.id, from: loc.address, to: hex(target), bytes: text.length + 1, maxBytes: loc.maxBytes, text: reloc.text, references: patched });
  }
}

// Verify: a fresh scan must see each listed reference at the new address and
// nothing left pointing at a relocated slot.
const after = indexByTarget(scanReferences(output).refs);
for (const r of report.relocations) {
  const from = Number(r.from) >>> 0, to = Number(r.to) >>> 0;
  const left = after.range(from, from + r.maxBytes + 1).filter(x => r.references.includes(describeRef(x)));
  if (left.length) throw new Error(`${r.id}: still referenced at ${r.from}: ${left.map(describeRef).join(', ')}`);
  const now = after.range(to, to + 1).map(describeRef);
  for (const label of r.references) if (!now.includes(label)) throw new Error(`${r.id}: ${label} does not reach ${r.to} after patching`);
}
if (output.length !== input.length) throw new Error('Executable size changed');

report.pools = POOLS.map(p => ({ start: hex(p.start), end: hex(p.end), used: p.next - p.start, free: p.end - p.next }));
report.sha256 = crypto.createHash('sha256').update(output).digest('hex');
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, output);
if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ relocated: report.relocations.length, strings: placed.size, pools: report.pools, sha256: report.sha256 }, null, 2));
