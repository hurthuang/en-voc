// 掃過所有題庫 txt（國中 en-test/*.txt + 國小 en-test/elementary/*.txt），
// 收集所有不重複的英文 headword（已去除括號註記），輸出成 words.generated.json，
// 供 braille-translate-batch.js 拿去跑點字批次翻譯。
// 用法：node en-test/scripts/gen-words-list.js
'use strict';
const fs = require('fs');
const path = require('path');

const EN_TEST = path.resolve(__dirname, '..');
const ELEM_DIR = path.join(EN_TEST, 'elementary');

function stripParens(s) {
  return s.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
}

const words = new Set();

function collect(dir, pattern) {
  for (const f of fs.readdirSync(dir)) {
    if (!pattern.test(f)) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const line of text.split('\n')) {
      const parts = line.split('\t');
      if (!parts[0]) continue;
      const w = stripParens(parts[0]);
      if (w) words.add(w);
    }
  }
}

collect(EN_TEST, /^[A-Z]\d[AB]\d\.txt$/);
collect(ELEM_DIR, /\.txt$/);

const list = [...words].sort();
fs.writeFileSync(path.join(__dirname, 'words.generated.json'), JSON.stringify(list, null, 0), 'utf8');
console.log('total unique words:', list.length);
