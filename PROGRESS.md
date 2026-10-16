# Project progress and roadmap

Status date: 2026-10-16 (string relocation prototype added)

## Goal

Create a reproducible English localization pipeline for the Japanese
PlayStation release of *Spectral Force: Itoshiki Jaaku* (`SLPS-02233`), while
keeping the tooling suitable for additional languages later. The intended
release artifact is a patch applied to a legally owned disc image, never a
redistributed game image.

## Completed and verified

### Disc and executable analysis

- Identified the supplied disc as `SLPS-02233` and recorded its hashes in
  `RESEARCH.md`.
- Parsed the single-track Mode 2/2352 image and extracted all 80 ISO entries.
- Confirmed the main executable is `SLPS_022.33`, loaded at `0x80010000`, with
  entry point `0x80079CC0`.
- Created a MIPS ELF analysis wrapper at `work/analysis/SLPS_022.33.elf`.
- Found a large direct-pointer table beginning near executable offset
  `0xB9300`.

### Text extraction and reinsertion

- Extracted 9,337 Shift-JIS candidates from the main executable.
- Scanned `IV_DAT.EVE`, producing 7,533 grouped dialogue candidates across
  95,344 occurrences after filtering obvious dummy-event text.
- Implemented in-place insertion with original-byte verification and strict
  `maxBytes` enforcement.
- Confirmed `#n` is used as an embedded line-break token. Other `#` tokens
  remain renderer/control-code candidates and must be preserved.

### Archives and graphics

- Identified fixed-record layouts for the major `.DAT` archives.
- Exported valid TIM images from `CG_01.DAT`, `CG_02.DAT`, `IV_CG.DAT`, and
  `WAZA.DAT`.
- Located the title screen image; the Japanese subtitle beneath the logo is
  baked into artwork rather than supplied by the nearby executable string.
- Inventoried STR movies, XA audio, VAB audio-bank data, and sequence data.

### Disc rebuilding

- Implemented same-size file replacement in the raw BIN.
- Regenerated Mode 2 Form 1 EDC, P parity, and Q parity for touched sectors.
- Rebuilt bootable BIN/CUE images without changing the original image.

### Runtime tests

- Installed a portable DuckStation copy under `work/duckstation` and booted the
  patched image with a Japanese BIOS.
- Verified that the original title screen and New Game flow run correctly.
- Proved that ordinary single-byte ASCII is consumed by the renderer but
  appears blank.
- Proved that Shift-JIS full-width Latin glyphs render. The current font test
  visibly displays:

  ```text
  ＭＥＭＯＲＹ　ＣＡＲＤ
  ＰＲＥＳＳ　○　ＴＯ　ＳＴＡＲＴ
  ```

- Saved the verified prompt in DuckStation game save slot 1.

### Translation and English build (2026-10-16)

- **All text is translated.** In `work/translation/memory.en.json`:
  - Executable: 3,771 entries are `agent-draft`. This includes a readability
    rewrite of the 166 early local-model drafts in
    `batches/exe-review-machine.out.json`.
  - Event dialogue: all 7,515 entries are `agent-draft` (details below).
  - 2,126 entries have status `not-text`: binary false positives from the
    executable range `0x21C00`-`0xF5500`, plus one data fragment. They are
    never inserted; reasons are in `manual-notes.json`.
  - No entries are pending or `needs-manual-translation`.
- **Glossary:** `glossary.en.json` (639+ entries). ネウガード, ジャピトス and
  パウラス・ヌイ follow the official spellings on the world-map art (CG_01 TIM 2):
  Newgard, Japtos, Paulus-Nui. 烏丸 and 大蛇丸 have the short forms "Karasu"
  and "Orochi" for 6-8 byte slots.
- **Fragments:** pieces the game assembles at runtime were traced statically
  (see `RESEARCH.md`) and translated to read correctly in their assembled
  order.
- **Layout:** 30 lines that would overflow their original width by more than
  20% had their line breaks rebalanced (`batches/layout-rebalance.out.json`).
  Byte counts are unchanged.
- **ASCII font patch** (`tools/ascii-font-patch.mjs`, evidence in
  `RESEARCH.md`): single-byte ASCII uses the font's own Latin glyphs with
  proportional spacing.
- **Graphics:**
  - `tools/title-subtitle-patch.mjs`: "Lovely Wickedness" subtitle on both
    title-logo copies in CG_01 (TIMs at `0x12A0A0` and `0xBE7000`).
  - `tools/ui-label-patch.mjs`: CG_01 resource, phase and date labels (TIM 1
    and 14).
  - `tools/battle-ui-patch.mjs`: CG_02 battle buttons (TIM 373) and formation
    banners (TIM 374).
  - A contact-sheet survey of every TIM in CG_01, CG_02, WAZA and IV_CG found
    no other interface text. IV_CG 180-199 are unused "ダミー" placeholders.
- **English disc:** `tools/build-english.mjs` produced
  `work/release/Spectral Force - Lovely Wickedness (English).cue` from the
  original BIN.
  - BIN SHA-256:
    `4403050cb67f01384bf8ec84f72a45f9928cb13ffa558c491fd330a8602ede16`. File
    hashes are in `work/release/build-report.json`.
  - Replaced files: `SLPS_022.33` (3,835 string slots), `IV_DAT.EVE` (95,344
    occurrences), `CG_01.DAT` and `CG_02.DAT`.
  - Each file was read back from the BIN and matches its build output. First,
    middle and last sectors pass EDC/ECC.
- **Archive data text (2026-10-16):** user testing found katakana names and
  untranslated country descriptions. These live in CG_01/CG_02 data blocks, not
  in the executable or event file (see `RESEARCH.md`). `tools/datatext.mjs`
  extracts 651 strings into `work/translation/data.en.json`: 265 roster names,
  41 factions, 40 country names, 40 country descriptions (stored twice) and 225
  profiles. All 646 real strings are translated; 5 blank placeholders are left
  as they are. Names follow the glossary (now 804 entries) and the world-map
  spellings. The build inserts them after the graphics patches.
- **Name-order fixes:** 28 messages whose Japanese starts with `#0` follow an
  inserted name, so they were rewritten to read after one
  (`batches/exe-name-order-fix.out.json`).
- **Boot fix (2026-10-16).** Builds with the first font hook hung on a black
  screen in DuckStation. Switching the lookup hook to a frameless tail call
  fixed the boot (see RESEARCH.md; the real cause was probably a load-delay
  hazard). `work/release` and `work/release-v2` hold older builds that the
  emulator kept open; do not use them.
- **Renderer fixes after the first DuckStation play test (2026-10-16).**
  - **Paired glyphs.** Short windows reserve as few as 8 glyph slots. English
    used one slot per letter, so menus showed "LevM", "waM" or lost "End".
    Two ASCII characters now share one slot.
  - **Gradient table.** Patched so the right edge of wide pairs is visible.
  - **Overflow marker.** Changed from the mis-translated "MX" to `~`.
  - **Missed strings.** The 15 executable strings the extractor missed were
    added, including the trade, raid, walls and alliance prompts and the
    `自軍` header.
  - **Labels.** The space after rank labels was restored ("Lord Shinba").
- **Current build:** `work/release-v3/Spectral Force - Lovely Wickedness (English).cue`
  (SHA-256 `9f36e2f04367eb61ac286bb8baac8a9d28e3d50228d644e6b0f6c1d71b543687`).
- **Runtime test of that build (DuckStation, fresh boot, 2026-10-16).** Test
  setup:
  - Portable instance in `work/duckstation` (`portable.txt`, keyboard pad 1).
  - Scripted input from the original BIOS boot.

  Results:
  - The title shows the "Lovely Wickedness" subtitle and English
    NEW GAME / CONTINUE / OPTION.
  - Memory-card notices are in English.
  - The country select reads "A unique island nation. Its lively youth strive
    to make a new world." in full, with Muromachi Army / Power / Troops /
    Gens.
  - The first map turn shows "1000 AD", "Dawn.. A new year begins." and the
    Trade / Levy / End menu in full.
  - Trade leads to "Who will trade?", the merchant dialogue, Sell/Buy and
    "End trade!".
  - The Muromachi Army / Lord Shinba labels were rebuilt but not re-checked.
  - The character profile and faction info screens were not reached in this
    test.
- **Release patch:** `work/release-v3/patch/` and
  `work/release-v3/Spectral Force - Lovely Wickedness (English) Patch.zip`
  (BPS, 5,822,778 bytes; source CRC32 `65c9509c`, target CRC32 `427e1e93`).
  - Applying it to the original BIN reproduces the build byte for byte.
  - A wrong source BIN is rejected.
  - User instructions: `PATCHING.md`.
- **Still unverified in game:** most screens. Open risks:
  - Windows whose budget equals the Japanese glyph count can still overflow
    (shown as `~`).
  - Unpatched text paths may still show blank ASCII.
  - Some runtime-assembled fragments may read oddly.
  - Graphics label coordinates are unchecked in game.
  - Drafts are `agent-draft` and still need a human review pass.
- Event dialogue (`IV_DAT.EVE`, 7,515 entries) is fully drafted. The 13
  entries first left as `needs-manual-translation` were resolved in
  `batches/evt-manual-fixes.out.json`:
  - 4 scans that started mid-character (`tm_10472`, `tm_12822`, `tm_13175`,
    `tm_13319`) are rewritten from the slot start. The renderer treats bytes
    from `0x80` up as Shift-JIS text, so this also removes the garbled lead
    characters.
  - `tm_09455` keeps its trailing lone `#`.
  - The name lines use "Karasu" and "Orochi".
  - The fragments get short literal English.

  Translated with
  `prepare.mjs 198 --event` (38 batches of 198 lines in catalog/scene order,
  with surrounding context) and validated by `merge.mjs`: invalidInCatalog 0.
  Catalog order and all non-translation fields match the pre-event backup
  `memory.en.backup-before-events.json`. Consistency fixes are in
  `batches/evt-fixes-00{1-4}.out.json`. Every entry is deduplicated text, so
  lines reused across scenes (`occurrenceCount` > 1) are kept generic. Some
  lines are cut short to fit their slots; a human review pass is still needed.
- Pipeline: `work/translation/pipeline/` (`prepare.mjs`, `merge.mjs`,
  `TRANSLATOR-GUIDE.md`); batch files are in `work/translation/batches/`.

### String relocation prototype (2026-10-16)

Executable translations can now be longer than their Japanese slot. This is
opt-in and covers only strings whose references are all known. Details are
in `RESEARCH.md` ("String relocation").

**Tools.**

| Tool | Purpose |
|---|---|
| `tools/mips.mjs` | MIPS decoder |
| `tools/exe-refs.mjs` | Reference index and reachability check |
| `tools/relocate-strings.mjs` | `scan` and `apply` |
| `tools/glyph-budget.mjs` | Per-window glyph-budget report |
| `build-english.mjs --relocations=<file>` | Runs the relocation step in the build |

**Relocation space.** The pool is 5,132 bytes of unreferenced, unreachable
Psy-Q debug code at `0x800ACE08`. Two kinds of evidence back it:

- Static: no reference of any kind points into it, and nothing reaches it.
- Runtime: save-state RAM matches the built executable after play.

**Prototype list.** `work/translation/relocations.en.json` holds 11 strings
at 12 locations.

**Build.** `work/release-v4`:

- BIN SHA-256: `d1ac6ba9129b8c6b1c1768614b18bac548ce5a67b19a44c2afdd2d816cc0605f`
- Executable SHA-256: `f39d6b88…6e8e39`
- Touched sectors pass EDC/ECC.

No BPS patch has been made for this build. `work/release-v3` is unchanged and
is still the release.

**In game (DuckStation, fresh boot of that exact build).** These now show in
full:

- "Solty: Tactician" (was "Tact.") in CREW > Post;
- "Move to Standby" (was "Move to Stby");
- "Tactician  Solty" on the Personal data header.

The faction role table (Tactician / Domestic / Diplomacy / Combat / Standby),
the Reinforcement / General / Steward headers and " replaces Tactician," were
not reached in game.

**Failure cases.** Every listed failure case stops the build: interior or
inline-copy references, a missing or extra listed reference, a wrong location,
input without the in-place insert, a full pool, and changed pool bytes.

**Window report.**

- 1 window already overflows in v3: the music-test help, `tm_03431`.
- 4 windows are exactly full or have one free slot.
- The Character Status rank column (budget 18) cannot take full words without
  a budget patch.

### Window budget patch (2026-10-16)

Window glyph budgets can now be raised, opt-in. Details are in `RESEARCH.md`
("Budget patch").

- Tool: `tools/window-budget-patch.mjs`; build flag `--budgets=<file>`;
  list `work/translation/window-budgets.en.json` (3 windows).
- It changes only the `ori` immediate that sets a budget. It stops on any
  mismatch: original value, window index, the store it feeds, a jump into
  the sequence, or a shared instruction. All 8 failure cases were exercised.
- Relocation adds "Tactician" and "General" for the Character Status rank
  column (13 strings, 168 pool bytes).

**Build.** `work/release-v5`:

- BIN SHA-256 `7c4a1b27…f90b84a43`, executable `1a9112a1…e00cdc`.
- All 80 executable sectors pass EDC/ECC. No BPS patch was made.
  `release-v3` and `release-v4` are unchanged.

**In game (fresh boot of release-v5).**

- Character Status rank column: "Lord / Tactician / General" and
  "Lord / Tactician / Admin" in full. The window pool reads 182 of 256 there
  (172 before the raise).
- Personal data: "General  Brimorin" and "Steward  Brimorin".
- CREW > Post: "Brimorin replaces Tactician, / Solty steps down".

**Not checked in game.**

- The Movie Library help raise (budget 40 -> 44). The menu is locked on a new
  game.
- The mode-1 faction role table. One caller looks unreachable; the other
  needs a target faction in status 8, 12 or 13.
- The Reinforcement header.

### Analysis panel and event fixes (2026-10-16)

- **Analysis panel** (Personal data, bottom left). It is drawn by a second,
  8x8 renderer that reads 2 bytes per character and has only katakana,
  uppercase full-width letters, digits and 7 symbols. ASCII labels shifted
  everything by a byte and broke the rows. Labels are now `ＭＩＧＨＴ`,
  `ＩＮＴＥＬ`, `ＣＨＡＲＭ`, `ＤＩＰＬＯ`, `ＬＯＹＡＬ`; the header reads
  "Solty says: / Shinba's stats". Verified in game against the original.
- **Events stopping early.** Shortened event lines were padded with NUL, which
  the event script reads as "end". `texttool.mjs` now pads event slots with
  invisible `# ` pairs and keeps the original terminator. Verified: the
  opening event now plays on like the original (75+ lines checked).
- **Build.** `work/release-v8`: BIN SHA-256 `c98714e5…7b97`, executable
  `6f1cdf27…598a`, `IV_DAT.EVE` `6d3ac3a8…b0e4`. Same flags as release-v5.
  release-v6 and v7 are intermediate builds (v7 has the panel fix only).
- **User check (2026-10-16, release-v8):** the user played it in DuckStation
  and reported it looks good.
- **Not yet checked systematically:** other events, and any other screen
  that uses the 8x8 renderer.

## Current artifacts

| Artifact | Purpose |
|---|---|
| `RESEARCH.md` | Evidence, format findings, and technical analysis |
| `work/text/executable-strings.json` | Main executable text catalog |
| `work/text/event-strings-grouped.json` | Deduplicated event-dialogue catalog |
| `examples/start-screen-translation.json` | Small full-width-Latin runtime test |
| `work/start-screen-test/Spectral Force - Font Test.cue` | Latest verified boot image descriptor |
| `work/start-screen-test/Spectral Force - Font Test.bin` | Latest verified local test image |
| `work/analysis/SLPS_022.33.elf` | MIPS analysis wrapper; not playable |
| `tools/` | Extraction, insertion, archive, TIM, and disc-rebuild utilities |

The `work/` directory and disc images are local research artifacts and are
ignored by source control.

## What the runtime test changed

The initial English test inserted normal ASCII. The game drew the dialogue box
but no letters. This was not a disc-rebuild failure: the renderer did not map
those byte values to visible glyphs. A second build encoded short English text
with Shift-JIS full-width Latin characters and rendered successfully.

Full-width text is only a bootstrap technique. It uses two bytes per character,
has wide spacing, offers limited punctuation and casing, and will not fit most
English dialogue slots. A complete translation therefore depends on a font and
renderer solution.

## Next work, in priority order

### 0. String relocation follow-ups (from the 2026-10-16 prototype)

1. **Check what is still unverified in game** (General, Steward,
   " replaces Tactician," and the rank column are done; see "Window budget
   patch" above).
   - The mode-1 faction role table. `0x800405D4` looks unreachable; reach
     `0x80088728` through the diplomacy target handler with a faction in
     status 8, 12 or 13 (probably an ally or vassal), later in a campaign.
   - The Reinforcement header.
   - The Movie Library help raise (`0x8008236C`, 40 -> 44). Unlock needs the
     int16 at `0x80105930` above 0: a card with clear data, or a documented
     test-only RAM write. Measure the pool there before keeping the raise.
   - Remove an entry from `relocations.en.json` or `window-budgets.en.json`
     if it overflows.
2. **More budgets.** Use `glyph-budget.json` to pick other `tight` or
   `grows` windows; measure the pool on each screen first.
3. **Remaining abbreviations seen in game.** The Post submenu still shows
   "Tact."; the rank column says "Admin" where Post says "Steward".
4. **Scale up.**
   - Use `relocate-strings.mjs scan` to find all abbreviations with only
     address-forming references.
   - If 5 KB runs out, add more unreachable runs (about 27 KB found) to
     `POOLS`, each with a hash and a runtime check.
   - Strings that are copied inline or reached through `$gp` cannot move this
     way; they need code changes.
5. **Pixel width.** Labels in fixed panels ("TotPwr:") are limited by width,
   not bytes, and need layout work or shorter wording.
6. **Release.** Regenerate the BPS patch only after the relocated screens are
   verified.

### 1. Trace the text renderer and locate the font

- Import the ELF or original executable into Ghidra with a matching PS1 loader.
- Start from references to a known prompt such as executable offset `0x1E444`.
- Identify the string loop, Shift-JIS lead-byte handling, glyph-index
  calculation, font upload/draw routine, character advance, box width, and all
  `#` control codes.
- Locate the raw glyph bitmap or runtime font tiles. It is not currently known
  to be a standard TIM image.
- Record function addresses and provisional names in `RESEARCH.md`.

Exit criterion: one normal ASCII character renders through a documented,
repeatable code or font-table change.

### 2. Implement a compact English font path

- Prefer mapping single-byte printable ASCII to newly supplied or repurposed
  glyph slots.
- Determine whether fixed-width output is acceptable; otherwise add a width
  table and variable character advance.
- Preserve Japanese decoding as a fallback until all menus and proper nouns
  are migrated.
- Add automated checks for encoded length, unsupported characters, control
  tokens, and text-box width.

Exit criterion: a multi-line English prompt using ordinary ASCII renders with
readable spacing and no corruption.

### 3. Decode event records before bulk translation

- Separate true text fields, pointers, flags, speaker identifiers, and event
  bytecode within each `0x800` record.
- Reduce false positives from the broad Shift-JIS scan.
- Assign stable semantic IDs so repeated lines share translations safely.
- Test representative event records in game before translating the full set.

### 4. Translate the executable and first playable route

- Build a glossary for names, countries, ranks, interface terms, and recurring
  commands.
- Translate title-adjacent prompts, country selection, options, status labels,
  and one complete New Game route.
- Capture screenshots at each screen and verify wrapping, selection markers,
  and control-code behavior.

### 5. Translate graphics and media-dependent text

- Replace the baked Japanese subtitle in the title TIM while preserving its
  original dimensions, bit depth, palette structure, and archive slot size.
- Inventory other UI text baked into TIM assets.
- Treat STR movie subtitles and XA audio as separate later milestones.

### 6. Generalize for multiple languages

- Introduce a language-neutral catalog with stable source IDs and per-locale
  text fields.
- Define glyph coverage and encoding per language rather than assuming
  Shift-JIS.
- Add per-language line-width validation and reproducible builds.

### 7. Package a legal release

- Done (beta): BPS patch against the documented original image
  (`tools/bps.mjs`, `PATCHING.md`).
- Include hashes, build instructions, emulator/hardware verification notes,
  and no copyrighted game data.

## Runtime testing workflow

1. Build a new executable from the original extracted executable.
2. Rebuild a new BIN/CUE from the original BIN.
3. Start the new CUE in DuckStation and click inside the game viewport so it
   receives keyboard input.
4. Current keyboard mapping: arrow keys = D-pad, `L` = Circle/confirm, `K` =
   Cross/cancel, and Enter = Start.
5. Save a state at the screen under test after confirming the new build is
   loaded.

Important: a save state restores emulated RAM. Loading a state created with an
older executable can restore the old strings and code even when a newer disc is
mounted. For executable/font changes, boot the new image and create a fresh
state. Existing states are safe navigation shortcuts only for the exact build
that created them, or for data that has not already been loaded into RAM.

## Known risks and open questions

- The complete font location and glyph format are unknown.
- Only `#n` has a strongly supported meaning; other control tokens need dynamic
  confirmation.
- Broad binary scans include false positives.
- In-place slots are too small for natural English. Executable relocation now
  exists as a prototype, but only for strings whose references are all
  addresses (no inline copies). Window glyph budgets and fixed pixel widths
  still limit what fits. Event dialogue (`IV_DAT.EVE`) has no relocation path
  yet.
- Pointer tables and event records may contain hidden length or alignment
  constraints.
- TIM previews currently select only the first CLUT row.
- The title subtitle and some menus require graphics editing rather than text
  replacement.
- Hardware compatibility has not been tested.

