#!/usr/bin/env node
import fs from 'node:fs';

const [inputPath, targetArg] = process.argv.slice(2);
if (!inputPath || !targetArg) {
  console.error('Usage: node tools/mips-xrefs.mjs <PS-X-EXE> <target-address>');
  process.exit(2);
}

const data = fs.readFileSync(inputPath);
if (data.length < 0x800 || data.subarray(0, 8).toString('ascii') !== 'PS-X EXE') {
  throw new Error('Input is not a PS-X EXE');
}

const loadAddress = data.readUInt32LE(0x18) >>> 0;
const payloadSize = data.readUInt32LE(0x1c) >>> 0;
const payloadStart = 0x800;
const payloadEnd = Math.min(data.length, payloadStart + payloadSize);
const target = Number.parseInt(targetArg, 0) >>> 0;
const registers = [
  'zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3',
  't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
  't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra',
];

function signed16(value) {
  return (value << 16) >> 16;
}

function addressOf(offset) {
  return (loadAddress + offset - payloadStart) >>> 0;
}

function decode(word, address) {
  const op = word >>> 26;
  const rs = (word >>> 21) & 31;
  const rt = (word >>> 16) & 31;
  const rd = (word >>> 11) & 31;
  const shamt = (word >>> 6) & 31;
  const funct = word & 63;
  const imm = word & 0xffff;
  const simm = signed16(imm);
  const branch = (address + 4 + (simm << 2)) >>> 0;
  const jump = (((address + 4) & 0xf0000000) | ((word & 0x03ffffff) << 2)) >>> 0;
  const r = registers;
  if (word === 0) return 'nop';
  if (op === 0x0f) return `lui ${r[rt]},0x${imm.toString(16)}`;
  if (op === 0x09) return `addiu ${r[rt]},${r[rs]},${simm}`;
  if (op === 0x0d) return `ori ${r[rt]},${r[rs]},0x${imm.toString(16)}`;
  if (op === 0x0c) return `andi ${r[rt]},${r[rs]},0x${imm.toString(16)}`;
  if (op === 0x0a) return `slti ${r[rt]},${r[rs]},${simm}`;
  if (op === 0x23) return `lw ${r[rt]},${simm}(${r[rs]})`;
  if (op === 0x24) return `lbu ${r[rt]},${simm}(${r[rs]})`;
  if (op === 0x25) return `lhu ${r[rt]},${simm}(${r[rs]})`;
  if (op === 0x28) return `sb ${r[rt]},${simm}(${r[rs]})`;
  if (op === 0x29) return `sh ${r[rt]},${simm}(${r[rs]})`;
  if (op === 0x2b) return `sw ${r[rt]},${simm}(${r[rs]})`;
  if (op === 0x04) return `beq ${r[rs]},${r[rt]},0x${branch.toString(16)}`;
  if (op === 0x05) return `bne ${r[rs]},${r[rt]},0x${branch.toString(16)}`;
  if (op === 0x02) return `j 0x${jump.toString(16)}`;
  if (op === 0x03) return `jal 0x${jump.toString(16)}`;
  if (op === 0 && funct === 0x21) return `addu ${r[rd]},${r[rs]},${r[rt]}`;
  if (op === 0 && funct === 0x23) return `subu ${r[rd]},${r[rs]},${r[rt]}`;
  if (op === 0 && funct === 0x08) return `jr ${r[rs]}`;
  if (op === 0 && funct === 0x00) return `sll ${r[rd]},${r[rt]},${shamt}`;
  if (op === 0 && funct === 0x02) return `srl ${r[rd]},${r[rt]},${shamt}`;
  return `.word 0x${word.toString(16).padStart(8, '0')}`;
}

function constantFromPair(luiWord, lowWord) {
  const luiRt = (luiWord >>> 16) & 31;
  const op = lowWord >>> 26;
  const rs = (lowWord >>> 21) & 31;
  const rt = (lowWord >>> 16) & 31;
  if (rs !== luiRt || rt !== luiRt) return null;
  const high = (luiWord & 0xffff) << 16;
  if (op === 0x09) return (high + signed16(lowWord & 0xffff)) >>> 0;
  if (op === 0x0d) return (high | (lowWord & 0xffff)) >>> 0;
  return null;
}

const matches = [];
for (let offset = payloadStart; offset + 4 <= payloadEnd; offset += 4) {
  const word = data.readUInt32LE(offset) >>> 0;
  if ((word >>> 26) !== 0x0f) continue;
  const rt = (word >>> 16) & 31;
  for (let ahead = 1; ahead <= 12 && offset + ahead * 4 + 4 <= payloadEnd; ahead++) {
    const nextOffset = offset + ahead * 4;
    const next = data.readUInt32LE(nextOffset) >>> 0;
    const nextRt = (next >>> 16) & 31;
    const nextRs = (next >>> 21) & 31;
    const op = next >>> 26;
    const value = constantFromPair(word, next);
    if (value === target) {
      matches.push({ offset, nextOffset, register: registers[rt], gapInstructions: ahead - 1 });
      break;
    }
    if (nextRt === rt && !(op === 0x09 || op === 0x0d) && nextRs !== rt) break;
  }
}

const pointerBytes = Buffer.alloc(4);
pointerBytes.writeUInt32LE(target);
const literalOffsets = [];
for (let at = 0; (at = data.indexOf(pointerBytes, at)) !== -1; at += 4) literalOffsets.push(at);

const report = {
  input: inputPath,
  loadAddress: `0x${loadAddress.toString(16)}`,
  target: `0x${target.toString(16)}`,
  constructedReferences: matches.map(match => ({
    fileOffset: `0x${match.offset.toString(16)}`,
    address: `0x${addressOf(match.offset).toString(16)}`,
    lowFileOffset: `0x${match.nextOffset.toString(16)}`,
    register: match.register,
    gapInstructions: match.gapInstructions,
    context: Array.from({ length: 20 }, (_, index) => {
      const contextOffset = Math.max(payloadStart, match.offset - 20) + index * 4;
      if (contextOffset + 4 > payloadEnd) return null;
      const contextAddress = addressOf(contextOffset);
      const contextWord = data.readUInt32LE(contextOffset) >>> 0;
      return {
        fileOffset: `0x${contextOffset.toString(16)}`,
        address: `0x${contextAddress.toString(16)}`,
        word: `0x${contextWord.toString(16).padStart(8, '0')}`,
        instruction: decode(contextWord, contextAddress),
      };
    }).filter(Boolean),
  })),
  literalPointerOffsets: literalOffsets.map(offset => `0x${offset.toString(16)}`),
};

console.log(JSON.stringify(report, null, 2));
