// 把根目錄的「英文單字表_*.md」轉成 en-test 單字測驗 app 用的 tab 分隔 .txt 檔。
// 用法：node en-test/scripts/build-data.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..'); // en-voc 專案根目錄
const EN_TEST = path.resolve(__dirname, '..'); // en-test 資料夾
const ELEM_DIR = path.join(EN_TEST, 'elementary');

// ---------- 共用：單字項目解析 ----------

const POS_TAGS = ['n', 'v', 'vt', 'vi', 'adj', 'adv', 'prep', 'conj', 'pron', 'int', 'det', 'aux', 'abbr', 'phr'];
const POS_ALT = POS_TAGS.join('|');
// 抓字串結尾的詞性標記（可能是 "n." 或 "adj.;pron." 這種複合形式，
// 南一資料裡少數幾筆用「/」不是「；」分隔，如 "v./n."、"n./adv."，兩種分隔號都要接受），
// 前面要有空白或字串開頭
const POS_TRAILING_RE = new RegExp(`(?:^|\\s)((?:(?:${POS_ALT})\\.)(?:[;/](?:${POS_ALT})\\.)*)$`);

// 找字串裡第一個非 ASCII 字元（中文字、全形標點...），當作「英文部分」與「中文意思」的切點
function firstNonAsciiIndex(s) {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) return i;
  }
  return -1;
}

// 把「family n. 家人；家庭」這種單一項目解析成 { english, meaning }
// meaning 會保留詞性（例如 "n. 家人；家庭"），符合「中文欄保留詞性」的要求
function parseSingleItem(raw) {
  let t = raw.trim();
  if (!t) return null;
  if (t.startsWith('Idiom:')) t = t.slice('Idiom:'.length).trim();
  if (!t) return null;

  const idx = firstNonAsciiIndex(t);
  let headPart, meaning;
  if (idx === -1) {
    // 完全沒有中文意思（不應該發生，保險起見整段當英文，中文留空）
    headPart = t;
    meaning = '';
  } else {
    headPart = t.slice(0, idx).trim();
    meaning = t.slice(idx).trim();
  }

  let pos = '';
  const posMatch = headPart.match(POS_TRAILING_RE);
  if (posMatch) {
    pos = posMatch[1];
    headPart = headPart.slice(0, posMatch.index).trim();
  }

  const english = headPart.trim();
  if (!english) return null;
  const fullMeaning = pos ? `${pos} ${meaning}`.trim() : meaning;
  return { english, meaning: fullMeaning };
}

// 把一整段「用／分隔的課次內容」切成單字項目陣列。
// allowSemicolonSplit：Dino 系列的 應用/認識/音韻 分類是用；分隔類別、／分隔單字，
// 其餘來源的；通常是同一個字的多重意思，不能拿來切。
function splitContentToItems(content, { allowSemicolonSplit = false } = {}) {
  const items = [];
  const slashParts = content.split('／').map((s) => s.trim()).filter(Boolean);
  for (const part of slashParts) {
    // 南一：同一個／項目裡可能夾帶「；Idiom: ...」，是另一個獨立的字/慣用語
    const idiomIdx = part.indexOf('；Idiom:');
    if (idiomIdx !== -1) {
      const main = part.slice(0, idiomIdx);
      const idiom = part.slice(idiomIdx + 1); // 去掉開頭的；
      const a = parseSingleItem(main);
      const b = parseSingleItem(idiom);
      if (a) items.push(a);
      if (b) items.push(b);
      continue;
    }
    if (allowSemicolonSplit && part.includes('；')) {
      for (const sub of part.split('；')) {
        const it = parseSingleItem(sub);
        if (it) items.push(it);
      }
      continue;
    }
    const it = parseSingleItem(part);
    if (it) items.push(it);
  }
  // 沒有中文意思的項目（例如康軒 Follow Me FM10 只有純英文單字表，沒有中譯）
  // 對這個 app 沒用（一定得顯示中文才能考英文），過濾掉；若整份都被濾光，
  // 呼叫端的 `if (!items.length)` 判斷就會自然跳過、不產生這個檔案。
  return items.filter((it) => it.meaning);
}

// ---------- 國中：年級/學期擷取、課次擷取 ----------

// 三家標題格式不同，但都一定有「（X年級Y學期...）」這段清楚標示的文字，統一從這裡取值，
// 避免被南一自己的「1年級」內部編號（對應7年級）誤導。
function extractGradeSemester(heading) {
  const m = heading.match(/[（(](\d)年級[^）)]*?(上|下)學期/);
  if (!m) return null;
  return { grade: m[1], semester: m[2] === '上' ? 'A' : 'B' };
}

const BULLET_RE = /^-\s*\*\*(.+?)\*\*[:：]\s*(.*)$/;

function parseJuniorMd(mdPath, pub) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const lines = text.split('\n');

  // key: `${grade}${semester}` -> Map<lessonNum, items[]>
  const bySemester = new Map();
  let currentGS = null;
  let currentLessons = null; // Map<number, items[]>
  let maxLessonNum = 0;

  function flushKnowledgeSupplement(content) {
    // 「認識字彙補充」格式：Unit3：word／word；Unit4：word；Culture & Festival：word...
    const labelRe = /(Unit\s*\d+|Culture\s*&\s*Festivals?)[：:]/g;
    const matches = [...content.matchAll(labelRe)];
    for (let i = 0; i < matches.length; i++) {
      const label = matches[i][1];
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
      const chunk = content.slice(start, end).replace(/；\s*$/, '').trim();
      const items = splitContentToItems(chunk);
      if (!items.length) continue;
      const unitNum = (() => {
        const um = label.match(/Unit\s*(\d+)/i);
        return um ? Number(um[1]) : maxLessonNum || 1;
      })();
      if (!currentLessons.has(unitNum)) currentLessons.set(unitNum, []);
      currentLessons.get(unitNum).push(...items);
    }
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const gs = extractGradeSemester(line);
      if (gs) {
        const key = `${gs.grade}${gs.semester}`;
        if (!bySemester.has(key)) bySemester.set(key, new Map());
        currentGS = key;
        currentLessons = bySemester.get(key);
        maxLessonNum = 0;
      } else {
        currentGS = null;
        currentLessons = null;
      }
      continue;
    }
    if (!currentLessons) continue;
    const bm = line.match(BULLET_RE);
    if (!bm) continue;
    const label = bm[1].trim();
    const content = bm[2].trim();

    if (label === '認識字彙補充') {
      flushKnowledgeSupplement(content);
      continue;
    }

    const lessonMatch = label.match(/^(?:Lesson|Unit)\s*(\d+)/i);
    if (lessonMatch) {
      const num = Number(lessonMatch[1]);
      maxLessonNum = Math.max(maxLessonNum, num);
      const items = splitContentToItems(content);
      if (!currentLessons.has(num)) currentLessons.set(num, []);
      currentLessons.get(num).push(...items);
      continue;
    }
    if (label === 'Get Ready') {
      const items = splitContentToItems(content);
      if (!currentLessons.has(1)) currentLessons.set(1, []);
      currentLessons.get(1).push(...items);
      continue;
    }
    if (/^Culture\s*&\s*Festivals?$/i.test(label) || /^Culture:/i.test(label)) {
      const target = maxLessonNum || 6;
      const items = splitContentToItems(content);
      if (!currentLessons.has(target)) currentLessons.set(target, []);
      currentLessons.get(target).push(...items);
      continue;
    }
    // 其他未預期的標籤（不應該常出現），直接跳過
  }

  // 展開成 { `${pub}${grade}${semester}${lesson}`: items[] }
  const out = new Map();
  for (const [gsKey, lessons] of bySemester.entries()) {
    for (const [lessonNum, items] of lessons.entries()) {
      if (!items.length) continue;
      out.set(`${pub}${gsKey[0]}${gsKey[1]}${lessonNum}`, items);
    }
  }
  return out;
}

// ---------- 點字碼：優先用 liblouis（英文 UEB Grade 2）批次轉出的權威對照表 ----------
// 這份表由 scripts/braille-batch.html + scripts/braille-translate-batch.js 產生
// （借用 E:\Project\tool 這個既有的點字翻譯工具的 liblouis WASM build + en-ueb-g2.ctb 表）。
// 舊 K*.txt 殘留的人工點字碼當第二層備援，理論上liblouis 已經涵蓋全部單字，備援層很少會用到。

function buildBrailleLookup() {
  const map = new Map();

  // 第二層備援：舊檔殘留的人工點字碼（優先權較低，稍後會被 liblouis 表覆蓋）
  const files = fs.readdirSync(EN_TEST).filter((f) => /^[A-Z]\d[AB]\d\.txt$/.test(f));
  for (const f of files) {
    const text = fs.readFileSync(path.join(EN_TEST, f), 'utf8');
    for (const line of text.split('\n')) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const en = parts[0].trim().toLowerCase();
        const braille = parts[2].trim();
        if (en && braille && !map.has(en)) map.set(en, braille);
      }
    }
  }

  // 第一層（權威來源）：liblouis UEB G2 批次轉譯結果，找得到就覆蓋掉上面的備援值
  const uebPath = path.join(__dirname, 'braille-ueb-g2.generated.json');
  if (fs.existsSync(uebPath)) {
    const ueb = JSON.parse(fs.readFileSync(uebPath, 'utf8'));
    for (const [en, braille] of Object.entries(ueb)) {
      if (braille) map.set(en.toLowerCase(), braille);
    }
  } else {
    console.warn('找不到 braille-ueb-g2.generated.json，只會用舊檔殘留的點字碼');
  }

  return map;
}

// 跟 jvpc-05.htm 載入題庫時對 english/chinese 欄位做的處理完全一樣
// （拿掉全形/半形括號內容）。點字一定要照「使用者實際要打的答案」（即去括號後的字）
// 去查表/翻譯，不能照原始（可能帶括號註記，如 "hamburger(s)"）的字，
// 否則點字碼會多出括號跟裡面文字的點字、跟畫面顯示與比對答案用的英文對不起來。
function stripParens(s) {
  return s.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
}

function writeVocabFile(filePath, items, brailleMap) {
  const lines = items.map((it) => {
    const displayEnglish = stripParens(it.english);
    const braille = brailleMap ? brailleMap.get(displayEnglish.toLowerCase()) || '' : '';
    return [it.english, it.meaning, braille].join('\t');
  });
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

// ---------- 國小：康軒 ----------

function slugify(s) {
  return s
    .replace(/&/g, 'and')
    .replace(/[^A-Za-z0-9]+/g, '')
    .trim();
}

function parseKangxuanElementary(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const lines = text.split('\n');
  const out = []; // { pub, series, seriesLabel, volume, volumeLabel, unit, unitLabel, items }

  let series = null; // { name }
  let volume = null; // { code, label }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const name = line.replace(/^##\s*/, '').trim();
      // 只有 Follow Me / Wonder World 有蒐集到資料，其餘（Super Starter 等）底下沒有 bullet，自然被忽略
      series = { name };
      volume = null;
      continue;
    }
    if (line.startsWith('### ')) {
      const heading = line.replace(/^###\s*/, '').trim();
      const m = heading.match(/[（(]([A-Za-z]+\s*\d*)/);
      volume = { code: m ? m[1].replace(/\s+/g, '') : slugify(heading), label: heading };
      continue;
    }
    if (!series || !volume) continue;
    const bm = line.match(BULLET_RE);
    if (!bm) continue;
    const unitLabel = bm[1].trim();
    const items = splitContentToItems(bm[2].trim());
    if (!items.length) continue;
    out.push({
      pub: 'K',
      pubLabel: '康軒',
      series: slugify(series.name),
      seriesLabel: series.name,
      volume: volume.code,
      volumeLabel: volume.label,
      unit: slugify(unitLabel),
      unitLabel,
      items,
    });
  }
  return out;
}

// ---------- 國小：何嘉仁 ----------
// 結構跟康軒（## 系列 → ### 冊次 → bullet=課次）完全一樣，直接沿用同一套邏輯，
// 只是換一個來源檔案、pub 代碼跟中文出版社名稱。

function parseHessElementary(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const lines = text.split('\n');
  const out = [];

  let series = null;
  let volume = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const name = line.replace(/^##\s*/, '').trim();
      series = { name };
      volume = null;
      continue;
    }
    if (line.startsWith('### ')) {
      const heading = line.replace(/^###\s*/, '').trim();
      const m = heading.match(/[（(]([A-Za-z]+\s*\d*)/);
      volume = { code: m ? m[1].replace(/\s+/g, '') : slugify(heading), label: heading };
      continue;
    }
    if (!series || !volume) continue;
    const bm = line.match(BULLET_RE);
    if (!bm) continue;
    const unitLabel = bm[1].trim();
    const items = splitContentToItems(bm[2].trim());
    if (!items.length) continue;
    out.push({
      pub: 'HJ',
      pubLabel: '何嘉仁',
      series: slugify(series.name),
      seriesLabel: series.name,
      volume: volume.code,
      volumeLabel: volume.label,
      unit: slugify(unitLabel),
      unitLabel,
      items,
    });
  }
  return out;
}

// ---------- 國小：翰林 ----------

function parseHanlinElementary(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const lines = text.split('\n');
  const out = [];

  let series = null; // 'HereWeGo' | 'Dino' | others(skipped)
  let volume = null; // Dino 用

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const heading = line.replace(/^##\s*/, '').trim();
      const m = heading.match(/英語-([A-Za-z]+)/);
      series = m ? m[1] : null; // HereWeGo / Dino / Hooray / Twinkle
      volume = null;
      continue;
    }
    if (!series) continue;

    if (line.startsWith('### ')) {
      const heading = line.replace(/^###\s*/, '').trim();
      const m = heading.match(/[（(]([A-Za-z]+\s*\d*)/);
      volume = { code: m ? m[1].replace(/\s+/g, '') : slugify(heading), label: heading };
      continue;
    }

    const bm = line.match(BULLET_RE);
    if (!bm) continue;
    const rawLabel = bm[1].trim();
    const content = bm[2].trim();

    if (series === 'HereWeGo') {
      // 現在跟 Dino 一樣是逐冊逐課（### 冊 → Starter/Unit N/Festival/Classroom English 課次），
      // 差別只在於這裡每個 bullet 已經是乾淨的／分隔單字表，不需要再處理應用/認識/音韻的；分隔
      if (!volume) continue;
      const unitLabelMatch = rawLabel.match(/^(Starter|Unit\s*\d+|Festival:.*|Classroom English)/i);
      if (!unitLabelMatch) continue;
      const unitLabel = unitLabelMatch[1];
      const items = splitContentToItems(content);
      if (!items.length) continue;
      out.push({
        pub: 'H',
        pubLabel: '翰林',
        series: 'HereWeGo',
        seriesLabel: 'HereWeGo',
        volume: volume.code,
        volumeLabel: volume.label,
        unit: slugify(unitLabel),
        unitLabel: rawLabel,
        items,
      });
      continue;
    }

    if (series === 'Dino') {
      if (!volume) continue;
      const unitLabelMatch = rawLabel.match(/^(Unit\s*\d+|Starter Unit|Culture)/i);
      if (!unitLabelMatch) continue;
      const unitLabel = unitLabelMatch[1];
      // 「應用：.../認識：.../音韻：...」是類別標籤黏在該類別第一個單字前面，
      // 換成／讓它變成獨立（會被過濾掉的）空白項目，避免把標籤跟單字黏在一起解析壞掉
      const cleanedContent = content.replace(/(?:應用|認識|音韻)[：:]/g, '／');
      const items = splitContentToItems(cleanedContent, { allowSemicolonSplit: true });
      if (!items.length) continue; // 例如 Dino10 Starter Unit「僅課文，無新單字」
      out.push({
        pub: 'H',
        pubLabel: '翰林',
        series: 'Dino',
        seriesLabel: 'Dino',
        volume: volume.code,
        volumeLabel: volume.label,
        unit: slugify(unitLabel),
        unitLabel: rawLabel,
        items,
      });
      continue;
    }
    // Hooray / Twinkle 底下沒有蒐集到 bullet 資料，自然略過
  }
  return out;
}

// ---------- 主流程 ----------

function main() {
  fs.mkdirSync(ELEM_DIR, { recursive: true });

  // 1) 點字碼對照表：liblouis UEB G2 權威表 + 舊檔殘留碼備援（在覆寫任何檔案之前先讀）
  const brailleMap = buildBrailleLookup();
  console.log(`點字碼對照表：共 ${brailleMap.size} 筆`);

  // 2) 國中
  const juniorSources = [
    { file: '英文單字表_康軒國中.md', pub: 'K' },
    { file: '英文單字表_翰林國中.md', pub: 'H' },
    { file: '英文單字表_南一國中.md', pub: 'N' },
  ];
  let juniorFileCount = 0;
  for (const src of juniorSources) {
    const map = parseJuniorMd(path.join(ROOT, src.file), src.pub);
    for (const [key, items] of map.entries()) {
      writeVocabFile(path.join(EN_TEST, `${key}.txt`), items, brailleMap);
      juniorFileCount++;
    }
  }
  console.log(`國中：共產生 ${juniorFileCount} 個檔案`);

  // 3) 國小
  const kElem = parseKangxuanElementary(path.join(ROOT, '英文單字表_康軒國小.md'));
  const hElem = parseHanlinElementary(path.join(ROOT, '英文單字表_翰林國小.md'));
  const hjElem = parseHessElementary(path.join(ROOT, '英文單字表_何嘉仁.md'));
  const allElem = [...kElem, ...hElem, ...hjElem];

  const manifest = [];
  for (const entry of allElem) {
    const fileSlug = `${entry.pub}-${entry.series}-${entry.volume}-${entry.unit}.txt`;
    const filePath = path.join(ELEM_DIR, fileSlug);
    writeVocabFile(filePath, entry.items, brailleMap);
    manifest.push({
      pub: entry.pub,
      pubLabel: entry.pubLabel,
      series: entry.series,
      seriesLabel: entry.seriesLabel,
      volume: entry.volume,
      volumeLabel: entry.volumeLabel,
      unit: entry.unit,
      unitLabel: entry.unitLabel,
      file: `elementary/${fileSlug}`,
    });
  }
  console.log(`國小：共產生 ${manifest.length} 個檔案`);

  // 4) 給 html 用的階層資料，直接產成一段 JS 陣列字面值
  const jsOut = `// 由 build-data.js 自動產生，請勿手動編輯。若來源 md 更新，重新執行腳本即可。
const ELEMENTARY_DATA = ${JSON.stringify(manifest, null, 2)};
`;
  fs.writeFileSync(path.join(EN_TEST, 'scripts', 'elementary-data.generated.js'), jsOut, 'utf8');
  console.log('已寫入 en-test/scripts/elementary-data.generated.js');
}

main();
