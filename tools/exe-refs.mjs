// Static reference index for SLPS_022.33-style PS-X EXEs.
//
// Finds every place that forms an address inside the loaded payload:
//   - ptr:  aligned 32-bit data words whose value lies in the payload
//   - pair: lui rX,hi followed (linearly, before rX is overwritten) by
//           addiu/ori/load/store using rX as the base
//   - gp:   instructions using $gp as the base register
// The scan is deliberately over-inclusive (any aligned word in range counts
// as a pointer) so that "nothing references these bytes" is a conservative
// statement. It is static analysis only; it cannot see addresses computed
// from a table base plus a runtime index.
import { parseExe, decode, LOADS, STORES } from './mips.mjs';

export const GP_VALUE = 0x80104d08; // set at 0x80079D40 (see RESEARCH.md)
const LOOKAHEAD = 64;

export function scanReferences(data, { gp = GP_VALUE } = {}) {
  const exe = parseExe(data);
  const count = Math.floor(Math.min(exe.size, data.length - 0x800) / 4);
  const words = new Uint32Array(count);
  for (let i = 0; i < count; i++) words[i] = data.readUInt32LE(0x800 + i * 4) >>> 0;
  const at = i => (exe.load + i * 4) >>> 0;
  const inPayload = v => v >= exe.load && v < exe.end;
  const refs = [];

  for (let i = 0; i < count; i++) {
    const word = words[i];
    if (inPayload(word)) refs.push({ kind: 'ptr', site: at(i), target: word });
    const ins = decode(word, at(i));
    if (ins.rs === 28 && ins.op >= 0x08 && ins.name !== 'lui' && ins.target === undefined && ins.name !== 'unknown') {
      const target = (gp + ins.simm) >>> 0;
      if (inPayload(target)) refs.push({ kind: 'gp', site: at(i), target, use: ins.name, access: accessKind(ins.name) });
    }
    if (ins.name !== 'lui') continue;
    const reg = ins.rt;
    if (reg === 0) continue;
    let value = (ins.imm << 16) >>> 0;
    let stopAfter = Infinity;
    const uses = [];
    for (let k = i + 1; k < Math.min(count, i + 1 + LOOKAHEAD) && k <= stopAfter; k++) {
      const next = decode(words[k], at(k));
      const usesReg = next.rs === reg && (next.name === 'addiu' || next.name === 'ori' || LOADS.has(next.name) || STORES.has(next.name));
      if (usesReg) {
        const target = next.name === 'ori' ? (value | next.imm) >>> 0 : (value + next.simm) >>> 0;
        uses.push({ site: at(k), target, use: next.name, access: accessKind(next.name) });
        if (next.writes === reg) {
          if (next.name === 'addiu') { value = target; uses[uses.length - 1].rebases = true; continue; }
          break;
        }
        continue;
      }
      if (next.writes === reg) break;
      if (next.target !== undefined || next.name === 'jr' || next.name === 'jalr') {
        // Linear scan stops after an unconditional transfer's delay slot.
        if ((next.name === 'j' || next.name === 'jr') && stopAfter === Infinity) stopAfter = k + 1;
      }
    }
    for (const use of uses) {
      if (!inPayload(use.target)) continue;
      refs.push({ kind: 'pair', site: use.site, lui: at(i), target: use.target, use: use.use, access: use.access, rebases: !!use.rebases, sharedLui: uses.length > 1 });
    }
  }
  return { exe, refs };
}

function accessKind(name) {
  if (LOADS.has(name)) return 'load';
  if (STORES.has(name)) return 'store';
  return 'address';
}

// Code reachable from the entry point and from every address that any
// reference forms inside [codeStart, codeEnd). Over-inclusive roots (every
// aligned data word in range counts as a function pointer or jump-table
// entry) make "unreached" a conservative claim. Returns a predicate.
export function reachableCode(data, refs, codeStart, codeEnd) {
  const exe = parseExe(data);
  const inCode = a => a >= codeStart && a < codeEnd;
  const reached = new Uint8Array((codeEnd - codeStart) >>> 2);
  const ix = a => (a - codeStart) >>> 2;
  const word = a => data.readUInt32LE(exe.offsetOf(a)) >>> 0;
  const work = [exe.entry];
  for (const r of refs) if ((r.kind === 'ptr' || r.access === 'address') && (r.target & 3) === 0 && inCode(r.target)) work.push(r.target);
  while (work.length) {
    let a = work.pop();
    while (inCode(a) && !reached[ix(a)]) {
      const ins = decode(word(a), a);
      reached[ix(a)] = 1;
      if (ins.target !== undefined && inCode(ins.target)) work.push(ins.target);
      if (ins.name === 'j' || ins.name === 'jr') { if (inCode(a + 4)) reached[ix(a + 4)] = 1; break; }
      a += 4;
    }
  }
  return a => inCode(a) && reached[ix(a)] === 1;
}

// Index refs by target for range queries.
export function indexByTarget(refs) {
  const sorted = [...refs].sort((a, b) => a.target - b.target);
  const targets = Uint32Array.from(sorted, r => r.target);
  const lowerBound = v => { let lo = 0, hi = targets.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (targets[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
  return {
    // refs whose target is in [start, end)
    range(start, end) { const out = []; for (let i = lowerBound(start); i < sorted.length && sorted[i].target < end; i++) out.push(sorted[i]); return out; },
  };
}

export const hex = v => `0x${(v >>> 0).toString(16)}`;
export const describeRef = r => r.kind === 'ptr' ? `ptr:${hex(r.site)}` : r.kind === 'gp' ? `gp:${hex(r.site)}` : `pair:${hex(r.lui)}+${hex(r.site)}`;
