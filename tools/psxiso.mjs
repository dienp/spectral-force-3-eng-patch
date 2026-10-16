#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RAW_SECTOR = 2352;
const USER_OFFSET = 24;
const USER_SIZE = 2048;

function usage() {
  console.error('Usage: node tools/psxiso.mjs <list|extract> <disc.bin> [output-dir]');
  process.exit(2);
}

const [command, imagePath, outputDir] = process.argv.slice(2);
if (!command || !imagePath || !['list', 'extract'].includes(command)) usage();
if (command === 'extract' && !outputDir) usage();

const fd = fs.openSync(imagePath, 'r');

function readSector(lba) {
  const raw = Buffer.alloc(RAW_SECTOR);
  const count = fs.readSync(fd, raw, 0, RAW_SECTOR, lba * RAW_SECTOR);
  if (count !== RAW_SECTOR) throw new Error(`Short read at LBA ${lba}`);
  if (raw[15] !== 2) throw new Error(`LBA ${lba} is not a Mode 2 sector`);
  // ISO directory sizes are expressed in 2048-byte logical blocks. XA/STR
  // extents may use Form 2 sectors; keeping the first logical block is enough
  // for inventory and static analysis. A sector-perfect rebuilder must retain
  // the original raw sectors rather than rebuilding these media streams.
  return raw.subarray(USER_OFFSET, USER_OFFSET + USER_SIZE);
}

function readExtent(lba, size) {
  const out = Buffer.alloc(size);
  let written = 0;
  for (let sector = 0; written < size; sector++) {
    const data = readSector(lba + sector);
    const n = Math.min(USER_SIZE, size - written);
    data.copy(out, written, 0, n);
    written += n;
  }
  return out;
}

function recordAt(buf, offset) {
  const length = buf[offset];
  if (!length) return null;
  const nameLength = buf[offset + 32];
  const rawName = buf.subarray(offset + 33, offset + 33 + nameLength);
  let name;
  if (nameLength === 1 && rawName[0] === 0) name = '.';
  else if (nameLength === 1 && rawName[0] === 1) name = '..';
  else name = rawName.toString('ascii').replace(/;\d+$/, '');
  return {
    length,
    lba: buf.readUInt32LE(offset + 2),
    size: buf.readUInt32LE(offset + 10),
    flags: buf[offset + 25],
    name,
  };
}

function parseDirectory(lba, size) {
  const buf = readExtent(lba, size);
  const entries = [];
  let offset = 0;
  while (offset < buf.length) {
    if (buf[offset] === 0) {
      offset = Math.ceil((offset + 1) / USER_SIZE) * USER_SIZE;
      continue;
    }
    const rec = recordAt(buf, offset);
    if (!rec || offset + rec.length > buf.length) break;
    if (rec.name !== '.' && rec.name !== '..') entries.push(rec);
    offset += rec.length;
  }
  return entries;
}

const pvd = readSector(16);
if (pvd[0] !== 1 || pvd.subarray(1, 6).toString('ascii') !== 'CD001') {
  throw new Error('No ISO-9660 primary volume descriptor at LBA 16');
}
const root = recordAt(pvd, 156);
const manifest = [];

function walk(dir, prefix = '') {
  for (const entry of parseDirectory(dir.lba, dir.size)) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const isDirectory = (entry.flags & 2) !== 0;
    manifest.push({ path: relativePath, type: isDirectory ? 'directory' : 'file', lba: entry.lba, size: entry.size });
    if (isDirectory) walk(entry, relativePath);
  }
}

walk(root);

if (command === 'list') {
  console.log(JSON.stringify({
    image: path.resolve(imagePath),
    volumeId: pvd.subarray(40, 72).toString('ascii').trim(),
    files: manifest,
  }, null, 2));
} else {
  const resolvedOutput = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutput, { recursive: true });
  const extracted = [];
  for (const item of manifest) {
    const destination = path.join(resolvedOutput, ...item.path.split('/'));
    if (item.type === 'directory') {
      fs.mkdirSync(destination, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const data = readExtent(item.lba, item.size);
    fs.writeFileSync(destination, data);
    extracted.push({ ...item, sha256: crypto.createHash('sha256').update(data).digest('hex') });
  }
  fs.writeFileSync(path.join(resolvedOutput, 'manifest.json'), `${JSON.stringify({
    sourceImage: path.resolve(imagePath),
    volumeId: pvd.subarray(40, 72).toString('ascii').trim(),
    files: extracted,
  }, null, 2)}\n`);
  console.log(`Extracted ${extracted.length} files to ${resolvedOutput}`);
}

fs.closeSync(fd);
