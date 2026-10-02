/* ============================================================================
   dxf.js — DXF reader for site-plan underlays

   Reads the ASCII DXF format (group code / value pairs) and flattens the
   geometry that matters for a background drawing into plain polylines and
   text runs, so the plan can draw them cheaply and hit-test nothing.

   Supports: LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC, POINT, SOLID,
   3DFACE, TEXT, MTEXT, ELLIPSE, SPLINE (control points), and INSERT with
   block expansion. Entity types not listed are counted and skipped.

   Bulge arcs on LWPOLYLINE are tessellated rather than ignored, because site
   boundaries and kerb lines use them heavily.
   ==========================================================================*/
'use strict';

var DXF = (function () {

  /* DXF $INSUNITS -> metres per drawing unit (values from the DXF spec) */
  var INSUNITS = {
    0: null,       // unitless: caller must set a scale
    1: 0.0254,     // 1  inches
    2: 0.3048,     // 2  feet
    3: 1609.344,   // 3  miles
    4: 0.001,      // 4  millimetres
    5: 0.01,       // 5  centimetres
    6: 1,          // 6  metres
    7: 1000,       // 7  kilometres
    8: 2.54e-8,    // 8  microinches
    9: 0.0000254,  // 9  mils
    10: 0.9144,    // 10 yards
    11: 1e-10,     // 11 angstroms
    12: 1e-9,      // 12 nanometres
    13: 1e-6,      // 13 microns
    14: 0.1,       // 14 decimetres
    15: 10,        // 15 decametres
    16: 100,       // 16 hectometres
    17: 1e9,       // 17 gigametres
    18: 1.495978707e11, // 18 astronomical units
    19: 9.4607e15, // 19 light years
    20: 3.0857e16  // 20 parsecs
  };
  var UNIT_NAME = {
    0: 'unitless', 1: 'inches', 2: 'feet', 3: 'miles', 4: 'millimetres',
    5: 'centimetres', 6: 'metres', 7: 'kilometres', 8: 'microinches',
    9: 'mils', 10: 'yards', 11: 'angstroms', 12: 'nanometres', 13: 'microns',
    14: 'decimetres', 15: 'decametres', 16: 'hectometres', 17: 'gigametres'
  };

  /* Layers that are almost never part of the site plan itself. Off by default
     so a drawing does not arrive buried in dimension lines and hatches. */
  var NOISY_LAYERS = /(dim|dimension|defpoint|hatch|frame|title|block|view|section|detail|note|legend|paper|north|arrow|text_style|acad_)/i;

  /* -------------------------------------------------------------- tokenise */
  function tokenize(text) {
    /* DXF is strictly pairs of lines: group code, then value. Tolerate
       CRLF, a BOM, and stray blank lines. */
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var lines = text.split(/\r\n|\r|\n/);
    var toks = [];
    for (var i = 0; i + 1 < lines.length; i += 2) {
      var code = parseInt(lines[i].trim(), 10);
      if (isNaN(code)) continue;                    // out of step: resync
      toks.push({ c: code, v: lines[i + 1] });
    }
    return toks;
  }

  function first(tags, code, dflt) {
    var a = tags[code];
    if (!a || a.length === 0) return dflt;
    var n = parseFloat(a[0]);
    return isFinite(n) ? n : dflt;
  }
  /* group-code values arrive as strings; coerce a whole list to numbers and
     drop anything non-numeric so downstream maths can trust the array */
  function nums(list) {
    var out = [];
    if (!list) return out;
    for (var i = 0; i < list.length; i++) {
      var n = parseFloat(list[i]);
      out.push(isFinite(n) ? n : NaN);
    }
    return out;
  }

  /* ------------------------------------------------------------ arc helpers */
  /* Tessellate an arc into [x,y,...] appended to `out`.
     Segment count is derived from the sagitta: with a maximum deviation of
     `frac` of the radius, the step is 2*acos(1-frac), capped so a full
     circle stays cheap. */
  function arcPoints(cx, cy, r, a0, a1, out, maxSeg) {
    var sweep = a1 - a0;
    while (sweep <= -Math.PI * 2) sweep += Math.PI * 2;
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
    if (Math.abs(sweep) < 1e-9) return;
    maxSeg = maxSeg || 48;
    if (!isFinite(r) || r <= 0) return;
    var frac = 0.01;                                  // 1% of r max deviation
    var step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - frac)));
    if (!isFinite(step) || step <= 0) step = Math.PI / 8;
    var n = Math.max(2, Math.min(maxSeg, Math.ceil(Math.abs(sweep) / step)));
    for (var i = 0; i <= n; i++) {
      var a = a0 + sweep * (i / n);
      out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
  }
  /* LWPOLYLINE bulge: arc from p1 to p2 with included angle 4*atan(bulge).
     The centre lies on the normal to the chord, offset by h, on the side
     given by the sign of the bulge (positive bulges counter-clockwise). */
  function bulgePoints(x1, y1, x2, y2, bulge, out) {
    if (!isFinite(bulge) || Math.abs(bulge) < 1e-10) { out.push(x2, y2); return; }
    var theta = 4 * Math.atan(bulge);
    var chord = Math.hypot(x2 - x1, y2 - y1);
    if (chord < 1e-12) { out.push(x2, y2); return; }
    var r = chord / (2 * Math.sin(theta / 2));
    if (!isFinite(r) || r <= 0) { out.push(x2, y2); return; }
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    var h = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
    var ux = (x2 - x1) / chord, uy = (y2 - y1) / chord;
    /* left normal to the chord direction, scaled by the bulge sign */
    var sgn = bulge > 0 ? 1 : -1;
    var cx = mx + sgn * h * -uy, cy = my + sgn * h * ux;
    var a0 = Math.atan2(y1 - cy, x1 - cx);
    var start = out.length;
    arcPoints(cx, cy, r, a0, a0 + theta, out, 64);
    /* arcPoints repeats its start point; the caller has already emitted p1,
       so drop the duplicate to avoid zero-length segments */
    if (out.length >= start + 4) {
      var dx = out[start] - x1, dy = out[start + 1] - y1;
      if (dx * dx + dy * dy < 1e-12) { out.splice(start, 2); }
    }
  }
  /* strip AutoCAD MTEXT formatting codes so room names read cleanly */
  function cleanMText(s) {
    return String(s)
      .replace(/\\[A-Za-z][^;\\]*;/g, '')      // \fArial|b0; etc
      .replace(/\\P/g, ' ')
      .replace(/[{}]/g, '')
      .replace(/\\\\/g, '\\')
      .replace(/%%[dD]/g, '°')
      .replace(/%%[pP]/g, '±')
      .replace(/%%[cC]/g, 'Ø')
      .replace(/%%(\d{3})/g, function (m, o) { return String.fromCharCode(parseInt(o, 10)); })
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------------ parse */
  function parse(text, opts) {
    opts = opts || {};
    var maxPts = opts.maxPoints || 400000;
    var toks = tokenize(text);

    var out = {
      version: null, insunits: 0, unitName: 'unitless', metresPerUnit: null,
      extents: null, layers: [], layersOff: {}, entities: [],
      stats: { total: 0, drawn: 0, skipped: {}, blocks: 0, points: 0, truncated: false },
      warnings: []
    };
    var layerSeen = {};
    var blocks = {};
    var ptCount = 0;

    var i = 0;
    var ent = null;            // current entity being read
    var section = null;
    var curBlock = null;
    var polyCtx = null;        // POLYLINE whose VERTEX entities we are reading
    var headerVar = null;
    var extMin = null, extMax = null, limMin = null, limMax = null;
    var inTable = null;

    function addLayer(name) {
      name = (name === undefined || name === null || name === '') ? '0' : String(name);
      if (layerSeen[name]) return;
      layerSeen[name] = true;
      out.layers.push(name);
    }
    function pushEntity(e) {
      if (ptCount > maxPts) { out.stats.truncated = true; return false; }
      if (curBlock) curBlock.ents.push(e);
      else out.entities.push(e);
      return true;
    }
    function pts(n) { ptCount += n; return n; }
    function bumpLayer(e) {
      var L = e.layer || '0';
      addLayer(L);
      return L;
    }
    function note(key) { out.stats.skipped[key] = (out.stats.skipped[key] || 0) + 1; }

    /* --- flush the current entity into geometry --- */
    function flush() {
      if (!ent) return;
      var t = ent.tags;
      var L = t[8] ? String(t[8][0]) : (t.layer || '0');

      function poly(points, closed) {
        if (points.length < 4) return;
        pts(points.length / 2);
        if (!pushEntity({ type: 'poly', layer: L, pts: points, closed: !!closed })) return;
        out.stats.drawn++;
      }

      switch (ent.type) {
        case 'LINE': {
          var x1 = first(t, 10), y1 = first(t, 20), x2 = first(t, 11), y2 = first(t, 21);
          if (isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2)) poly([x1, y1, x2, y2], false);
          break;
        }
        case 'LWPOLYLINE': {
          /* tag values are stored as raw strings: coerce to numbers here,
             otherwise string arithmetic silently corrupts the geometry */
          var xs = nums(t[10]), ys = nums(t[20]), bs = nums(t[42]);
          var closed = (first(t, 70, 0) & 1) === 1;
          var n = Math.min(xs.length, ys.length);
          if (n < 2) break;
          var p = [xs[0], ys[0]];
          for (var k = 1; k < n; k++) {
            var b = bs[k - 1];
            if (isFinite(b) && Math.abs(b) > 1e-10) bulgePoints(xs[k - 1], ys[k - 1], xs[k], ys[k], b, p);
            else p.push(xs[k], ys[k]);
          }
          if (closed && n > 2) {
            var cb = bs[n - 1];
            if (isFinite(cb) && Math.abs(cb) > 1e-10) bulgePoints(xs[n - 1], ys[n - 1], xs[0], ys[0], cb, p);
            p.push(xs[0], ys[0]);
          }
          poly(p, closed);
          break;
        }
        case 'CIRCLE': {
          var cx = first(t, 10), cy = first(t, 20), r = first(t, 40);
          if (r > 0) {
            var p2 = [];
            arcPoints(cx, cy, r, 0, Math.PI * 2 - 1e-9, p2, 72);
            poly(p2, true);
          }
          break;
        }
        case 'ARC': {
          var ax = first(t, 10), ay = first(t, 20), ar = first(t, 40);
          var a0 = first(t, 50, 0) * Math.PI / 180, a1 = first(t, 51, 0) * Math.PI / 180;
          if (ar > 0) { var p3 = []; arcPoints(ax, ay, ar, a0, a1, p3, 64); poly(p3, false); }
          break;
        }
        case 'POLYLINE': {
          /* the old-style POLYLINE carries only flags; its VERTEX entities
             were already captured into `verts` and are stitched below */
          if (ent.verts && ent.verts.length >= 4) {
            var cp = ent.verts.slice();
            if ((first(t, 70, 0) & 1) === 1) cp.push(cp[0], cp[1]);
            poly(cp, (first(t, 70, 0) & 1) === 1);
          } else note('POLYLINE (no vertices)');
          break;
        }
        case 'VERTEX': {
          /* vertices of the POLYLINE currently being assembled */
          if (ent.verts) {
            var vx = first(t, 10), vy = first(t, 20);
            if (isFinite(vx) && isFinite(vy)) ent.verts.push(vx, vy);
          }
          break;
        }
        case 'POINT': {
          var px = first(t, 10), py = first(t, 20);
          if (isFinite(px) && isFinite(py)) {
            pts(1);
            if (pushEntity({ type: 'pt', layer: L, x: px, y: py })) out.stats.drawn++;
          }
          break;
        }
        case 'SOLID': case '3DFACE': {
          var fx = [first(t, 10, NaN), first(t, 11, NaN), first(t, 12, NaN), first(t, 13, NaN)];
          var fy = [first(t, 20, NaN), first(t, 21, NaN), first(t, 22, NaN), first(t, 23, NaN)];
          var q = [];
          [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(function (e2) {
            if (isFinite(fx[e2[0]]) && isFinite(fy[e2[0]]) && isFinite(fx[e2[1]]) && isFinite(fy[e2[1]])) q.push(fx[e2[0]], fy[e2[0]]);
          });
          poly(q, true);
          break;
        }
        case 'ELLIPSE': {
          var ecx = first(t, 10), ecy = first(t, 20);
          var mx = (t[11] && t[21]) ? parseFloat(t[11][0]) : 0, my = (t[11] && t[21]) ? parseFloat(t[21][0]) : 0;
          var maj = Math.hypot(mx, my), rot = Math.atan2(my, mx);
          var ratio = first(t, 40, 1);
          if (maj > 0) {
            var pe = [];
            for (var a2 = 0; a2 < 72; a2++) {
              var th = a2 / 72 * Math.PI * 2;
              var px2 = maj * Math.cos(th), py2 = maj * ratio * Math.sin(th);
              pe.push(ecx + px2 * Math.cos(rot) - py2 * Math.sin(rot),
                      ecy + px2 * Math.sin(rot) + py2 * Math.cos(rot));
            }
            poly(pe, true);
          }
          break;
        }
        case 'TEXT': case 'MTEXT': {
          var s = ent.type === 'TEXT' ? (t[1] ? t[1][0] : '') : (t[3] ? t[3].join('') : (t[1] ? t[1][0] : ''));
          s = cleanMText(s);
          if (s) {
            var tx = first(t, 10), ty = first(t, 20), th = first(t, 40, 0) || 2.5;
            var rot2 = first(t, 50, 0);
            if (isFinite(tx) && isFinite(ty)) {
              pts(1);
              if (pushEntity({ type: 'text', layer: L, x: tx, y: ty, h: th, rot: rot2, s: s })) out.stats.drawn++;
            }
          }
          break;
        }
        case 'SPLINE': {
          var cxs = nums(t[10]), cys = nums(t[20]);
          var ns = Math.min(cxs.length, cys.length);
          if (ns >= 2) {
            var ps = [];
            for (var q2 = 0; q2 < ns; q2++) {
              if (isFinite(cxs[q2]) && isFinite(cys[q2])) ps.push(cxs[q2], cys[q2]);
            }
            poly(ps, (first(t, 70, 0) & 1) === 1);
          }
          break;
        }
        case 'INSERT': {
          var bname = t[2] ? String(t[2][0]) : '';
          var blk = blocks[bname];
          if (blk) {
            var ix = first(t, 10), iy = first(t, 20);
            var sx = (t[41] ? parseFloat(t[41][0]) : 1) || 1;
            var sy = (t[42] ? parseFloat(t[42][0]) : 1) || 1;
            var sr = (t[50] ? parseFloat(t[50][0]) : 0) * Math.PI / 180;
            var cosR = Math.cos(sr), sinR = Math.sin(sr);
            var bx = blk.base.x, by = blk.base.y;
            var expand = function (src, depth) {
              if (depth > 3) return;
              for (var z = 0; z < src.length; z++) {
                var e3 = src[z];
                if (e3.type === 'poly') {
                  var np = [];
                  for (var v = 0; v < e3.pts.length; v += 2) {
                    var lx = (e3.pts[v] - bx) * sx, ly = (e3.pts[v + 1] - by) * sy;
                    np.push(ix + lx * cosR - ly * sinR, iy + lx * sinR + ly * cosR);
                  }
                  var ne = { type: 'poly', layer: e3.layer, pts: np, closed: e3.closed };
                  pts(np.length / 2);
                  if (!pushEntity(ne)) return;
                  out.stats.drawn++;
                } else if (e3.type === 'pt') {
                  var lx2 = (e3.x - bx) * sx, ly2 = (e3.y - by) * sy;
                  pts(1);
                  if (pushEntity({ type: 'pt', layer: e3.layer, x: ix + lx2 * cosR - ly2 * sinR, y: iy + lx2 * sinR + ly2 * cosR })) out.stats.drawn++;
                } else if (e3.type === 'text') {
                  var lx3 = (e3.x - bx) * sx, ly3 = (e3.y - by) * sy;
                  pts(1);
                  if (pushEntity({ type: 'text', layer: e3.layer, h: e3.h * Math.abs(sy),
                    x: ix + lx3 * cosR - ly3 * sinR, y: iy + lx3 * sinR + ly3 * cosR, rot: e3.rot + sr, s: e3.s })) out.stats.drawn++;
                } else if (e3.type === 'insert' && e3.block) {
                  /* nested insert: place then re-expand, bounded by depth */
                  var sub = blocks[e3.block];
                  if (sub) {
                    var tx2 = ix + ((e3.x - bx) * sx * cosR - (e3.y - by) * sy * sinR);
                    var ty2 = iy + ((e3.x - bx) * sx * sinR + (e3.y - by) * sy * cosR);
                    var tmp = { ents: [] };
                    var swapBlock = curBlock;
                    curBlock = tmp;
                    expand([{ type: 'insert', block: e3.block }], depth + 1);
                    curBlock = swapBlock;
                    tmp.ents.forEach(function (en) {
                      en.x += tx2; en.y += ty2;
                      if (pushEntity(en)) out.stats.drawn++;
                    });
                  }
                }
              }
            };
            expand(blk.ents, 0);
          } else {
            note('INSERT (missing block ' + bname + ')');
          }
          break;
        }
        default:
          if (ent.type) note(ent.type);
      }
    }

    /* --- main scan --- */
    for (i = 0; i < toks.length; i++) {
      var code = toks[i].c, val = toks[i].v;
      out.stats.total++;

      if (code === 0) {
        var type = String(val).trim();

        if (type === 'SECTION') {
          // next token is the section name (code 2)
          var nm = (toks[i + 1] && toks[i + 1].c === 2) ? String(toks[i + 1].v).trim() : '';
          section = nm; i++;
          if (nm === 'BLOCKS') { curBlock = { name: null, base: { x: 0, y: 0 }, ents: [] }; out.stats.blocks++; }
          continue;
        }
        if (type === 'ENDSEC') {
          if (section === 'BLOCKS' && curBlock && curBlock.name) blocks[curBlock.name] = curBlock;
          curBlock = null; section = null; inTable = null; headerVar = null;
          continue;
        }
        if (type === 'EOF') break;

        if (section === 'TABLES') {
          if (type === 'TABLE') { inTable = (toks[i + 1] && toks[i + 1].c === 2) ? String(toks[i + 1].v).trim() : ''; i++; }
          flush(); ent = null;
          if (inTable === 'LAYER') { ent = { type: '_LAYER', tags: {} }; }
          continue;
        }
        if (section === 'BLOCKS' && type === 'BLOCK') {
          flush(); ent = { type: 'BLOCKHDR', tags: {} };
          continue;
        }
        if (section === 'BLOCKS' && type === 'ENDBLK') {
          flush();
          if (curBlock && curBlock.name) blocks[curBlock.name] = curBlock;
          curBlock = null; ent = null;
          continue;
        }
        if (section === 'BLOCKS' && type === 'BLOCK') { /* handled above */ }

        /* an entity in ENTITIES, or a VERTEX belonging to a POLYLINE */
        if (type === 'VERTEX' && polyCtx) {
          /* a VERTEX is not an entity of its own: it appends to the
             POLYLINE currently being assembled, so do not flush yet */
          ent = { type: 'VERTEX', tags: {}, verts: polyCtx.verts };
          continue;
        }
        if (type === 'SEQEND') {
          /* end of the vertex run: emit the POLYLINE, which is the entity
             that owns the vertices — `ent` is only the last VERTEX */
          ent = polyCtx;
          flush();
          polyCtx = null;
          ent = null;
          continue;
        }
        flush();
        if (section === 'BLOCKS' && !curBlock) curBlock = { name: null, base: { x: 0, y: 0 }, ents: [] };
        ent = { type: type, tags: {} };
        if (type === 'POLYLINE') { ent.verts = []; polyCtx = ent; }
        else { polyCtx = null; }
        continue;
      }

      if (section === 'HEADER') {
        if (code === 9) { headerVar = String(val).trim(); continue; }
        if (headerVar === '$ACADVER' && code === 1) out.version = String(val).trim();
        else if (headerVar === '$INSUNITS' && code === 70) out.insunits = parseInt(val, 10) || 0;
        else if (headerVar === '$MEASUREMENT' && code === 70) { /* 1 = metric */ }
        else if (headerVar === '$EXTMIN') { if (code === 10) extMin = extMin || {}; if (extMin && code === 10) extMin.x = parseFloat(val); if (extMin && code === 20) extMin.y = parseFloat(val); }
        else if (headerVar === '$EXTMAX') { if (code === 10) extMax = extMax || {}; if (extMax && code === 10) extMax.x = parseFloat(val); if (extMax && code === 20) extMax.y = parseFloat(val); }
        else if (headerVar === '$LIMMIN') { if (code === 10) limMin = limMin || {}; if (limMin && code === 10) limMin.x = parseFloat(val); if (limMin && code === 20) limMin.y = parseFloat(val); }
        else if (headerVar === '$LIMMAX') { if (code === 10) limMax = limMax || {}; if (limMax && code === 10) limMax.x = parseFloat(val); if (limMax && code === 20) limMax.y = parseFloat(val); }
        continue;
      }

      if (!ent) continue;

      if (ent.type === 'BLOCKHDR') {
        if (code === 2 && curBlock) curBlock.name = String(val).trim();
        else if (code === 10 && curBlock) curBlock.base.x = parseFloat(val);
        else if (code === 20 && curBlock) curBlock.base.y = parseFloat(val);
        continue;
      }
      if (ent.type === '_LAYER') {
        if (code === 2) addLayer(String(val).trim());
        continue;
      }
      if (ent.type === 'VERTEX' && ent.verts) {
        /* append straight into the owning polyline's vertex list, pairing
           the 10/20 codes as they arrive */
        if (code === 10) ent._vx = parseFloat(val);
        else if (code === 20) {
          var vy = parseFloat(val);
          if (isFinite(ent._vx) && isFinite(vy)) ent.verts.push(ent._vx, vy);
        }
        continue;
      }

      /* store the code; keep repeats (polyline vertices, OCS flags) */
      if (code >= 290 && code <= 299) continue;         // viewport / handle noise
      var tg = ent.tags;
      if (tg[code] === undefined) tg[code] = [val];
      else tg[code].push(val);
    }
    flush();

    /* --- resolve scale, extents, layer defaults --- */
    out.unitName = UNIT_NAME[out.insunits] || 'unitless';
    out.metresPerUnit = (out.insunits && INSUNITS[out.insunits]) || null;

    var bb = null;
    function grow(x, y) {
      if (!isFinite(x) || !isFinite(y)) return;
      if (!bb) bb = { minX: x, minY: y, maxX: x, maxY: y };
      else {
        if (x < bb.minX) bb.minX = x;
        if (x > bb.maxX) bb.maxX = x;
        if (y < bb.minY) bb.minY = y;
        if (y > bb.maxY) bb.maxY = y;
      }
    }
    for (i = 0; i < out.entities.length; i++) {
      var e = out.entities[i];
      if (e.type === 'poly') {
        for (var k2 = 0; k2 + 1 < e.pts.length; k2 += 2) grow(e.pts[k2], e.pts[k2 + 1]);
      } else {
        grow(e.x, e.y);
      }
    }
    if (!bb && extMin && extMax) bb = { minX: extMin.x, minY: extMin.y, maxX: extMax.x, maxY: extMax.y };
    if (!bb && limMin && limMax) bb = { minX: limMin.x, minY: limMin.y, maxX: limMax.x, maxY: limMax.y };
    if (!bb) bb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    /* floating-point noise can put an extent a hair outside zero, which
       shows up as a nonsense origin later; snap it */
    if (Math.abs(bb.minX) < 1e-6) bb.minX = 0;
    if (Math.abs(bb.minY) < 1e-6) bb.minY = 0;
    out.extents = bb;
    /* the extents are also spread onto the top level so the underlay code can
       treat a DXF and a raster image identically */
    out.minX = bb.minX; out.minY = bb.minY;
    out.maxX = bb.maxX; out.maxY = bb.maxY;
    out.width = bb.maxX - bb.minX;
    out.height = bb.maxY - bb.minY;

    out.layers.forEach(function (n) {
      /* noisy layers start hidden so the plan reads immediately */
      out.layersOff[n] = NOISY_LAYERS.test(n);
    });
    out.layers = out.layers.sort();

    if (out.stats.truncated) out.warnings.push('Drawing exceeded ' + maxPts.toLocaleString() + ' points and was truncated.');
    if (!out.metresPerUnit) {
      out.warnings.push('Drawing has no unit scale ($INSUNITS). Set the scale manually — for millimetre drawings enter 0.001 m per unit.');
    }
    if (!out.entities.length) out.warnings.push('No drawable geometry found. Only text, dimensions or unsupported entity types may be present.');
    return out;
  }

  return { parse: parse, INSUNITS: INSUNITS, UNIT_NAME: UNIT_NAME, NOISY_LAYERS: NOISY_LAYERS };
})();
