// Núcleo da API da tabela semanal. Recebe o módulo do Blob por parâmetro (facilita testar com um stub).
import { createHash, timingSafeEqual } from 'node:crypto';

const PONTEIRO = 'tabela/atual.json';
const MAX_BYTES = 6 * 1024 * 1024; // a plataforma da Vercel aceita ~4,5 MB por requisição; o navegador já comprime para bem menos
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// tentativas erradas por IP, em memória: espera cresce 2x a cada erro (até 15 min)
const falhas = new Map();

function ip(req) {
  const xf = req.headers['x-forwarded-for'];
  return (Array.isArray(xf) ? xf[0] : xf || '').split(',')[0].trim() || req.socket?.remoteAddress || 'desconhecido';
}

function iguais(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function tipoPeloConteudo(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

async function lerCorpo(req) {
  const partes = [];
  let total = 0;
  for await (const p of req) {
    total += p.length;
    if (total > MAX_BYTES) throw Object.assign(new Error('grande'), { codigo: 413 });
    partes.push(p);
  }
  return Buffer.concat(partes);
}

function json(res, status, corpo, cache) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', cache || 'no-store');
  res.end(JSON.stringify(corpo));
}

export function criarHandler(blob, agora = () => Date.now()) {
  const { put, list, del } = blob;

  async function lerPonteiro() {
    const { blobs } = await list({ prefix: PONTEIRO, limit: 1 });
    const alvo = blobs.find((b) => b.pathname === PONTEIRO);
    if (!alvo) return null;
    const r = await fetch(`${alvo.url}?t=${agora()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return r.json();
  }

  return async function handler(req, res) {
    try {
      if (req.method === 'GET') {
        const atual = await lerPonteiro();
        if (!atual?.url) return json(res, 200, { url: null, atualizadoEm: null }, 'public, max-age=0, s-maxage=30'); // ainda sem upload: o site usa a foto estática
        return json(res, 200, { url: atual.url, atualizadoEm: atual.atualizadoEm }, 'public, max-age=60, s-maxage=60, stale-while-revalidate=60');
      }

      if (req.method !== 'POST') {
        res.setHeader('allow', 'GET, POST');
        return json(res, 405, { erro: 'metodo' });
      }

      const pinCerto = process.env.TABELA_PIN;
      if (!pinCerto) return json(res, 503, { erro: 'nao-configurado' });

      const quem = ip(req);
      const f = falhas.get(quem);
      if (f && f.ate > agora()) {
        const seg = Math.ceil((f.ate - agora()) / 1000);
        res.setHeader('retry-after', String(seg));
        return json(res, 429, { erro: 'aguarde', segundos: seg });
      }

      const pin = req.headers['x-pin'] || '';
      if (!iguais(pin, pinCerto)) {
        const n = (f?.n || 0) + 1;
        falhas.set(quem, { n, ate: agora() + Math.min(2 ** n * 1000, 15 * 60 * 1000) });
        return json(res, 401, { erro: 'nao-autorizado' });
      }
      falhas.delete(quem);

      const tipoDeclarado = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!TIPOS[tipoDeclarado]) return json(res, 415, { erro: 'tipo' });

      let corpo;
      try {
        corpo = await lerCorpo(req);
      } catch (e) {
        if (e.codigo === 413) return json(res, 413, { erro: 'grande' });
        throw e;
      }
      if (!corpo.length) return json(res, 400, { erro: 'vazio' });
      if (tipoPeloConteudo(corpo) !== tipoDeclarado) return json(res, 415, { erro: 'tipo' });

      let anterior = null;
      try { anterior = await lerPonteiro(); } catch { /* sem ponteiro antigo */ }

      const foto = await put(`tabela/foto.${TIPOS[tipoDeclarado]}`, corpo, {
        access: 'public',
        addRandomSuffix: true,
        contentType: tipoDeclarado,
        cacheControlMaxAge: 31536000,
      });
      const atualizadoEm = new Date(agora()).toISOString();
      await put(PONTEIRO, JSON.stringify({ url: foto.url, atualizadoEm }), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });

      // limpa a foto anterior (ponteiro já aponta para a nova); falha aqui não importa
      if (anterior?.url && anterior.url !== foto.url) { try { await del(anterior.url); } catch { /* ignora */ } }

      return json(res, 200, { ok: true, url: foto.url, atualizadoEm });
    } catch (e) {
      console.error('tabela:', e && e.message);
      return json(res, 500, { erro: 'falha' });
    }
  };
}
