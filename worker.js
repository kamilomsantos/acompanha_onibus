// Proxy CORS das APIs de GPS da SMTR para o app "Ônibus Rio ao Vivo".
// Cloudflare Workers, plano gratuito: NÃO processa o JSON (limite de ~10 ms de CPU); só repassa o corpo da
// resposta, com CORS e cache de borda. A consolidação (posição mais recente por veículo) é feita no celular.
//
// Rotas:  /  ou  /sppo  -> ônibus municipais (endereço novo "conecta"; se falhar, o antigo "/gps/sppo")
//         /brt          -> BRT ({ veiculos: [...] })
//
// Cache (por data center): até FRESCO_S segundos devolve direto (HIT); entre FRESCO_S e VELHO_MAX_S devolve o dado
// guardado NA HORA (STALE) e atualiza em segundo plano, para ninguém esperar a SMTR (~3 s); acima disso busca antes.

const SPPO_NOVO   = 'https://dados.mobilidade.rio/sppo/conecta/gps';
const SPPO_ANTIGO = 'https://dados.mobilidade.rio/gps/sppo';
const BRT         = 'https://dados.mobilidade.rio/gps/brt';
const JANELA_MIN  = 2;
const MIN_BYTES   = { sppo: 1000, brt: 2000 };   // abaixo disso a resposta é considerada vazia/defeituosa

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'X-Cache, X-Idade, X-Fonte',
};

function horaRio(d) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(d);
}

async function baixar(url, minBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('SMTR HTTP ' + r.status);
  const tam = Number(r.headers.get('content-length') || 0);
  if (tam && tam < minBytes) throw new Error('resposta pequena (' + tam + ' B)');
  return r;
}

// devolve { resposta, fonte } sem ler o corpo (stream)
const FONTES = {
  async sppo() {
    const fim = new Date(), ini = new Date(fim.getTime() - JANELA_MIN * 60000);
    try {
      const r = await baixar(SPPO_NOVO + '?dataInicial=' + ini.toISOString() + '&dataFinal=' + fim.toISOString(), MIN_BYTES.sppo);
      return { resposta: r, fonte: 'conecta' };
    } catch (e) {
      const r = await baixar(SPPO_ANTIGO + '?dataInicial=' + encodeURIComponent(horaRio(ini)) + '&dataFinal=' + encodeURIComponent(horaRio(fim)), MIN_BYTES.sppo);
      return { resposta: r, fonte: 'antigo' };
    }
  },
  async brt() {
    return { resposta: await baixar(BRT, MIN_BYTES.brt), fonte: 'brt' };
  },
};

function chaveCache(nome) { return new Request('https://smtr-cache.invalid/' + nome, { method: 'GET' }); }

async function atualizar(nome, env) {
  const velho = Number(env && env.VELHO_MAX_S) || 180;
  const { resposta, fonte } = await FONTES[nome]();
  const guardar = new Response(resposta.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
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
    if (caminho === '/' || caminho === '/sppo') return servir('sppo', ctx, env);
    if (caminho === '/brt') return servir('brt', ctx, env);
    // ── sessão ──
    if (caminho === '/sessao/criar' && request.method === 'POST') return sessaoCriar(env);
    const mPos = caminho.match(/^\/sessao\/([A-Z0-9]{4,6})\/([^/]+)$/);
    if (mPos && request.method === 'POST') return sessaoPost(mPos[1], mPos[2], env, request);
    const mGet = caminho.match(/^\/sessao\/([A-Z0-9]{4,6})$/);
    if (mGet && request.method === 'GET') return sessaoGet(mGet[1], env);
    return new Response(JSON.stringify({ error: 'rota desconhecida', rotas: ['/', '/sppo', '/brt', '/sessao/criar', '/sessao/:codigo'] }), {
      status: 404,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};
