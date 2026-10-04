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
    var maxWalk = opt.maxWalk || 800, vMpm = (opt.vKmh || 15) * 1000 / 60, walkMpm = opt.walkMpm || 80;
    var minRide = opt.minRide || 400, maxWait = opt.maxWait || 60;
    var live = {};
    buses.forEach(function (b) { (live[b.s] = live[b.s] || []).push(b); });
    var best = {};
    if (!data.bySvc) {
      data.bySvc = {};
      Object.keys(data.shapes).forEach(function (id) { var s = data.shapes[id]; (data.bySvc[s.r] = data.bySvc[s.r] || []).push(s); });
    }

    Object.keys(data.shapes).forEach(function (sid) {
      var sh = data.shapes[sid], lv = live[sh.r];
      if (!lv) return;
      prep(sh);
      var sa = null;
      sh.s.forEach(function (st) {
        var s = data.stops[st[0]], d = hav(A.lat, A.lng, s[1], s[2]);
        if (d <= maxWalk && (!sa || d < sa.d)) sa = { d: d, i: st[0], along: st[1] };
      });
      if (!sa) return;
      var sb = null;
      sh.s.forEach(function (st) {
        if (st[1] < sa.along + minRide) return;
        var s = data.stops[st[0]], d = hav(B.lat, B.lng, s[1], s[2]);
        if (d <= maxWalk && (!sb || d < sb.d)) sb = { d: d, i: st[0], along: st[1] };
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
        svc: sh.r, sid: sid, dir: sh.d, head: sh.h,
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

  // Pontos do traçado entre duas posições (m) para desenhar no mapa.
  function slice(sh, from, to) {
    prep(sh);
    var out = [];
    for (var i = 0; i < sh.n; i++) if (sh.cum[i] >= from && sh.cum[i] <= to) out.push([sh.p[2 * i], sh.p[2 * i + 1]]);
    return out;
  }

  var api = { hav: hav, prep: prep, project: project, simplify: simplify, plan: plan, slice: slice, busesOnShape: busesOnShape, dirOf: dirOf, rioMs: rioMs, ageMin: ageMin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Planner = api;
})(typeof window !== 'undefined' ? window : this);
