// Proxy CORS da API GPS da SMTR para o app "Ônibus Rio ao Vivo".
// Cloudflare Workers, plano gratuito: NÃO processa o JSON (limite de 10 ms de CPU); só repassa o corpo
// da resposta, com CORS e cache de borda. A consolidação (posição mais recente por veículo) é feita no celular.
const BASE = 'https://dados.mobilidade.rio/gps/sppo';
const JANELA_MIN = 2;
const CACHE_S = 30;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function horaRio(d) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(d);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const cache = caches.default;
    const chave = new Request('https://smtr-cache.invalid/gps', { method: 'GET' });
    const guardado = await cache.match(chave);
    if (guardado) {
      const r = new Response(guardado.body, guardado);
      r.headers.set('X-Cache', 'HIT');
      return r;
    }

    try {
      const fim = new Date();
      const ini = new Date(fim.getTime() - JANELA_MIN * 60000);
      const url = BASE + '?dataInicial=' + encodeURIComponent(horaRio(ini)) + '&dataFinal=' + encodeURIComponent(horaRio(fim));
      const origem = await fetch(url);
      if (!origem.ok) throw new Error('SMTR HTTP ' + origem.status);

      const resposta = new Response(origem.body, {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=' + CACHE_S,
          'X-Cache': 'MISS',
        },
      });
      ctx.waitUntil(cache.put(chave, resposta.clone()));
      return resposta;
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  },
};
