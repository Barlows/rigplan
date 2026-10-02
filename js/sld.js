/* ============================================================================
   sld.js — single line diagram

   Draws the whole supply as a schematic: incoming supply → transformer → main
   LV board → distribution board → sub-distribution board → control panels,
   with the protective device, incomer rating and feeder size on every branch.

   The layout is a top-down tree, so each board sits directly above what it
   feeds and the branches fan out from a common busbar — the convention on a
   real single line diagram. Where a board has many outgoing circuits the
   branches are grouped onto a horizontal busbar rather than drawn as one line
   per circuit, which is how it is done on paper.
   ========================================================================== */
'use strict';

var SLD = (function () {
  var D = LS;

  /* ------------------------------------------------------------- geometry */
  var M = {
    pad: 28,          // margin round the whole drawing
    supplyY: 40,       // incoming supply label
    band: 108,         // vertical spacing between tiers
    colGap: 24,        // horizontal gap between sibling branches
    panelW: 132,       // width reserved for a control panel
    boardW: 104,       // width of a board's symbol
    maxRowW: 1180,     // circuits wrap onto a new run past this width
    rowGap: 34,        // extra gap between runs
    blockGap: 52       // gap between one transformer's block and the next
  };
  var KIND = {
    supply: { tier: 0 },
    tx: { tier: 1 }, pdb: { tier: 2 }, pdp: { tier: 3 }, db: { tier: 4 }, panel: { tier: 5 }
  };

  /* -------------------------------------------------------------- helpers */
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d || 0); }
  function kva(p, pn) { return D.num(LC.panelDemand(p, pn).kva, 0); }

  /* IEC 60617 uses a "Q" box for a circuit breaker, a switch-disconnector is
     the same box with a small cross bar, and a fuse is a rectangle with a
     line through it. A distribution board is a rectangle. We follow those.

     The label comes off the device that is actually set rather than from the
     board's tier: a board assumed to have an MCB when it carries a 250 A
     incomer would put "MCB" on the drawing beside an 800 A device. Where no
     device is set, the tier's conventional answer is shown instead, so the
     drawing still reads. */
  function protectiveDevice(item, kind) {
    var d = item && item.prot;
    if (d && d.kind) {
      var short = d.kind === 'mcb' ? 'MCB' : 'MCCB';
      var ir = num(d.ir, 0);
      return { label: ir ? short + ' ' + ir : short, type: 'breaker', prot: d };
    }
    if (kind === 'tx') return { label: 'CB', type: 'breaker' };
    if (kind === 'pdb') return { label: 'ACB', type: 'breaker' };
    if (kind === 'pdp') return { label: 'MCCB', type: 'breaker' };
    if (kind === 'db') return { label: 'MCB', type: 'breaker' };
    return { label: 'MCB', type: 'breaker' };
  }

  function cableLabel(item) {
    var c = item && item.cable;
    if (!c || !c.csa) return '';
    return (c.runs > 1 ? c.runs + '×' : '') + D.r1(c.csa) + ' mm²';
  }

  /* ================================================================= layout
     Each transformer gets its own block, laid out top-down and placed side by
     side. Within a block, a board is centred over the span of what it feeds,
     so a sub-board sits directly above its circuits and sibling boards never
     collide. A drawing per transformer keeps each one legible instead of
     squeezing the whole site onto one very wide sheet.                          */
  function layout(p) {
    var nodes = [], links = [];
    var blockX = M.pad, blockW = 0;
    var tiersUsed = 0;

    function tierY(tier) { return M.supplyY + tier * M.band; }

    /* Reserve a span of `w` and return its centre. */
    function take(w) {
      var cx = blockX + w / 2;
      blockX += w;
      return cx;
    }
    function gap(g) { blockX += (g === undefined ? M.colGap : g); }

    function children(pp, o, kind) {
      var out = [];
      if (kind === 'tx') {
        LC.pdbOfTx(pp, o.id).forEach(function (b) { out.push({ kind: 'pdb', o: b, parentId: o.id }); });
      } else if (kind === 'pdb') {
        /* circuits taking their supply straight off the board come first —
           they are one way on the main board — then the distribution boards */
        LC.panelsOnPdb(pp, o.id).forEach(function (pn) { out.push({ kind: 'panel', o: pn, parentId: o.id }); });
        LC.pdpOfPdb(pp, o.id).forEach(function (d) { out.push({ kind: 'pdp', o: d, parentId: o.id }); });
      } else if (kind === 'pdp') {
        /* circuits on the distribution board itself come first, then each
           sub-board with the circuits sitting on it */
        panelsOn(pp, o.id).forEach(function (pn) { out.push({ kind: 'panel', o: pn, parentId: o.id }); });
        LC.dbOfPdp(pp, o.id).forEach(function (b) { out.push({ kind: 'db', o: b, parentId: o.id }); });
      } else if (kind === 'db') {
        LC.panelsOnDb(pp, o.id).forEach(function (pn) { out.push({ kind: 'panel', o: pn, parentId: o.id }); });
      }
      return out;
    }
    function panelsOn(pp, pdpId) {
      return pp.panels.filter(function (pn) { return pn.pdpId === pdpId && (!pn.dbId || !LC.get(pp, 'db', pn.dbId)); });
    }

    /* One block per transformer, stacked down the sheet. Each block is laid
       out into its own node list and then shifted into place, so the blocks
       cannot interfere with each other's coordinates. */
    var maxBlockW = 0, yCursor = 0;

    p.txs.forEach(function (t) {
      var bn = [], bl = [];
      blockX = M.pad;
      tiersUsed = 0;

      function emit(n, parentId) {
        bn.push(n);
        if (parentId) bl.push({ from: parentId, to: n.id });
        return n.x;
      }
      function placeL(k, y) {
        if (k.kind === 'panel') {
          tiersUsed = Math.max(tiersUsed, KIND.panel.tier);
          return emit({
            id: k.o.id, kind: 'panel', o: k.o,
            x: take(M.panelW), y: y === undefined ? tierY(KIND.panel.tier) : y, w: M.panelW
          }, k.parentId);
        }
        return placeBoardL(k.o, k.kind, k.parentId);
      }
      /* Lay out a board's children. Circuits are placed in rows: a
         distribution board with twenty outgoing circuits would otherwise make
         the sheet absurdly wide, and a wide sheet is unreadable on screen and
         unusable on paper. Sub-boards always start their own row, so each
         board's circuits sit together under it. */
      function placeChildren(kids) {
        /* group into rows: a sub-board starts a new row so its circuits stay
           together beneath it, and a run of circuits wraps at maxRowW */
        var rows = [], cur = [], w = 0;
        kids.forEach(function (k) {
          if (k.kind !== 'panel') {
            if (cur.length) { rows.push(cur); cur = []; w = 0; }
            rows.push([k]);
            return;
          }
          var kw = M.panelW + M.colGap;
          if (cur.length && w + kw > M.maxRowW) { rows.push(cur); cur = []; w = 0; }
          cur.push(k); w += kw;
        });
        if (cur.length) rows.push(cur);

        /* Rows run left to right rather than stacking, so a block's depth stays
           equal to its number of tiers and the whole thing fits a page. */
        var centres = [];
        var y = tierY(KIND.panel.tier);
        rows.forEach(function (r) {
          if (blockX > M.pad) blockX += M.rowGap;
          r.forEach(function (k, i) { if (i) gap(); centres.push(placeL(k, y)); });
        });
        return centres;
      }

      function placeBoardL(o, kind, parentId) {
        tiersUsed = Math.max(tiersUsed, KIND[kind].tier);
        var kids = children(p, o, kind);
        var cx;
        if (!kids.length) {
          cx = take(M.boardW);
        } else {
          var s = blockX;
          var centres = placeChildren(kids);
          cx = centres.length
            ? (Math.min.apply(null, centres) + Math.max.apply(null, centres)) / 2
            : s + (blockX - s) / 2;
        }
        return emit({
          id: o.id, kind: kind, o: o, st: LC.boardStats(p, o, kind),
          x: cx, y: tierY(KIND[kind].tier), w: M.boardW
        }, parentId);
      }

      /* lay the main boards out, then centre the transformer over them */
      var kids = children(p, t, 'tx');
      var txCx;
      if (!kids.length) {
        txCx = take(M.boardW);
      } else {
        var s = blockX;
        kids.forEach(function (k, i) { if (i) gap(); placeL(k); });
        txCx = s + (blockX - s) / 2;
      }
      var txNode = { id: t.id, kind: 'tx', o: t, st: LC.boardStats(p, t, 'tx'), x: txCx, y: tierY(KIND.tx.tier), w: M.boardW };
      bn.push(txNode);
      /* placeL already emitted a link from the transformer down to each of its
         main boards — adding them again here drew the feeder twice */
      bn.push({ id: 'supply:' + t.id, kind: 'supply', o: t, x: txCx, y: M.supplyY, w: M.boardW });
      bl.push({ from: 'supply:' + t.id, to: t.id });

      /* shift the block down the sheet and add it to the drawing */
      var shift = yCursor;
      bn.forEach(function (n) { n.y += shift; });
      nodes = nodes.concat(bn);
      links = links.concat(bl);

      maxBlockW = Math.max(maxBlockW, blockX - M.pad);
      yCursor += M.supplyY + tiersUsed * M.band + 78 + M.blockGap;
    });

    /* a project with no transformers yet still needs a sheet */
    if (!p.txs.length) yCursor = M.supplyY + 3 * M.band;

    /* labels sit outside the symbol, so the sheet needs room for them */
    var maxX = M.pad;
    nodes.forEach(function (n) {
      var half = (n.kind === 'panel' ? M.panelW : M.boardW) / 2;
      /* the transformer's figures sit to the right of its symbol */
      maxX = Math.max(maxX, n.x + half + (n.kind === 'tx' ? 210 : 52));
    });
    var maxY = 0;
    nodes.forEach(function (n) { maxY = Math.max(maxY, n.y); });
    return {
      nodes: nodes, links: links,
      width: Math.max(560, maxX + M.pad),
      height: Math.max(420, maxY + 104)
    };
  }

  /* ================================================================ symbols */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function txt(x, y, s, cls, anchor) {
    return '<text x="' + x + '" y="' + y + '" class="' + (cls || 'sld-t') + '"' +
      (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + esc(s) + '</text>';
  }

  /* IEC 60617 two-winding transformer: two overlapping circles. */
  function symTransformer(cx, cy, o) {
    var r = 17, gap = 8;
    return '<g class="sym sym-tx">' +
      '<circle cx="' + (cx - gap) + '" cy="' + cy + '" r="' + r + '" class="sym-line"/>' +
      '<circle cx="' + (cx + gap) + '" cy="' + cy + '" r="' + r + '" class="sym-line"/>' +
      txt(cx, cy - r - 8, num(o.kvIn, 11) + ' kV', 'sld-sm', 'middle') +
      txt(cx, cy + r + 14, num(o.kvOut, 0.415) + ' kV', 'sld-sm', 'middle') +
      '</g>';
  }

  /* IEC 60617 circuit breaker: a square. A main switch adds a cross bar. */
  function symBreaker(cx, cy, size, filled) {
    var h = size / 2;
    return '<rect x="' + (cx - h) + '" y="' + (cy - h) + '" width="' + size + '" height="' + size + '"' +
      (filled ? ' class="sym-fill"' : ' class="sym-line"') + '/>';
  }
  function symFuse(cx, cy, size) {
    var h = size / 2, w = size * 0.9;
    return '<g><rect x="' + (cx - w / 2) + '" y="' + (cy - h / 2) + '" width="' + w + '" height="' + h +
      '" class="sym-line"/><line x1="' + cx + '" y1="' + (cy - h / 2) + '" x2="' + cx + '" y2="' + (cy + h / 2) +
      '" class="sym-line"/></g>';
  }
  /* earth, IEC 60617: three decreasing bars */
  function symEarth(cx, cy) {
    var w = 13, h = 4, g = 3;
    return '<g class="sym-line"><line x1="' + cx + '" y1="' + cy + '" x2="' + cx + '" y2="' + (cy + h) + '"/>' +
      '<line x1="' + (cx - w / 2) + '" y1="' + (cy + h) + '" x2="' + (cx + w / 2) + '" y2="' + (cy + h) + '"/>' +
      '<line x1="' + (cx - w / 2 + 2) + '" y1="' + (cy + h + g) + '" x2="' + (cx + w / 2 - 2) + '" y2="' + (cy + h + g) + '"/>' +
      '<line x1="' + (cx - w / 2 + 4) + '" y1="' + (cy + h + 2 * g) + '" x2="' + (cx + w / 2 - 4) + '" y2="' + (cy + h + 2 * g) + '"/>' +
      '</g>';
  }

  /* ================================================================= render */
  function render(p, opts) {
    opts = opts || {};
    var L = layout(p);
    var out = [];
    var byId = {};
    L.nodes.forEach(function (n) { byId[n.id] = n; });

    out.push('<g class="sld-wires">');
    L.links.forEach(function (lk) {
      var a = byId[lk.from], b = byId[lk.to];
      if (!a || !b) return;
      out.push(wire(a, b));
    });
    out.push('</g>');

    out.push('<g class="sld-symbols">');
    L.nodes.forEach(function (n) {
      if (n.kind === 'supply') out.push(nodeSupply(n));
      else if (n.kind === 'tx') out.push(nodeTx(p, n));
      else if (n.kind === 'panel') out.push(nodePanel(p, n));
      else out.push(nodeBoard(p, n));
    });
    out.push('</g>');

    return {
      svg: out.join(''),
      width: L.width, height: L.height,
      nodes: L.nodes,
      links: L.links
    };
  }

  /* The run between two tiers: down from the parent, along to the child, then
     into it. Where they share an x it is a single straight line. The stub
     heights clear each symbol's own labels, so a wire never crosses text. */
  function wire(a, b) {
    var drop = a.kind === 'tx' ? 24 : a.kind === 'panel' ? 18 : 32;
    var rise = b.kind === 'tx' ? 24 : b.kind === 'panel' ? 32 : 40;
    var x1 = a.x, y1 = a.y + drop, x2 = b.x, y2 = b.y - rise;
    var cls = 'sld-wire w-' + a.kind;
    if (Math.abs(x1 - x2) < 1.5) {
      return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="' + cls + '"/>';
    }
    var my = y1 + (y2 - y1) * 0.55;
    return '<path d="M' + x1 + ' ' + y1 + ' L' + x1 + ' ' + my + ' L' + x2 + ' ' + my + ' L' + x2 + ' ' + y2 + '" class="' + cls + '"/>';
  }

  function nodeSupply(n) {
    var o = n.o;
    return '<g class="sym sym-supply">' +
      txt(n.x, n.y, num(o.kvIn, 11) + ' kV incomer', 'sld-sm', 'middle') +
      /* incoming supply: a line with an arrow, IEC 60617 style */
      '<line x1="' + n.x + '" y1="' + (n.y + 8) + '" x2="' + n.x + '" y2="' + (n.y + 26) + '" class="sym-line"/>' +
      '<path d="M' + (n.x - 6) + ' ' + (n.y + 20) + ' L' + n.x + ' ' + (n.y + 30) + ' L' + (n.x + 6) + ' ' + (n.y + 20) + '" class="sym-line"/>' +
      '</g>';
  }

  function nodeTx(p, n) {
    var o = n.o, st = n.st || LC.boardStats(p, o, 'tx');
    var cap = num(o.kva, 0);
    var u = cap ? (st.kva / cap) * 100 : 0;
    var cls = 'sym sym-txnode' + (u > 100 ? ' bad' : u > 85 ? ' warn' : '');
    var s = '<g class="' + cls + '" data-select="' + o.id + '" data-kind="tx">';
    /* incomer protective device, clear of the winding circles */
    s += symBreaker(n.x - 46, n.y - 2, 13, true);
    s += txt(n.x - 46, n.y + 16, 'CB', 'sld-sm', 'middle');
    s += '<line x1="' + (n.x - 32) + '" y1="' + n.y + '" x2="' + (n.x - 26) + '" y2="' + n.y + '" class="sym-line"/>';
    s += symTransformer(n.x, n.y, o);
    /* earth on the star point of the LV winding */
    s += symEarth(n.x + 42, n.y + 2);
    /* The figures go beside the symbol rather than below it: the tier below
       starts only a band away, and text under the symbol collided with it. */
    var lx = n.x + 62;
    s += txt(lx, n.y - 14, o.tag, 'sld-tag');
    s += txt(lx, n.y - 1, cap + ' kVA', 'sld-b');
    s += txt(lx, n.y + 12, st.amp.toFixed(0) + ' A · ' + u.toFixed(0) + '%', 'sld-sm');
    if (o.name) s += txt(lx, n.y + 25, clip(o.name, 24), 'sld-sm');
    return s + '</g>';
  }
  /* trim a label so it does not collide with its neighbours */
  function clip(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function nodeBoard(p, n) {
    var o = n.o, kind = n.kind;
    var st = n.st || LC.boardStats(p, o, kind);
    var dev = protectiveDevice(o, kind);
    var w = M.boardW, h = 34;
    var rating = num(o.incomerA, 0) + ' A';
    var u = st.util;
    var cls = 'sym sym-' + kind + (u === null || u === undefined ? '' : u > 100 ? ' bad' : u > 85 ? ' warn' : '');
    var s = '<g class="' + cls + '" data-select="' + o.id + '" data-kind="' + kind + '">';

    /* protective device on the incomer, per IEC 60617 */
    s += symBreaker(n.x, n.y - 30, 13, true);
    s += txt(n.x + 14, n.y - 26, dev.label, 'sld-sm');

    /* the board itself — a plain rectangle, as on a real single line */
    s += '<rect x="' + (n.x - w / 2) + '" y="' + (n.y - h / 2) + '" width="' + w + '" height="' + h + '" class="sym-box"/>';
    s += txt(n.x, n.y + 1, o.tag, 'sld-in', 'middle');
    s += txt(n.x, n.y + 13, rating, 'sld-sm', 'middle');

    /* what it is carrying, and the feeder above it */
    var load = u === null || u === undefined ? '' : st.amp.toFixed(0) + ' A · ' + u.toFixed(0) + '%';
    var ways = kind === 'pdp' ? num(o.spareWays, 0) : kind === 'db' ? num(o.ways, 0) : null;
    var foot = [load];
    if (ways !== null) foot.push(st.panels.length + '/' + ways + ' ways');
    s += txt(n.x, n.y + h / 2 + 13, foot.join(' · '), 'sld-sm', 'middle');
    s += txt(n.x, n.y + h / 2 + 25, cableLabel(o), 'sld-sm', 'middle');
    return s + '</g>';
  }

  function nodePanel(p, n) {
    var o = n.o;
    var d = LC.panelDemand(p, o);
    var w = M.panelW - 8, h = 26;
    var cab = o.cable && o.cable.csa ? LC.cableRating(o.cable) : null;
    var over = cab && d.amp > cab.derated;
    var cls = 'sym sym-panel' + (over ? ' bad' : '') + (!o.pdpId ? ' warn' : '');
    var s = '<g class="' + cls + '" data-select="' + o.id + '" data-kind="panel">';
    /* final circuit protective device */
    s += symFuse(n.x, n.y - 28, 13);
    /* the load */
    s += '<rect x="' + (n.x - w / 2) + '" y="' + (n.y - h / 2) + '" width="' + w + '" height="' + h + '" class="sym-box"/>';
    s += txt(n.x, n.y + 0.5, o.tag, 'sld-in', 'middle');
    s += txt(n.x, n.y + 11, d.kw.toFixed(0) + ' kW · ' + d.amp.toFixed(0) + ' A', 'sld-sm', 'middle');
    var foot = [];
    if (cab) foot.push((o.cable.runs > 1 ? o.cable.runs + '×' : '') + D.r1(o.cable.csa) + ' mm²');
    foot.push(num(o.cable && o.cable.len, 0).toFixed(0) + ' m');
    s += txt(n.x, n.y + h / 2 + 13, foot.join(' · '), 'sld-sm', 'middle');
    return s + '</g>';
  }

  return { layout: layout, render: render, M: M };
})();