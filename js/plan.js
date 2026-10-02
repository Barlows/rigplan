/* ============================================================================
   plan.js — interactive site plan: grid references, drag & drop, placement
   ==========================================================================*/
'use strict';

var PLAN = (function () {
  var cv, ctx, wrap, P, A;
  var view = { x: 0, y: 0, z: 26 };         // world origin (px) + px per metre
  var hit = [];                             // hit-test cache for last frame
  var drag = null, pan = null, hover = null, placeMode = 'none';
  var show = { cables: true, labels: true, vectors: false, gridref: true, imbalance: true, allText: false };
  var dpr = 1;

  function init(canvas, wrapEl, project, app) {
    cv = canvas; wrap = wrapEl; P = project; A = app;
    ctx = cv.getContext('2d');
    dpr = window.devicePixelRatio || 1;
    resize();
    window.addEventListener('resize', function () { resize(); draw(); });
    bind();
    fit();
  }
  function setProject(p) { P = p; }
  function resize() {
    var r = wrap.getBoundingClientRect();
    cv.width = Math.max(1, Math.floor(r.width * dpr));
    cv.height = Math.max(1, Math.floor(r.height * dpr));
  }
  function setPlaceMode(m) { placeMode = m; cv.classList.toggle('placing', m !== 'none'); }
  function toggleView(k, v) { show[k] = v; }
  function view(k) { return !!show[k]; }

  /* ------------------------------------------------------------- transform */
  function w2sx(x) { return view.x + x * view.z; }
  function w2sy(y) { return view.y + (P.site.h - y) * view.z; }
  function s2wx(px) { return (px - view.x) / view.z; }
  function s2wy(py) { return P.site.h - (py - view.y) / view.z; }
  function evPos(e) {
    var r = cv.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }
  function fit() {
    var r = wrap.getBoundingClientRect();
    var padL = 40, padR = 18, padT = 16, padB = 34;
    var availW = Math.max(80, r.width - padL - padR);
    var availH = Math.max(80, r.height - padT - padB);
    view.z = Math.min(availW / P.site.w, availH / P.site.h);
    view.x = padL + (availW - P.site.w * view.z) / 2;
    view.y = padT + (availH - P.site.h * view.z) / 2;
    draw();
  }
  function zoomAt(px, py, f) {
    var wx = s2wx(px), wy = s2wy(py);
    view.z = LS.clamp(view.z * f, 4, 200);
    view.x = px - wx * view.z;
    view.y = py - (P.site.h - wy) * view.z;
    draw();
  }

  /* --------------------------------------------------------------- drawing */
  function draw() {
    if (!ctx) return;
    var r = wrap.getBoundingClientRect();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    hit = [];

    drawUnderlay(r);
    drawGrid(r);
    drawSite(r);

    if (show.cables) drawCables();
    drawItems();
    if (show.vectors) drawVectors();
    if (hover || drag) drawGhost();
    drawScaleBar(r);
  }

  /* ------------------------------------------------------------- underlay */
  /* Raster image or parsed DXF, drawn behind everything, in site metres. */
  var underlayCache = null;      // offscreen canvas, rebuilt only on change

  function drawUnderlay(r) {
    var u = P.underlay;
    if (!u || u.visible === false || !u.kind) return;

    if (u.kind === 'image') {
      if (!u.img || !u.img.naturalWidth) return;
      var s = u.scale;
      var w = u.img.naturalWidth * s, h = u.img.naturalHeight * s;
      var px = w2sx(u.ox), py = w2sy(u.oy + h);
      if (px > r.width || py > r.height || px + w * view.z < 0 || py + h * view.z < 0) return;
      ctx.save();
      ctx.globalAlpha = u.opacity === undefined ? 0.9 : u.opacity;
      ctx.imageSmoothingEnabled = view.z < 3;
      try { ctx.drawImage(u.img, px, py, w * view.z, h * view.z); } catch (e) { /* not decoded yet */ }
      ctx.restore();
      return;
    }

    if (u.kind === 'dxf' && u.geo && u.geo.entities) {
      drawDxfUnderlay(u, r);
    }
  }

  function drawDxfUnderlay(u, r) {
    var s = u.scale;
    var alpha = u.opacity === undefined ? 0.85 : u.opacity;
    var off = u.layersOff || {};
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    /* one path per layer keeps the number of stroke calls low even on a
       drawing with thousands of entities */
    var byLayer = {};
    var texts = [];
    var pts = [];
    var i, e, n = u.geo.entities.length;
    var vx0 = s2wx(0), vy0 = s2wy(r.height), vx1 = s2wx(r.width), vy1 = s2wy(0);
    /* cull in site space with a small margin */
    var mL = vx0 - 40, mR = vx1 + 40, mB = vy0 - 40, mT = vy1 + 40;

    for (i = 0; i < n; i++) {
      e = u.geo.entities[i];
      if (off[e.layer]) continue;
      if (e.type === 'text') { texts.push(e); continue; }
      if (e.type === 'pt') { pts.push(e); continue; }
      var p = e.pts, k, len = p.length;
      if (len < 4) continue;
      var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      for (k = 0; k < len; k += 2) {
        var gx = u.ox + p[k] * s, gy = u.oy + p[k + 1] * s;
        if (gx < minx) minx = gx; if (gx > maxx) maxx = gx;
        if (gy < miny) miny = gy; if (gy > maxy) maxy = gy;
      }
      if (maxx < mL || minx > mR || maxy < mB || miny > mT) continue;
      (byLayer[e.layer] = byLayer[e.layer] || []).push(p);
    }

    ctx.strokeStyle = u.colour || 'rgba(150,180,205,0.85)';
    ctx.lineWidth = Math.max(0.5, Math.min(1.6, view.z * 0.012));
    for (var lay in byLayer) {
      var arr = byLayer[lay];
      ctx.beginPath();
      for (i = 0; i < arr.length; i++) {
        var pp = arr[i];
        for (k = 0; k < pp.length; k += 2) {
          var X = w2sx(u.ox + pp[k] * s);
          var Y = w2sy(u.oy + pp[k + 1] * s);
          if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
      }
      ctx.stroke();
    }

    /* point entities, e.g. survey points or column marks */
    if (pts.length) {
      ctx.fillStyle = u.colour || 'rgba(150,180,205,0.85)';
      for (i = 0; i < pts.length; i++) {
        var px2 = w2sx(u.ox + pts[i].x * s), py2 = w2sy(u.oy + pts[i].y * s);
        if (px2 < mL || px2 > mR || py2 < mB || py2 > mT) continue;
        ctx.fillRect(px2 - 1.5, py2 - 1.5, 3, 3);
      }
    }

    /* text only when it would actually be legible, or when the board in hand
       needs its room names read */
    if (texts.length && (view.z > 14 || show.allText)) {
      ctx.fillStyle = u.textColour || 'rgba(190,210,230,0.75)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (i = 0; i < texts.length; i++) {
        var t = texts[i];
        var tx2 = w2sx(u.ox + t.x * s), ty2 = w2sy(u.oy + t.y * s);
        if (tx2 < mL || tx2 > mR || ty2 < mB || ty2 > mT) continue;
        var px3 = t.h * s * view.z;                 // on-screen text height
        if (px3 < 5) continue;
        ctx.font = Math.min(14, Math.max(6, px3)) + 'px ui-sans-serif,system-ui,sans-serif';
        ctx.fillText(t.s, tx2, ty2);
      }
    }
    ctx.restore();
  }

  function drawGrid(r) {
    var step = view.z > 60 ? 0.5 : view.z > 26 ? 1 : view.z > 13 ? 2 : 5;
    var major = view.z > 26 ? 5 : 10;
    var x0 = Math.max(0, Math.floor(s2wx(0) / major) * major);
    var x1 = Math.min(P.site.w, s2wx(r.width));
    var y0 = Math.max(0, Math.floor(s2wy(r.height) / major) * major);
    var y1 = Math.min(P.site.h, s2wy(0));
    ctx.lineWidth = 1;
    for (var i = 0; i <= 160; i++) {
      var x = i * step;
      if (x > P.site.w + 0.001) break;
      var isMaj = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      ctx.strokeStyle = isMaj ? 'rgba(70,95,115,0.34)' : 'rgba(56,74,90,0.15)';
      var sx = Math.round(w2sx(x)) + 0.5;
      ctx.beginPath(); ctx.moveTo(sx, w2sy(P.site.h)); ctx.lineTo(sx, w2sy(0)); ctx.stroke();
    }
    for (var j = 0; j <= 160; j++) {
      var y = j * step;
      if (y > P.site.h + 0.001) break;
      var isMaj2 = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      ctx.strokeStyle = isMaj2 ? 'rgba(70,95,115,0.34)' : 'rgba(56,74,90,0.15)';
      var sy = Math.round(w2sy(y)) + 0.5;
      ctx.beginPath(); ctx.moveTo(w2sx(0), sy); ctx.lineTo(w2sx(P.site.w), sy); ctx.stroke();
    }
    /* axis ticks + grid reference labels */
    ctx.font = '9.5px ui-monospace,Menlo,monospace';
    ctx.fillStyle = '#5d7183';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var gx = x0; gx <= x1; gx += major) {
      ctx.fillText(gx.toFixed(0), w2sx(gx), w2sy(0) + 3);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var gy = y0; gy <= y1; gy += major) {
      ctx.fillText(gy.toFixed(0), w2sx(0) - 4, w2sy(gy));
    }
  }
  function drawSite(r) {
    ctx.strokeStyle = 'rgba(120,160,190,0.5)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.strokeRect(w2sx(0) + 0.5, w2sy(P.site.h) + 0.5, P.site.w * view.z, P.site.h * view.z);
    ctx.fillStyle = 'rgba(90,140,180,0.04)';
    ctx.fillRect(w2sx(0), w2sy(P.site.h), P.site.w * view.z, P.site.h * view.z);
  }

  function rectFor(kind, pos) {
    var s = LS.SHAPE[kind] || LS.SHAPE.pdp;
    return {
      x: w2sx(pos.x - s.w / 2), y: w2sy(pos.y + s.h / 2),
      w: s.w * view.z, h: s.h * view.z, sw: s.w, sh: s.h
    };
  }

  function statusOf(st) {
    if (st.util === null || st.util === undefined) return 'ok';
    if (st.util > 100) return 'bad';
    if (st.util > 85) return 'warn';
    return 'ok';
  }
  function utilColor(u) { return u === null ? '#4ade80' : u > 100 ? '#ef4444' : u > 85 ? '#f59e0b' : '#22c55e'; }

  function drawCables() {
    var i;
    function line(a, b, col, dash) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.moveTo(w2sx(a.x), w2sy(a.y));
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var dx = b.x - a.x, dy = b.y - a.y;
      var nx = -dy * 0.12, ny = dx * 0.12;
      ctx.quadraticCurveTo(w2sx(mx + nx), w2sy(my + ny), w2sx(b.x), w2sy(b.y));
      ctx.stroke(); ctx.setLineDash([]);
    }
    function feedColour(amp, cab) {
      if (!cab) return 'rgba(90,110,130,0.45)';
      if (amp > cab.derated) return 'rgba(239,68,68,0.72)';
      if (amp > cab.derated * 0.9) return 'rgba(245,158,11,0.7)';
      return 'rgba(80,160,200,0.6)';
    }
    P.pdps.forEach(function (d) {
      var pdb = LC.get(P, 'pdb', d.pdbId); if (!pdb || !d.pos || !pdb.pos) return;
      var st = LC.boardStats(P, d, 'pdp');
      line(pdb.pos, d.pos, feedColour(st.amp, d.cable && d.cable.csa ? LC.cableRating(d.cable) : null));
    });
    /* sub-distribution boards hang off their PDP */
    P.dbs.forEach(function (b) {
      var pdp = LC.get(P, 'pdp', b.pdpId); if (!pdp || !b.pos || !pdp.pos) return;
      var sb = LC.boardStats(P, b, 'db');
      line(pdp.pos, b.pos, feedColour(sb.amp, b.cable && b.cable.csa ? LC.cableRating(b.cable) : null));
    });
    P.panels.forEach(function (pn) {
      /* the feeder comes from the sub-board if it sits on one, else the PDP,
         else the main board it hangs off directly */
      var up = (pn.dbId && LC.get(P, 'db', pn.dbId)) || LC.get(P, 'pdp', pn.pdpId) || LC.get(P, 'pdb', pn.pdbId);
      if (!up || !pn.pos || !up.pos) return;
      var dem = LC.panelDemand(P, pn);
      var cab = pn.cable && pn.cable.csa ? LC.cableRating(pn.cable) : null;
      line(up.pos, pn.pos, feedColour(dem.amp, cab), [3, 2]);
    });
  }

  function drawItems() {
    var i, list = LC.allItems(P);
    // draw in hierarchy order so parents sit under children
    list.sort(function (a, b) { return rank(a) - rank(b); });
    for (i = 0; i < list.length; i++) drawItem(list[i]);
  }
  function rank(o) { return o.__kind === 'tx' ? 0 : o.__kind === 'pdb' ? 1 : o.__kind === 'pdp' ? 2 : o.__kind === 'db' ? 3 : 4; }

  function drawItem(o) {
    var kind = o.__kind, s = LS.SHAPE[kind], r = rectFor(kind, o.pos);
    if (r.x > wrap.clientWidth + 60 || r.y > wrap.clientHeight + 60 || r.x + r.w < -60 || r.y + r.h < -60) return;
    var st = LC.boardStats(P, o, kind);
    var stat = statusOf(st);
    var sel = A.sel() && A.sel().id === o.id;
    var hov = hover && hover.id === o.id;
    var devBad = show.imbalance && st.dev > LS.num(P.design.imbalanceWarn, 15);

    ctx.save();
    /* body */
    var g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    g.addColorStop(0, s.fill); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    roundRect(r.x, r.y, r.w, r.h, Math.min(5, r.h / 4));
    ctx.fill();
    ctx.lineWidth = sel ? 2.4 : hov ? 2 : 1.2;
    ctx.strokeStyle = sel ? '#ffffff' : (devBad ? '#ef4444' : s.color);
    ctx.stroke();
    if (sel) { ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0; }

    /* loading bar for boards */
    if (kind !== 'panel' && st.rating) {
      var pct = LS.clamp(st.util / 100, 0, 1);
      var by = r.y + r.h - 3.5;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(r.x + 1, by, r.w - 2, 2.5);
      ctx.fillStyle = utilColor(st.util);
      ctx.fillRect(r.x + 1, by, (r.w - 2) * pct, 2.5);
    }
    /* incomer frame: notches at top = ways, useful for reading spare capacity */
    var ways = kind === 'pdp' ? o.spareWays : kind === 'db' ? o.ways : 0;
    if (ways > 0 && r.w > 40) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      var n = Math.min(ways, 12);
      for (var q = 0; q < n; q++) ctx.fillRect(r.x + 3 + q * ((r.w - 6) / n), r.y + 2, 2, 2);
    }

    /* labels */
    if (show.labels && r.w > 26) {
      ctx.textAlign = 'center';
      var cy = r.y + (kind === 'panel' ? r.h / 2 + 3.5 : r.h / 2 - 1);
      if (kind === 'panel') {
        ctx.font = '600 ' + Math.max(8, Math.min(11, r.h * 0.42)) + 'px ui-monospace,Menlo,monospace';
        ctx.fillStyle = LS.SHAPE.panel.color;
        ctx.textBaseline = 'middle';
        ctx.fillText(o.tag, r.x + r.w / 2, cy, r.w - 4);
      } else {
        ctx.font = '600 ' + Math.max(9, Math.min(12, r.h * 0.24)) + 'px ui-monospace,Menlo,monospace';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = s.color;
        ctx.fillText(o.tag, r.x + r.w / 2, r.y + r.h * 0.40, r.w - 3);
        ctx.font = Math.max(8, Math.min(10.5, r.h * 0.2)) + 'px ui-monospace,Menlo,monospace';
        ctx.fillStyle = 'rgba(210,225,238,0.82)';
        var l2 = kind === 'tx'
          ? LS.num(o.kva, 0) + ' kVA'
          : st.rating + ' A · ' + (st.util === null ? '—' : st.util.toFixed(0) + '%');
        ctx.fillText(l2, r.x + r.w / 2, r.y + r.h * 0.70, r.w - 3);
      }
    }
    /* grid reference bubble — only when there is room for it, so the plan
       stays readable at site-overview zoom. Hovering or selecting an item
       always shows its reference. */
    var wantRef = show.gridref && (sel || hov || view.z >= 42);
    if (wantRef) {
      var gt = 'E' + LS.r1(o.pos.x).toFixed(1) + ' N' + LS.r1(o.pos.y).toFixed(1);
      ctx.font = '9.5px ui-monospace,Menlo,monospace';
      var tw = ctx.measureText(gt).width + 8;
      var gx = r.x + r.w / 2 - tw / 2, gy = r.y + r.h + 2;
      ctx.fillStyle = sel || hov ? 'rgba(10,26,38,0.95)' : 'rgba(8,12,17,0.75)';
      roundRect(gx, gy, tw, 12, 3); ctx.fill();
      ctx.strokeStyle = sel || hov ? 'rgba(56,189,248,0.8)' : 'rgba(120,160,190,0.28)';
      ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = sel || hov ? '#bae6fd' : '#7f9db4';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(gt, r.x + r.w / 2, gy + 6.5);
    }
    /* status flag */
    if (stat !== 'ok' || devBad) {
      ctx.fillStyle = stat === 'bad' ? '#ef4444' : '#f59e0b';
      ctx.beginPath(); ctx.arc(r.x + r.w - 5, r.y + 5, 3.4, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
    hit.push({ id: o.id, kind: kind, x: r.x, y: r.y, w: r.w, h: r.h });
  }

  function drawVectors() {
    var sel = A.sel();
    LC.allItems(P).forEach(function (o) {
      if (o.__kind === 'panel') return;
      var st = LC.boardStats(P, o, o.__kind);
      var mx = Math.max(st.phaseKva.L1, st.phaseKva.L2, st.phaseKva.L3) || 1;
      var base = { L1: [-1, 0], L2: [-0.5, -0.866], L3: [0.5, -0.866] };
      var scale = 2.6 / mx;                     // max arm ~2.6 m
      var focus = !!(sel && sel.id === o.id) || !!(hover && hover.id === o.id);
      ['L1', 'L2', 'L3'].forEach(function (ph) {
        var kva = st.phaseKva[ph];
        if (kva <= 0) return;
        var d = base[ph], len = kva * scale;
        var ex = o.pos.x + d[0] * len, ey = o.pos.y + d[1] * len;
        var x0 = w2sx(o.pos.x), y0 = w2sy(o.pos.y);
        var x1 = w2sx(ex), y1 = w2sy(ey);
        var ang = Math.atan2(y1 - y0, x1 - x0);
        /* L2 is near-black, so every vector is drawn twice: a light edge
           underneath, the phase colour on top. That keeps the dark phase
           legible on the dark plan without changing its identity colour. */
        ctx.strokeStyle = LS.phaseEdge(ph);
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        arrowHead(x1, y1, ang, LS.phaseEdge(ph));
        ctx.strokeStyle = LS.phaseColor(ph);
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        arrowHead(x1, y1, ang, LS.phaseColor(ph));
      });
      var tot = st.phaseKva.L1 + st.phaseKva.L2 + st.phaseKva.L3;
      /* Numeric labels only for the board in hand — drawing them for every
         board at once turns the plan into an unreadable pile. */
      if (tot > 0 && focus) {
        ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        var lines = ['L1 ' + st.phaseKva.L1.toFixed(1) + ' kVA', 'L2 ' + st.phaseKva.L2.toFixed(1) + ' kVA', 'L3 ' + st.phaseKva.L3.toFixed(1) + ' kVA'];
        var lx = w2sx(o.pos.x) + 7, ly = w2sy(o.pos.y) - 20;
        var bw = 0;
        lines.forEach(function (t) { bw = Math.max(bw, ctx.measureText(t).width); });
        ctx.fillStyle = 'rgba(8,12,17,0.88)';
        roundRect(lx - 4, ly - 9, bw + 8, 36, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(120,160,190,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        lines.forEach(function (t, k) {
          ctx.fillStyle = LS.phaseEdge(['L1', 'L2', 'L3'][k]);
          ctx.fillText(t, lx, ly + k * 11);
        });
      }
    });
  }
  function arrowHead(x, y, a, color) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(a - 0.4) * 7, y - Math.sin(a - 0.4) * 7);
    ctx.lineTo(x - Math.cos(a + 0.4) * 7, y - Math.sin(a + 0.4) * 7);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }

  /* preview of where a dropped / new item would land */
  function drawGhost() {
    var target = drag && drag.moved ? drag : hover;
    if (!target || !target.item) return;
    var it = target.item;
    var kind = it.__kind || LC.kindOf(it);
    var s = LS.SHAPE[kind];
    var pos = (drag && drag.moved) ? drag.preview || drag.item.pos : it.pos;
    var r = rectFor(kind, pos);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = (drag && drag.preview && drag.preview.bumped) ? '#f59e0b' : '#38bdf8';
    ctx.lineWidth = 1.8;
    roundRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 6); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(56,189,248,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w2sx(pos.x) - (s.w / 2 + 1.5) * view.z, w2sy(pos.y));
    ctx.lineTo(w2sx(pos.x) + (s.w / 2 + 1.5) * view.z, w2sy(pos.y));
    ctx.moveTo(w2sx(pos.x), w2sy(pos.y) - (s.h / 2 + 1.5) * view.z);
    ctx.lineTo(w2sx(pos.x), w2sy(pos.y) + (s.h / 2 + 1.5) * view.z);
    ctx.stroke();
    ctx.restore();
  }

  function drawScaleBar(r) {
    var targetPx = 100, metres = Math.pow(10, Math.round(Math.log10(targetPx / view.z)));
    var px = metres * view.z;
    var x0 = r.width - 18 - px, y0 = r.height - 30;
    ctx.save();
    ctx.strokeStyle = 'rgba(180,200,220,0.8)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 4);
    ctx.stroke();
    ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.fillStyle = 'rgba(180,200,220,0.9)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(metres + ' m', x0 + px, y0 - 5);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ------------------------------------------------------------- interaction */
  function pick(px, py) {
    for (var i = hit.length - 1; i >= 0; i--) {
      var h = hit[i];
      if (px >= h.x - 2 && px <= h.x + h.w + 2 && py >= h.y - 2 && py <= h.y + h.h + 6) return h;
    }
    return null;
  }
  function itemById(id) { return LC.get(P, 'tx', id) || LC.get(P, 'pdb', id) || LC.get(P, 'pdp', id) || LC.get(P, 'db', id) || LC.get(P, 'panel', id); }

  function bind() {
    cv.addEventListener('mousedown', function (e) {
      var m = evPos(e);
      if (e.button === 1 || e.shiftKey || placeMode === 'none' && e.button === 0 && !pick(m.px, m.py)) {
        pan = { px: m.px, py: m.py, x: view.x, y: view.y };
        cv.classList.add('panning');
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      if (placeMode !== 'none') { A.place(placeMode, s2wx(m.px), s2wy(m.py)); return; }
      var h = pick(m.px, m.py);
      if (!h) { A.select(null); return; }
      var it = itemById(h.id); if (!it) return;
      A.select(h.id, h.kind);
      drag = { item: it, off: { x: s2wx(m.px) - it.pos.x, y: s2wy(m.py) - it.pos.y }, moved: false, orig: { x: it.pos.x, y: it.pos.y } };
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      var m = evPos(e);
      if (pan) { view.x = pan.x + (m.px - pan.px); view.y = pan.y + (m.py - pan.py); draw(); return; }
      var wx = s2wx(m.px), wy = s2wy(m.py);
      A.readout(wx, wy, hover ? hover.tag : null);
      if (drag) {
        var nx = wx - drag.off.x, ny = wy - drag.off.y;
        if (!drag.moved && (Math.abs(nx - drag.orig.x) > 0.02 || Math.abs(ny - drag.orig.y) > 0.02)) drag.moved = true;
        if (drag.moved) {
          drag.preview = LC.resolveDrop(P, drag.item, nx, ny, { snap: A.snap(), offset: A.offset(), clear: A.clearance() });
          drag.item.pos = drag.preview.pos;
        }
        draw();
      } else {
        var h = pick(m.px, m.py);
        var nh = h ? itemById(h.id) : null;
        var changed = (nh && hover && nh.id === hover.id) || (!nh && !hover);
        hover = nh;
        if (!changed) { draw(); return; }
        draw();
        cv.style.cursor = h ? 'move' : (placeMode !== 'none' ? 'crosshair' : 'default');
      }
    });
    window.addEventListener('mouseup', function () {
      if (pan) { pan = null; cv.classList.remove('panning'); }
      if (drag) {
        var d = drag; drag = null;
        if (d.moved) A.moved(d.item, d.orig, d.preview);
        draw();
      }
    });
    cv.addEventListener('mouseleave', function () {
      /* the readout tracks the pointer, so clear it once it leaves the plan
         rather than showing coordinates from off the canvas */
      hover = null;
      if (!drag) A.readout(null);
      draw();
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var m = evPos(e);
      zoomAt(m.px, m.py, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    cv.addEventListener('dblclick', function (e) {
      var m = evPos(e), h = pick(m.px, m.py);
      if (h) A.quickEdit(h.id, h.kind);
    });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  return {
    init, setProject, draw, fit, setPlaceMode, toggleView, view,
    w2sx: w2sx, s2wx: s2wx, zoomAt, itemById,
    /* redraw for a size change without resetting the user's zoom/pan */
    relayout: function () { resize(); draw(); },
    hasUnderlay: function () { return !!(P.underlay && P.underlay.kind); }
  };
})();
