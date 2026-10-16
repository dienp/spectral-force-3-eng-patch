#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [exeCatalogPath, eventCatalogPath, outputPath] = process.argv.slice(2);
if (!outputPath) {
  console.error('Usage: node tools/build-translation-memory.mjs <exe-catalog.json> <event-grouped.json> <output.json>');
  process.exit(2);
}

const exe = JSON.parse(fs.readFileSync(exeCatalogPath, 'utf8'));
const events = JSON.parse(fs.readFileSync(eventCatalogPath, 'utf8'));
const byOriginal = new Map();

function add(original, location) {
  let item = byOriginal.get(original);
  if (!item) {
    item = {
      id: `tm_${byOriginal.size.toString().padStart(5, '0')}`,
      original,
      translation: '',
      status: 'pending',
      locations: [],
    };
    byOriginal.set(original, item);
  }
  item.locations.push(location);
}

for (const item of exe.strings) {
  add(item.original, {
    target: 'SLPS_022.33',
    offset: item.offset,
    maxBytes: item.maxBytes,
    address: item.address,
    pointerReferences: item.pointerReferences,
  });
}
for (const group of events.groups) {
  for (const occurrence of group.occurrences) {
    add(group.original, { target: 'IV_DAT.EVE', ...occurrence });
  }
}

const items = [...byOriginal.values()].map(item => ({
  ...item,
  minBytes: Math.min(...item.locations.map(location => location.maxBytes)),
  occurrenceCount: item.locations.length,
  controlCodes: [...item.original.matchAll(/#(?:n|b|[0-8])/g)].map(match => match[0]),
}));

const result = {
  format: 'spectral-force-translation-memory-v1',
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  rules: [
    'Preserve every control code exactly, including #n.',
    'Translation encoded byte length must not exceed minBytes.',
    'Use concise natural English suitable for a 1999 fantasy strategy RPG.',
  ],
  items,
};

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.resolve(outputPath),
  uniqueStrings: items.length,
  sourceCharacters: items.reduce((sum, item) => sum + [...item.original].length, 0),
  locations: items.reduce((sum, item) => sum + item.locations.length, 0),
}, null, 2));
