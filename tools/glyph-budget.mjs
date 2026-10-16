#!/usr/bin/env node
// Glyph-slot budget analysis for the message glyph-cache builder 0x80079E28.
//
// Each call passes a per-window glyph budget as its 8th argument (sp+28 at
// the call). The builder counts one slot per drawn glyph; when the count
// reaches the budget it draws the overflow marker (0x80105334) instead and
// stops (check at 0x8007A1B8-0x8007A1E8: `count < budget` draws normally).
// So a window shows at most budget-1 glyphs. `#` codes use no slot.
// With tools/ascii-font-patch.mjs, two printable ASCII bytes share one slot
// when their advances total 15 px or less.
//
//   node tools/glyph-budget.mjs <patched SLPS_022.33> <memory.en.json> [report.json] [--relocations=<file>]
//
// The patched executable supplies the ASCII metric table written by
// ascii-font-patch.mjs. With --relocations, the relocated texts are measured
// instead of the in-place translations for the locations they repoint.
import fs from 'node:fs';
import { parseExe, decode, format, REGS } from './mips.mjs';
import { scanReferences, indexByTarget, hex } from './exe-refs.mjs';

export const BUILDER = 0x80079e28;
export const STRCPY = 0x800a7ac4;
export const STRCAT = 0x800a7a14;
const METRICS = 0x800c3e4c + 190; // left<<4 | advance for 0x20..0x7E (ascii-font-patch.mjs)
const LOOKUP_HOOK = 0x800c3cc4;
const MAX_PAIR = 15;

export function asciiMetrics(data) {
  const exe = parseExe(data);
  const hook = decode(data.readUInt32LE(exe.offsetOf(0x8007a1f8)) >>> 0, 0x8007a1f8);
  if (hook.name !== 'jal' || hook.target !== LOOKUP_HOOK) throw new Error('Executable does not carry the ASCII font patch (0x8007A1F8 is not jal 0x800C3CC4)');
  const table = data.subarray(exe.offsetOf(METRICS), exe.offsetOf(METRICS) + 95);
  return Array.from(table, v => v & 0x0f);
}

// Number of glyph slots the patched builder uses for a byte string.
export function countGlyphs(bytes, advances) {
  let slots = 0;
  for (let i = 0; i < bytes.length && bytes[i] !== 0;) {
    const b = bytes[i];
    if (b === 0x23) { i += 2; continue; }             // '#' + code: no glyph
    if (b >= 0x80) { slots++; i += 2; continue; }     // Shift-JIS character
    const printable = c => c >= 0x20 && c < 0x7f;
    const next = bytes[i + 1] ?? 0;
    const adv = c => advances[(printable(c) ? c : 0x20) - 0x20];
    if (printable(next) && next !== 0x23 && adv(b) + adv(next) <= MAX_PAIR) { slots++; i += 2; continue; }
    slots++; i += 1;
  }
  return slots;
}

const encoder = (() => {
  const decoder = new TextDecoder('shift_jis');
  const map = new Map();
  for (let b = 0x20; b <= 0x7e; b++) map.set(String.fromCharCode(b), Buffer.from([b]));
  for (const range of [[0x81, 0x9f], [0xe0, 0xef]]) for (let lead = range[0]; lead <= range[1]; lead++) for (let trail = 0x40; trail <= 0xfc; trail++) {
    if (trail === 0x7f) continue;
    try { const s = decoder.decode(Buffer.from([lead, trail])); if (s && s !== '�' && !map.has(s)) map.set(s, Buffer.from([lead, trail])); } catch {}
  }
  return text => Buffer.concat([...text].map(ch => { const b = map.get(ch); if (!b) throw new Error(`Not encodable: ${JSON.stringify(ch)}`); return b; }));
})();
export const encodeSjis = encoder;

// Last instruction before `index` (searching back at most `limit` words, not
// crossing another call) that writes `reg`.
export function lastWrite(words, base, index, reg, limit = 48) {
  for (let k = index - 1; k >= Math.max(0, index - limit); k--) {
    const ins = decode(words[k], base + k * 4);
    if (ins.writes === reg) return { k, ins };
    if (ins.name === 'jal' && reg >= 4 && reg <= 15) return null; // caller-saved register clobbered by a call
  }
  return null;
}

function constantOf(words, base, k, ins) {
  if ((ins.name === 'ori' || ins.name === 'addiu') && ins.rs === 0) return ins.name === 'ori' ? ins.imm : ins.simm;
  if ((ins.name === 'addiu' || ins.name === 'ori') && ins.rs === ins.rt) {
    const lui = lastWrite(words, base, k, ins.rs, 8);
    if (lui && lui.ins.name === 'lui') return ins.name === 'ori' ? (((lui.ins.imm << 16) | ins.imm) >>> 0) : (((lui.ins.imm << 16) + ins.simm) >>> 0);
  }
  if (ins.name === 'addiu' && ins.rs === 28) return { gp: ins.simm };
  return null;
}

// Argument value at a call: delay slot first, then backwards.
function argAt(words, base, callIndex, reg) {
  const delay = decode(words[callIndex + 1], base + (callIndex + 1) * 4);
  let hit = delay.writes === reg ? { k: callIndex + 1, ins: delay } : lastWrite(words, base, callIndex, reg);
  if (!hit) return { kind: 'unknown' };
  const { k, ins } = hit;
  if (ins.name === 'addiu' && ins.rs === 29) return { kind: 'stack', offset: ins.simm };
  const c = constantOf(words, base, k, ins);
  if (typeof c === 'number') return { kind: 'const', value: c >>> 0 };
  if (c && c.gp !== undefined) return { kind: 'gp', offset: c.gp };
  return { kind: 'register', note: format(ins), site: base + k * 4 };
}

// Budget stored at sp+28 on the straight-line path ending at `index`.
// Returns { value, store } where store is the index of the sw (or null).
export function budgetAt(words, base, index) {
  for (let k = index - 1; k >= Math.max(0, index - 48); k--) {
    const ins = decode(words[k], base + k * 4);
    if (ins.name === 'sw' && ins.rs === 29 && ins.simm === 28) {
      if (ins.rt === 0) return { value: 0, store: k };
      const w = lastWrite(words, base, k, ins.rt, 24);
      if (w) { const c = constantOf(words, base, w.k, w.ins); if (typeof c === 'number') return { value: c, store: k }; }
      return { value: null, store: k };
    }
    if (ins.name === 'jal') break;
  }
  return { value: null, store: null };
}

export function analyzeWindows(data, memory, { relocations = null, gp = 0x80104d08 } = {}) {
  const exe = parseExe(data);
  const count = exe.size / 4;
  const words = new Uint32Array(count);
  for (let i = 0; i < count; i++) words[i] = data.readUInt32LE(0x800 + i * 4) >>> 0;
  const base = exe.load;
  const advances = asciiMetrics(data);
  const byAddress = new Map();
  for (const item of memory.items) for (const loc of item.locations) if (loc.target === 'SLPS_022.33' && loc.address) byAddress.set(Number(loc.address) >>> 0, { item, loc });
  const textFor = address => {
    const hit = byAddress.get(address >>> 0);
    const off = exe.offsetOf(address);
    const original = data.subarray(off, data.indexOf(0, off));
    if (!hit) return { address: hex(address), id: null, jpGlyphs: countGlyphs(original, advances), enGlyphs: null };
    const reloc = relocations?.items?.[hit.item.id];
    const english = reloc?.references?.[hit.loc.address] ? reloc.text : hit.item.translation;
    const jp = encoder(hit.item.original);
    const en = english ? encoder(english) : jp;
    return { address: hex(address), id: hit.item.id, original: hit.item.original, english, jpGlyphs: countGlyphs(jp, advances), enGlyphs: countGlyphs(en, advances) };
  };
  const calls = [];
  for (let i = 0; i < count; i++) {
    const ins = decode(words[i], base + i * 4);
    if (ins.name === 'jal' && ins.target === BUILDER) calls.push(i);
  }
  // Several screens set their own budget and then jump into one shared
  // builder call (for example 0x80042C58: j 0x800436D0 with budget 130).
  // Each such jump is a separate entry with its own budget and strings.
  const landing = new Map(); // index -> call index, for (budget store, call]
  const storeOf = new Map();
  for (const i of calls) {
    const { store } = budgetAt(words, base, i);
    storeOf.set(i, store);
    for (let k = (store ?? i - 1) + 1; k <= i; k++) landing.set(k, i);
  }
  const entriesOf = new Map(calls.map(i => [i, [{ from: i, via: null }]]));
  const entryJumps = new Set();
  for (let k = 0; k < count; k++) {
    const ins = decode(words[k], base + k * 4);
    if (ins.name !== 'j' || ins.target === undefined) continue;
    const t = (ins.target - base) >>> 2;
    if (!landing.has(t) || landing.get(t) === k) continue;
    entriesOf.get(landing.get(t)).push({ from: k, via: hex(base + k * 4) });
    entryJumps.add(k);
  }
  const callSet = new Set(calls);
  const windows = [];
  for (const i of calls) for (const { from, via } of entriesOf.get(i)) {
    const site = base + i * 4;
    const budget = budgetAt(words, base, from).value;
    const a0 = argAt(words, base, i, 4);
    const windowIndex = argAt(words, base, i, 6);
    const entry = { site: hex(site), via, budget, window: windowIndex.kind === 'const' ? windowIndex.value : null, source: a0.kind };
    if (a0.kind === 'const') entry.strings = [textFor(a0.value)];
    else if (a0.kind === 'gp') entry.strings = [textFor((gp + a0.offset) >>> 0)];
    else if (a0.kind === 'stack') {
      // Strings copied into the same stack buffer on the way to this entry,
      // back to the previous builder call or jump into another builder call.
      entry.buffer = `sp+${a0.offset}`;
      let prev = from - 1;
      while (prev > Math.max(0, from - 4096) && !callSet.has(prev) && !entryJumps.has(prev)) prev--;
      // Branches often pick one of several a1 values before a shared strcat,
      // so every constant loaded into a1 in this stretch is listed as well.
      // The list is a static approximation: loops and runtime strings
      // (names, numbers) are not expanded.
      const parts = [];
      const seen = new Set();
      for (let k = prev + 1; k < from; k++) {
        const c = decode(words[k], base + k * 4);
        if ((c.name === 'addiu' || c.name === 'ori') && c.rt === 5 && (c.rs === 5 || c.rs === 28)) {
          const v = c.rs === 28 ? (gp + c.simm) >>> 0 : constantOf(words, base, k, c);
          if (typeof v === 'number' && byAddress.has(v >>> 0) && !seen.has(k)) { seen.add(k); parts.push({ load: hex(base + k * 4), ...textFor(v >>> 0) }); }
          continue;
        }
        if (c.name !== 'jal' || (c.target !== STRCAT && c.target !== STRCPY)) continue;
        const dst = argAt(words, base, k, 4);
        if (dst.kind !== 'stack' || dst.offset !== a0.offset) continue;
        const src = argAt(words, base, k, 5);
        if (src.kind === 'const' || src.kind === 'gp') {
          const v = src.kind === 'gp' ? (gp + src.offset) >>> 0 : src.value;
          if (!byAddress.has(v >>> 0) && v >= exe.load && v < exe.end) parts.push({ call: hex(base + k * 4), ...textFor(v) });
        } else parts.push({ call: hex(base + k * 4), dynamic: src.kind === 'stack' ? `sp+${src.offset}` : (src.note ?? src.kind) });
      }
      entry.strings = parts;
    }
    const known = (entry.strings ?? []).filter(s => s.jpGlyphs !== undefined);
    entry.growth = known.reduce((t, s) => t + ((s.enGlyphs ?? s.jpGlyphs) - s.jpGlyphs), 0);
    if (a0.kind === 'const' || a0.kind === 'gp') {
      const s = entry.strings[0];
      entry.used = s.enGlyphs ?? s.jpGlyphs;
      entry.free = budget == null ? null : budget - 1 - entry.used;
      entry.status = budget == null ? 'unknown-budget' : entry.free < 0 ? 'OVERFLOW' : entry.free <= 1 ? 'tight' : 'ok';
    } else {
      entry.status = entry.growth > 0 ? 'grows' : 'dynamic';
    }
    windows.push(entry);
  }
  return windows;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const relocArg = process.argv.find(a => a.startsWith('--relocations='));
  const relocations = relocArg ? JSON.parse(fs.readFileSync(relocArg.slice('--relocations='.length), 'utf8')) : null;
  const [exePath, memoryPath, reportPath] = args;
  if (!exePath || !memoryPath) {
    console.error('Usage: node tools/glyph-budget.mjs <patched SLPS_022.33> <memory.en.json> [report.json] [--relocations=<file>]');
    process.exit(2);
  }
  const windows = analyzeWindows(fs.readFileSync(exePath), JSON.parse(fs.readFileSync(memoryPath, 'utf8')), { relocations });
  const summary = {};
  for (const w of windows) summary[w.status] = (summary[w.status] ?? 0) + 1;
  if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify({ relocations: !!relocations, summary, windows }, null, 2)}\n`);
  console.log(JSON.stringify(summary));
  for (const w of windows.filter(w => w.status === 'OVERFLOW' || w.status === 'tight' || w.status === 'grows')) {
    const text = (w.strings ?? []).map(s => s.dynamic ? `<${s.dynamic}>` : `${s.id ?? s.address}:${JSON.stringify(s.english ?? s.original ?? '')}(${s.jpGlyphs}->${s.enGlyphs ?? s.jpGlyphs})`).join(' + ');
    console.log(`${w.status.padEnd(8)} ${w.site} budget=${w.budget} ${w.used !== undefined ? `used=${w.used} free=${w.free}` : `growth=${w.growth}`} ${text}`);
  }
}
