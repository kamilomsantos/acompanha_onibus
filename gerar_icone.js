// Gera icon-192.png e icon-512.png sem dependências externas (só Node.js built-in)
// Uso: node gerar_icone.js
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// Paleta do app
const ACCENT = [143, 147, 248];  // #8F93F8
const BG     = [28,  28,  30 ];  // #1C1C1E

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(size) {
  const raw = [];
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const outer = size * 0.46;  // ícone circular
  const ring  = size * 0.36;  // anel interno mais claro
  const core  = size * 0.20;  // centro sólido

  for (let y = 0; y < size; y++) {
    raw.push(0);  // filtro PNG: None
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      let r, g, b, a;
      if (d <= core) {
        // Núcleo branco brilhante
        [r, g, b, a] = [220, 220, 255, 255];
      } else if (d <= ring) {
        // Anel escuro (espaço interno)
        [r, g, b, a] = [BG[0] + 10, BG[1] + 10, BG[2] + 14, 255];
      } else if (d <= outer) {
        // Anel externo accent (roxo/lavanda)
        [r, g, b, a] = [...ACCENT, 255];
      } else {
        // Fundo transparente (maskable: corners vêem o BG embaixo)
        [r, g, b, a] = [...BG, 0];
      }
      raw.push(r, g, b, a);
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(raw));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;  // 8-bit RGBA
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

const dir = path.dirname(require.main.filename);
for (const sz of [192, 512]) {
  const out = path.join(dir, `icon-${sz}.png`);
  fs.writeFileSync(out, makePNG(sz));
  console.log(`✓ icon-${sz}.png  (${fs.statSync(out).size} bytes)`);
}
console.log('Ícones gerados. Substitua por uma versão artística se quiser.');
