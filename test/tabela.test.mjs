// Teste local da função com um stub do Vercel Blob: node test/tabela.test.mjs
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { criarHandler } from '../lib/tabela-core.js';

// stub em memória do @vercel/blob + fetch das URLs "públicas"
const store = new Map();
let seq = 0;
const blob = {
  async put(p, body, o) {
    const pathname = o.addRandomSuffix ? p.replace(/(\.\w+)$/, `-r${++seq}$1`) : p;
    if (!o.addRandomSuffix && store.has(pathname) && !o.allowOverwrite) throw new Error('existe');
    store.set(pathname, Buffer.isBuffer(body) ? body : Buffer.from(body));
    return { url: `https://stub.blob/${pathname}`, pathname };
  },
  async list({ prefix }) {
    return { blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ pathname: k, url: `https://stub.blob/${k}` })) };
  },
  async del(u) { store.delete(u.replace('https://stub.blob/', '')); },
};
globalThis.fetch = async (u) => {
  const k = String(u).split('?')[0].replace('https://stub.blob/', '');
  return store.has(k) ? { ok: true, json: async () => JSON.parse(store.get(k).toString()) } : { ok: false };
};

let t = 1_000_000;
const handler = criarHandler(blob, () => t);
process.env.TABELA_PIN = '4242';

function req(method, headers = {}, body = null) {
  const r = Readable.from(body ? [body] : []);
  r.method = method; r.headers = headers; r.socket = { remoteAddress: '1.2.3.4' };
  return r;
}
function res() {
  return { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
}
async function chama(r) { const s = res(); await handler(r, s); return { s, j: s.body ? JSON.parse(s.body) : null }; }

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 2)]);

// GET sem foto
let r = await chama(req('GET'));
assert.equal(r.s.statusCode, 200); assert.equal(r.j.url, null); console.log('ok GET vazio ->', r.s.statusCode, r.j);

// POST sem PIN / PIN errado
r = await chama(req('POST', { 'content-type': 'image/jpeg' }, JPG));
assert.equal(r.s.statusCode, 401); console.log('ok sem PIN ->', r.s.statusCode);
r = await chama(req('POST', { 'x-pin': '0000', 'content-type': 'image/jpeg' }, JPG));
assert.equal(r.s.statusCode, 429, 'segunda tentativa logo em seguida deve esperar'); console.log('ok espera crescente ->', r.s.statusCode, r.j);
t += 10_000;
r = await chama(req('POST', { 'x-pin': '0000', 'content-type': 'image/jpeg' }, JPG));
assert.equal(r.s.statusCode, 401); console.log('ok PIN errado ->', r.s.statusCode, r.j);
t += 60_000;

// tipo inválido e conteúdo que não bate com o tipo
r = await chama(req('POST', { 'x-pin': '4242', 'content-type': 'application/pdf' }, JPG));
assert.equal(r.s.statusCode, 415); console.log('ok tipo invalido ->', r.s.statusCode);
r = await chama(req('POST', { 'x-pin': '4242', 'content-type': 'image/jpeg' }, Buffer.from('nao sou imagem')));
assert.equal(r.s.statusCode, 415); console.log('ok conteudo falso ->', r.s.statusCode);

// grande demais
r = await chama(req('POST', { 'x-pin': '4242', 'content-type': 'image/jpeg' }, Buffer.concat([JPG, Buffer.alloc(6.5 * 1024 * 1024)])));
assert.equal(r.s.statusCode, 413); console.log('ok > 6 MB ->', r.s.statusCode);

// sucesso 1
r = await chama(req('POST', { 'x-pin': '4242', 'content-type': 'image/jpeg' }, JPG));
assert.equal(r.s.statusCode, 200); assert.ok(r.j.url.includes('tabela/foto')); const url1 = r.j.url; console.log('ok publicar ->', r.j);
r = await chama(req('GET'));
assert.equal(r.s.statusCode, 200); assert.equal(r.j.url, url1); assert.ok(r.j.atualizadoEm); assert.match(r.s.headers['cache-control'], /max-age=60/);
console.log('ok GET devolve', r.j, '| cache-control:', r.s.headers['cache-control']);

// sucesso 2 (PNG) troca a foto e apaga a anterior
t += 1000;
r = await chama(req('POST', { 'x-pin': '4242', 'content-type': 'image/png' }, PNG));
assert.equal(r.s.statusCode, 200); const url2 = r.j.url; assert.notEqual(url2, url1);
assert.equal(store.has(url1.replace('https://stub.blob/', '')), false, 'foto anterior removida');
r = await chama(req('GET')); assert.equal(r.j.url, url2);
console.log('ok troca de foto; anterior removida; GET aponta para a nova');

// método inválido e sem PIN configurado
r = await chama(req('DELETE')); assert.equal(r.s.statusCode, 405);
delete process.env.TABELA_PIN;
r = await chama(req('POST', { 'x-pin': '4242', 'content-type': 'image/jpeg' }, JPG)); assert.equal(r.s.statusCode, 503);
console.log('ok 405 e 503 (sem TABELA_PIN)');
console.log('\nTODOS OS TESTES PASSARAM');
