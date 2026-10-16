#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node tools/scan-assets.mjs <file> [...]');
  process.exit(2);
}

const signatures = [
  ['TIM', Buffer.from([0x10, 0x00, 0x00, 0x00])],
  ['VABp', Buffer.from('pBAV')],
  ['VABh', Buffer.from('pQES')],
  ['RIFF', Buffer.from('RIFF')],
  ['PS-X EXE', Buffer.from('PS-X EXE')],
  ['Minku CdMixFile', Buffer.from('Minku >><< IDEA FACTORY CdMixFile by Minku')],
];

function entropy(buf) {
  if (!buf.length) return 0;
  const counts = new Uint32Array(256);
  for (const b of buf) counts[b]++;
  let value = 0;
  for (const n of counts) if (n) {
    const p = n / buf.length;
    value -= p * Math.log2(p);
  }
  return value;
}

for (const file of files) {
  const data = fs.readFileSync(file);
  const found = {};
  for (const [name, signature] of signatures) {
    const offsets = [];
    let at = 0;
    while ((at = data.indexOf(signature, at)) !== -1) {
      offsets.push(`0x${at.toString(16)}`);
      at++;
      if (offsets.length === 32) break;
    }
    if (offsets.length) found[name] = offsets;
  }
  const chunk = 1024 * 1024;
  const chunkEntropy = [];
  for (let at = 0; at < data.length; at += chunk) {
    chunkEntropy.push(Number(entropy(data.subarray(at, Math.min(data.length, at + chunk))).toFixed(3)));
  }
  console.log(JSON.stringify({ file: path.resolve(file), bytes: data.length, signatures: found, entropyMiB: chunkEntropy }, null, 2));
}
