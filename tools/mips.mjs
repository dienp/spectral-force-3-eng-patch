// Minimal MIPS I (R3000A) decoder and PS-X EXE helpers shared by the analysis
// and relocation tools. Decoding only; it does not try to be a full
// disassembler (COP2/GTE operations are reported as "cop2").
export const REGS = [
  'zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3',
  't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
  't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra',
];

export const signed16 = value => (value << 16) >> 16;

export function parseExe(data) {
  if (data.length < 0x800 || data.subarray(0, 8).toString('ascii') !== 'PS-X EXE') throw new Error('Input is not a PS-X EXE');
  const load = data.readUInt32LE(0x18) >>> 0;
  const size = data.readUInt32LE(0x1c) >>> 0;
  return {
    load,
    size,
    entry: data.readUInt32LE(0x10) >>> 0,
    end: (load + size) >>> 0,
    offsetOf: address => address - load + 0x800,
    addressOf: offset => (load + offset - 0x800) >>> 0,
  };
}

const I_OPS = {
  0x04: 'beq', 0x05: 'bne', 0x06: 'blez', 0x07: 'bgtz',
  0x08: 'addi', 0x09: 'addiu', 0x0a: 'slti', 0x0b: 'sltiu', 0x0c: 'andi', 0x0d: 'ori', 0x0e: 'xori', 0x0f: 'lui',
  0x20: 'lb', 0x21: 'lh', 0x22: 'lwl', 0x23: 'lw', 0x24: 'lbu', 0x25: 'lhu', 0x26: 'lwr',
  0x28: 'sb', 0x29: 'sh', 0x2a: 'swl', 0x2b: 'sw', 0x2e: 'swr',
  0x32: 'lwc2', 0x3a: 'swc2',
};
const R_OPS = {
  0x00: 'sll', 0x02: 'srl', 0x03: 'sra', 0x04: 'sllv', 0x06: 'srlv', 0x07: 'srav',
  0x08: 'jr', 0x09: 'jalr', 0x0c: 'syscall', 0x0d: 'break',
  0x10: 'mfhi', 0x11: 'mthi', 0x12: 'mflo', 0x13: 'mtlo',
  0x18: 'mult', 0x19: 'multu', 0x1a: 'div', 0x1b: 'divu',
  0x20: 'add', 0x21: 'addu', 0x22: 'sub', 0x23: 'subu', 0x24: 'and', 0x25: 'or', 0x26: 'xor', 0x27: 'nor',
  0x2a: 'slt', 0x2b: 'sltu',
};
export const LOADS = new Set(['lb', 'lh', 'lwl', 'lw', 'lbu', 'lhu', 'lwr', 'lwc2']);
export const STORES = new Set(['sb', 'sh', 'swl', 'sw', 'swr', 'swc2']);
export const ACCESS_SIZE = { lb: 1, lbu: 1, sb: 1, lh: 2, lhu: 2, sh: 2, lw: 4, sw: 4, lwl: 4, lwr: 4, swl: 4, swr: 4, lwc2: 4, swc2: 4 };

export function decode(word, address) {
  const op = word >>> 26;
  const rs = (word >>> 21) & 31;
  const rt = (word >>> 16) & 31;
  const rd = (word >>> 11) & 31;
  const shamt = (word >>> 6) & 31;
  const funct = word & 63;
  const imm = word & 0xffff;
  const simm = signed16(imm);
  const base = { word, address, op, rs, rt, rd, shamt, funct, imm, simm };
  if (op === 0) {
    const name = R_OPS[funct] ?? 'unknown';
    // Register written by the instruction, if any.
    const writes = ['jr', 'syscall', 'break', 'mthi', 'mtlo', 'mult', 'multu', 'div', 'divu'].includes(name) ? null : rd;
    return { ...base, name, writes };
  }
  if (op === 1) {
    const names = { 0: 'bltz', 1: 'bgez', 0x10: 'bltzal', 0x11: 'bgezal' };
    return { ...base, name: names[rt] ?? 'unknown', target: (address + 4 + (simm << 2)) >>> 0, writes: rt >= 0x10 ? 31 : null };
  }
  if (op === 2 || op === 3) {
    const target = (((address + 4) & 0xf0000000) | ((word & 0x03ffffff) << 2)) >>> 0;
    return { ...base, name: op === 2 ? 'j' : 'jal', target, writes: op === 3 ? 31 : null };
  }
  if (op === 0x10 || op === 0x12) {
    const writes = op === 0x10 && (rs === 0 || rs === 2) ? rt : (op === 0x12 && (rs === 0 || rs === 2) ? rt : null);
    return { ...base, name: op === 0x10 ? 'cop0' : 'cop2', writes };
  }
  const name = I_OPS[op] ?? 'unknown';
  const out = { ...base, name };
  if (['beq', 'bne', 'blez', 'bgtz'].includes(name)) { out.target = (address + 4 + (simm << 2)) >>> 0; out.writes = null; }
  else if (STORES.has(name) || name === 'lwc2') out.writes = null;
  else out.writes = rt;
  return out;
}

export function format(ins) {
  const r = REGS;
  const { name } = ins;
  if (ins.word === 0) return 'nop';
  if (name === 'lui') return `lui ${r[ins.rt]},0x${ins.imm.toString(16)}`;
  if (LOADS.has(name) || STORES.has(name)) return `${name} ${r[ins.rt]},${ins.simm}(${r[ins.rs]})`;
  if (['addi', 'addiu', 'slti', 'sltiu'].includes(name)) return `${name} ${r[ins.rt]},${r[ins.rs]},${ins.simm}`;
  if (['andi', 'ori', 'xori'].includes(name)) return `${name} ${r[ins.rt]},${r[ins.rs]},0x${ins.imm.toString(16)}`;
  if (['beq', 'bne'].includes(name)) return `${name} ${r[ins.rs]},${r[ins.rt]},0x${ins.target.toString(16)}`;
  if (['blez', 'bgtz', 'bltz', 'bgez', 'bltzal', 'bgezal'].includes(name)) return `${name} ${r[ins.rs]},0x${ins.target.toString(16)}`;
  if (name === 'j' || name === 'jal') return `${name} 0x${ins.target.toString(16)}`;
  if (['sll', 'srl', 'sra'].includes(name)) return `${name} ${r[ins.rd]},${r[ins.rt]},${ins.shamt}`;
  if (name === 'jr') return `jr ${r[ins.rs]}`;
  if (name === 'jalr') return `jalr ${r[ins.rd]},${r[ins.rs]}`;
  if (['mfhi', 'mflo'].includes(name)) return `${name} ${r[ins.rd]}`;
  if (['mthi', 'mtlo'].includes(name)) return `${name} ${r[ins.rs]}`;
  if (['mult', 'multu', 'div', 'divu'].includes(name)) return `${name} ${r[ins.rs]},${r[ins.rt]}`;
  if (R_OPS[ins.funct] && ins.op === 0) return `${name} ${r[ins.rd]},${r[ins.rs]},${r[ins.rt]}`;
  return `${name} 0x${ins.word.toString(16).padStart(8, '0')}`;
}

export const isBranchOrJump = ins => ins.target !== undefined || ins.name === 'jr' || ins.name === 'jalr';
