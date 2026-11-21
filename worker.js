// Proxy CORS das APIs de GPS da SMTR para o app "Aê, Piloto".
// Cloudflare Workers, plano gratuito: NÃO processa os dados (limite de ~10 ms de CPU); só repassa o corpo da
// resposta, com CORS e cache de borda. A decodificação e a consolidação (posição mais recente por veículo) são feitas no celular.
//
// Rotas:  /rt      -> ônibus municipais, feed GTFS-Realtime (protobuf; o app decodifica)
//         /rt-brt  -> BRT, feed GTFS-Realtime (protobuf; o app decodifica)
//         /sessao/... -> rastreamento por código (aba Encontro, exige o KV SESSOES)
// (Removidos em 21/11/2026: as rotas "/", "/sppo" e "/brt" e os JSON antigos da SMTR — "/sppo/conecta/gps", "/gps/sppo" e
//  "/gps/brt" —, que foram desligados ou migrados para o GTFS-Realtime.)
//
// Cache (por data center): até FRESCO_S segundos devolve direto (HIT); entre FRESCO_S e VELHO_MAX_S devolve o dado
// guardado NA HORA (STALE) e atualiza em segundo plano, para ninguém esperar a SMTR (~3 s); acima disso busca antes.

// Feeds GTFS-Realtime (protobuf): ônibus (~185 KB) e BRT (~23 KB). Substituíram os JSON antigos da SMTR.
const RT_ONIBUS   = 'https://dados.mobilidade.rio/gtfs/realtime/onibus/vehicle-positions';
const RT_BRT      = 'https://dados.mobilidade.rio/gtfs/realtime/brt/vehicle-positions';
const MIN_BYTES   = { rt: 5000, 'rt-brt': 2000 };   // abaixo disso a resposta é considerada vazia/defeituosa
const TIPO        = 'application/x-protobuf';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'X-Cache, X-Idade, X-Fonte',
};

async function baixar(url, minBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('SMTR HTTP ' + r.status);
  const tam = Number(r.headers.get('content-length') || 0);
  if (tam && tam < minBytes) throw new Error('resposta pequena (' + tam + ' B)');
  return r;
}

// devolve { resposta, fonte } sem ler o corpo (stream)
const FONTES = {
  async rt() {
    return { resposta: await baixar(RT_ONIBUS, MIN_BYTES.rt), fonte: 'gtfs-rt' };
  },
  async 'rt-brt'() {
    return { resposta: await baixar(RT_BRT, MIN_BYTES['rt-brt']), fonte: 'gtfs-rt-brt' };
  },
};

function chaveCache(nome) { return new Request('https://smtr-cache.invalid/' + nome, { method: 'GET' }); }

async function atualizar(nome, env) {
  const velho = Number(env && env.VELHO_MAX_S) || 180;
  const { resposta, fonte } = await FONTES[nome]();
  const guardar = new Response(resposta.body, {
    status: 200,
    headers: {
      'Content-Type': TIPO,
      'Cache-Control': 'public, max-age=' + velho,
      'X-Gerado': String(Date.now()),
      'X-Fonte': fonte,
    },
  });
  await caches.default.put(chaveCache(nome), guardar.clone());
  return guardar;
}

function responder(resp, status, idade) {
  const r = new Response(resp.body, resp);
  Object.keys(CORS).forEach(k => r.headers.set(k, CORS[k]));
  r.headers.set('Cache-Control', 'public, max-age=20');
  r.headers.set('X-Cache', status);
  r.headers.set('X-Idade', String(Math.round(idade)));
  return r;
}

async function servir(nome, ctx, env) {
  const fresco = Number(env && env.FRESCO_S) || 30;
  const velho  = Number(env && env.VELHO_MAX_S) || 180;
  const cache  = caches.default;
  const guardado = await cache.match(chaveCache(nome));
  let idade = 1e9;

  if (guardado) {
    idade = (Date.now() - Number(guardado.headers.get('X-Gerado') || 0)) / 1000;
    if (idade <= fresco) return responder(guardado, 'HIT', idade);
    if (idade <= velho) {
      // responde com o dado guardado e atualiza em segundo plano (uma atualização por vez)
      const trava = chaveCache(nome + ':trava');
      if (!(await cache.match(trava))) {
        await cache.put(trava, new Response('1', { headers: { 'Cache-Control': 'max-age=20' } }));
        ctx.waitUntil(atualizar(nome, env).catch(() => {}));
      }
      return responder(guardado, 'STALE', idade);
    }
  }

  try {
    return responder(await atualizar(nome, env), 'MISS', 0);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

// ─── Rastreamento em tempo real (KV: SESSOES) ──────────────────────────────
// Para ativar: crie um KV namespace "SESSOES" no painel do Cloudflare,
// adicione ao wrangler.toml:
//   [[kv_namespaces]]
//   binding = "SESSOES"
//   id = "<id do namespace>"
// Sem o KV os endpoints retornam 503 e o app desativa a aba com aviso.

const SESS_CHARS = 'BCDFGHJKMNPQRSTVWXYZ23456789';
function codRand() {
  return Array.from({length:5}, () => SESS_CHARS[Math.floor(Math.random() * SESS_CHARS.length)]).join('');
}

async function sessaoCriar(env) {
  if (!env.SESSOES) return new Response(JSON.stringify({error:'kv_nao_configurado'}),
    {status:503, headers:{...CORS,'Content-Type':'application/json'}});
  const codigo = codRand();
  await env.SESSOES.put(`sess:${codigo}:_`, '1', {expirationTtl:7200});
  return new Response(JSON.stringify({codigo}), {headers:{...CORS,'Content-Type':'application/json'}});
}

async function sessaoPost(codigo, pid, env, req) {
  if (!env.SESSOES) return new Response(JSON.stringify({error:'kv_nao_configurado'}),
    {status:503, headers:{...CORS,'Content-Type':'application/json'}});
  let b; try { b = await req.json(); } catch(e) { return new Response('JSON inválido', {status:400, headers:CORS}); }
  if (!b.lat || !b.lng) return new Response('lat/lng obrigatórios', {status:400, headers:CORS});
  await env.SESSOES.put(`sess:${codigo}:${pid}`,
    JSON.stringify({lat:b.lat, lng:b.lng, ts:Date.now(), nome:b.nome||''}),
    {expirationTtl:7200});
  return new Response('ok', {headers:CORS});
}

async function sessaoGet(codigo, env) {
  if (!env.SESSOES) return new Response(JSON.stringify({error:'kv_nao_configurado'}),
    {status:503, headers:{...CORS,'Content-Type':'application/json'}});
  const lista = await env.SESSOES.list({prefix:`sess:${codigo}:`});
  const ps = await Promise.all(lista.keys.map(async k => {
    const pid = k.name.slice(`sess:${codigo}:`.length);
    if (pid === '_') return null;
    const v = await env.SESSOES.get(k.name);
    return v ? {pid, ...JSON.parse(v)} : null;
  }));
  return new Response(JSON.stringify(ps.filter(Boolean)),
    {headers:{...CORS,'Content-Type':'application/json'}});
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const caminho = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (caminho === '/rt') return servir('rt', ctx, env);
    if (caminho === '/rt-brt') return servir('rt-brt', ctx, env);
    // ── sessão ──
    if (caminho === '/sessao/criar' && request.method === 'POST') return sessaoCriar(env);
    const mPos = caminho.match(/^\/sessao\/([A-Z0-9]{4,6})\/([^/]+)$/);
    if (mPos && request.method === 'POST') return sessaoPost(mPos[1], mPos[2], env, request);
    const mGet = caminho.match(/^\/sessao\/([A-Z0-9]{4,6})$/);
    if (mGet && request.method === 'GET') return sessaoGet(mGet[1], env);
    return new Response(JSON.stringify({ error: 'rota desconhecida', rotas: ['/rt', '/rt-brt', '/sessao/criar', '/sessao/:codigo'] }), {
      status: 404,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};
