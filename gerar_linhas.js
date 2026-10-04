// Gera linhas.json (traçados + paradas por linha) a partir do GTFS da SMTR.
// Uso: node gerar_linhas.js <pasta-do-gtfs-descompactado> [saida]
// GTFS: https://dados.mobilidade.rio/gtfs/schedule (zip, atualizado todo mês)
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const P = require('./planner.js');

const dir = process.argv[2];
const saida = process.argv[3] || 'linhas.json';
if (!dir) { console.error('Informe a pasta do GTFS.'); process.exit(1); }

function parseLinha(l) {
  const out = []; let c = '', q = false;
  for (const ch of l) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(c); c = ''; }
    else c += ch;
  }
  out.push(c);
  return out;
}
function csv(nome) {
  const L = fs.readFileSync(path.join(dir, nome), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const h = parseLinha(L[0]);
  return L.slice(1).map(l => { const p = parseLinha(l), o = {}; h.forEach((k, i) => o[k] = p[i]); return o; });
}
const r5 = v => Math.round(parseFloat(v) * 1e5) / 1e5;

(async () => {
  const routes = new Map(csv('routes.txt').map(r => [r.route_id, r.route_short_name]));
  const trips = csv('trips.txt');
  const stops = new Map(csv('stops.txt').map(s => [s.stop_id, s]));

  const hm = s => { const p = String(s).split(':'); return (+p[0]) * 60 + (+p[1]) + (+p[2] || 0) / 60; };

  // 1a leitura: horário de partida de cada trip
  const partida = new Map();
  {
    const rl0 = readline.createInterface({ input: fs.createReadStream(path.join(dir, 'stop_times.txt'), 'utf8'), crlfDelay: Infinity });
    let c0 = true;
    for await (const l of rl0) {
      if (c0) { c0 = false; continue; }
      const i1 = l.indexOf(',');
      const tid = l.slice(0, i1);
      if (partida.has(tid)) continue;
      partida.set(tid, hm(l.split(',')[4]));
    }
  }

  // um trip representativo por shape: o que parte mais perto do meio-dia
  const tripDoShape = new Map();
  for (const t of trips) {
    if (!t.shape_id || !partida.has(t.trip_id)) continue;
    const atual = tripDoShape.get(t.shape_id);
    if (!atual || Math.abs(partida.get(t.trip_id) - 720) < Math.abs(partida.get(atual.trip_id) - 720)) tripDoShape.set(t.shape_id, t);
  }
  const tripsEscolhidos = new Map([...tripDoShape.values()].map(t => [t.trip_id, t.shape_id]));

  // pontos dos shapes
  const pts = new Map();
  for (const r of csv('shapes.txt')) {
    if (!pts.has(r.shape_id)) pts.set(r.shape_id, []);
    pts.get(r.shape_id).push([+r.shape_pt_sequence, +r.shape_pt_lat, +r.shape_pt_lon]);
  }

  // paradas dos trips escolhidos (stop_times é grande: ler em fluxo)
  const paradasTrip = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, 'stop_times.txt'), 'utf8'), crlfDelay: Infinity });
  let cab = true;
  for await (const l of rl) {
    if (cab) { cab = false; continue; }
    const i1 = l.indexOf(','); const tid = l.slice(0, i1);
    if (!tripsEscolhidos.has(tid)) continue;
    const p = l.split(',');
    if (!paradasTrip.has(tid)) paradasTrip.set(tid, []);
    paradasTrip.get(tid).push([+p[1], p[2], hm(p[4])]);
  }

  const tabelaParadas = [], idxParada = new Map();
  function paradaIdx(id) {
    if (idxParada.has(id)) return idxParada.get(id);
    const s = stops.get(id);
    tabelaParadas.push([s.stop_name, r5(s.stop_lat), r5(s.stop_lon)]);
    idxParada.set(id, tabelaParadas.length - 1);
    return tabelaParadas.length - 1;
  }

  const shapes = {};
  for (const [sid, t] of tripDoShape) {
    const pp = pts.get(sid);
    const rota = routes.get(t.route_id);
    if (!pp || pp.length < 2 || !rota) continue;
    pp.sort((a, b) => a[0] - b[0]);
    const flat = [];
    pp.forEach(x => flat.push(x[1], x[2]));
    const simp = P.simplify(flat, 12).map(v => Math.round(v * 1e5) / 1e5);
    const sh = { r: rota, d: +t.direction_id || 0, h: t.trip_headsign || '', p: simp, s: [] };
    P.prep(sh);
    let from = 0;
    const lista = (paradasTrip.get(t.trip_id) || []).sort((a, b) => a[0] - b[0]);
    const t0 = lista.length ? lista[0][2] : 0;
    for (const [, stopId, tt] of lista) {
      const s = stops.get(stopId);
      if (!s) continue;
      const pr = P.project(sh, +s.stop_lat, +s.stop_lon, from);
      if (!pr) continue;
      from = pr.seg;
      sh.s.push([paradaIdx(stopId), Math.round(pr.along), Math.round((tt - t0) * 10) / 10]);
    }
    delete sh.cum; delete sh.n;
    shapes[sid] = sh;
  }

  const saidaObj = { gerado: new Date().toISOString().slice(0, 10), stops: tabelaParadas, shapes };
  fs.writeFileSync(saida, JSON.stringify(saidaObj));
  const pontos = Object.values(shapes).reduce((a, s) => a + s.p.length / 2, 0);
  console.log('shapes:', Object.keys(shapes).length, '| pontos:', pontos, '| paradas:', tabelaParadas.length,
    '| tamanho:', (fs.statSync(saida).size / 1048576).toFixed(2) + ' MB');
})().catch(e => { console.error(e); process.exit(1); });
