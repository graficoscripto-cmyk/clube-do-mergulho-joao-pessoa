// Servidor local de teste: estático + /api/tabela com stub do Blob em memória. Uso: node test/dev-server.mjs [porta]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarHandler } from '../lib/tabela-core.js';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = new Map(); let seq = 0;
const blob = {
  async put(p, body, o) { const pathname = o.addRandomSuffix ? p.replace(/(\.\w+)$/, `-r${++seq}$1`) : p; store.set(pathname, { body: Buffer.from(body), tipo: o.contentType }); return { url: `https://stub.blob/${pathname}`, pathname }; },
  async list({ prefix }) { return { blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ pathname: k, url: `https://stub.blob/${k}` })) }; },
  async del(u) { store.delete(u.replace('https://stub.blob/', '')); },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { const s = String(u); if (s.startsWith('https://stub.blob/')) { const k = s.split('?')[0].replace('https://stub.blob/', ''); const v = store.get(k); return v ? { ok: true, json: async () => JSON.parse(v.body.toString()) } : { ok: false }; } return realFetch(u, o); };
process.env.TABELA_PIN = '4242';
const handler = criarHandler(blob);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/api/tabela') return handler(req, res);
  let f = u === '/' ? '/index.html' : u === '/atualizar' ? '/atualizar.html' : u;
  const p = path.join(raiz, f);
  if (!p.startsWith(raiz) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('content-type', mime[path.extname(p)] || 'application/octet-stream'); fs.createReadStream(p).pipe(res);
}).listen(Number(process.argv[2])||8765);



srv.on('listening',()=>console.log('servidor em http://localhost:'+srv.address().port));
