#!/usr/bin/env node
// Opt-in per-window glyph budget patch for SLPS_022.33.
//
//   node tools/window-budget-patch.mjs <SLPS_022.33> <budgets.json> <output> [report.json]
//
// Each call to the glyph-cache builder 0x80079E28 passes a window budget as
// its 8th argument (sp+28). On the window's first use the builder reserves
// that many slots from a 256-slot pool (counter $gp+2804) and keeps the value
// in the window record (byte 34 of the 36-byte record at 0x80111708). A
// window shows at most budget-1 glyphs. If the pool counter would reach 256,
// the builder disables the window instead (0x80079F24-0x80079F44), so a
// raised budget must be checked against the pool on the screen that uses it.
//
// budgets.json:
//   { "format": "spectral-force-window-budgets-v1", "items": [
//     { "call": "0x80085d48",   // jal 0x80079E28
//       "set":  "0x80085d2c",   // ori rX,zero,<from> that feeds sw rX,28(sp)
//       "window": 3,            // constant a2 (window index) at the call
//       "from": 18, "to": 28,
//       "pool": "...", "runtime": "..." } ] }   // evidence notes, not read
//
// The patch fails, writing nothing, when:
//   - the executable is not the expected revision,
//   - `call` is not jal 0x80079E28, or its window index is not `window`,
//   - the straight-line budget store before `call` is not fed by `set`, or
//     `set` is not `ori/addiu rX,zero,<from>`,
//   - a branch, jump or data pointer lands between `set` and `call` (another
//     path could reach the call with a different budget),
//   - `set` also feeds another builder call or is listed twice,
//   - `to` is not 1..255 (the record stores it in one byte).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseExe, decode, format } from './mips.mjs';
import { scanReferences, hex } from './exe-refs.mjs';
import { BUILDER, budgetAt, lastWrite } from './glyph-budget.mjs';

const CODE_START = 0x80031440;
const CODE_END = 0x800c8ae4;

export function patchBudgets(input, budgets) {
  if (budgets.format !== 'spectral-force-window-budgets-v1' || !Array.isArray(budgets.items)) throw new Error('Unsupported budgets file');
  const exe = parseExe(input);
  if (exe.load !== 0x80010000 || input.length !== 1007616) throw new Error('Unexpected executable revision');
  const count = exe.size / 4;
  const words = new Uint32Array(count);
  for (let i = 0; i < count; i++) words[i] = input.readUInt32LE(0x800 + i * 4) >>> 0;
  const base = exe.load;
  const indexOf = a => (a - base) >>> 2;

  // Everything that can transfer control into the middle of a sequence.
  const landings = new Set();
  for (let a = CODE_START; a < CODE_END; a += 4) {
    const ins = decode(words[indexOf(a)], a);
    if (ins.target !== undefined) landings.add(ins.target);
  }
  for (const r of scanReferences(input).refs) if (r.kind === 'ptr' && r.target >= CODE_START && r.target < CODE_END) landings.add(r.target);

  // Map every budget-setting instruction to the builder calls it feeds.
  const feeds = new Map();
  for (let i = 0; i < count; i++) {
    const ins = decode(words[i], base + i * 4);
    if (ins.name !== 'jal' || ins.target !== BUILDER) continue;
    const { store } = budgetAt(words, base, i);
    if (store == null) continue;
    const sw = decode(words[store], base + store * 4);
    const w = sw.rt === 0 ? null : lastWrite(words, base, store, sw.rt, 24);
    if (!w) continue;
    const key = base + w.k * 4;
    feeds.set(key, [...(feeds.get(key) ?? []), base + i * 4]);
  }

  const output = Buffer.from(input);
  const seen = new Set();
  const report = [];
  for (const item of budgets.items) {
    const call = Number(item.call) >>> 0;
    const set = Number(item.set) >>> 0;
    const name = `${hex(call)} (set ${hex(set)})`;
    if (!Number.isInteger(item.from) || !Number.isInteger(item.to) || item.to < 1 || item.to > 255) throw new Error(`${name}: "to" must be 1..255`);
    if (item.to === item.from) throw new Error(`${name}: "to" equals "from"`);
    if (seen.has(set) || seen.has(call)) throw new Error(`${name}: listed twice`);
    seen.add(set); seen.add(call);
    if (call < CODE_START || call >= CODE_END || set >= call || call - set > 48 * 4) throw new Error(`${name}: addresses out of range`);
    const ci = indexOf(call);
    const jal = decode(words[ci], call);
    if (jal.name !== 'jal' || jal.target !== BUILDER) throw new Error(`${name}: ${hex(call)} is ${format(jal)}, not jal ${hex(BUILDER)}`);
    // Window index: a2 in the delay slot or the last write before the call.
    const delay = decode(words[ci + 1], call + 4);
    const a2 = delay.writes === 6 ? { ins: delay } : lastWrite(words, base, ci, 6);
    const windowIndex = !a2 ? null
      : (a2.ins.name === 'ori' && a2.ins.rs === 0) ? a2.ins.imm
      : (a2.ins.name === 'addu' && a2.ins.rs === 0 && a2.ins.rt === 0) ? 0 : null;
    if (windowIndex !== item.window) throw new Error(`${name}: window index is not ${item.window} (${a2 ? format(a2.ins) : 'unknown'})`);
    const { store } = budgetAt(words, base, ci);
    if (store == null) throw new Error(`${name}: no straight-line budget store before the call`);
    const sw = decode(words[store], base + store * 4);
    const w = sw.rt === 0 ? null : lastWrite(words, base, store, sw.rt, 24);
    if (!w || base + w.k * 4 !== set) throw new Error(`${name}: the budget store ${hex(base + store * 4)} is not fed by ${hex(set)}`);
    const ins = w.ins;
    if (!((ins.name === 'ori' || ins.name === 'addiu') && ins.rs === 0 && ins.rt === sw.rt)) throw new Error(`${name}: ${hex(set)} is ${format(ins)}, not a constant budget`);
    const value = ins.name === 'ori' ? ins.imm : ins.simm;
    if (value !== item.from) throw new Error(`${name}: original budget is ${value}, expected ${item.from} (${format(ins)})`);
    for (let a = set + 4; a <= call; a += 4) if (landings.has(a)) throw new Error(`${name}: control can enter at ${hex(a)}, between the budget and the call`);
    const users = feeds.get(set) ?? [];
    if (users.length !== 1 || users[0] !== call) throw new Error(`${name}: ${hex(set)} feeds builder calls ${users.map(hex).join(', ')}`);
    const word = ((words[indexOf(set)] & 0xffff0000) | item.to) >>> 0;
    output.writeUInt32LE(word, exe.offsetOf(set));
    report.push({ call: hex(call), set: hex(set), window: item.window, from: item.from, to: item.to, before: format(ins), after: format(decode(word, set)) });
  }

  // Re-read the patched budgets the same way the report tool does.
  const after = new Uint32Array(count);
  for (let i = 0; i < count; i++) after[i] = output.readUInt32LE(0x800 + i * 4) >>> 0;
  for (const r of report) {
    const got = budgetAt(after, base, indexOf(Number(r.call))).value;
    if (got !== r.to) throw new Error(`${r.call}: budget reads ${got} after patching, expected ${r.to}`);
  }
  let changed = 0;
  for (let i = 0; i < output.length; i++) if (output[i] !== input[i]) changed++;
  if (output.length !== input.length) throw new Error('Executable size changed');
  return { output, report, changedBytes: changed };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [exePath, budgetsPath, outputPath, reportPath] = process.argv.slice(2);
  if (!exePath || !budgetsPath || !outputPath) {
    console.error('Usage: node tools/window-budget-patch.mjs <SLPS_022.33> <budgets.json> <output> [report.json]');
    process.exit(2);
  }
  if (path.resolve(exePath) === path.resolve(outputPath)) throw new Error('Refusing to overwrite the input executable');
  const input = fs.readFileSync(exePath);
  const { output, report, changedBytes } = patchBudgets(input, JSON.parse(fs.readFileSync(budgetsPath, 'utf8')));
  const summary = { patched: report.length, changedBytes, windows: report, sha256: crypto.createHash('sha256').update(output).digest('hex') };
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, output);
  if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}
