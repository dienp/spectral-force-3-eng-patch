#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const RAW_SECTOR = 2352;
const USER_OFFSET = 24;
const USER_SIZE = 2048;

const edcLut = new Uint32Array(256);
const eccFLut = new Uint8Array(256);
const eccBLut = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let edc = i;
  for (let bit = 0; bit < 8; bit++) edc = (edc >>> 1) ^ ((edc & 1) ? 0xd8018001 : 0);
  edcLut[i] = edc >>> 0;
  const j = ((i << 1) ^ ((i & 0x80) ? 0x11d : 0)) & 0xff;
  eccFLut[i] = j;
  eccBLut[i ^ j] = i;
}

function computeEdc(buf, offset, length) {
  let edc = 0;
  for (let i = 0; i < length; i++) edc = ((edc >>> 8) ^ edcLut[(edc ^ buf[offset + i]) & 0xff]) >>> 0;
  return edc;
}

function computeEcc(sector, majorCount, minorCount, majorMult, minorInc, destination) {
  const size = majorCount * minorCount;
  for (let major = 0; major < majorCount; major++) {
    let index = ((major >>> 1) * majorMult) + (major & 1);
    let a = 0;
    let b = 0;
    for (let minor = 0; minor < minorCount; minor++) {
      const value = sector[12 + index];
      index += minorInc;
      if (index >= size) index -= size;
      a ^= value;
      b ^= value;
      a = eccFLut[a];
    }
    a = eccBLut[eccFLut[a] ^ b];
    sector[destination + major] = a;
    sector[destination + majorCount + major] = a ^ b;
  }
}

function repairMode2Form1(sector) {
  if (sector[15] !== 2 || (sector[18] & 0x20)) throw new Error('Replacement target contains a sector that is not Mode 2 Form 1');
  sector.writeUInt32LE(computeEdc(sector, 16, 2056), 2072);
  const header = Buffer.from(sector.subarray(12, 16));
  sector.fill(0, 12, 16);
  computeEcc(sector, 86, 24, 2, 86, 2076);
  computeEcc(sector, 52, 43, 86, 88, 2248);
  header.copy(sector, 12);
}

function verifySector(sector) {
  const copy = Buffer.from(sector);
  repairMode2Form1(copy);
  return {
    edc: copy.subarray(2072, 2076).equals(sector.subarray(2072, 2076)),
    eccP: copy.subarray(2076, 2248).equals(sector.subarray(2076, 2248)),
    eccQ: copy.subarray(2248, 2352).equals(sector.subarray(2248, 2352)),
  };
}

const [command, ...args] = process.argv.slice(2);
if (command === 'verify') {
  const [imagePath, ...lbas] = args;
  if (!imagePath || !lbas.length) throw new Error('Usage: node tools/patch-disc.mjs verify <disc.bin> <lba> [...]');
  const fd = fs.openSync(imagePath, 'r');
  try {
    for (const value of lbas) {
      const lba = Number(value);
      const sector = Buffer.alloc(RAW_SECTOR);
      if (fs.readSync(fd, sector, 0, RAW_SECTOR, lba * RAW_SECTOR) !== RAW_SECTOR) throw new Error(`Short read at LBA ${lba}`);
      console.log(JSON.stringify({ lba, ...verifySector(sector) }));
    }
  } finally { fs.closeSync(fd); }
} else if (command === 'replace') {
  const [imagePath, manifestPath, relativePath, replacementPath, outputImage] = args;
  if (!outputImage) throw new Error('Usage: node tools/patch-disc.mjs replace <disc.bin> <manifest.json> <relative-path> <replacement-file> <output.bin>');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = manifest.files.find(item => item.path.toUpperCase() === relativePath.replaceAll('\\', '/').toUpperCase());
  if (!entry) throw new Error(`File not found in manifest: ${relativePath}`);
  const replacement = fs.readFileSync(replacementPath);
  if (replacement.length !== entry.size) throw new Error(`Replacement must stay exactly ${entry.size} bytes (got ${replacement.length})`);
  fs.mkdirSync(path.dirname(path.resolve(outputImage)), { recursive: true });
  // Same input and output path patches an already-built image in place (used to
  // replace several files in one build); otherwise the input is copied first.
  if (path.resolve(imagePath) !== path.resolve(outputImage)) fs.copyFileSync(imagePath, outputImage);
  const fd = fs.openSync(outputImage, 'r+');
  try {
    let copied = 0;
    for (let sectorIndex = 0; copied < replacement.length; sectorIndex++) {
      const lba = entry.lba + sectorIndex;
      const sector = Buffer.alloc(RAW_SECTOR);
      if (fs.readSync(fd, sector, 0, RAW_SECTOR, lba * RAW_SECTOR) !== RAW_SECTOR) throw new Error(`Short read at LBA ${lba}`);
      const count = Math.min(USER_SIZE, replacement.length - copied);
      replacement.copy(sector, USER_OFFSET, copied, copied + count);
      repairMode2Form1(sector);
      fs.writeSync(fd, sector, 0, RAW_SECTOR, lba * RAW_SECTOR);
      copied += count;
    }
  } finally { fs.closeSync(fd); }
  const cuePath = outputImage.replace(/\.bin$/i, '.cue');
  if (cuePath !== outputImage) {
    fs.writeFileSync(cuePath, `FILE "${path.basename(outputImage)}" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n`);
  }
  console.log(`Replaced ${entry.path} at LBA ${entry.lba}; repaired Mode 2 Form 1 EDC/ECC in ${path.resolve(outputImage)}`);
} else {
  console.error('Commands: verify, replace');
  process.exit(2);
}
