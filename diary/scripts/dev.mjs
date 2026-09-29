// 로컬 테스트 서버: public/ 정적 파일 + /api/* 를 실제 Worker 코드(src/worker.js)로 처리한다.
// wrangler dev(workerd) 없이도 같은 Worker 코드를 검증할 수 있다.  사용법: node scripts/dev.mjs [포트] [DB파일|:memory:]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { createD1 } from './d1-shim.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8787);
const dbFile = process.argv[3] || path.join(root, '.dev', 'db.sqlite');
if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const env = { DB: createD1(dbFile, fs.readFileSync(path.join(root, 'schema.sql'), 'utf8')) };

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const headersFile = path.join(root, 'public', '_headers');
const globalHeaders = {};
if (fs.existsSync(headersFile)) {
  for (const line of fs.readFileSync(headersFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s+([\w-]+):\s*(.+)$/);
    if (m) globalHeaders[m[1].toLowerCase()] = m[2];
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost:' + port}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(root, 'public', p);
    if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory() || path.basename(file) === '_headers') {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...globalHeaders });
    res.end(fs.readFileSync(file));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('dev server error');
  }
});
server.listen(port, () => console.log(`pds-diary dev server: http://localhost:${port}  (db: ${dbFile})`));
