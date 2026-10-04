// Coleta o GPS dos ônibus (SMTR) e grava um JSON enxuto: gps.json
// Horários da API estão em hora do Rio (a API coloca "Z" mas não é UTC).
const fs = require('fs');

const BASE = 'https://dados.mobilidade.rio/gps/sppo';
const JANELA_MIN = 3;
const SAIDA = process.argv[2] || 'gps.json';

function horaRio(d) {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(d);
  return p; // "YYYY-MM-DD HH:MM:SS"
}

async function buscar() {
  const fim = new Date();
  const ini = new Date(fim.getTime() - JANELA_MIN * 60000);
  const url = BASE + '?dataInicial=' + encodeURIComponent(horaRio(ini)) +
              '&dataFinal=' + encodeURIComponent(horaRio(fim));
  let ultimoErro;
  for (let t = 1; t <= 4; t++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(100000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = JSON.parse(await r.text());
      if (!Array.isArray(j)) throw new Error('resposta inesperada');
      return { dados: j, fim };
    } catch (e) {
      ultimoErro = e;
      console.error('tentativa ' + t + ' falhou: ' + e.message);
      await new Promise(res => setTimeout(res, 5000 * t));
    }
  }
  throw ultimoErro;
}

(async () => {
  const { dados, fim } = await buscar();
  const ultimo = new Map();
  for (const b of dados) {
    if (b.latitude == null || b.longitude == null || !b.id_veiculo) continue;
    const atual = ultimo.get(b.id_veiculo);
    if (!atual || String(b.datetime) > String(atual.datetime)) ultimo.set(b.id_veiculo, b);
  }
  const buses = [...ultimo.values()].map(b => [
    String(b.servico || ''), b.id_veiculo,
    Math.round(b.latitude * 1e5) / 1e5, Math.round(b.longitude * 1e5) / 1e5,
    Math.round(b.velocidade || 0), b.sentido || '', b.datetime
  ]);
  if (buses.length < 100) throw new Error('poucos veiculos (' + buses.length + ') - nao publicar');
  fs.writeFileSync(SAIDA, JSON.stringify({ updated: horaRio(fim), buses }));
  console.log('OK: ' + buses.length + ' veiculos, ' + new Set(buses.map(b => b[0])).size + ' linhas');
})().catch(e => { console.error('ERRO: ' + e.message); process.exit(1); });
