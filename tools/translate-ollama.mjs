#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [catalogPath, model = 'qwen3.5:9b', batchArg = '40', limitArg] = process.argv.slice(2);
if (!catalogPath) {
  console.error('Usage: node tools/translate-ollama.mjs <translation-memory.json> [model] [batch-size] [max-items]');
  process.exit(2);
}

const batchSize = Number(batchArg);
const maxItems = limitArg ? Number(limitArg) : Infinity;
const verbose = process.argv.includes('--verbose');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
if (catalog.format !== 'spectral-force-translation-memory-v1') throw new Error('Unsupported translation memory');

const endpoint = 'http://127.0.0.1:11434/api/chat';
const pending = catalog.items.filter(item => !item.translation).slice(0, maxItems);
let completed = 0;

const schema = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          translation: { type: 'string' },
        },
        required: ['id', 'translation'],
      },
    },
  },
  required: ['translations'],
};

function controls(text) {
  return [...text.matchAll(/#(?:n|b|[0-8])/g)].map(match => match[0]);
}

function normalize(item, translation) {
  if (typeof translation !== 'string') return translation;
  let value = translation
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[—–]/g, '-')
    .replace(/\r\n|\r|\n/g, '#n')
    .trim();
  if (!item.controlCodes.includes('#n')) value = value.replaceAll('#n', ' ');
  return value;
}

function valid(item, translation) {
  return typeof translation === 'string' &&
    Buffer.byteLength(translation, 'ascii') <= item.minBytes &&
    translation.length > 0 &&
    !/[\u0080-\uffff]/u.test(translation) &&
    JSON.stringify(controls(translation)) === JSON.stringify(item.controlCodes);
}

async function request(items, compact = false, previous = new Map()) {
  const instruction = [
    'Translate Japanese game text into concise, natural English for Spectral Force: Itoshiki Jaaku, a dark fantasy strategy RPG.',
    'Return exactly one translation for every supplied id.',
    'Use ASCII only.',
    'Preserve every # control code exactly and in the same order. #n is a displayed line break.',
    'Do not add quotes, explanations, notes, honorific commentary, or terminal punctuation absent from the meaning.',
    'Names must be romanized consistently. UI labels should be brief commands or nouns.',
    'Each translation MUST fit its maxBytes number; ASCII characters count as one byte and the two characters #n count as two.',
    'Aim at least 15 percent under maxBytes. Prefer terse game dialogue: omit articles, subjects, and filler when needed. Preserving core meaning is more important than preserving every nuance.',
    'Example: maxBytes 36, 疲れた．．#n今月は休ませてくれないか -> Tired...#nLet me rest this month. (34 bytes).',
    compact ? 'Every previous draft listed below was rejected. Rewrite it drastically shorter using fragments if needed. Count every ASCII character. Never output an actual newline; retain the literal two characters #n.' : '',
    'Input JSON:',
    JSON.stringify(items.map(({ id, original, minBytes }) => ({
      id,
      japanese: original,
      maxBytes: minBytes,
      targetBytes: Math.max(1, Math.floor(minBytes * 0.82)),
      ...(previous.has(id) ? { rejectedDraft: previous.get(id), rejectedBytes: Buffer.byteLength(previous.get(id), 'ascii') } : {}),
    }))),
  ].filter(Boolean).join('\n');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: schema,
      options: { temperature: 0.15, num_ctx: 16384 },
      messages: [{ role: 'user', content: instruction }],
    }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json();
  return JSON.parse(body.message.content).translations;
}

function save() {
  const tempPath = `${catalogPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(catalog, null, 2)}\n`);
  fs.renameSync(tempPath, catalogPath);
}

for (let at = 0; at < pending.length; at += batchSize) {
  const batch = pending.slice(at, at + batchSize);
  let unresolved = batch;
  let lastReturned = new Map();
  for (let attempt = 0; attempt < 3 && unresolved.length; attempt++) {
    const output = await request(unresolved, attempt > 0, lastReturned);
    const returned = new Map(output.map(item => [item.id, item.translation]));
    lastReturned = new Map(unresolved.map(item => [item.id, normalize(item, returned.get(item.id))]));
    const next = [];
    for (const item of unresolved) {
      const translation = lastReturned.get(item.id);
      if (valid(item, translation)) {
        item.translation = translation;
        item.status = 'machine-draft';
      } else {
        next.push(item);
      }
    }
    unresolved = next;
  }
  for (const item of unresolved) {
    item.status = 'needs-manual-translation';
    if (verbose) console.error(JSON.stringify({ id: item.id, japanese: item.original, maxBytes: item.minBytes, rejected: lastReturned.get(item.id) ?? null }));
  }
  completed += batch.length - unresolved.length;
  save();
  const batchNumber = Math.floor(at / batchSize) + 1;
  if (batchNumber % 5 === 0 || at + batch.length >= pending.length) {
    console.log(JSON.stringify({ processed: Math.min(at + batch.length, pending.length), total: pending.length, translated: completed, unresolvedInLastBatch: unresolved.length }));
  }
}

console.log(`Saved ${path.resolve(catalogPath)}`);
