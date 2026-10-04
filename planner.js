// Geometria e planejamento de viagem (linhas diretas) a partir do GTFS + GPS ao vivo.
// Usado no navegador (script global "Planner") e no Node (build/teste).
(function (root) {
  var KY = 110540;
  function kx(lat) { return 111320 * Math.cos(lat * Math.PI / 180); }
  function hav(la1, lo1, la2, lo2) {
    var R = 6371000, d1 = (la2 - la1) * Math.PI / 180, d2 = (lo2 - lo1) * Math.PI / 180;
    var a = Math.sin(d1 / 2) * Math.sin(d1 / 2) + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(d2 / 2) * Math.sin(d2 / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // A API devolve hora do Rio com "Z" falso; interpretar como UTC-3.
  function rioMs(s) { return Date.parse(String(s).replace(' ', 'T').replace('Z', '') + '-03:00'); }
  function ageMin(s, now) { var t = rioMs(s); return isNaN(t) ? 0 : Math.max(0, (now - t) / 60000); }

  function prep(sh) {
    if (sh.cum) return sh;
    var p = sh.p, n = p.length / 2, cum = new Array(n);
    cum[0] = 0;
    for (var i = 1; i < n; i++) {
      var K = kx((p[2 * i - 2] + p[2 * i]) / 2);
      var dx = (p[2 * i + 1] - p[2 * i - 1]) * K, dy = (p[2 * i] - p[2 * i - 2]) * KY;
      cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
    }
    sh.n = n; sh.cum = cum;
    return sh;
  }

  // Projeta um ponto na polilinha: distância ao traçado (m) e posição ao longo dele (m).
  function project(sh, lat, lng, from) {
    prep(sh);
    var p = sh.p, n = sh.n, K = kx(lat), best = null, bd = Infinity;
    for (var i = from || 0; i < n - 1; i++) {
      var ax = (p[2 * i + 1] - lng) * K, ay = (p[2 * i] - lat) * KY;
      var bx = (p[2 * i + 3] - lng) * K, by = (p[2 * i + 2] - lat) * KY;
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      var t = l2 ? -(ax * dx + ay * dy) / l2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var cx = ax + t * dx, cy = ay + t * dy, d2 = cx * cx + cy * cy;
      if (d2 < bd) { bd = d2; best = { along: sh.cum[i] + t * (sh.cum[i + 1] - sh.cum[i]), seg: i }; }
    }
    if (best) best.d = Math.sqrt(bd);
    return best;
  }

  // Douglas-Peucker em metros. p = [lat,lng,lat,lng,...]
  function simplify(p, tol) {
    var n = p.length / 2;
    if (n < 3) return p.slice();
    var K = kx(p[0]), keep = new Uint8Array(n), stack = [[0, n - 1]];
    keep[0] = keep[n - 1] = 1;
    while (stack.length) {
      var s = stack.pop(), a = s[0], b = s[1];
      if (b <= a + 1) continue;
      var ax = p[2 * a + 1] * K, ay = p[2 * a] * KY, bx = p[2 * b + 1] * K, by = p[2 * b] * KY;
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, md = -1, mi = -1;
      for (var i = a + 1; i < b; i++) {
        var px = p[2 * i + 1] * K, py = p[2 * i] * KY;
        var t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        var ex = px - (ax + t * dx), ey = py - (ay + t * dy), d2 = ex * ex + ey * ey;
        if (d2 > md) { md = d2; mi = i; }
      }
      if (md > tol * tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    var out = [];
    for (var j = 0; j < n; j++) if (keep[j]) out.push(p[2 * j], p[2 * j + 1]);
    return out;
  }

  // Minutos (da grade horária) desde o início do trajeto até a posição "along".
  function tAt(sh, along) {
    var s = sh.s;
    if (along <= s[0][1]) return s[0][2];
    for (var i = 1; i < s.length; i++) {
      if (along <= s[i][1]) {
        var a = s[i - 1], b = s[i], span = b[1] - a[1];
        return span > 0 ? a[2] + (b[2] - a[2]) * (along - a[1]) / span : b[2];
      }
    }
    return s[s.length - 1][2];
  }
  function temGrade(sh) {
    if (sh.tok !== undefined) return sh.tok;
    var s = sh.s, ok = false;
    if (s.length > 2) {
      var dt = s[s.length - 1][2] - s[0][2], dm = s[s.length - 1][1] - s[0][1];
      ok = dt > 0 && dm / dt >= 80 && dm / dt <= 1000;
    }
    sh.tok = ok;
    return ok;
  }

  function dirOf(sentido) { return sentido === 'I' ? 0 : (sentido === 'V' ? 1 : null); }

  // Ônibus que estão circulando neste trajeto (sentido compatível e perto do traçado).
  function busesOnShape(sh, live, maxOff, sibs) {
    var out = [];
    live.forEach(function (b) {
      var bd = dirOf(b.d);
      if (bd !== null && bd !== sh.d) return;
      var pr = project(sh, b.lat, b.lng);
      if (!pr || pr.d > (maxOff || 150)) return;
      if (bd === null && sibs) {
        for (var i = 0; i < sibs.length; i++) {
          if (sibs[i] === sh) continue;
          var o = project(sibs[i], b.lat, b.lng);
          if (o && o.d < pr.d - 1) return;
        }
      }
      out.push({ b: b, along: pr.along });
    });
    return out;
  }

  // Viagens diretas A -> B. Estimativa: velocidade média fixa, sem baldeação.
  function plan(data, buses, A, B, now, opt) {
    opt = opt || {};
    var maxWalk = opt.maxWalk || 800, maxWalkA = opt.maxWalkA || maxWalk, maxWalkB = opt.maxWalkB || maxWalk, vMpm = (opt.vKmh || 15) * 1000 / 60, walkMpm = opt.walkMpm || 80;
    var minRide = opt.minRide || 400, maxWait = opt.maxWait || 60;
    var live = {};
    buses.forEach(function (b) { (live[b.s] = live[b.s] || []).push(b); });
    var best = {};
    ensureBySvc(data);

    Object.keys(data.shapes).forEach(function (sid) {
      var sh = data.shapes[sid], lv = live[sh.r];
      if (!lv) return;
      prep(sh);
      var sa = null;
      sh.s.forEach(function (st) {
        var s = data.stops[st[0]], d = hav(A.lat, A.lng, s[1], s[2]);
        if (d <= maxWalkA && (!sa || d < sa.d)) sa = { d: d, i: st[0], along: st[1] };
      });
      if (!sa) return;
      var sb = null;
      sh.s.forEach(function (st) {
        if (st[1] < sa.along + minRide) return;
        var s = data.stops[st[0]], d = hav(B.lat, B.lng, s[1], s[2]);
        if (d <= maxWalkB && (!sb || d < sb.d)) sb = { d: d, i: st[0], along: st[1] };
      });
      if (!sb) return;

      var walkA = sa.d / walkMpm;
      var useT = temGrade(sh);
      var waits = [];
      busesOnShape(sh, lv, 150, data.bySvc[sh.r]).forEach(function (o) {
        if (o.along > sa.along + 30) return;
        var idade = ageMin(o.b.t, now);
        if (idade > (opt.maxAge || 25)) return;
        var falta = useT ? Math.max(0, tAt(sh, sa.along) - tAt(sh, o.along)) : (sa.along - o.along) / vMpm;
        var w = Math.max(0, falta - idade);
        if (w >= walkA * 0.9 && w <= maxWait) waits.push({ w: w, b: o.b, along: o.along });
      });
      if (!waits.length) return;
      waits.sort(function (x, y) { return x.w - y.w; });

      var ride = useT ? tAt(sh, sb.along) - tAt(sh, sa.along) : (sb.along - sa.along) / vMpm;
      var walkB = sb.d / walkMpm;
      var total = waits[0].w + ride + walkB;
      var key = sh.r + '|' + sh.d;
      if (best[key] && best[key].total <= total) return;
      best[key] = {
        svc: sh.r, sid: sid, dir: sh.d, head: sh.h, modal: sh.m || '',
        stopA: data.stops[sa.i][0], walkAm: Math.round(sa.d), stopAll: sa,
        stopB: data.stops[sb.i][0], walkBm: Math.round(sb.d), stopBll: sb,
        waits: waits.slice(0, 3).map(function (x) { return Math.max(1, Math.round(x.w)); }),
        buses: waits.slice(0, 3),
        ride: Math.max(1, Math.round(ride)), total: Math.max(1, Math.round(total)),
        arrive: new Date(now + total * 60000)
      };
    });

    return Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return a.total - b.total; });
  }

  // Viagens com UMA baldeação A -> (linha X) -> parada de troca -> (linha Y) -> B.
  // Só considera X e Y com ônibus circulando; a espera pelo Y usa o ônibus ao vivo que chega depois de você.
  function planBaldeacao(data, buses, A, B, now, opt) {
    opt = opt || {};
    var maxWalkA = opt.maxWalkA || 500, maxWalkB = opt.maxWalkB || 700, maxXfer = opt.maxXfer || 300;
    var vMpm = (opt.vKmh || 15) * 1000 / 60, walkMpm = opt.walkMpm || 80, minX = opt.minRide || 400, minY = opt.minRideY || 300;
    var maxWait = opt.maxWait || 45, maxWaitY = opt.maxWaitY || 30, maxAge = opt.maxAge || 25, limite = opt.limit || 6;
    var live = {};
    buses.forEach(function (b) { (live[b.s] = live[b.s] || []).push(b); });
    ensureBySvc(data);

    function eta(sh, lv, alongStop) {
      var useT = temGrade(sh), out = [];
      busesOnShape(sh, lv, 150, data.bySvc[sh.r]).forEach(function (o) {
        if (o.along > alongStop + 30) return;
        var idade = ageMin(o.b.t, now);
        if (idade > maxAge) return;
        var falta = useT ? Math.max(0, tAt(sh, alongStop) - tAt(sh, o.along)) : (alongStop - o.along) / vMpm;
        out.push({ w: Math.max(0, falta - idade), b: o.b, along: o.along });
      });
      return out.sort(function (x, y) { return x.w - y.w; });
    }
    function viagem(sh, de, ate) { return temGrade(sh) ? tAt(sh, ate) - tAt(sh, de) : (ate - de) / vMpm; }

    var xs = [], ys = [];
    Object.keys(data.shapes).forEach(function (sid) {
      var sh = data.shapes[sid], lv = live[sh.r];
      if (!lv) return;
      prep(sh);
      var sa = null, sb = null;
      sh.s.forEach(function (st) {
        var s = data.stops[st[0]], da = hav(A.lat, A.lng, s[1], s[2]), db = hav(B.lat, B.lng, s[1], s[2]);
        if (da <= maxWalkA && (!sa || da < sa.d)) sa = { d: da, i: st[0], along: st[1] };
        if (db <= maxWalkB && (!sb || db < sb.d)) sb = { d: db, i: st[0], along: st[1] };
      });
      if (sa) {
        var ws = eta(sh, lv, sa.along).filter(function (x) { return x.w >= sa.d / walkMpm * 0.9 && x.w <= maxWait; });
        if (ws.length) xs.push({ sh: sh, sid: sid, sa: sa, waits: ws });
      }
      if (sb) ys.push({ sh: sh, sid: sid, sb: sb, lv: lv });
    });

    var melhor = {};
    xs.forEach(function (X) {
      ys.forEach(function (Y) {
        if (X.sh.r === Y.sh.r) return;
        var cands = [];
        X.sh.s.forEach(function (xt) {
          if (xt[1] < X.sa.along + minX) return;
          var px = data.stops[xt[0]];
          Y.sh.s.forEach(function (yt) {
            if (yt[1] > Y.sb.along - minY) return;
            var py = data.stops[yt[0]];
            if (Math.abs(px[1] - py[1]) > 0.004 || Math.abs(px[2] - py[2]) > 0.004) return;
            var d = hav(px[1], px[2], py[1], py[2]);
            if (d > maxXfer) return;
            cands.push({ xt: xt, yt: yt, d: d, c: viagem(X.sh, X.sa.along, xt[1]) + d / walkMpm * 1.5 + viagem(Y.sh, yt[1], Y.sb.along) });
          });
        });
        cands.sort(function (p, q) { return p.c - q.c; });
        var w1 = X.waits[0].w;
        for (var k = 0; k < cands.length && k < 6; k++) {
          var c = cands[k], rideX = viagem(X.sh, X.sa.along, c.xt[1]);
          var chega = w1 + rideX + c.d / walkMpm;
          var todos = eta(Y.sh, Y.lv, c.yt[1]);
          var ey = todos.filter(function (x) { return x.w >= chega - 0.5 && x.w - chega <= maxWaitY; }), est = false;
          if (!ey.length) {
            // sem ônibus previsto para a hora da troca: estima o intervalo pela quantidade de ônibus em circulação na linha
            if (!todos.length) continue;
            var dur = temGrade(Y.sh) ? Y.sh.s[Y.sh.s.length - 1][2] - Y.sh.s[0][2] : Y.sh.cum[Y.sh.n - 1] / vMpm;
            var esp = Math.min(20, Math.max(3, dur / todos.length / 2));
            ey = [{ w: chega + esp, b: null, along: 0 }]; est = true;
          }
          var rideY = viagem(Y.sh, c.yt[1], Y.sb.along), walkB = Y.sb.d / walkMpm;
          var total = ey[0].w + rideY + walkB;
          var key = X.sh.r + '|' + X.sh.d + '>' + Y.sh.r + '|' + Y.sh.d;
          if (melhor[key] && melhor[key].total <= total) break;
          melhor[key] = {
            total: Math.max(1, Math.round(total)), est: est, arrive: new Date(now + total * 60000), walkT: Math.round(c.d), esperaT: Math.max(0, Math.round(ey[0].w - chega)),
            x: { svc: X.sh.r, sid: X.sid, dir: X.sh.d, head: X.sh.h, modal: X.sh.m || '', stopA: data.stops[X.sa.i][0], walkAm: Math.round(X.sa.d), stopAll: X.sa,
                 stopT: data.stops[c.xt[0]][0], stopTll: { i: c.xt[0], along: c.xt[1] }, ride: Math.max(1, Math.round(rideX)),
                 waits: X.waits.slice(0, 3).map(function (x) { return Math.max(1, Math.round(x.w)); }), buses: X.waits.slice(0, 3) },
            y: { svc: Y.sh.r, sid: Y.sid, dir: Y.sh.d, head: Y.sh.h, modal: Y.sh.m || '', stopT: data.stops[c.yt[0]][0], stopTll: { i: c.yt[0], along: c.yt[1] },
                 stopB: data.stops[Y.sb.i][0], walkBm: Math.round(Y.sb.d), stopBll: Y.sb, ride: Math.max(1, Math.round(rideY)),
                 waits: ey.slice(0, 2).map(function (x) { return Math.max(1, Math.round(x.w - chega + 0)); }), buses: ey.filter(function (x) { return x.b; }).slice(0, 2) }
          };
          break;
        }
      });
    });
    return Object.keys(melhor).map(function (k) { melhor[k].key = k; return melhor[k]; })
      .sort(function (a, b) { return a.total - b.total; }).slice(0, limite);
  }

  // Pontos do traçado entre duas posições (m) para desenhar no mapa.
  function slice(sh, from, to) {
    prep(sh);
    var out = [];
    for (var i = 0; i < sh.n; i++) if (sh.cum[i] >= from && sh.cum[i] <= to) out.push([sh.p[2 * i], sh.p[2 * i + 1]]);
    return out;
  }

  function ensureBySvc(data) {
    if (data.bySvc) return;
    data.bySvc = {};
    Object.keys(data.shapes).forEach(function (id) {
      var s = data.shapes[id];
      s.sid = id;
      (data.bySvc[s.r] = data.bySvc[s.r] || []).push(s);
    });
  }

  // Todas as linhas com parada perto de um ponto (nos dois sentidos), com os próximos ônibus de cada uma.
  function linhasNoPonto(data, buses, P, now, opt) {
    opt = opt || {};
    var maxD = opt.maxDist || 500, vMpm = (opt.vKmh || 15) * 1000 / 60;
    var live = {}, best = {};
    buses.forEach(function (b) { (live[b.s] = live[b.s] || []).push(b); });
    var maxOutro = opt.maxOutroSentido || 1000;
    ensureBySvc(data);

    function paradaMaisPerto(sh, lim) {
      var sp = null;
      sh.s.forEach(function (st) {
        var s = data.stops[st[0]], d = hav(P.lat, P.lng, s[1], s[2]);
        if (d <= lim && (!sp || d < sp.d)) sp = { d: d, i: st[0], along: st[1] };
      });
      return sp;
    }
    function montar(sh, sp, longe) {
      prep(sh);
      var lv = live[sh.r], waits = [], useT = temGrade(sh);
      if (lv) busesOnShape(sh, lv, 150, data.bySvc[sh.r]).forEach(function (o) {
        if (o.along > sp.along + 30) return;
        var idade = ageMin(o.b.t, now);
        if (idade > (opt.maxAge || 25)) return;
        var falta = useT ? Math.max(0, tAt(sh, sp.along) - tAt(sh, o.along)) : (sp.along - o.along) / vMpm;
        var w = Math.max(0, falta - idade);
        if (w <= (opt.maxWait || 90)) waits.push({ w: w, b: o.b, along: o.along });
      });
      waits.sort(function (x, y) { return x.w - y.w; });
      var st0 = data.stops[sp.i];
      return {
        svc: sh.r, sid: sh.sid, dir: sh.d, head: sh.h, modal: sh.m || '', stop: st0[0], stopLL: [st0[1], st0[2]],
        dist: Math.round(sp.d), stopAll: sp, emCirculacao: !!lv, longe: !!longe,
        waits: waits.slice(0, 3).map(function (x) { return Math.max(1, Math.round(x.w)); }),
        buses: waits.slice(0, 3)
      };
    }

    // 1ª passada: sentidos com parada dentro do raio
    var achados = {};
    Object.keys(data.shapes).forEach(function (sid) {
      var sh = data.shapes[sid], sp = paradaMaisPerto(sh, maxD);
      if (!sp) return;
      var key = sh.r + '|' + sh.d;
      if (achados[key] && achados[key].sp.d <= sp.d) return;
      achados[key] = { sh: sh, sp: sp };
    });
    // 2ª passada: o outro sentido das mesmas linhas, mesmo que a parada seja mais longe
    var svcs = {};
    Object.keys(achados).forEach(function (k) { svcs[achados[k].sh.r] = true; });
    Object.keys(svcs).forEach(function (svc) {
      data.bySvc[svc].forEach(function (sh) {
        var key = svc + '|' + sh.d;
        if (achados[key] && !achados[key].longe) return;
        var sp = paradaMaisPerto(sh, maxOutro);
        if (!sp) return;
        if (achados[key] && achados[key].sp.d <= sp.d) return;
        achados[key] = { sh: sh, sp: sp, longe: true };
      });
    });
    Object.keys(achados).forEach(function (k) { best[k] = montar(achados[k].sh, achados[k].sp, achados[k].sp.d > maxD); });
    return Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) {
      var wa = a.waits.length ? a.waits[0] : 1e6, wb = b.waits.length ? b.waits[0] : 1e6;
      return wa !== wb ? wa - wb : a.dist - b.dist;
    });
  }

  // Resposta bruta da SMTR (todos os registros da janela) -> mesmo formato do gps.json: a posição mais recente de cada veículo.
  function consolidar(dados) {
    var ult = {}, max = '';
    dados.forEach(function (b) {
      if (b.latitude == null || b.longitude == null || !b.id_veiculo) return;
      var dt = String(b.datetime);
      if (!ult[b.id_veiculo] || dt > String(ult[b.id_veiculo].datetime)) ult[b.id_veiculo] = b;
      if (dt > max) max = dt;
    });
    var buses = Object.keys(ult).map(function (k) {
      var b = ult[k];
      return [String(b.servico || ''), b.id_veiculo, Math.round(b.latitude * 1e5) / 1e5, Math.round(b.longitude * 1e5) / 1e5,
        Math.round(b.velocidade || 0), b.sentido || '', b.datetime];
    });
    return { updated: max.replace('T', ' ').replace('Z', '').slice(0, 19), buses: buses };
  }

  // Resposta do BRT ({ veiculos: [...] }) -> linhas no mesmo formato do gps.json, com o 8º item 'B' (modal BRT).
  // Descarta posições antigas (muitos veículos do BRT ficam parados sem GPS) e linhas de serviço sem sentido.
  var fmtRio = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
  function consolidarBRT(json, agoraMs, maxIdadeMin) {
    var lim = (maxIdadeMin || 15) * 60000, agora = agoraMs || Date.now(), out = [];
    ((json && json.veiculos) || []).forEach(function (v) {
      var t = Number(v.dataHora);
      if (!t || agora - t > lim || t - agora > 120000) return;
      if (v.latitude == null || v.longitude == null || !v.codigo || v.linha == null) return;
      var sentido = v.sentido === 'ida' ? 'I' : (v.sentido === 'volta' ? 'V' : '');
      out.push([String(v.linha), 'BRT' + v.codigo, Math.round(v.latitude * 1e5) / 1e5, Math.round(v.longitude * 1e5) / 1e5,
        Math.round(v.velocidade || 0), sentido, fmtRio.format(new Date(t)).replace(' ', 'T') + 'Z', 'B']);
    });
    return out;
  }

  var api = { consolidarBRT: consolidarBRT, consolidar: consolidar, linhasNoPonto: linhasNoPonto, hav: hav, prep: prep, project: project, simplify: simplify, plan: plan, planBaldeacao: planBaldeacao, slice: slice, busesOnShape: busesOnShape, dirOf: dirOf, rioMs: rioMs, ageMin: ageMin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Planner = api;
})(typeof window !== 'undefined' ? window : this);
