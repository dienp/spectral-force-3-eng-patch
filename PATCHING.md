# Spectral Force: Lovely Wickedness — English patch

Fan translation patch for the Japanese PlayStation game *Spectral Force:
Itoshiki Jaaku* (`SLPS-02233`, Idea Factory, 1999). The patch file does not
contain the game. You need your own copy of the original Japanese disc.

> **Status: beta.** All story dialogue, menus, names, country descriptions,
> character profiles and the main interface graphics are in English. The
> translation was drafted with machine assistance and has not had a full
> human review or a complete playthrough. Expect rough lines, and possibly
> clipped or garbled text on screens nobody has checked yet.

## What you need

1. **Your own dump of the original Japanese disc**, as a single-track
   BIN/CUE (the Redump format). The BIN must match exactly:

   | Check | Value |
   |---|---|
   | File size | 731,194,464 bytes |
   | CRC32 | `65c9509c` |
   | MD5 | `269709629570471394d3da77f9683b52` |
   | SHA-1 | `b188a46d82621e167dbbfc0c7b2e625ceec5f8f0` |
   | SHA-256 | `b78cfcf2ed3b471ddf3dc1eb35ea00347746da616933119eb0eeab04e7b950e7` |

   If your copy is in another format (CHD, ISO, or a multi-file image),
   convert it back to a single BIN/CUE first. For CHD, use
   `chdman extractcd -i game.chd -o game.cue -ob game.bin`.
2. **The patch file**: `Spectral Force - Lovely Wickedness (English).bps`
   (BPS format, 5.8 MB), from the
   [Releases page](https://github.com/dienp/spectral-force-3-eng-patch/releases).
3. **A BPS patcher.** Any one of the three below works.

## How to apply the patch

Always patch a **copy** of your original BIN, and keep the original safe.

### Option A — in your web browser (Rom Patcher JS, no install)

1. Open <https://www.marcrobledo.com/RomPatcher.js/>.
2. Under **ROM file**, select your original `.bin`.
3. Under **Patch file**, select `Spectral Force - Lovely Wickedness (English).bps`.
4. Click **Apply patch** and save the result, for example as
   `Spectral Force - Lovely Wickedness (English).bin`.

Everything runs locally in your browser; nothing is uploaded. The disc image
is large (about 700 MB), so a desktop browser with free memory works best. If
the browser struggles, use option B or C.

### Option B — Floating IPS (Windows)

1. Download Floating IPS (`flips.exe`) from its official project page
   (<https://github.com/Alcaro/Flips/releases>).
2. Run it and click **Apply Patch**.
3. Choose the `.bps` file, then your original `.bin`.
4. Save the output as `Spectral Force - Lovely Wickedness (English).bin`.

### Option C — Node.js (any OS, command line)

With [Node.js](https://nodejs.org/) 20 or newer, use `tools/bps.mjs` from
[the repository](https://github.com/dienp/spectral-force-3-eng-patch):

```sh
node tools/bps.mjs apply "Spectral Force - Itoshiki Jaaku (Japan).bin" "Spectral Force - Lovely Wickedness (English).bps" "Spectral Force - Lovely Wickedness (English).bin"
```

### Then: the CUE file

Emulators load the disc through a `.cue` file that names the `.bin`. Use the
`Spectral Force - Lovely Wickedness (English).cue` from the release and keep it
in the same folder as the patched BIN. To write it yourself instead, create a
text file with exactly these lines:

```text
FILE "Spectral Force - Lovely Wickedness (English).bin" BINARY
  TRACK 01 MODE2/2352
    INDEX 01 00:00:00
```

If your patched BIN has a different filename, change the name inside the CUE
to match.

## Check the result (optional)

The patched BIN should match:

| Check | Value |
|---|---|
| File size | 731,194,464 bytes |
| CRC32 | `1ecad99b` |
| SHA-256 | `c98714e512c436e0949cdea69f510f2ae645abc559dc11f3be1d9891aa157b97` |

## Playing

Open the `.cue` in a PlayStation emulator such as DuckStation, ePSXe or
Mednafen/Beetle PSX, or burn it to a CD-R for a modded console (untested on
hardware).

## Troubleshooting

- **"Source checksum / CRC mismatch"** (or a similar error): your BIN is not
  the expected dump. It may be a different revision, an already patched or
  modified file, or a multi-track or converted image. Check it against the
  table above.
- **Black screen, or the emulator can't find the game:** the CUE probably
  points to the wrong filename. Make the `FILE "..."` line match your BIN's
  name exactly.
- **A line ends early with "~":** the text box ran out of glyph space. Please
  report the screen.
- **Text looks clipped or wrong on a screen:** please report the screen and
  what you did to reach it.

## Known limitations

- Some short labels are abbreviated because each translation must fit the
  original text's byte budget (for example "Gems", "Dipl", "MX").
- A few sentences assembled by the game from pieces read slightly stilted
  (for example dates: "998 AD.").
- Movie (STR) subtitles and voice audio are unchanged. The opening movie's
  Japanese captions are part of the video.
- The patch changes text and interface graphics only; gameplay is untouched.

## Credits and legal

Unofficial fan translation. *Spectral Force* is © Idea Factory. The patch
only contains changed bytes (translated text, edited interface graphics and
the font routine change), not the game. Please support the original release.
