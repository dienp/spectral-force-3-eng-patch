#!/usr/bin/env node
// Builds the English disc image from a user-owned original BIN in one pass:
//   1. ASCII font patch + executable translations  -> SLPS_022.33
//   2. Event dialogue translations                 -> IV_DAT.EVE
//   3. Title subtitle + interface labels           -> CG_01.DAT
//   4. Battle buttons and banners                  -> CG_02.DAT
//   4b. Names, country descriptions and profiles stored in CG_01/CG_02 data
//       blocks (data.en.json next to the memory, or the 6th argument)
//   5. Replace the four files in a copy of the BIN and verify EDC/ECC.
//
//   node tools/build-english.mjs <original.bin> <extracted-dir> <memory.en.json> <output-dir> [name] [data.en.json] [--budgets=<file>] [--relocations=<file>]
//
// --budgets (opt-in) raises the glyph budgets of the listed text windows
// (tools/window-budget-patch.mjs).
// --relocations (opt-in) moves the listed executable strings into verified
// unused space so they can exceed their Japanese byte length
// (tools/relocate-strings.mjs). Without either flag the build is unchanged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const [binPath, extractedDir, memoryPath, outputDir, nameArg, dataCatalogArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const relocationsArg = flags.find(f => f.startsWith('--relocations='))?.slice('--relocations='.length);
const budgetsArg = flags.find(f => f.startsWith('--budgets='))?.slice('--budgets='.length);
const unknownFlags = flags.filter(f => !f.startsWith('--relocations=') && !f.startsWith('--budgets='));
if (!binPath || !extractedDir || !memoryPath || !outputDir || unknownFlags.length) {
  console.error('Usage: node tools/build-english.mjs <original.bin> <extracted-dir> <memory.en.json> <output-dir> [name] [data.en.json] [--budgets=<file>] [--relocations=<file>]');
  process.exit(2);
}
const ORIGINAL_BIN_SHA256 = 'b78cfcf2ed3b471ddf3dc1eb35ea00347746da616933119eb0eeab04e7b950e7';
const tools = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(tools);
const name = nameArg ?? 'Spectral Force - Lovely Wickedness (English)';
const work = path.resolve(outputDir, 'build');
const outBin = path.resolve(outputDir, `${name}.bin`);
if (path.resolve(binPath) === outBin) throw new Error('Refusing to overwrite the original image');
fs.mkdirSync(work, { recursive: true });

const run = (script, ...args) => {
  const out = execFileSync(process.execPath, [path.join(tools, script), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim();
};
const sha256File = file => {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(16 * 1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, n)); } finally { fs.closeSync(fd); }
  return hash.digest('hex');
};
const step = message => console.log(`== ${message}`);

step('Checking original image');
if (sha256File(binPath) !== ORIGINAL_BIN_SHA256) throw new Error('Input BIN does not match the documented SLPS-02233 original');
const extracted = file => path.join(extractedDir, file);

step('Exporting translation catalogs');
const memorySnapshot = path.join(work, 'memory.en.json');
fs.copyFileSync(memoryPath, memorySnapshot); // snapshot so the build is consistent even if the catalog changes
const catalogs = path.join(work, 'catalogs');
console.log(run('apply-translation-memory.mjs', memorySnapshot, path.join(root, 'work/text/executable-strings.json'), path.join(root, 'work/text/event-strings-grouped.json'), catalogs));

step('Executable: font patch + translations');
run('ascii-font-patch.mjs', extracted('SLPS_022.33'), path.join(work, 'SLPS_022.33.font'));
const inPlaceExe = path.join(work, relocationsArg || budgetsArg ? 'SLPS_022.33.inplace' : 'SLPS_022.33');
console.log(run('texttool.mjs', 'insert', path.join(work, 'SLPS_022.33.font'), path.join(catalogs, 'executable-strings.en.json'), inPlaceExe));
let budgetSummary = null;
let budgetedExe = inPlaceExe;
if (budgetsArg) {
  step('Executable: window glyph budgets');
  const budgetsSnapshot = path.join(work, 'window-budgets.en.json');
  fs.copyFileSync(budgetsArg, budgetsSnapshot);
  budgetedExe = path.join(work, relocationsArg ? 'SLPS_022.33.budgets' : 'SLPS_022.33');
  budgetSummary = JSON.parse(run('window-budget-patch.mjs', inPlaceExe, budgetsSnapshot, budgetedExe, path.resolve(outputDir, 'window-budgets-report.json')));
  console.log(JSON.stringify(budgetSummary, null, 2));
  if (!relocationsArg) console.log(run('glyph-budget.mjs', budgetedExe, memorySnapshot, path.resolve(outputDir, 'glyph-budget.json')));
}
let relocationSummary = null;
if (relocationsArg) {
  step('Executable: relocating long strings');
  const relocationsSnapshot = path.join(work, 'relocations.en.json');
  fs.copyFileSync(relocationsArg, relocationsSnapshot);
  // Glyph budgets are measured before relocation, while every slot still maps to its memory item.
  console.log(run('glyph-budget.mjs', budgetedExe, memorySnapshot, path.resolve(outputDir, 'glyph-budget.json'), `--relocations=${relocationsSnapshot}`));
  relocationSummary = JSON.parse(run('relocate-strings.mjs', 'apply', budgetedExe, memorySnapshot, relocationsSnapshot, path.join(work, 'SLPS_022.33'), path.resolve(outputDir, 'relocations-report.json')));
  console.log(JSON.stringify(relocationSummary, null, 2));
}

step('Event dialogue');
console.log(run('texttool.mjs', 'insert-raw-grouped', extracted('IV_DAT.EVE'), path.join(catalogs, 'event-strings.en.json'), path.join(work, 'IV_DAT.EVE')));

step('Graphics');
run('title-subtitle-patch.mjs', extracted('CG_01.DAT'), extracted('SLPS_022.33'), path.join(work, 'CG_01.title.DAT'), path.join(work, 'title-preview.png'));
run('ui-label-patch.mjs', path.join(work, 'CG_01.title.DAT'), path.join(work, 'CG_01.gfx.DAT'), work);
run('battle-ui-patch.mjs', extracted('CG_02.DAT'), extracted('SLPS_022.33'), path.join(work, 'CG_02.gfx.DAT'), work);

step('Archive data text (names, country descriptions, profiles)');
const dataCatalog = dataCatalogArg ?? path.join(path.dirname(memoryPath), 'data.en.json');
const dataSnapshot = path.join(work, 'data.en.json');
fs.copyFileSync(dataCatalog, dataSnapshot);
const dataOut = path.join(work, 'data-text');
console.log(run('datatext.mjs', 'insert', extractedDir, dataSnapshot, path.join(work, 'CG_01.gfx.DAT'), path.join(work, 'CG_02.gfx.DAT'), dataOut));
fs.copyFileSync(path.join(dataOut, 'CG_01.DAT'), path.join(work, 'CG_01.DAT'));
fs.copyFileSync(path.join(dataOut, 'CG_02.DAT'), path.join(work, 'CG_02.DAT'));

step('Rebuilding disc image');
const manifestPath = extracted('manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = ['SLPS_022.33', 'IV_DAT.EVE', 'CG_01.DAT', 'CG_02.DAT'];
files.forEach((file, i) => console.log(run('patch-disc.mjs', 'replace', i === 0 ? binPath : outBin, manifestPath, file, path.join(work, file), outBin)));

step('Verifying replaced sectors');
const checks = [];
for (const file of files) {
  const entry = manifest.files.find(f => f.path.toUpperCase() === file);
  const last = entry.lba + Math.ceil(entry.size / 2048) - 1;
  const lbas = [entry.lba, Math.floor((entry.lba + last) / 2), last];
  const lines = run('patch-disc.mjs', 'verify', outBin, ...lbas.map(String)).split(/\r?\n/).map(l => JSON.parse(l));
  if (!lines.every(l => l.edc && l.eccP && l.eccQ)) throw new Error(`EDC/ECC check failed for ${file}`);
  checks.push({ file, lbas });
}

const report = {
  built: new Date().toISOString(),
  image: outBin,
  cue: outBin.replace(/\.bin$/i, '.cue'),
  sha256: sha256File(outBin),
  files: Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(work, f))).digest('hex')])),
  sectorChecks: checks,
  windowBudgets: budgetSummary,
  relocations: relocationSummary,
  runtimeVerified: false,
};
fs.writeFileSync(path.resolve(outputDir, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
