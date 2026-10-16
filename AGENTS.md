# Project instructions for agents

## Mission

Build a reproducible, evidence-backed localization toolchain for the Japanese
PlayStation game *Spectral Force: Itoshiki Jaaku* (`SLPS-02233`). English is the
first target, but formats and IDs should support additional languages later.

## Read first

Before changing code or game data, read:

1. `PROGRESS.md` for current state and priorities.
2. `RESEARCH.md` for verified technical findings.
3. `README.md` for tool usage.

Treat statements in those files as observations only when they are labeled or
supported as verified. Preserve the distinction between confirmed behavior and
inference.

## Legal and data-handling rules

- Never commit, upload, publish, or distribute the original BIN/CUE, extracted
  game files, BIOS files, patched full-disc images, save states, screenshots
  containing substantial game content, or other copyrighted assets.
  - Exception (owner decision, 2026-10-16): a small set of in-game
    screenshots in `screenshots/` that show the translation working, linked
    from `README.md`. Add new ones only when the owner asks.
- Keep generated and extracted artifacts under `work/`; it is ignored by source
  control.
- Release binary patches and tooling, not game data.
- Work from a user-owned source image. The known original hashes are recorded
  in `RESEARCH.md`; reject or explicitly document mismatched revisions.
- Do not overwrite the original image. Every build must create a new output.

## Canonical workspace and inputs

- Workspace: `E:\Code\spectral-force-3-re`
- User-owned source BIN:
  `E:\Download\Spectral Force - Itoshiki Jaaku (Japan).bin`
- User-owned source CUE:
  `E:\Download\Spectral Force - Itoshiki Jaaku (Japan).cue`
- Main executable: `SLPS_022.33`
- Latest visual font test:
  `work\start-screen-test\Spectral Force - Font Test.cue`

Do not hard-code the workspace path into reusable tools. Command examples may
use project-relative paths.

## Tooling conventions

- The tools are dependency-free Node.js ES modules. Maintain compatibility
  with Node.js 20 or newer.
- Prefer small, inspectable transformations with deterministic output.
- Preserve file sizes, offsets, sector layout, and alignment unless a change is
  explicitly designed and all dependent pointers/metadata are updated.
- Fail loudly when original bytes, hashes, lengths, encodings, or sector checks
  do not match expectations.
- Never silently truncate translations.
- Use the original extracted file as the input for each clean build; do not
  stack executable patches unless the operation explicitly requires it.
- Recalculate and verify Mode 2 Form 1 EDC/ECC after disc replacement.

## Text and encoding rules

- The source text is primarily Shift-JIS.
- Preserve control tokens exactly. `#n` is a verified line break. Treat other
  sequences such as `#0`, `#1`, `#2`, and `#3` as unknown controls or
  substitutions until runtime tracing proves their meanings.
- Stock rendering does not visibly display ordinary single-byte ASCII in the
  tested dialogue path.
- Shift-JIS full-width Latin glyphs do render, but they are a temporary test
  mechanism, not the final English solution.
- Do not bulk-fill the catalogs with ordinary ASCII until the renderer/font
  path is patched and verified.
- Enforce `maxBytes` against encoded bytes, not JavaScript character count.
- Avoid changing a source string or pointer unless the exact occurrence and
  all references are understood.
- Maintain stable source IDs for translation memory and future locales.

## Reverse-engineering priorities

The highest-priority task is the text renderer and font path:

1. Trace references from a known executable prompt, especially offset
   `0x1E444`.
2. Identify Shift-JIS decoding, glyph lookup, glyph storage, draw/upload code,
   character advance, wrapping, and control-code parsing.
3. Record function addresses, calling conventions, inputs, outputs, and
   evidence in `RESEARCH.md`.
4. Prove the analysis with the smallest runtime patch that displays one normal
   ASCII glyph.

Do not describe reconstructed pseudocode as original source. Decompilation is
an analysis aid, not source recovery.

## Runtime verification

- DuckStation is available under `work\duckstation` for local testing.
- Use a digital controller for port 1.
- Current keyboard mapping: arrows = D-pad, `L` = Circle, `K` = Cross, Enter =
  Start. Click the viewport first if input is ignored.
- The verified full-width prompt has a state in game save slot 1.
- Save states restore RAM. A state made from an older executable is not valid
  evidence for a newer executable patch. Boot the new CUE and create a fresh
  state after each executable/font build.
- For every visible-text change, capture the exact build, screen, expected
  text, actual result, and whether the test started from a fresh boot.
- Structural verification alone is not runtime verification; report both
  separately.

## Graphics rules

- Preserve TIM dimensions, bit depth, CLUT layout, transparency behavior, and
  archive record size.
- The title's Japanese subtitle is baked into artwork. Do not expect changing
  the nearby executable title string to alter it.
- Do not use generated artwork that changes the logo, dimensions, palette, or
  overall composition. Prefer pixel-accurate editing of the extracted asset.
- Multi-CLUT TIMs require checking every relevant palette, not only the first
  previewed row.

## Validation checklist

For a text or executable patch:

- Confirm original bytes before writing.
- Confirm the encoded replacement fits or update every affected pointer and
  length intentionally.
- Confirm the patched executable retains its original file size when using the
  in-place pipeline.
- Rebuild from the original BIN.
- Verify touched sectors report valid EDC, ECC P, and ECC Q.
- Boot the new CUE from a fresh emulator session/state.
- Check the target screen and at least one screen before and after it.
- Record the result in `PROGRESS.md` or `RESEARCH.md`.

For tool changes, exercise both a successful case and the relevant failure
case, such as an overlong string or mismatched original bytes.

## Documentation expectations

- Update `PROGRESS.md` when a milestone, blocker, artifact, or next priority
  changes.
- Put durable reverse-engineering evidence in `RESEARCH.md`.
- Keep `README.md` focused on supported user workflows and current limitations.
- Include exact offsets, addresses, hashes, commands, and test conditions when
  they materially support a finding.
- Never claim the entire game is translated or verified based on a bootstrap
  prompt.

