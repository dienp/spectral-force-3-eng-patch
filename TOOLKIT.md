# Toolkit reference

Per-tool details for the scripts in `tools/`. For the player guide and the
step-by-step translation workflow, see [README.md](README.md).

This is a dependency-free research and translation toolkit for the Japanese
PlayStation release `SLPS-02233`. It does not contain game data. Use it with a
disc image you own and distribute patches, not the original game files.

## What already works

- Read and extract the single-track Mode 2/2352 BIN image.
- Inventory the ISO-9660 filesystem and record every file's LBA and size.
- Extract Shift-JIS text from the main PS-X EXE and `IV_DAT.EVE`.
- Reinsert translations without changing file sizes or pointer locations.
- Convert the PS-X EXE payload to a MIPS ELF analysis wrapper.
- Find and export valid PlayStation TIM images as BMP files.
- Replace a same-size file in the raw BIN and correctly regenerate Mode 2 Form
  1 EDC, P parity, and Q parity.

The current safe translation mode is in-place. Every translation must fit the
encoded `maxBytes` value recorded in its catalog. Although ordinary ASCII would
be compact, the stock dialogue renderer does not visibly render it; the
verified full-width Latin fallback also uses two bytes per character. A compact
English font/renderer patch is therefore the next required milestone.

## Quick start

Run commands from this directory with Node.js 20 or newer.

```powershell
node .\tools\psxiso.mjs extract "E:\path\game.bin" .\work\extracted

node .\tools\texttool.mjs extract `
  .\work\extracted\SLPS_022.33 `
  .\work\text\executable-strings.json

node .\tools\texttool.mjs extract-raw-grouped `
  .\work\extracted\IV_DAT.EVE `
  .\work\text\event-strings-grouped.json
```

Translate by filling each `translation` field. Preserve control tokens such as
`#n`, which is the game's line-break marker.

```powershell
node .\tools\texttool.mjs insert `
  .\work\extracted\SLPS_022.33 `
  .\work\text\executable-strings.json `
  .\work\patched\SLPS_022.33

node .\tools\texttool.mjs insert-raw-grouped `
  .\work\extracted\IV_DAT.EVE `
  .\work\text\event-strings-grouped.json `
  .\work\patched\IV_DAT.EVE
```

Patch one translated file into a copy of the original disc. Repeat the command
using the previously produced BIN as input when patching a second file.

```powershell
node .\tools\patch-disc.mjs replace `
  "E:\path\game.bin" `
  .\work\extracted\manifest.json `
  SLPS_022.33 `
  .\work\patched\SLPS_022.33 `
  ".\work\patched\Spectral Force English.bin"
```

The command also writes a matching CUE. Check modified data sectors with:

```powershell
node .\tools\patch-disc.mjs verify `
  ".\work\patched\Spectral Force English.bin" 23 24 514
```

All three fields (`edc`, `eccP`, and `eccQ`) should be `true`.

## Build the English disc

One command rebuilds the full English image from your original BIN. It
patches the font and translations into the executable, inserts the event
dialogue, edits the title and interface graphics, inserts the names, country
descriptions and profiles stored in the CG archives (`data.en.json`), then
replaces the four files in a copy of the BIN and verifies them:

```powershell
node .\tools\build-english.mjs "E:\path\game.bin" .\work\extracted `
  .\work\translation\memory.en.json .\work\release
```

The output is `work\release\Spectral Force - Lovely Wickedness (English).cue`
plus `build-report.json`. The original BIN is checked against its documented
hash and never modified. Close any emulator that has the previous output open
first, or build into a new folder. The build boots to the opening movies in
DuckStation; in-game text screens and hardware are not yet verified.

## Make a distributable patch

Create a BPS patch from the original BIN and the English build. Only changed
bytes go into the patch; see [PATCHING.md](PATCHING.md) for player instructions.

```powershell
node .\tools\bps.mjs create "E:\path\game.bin" `
  ".\work\release\Spectral Force - Lovely Wickedness (English).bin" `
  ".\work\release\patch\Spectral Force - Lovely Wickedness (English).bps"
```

## ASCII font patch

Make the dialogue renderer draw single-byte ASCII with the game's own Latin
glyphs and proportional spacing. Apply it to the original executable, then
insert translations into its output:

```powershell
node .\tools\ascii-font-patch.mjs .\work\extracted\SLPS_022.33 .\work\patched\SLPS_022.33.font
node .\tools\texttool.mjs insert .\work\patched\SLPS_022.33.font `
  .\work\text\executable-strings.en.json .\work\patched\SLPS_022.33
```

The patch refuses input that is not the original revision. Two ASCII
characters share one glyph slot when they fit, so English uses no more of each
text window's slot budget than the Japanese did. When editing the hook
assembly, remember the R3000 load delay slot: an instruction that uses a
register loaded by the previous instruction sees the old value (see
RESEARCH.md).

## Longer executable strings (opt-in relocation)

By default every executable translation must fit its Japanese slot. For
strings whose references are all known, `tools/relocate-strings.mjs` writes a
longer text into unreferenced, unreachable library code and repoints every
reference. List the strings in `work\translation\relocations.en.json` and pass
the file to the build:

```powershell
node .\tools\build-english.mjs "E:\path\game.bin" .\work\extracted `
  .\work\translation\memory.en.json .\work\release-v4 `
  --relocations=.\work\translation\relocations.en.json
```

Each entry gives the full `text` and, per location address, the exact
references to repoint. The memory's normal `translation` is still written to
the original slot as a fallback. To get the reference list for an id, run
`scan` on an executable that has the in-place translations, review it, and
paste it in:

```powershell
node .\tools\relocate-strings.mjs scan .\work\release-v4\build\SLPS_022.33.inplace `
  .\work\translation\memory.en.json tm_01948
```

The build stops if a listed reference is missing or an extra one is found. It
also stops if a reference points inside the string, copies its bytes inline,
or cannot be patched safely. Without `--relocations` the build is unchanged.

Longer text can still overflow its window. Each window has a fixed glyph-slot
budget, and a full line can run past the panel edge even when it fits the
budget. The build writes `glyph-budget.json`. You can also run the check alone:

```powershell
node .\tools\glyph-budget.mjs .\work\release-v4\build\SLPS_022.33.inplace `
  .\work\translation\memory.en.json .\work\glyph-budget.json `
  --relocations=.\work\translation\relocations.en.json
```

Windows marked `OVERFLOW` lose their last glyph to the `~` marker. Windows
marked `tight` have one free slot or none. For `grows`, the English uses more
slots than the Japanese in a window built from several strings, so check that
screen in game.

## Larger window budgets (opt-in)

A window's glyph budget is a constant in the code that opens it. To raise one,
list the window in `work	ranslationwindow-budgets.en.json` and pass the file
to the build with `--budgets` (it can be combined with `--relocations`):

```powershell
node .\tools\build-english.mjs "E:\path\game.bin" .\work\extracted `
  .\work\translation\memory.en.json .\work\release-v8 `
  --budgets=.\work\translation\window-budgets.en.json `
  --relocations=.\work\translation\relocations.en.json
```

Each entry names the builder call (`call`), the `ori` that sets its budget
(`set`), the window index, and the old and new budget (`from`, `to`). The
tool stops, writing nothing, if any of these do not match the executable, if
another branch or jump can reach the call with a different budget, or if the
same instruction feeds another window. Raised budgets come from a shared pool
of 256 slots, so measure the pool on the target screen before raising one
(see RESEARCH.md, "Window budgets").

## Decompilation

The preferred route is to import the original `SLPS_022.33` into Ghidra with
the community [PlayStation loader](https://github.com/lab313ru/ghidra_psx_ldr).
Use the loader release that exactly matches the installed Ghidra version.

As a portable fallback, create a standard MIPS ELF wrapper:

```powershell
node .\tools\psxexe-to-elf.mjs `
  .\work\extracted\SLPS_022.33 `
  .\work\analysis\SLPS_022.33.elf
```

The wrapper maps the payload at `0x80010000` and sets the entry point to
`0x80079CC0`. It is an analysis artifact, not a playable executable. Decompiled
output is reconstructed pseudocode, not the original source code.

## Graphics

Scan or export valid TIM images from an archive:

```powershell
node .\tools\timtool.mjs scan .\work\extracted\CG_01.DAT
node .\tools\timtool.mjs extract .\work\extracted\CG_01.DAT .\work\tim\cg01
```

The exporter currently uses the first CLUT row. Multi-palette TIMs may have
additional palette variants not represented by the BMP preview.

## Important limitations

- String relocation is a prototype. It covers 13 strings; the faction role
  table (mode 1) is the only one not yet seen in game. It cannot move strings that the code
  copies inline or reads at fixed offsets inside the string (for example the
  `Rank Troops Morale` header).
- ASCII is drawn by the font patch in the main text builder. The Personal
  data stat panel uses a separate 8x8 renderer that only draws full-width
  katakana, capitals, digits and a few symbols (see RESEARCH.md).
- Accented Latin, Cyrillic, Greek, and other scripts require a font/renderer
  modification and a new encoding table. The present writer deliberately
  rejects characters absent from Shift-JIS.
- The text detector is intentionally broad. Review candidate catalogs before
  translating; some binary data can decode as plausible Shift-JIS.
- STR movies and XA audio are inventoried but not rebuilt or translated.
- Test every patch in an emulator, then on hardware if physical-disc support is
  a goal. The current font-test image has booted in DuckStation and displayed a
  full-width English prompt; hardware remains untested.

See [RESEARCH.md](RESEARCH.md) for the evidence and recommended next phase.
See [PROGRESS.md](PROGRESS.md) for the current milestone, verified runtime
results, and prioritized roadmap. Contributors and coding agents should also
follow [AGENTS.md](AGENTS.md).
