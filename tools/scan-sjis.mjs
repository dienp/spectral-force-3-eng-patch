#!/usr/bin/env node
import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node tools/scan-sjis.mjs <file> [...]');
  process.exit(2);
}

const decoder = new TextDecoder('shift_jis', { fatal: true });
const isLead = b => (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xef);
const isTrail = b => (b >= 0x40 && b <= 0x7e) || (b >= 0x80 && b <= 0xfc);
const isHalfKana = b => b >= 0xa1 && b <= 0xdf;
const isAscii = b => b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e);
const isJapanese = ch => /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}々〆ヶー。、・「」『』【】！？]/u.test(ch);

for (const file of files) {
  const data = fs.readFileSync(file);
  let candidates = 0;
  console.log(`# ${file}`);
  for (let start = 0; start < data.length; start++) {
    if (!isLead(data[start]) && !isHalfKana(data[start])) continue;
    let offset = start;
    let jpBytes = 0;
    while (offset < data.length && offset - start < 512) {
      const b = data[offset];
      if (isLead(b) && offset + 1 < data.length && isTrail(data[offset + 1])) {
        jpBytes += 2;
        offset += 2;
      } else if (isHalfKana(b)) {
        jpBytes++;
        offset++;
      } else if (isAscii(b)) {
        offset++;
      } else {
        break;
      }
    }
    if (jpBytes < 6 || offset - start < 6) continue;
    try {
      const text = decoder.decode(data.subarray(start, offset));
      const jpChars = [...text].filter(isJapanese).length;
      if (jpChars < 3 || jpChars / [...text].length < 0.35) continue;
      console.log(`${start.toString(16).padStart(8, '0')}\t${JSON.stringify(text)}`);
      candidates++;
      start = offset;
      if (candidates >= 200) {
        console.log('# output capped at 200 candidates');
        break;
      }
    } catch {
      // Not valid Shift-JIS.
    }
  }
  console.log(`# candidates: ${candidates}`);
}
