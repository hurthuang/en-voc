// 用無頭瀏覽器（Playwright + 真實 Chrome）跑 words.generated.json 裡所有英文字的
// 點字批次翻譯，結果存成 braille-ueb-g2.generated.json，供 build-data.js 讀取。
//
// 前提：
//   1. 已安裝 Playwright（`npm install playwright` 或透過 npx 快取皆可）
//   2. 本機有 Chrome（預設路徑見下方 CHROME_PATH，不同機器可能要改）
//   3. router-server.js 要先在背景跑起來（node en-test/scripts/router-server.js）
//
// 用法：node en-test/scripts/braille-translate-batch.js
'use strict';
const fs = require('fs');
const path = require('path');

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    // 沒有全域安裝時，退回試試看常見的 npx 快取路徑（雜湊值可能因機器/版本而異，
    // 如果這裡也找不到，請改成你自己機器上 `npx playwright --version` 之後
    // node_modules/playwright 實際所在路徑）。
    const fallback = 'C:\\Users\\user\\AppData\\Local\\npm-cache\\_npx\\9833c18b2d85bc59\\node_modules\\playwright';
    return require(fallback);
  }
}

const { chromium } = resolvePlaywright();
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WORDS_PATH = path.join(__dirname, 'words.generated.json');
const OUT_PATH = path.join(__dirname, 'braille-ueb-g2.generated.json');

(async () => {
  const words = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  console.log('words to translate:', words.length);

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console.error]', msg.text()); });

  await page.goto('http://localhost:8793/_batch.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__louReady === true, { timeout: 15000 });

  console.log('page loaded, LOU ready, starting batch translate...');
  const dict = await page.evaluate(async (words) => {
    return await window.__batchTranslate(words);
  }, words);

  const keys = Object.keys(dict);
  const empties = keys.filter((k) => !dict[k]);
  console.log('translated:', keys.length, 'empty results:', empties.length);
  if (empties.length) console.log('sample empties:', empties.slice(0, 10));
  console.log('pageErrors:', pageErrors);

  // 抽查幾個字確認翻譯有正常運作
  for (const w of ['family', 'husband', 'cat', 'wife', 'PE']) {
    if (w in dict) console.log(`check: ${w} -> ${dict[w]} (len ${dict[w].length})`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(dict, null, 0), 'utf8');
  console.log('saved to braille-ueb-g2.generated.json');

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
