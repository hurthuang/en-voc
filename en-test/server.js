// 單字測驗 app 的本機靜態伺服器。因為 jvpc-05.htm 用 fetch() 讀 .txt 檔，
// 直接用瀏覽器開啟 file:// 會被擋，所以需要透過 http 伺服器來開啟。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8791;
const ROOT = __dirname;
const MIME = {
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/jvpc-05.htm';
    const filePath = path.join(ROOT, p);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('找不到檔案：' + p);
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`單字測驗伺服器已啟動：http://localhost:${PORT}/jvpc-05.htm`);
    console.log('關閉這個視窗即可停止伺服器。');
  });
