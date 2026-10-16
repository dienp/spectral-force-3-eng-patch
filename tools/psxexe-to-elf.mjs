#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node tools/psxexe-to-elf.mjs <PS-X-EXE> <output.elf>');
  process.exit(2);
}

const input = fs.readFileSync(inputPath);
if (input.length < 0x800 || input.subarray(0, 8).toString('ascii') !== 'PS-X EXE') {
  throw new Error('Input is not a PS-X EXE');
}

const entry = input.readUInt32LE(0x10);
const loadAddress = input.readUInt32LE(0x18);
const declaredSize = input.readUInt32LE(0x1c);
const availableSize = input.length - 0x800;
if (declaredSize > availableSize) throw new Error('PS-X EXE payload is truncated');

const elfOffset = 0x1000;
const output = Buffer.alloc(elfOffset + declaredSize);

// ELF32 little-endian MIPS executable with one loadable segment. This is an
// analysis wrapper only; the original PS-X EXE header remains authoritative.
output[0] = 0x7f;
output.write('ELF', 1, 'ascii');
output[4] = 1; // ELFCLASS32
output[5] = 1; // little endian
output[6] = 1; // current version
output[7] = 0; // System V ABI
output.writeUInt16LE(2, 0x10); // ET_EXEC
output.writeUInt16LE(8, 0x12); // EM_MIPS
output.writeUInt32LE(1, 0x14);
output.writeUInt32LE(entry, 0x18);
output.writeUInt32LE(0x34, 0x1c); // program header table
output.writeUInt32LE(0, 0x20); // no section table
output.writeUInt32LE(0x10001001, 0x24); // MIPS I, noreorder-style flags
output.writeUInt16LE(0x34, 0x28);
output.writeUInt16LE(0x20, 0x2a);
output.writeUInt16LE(1, 0x2c);
output.writeUInt16LE(0x28, 0x2e);
output.writeUInt16LE(0, 0x30);
output.writeUInt16LE(0, 0x32);

// PT_LOAD
output.writeUInt32LE(1, 0x34);
output.writeUInt32LE(elfOffset, 0x38);
output.writeUInt32LE(loadAddress, 0x3c);
output.writeUInt32LE(loadAddress, 0x40);
output.writeUInt32LE(declaredSize, 0x44);
output.writeUInt32LE(declaredSize, 0x48);
output.writeUInt32LE(7, 0x4c); // read/write/execute: mirrors the PS1 RAM image
output.writeUInt32LE(0x1000, 0x50);

input.copy(output, elfOffset, 0x800, 0x800 + declaredSize);
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, output);
console.log(JSON.stringify({
  input: path.resolve(inputPath),
  output: path.resolve(outputPath),
  entry: `0x${entry.toString(16)}`,
  loadAddress: `0x${loadAddress.toString(16)}`,
  payloadSize: declaredSize,
}, null, 2));
