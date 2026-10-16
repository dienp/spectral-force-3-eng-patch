#!/usr/bin/env node
// Makes the dialogue renderer draw single-byte ASCII (0x20-0x7E) with the
// font's existing full-width Latin glyphs, one byte per character, with a
// proportional per-glyph advance. Two ASCII characters share one glyph slot
// when they fit. Japanese (2-byte Shift-JIS) is unchanged.
//
//   node tools/ascii-font-patch.mjs <original SLPS_022.33> <patched output>
//
// Evidence for every patched address is recorded in RESEARCH.md
// ("ASCII font patch"). The patch is applied to the original executable only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node tools/ascii-font-patch.mjs <original SLPS_022.33> <patched output>');
  process.exit(2);
}

const exe = Buffer.from(fs.readFileSync(inputPath));
if (exe.subarray(0, 8).toString('ascii') !== 'PS-X EXE') throw new Error('Input is not a PS-X EXE');
const LOAD = exe.readUInt32LE(0x18) >>> 0;
if (LOAD !== 0x80010000 || exe.length !== 1007616) throw new Error('Unexpected executable revision');
const fileOffset = address => address - LOAD + 0x800;

// ---- Known addresses (static analysis of SLPS-02233) -----------------------
const GLYPH_LOOKUP = 0x8007ae74;   // returns glyph pointer for the 2-byte Shift-JIS code at a0
const LOOKUP_CALLS = [0x8007a1f8, 0x8007a210]; // jal GLYPH_LOOKUP inside the glyph-cache builder
const LAYOUT_JUMP = 0x8007a76c;    // j 0x8007a7dc ; addiu s0,s0,13 (delay slot)
const LAYOUT_ADVANCE = 0x8007a7d8; // addiu s0,s0,13
const MEASURE_DIV = 0x800a3024;    // sra v1,v1,1 inside the text-width estimate
const MEASURE_MUL = [0x800a3028, 0x800a302c, 0x800a3030, 0x800a3034];
const GLYPH_SLOT = 3280;           // gp-relative halfword: current glyph cache slot
const CAVE = 0x800c3cc4;           // unreferenced library function, 1132 bytes
const CAVE_SIZE = 1132;
const CAVE_SHA256 = 'a94a27de17d165d1622fa53c9ef91b3081eb211d3c3e95e2cf120ff407650e9d';
const FONT = 0x800d8774;           // non-kanji glyph table, 22 bytes per glyph (11 rows x 16 bits)

const expectWords = [
  [LOOKUP_CALLS[0], 0x0c01eb9d], [LOOKUP_CALLS[1], 0x0c01eb9d],
  [LAYOUT_JUMP, 0x0801e9f7], [LAYOUT_JUMP + 4, 0x2610000d],
  [LAYOUT_ADVANCE, 0x2610000d], [LAYOUT_ADVANCE + 4, 0x26f70001],
  [MEASURE_DIV, 0x00031843], [MEASURE_MUL[0], 0x00031040], [MEASURE_MUL[1], 0x00431021],
  [MEASURE_MUL[2], 0x00021080], [MEASURE_MUL[3], 0x00431021],
];
for (const [address, word] of expectWords) {
  const actual = exe.readUInt32LE(fileOffset(address)) >>> 0;
  if (actual !== word) throw new Error(`0x${address.toString(16)}: expected 0x${word.toString(16)}, found 0x${actual.toString(16)}`);
}
const caveBytes = exe.subarray(fileOffset(CAVE), fileOffset(CAVE) + CAVE_SIZE);
if (crypto.createHash('sha256').update(caveBytes).digest('hex') !== CAVE_SHA256) throw new Error('Code cave bytes do not match the original executable');

// ---- Tiny MIPS encoder -----------------------------------------------------
const REG = Object.fromEntries(['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra'].map((r, i) => [r, i]));
const I = (op, rs, rt, imm) => ((op << 26) | (REG[rs] << 21) | (REG[rt] << 16) | (imm & 0xffff)) >>> 0;
const R = (rs, rt, rd, sh, fn) => ((REG[rs] << 21) | (REG[rt] << 16) | (REG[rd] << 11) | (sh << 6) | fn) >>> 0;
const asm = {
  nop: () => 0,
  addiu: (rt, rs, imm) => I(0x09, rs, rt, imm),
  sltiu: (rt, rs, imm) => I(0x0b, rs, rt, imm),
  andi: (rt, rs, imm) => I(0x0c, rs, rt, imm),
  ori: (rt, rs, imm) => I(0x0d, rs, rt, imm),
  lui: (rt, imm) => I(0x0f, 'zero', rt, imm),
  lbu: (rt, imm, rs) => I(0x24, rs, rt, imm),
  lh: (rt, imm, rs) => I(0x21, rs, rt, imm),
  lw: (rt, imm, rs) => I(0x23, rs, rt, imm),
  sb: (rt, imm, rs) => I(0x28, rs, rt, imm),
  sw: (rt, imm, rs) => I(0x2b, rs, rt, imm),
  addu: (rd, rs, rt) => R(rs, rt, rd, 0, 0x21),
  subu: (rd, rs, rt) => R(rs, rt, rd, 0, 0x23),
  sll: (rd, rt, sh) => R('zero', rt, rd, sh, 0x00),
  srl: (rd, rt, sh) => R('zero', rt, rd, sh, 0x02),
  jr: rs => R(rs, 'zero', 'zero', 0, 0x08),
  j: target => ((0x02 << 26) | ((target >>> 2) & 0x03ffffff)) >>> 0,
  jal: target => ((0x03 << 26) | ((target >>> 2) & 0x03ffffff)) >>> 0,
};
const hi = address => ((address + 0x8000) >>> 16) & 0xffff;
const lo = address => address & 0xffff;

// ---- ASCII -> full-width Shift-JIS and glyph metrics -----------------------
const FULLWIDTH = {
  ' ': 0x8140, '!': 0x8149, '"': 0x8168, '#': 0x8194, '$': 0x8190, '%': 0x8193, '&': 0x8195, "'": 0x8166,
  '(': 0x8169, ')': 0x816a, '*': 0x8196, '+': 0x817b, ',': 0x8143, '-': 0x815d, '.': 0x8144, '/': 0x815e,
  ':': 0x8146, ';': 0x8147, '<': 0x8183, '=': 0x8181, '>': 0x8184, '?': 0x8148, '@': 0x8197, '[': 0x816d,
  '\\': 0x815f, ']': 0x816e, '^': 0x814f, '_': 0x8151, '`': 0x814d, '{': 0x816f, '|': 0x8162, '}': 0x8170, '~': 0x8160,
};
for (let i = 0; i < 10; i++) FULLWIDTH[String(i)] = 0x824f + i;
for (let i = 0; i < 26; i++) {
  FULLWIDTH[String.fromCharCode(0x41 + i)] = 0x8260 + i;
  FULLWIDTH[String.fromCharCode(0x61 + i)] = 0x8281 + i;
}
// Index of a code in the non-kanji glyph table (rows 1-3 of the font; verified by rendering).
function glyphIndex(code) {
  const lead = code >> 8, trail = code & 0xff;
  if (lead === 0x81) return trail < 0x80 ? trail - 0x40 : trail - 0x41;
  if (lead === 0x82 && trail >= 0x4f && trail <= 0x58) return 147 + trail - 0x4f;
  if (lead === 0x82 && trail >= 0x60 && trail <= 0x79) return 157 + trail - 0x60;
  if (lead === 0x82 && trail >= 0x81 && trail <= 0x9a) return 183 + trail - 0x81;
  throw new Error(`No glyph index for 0x${code.toString(16)}`);
}
const SPACE_ADVANCE = 4;
const SHADOW = 1; // the drop shadow sits 1-2 px right of the ink; the next glyph may overlap its last column
const GAP = 1;
function metrics(code) {
  const base = fileOffset(FONT) + 22 * glyphIndex(code);
  let left = 16, right = -1;
  for (let row = 0; row < 11; row++) {
    const bits = exe.readUInt16BE(base + row * 2);
    for (let x = 0; x < 16; x++) if ((bits >> (15 - x)) & 1) { left = Math.min(left, x); right = Math.max(right, x); }
  }
  if (right < 0) return { left: 0, advance: SPACE_ADVANCE };
  return { left, advance: Math.min(15, right - left + 1 + SHADOW + GAP) };
}

const codeTable = Buffer.alloc(95 * 2);
const metricTable = Buffer.alloc(95);
for (let c = 0x20; c < 0x7f; c++) {
  const code = FULLWIDTH[String.fromCharCode(c)];
  codeTable.writeUInt16BE(code, (c - 0x20) * 2);
  const { left, advance } = metrics(code);
  if (left > 15 || advance > 15) throw new Error(`Metric overflow for ${String.fromCharCode(c)}`);
  metricTable[c - 0x20] = (left << 4) | advance;
}

// ---- Code cave layout ------------------------------------------------------
// Each text window reserves a fixed number of glyph slots, sized for the
// Japanese text (one slot per 2-byte character). To use no more slots than the
// Japanese, the lookup hook packs two ASCII characters into one 15 px glyph
// when they fit, so 2 bytes still take 1 slot. Every ASCII glyph is shifted so
// its ink starts at column 0, and the slot stores the pen advance only.
const LOOKUP_HOOK = CAVE;
const SPRITE_W = 15;                 // widest sprite: u0 + 15 must stay <= 255
const MAX_PAIR = 15;                 // advance(a) + advance(b) limit: ink ends by column 12
// The glyph converter (0x8007ABB8) draws ink one pixel right of the source bit
// with an outline on both sides, colouring ink from a 13 x 16 gradient table.
// Columns 13-15 of that table hold the outline colour, so ink there vanishes;
// copy each row's last gradient value into them. Only the converter reads it.
const GRADIENT = 0x800eb360;
const GRADIENT_SHA256 = crypto.createHash('sha256').update(exe.subarray(fileOffset(GRADIENT), fileOffset(GRADIENT) + 13 * 16)).digest('hex');
if (GRADIENT_SHA256 !== '7e2dfe737df80f990fbabf4e8590f880ccb5a4491cc7f9dd2d5064ccc96ed119') throw new Error('Glyph gradient table does not match the original executable');
const UNKNOWN_GLYPH = 3260;          // gp-relative halfword the original lookup clears
const SPRITE_UV = 0x8007a274;        // addiu s4,s5,13 (glyph texture width)
const SPRITE_XY = 0x8007a718;        // addiu v1,s0,13 (glyph quad width)
for (const [address, word] of [[SPRITE_UV, 0x26b4000d], [SPRITE_XY, 0x2603000d]]) {
  const actual = exe.readUInt32LE(fileOffset(address)) >>> 0;
  if (actual !== word) throw new Error(`0x${address.toString(16)}: expected 0x${word.toString(16)}, found 0x${actual.toString(16)}`);
}
const offsetTable = Buffer.alloc(95 * 2);
for (let c = 0x20; c < 0x7f; c++) offsetTable.writeUInt16LE(22 * glyphIndex(FULLWIDTH[String.fromCharCode(c)]), (c - 0x20) * 2);

// Small assembler with branch labels.
function assemble(origin, lines) {
  const labels = {};
  let pc = origin;
  for (const line of lines) if (typeof line === 'string') labels[line] = pc; else pc += 4;
  const words = [];
  pc = origin;
  for (const line of lines) {
    if (typeof line === 'string') continue;
    words.push(typeof line === 'function' ? line(pc, labels) : line);
    pc += 4;
  }
  return words;
}
const br = (op, rs, rt, label) => (pc, labels) => I(op, rs, rt, (labels[label] - pc - 4) >> 2);
const sllv = (rd, rt, rs) => R(rs, rt, rd, 0, 0x04);
const srlv = (rd, rt, rs) => R(rs, rt, rd, 0, 0x06);
const or = (rd, rs, rt) => R(rs, rt, rd, 0, 0x25);
const sh = (rt, imm, rs) => I(0x29, rs, rt, imm);
const lhu = (rt, imm, rs) => I(0x25, rs, rt, imm);

// Registers: t1 first char, t0 second char, t8/t9 glyph rows, a1/a3 left
// bearings, a2 shift for the second glyph, t6 slot advance, v1 counter.
// Leaf routine without a stack frame (see RESEARCH.md: a framed hook hung at boot).
// The R3000 has a load delay slot: never use a loaded register in the next instruction.
const lookupCode = (tables, slots, buffer) => assemble(LOOKUP_HOOK, [
  asm.lbu('t1', 0, 'a0'),
  asm.nop(),                          // load delay slot (R3000)
  asm.sltiu('t2', 't1', 0x80),
  br(0x05, 't2', 'zero', 'ascii'),
  asm.lh('t7', GLYPH_SLOT, 'gp'),
  // Shift-JIS: fixed 13 px advance, then the original lookup.
  asm.lui('t3', hi(slots)), asm.addiu('t3', 't3', lo(slots)),
  asm.andi('t7', 't7', 0xff), asm.addu('t3', 't3', 't7'),
  asm.ori('t6', 'zero', 13),
  asm.j(GLYPH_LOOKUP),
  asm.sb('t6', 0, 't3'),
  'ascii',
  asm.addiu('t1', 't1', -0x20),
  asm.sltiu('t2', 't1', 95),
  br(0x05, 't2', 'zero', 'printable'),
  asm.lui('t3', hi(tables)),
  asm.addu('t1', 'zero', 'zero'),     // control byte: draw a space
  'printable',
  asm.addiu('t3', 't3', lo(tables)),
  asm.sll('t4', 't1', 1), asm.addu('t4', 't3', 't4'), lhu('t8', 0, 't4'),
  asm.addu('t4', 't3', 't1'), asm.lbu('t4', 190, 't4'),
  asm.nop(),
  asm.srl('a1', 't4', 4),             // left bearing of the first glyph
  asm.andi('t6', 't4', 0x0f),         // its advance
  asm.lui('t5', hi(FONT)), asm.addiu('t5', 't5', lo(FONT)),
  asm.addu('t8', 't8', 't5'),
  // Defaults for a single glyph: the second glyph contributes nothing.
  asm.addu('t9', 't8', 'zero'),
  asm.addu('a3', 'zero', 'zero'),
  asm.ori('a2', 'zero', 16),
  br(0x05, 'a0', 's7', 'single'),     // overflow-marker call: never pair
  asm.lbu('t0', 1, 'a0'),
  asm.nop(),
  asm.addiu('t0', 't0', -0x20),
  asm.sltiu('t2', 't0', 95),
  br(0x04, 't2', 'zero', 'single'),
  asm.addiu('t2', 't0', -3),          // '#' starts a control code
  br(0x04, 't2', 'zero', 'single'),
  asm.sll('t4', 't0', 1),
  asm.addu('t4', 't3', 't4'), lhu('t2', 0, 't4'),
  asm.addu('t4', 't3', 't0'), asm.lbu('t4', 190, 't4'),
  asm.nop(),
  asm.andi('v1', 't4', 0x0f),
  asm.addu('v1', 'v1', 't6'),         // combined advance
  asm.sltiu('t7', 'v1', MAX_PAIR + 1),
  br(0x04, 't7', 'zero', 'single'),
  asm.nop(),
  // Pair: the builder's 2-byte step is already right.
  asm.addu('t9', 't2', 't5'),
  asm.srl('a3', 't4', 4),
  asm.addu('a2', 't6', 'zero'),
  br(0x04, 'zero', 'zero', 'compose'),
  asm.addu('t6', 'v1', 'zero'),
  'single',
  br(0x05, 'a0', 's7', 'compose'),
  asm.nop(),
  asm.addiu('s7', 's7', -1),          // the builder adds 2, so the net step is 1
  'compose',
  asm.lh('t7', GLYPH_SLOT, 'gp'),
  asm.lui('t3', hi(slots)), asm.addiu('t3', 't3', lo(slots)),
  asm.andi('t7', 't7', 0xff), asm.addu('t3', 't3', 't7'),
  asm.sb('t6', 0, 't3'),
  asm.lui('v0', hi(buffer)), asm.addiu('v0', 'v0', lo(buffer)),
  asm.addu('t3', 'v0', 'zero'),
  asm.ori('v1', 'zero', 11),
  'row',
  asm.lbu('t0', 0, 't8'), asm.lbu('t1', 1, 't8'),
  asm.sll('t0', 't0', 8), or('t0', 't0', 't1'),
  sllv('t0', 't0', 'a1'),
  asm.lbu('t1', 0, 't9'), asm.lbu('t2', 1, 't9'),
  asm.sll('t1', 't1', 8), or('t1', 't1', 't2'),
  sllv('t1', 't1', 'a3'),
  srlv('t1', 't1', 'a2'),
  or('t0', 't0', 't1'),
  asm.srl('t1', 't0', 8),
  asm.sb('t1', 0, 't3'),
  asm.sb('t0', 1, 't3'),
  asm.addiu('t8', 't8', 2), asm.addiu('t9', 't9', 2),
  asm.addiu('v1', 'v1', -1),
  br(0x05, 'v1', 'zero', 'row'),
  asm.addiu('t3', 't3', 2),
  asm.jr('ra'),
  sh('zero', UNKNOWN_GLYPH, 'gp'),
]);
const advanceCode = slots => [
  asm.lui('t0', hi(slots)),
  asm.addiu('t0', 't0', lo(slots)),
  asm.andi('t1', 's2', 0xff),        // s2 = glyph slot being placed
  asm.addu('t1', 't0', 't1'),
  asm.lbu('t2', 0, 't1'),
  asm.jr('ra'),
  asm.addu('s0', 's0', 't2'),        // pen += advance of this slot
];
const lookupWords = lookupCode(0, 0, 0).length;
const ADVANCE_HOOK = LOOKUP_HOOK + lookupWords * 4;
const TABLES = ADVANCE_HOOK + advanceCode(0).length * 4;
const SLOTS = TABLES + offsetTable.length + metricTable.length + 1;
const BUFFER = SLOTS + 256 + ((SLOTS + 256) % 2);
const END = BUFFER + 22;
if (END > CAVE + CAVE_SIZE) throw new Error('Patch does not fit the code cave');

const write = (address, words) => words.forEach((word, i) => exe.writeUInt32LE(word >>> 0, fileOffset(address) + i * 4));
caveBytes.fill(0);
write(LOOKUP_HOOK, lookupCode(TABLES, SLOTS, BUFFER));
write(ADVANCE_HOOK, advanceCode(SLOTS));
offsetTable.copy(exe, fileOffset(TABLES));
metricTable.copy(exe, fileOffset(TABLES) + offsetTable.length);
for (const call of LOOKUP_CALLS) write(call, [asm.jal(LOOKUP_HOOK)]);
write(LAYOUT_JUMP, [asm.j(LAYOUT_ADVANCE), asm.nop()]);
write(LAYOUT_ADVANCE, [asm.jal(ADVANCE_HOOK)]);
write(SPRITE_UV, [asm.addiu('s4', 's5', SPRITE_W)]);
for (let row = 1; row < 12; row++) {
  const base = fileOffset(GRADIENT) + row * 16;
  exe.fill(exe[base + 12], base + 13, base + 16);
}
write(SPRITE_XY, [asm.addiu('v1', 's0', SPRITE_W)]);
// Width estimate: 8 px per byte instead of 13 px per 2-byte character.
write(MEASURE_DIV, [asm.nop()]);
write(MEASURE_MUL[0], [asm.sll('v0', 'v1', 3), asm.nop(), asm.nop(), asm.nop()]);

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, exe);
console.log(JSON.stringify({
  output: path.resolve(outputPath),
  size: exe.length,
  lookupHook: `0x${LOOKUP_HOOK.toString(16)}`,
  advanceHook: `0x${ADVANCE_HOOK.toString(16)}`,
  tables: `0x${TABLES.toString(16)}`,
  buffer: `0x${BUFFER.toString(16)}`,
  slots: `0x${SLOTS.toString(16)}`,
  caveBytesUsed: END - CAVE,
  sha256: crypto.createHash('sha256').update(exe).digest('hex'),
}, null, 2));
