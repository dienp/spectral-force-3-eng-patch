#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [memoryPath, exeCatalogPath, eventCatalogPath, outputDir] = process.argv.slice(2);
if (!outputDir) {
  console.error('Usage: node tools/apply-translation-memory.mjs <memory.json> <exe-catalog.json> <event-catalog.json> <output-dir>');
  process.exit(2);
}

const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
const exe = JSON.parse(fs.readFileSync(exeCatalogPath, 'utf8'));
const events = JSON.parse(fs.readFileSync(eventCatalogPath, 'utf8'));
const translations = new Map(memory.items.filter(item => item.translation).map(item => [item.original, item.translation]));

for (const item of exe.strings) item.translation = translations.get(item.original) ?? '';

// Strings found after the original extraction (for example ones that follow a
// jump table, which the scanner skips) exist only in the memory. Add them by
// their recorded location; texttool insert still verifies the original bytes.
const known = new Set(exe.strings.map(item => Number(item.offset)));
let supplemental = 0;
for (const item of memory.items) {
  if (!item.translation) continue;
  for (const location of item.locations) {
    if (location.target !== 'SLPS_022.33' || known.has(Number(location.offset))) continue;
    exe.strings.push({
      id: `exe_${Number(location.offset).toString(16).padStart(6, '0')}`,
      offset: location.offset,
      address: location.address,
      maxBytes: location.maxBytes,
      original: item.original,
      translation: item.translation,
      pointerReferences: location.pointerReferences ?? [],
    });
    known.add(Number(location.offset));
    supplemental++;
  }
}
exe.strings.sort((a, b) => Number(a.offset) - Number(b.offset));
for (const group of events.groups) group.translation = translations.get(group.original) ?? '';

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'executable-strings.en.json'), `${JSON.stringify(exe, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'event-strings.en.json'), `${JSON.stringify(events, null, 2)}\n`);
console.log(JSON.stringify({
  translatedMemoryItems: translations.size,
  executableEntriesFilled: exe.strings.filter(item => item.translation).length,
  executableEntriesAdded: supplemental,
  eventGroupsFilled: events.groups.filter(item => item.translation).length,
  outputDir: path.resolve(outputDir),
}, null, 2));
