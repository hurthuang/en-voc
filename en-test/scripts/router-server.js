// 點字批次翻譯用的臨時路由伺服器：把 E:\Project\tool 這個外部 liblouis 專案的
// build + table 檔案（唯讀）接到本機 8793 埠，並把 braille-batch.html 掛在
// /_batch.html，讓瀏覽器可以載入 liblouis WASM + en-ueb-g2.ctb 表格來跑翻譯。
// 這個伺服器只在跑 braille-translate-batch.js 期間需要，跑完可以關掉。
//
// 前提：機器上要有 E:\Project\tool 這個 liblouis WASM build 專案
// （build-no-tables-utf32.js + table/*.ctb 等），如果路徑不同，改下面的 TOOL_ROOT。
//
// 用法：node en-test/scripts/router-server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const TOOL_ROOT = 'E:\\Project\\tool';
const BATCH_HTML = path.join(__dirname, 'braille-batch.html');
const PORT = 8793;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ctb': 'text/plain; charset=utf-8',
  '.uti': 'text/plain; charset=utf-8',
  '.cti': 'text/plain; charset=utf-8',
  '.dis': 'text/plain; charset=utf-8',
};

http
  .createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const filePath = p === '/_batch.html' ? BATCH_HTML : path.join(TOOL_ROOT, p);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found: ' + p);
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log('router listening on ' + PORT));
