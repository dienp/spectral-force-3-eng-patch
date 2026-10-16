# Reverse-engineering findings

## Identity and disc layout

The supplied image is the original Japanese release identified by executable
serial `SLPS_022.33` (`SLPS-02233`). Public catalog records identify the title
as *Spectral Force: Lovely Wickedness*, released in Japan on 26 August 1999 by
Idea Factory.

- BIN SHA-256: `b78cfcf2ed3b471ddf3dc1eb35ea00347746da616933119eb0eeab04e7b950e7`
- CUE SHA-256: `422f3f75dd980c68824bf53860d0e8735c969ae7ac14d85867157d230c7de254`
- One track: `MODE2/2352`
- 80 ISO files, including directories
- Boot command: `BOOT = cdrom:\\SLPS_022.33;1`

The image layout agrees with the documented PlayStation use of ISO-9660 over
CD-XA Mode 2 sectors. Form 1 data sectors have 2048 data bytes plus EDC/ECC;
Form 2 is used by XA/STR media. The disc patcher preserves the original raw
image and only replaces Form 1 user data for a same-size file.

References:

- [PSX-SPX CD-ROM format](https://psx-spx.consoledev.net/dev/ps1/cdr/cdromformat/)
- [Game/serial record](https://psxdatacenter.com/games/J/S/SLPS-02233.html)

## Main executable

Observed PS-X EXE header:

| Field | Value |
|---|---:|
| File size | 1,007,616 bytes |
| Payload load address | `0x80010000` |
| Payload size | `0xF5800` (1,005,568 bytes) |
| Entry point | `0x80079CC0` |
| Initial stack | `0x801FFFF0` |

The payload starts immediately with Shift-JIS dialogue. Static extraction found
9,337 Japanese string candidates. Of those, 3,346 have at least one directly
stored 32-bit RAM pointer, with 3,551 direct references in total. A conspicuous
reverse-ordered pointer table begins around executable file offset `0xB9300`.
This makes the executable text unusually accessible for an initial patch.

The recurring token `#n` is embedded in dialogue and is strongly inferred to
mean a displayed line break. It must be preserved until renderer behavior is
confirmed dynamically.

The supplied `psxexe-to-elf.mjs` wrapper makes the code importable by generic
MIPS-aware analysis tools. The better long-term route is the maintained
[Ghidra PSX loader](https://github.com/lab313ru/ghidra_psx_ldr); its release page
publishes builds tied to specific Ghidra versions.

## Event and asset archives

Several large files are exact multiples of fixed record sizes:

| File | Size | Inferred records | Record size | Findings |
|---|---:|---:|---:|---|
| `IV_DAT.EVE` | 55,296,000 | 27,000 | `0x800` | Event/dialogue records |
| `WAZA.DAT` | 66,150,400 | 190 | `0x55000` | Battle-technique graphics/data |
| `IV_CG.DAT` | 15,564,800 | 200 | `0x13000` | Mostly 320x220 TIM images |
| `CG_02.DAT` | 8,859,648 | 618 | `0x3800` | Portrait/UI graphics and data |
| `CG_01.DAT` | 12,662,784 | 229 | `0xD800` | Mixed graphics/data |
| `SOUND.DAT` | 886,784 | 433 | `0x800` | Indexed PS1 sound data |

The fixed-size interpretation is an inference from exact divisibility and
repeated structure; individual record headers still need to be named and
decoded. The literal string `Minku >><< IDEA FACTORY CdMixFile by Minku`
appears repeatedly in `IV_DAT.EVE` and `WAZA.DAT`, probably as a toolchain
watermark/filler. Its exact semantic role is not yet established.

The event file contains real Shift-JIS dialogue in its earliest records and
throughout the container. Broad scanning produced 338,614 occurrences. After
grouping identical text and excluding obvious dummy-event filler, the practical
catalog contains 7,533 unique groups and 95,344 occurrences. Repetition is
expected because event variants reuse dialogue and many short utterances.

Validated standard TIM counts:

| Archive | Valid TIM images |
|---|---:|
| `CG_01.DAT` | 408 |
| `CG_02.DAT` | 376 |
| `IV_CG.DAT` | 200 |
| `WAZA.DAT` | 154 |
| `IV_DAT.EVE` | 0 |
| `SLPS_022.33` | 0 |

`SOUND.DAT` contains a `pBAV` VAB bank header and many `pQES` sequence headers.
The `.STR` directories contain battle and ordinary movies, and `XA` contains
streamed audio. These are independent localization tracks (subtitles, dubbed
audio, or baked video text) and are not part of the first text-only milestone.

Sony's original TIM documentation describes the format as directly loadable to
PlayStation VRAM: [Psy-Q TIM file format](https://psx.arthus.net/sdk/Psy-Q/DOCS/FileFormat47.pdf).

## Translation architecture

The practical roadmap is:

1. Translate the executable and event catalogs in-place, preserving `#n` and
   each slot's byte limit.
2. Trace the text renderer in Ghidra from the pointer tables and Shift-JIS
   decoding loop. Identify glyph lookup, line width, text box width, and control
   codes before changing the encoding.
3. Locate the raw font or runtime glyph tiles. It is not a normal validated TIM
   in the executable or event file.
4. Add variable-width metrics if needed for readable English. Patch the
   renderer only after a minimal string replacement is visible in an emulator.
5. Translate baked menu graphics by editing the relevant TIM records and
   writing them back without changing their record sizes.
6. Only after the English pipeline is stable, introduce a language-neutral
   catalog (one source ID, multiple locale fields) and a custom single-/double-
   byte glyph mapping for languages outside Shift-JIS.
7. Build an xdelta/BPS-style patch from original to localized BIN. Never ship
   the copyrighted BIN or extracted assets.

## Decompilation boundary

“Decompilation” here means recovering MIPS functions, data references, and
pseudocode. It will not reproduce the original C source, names, comments, or
build system. The current environment could validate the MIPS ELF identity but
did not have a compatible deep MIPS decompiler configured. Consequently, text,
pointer, archive, and sector findings are observed statically; renderer details
remain an explicit next-phase unknown.

## Verification performed

- Extracted all 80 ISO entries.
- Confirmed original EDC, P parity, and Q parity on representative filesystem,
  executable, event, graphics, and boundary sectors.
- Patched one executable string and two grouped event-string occurrences while
  preserving original file sizes.
- Rebuilt a full 731,194,464-byte sample BIN/CUE.
- Revalidated EDC/ECC for all touched executable sectors sampled at the first,
  second, and final sector.
- Confirmed the sample BIN differs from the source by SHA-256.

## Runtime message assembly (static analysis, not yet runtime-verified)

Many short executable strings are fragments joined at runtime. Findings from
disassembling `SLPS_022.33` (addresses are RAM; file offset = address -
`0x80010000` + `0x800`):

- `gp` is set to `0x80104D08` at `0x80079D40`. The fragment pool at
  `0x80104D24`-`0x80105340` is reached both by `lui`/`addiu` pairs and by
  `gp`-relative loads; some short strings (`金`, `宝玉`, `家畜`, `劣鬼`, `既に`) are
  copied inline with fixed-size `lw`/`lh`/`lb` + `sw`/`sh`/`sb`, so their
  replacements must stay within the original byte length.
- `0x800A7AC4` behaves as `strcpy(dst, src)`; `0x800A7A14` as
  `strcat(dst, src)`; `0x8003C5D8` converts a number into a string buffer.
- `0x80050A5C(buf, speaker, x, type)` appends a speaker-personality ending to
  `buf`. The pointer at `0x800CA9E0` selects the policy row group at file
  `0xBA2D4` (12 personalities x 20 pointers, stride `0x50`). The `type`
  jump table at `0x80021B60` selects row column 19 (type 0, "did"), 18 (1,
  "could not"), 17 (2, copula), 16 (3, "became"), 15 (4, question) or 14 (5,
  "left"). About 50 call sites were listed by scanning for `jal 0x80050A5C`.
- The battle-commentary builder at `0x8008A384` concatenates a per-personality
  prefix (table `0x800CB38C`), the weather name (`0x800CC1E4`), `の状態で`
  (`0x800CB3BC`), `#n`, a terrain prefix (`0x800CB3EC`), the terrain name
  (`0x800CC208`) and a personality ending (`0x800CB41C`).
- Other builders: resource gain `0x8004CA30` (resource + `を` + number +
  `入手` + ending), raid loss `0x80052470` (faction + `の` + resource + text +
  number + text), year/month change `0x80034108`/`0x800342BC` (number + `年に`
  or `月に` + type-3 ending), year display `0x8003F094`, rank display
  `0x800473B4` (name + `は` + rank text), already-vassal `0x8004E5B0`.

English fragments in `work/translation/memory.en.json` were chosen so these
fixed orders read naturally: endings became punctuation or short clauses, and
type-3 endings are a single space with punctuation carried by the preceding
piece. The assembled strings have not been checked in the emulator yet.

## Dialogue font and ASCII patch (static analysis, not yet runtime-verified)

- The game does not use the BIOS Kanji ROM (no `B(51h)` Krom2RawAdd stub). Its
  own font lives in the executable: non-kanji glyphs at `0x800D8774`, kanji at
  `0x800DB47C`. Each glyph is 22 bytes: 11 rows of 16-bit big-endian bitmaps.
  The full-width Latin glyphs are narrow, with about 5-9 px of ink: `0`-`9` at
  index 147, `A`-`Z` at 157, `a`-`z` at 183; row-1 symbols index as
  `trail - 0x40` (`< 0x80`) or `trail - 0x41`. This was confirmed by rendering
  the bitmaps.
- `0x8007AE74(ptr)` reads a 2-byte code. It looks up `0x8140`-`0x84BE` in the
  non-kanji table and `0x889F`-`0x9872` in the kanji table. Anything else sets
  the error flag `gp+3260 = 0x270F` and falls back to `0x81A1`, which is why
  single-byte ASCII came out blank.
- `0x80079E28` is the message glyph-cache builder. It walks the string 2 bytes
  per character and handles `#`+code through a jump table (`#n` records a
  line break in `0x80111714`, `#0`-`#9` set the colour). For each glyph it
  unpacks it with a drop shadow (`0x8007ABB8`), uploads a 16x14 4bpp cell to
  VRAM at `(320 + slot%16*4, 256 + slot/16*16)` and builds a 13x13 sprite.
  The slot counter is at `gp+3280`.
- `0x8007A4A4` lays the sprites out each frame, starting a new line every 15
  px. The pen advances a fixed 13 px per glyph at `0x8007A770` and
  `0x8007A7D8`.
- `0x800A2F5C` estimates text width as `(bytes / 2) * 13`.
- `tools/ascii-font-patch.mjs` adds two hooks in the unreferenced function at
  `0x800C3CC4`:
  - **Glyph lookup** (`0x800C3CC4`, called from `0x8007A1F8` and
    `0x8007A210`). Shift-JIS keeps a 13 px advance and tail-jumps to the
    original lookup `0x8007AE74`. For bytes `0x20`-`0x7E` the hook builds the
    glyph itself:
    - It takes the full-width Latin glyph rows from the font at `0x800D8774`
      and shifts the ink to column 0.
    - When the next byte is also printable, is not `#`, and both advances
      total 15 px or less, it ORs that glyph in after the first one. Two
      bytes then share one glyph slot, as one Japanese character does.
      Otherwise the cursor steps 1 byte.
    - It writes the 11-row result to a 22-byte buffer, stores the pen advance
      for the slot, clears `gp+3260` (the unknown-glyph flag), and returns the
      buffer.

    It is a leaf routine with no stack frame.
  - **Layout** (`0x800C3E30`, called from `0x8007A7D8`): `pen += advance` of
    the slot. Glyph offsets and `left<<4 | advance` metrics are at
    `0x800C3E4C`, slot advances at `0x800C3F6A`, the buffer at `0x800C406A`.
    956 of 1,132 cave bytes are used.
  - Glyph sprites are 15 px wide instead of 13 (`0x8007A274` UV,
    `0x8007A718` quad). `u0 + 15` stays within the 256-pixel texture page.
- **Glyph slot budget (static analysis, confirmed at runtime 2026-10-16).**
  - The cache builder keeps up to 30 text windows. Each window record is
    36 bytes at `0x80111708`; byte 34 is the glyph budget.
  - The budget comes from the caller's 8th argument, at `sp+28` of the call.
    On first use the window reserves that many slots from a 256-slot pool,
    with the counter at `gp+2804`. The VRAM cells are 16x16 at
    `(320 + slot%16*4, 256 + slot/16*16)`.
  - When the glyph count reaches the budget, the builder draws the string at
    `0x80105334` (originally `満`) and stops.
  - Across the 254 call sites, 138 budgets are 60 slots, about 20 menus have
    8-10, and the largest is 250.
  - With one ASCII byte per slot, English overflowed short windows: "LevM",
    "waM", and a missing "End". The `満` marker had been translated "MX", so
    the overflow drew an "M". Pairing glyphs fixes this. The marker is now
    `~`.
- **Glyph converter `0x8007ABB8` (static analysis + emulation).**
  - Each source bit becomes ink one pixel to the right, with an outline on
    both sides.
  - Ink colour comes from a 13x16 gradient table at `0x800EB360`, which only
    this routine uses. Pixel `p` uses entry `p` when `p` is even and `p + 1`
    when it is odd.
  - Entries 13-15 hold the outline colour (15), so ink at output column 13
    or later was invisible. Paired glyphs lost their right edge in game
    ("Lcrd" for "Lord").
  - The patch copies each row's entry 12 into entries 13-15.
- **Load delay slots.** The R3000 load delay applies: the instruction right
  after a load sees the old register value. DuckStation emulates this. A
  draft of the paired hook used loaded values immediately, which rendered
  every glyph as a vertical bar.
  - The tool now pads every load that is used next with a `nop`. An
    interpreter that models the delay reproduced the bug and validated the
    fix.
  - The earlier "framed hook" hang (below) is likely the same class of bug,
    for example `lw ra` followed directly by `jr ra`. That was not
    re-tested.
- **Strings the extractor missed.** The executable scanner skipped strings
  that directly follow a jump table or pointer, because no NUL precedes them.
  - 15 were found by scanning for NUL-terminated Shift-JIS that no catalog
    entry covers. They are added to `memory.en.json` as `tm_13412`-
    `tm_13426` with code references. Examples are `誰が#2売買#0を行いますか？`
    (`0x10BBC`, from `0x80043E78`) and `#3自軍　　#1` (`0x1E904`).
  - `はいいいえ` (`0x1054C`) is only copied into a stack buffer that is never
    read, so it is left alone.
  - `tools/apply-translation-memory.mjs` adds such memory-only locations to
    the executable catalog. `texttool insert` still verifies their original
    bytes.

  **Boot hang with a framed lookup hook (DuckStation, 2026-10-16).** The first
  version of the lookup hook was a normal `jal` subroutine that saved `ra` in
  its own stack frame and then called `0x8007AE74`. Discs built with it
  stayed on a black screen at "Game: 0 FPS" in DuckStation (ePSXe had booted
  them). A bisect from the original BIN showed that even a hook with only
  the stack frame and no other change hangs, while the same hook as a tail
  jump boots. The frame itself was probably not the cause; see the load-delay note
  above. With the tail-call hook
  the full English disc (SHA-256 `57963f71…b28f09`) boots to the opening
  movies from a fresh DuckStation session. Text screens were not reached in
  that test because scripted key input did not register.

  The width estimate becomes 8 px per byte. Japanese keeps a 13 px advance. The
  1,132-byte cave had no calls, branches, pointers or `lui`/`addiu` references.
  Its original SHA-256 is checked by the tool.
- Other text paths (for example the code-table renderer at `0x800A3144`) have
  not been examined and may still show ASCII as blank.
- **Small 8x8 renderer `0x8007B57C` (static analysis + runtime, 2026-10-16).**
  - Used for the five stat rows of the Personal data "Analysis" panel. The
    rows are built by `0x800891C0` (labels `tm_03513`-`tm_03517`, bar
    `＝` at `0x801054CC`, blank `　` at `0x801054D0`, number via
    `0x8007B8F8`). Their pointer is stored at `0x801E0FD4` and drawn from
    the table at `0x801E0FC8` by `0x80063030`.
  - It always steps 2 bytes per character and 9 px per character. `#n`
    (`0x236E`) is only recognised on an even byte and moves down 8 px.
  - Drawable codes only: katakana `0x8340`-`0x8396`, uppercase full-width
    `Ａ`-`Ｚ` (`0x8260`-`0x8279`), digits `０`-`９`, and the 7 symbols
    `／％ー：＜＝＞` from `0x8002D460`. Anything else is a blank cell.
  - Single-byte ASCII therefore shifts every following character by one
    byte. With "Might" (5 bytes) the `#n` codes were missed, the five rows
    merged into three, and the bars ran into the Elem Res panel (seen in
    release-v4 to v5). Lowercase full-width letters (release-v6) kept the
    layout but drew only the first capital.
  - Fix (release-v7): labels `ＭＩＧＨＴ　`, `ＩＮＴＥＬ　`, `ＣＨＡＲＭ　`,
    `ＤＩＰＬＯ　`, `ＬＯＹＡＬ　`, 6 cells like the Japanese, so the bars
    start at the same x. Verified in game against the original disc: 5 rows,
    bars aligned, numbers inside the panel.
  - The header above it ("Solty says: / Shinba's stats", `tm_03326`,
    `tm_03327`) uses the normal builder; the old "By #b" text came out as
    "SoltyBy" because the name comes first.

## Event slot padding (runtime, 2026-10-16)

**Bug.** In every English build up to release-v7, events stopped after the
first line that was shorter than its Japanese slot. In the opening (new game,
Muromachi) only "・・・" was shown; the original continues with dozens of
lines, a tutorial battle, and recruits a third general.

**Cause.** In `IV_DAT.EVE` the event script continues with the next opcode
right after a line's terminating NUL. For example, at `0x1236127` the line
"僕のもとで．．働く？" (20 bytes) is followed by its NUL at `0x123613B` and the
opcode `12 00 60 00` at `0x123613C`. `texttool insert` padded shorter
translations with NUL, so the script read `00 00` and the event ended.

**Fix.** `texttool.mjs` (raw insert only; the executable path is unchanged)
keeps the original NUL at `offset + maxBytes` and fills the gap with
`# ` pairs. The builder `0x80079E28` skips `#` plus a byte outside its code
table (`0x8007A040` -> `0x8007A130`) without drawing or using a slot. An
odd gap gets one leading space; a translation ending in a lone `#` gets a
space to complete it. The tool stops if a slot has no NUL at
`offset + maxBytes` or if the padding does not fill the slot exactly.

**Checks (release-v8).**

- All 95,344 event slots end with NUL at `offset + maxBytes` in the original.
- In the built file: same size, 0 bytes changed outside slots, 0 terminators
  lost, no NUL inside any translated slot. One false-positive slot
  (`text_03571`, "よかったら#") ends a record and fills its slot exactly; it
  is unchanged in structure.
- In game (fresh boot, release-v8): the opening event now runs through
  "Work... under me?", "The war of demons and humans", and on past
  "Deplorable..." (75+ lines) with no visible padding. The rest of the
  opening and the tutorial battle were not followed to the end.

## Colour codes and text stored in data archives (static analysis)

- **Colour codes.** In the glyph-cache builder `0x80079E28`, `#` followed by a
  digit `0`-`9` goes through the jump table at `0x8002D470` and only sets the
  colour register `s1`. These codes are therefore colours, not name
  placeholders.
- **Names are concatenated before messages.** Example: the country
  confirmation at `0x80080F10` builds `gp+1700` (colour) + name +
  `#0ではじめます…`. Any message whose Japanese starts with `#0` follows an
  inserted name and must read correctly after one: "Muromachi#0: begin
  here.".
- **Package loader.** Packages are parsed by `0x8006B32C`: an array of 32-byte
  records `{type, count, first, size, ..., offset@28}`, terminated by `-1`.
  - Record type 9 is a string block. Every byte is stored minus `0x80`; the
    loader adds `0x80`, then fills the pointer table at `0x801ED734` by
    counting NULs.
  - In CG_01 (package at `0x9C000`) these blocks hold:
    - 40 country descriptions at `0xFB0A0` (3,290 bytes);
    - 40 country names at `0xFBD7A` (444 bytes);
    - a second package at `0xFC800` with the same descriptions at `0xFC840`.
  - The country-select screen (`0x80081104`) reads the descriptions through
    that table.
- **Name tables.** CG_01 `0xC0E080`-`0xC11A78` is a 0x38-byte record table:
  222 characters and unit names, then 43 countries from `0xC111B8`. Each
  record has an 18-byte Shift-JIS name field (at most 16 bytes of text) and
  stats from `+0x12`. Faction records follow at `0xC11A78` with a 0x8C
  stride, 41 records.
- **Profiles.** CG_02 `0x86C800` holds a table of 225 16-bit offsets followed
  by NUL-terminated profile strings, ending at `0x87048C`.
- **Tooling.** `tools/datatext.mjs` extracts all of the above, 651 strings.
  On insert it repacks the type-9 blocks (unused tail filled with spaces so
  the NUL count is unchanged) and the offset-table block (offsets rewritten).
  It verifies the original bytes first. A round trip with no translations
  reproduces both archives byte for byte.

## String relocation (static analysis + runtime, 2026-10-16)

Goal: let an executable translation be longer than its Japanese slot by
writing it somewhere else and repointing every reference.

### Where the space comes from

Three sources were considered:

1. **RAM past the executable: rejected.**
   - The payload ends at `0x80105800`, and the header's BSS fields are 0.
   - The memory right after it is in use: the window table is at
     `0x80111708`, and the package pointer table is at `0x801ED734`.
   - Proving a block free would need a RAM trace of the whole game.
2. **Slack in translated slots: rejected.**
   - These are the bytes left after a shorter English string.
   - 2,109 slots have references only to their start, but together they give
     just 6,920 bytes and the largest gap is 30 bytes.
   - The layout also changes whenever a translation changes.
3. **Unreferenced library code: used.**
   - The font patch already uses this kind of space at `0x800C3CC4`.

**Reference index (`tools/exe-refs.mjs`).** It finds 16,158 places where
`SLPS_022.33` forms an address inside its own payload:

- 7,166 aligned data words whose value lies in the payload. Every such word
  counts as a pointer, so the count is deliberately over-inclusive.
- 6,969 `lui` + `addiu`/`ori`/load/store pairs. The scan follows the `lui`
  register in a straight line until something overwrites it.
- 2,023 `$gp`-relative accesses, with `$gp` = `0x80104D08`.

**Code reachability.**

- Code runs from `0x80031440` (the first `jal` target) to `0x800C8AE4` (the
  last `jr ra` plus its delay slot).
- Starting points: the entry point plus every code address that any
  reference forms, including all jump-table and function-pointer words.
- 106 unreached runs that contain code remain, about 27,500 bytes in all.

**The pool.**

- The largest unreached run is `0x800ACE08`-`0x800AE214` (5,132 bytes). Its
  original SHA-256 is `4f9ab847…cfba71a`.
- It holds Psy-Q TMD and primitive debug routines. They call the debug-level
  getter `0x800A9CC8` and `printf` `0x800A8244`, and print strings such as
  `analizing TMD...` at `0x80030938`.
- Nothing calls, jumps into, points into or builds an address inside it.
- `relocate-strings.mjs` re-checks the hash, the zero references and the
  unreachability on every build.

**Runtime evidence (DuckStation, fresh boot, release-v4).**

- Save states were taken at two points: the month-1 map menu, and month 3
  CREW > Post on the final build.
- Each state was decompressed with zstd. RAM was located by searching for the
  executable's entry code, and the loaded image was compared with the built
  `SLPS_022.33`.
- The pool and every patched reference word are byte-identical in RAM.
- No translated string slot was written at runtime. The only catalog entry
  that changed is a false positive, `exe_0b479a` at `0x800C3F9A`. It sits
  inside the font patch's own slot-advance table, which is written at runtime
  by design.
- Code running in the pool would have crashed, because the pool now holds
  text. Screens visited:
  - Title, country select, months 1-3.
  - Trade, Levy, Swap Members, Countries.
  - Faction info, Character Status, Personal data, Post.

### Relocation step (`tools/relocate-strings.mjs`)

**Input.** `work/translation/relocations.en.json` lists the strings to move,
keyed by memory id. Each entry has:

- the full `text`;
- for each location address, the exact reference list, such as
  `pair:<lui>+<low>` or `ptr:<word>`;
- an optional `runtime` note recording what has been checked in game.

`relocate-strings.mjs scan` prints the references found for an id. The
memory's normal `translation` stays the in-place fallback.

**Build.** `build-english.mjs --relocations=<file>` runs these steps after
`texttool insert`:

1. Checks the pool: its original hash, no references into it, and not
   reachable.
2. For each listed location, checks that the slot holds the in-place
   translation, and that the scanned references match the listed set exactly.
3. Writes the text into the pool (4-byte aligned, padding zeroed) and patches
   each reference:
   - data pointers are rewritten;
   - for a `lui`/low pair, the low immediate is patched, and the `lui` is
     patched only when the high half changes and it serves only this address;
   - a `$gp` reference is patched only when the target is within ±32 KB of
     `$gp`, which the pool is not.
4. Rescans the output: every listed reference must now reach the new address,
   and none may still point at the old slot.

**Failure cases.** Each one stops the build before anything is written:

| Case | Example |
|---|---|
| Interior reference | `tm_01898` header `0x8002025C` (inline `lwl`/`lwr` copy at `0x800425A0`) |
| `$gp` inline copy | `tm_05748` `0x80104DE4` (`lw`/`lh`/`lb` at `0x8003F330`) |
| Listed reference missing | — |
| Extra reference listed | — |
| Wrong location address | — |
| Input without in-place insert | — |
| Pool too small | — |
| Pool bytes changed | — |

**Limits.**

- The scan follows registers in a straight line only. A `lui` in one block
  with its low half in another is missed.
- An address built from a table base plus a runtime index is not seen. For
  example, the role table at `0x800CC250` is read with
  `lui at,0x800D; addu at,at,v0; lw a1,-0x3DB0(at)`. Its entries are data
  pointers, so they are found and rewritten individually, but the base access
  itself is invisible.
- The reference lists are therefore reviewed by hand, and each relocated
  string still needs an in-game check.

### Prototype (release-v4)

**Build.**

- Command:
  `build-english.mjs <original bin> work/extracted work/translation/memory.en.json work/release-v4 --relocations=work/translation/relocations.en.json`
- BIN SHA-256:
  `d1ac6ba9129b8c6b1c1768614b18bac548ce5a67b19a44c2afdd2d816cc0605f`
- Executable SHA-256:
  `f39d6b88a583ea3f27f55b36a197ba9c20dfcde9f0a72c6451c3058ece6e8e39`
- The in-place executable (`SLPS_022.33.inplace`) is byte-identical to the
  release-v3 executable. Relocation changed 175 bytes, in:
  - 22 instruction words (11 `lui`/`addiu` pairs);
  - 4 pointers in the table at `0x800CC250`;
  - the first 148 bytes of the pool.
- 11 strings were moved: 12 locations, 144 bytes of pool, 4,988 bytes left.
- EDC, ECC P and ECC Q pass on every touched sector (LBA 23, 124, 134, 268,
  337, 400 and 514). The executable read back from the BIN matches the build
  output.

**Results.**

| Id | Japanese | In place | Relocated | In game |
|---|---|---|---|---|
| `tm_01948` | 軍師です | `Tact.` | `Tactician` | Verified: CREW > Post shows "Solty: Tactician". An earlier v4 build without this entry showed "Solty: Tact.". |
| `tm_01953` | 待機へ配属交代 | `Move to Stby` | `Move to Standby` | Verified: Post menu shows it in full. |
| `tm_05750` @ `0x801051B8` | 軍師　 | `Tact ` | `Tactician ` | Verified: Personal data header shows "Tactician  Solty". |
| `tm_05750` @ `0x80104E14`, `tm_05751`-`tm_05754` | 軍師/内政/外交/戦闘/待機 | `Tact`/`Dom.`/`Dipl`/`War`/`Stby` | `Tactician`/`Domestic`/`Diplomacy`/`Combat`/`Standby` | Not reached. These are drawn by mode 1 of `0x80041778`, called with `a0=1` from `0x800405D4` and `0x80088728`. |
| `tm_05830`, `tm_05831`, `tm_05833` | 援軍/武将/内政官 | `Aid`/`Gen.`/`Stwd` | `Reinforcement`/`General`/`Steward` | General and Steward verified in release-v5 (see "Budget patch" below). Reinforcement not reached. |
| `tm_01955` | が、現在の軍師、#n | ` replaces Tact.,` | ` replaces Tactician,` | Verified in release-v5: "Brimorin replaces Tactician,". |

**Dropped from the prototype.** `TotPwr:` (`tm_01885`, `tm_01902`) has
complete references, but the problem is pixel width, not bytes.

- "Total Power:" is 78 px wide; "TotPwr:" is 50 px.
- The Japanese label plus the padded number took about 104 px of a
  fixed-width panel.
- This is a static estimate; it has not been tested in game.

### Window budgets (`tools/glyph-budget.mjs`)

**Overflow rule.** The rule was checked in the code:

- The glyph count is incremented at `0x8007A154`.
- At `0x8007A1E4` a glyph is drawn normally only while `count < budget`.
- A window therefore shows at most `budget - 1` glyphs, and the next glyph
  becomes the `~` marker.

**How the tool reads each call to `0x80079E28`.**

- It reads the budget stored at `sp+28` and the `a0` source.
- For a stack buffer, it lists the constant strings copied into the buffer
  since the previous builder call. Strings chosen on different branches are
  all listed.
- Several screens set a budget and then `j` into one shared call. For
  example, `0x80042C58` sets 130 and jumps to `0x800436D0`, where the
  straight-line budget is 48. Each such jump is reported as its own entry.

**Report.** The report for the in-place build with the prototype
relocations is `work/release-v4/glyph-budget.json`:

| Status | Windows |
|---|---:|
| ok | 85 |
| tight | 4 |
| OVERFLOW | 1 |
| grows | 16 |
| dynamic | 170 |
| unknown budget | 3 |

`dynamic` means a buffer built at runtime with no net growth. `unknown
budget` means the budget is computed at runtime.

**Problem windows, with or without relocation.**

| Window | Budget | Problem |
|---|---:|---|
| `0x8008236C` | 40 | **Overflows today.** `tm_03431` (music-test help) needs 40 glyphs and 39 fit, so "Stop" loses its last letter. |
| `0x80083330`, `0x80083B78`, `0x80083E58` | 16 | Exactly full: `tm_03436` "Assets / Gold / Gems / Herd / Imps" uses 15 of 15. |
| `0x8008870C` | 10 | One free slot: `tm_03509` "General Status" uses 8 of 9. |
| `0x80085D48`, `0x800863FC` | 18 | Character Status rank column (`tm_05873`-`tm_05875`, `tm_03495`, `tm_03496`). The Japanese uses 2 glyphs per row. The column shows "Tact" in game. Full words such as "Tactician" (5 slots) need a larger budget, not just relocation. |
| `0x800436D0` via `0x80042C58` | 130 | Mode-1 role table: +3 slots for each Tactician, Domestic or Diplomacy row. The row count depends on the faction; not checked in game. |
| `0x80070798` | 20 | Role + `　` + name header. "Reinforcement " is 8 slots, so with an 8-slot name about 17 of 19 are used. |
| `0x80050A28` (+10), `0x80048C0C` (+7), others +1 to +2 | — | Windows built from several strings that use more slots in English than in Japanese. |

**Pool headroom.** The window-slot pool counter (`$gp+2804` = `0x801057FC`)
read 165 of 256 in both save states. That leaves 91 slots for raising a
budget on those screens. Other screens may open more windows.

**Two constraints remain even with relocation:**

- the glyph budget of the window;
- the pixel width of fixed panels and columns.

### Budget patch (`tools/window-budget-patch.mjs`, 2026-10-16)

**How the pool works (static analysis, confirmed in RAM).**

- `0x80079E1C` resets the pool counter (`$gp+2804` = `0x801057FC`) to 0
  when a screen clears its windows.
- On a window's first use, `0x80079EE8`-`0x80079F20` stores the current
  counter as the window's first slot (record byte 1), adds the budget to the
  counter, and stores the budget in record byte 34.
- If the counter is 256 or more (`0x80079E80` before, `0x80079F24` after),
  the window is disabled (record byte 0 = 0) and nothing is drawn. So a
  raised budget must leave the screen's total at 256 or below.

**Patch.** The budget is the 16-bit immediate of `ori rX,zero,N` that feeds
`sw rX,28(sp)` before `jal 0x80079E28`. The tool changes only that
immediate. For each entry in `work/translation/window-budgets.en.json` it
checks, before writing anything:

- the call is `jal 0x80079E28` and its `a2` window index matches;
- the straight-line budget store is fed by the listed instruction, which is
  `ori/addiu rX,zero,<from>`;
- no branch, jump or code pointer lands between that instruction and the
  call;
- the instruction feeds no other builder call, and no entry is listed twice;
- the new budget is 1-255 (the record keeps one byte).

Afterwards it re-reads each budget the way `glyph-budget.mjs` does.
Exercised failure cases, each rejected: wrong original budget, wrong window
index, a `set` address that does not feed the store, a `call` that is not the
builder, budget 300, a duplicate entry, `0x800436D0` (reached by `j` from
`0x80042C58` with budget 130), and a second application to an
already-patched executable.

| Call | Set | Window | Budget | Screen |
|---|---|---:|---|---|
| `0x80085D48` | `0x80085D2C` | 3 | 18 -> 28 | Character Status rank column |
| `0x800863FC` | `0x800863E0` | 3 | 18 -> 28 | same column after scrolling |
| `0x8008236C` | `0x80082350` | 0 | 40 -> 44 | Movie Library help (`tm_03431`) |

The rank column holds 6 rows per page (`slti v0,v0,6` at `0x80085D0C`).
With full words the worst case is Tactician (5 slots) + Admin (4) + 4 x
General (4) = 25 glyphs; 27 fit at budget 28.

**Release-v5 build.**

- Command: `build-english.mjs <original bin> work/extracted
  work/translation/memory.en.json work/release-v5
  --budgets=work/translation/window-budgets.en.json
  --relocations=work/translation/relocations.en.json`
- BIN SHA-256:
  `7c4a1b277340bc43cf0365adfe6cde935e36eb8f5723903dcaa0f35f90b84a43`
- Executable SHA-256:
  `1a9112a135f1056255dbe4d26ae08aeff4ce34d171bd8cc1d3d1db9a78e00cdc`
- The in-place executable is byte-identical to release-v4's. The budget step
  changes 3 bytes. Relocation now moves 13 strings (adds `tm_05874`
  "Tactician#n" and `tm_05875` "General#n" for the rank column): 168 pool
  bytes used, 4,964 free.
- All 80 executable sectors pass EDC, ECC P and ECC Q, and the executable
  read back from the BIN matches the build. Versus release-v4, sectors 252,
  259, 260 and 337 differ.

**Runtime (DuckStation portable, fresh boot of release-v5, Muromachi).**

| Screen | Expected | Seen | Pool counter |
|---|---|---|---:|
| Character Status, month 1 | Lord / Tactician | "Lord", "Tactician" in full | 182 |
| Character Status, month 3, Brimorin scouted | Lord / Tactician / General | all in full | 182 |
| Same, after Post > Steward | Lord / Tactician / Admin | all in full | — |
| Personal data, Brimorin | General / Steward header | "General  Brimorin", "Steward  Brimorin" | 180 |
| CREW > Post, Brimorin as tactician | " replaces Tactician," | "Brimorin replaces Tactician, / Solty steps down" | — |

- Pool readings come from save-state RAM. On Character Status, windows 1, 2,
  3 and 0 hold 21 + 73 + 28 + 60 = 182 slots. With the original budget the
  total is 172, so the screen has 74 slots to spare.
- Personal data resets the pool (5 windows, 180 slots), so the rank-column
  raise does not carry over.
- "Tactician" ends close to the Troops column. It fits, but a longer rank
  word would overlap: the column is limited by width as well.
- The Post submenu still shows "Tact." (a separate string, not in the
  relocation list).

**Not verified in game.**

- Movie Library help (`0x8008236C`). Sound Test and Movie Library are
  greyed out on a new game. Both are enabled only when the int16 at
  `0x80105930` is above 0 (`0x80081F24`, `0x80081F70`, `0x800821B0`,
  `0x800822A8`); it is incremented at `0x8009BB40` and `0x8009CA1C`
  (memory-card code, not traced). Testing needs a card with clear data or a
  test-only RAM write; neither was done.
- Mode-1 role table (`tm_05750` at `0x80104E14`, `tm_05751`-`tm_05754`).
  `0x80041778` dispatches on `a0` through the table at `0x800203A4`; mode 1
  is `0x800422DC`, ending with budget 130 at `0x80042C58`. Its two callers:
  - `0x800405D4`: system-menu state 6, sub-state 2. Choosing Generals sets
    state 6 with sub-state 0 (`0x800403E8`), and sub-state 0 jumps straight
    to 3 (Character Status, `0x8004056C`). No path into sub-state 1 or 2 was
    found; this may be unused code.
  - `0x80088728`: page 5 of the diplomacy target handler `0x80050FF8`, via
    state 3 (`0x800522D4`, init `0x80088234`). State 3 is set at
    `0x80052294` only in command mode 3 and only when the target faction's
    status byte (`0x801C7F58` record) is 8, 12 or 13. Mode 3 comes from
    `0x8003FA50`. That status was not available in the first three months.
- Reinforcement header (`tm_05830`): no general held that post.

## Baked text in graphics

A contact-sheet review of every TIM in `CG_01.DAT`, `CG_02.DAT`, `WAZA.DAT`
and `IV_CG.DAT` found Japanese interface text only in these images:

| Archive | TIM (offset) | Content | Tool |
|---|---|---|---|
| CG_01 | #15 (`0x12A0A0`), #407 (`0xBE7000`) | Title logo, red subtitle 愛しき邪悪; the two copies are byte-identical | `title-subtitle-patch.mjs` |
| CG_01 | #1 (`0x54360`, 4bpp) | 16x16 label cells at x=128/144: 金, 宝玉, 家畜, 劣鬼, 年, 月, 税収, 人事, 戦闘, 政略, 外交 | `ui-label-patch.mjs` |
| CG_01 | #14 (`0x121900`, 8bpp) | Date and status bar: 年, 月, 総国, 国力 | `ui-label-patch.mjs` |
| CG_02 | #373 (`0x849060`, 8bpp) | Battle buttons 退却/武将/偵察/戦場 at x=13-45, y=121+20n | `battle-ui-patch.mjs` |
| CG_02 | #374 (`0x859280`, 4bpp, 16 CLUT rows) | Formation and result banners in 20 px bands | `battle-ui-patch.mjs` |

Other findings from the review:

- The month names, the title menu (NEW GAME/CONTINUE/OPTION/PUSH START), the
  ending screens and the world map are already in English.
- The world map (CG_01 #2) gives the official spellings Newgard, Japtos,
  Paulus-Nui, Muromachi and more.
- IV_CG #180-199 are unused "ダミー" placeholders.
- Small decorative kanji on item art and signs were left unchanged.

## Runtime font verification

The rebuilt disc now boots in DuckStation. A first test using ordinary
single-byte ASCII produced an empty dialogue box: the text renderer consumed
the string but had no visible glyphs for those byte values. Replacing the same
text with Shift-JIS full-width Latin characters rendered successfully. The
verified first prompt displays `ＭＥＭＯＲＹ　ＣＡＲＤ` and
`ＰＲＥＳＳ　○　ＴＯ　ＳＴＡＲＴ`.

This establishes that the stock font supports its Shift-JIS full-width Latin
page, but not normal ASCII. Full-width English is suitable for short bootstrap
tests only: it consumes two bytes per character and has very wide spacing. A
complete translation still requires tracing and extending the glyph lookup (or
replacing existing glyph slots) before the large dialogue catalog is inserted.

DuckStation save slot 1 was recorded at the verified first prompt to speed up
subsequent renderer tests.
