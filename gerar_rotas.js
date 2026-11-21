// Gera rotas.json: tabela route_id -> número da linha (route_short_name) do GTFS da SMTR.
// O feed de GPS em GTFS-Realtime traz o route_id (ex.: "O0636AAA0A"); o app trabalha com o número ("636").
// Uso: node gerar_rotas.js <pasta-do-gtfs-descompactado> [saida]
// Rodar junto com gerar_linhas.js (todo mês, quando o GTFS mudar) e subir a versão do app (APP_V).
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const saida = process.argv[3] || 'rotas.json';
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

const L = fs.readFileSync(path.join(dir, 'routes.txt'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
const h = parseLinha(L[0]);
const iId = h.indexOf('route_id'), iNome = h.indexOf('route_short_name');
const rotas = {};
for (const l of L.slice(1)) {
  const p = parseLinha(l);
  if (p[iId] && p[iNome]) rotas[p[iId]] = p[iNome];
}
fs.writeFileSync(saida, JSON.stringify(rotas));
console.log('rotas:', Object.keys(rotas).length, '| tamanho:', fs.statSync(saida).size, 'bytes');
