// 把 build-data.js 產生的 elementary-data.generated.js 內容，回填進根目錄的
// index.html（取代裡面舊的 `const ELEMENTARY_DATA = [...]` 那段）。
// build-data.js 每次重跑之後，都要接著跑這支腳本，index.html 才會同步。
// 用法：node en-test/scripts/inject-elementary-data.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GENERATED = path.join(__dirname, 'elementary-data.generated.js');
const INDEX_HTML = path.join(ROOT, 'index.html');

const src = fs.readFileSync(GENERATED, 'utf8');
const m = src.match(/const ELEMENTARY_DATA = (\[[\s\S]*?\n\]);/);
if (!m) {
  console.error('找不到 elementary-data.generated.js 裡的 ELEMENTARY_DATA 陣列');
  process.exit(1);
}

const html = fs.readFileSync(INDEX_HTML, 'utf8');
const re = /const ELEMENTARY_DATA = \[[\s\S]*?\n\];/;
if (!re.test(html)) {
  console.error('index.html 裡找不到 ELEMENTARY_DATA 陣列可以取代');
  process.exit(1);
}

const replaced = html.replace(re, 'const ELEMENTARY_DATA = ' + m[1] + ';');
fs.writeFileSync(INDEX_HTML, replaced, 'utf8');
console.log('已回填進 index.html，陣列長度', m[1].length);
