// Gera novo.html (layout moderno + escolha de tema) a partir do index.html.
// index.html continua sendo a versão estável; este script só aplica por cima o visual novo.
// Uso: node gerar_novo.js
const fs = require('fs');
let s = fs.readFileSync(__dirname + '/index.html', 'utf8');
function rep(a, b) { if (!s.includes(a)) throw new Error('trecho não encontrado: ' + a.slice(0, 70)); s = s.replace(a, () => b); }

const CSS = `
/* ───────── Visual novo: tokens (escuro é o padrão; claro por escolha ou pelo aparelho) ───────── */
:root {
  --bg:#000000; --surf:#1c1c1e; --surf2:#2a2a2d; --fg:#f4f4f6; --muted:#9b9ba3; --border:#303034;
  --yellow:#8f93f8; --ydim:rgba(143,147,248,.16); --accent:#8f93f8; --accent-fg:#0b0b1a;
  --amber:#F59E0B; --green:#34D399; --gdim:rgba(52,211,153,.14); --blue:#60A5FA; --red:#F87171;
  --sombra:0 8px 28px rgba(0,0,0,.55); color-scheme: dark;
}
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) {
  --bg:#f2f2f7; --surf:#ffffff; --surf2:#efeff4; --fg:#1c1c1e; --muted:#6c6c75; --border:#e3e3ea;
  --yellow:#5b5fc7; --ydim:rgba(91,95,199,.12); --accent:#5b5fc7; --accent-fg:#ffffff;
  --amber:#D97706; --green:#059669; --gdim:rgba(5,150,105,.12); --blue:#2563EB; --red:#DC2626;
  --sombra:0 8px 28px rgba(20,20,60,.16); color-scheme: light; } }
:root[data-theme="light"] {
  --bg:#f2f2f7; --surf:#ffffff; --surf2:#efeff4; --fg:#1c1c1e; --muted:#6c6c75; --border:#e3e3ea;
  --yellow:#5b5fc7; --ydim:rgba(91,95,199,.12); --accent:#5b5fc7; --accent-fg:#ffffff;
  --amber:#D97706; --green:#059669; --gdim:rgba(5,150,105,.12); --blue:#2563EB; --red:#DC2626;
  --sombra:0 8px 28px rgba(20,20,60,.16); color-scheme: light;
}

/* ───────── Cabeçalho grande ───────── */
.topbar { background:transparent; border:none; padding:max(14px, env(safe-area-inset-top)) 16px 6px; gap:12px; }
.logo { width:44px; height:44px; border-radius:50%; background:var(--accent); color:var(--accent-fg); display:flex; align-items:center; justify-content:center; font-size:.72rem; letter-spacing:.04em; }
.topbar-title { font-size:1.7rem; font-weight:800; letter-spacing:-.02em; line-height:1.1; }
.topbar-sub { font-size:.72rem; margin-top:3px; }
#counter { display:none; }   /* o botão de tema ocupa o lugar do contador; o título volta a aparecer inteiro */
.btn-tema { width:40px; height:40px; border-radius:50%; border:none; background:var(--surf2); color:var(--fg); display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; }
.btn-tema svg { width:20px; height:20px; }
.menu-tema { position:absolute; right:14px; top:max(62px, calc(env(safe-area-inset-top) + 52px)); background:var(--surf); border:1px solid var(--border); border-radius:16px; box-shadow:var(--sombra); padding:6px; z-index:4000; min-width:190px; }
.menu-tema button { display:flex; width:100%; align-items:center; gap:10px; background:none; border:none; color:var(--fg); font-family:'Inter',sans-serif; font-size:.85rem; font-weight:600; padding:11px 12px; border-radius:11px; cursor:pointer; text-align:left; }
.menu-tema button:hover { background:var(--surf2); }
.menu-tema button.on { color:var(--accent); background:var(--ydim); }
.menu-tema .ck { margin-left:auto; opacity:0; } .menu-tema button.on .ck { opacity:1; }

/* ───────── Busca ───────── */
.search-bar { background:transparent; border:none; padding:6px 14px 10px; gap:8px; }
.search-bar input { background:var(--surf); border:1px solid transparent; border-radius:16px; padding:13px 40px 13px 48px; font-size:.9rem; color:var(--fg); box-shadow:0 1px 0 var(--border); }
.search-bar input:focus { border-color:var(--accent); }
.field-icon { left:12px; width:26px; height:26px; }
.field-icon.orig { background:var(--blue); color:#fff; } .field-icon.dest { background:var(--red); color:#fff; } .field-icon.line { background:var(--amber); color:#000; }
.btn-gps { background:var(--surf2); border:none; color:var(--fg); border-radius:14px; padding:11px 13px; font-size:.78rem; }
.btn-ir { background:var(--accent); color:var(--accent-fg); border-radius:14px; padding:12px 18px; font-size:.86rem; }
.btn-ir:hover { background:var(--accent); filter:brightness(1.1); }
.search-top { color:var(--muted); }
.ac-drop { border-radius:16px; background:var(--surf); box-shadow:var(--sombra); }
.fav-btn.on { color:var(--amber); }

/* ───────── Mapa claro em cartão arredondado ───────── */
#map { margin:2px 12px 8px; border-radius:22px; overflow:hidden; box-shadow:0 2px 14px rgba(0,0,0,.25); background:#e8e8e8; }
.leaflet-container { background:#e8e8e8; }

/* ───────── Lista (painel) ───────── */
.panel { background:var(--surf); border:none; border-radius:26px 26px 0 0; box-shadow:0 -6px 24px rgba(0,0,0,.28); max-height:38vh; }
.panel-head { background:var(--surf); border-bottom:none; padding:12px 18px 8px; font-size:.7rem; letter-spacing:.06em; color:var(--muted); }
.gm-link { background:var(--surf2); border:none; border-radius:999px; padding:5px 10px; color:var(--accent); }
.brow, .lrow, .rrow { border-bottom:none; border-radius:16px; margin:0 10px 6px; padding:11px 12px; background:var(--surf2); }
.brow.nearest { background:var(--gdim); }
.trip { margin:0 10px 8px; border-radius:18px; background:var(--surf2); border-bottom:none; padding:12px 14px; }
.trip.sel, .lrow.sel { background:var(--gdim); box-shadow:inset 0 0 0 2px var(--green); }
.trip:hover, .lrow:hover, .rrow:hover { background:var(--surf2); filter:brightness(1.06); }
.tline { background:var(--amber); color:#fff; border-radius:10px; padding:2px 10px; }
.tline.brt { background:#2f81f7; color:#fff; }
.bline, .bmarker { color:#000; } .bline { color:var(--amber); }
.bmarker { background:var(--amber); }
.chip { color:var(--amber); border-radius:999px; background:var(--surf2); border:none; padding:5px 11px; }
.tgroup { background:transparent; border:none; padding:10px 18px 4px; }
.tsec { padding:12px 18px 4px; color:var(--accent); }
.tsec.ok { color:var(--green); }
.tnote { border-bottom:none; padding:6px 18px; }
.tsep { padding:0 18px; }
.tgroup + .trip, .tsep + .trip { border-bottom:none; }
.toast { background:var(--surf); color:var(--fg); border-radius:16px; }
.empty { padding:22px 20px; }

/* ───────── Barra de abas embaixo, com ícones ───────── */
.tabs { background:var(--surf); border:none; padding:6px 8px max(8px, env(safe-area-inset-bottom)); gap:4px; }
.tabs button { border:none; padding:6px 0 4px; letter-spacing:0; text-transform:none; font-size:.7rem; font-weight:600; display:flex; flex-direction:column; align-items:center; gap:3px; color:var(--muted); }
.tabs button svg { width:24px; height:24px; padding:4px 14px; box-sizing:content-box; border-radius:999px; transition:background .2s; }
.tabs button.on { color:var(--accent); border:none; }
.tabs button.on svg { background:var(--ydim); }
.topbar { order:1; } .search-bar { order:2; } #map { order:3; } .panel { order:4; } .tabs { order:5; }
@media (min-width:800px) {
  #side { background:var(--bg); border-right:1px solid var(--border); }
  .topbar, .search-bar, #map, .tabs, .panel { order:0; }
  .tabs { border-radius:0; border-bottom:1px solid var(--border); }
  .panel { border-radius:0; box-shadow:none; max-height:none; flex:1; }
  #map { margin:12px; height:calc(100% - 24px); }
  #side { position:relative; } .menu-tema { right:auto; left:190px; }
}
`;

// 1) CSS novo por cima do antigo
rep('</style>', CSS + '</style>');

// 2) título + botão de tema
rep('<title>Ônibus Rio ao Vivo</title>', '<title>Ônibus Rio ao Vivo</title>\n<meta name="theme-color" content="#000000">');
rep('  <span id="counter">--</span>\n  <div class="dot wait" id="sdot"></div>\n</div>',
  '  <span id="counter">--</span>\n  <div class="dot wait" id="sdot"></div>\n' +
  '  <button type="button" class="btn-tema" id="btn-tema" aria-label="Escolher tema" aria-haspopup="true">' +
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg></button>\n' +
  '</div>\n<div class="menu-tema" id="menu-tema" hidden>' +
  '<button type="button" data-tema="auto">🌗 Automático (do aparelho)<span class="ck">✓</span></button>' +
  '<button type="button" data-tema="light">☀️ Claro<span class="ck">✓</span></button>' +
  '<button type="button" data-tema="dark">🌙 Escuro<span class="ck">✓</span></button></div>');

// 3) abas com ícone
const ico = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
rep('<button type="button" class="on" data-tab="dir">Direções</button>',
  '<button type="button" class="on" data-tab="dir">' + ico('<path d="M3 11l18-8-8 18-2-8z"/>') + 'Direções</button>');
rep('<button type="button" data-tab="lin">Linhas</button>',
  '<button type="button" data-tab="lin">' + ico('<rect x="4" y="3" width="16" height="14" rx="3"/><path d="M4 11h16M8 21v-2M16 21v-2"/><circle cx="8" cy="14" r=".5"/><circle cx="16" cy="14" r=".5"/>') + 'Linhas</button>');
rep('<button type="button" data-tab="rec">Recorrentes</button>',
  '<button type="button" data-tab="rec">' + ico('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>') + 'Recorrentes</button>');

// 4) avisos em amarelo continuam âmbar (a cor de destaque agora é lilás)
s = s.split("aviso.style.color = 'var(--yellow)'").join("aviso.style.color = 'var(--amber)'");
s = s.split("av.style.color = 'var(--yellow)'").join("av.style.color = 'var(--amber)'");

// 5) lógica do tema
const JS = `
// ───────── Tema: automático / claro / escuro (lembrado neste aparelho) ─────────
(function() {
  var KEY = 'onibus.tema', raiz = document.documentElement, menu = document.getElementById('menu-tema'), btn = document.getElementById('btn-tema');
  function ler() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function aplicar(m) {
    if (m === 'light' || m === 'dark') raiz.setAttribute('data-theme', m); else raiz.removeAttribute('data-theme');
    [].forEach.call(menu.querySelectorAll('button'), function(b) { b.classList.toggle('on', b.getAttribute('data-tema') === m); });
    var escuro = m === 'dark' || (m !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', escuro ? '#000000' : '#f2f2f7');
  }
  btn.addEventListener('click', function(e) { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', function(e) { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  menu.addEventListener('click', function(e) {
    var b = e.target.closest('button'); if (!b) return;
    var m = b.getAttribute('data-tema'); try { localStorage.setItem(KEY, m); } catch (x) {}
    aplicar(m); menu.hidden = true;
  });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() { aplicar(ler()); });
  aplicar(ler());
})();
`;
rep('</script>\n</body>', JS + '</script>\n</body>');

fs.writeFileSync(__dirname + '/novo.html', s);
console.log('novo.html gerado:', (s.length / 1024).toFixed(0), 'KB');
