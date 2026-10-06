/* ============================================================================
   calc.js — engineering calculations, auto-assignment, plan geometry
   ==========================================================================*/
'use strict';

var LC = (function () {
  var D = LS;
  var num = D.num;          // local aliases used throughout the engine
  var clamp = D.clamp;

  /* ---------------------------------------------------------------- indexes */
  function index(p) {
    return {
      tx:   byId(p.txs),   pdb: byId(p.pdbs),  pdp: byId(p.pdps), panel: byId(p.panels)
    };
  }

  /* ======================================================================
     HIERARCHICAL BOARD NUMBERING

       TX7
        └─ PDB7
            └─ PDP7-1
                └─ DB7-1-1
                    ├─ MCC-01
                    └─ AHU-02
                └─ DB7-1-2
            └─ PDP7-2
                └─ DB7-2-1

     A transformer is numbered from 1 upwards (the user may pin a specific
     number, e.g. TX7 for an extension supply). Everything below it is
     numbered by position within its parent, so a main board is always PDB7,
     the distribution boards off it PDP7-1, PDP7-2, and the sub-distribution
     boards off PDP7-1 are DB7-1-1, DB7-1-2.

     Control panels are NOT numbered. A panel is a load, not a board: it
     carries whatever reference the drawing team already uses (MCC-01,
     AHU-02), which is the name on the drawing, the label on the enclosure
     and the row on the schedule. Only the four board tiers get a derived
     reference.

     A transformer with more than one main board is the one case that does
     not fit the simple pattern, so it continues the sequence: PDB7-1,
     PDB7-2. That keeps every reference unique and the meaning predictable —
     "the Nth main board on TX7".

     `applyNumbering` rewrites the board tags from the hierarchy, so the
     numbers are always consistent with the current topology. The free-text
     name and description are left alone: those carry the engineering
     meaning, the tag is the reference that appears on the drawings and
     schedules.
     ==================================================================== */
  var PREFIX = { tx: 'TX', pdb: 'PDB', pdp: 'PDP', db: 'DB' };

  /* Resolve an item's ancestry: [transformer, main board, distribution board].
     Any element may be null when the item is not connected. */
  function ancestryOf(p, o) {
    var kind = o.__kind || kindOf(o);
    if (kind === 'tx') return [o, null, null];
    if (kind === 'pdb') return [o.txId ? get(p, 'tx', o.txId) : null, o, null];
    if (kind === 'pdp') {
      var pdb = o.pdbId ? get(p, 'pdb', o.pdbId) : null;
      return [pdb && pdb.txId ? get(p, 'tx', pdb.txId) : null, pdb, o];
    }
    if (kind === 'db') {
      var pdp2 = o.pdpId ? get(p, 'pdp', o.pdpId) : null;
      var pdb3 = pdp2 && pdp2.pdbId ? get(p, 'pdb', pdp2.pdbId) : null;
      return [pdb3 && pdb3.txId ? get(p, 'tx', pdb3.txId) : null, pdb3, pdp2];
    }
    var pdp = o.pdpId ? get(p, 'pdp', o.pdpId) : null;
    var pdb2 = pdp && pdp.pdbId ? get(p, 'pdb', pdp.pdbId) : null;
    return [pdb2 && pdb2.txId ? get(p, 'tx', pdb2.txId) : null, pdb2, pdp];
  }

  /* The numeric path down to a main board: "7" when the transformer has a
     single main board, "7-2" when it has several. Only the levels that are
     actually ambiguous add a segment, so the common case reads as the brief
     describes it (TX7 → PDB7 → PDP7-1 → DB7-1-1) while a multi-board
     transformer still produces unique tags. */
  function pdbPath(p, pdb) {
    if (!pdb) return null;
    var tx = pdb.txId ? get(p, 'tx', pdb.txId) : null;
    if (!tx || !tx.num) return null;
    if (pdbOfTx(p, tx.id).length > 1) return tx.num + '-' + pdb.num;
    return String(tx.num);
  }

  /* The tag a board gets from the convention, given the numbers already
     assigned to its ancestors. Returns null when the item cannot follow the
     scheme — applyNumbering then gives it a "not assigned" placeholder, so
     there is one place that decides what an unconnected item looks like.
     Control panels always return null: they are not numbered. */
  function computedTag(p, o) {
    var kind = o.__kind || kindOf(o);
    if (kind === 'panel') return null;
    var a = ancestryOf(p, o);
    var tx = a[0], pdb = a[1], pdp = a[2];

    if (kind === 'tx') return o.num ? PREFIX.tx + o.num : null;

    if (kind === 'pdb') {
      var seg = pdbPath(p, o);
      return seg ? PREFIX.pdb + seg : null;
    }

    if (kind === 'pdp') {
      var seg2 = pdbPath(p, pdb);
      return seg2 ? PREFIX.pdp + seg2 + '-' + o.num : null;
    }

    /* Sub-distribution board: DB<path to main board>-<pdp>-<db>. The chain is
     followed all the way to the transformer, so a board is only numbered when
     its whole supply path resolves — a stale parent id left behind by an
     edited or merged file leaves it marked rather than numbered from a board
     that no longer exists. */
    if (!pdp) return null;
    var seg3 = pdbPath(p, pdb);
    return seg3 ? PREFIX.db + seg3 + '-' + pdp.num + '-' + o.num : null;
  }

  /* Assign numbers by position, then rewrite tags. Returns the list of
     items whose tag actually changed, so the UI can report it. */
  function applyNumbering(p) {
    var changed = [];

    /* 1. transformers: keep any number the user pinned, fill the rest in
          order. Numbers are 1-based and must be unique. */
    var usedTx = {};
    p.txs.forEach(function (t) {
      var want = (t.num === null || t.num === undefined || !isFinite(t.num) || t.num < 1)
        ? Math.round(num(t.num, 0)) : Math.round(t.num);
      if (!want || want < 1 || usedTx[want]) {
        want = 1;
        while (usedTx[want]) want++;
        t.num = want;
      }
      usedTx[want] = 1;
    });

    /* 2. main boards, distribution boards and sub-distribution boards: numbered
          by position within their parent. Items with no parent are numbered
          anyway, so they still get a usable reference. Control panels are not
          numbered — they keep the free-text reference they were given. */
    var byTx = {}, byPdb = {}, byPdp = {};
    p.pdbs.forEach(function (b) { (byTx[b.txId || '_'] = byTx[b.txId || '_'] || []).push(b); });
    p.pdps.forEach(function (d) { (byPdb[d.pdbId || '_'] = byPdb[d.pdbId || '_'] || []).push(d); });
    p.dbs.forEach(function (b) { (byPdp[b.pdpId || '_'] = byPdp[b.pdpId || '_'] || []).push(b); });
    Object.keys(byTx).forEach(function (k) { byTx[k].forEach(function (b, i) { b.num = i + 1; }); });
    Object.keys(byPdb).forEach(function (k) { byPdb[k].forEach(function (d, i) { d.num = i + 1; }); });
    Object.keys(byPdp).forEach(function (k) { byPdp[k].forEach(function (b, i) { b.num = i + 1; }); });

    /* 3. rewrite the tags. Anything whose supply chain does not resolve is
          left for step 4. */
    function retag(o) {
      var want = computedTag(p, o);
      if (want === null) return;
      if (o.tag === want) return;
      keepRef(o);
      changed.push({ id: o.id, kind: o.__kind, from: o.tag, to: want });
      o.tag = want;
    }

    /* A project saved before the convention existed carries references the
       user chose — PDB-A1, MCC-01 — and overwriting them would throw that
       away. Move the old one into the free-text reference field the first
       time it is displaced, so the schedule can still show it. References
       the convention would have produced itself are left alone. */
    var DERIVED = /^(TX|PDB|PDP|DB)\d+(-[0-9]+)*(\?-\d+)?$/;
    function keepRef(o) {
      if (o.ref) return;                 // already has one
      if (!o.tag || DERIVED.test(o.tag)) return;
      /* a bare prefix is the placeholder a new board is created with, not a
         reference the user chose — "DB" says nothing, so do not keep it */
      if (/^(TX|PDB|PDP|DB)$/.test(o.tag)) return;
      o.ref = o.tag;
    }
    p.txs.forEach(function (t) { t.__kind = 'tx'; retag(t); });
    p.pdbs.forEach(function (b) { b.__kind = 'pdb'; retag(b); });
    p.pdps.forEach(function (d) { d.__kind = 'pdp'; retag(d); });
    p.dbs.forEach(function (b) { b.__kind = 'db'; retag(b); });
    p.panels.forEach(function (n) { n.__kind = 'panel'; });   // not numbered

    /* 4. a board whose supply chain does not resolve cannot follow the
          scheme. It is marked rather than numbered, and each one gets a
          distinct placeholder so two of them never share a reference. The
          audit reports these separately as unassigned or orphaned. */
    var orphan = 0;
    allItems(p).forEach(function (o) {
      if (o.__kind === 'panel') return;        // panels are never numbered
      if (computedTag(p, o) !== null) return;
      orphan++;
      var want = PREFIX[o.__kind] + '?-' + orphan;
      if (o.tag !== want) { changed.push({ id: o.id, kind: o.__kind, from: o.tag, to: want }); o.tag = want; }
    });
    return changed;
  }

  /* Two transformers pinned to the same number would produce identical
     references. Only the derived board tiers are checked: control panels
     carry free-text references the user chooses, so two circuits called
     MCC-01 is their business, not a numbering fault. */
  function numberingIssues(p) {
    var seen = {}, dupes = [];
    allItems(p).forEach(function (o) {
      if (o.__kind === 'panel') return;
      var t = o.tag;
      if (!t || /\?/.test(t)) return;      // placeholders are not references
      if (seen[t]) dupes.push(t);
      seen[t] = 1;
    });
    return dupes;
  }
  function byId(arr) { var m = {}; for (var i = 0; i < arr.length; i++) m[arr[i].id] = arr[i]; return m; }
  function get(p, kind, id) {
    var arr = kind === 'tx' ? p.txs : kind === 'pdb' ? p.pdbs : kind === 'pdp' ? p.pdps
            : kind === 'db' ? (p.dbs || []) : p.panels;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function pdbOfTx(p, txId)  { return p.pdbs.filter(function (b) { return b.txId === txId; }); }
  function pdpOfPdb(p, pdbId) { return p.pdps.filter(function (b) { return b.pdbId === pdbId; }); }
  function dbOfPdp(p, pdpId)  { return (p.dbs || []).filter(function (b) { return b.pdpId === pdpId; }); }
  /* every circuit on a PDP, whether it sits directly on the board or on one
     of its sub-distribution boards */
  function panelsOf(p, pdpId) { return p.panels.filter(function (b) { return b.pdpId === pdpId; }); }
  /* circuits sitting on one specific sub-board */
  function panelsOnDb(p, dbId) { return p.panels.filter(function (b) { return b.dbId === dbId; }); }
  /* Circuits taking their supply straight from a main board. These are big
     items of plant with their own feeder panel — one way on the MSB. They are
     a deliberate placement, so they are kept apart from the circuits that feed
     through a distribution board. */
  function panelsOnPdb(p, pdbId) {
    return p.panels.filter(function (b) { return b.pdbId === pdbId && !b.pdpId; });
  }
  function chain(p, panel) {
    var pdp = panel.pdpId ? get(p, 'pdp', panel.pdpId) : null;
    /* no distribution board in the path — the circuit sits on the main board */
    var pdb = pdp ? get(p, 'pdb', pdp.pdbId)
          : (panel.pdbId ? get(p, 'pdb', panel.pdbId) : null);
    var tx  = pdb ? get(p, 'tx', pdb.txId) : null;
    return { pdp: pdp, pdb: pdb, tx: tx };
  }
  function parentOf(p, obj, kind) {
    if (kind === 'pdp')    return { kind: 'pdb', id: obj.pdbId };
    if (kind === 'pdb')    return { kind: 'tx',  id: obj.txId };
    if (kind === 'db')     return { kind: 'pdp', id: obj.pdpId };
    if (kind === 'panel')  {
      /* a panel's immediate supply is its sub-board if it has one */
      if (obj.dbId && get(p, 'db', obj.dbId)) return { kind: 'db', id: obj.dbId };
      var d = get(p, 'pdp', obj.pdpId);
      if (d) return { kind: 'pdp', id: d.id };
      /* no distribution board — it takes its supply straight off a main board */
      if (obj.pdbId && get(p, 'pdb', obj.pdbId)) return { kind: 'pdb', id: obj.pdbId };
      return null;
    }
    return null;
  }

  /* ------------------------------------------------------------ demand math */
  /* Connected kW, design kVA (demand factor applied), and current for a panel */
  function panelDemand(p, pn) {
    var kw = D.num(pn.kw);
    var pf = D.clamp(D.num(pn.pf, 0.85), 0.5, 1);
    var kva = (pn.kva !== null && pn.kva !== undefined && pn.kva !== '' && D.num(pn.kva) > 0)
      ? D.num(pn.kva) : (kw / pf);
    var dem = D.clamp(D.num(pn.demand, 1), 0, 2);
    return {
      kw: kw,
      kvaConn: kva,
      kva: kva * dem,                       // design / diversified kVA
      pf: pf, demand: dem,
      amp: currentFor(kva * dem, pf, pn.phases, pn.volt),
      phases: pn.phases
    };
  }
  function currentFor(kva, pf, phases, volt) {
    var v = D.num(volt, 400) || 400;
    if (String(phases) === '1') return (kva * 1000) / (v * pf);
    return (kva * 1000) / (Math.sqrt(3) * v * pf);
  }
  function voltFor(phases, volt) { return String(phases) === '1' ? D.num(volt, 400) : D.num(volt, 400); }

  /* ------------------------------------------- cable capacity & volt drop  */
  function cableRating(cable) {
    var out = { base: null, tempF: 1, groupF: 1, derated: null, csa: null, runs: 1, ok: false, note: 'No cable selected' };
    if (!cable || !cable.csa) return out;
    var csa = D.num(cable.csa);
    out.csa = csa;
    var m = D.METHODS[cable.method] || D.METHODS['A1'];
    var i = D.CSA.indexOf(csa);
    if (i < 0) { out.note = 'Cross-section not in table (' + csa + ' mm²)'; return out; }
    var base = m.amp[i];
    // 4-core is derated relative to a 3-core / single-core-for-phase basis
    var coreF = (D.num(cable.cores, 3) === 4 && csa > 35) ? 0.9 : 1.0;
    var tKey = D.num(cable.ambient, 30) <= 25 ? 25 : D.num(cable.ambient, 30);
    tKey = D.closest(tKey, Object.keys(D.TEMP_FACTORS[m.insul]).map(Number));
    var tempF = D.TEMP_FACTORS[m.insul][tKey] || 1;
    var n = D.clamp(D.num(cable.group, 1), 1, 20);
    var gfTable = D.GROUP_FACTORS[m.group] || D.GROUP_FACTORS.air;
    var gKey = D.closest(n, Object.keys(gfTable).map(Number));
    var groupF = gfTable[gKey];
    var runs = Math.max(1, D.num(cable.runs, 1));
    out.base = base; out.runs = runs;
    out.perRun = base * tempF * groupF * coreF;
    out.tempF = tempF; out.groupF = groupF; out.coreF = coreF; out.method = m; out.insul = m.insul;
    out.derated = out.perRun * runs;
    out.note = base + ' A base × ' + tempF.toFixed(2) + ' temp × ' + groupF.toFixed(2) + ' group' +
      (coreF !== 1 ? ' × 0.90 4-core' : '') + (runs > 1 ? ' × ' + runs + ' runs' : '');
    out.ok = true;
    return out;
  }
  /* indicative resistance / reactance for copper at operating temperature */
  function cableImpedance(cable) {
    var csa = D.num(cable && cable.csa, 0);
    if (!csa) return { r: 0, x: 0.08 };
    var r20 = 22.5 / csa;            // Ω/km Cu at 20 °C
    var r = r20 * 1.15;               // ≈ 70 °C operating
    return { r: r, x: 0.08 };         // LV reactance
  }
  function voltDrop(cable, amp, pf, phases, volt) {
    var z = cableImpedance(cable);
    var L = D.num(cable && cable.len, 0);
    var sin = Math.sqrt(Math.max(0, 1 - pf * pf));
    var km = L / 1000;
    var dv = String(phases) === '1'
      ? 2 * amp * km * (z.r * pf + z.x * sin)
      : Math.sqrt(3) * amp * km * (z.r * pf + z.x * sin);
    var v = D.num(volt, 400) || 400;
    return { volts: dv, pct: (dv / v) * 100, r: z.r, x: z.x, len: L };
  }
  /* Smallest cable that carries the load with the design margin applied and
     stays inside the volt drop limit. Parallel runs are a fallback, not a
     first choice: we try one run first, then two, and so on, so the result
     is the single largest-copper cable rather than a bundle of small ones.
     Returns {csa, runs, dropLimited, util}.                                  */
  function suggestCable(amp, len, pf, phases, volt, method, p) {
    method = method || 'XL-A1';
    var limit = D.num(p && p.design ? p.design.vdropLimitLv : 3, 3);
    /* don't propose a cable sitting at 98% of its rating — design it with
       the same margin the incomers are designed with */
    var margin = D.num(p && p.design ? p.design.designMargin : 1.15, 1.15);
    var need = amp * margin;
    function probe(csa, runs) {
      var c = { csa: csa, cores: 4, len: len, method: method, group: 3, ambient: 40, runs: runs, sheathed: true };
      var r = cableRating(c);
      if (r.derated < need) return null;
      var d = voltDrop(c, amp, pf, phases, volt);
      if (d.pct > limit) return null;
      return { csa: csa, runs: runs, util: amp / r.derated * 100 };
    }
    for (var runs = 1; runs <= D.MAX_CABLE_RUNS; runs++) {
      for (var i = 0; i < D.CSA.length; i++) {
        var hit = probe(D.CSA[i], runs);
        if (hit) return hit;
      }
    }
    /* Nothing satisfies it. Say which constraint ran out — a drop that is too
       long gets a bigger core, whereas too much current for any number of
       parallel cables gets a busbar, and telling someone to add another core
       when the answer is busbar wastes their afternoon. */
    var biggest = probe(D.CSA[D.CSA.length - 1], D.MAX_CABLE_RUNS);
    if (!biggest) return { csa: D.CSA[D.CSA.length - 1], runs: D.MAX_CABLE_RUNS, runLimited: true, util: null };
    /* the largest available still carries the current, so it is the volt drop
       that cannot be met */
    return { csa: biggest.csa, runs: biggest.runs, dropLimited: true, util: biggest.util };
  }
  /* The most a cable of this type can carry in this installation, however many
     are put in parallel. Past this the answer is a busbar, not more copper. */
  function maxCableA(p, cable) {
    var c = { csa: D.CSA[D.CSA.length - 1], cores: 4, len: 1,
      method: (cable && cable.method) || 'XL-A1',
      group: cable && cable.group !== undefined ? cable.group : 3,
      ambient: cable && cable.ambient !== undefined ? cable.ambient : 40,
      runs: D.MAX_CABLE_RUNS, sheathed: true };
    var r = cableRating(c);
    return r.derated;
  }
  function suggestIncomer(amp, margin) {
    margin = margin || 1.25;
    var need = amp * margin;
    for (var i = 0; i < D.SIZES_A.length; i++) if (D.SIZES_A[i] >= need) return D.SIZES_A[i];
    return D.SIZES_A[D.SIZES_A.length - 1];
  }

  /* ------------------------------------------------- protective devices ---- */
  /* The smallest MCCB frame that can carry a setting of `ir`, and the largest
     setting the frame offers. Both are lookups into the manufacturer ranges —
     no device can be set above its own frame, which is the mistake this pair of
     helpers exists to prevent. */
  function mccbFrameFor(ir) {
    var need = num(ir, 0);
    for (var i = 0; i < D.MCCB_FRAMES.length; i++) if (D.MCCB_FRAMES[i] >= need) return D.MCCB_FRAMES[i];
    return D.MCCB_FRAMES[D.MCCB_FRAMES.length - 1];
  }
  /* The breaking capacity to order. IEC 60947-2 requires Icu at the installation
     point, so this rounds the calculated fault level up to the next catalogue
     value. A small margin is added first, because the fault level is itself
     indicative — the transformer impedance and the fault MVA are assumptions. */
  function icuFor(faultKA) {
    if (!faultKA || !isFinite(faultKA) || faultKA <= 0) return D.ICU_KA[0];
    /* 15% on the calculated level: the calculation ignores contact resistance,
       busbar impedance and arc impedance, all of which only reduce the fault. */
    var need = faultKA * 1.15;
    for (var i = 0; i < D.ICU_KA.length; i++) if (D.ICU_KA[i] >= need) return D.ICU_KA[i];
    return D.ICU_KA[D.ICU_KA.length - 1];
  }
  function mcbRatingFor(amp, margin) {
    var need = num(amp, 0) * (margin || 1.25);
    var list = D.MCB_RATINGS;
    for (var i = 0; i < list.length; i++) if (list[i] >= need) return list[i];
    return null;                       // beyond any MCB — say so, do not guess
  }

  /* What trip unit a device needs at this size.
     Under 160 A a thermal-magnetic device is the normal answer and saves money.
     From 200 A up it is an electronic unit, and once the board has a downstream
     circuit needing selectivity an LI (long-time + instantaneous) is the
     minimum: an LI-only unit has no short-time stage, so it cannot be graded
     against anything below it. */
  function tripFor(ir, kind, needsSelectivity) {
    if (kind === 'mcb') return 'C';
    if (num(ir, 0) <= 160) return 'TM';
    return needsSelectivity ? 'LS' : 'LI';
  }

  /* -------------------------------------------------------------- propose --
     Propose a protective device for anything that has a supply. The rule per
     tier is a house convention, not physics, and is stated in the README:

       main board   (PDB)  MCCB  — the whole installation is behind it
       distribution(PDP)  MCCB  — feeds several circuits, must grade against them
       sub-board    (DB)   MCB   — lighting and small power only
       circuit             MCB below 160 A, otherwise MCCB

     A sub-board larger than the largest MCB is the interesting case: the
     convention says MCB, but no single MCB can protect a 250 A board, so the
     proposal returns an MCCB and says why. Following the convention literally
     would put a 125 A device in front of a 250 A board.                        */
  function proposeProt(p, item, kind) {
    var st, amp, rating, fKA;
    if (kind === 'pdb') {
      st = boardStats(p, item, 'pdb'); rating = num(item.incomerA, 0);
    } else if (kind === 'pdp') {
      st = boardStats(p, item, 'pdp'); rating = num(item.incomerA, 0);
    } else if (kind === 'db') {
      st = boardStats(p, item, 'db'); rating = num(item.incomerA, 0);
    } else {
      var d = panelDemand(p, item); rating = 0; amp = d.amp;
    }
    var loadA = amp === undefined ? (st ? st.amp : 0) : amp;
    fKA = faultAt(p, item, kind);

    var margin = num(p.design.spreadMargin, 1.25);
    var out = { device: null, why: '', faultKA: fKA, amp: loadA, rating: rating };

    /* What the device has to be rated for.

       A board's incomer device is sized on the *load*, with margin — not on the
       board's rating. A 4,000 A board carrying 700 A gets a 1,000 A device: the
       board is bought big for the circuits to come, and the incomer is uprated
       with them. Sizing on the rating instead would put a 4,000 A device on a
       700 A board, which is a 175% device and nothing else.

       An empty board is the exception: with no load there is nothing to size
       against, and the board's own rating is the only sensible choice. */
    var basis = loadA > 0 ? loadA * margin : rating;
    var ir = deviceRatingFor(basis);
    if (rating > 0 && ir > rating) ir = deviceRatingFor(rating);   // never above the board
    amp = basis;

    if (kind === 'db') {
      var mcbA = mcbRatingFor(loadA || rating, margin);
      if (loadA <= 0 && rating <= D.MCB_MAX_A) mcbA = mcbRatingFor(rating, 1) || D.MCB_MAX_A;
      if (mcbA !== null && mcbA <= D.MCB_MAX_A) {
        out.device = D.newProt({ kind: 'mcb', ir: mcbA, icu: icuFor(fKA), trip: tripFor(mcbA, 'mcb'), poles: 4 });
        out.why = 'Sub-board: MCB ' + mcbA + ' A as the convention asks' +
          (loadA > 0 ? ', sized on the ' + loadA.toFixed(0) + ' A load with margin'
                     : ', sized on the ' + rating + ' A board rating since nothing is connected yet') + '.';
        return out;
      }
      /* No MCB goes this high. An MCCB is the only thing that fits. */
      var ir2 = ir || deviceRatingFor(Math.max(loadA * margin, rating));
      out.device = D.newProt({ kind: 'mccb', ir: ir2, frame: mccbFrameFor(ir2), icu: icuFor(fKA),
        trip: tripFor(ir2, 'mccb', true), poles: 4,
        notes: 'The convention calls for an MCB here, but a ' + rating + ' A board is above the largest MCB (' + D.MCB_MAX_A +
               ' A), and no single MCB can protect it. Either an MCCB as shown, or an MCB assembly with a shunt trip and ' +
               'undervoltage release, which lets a small MCB cut the load while the assembly opens to isolate it.' });
      out.why = 'MCCB rather than an MCB: a ' + rating + ' A board is beyond any MCB.';
      return out;
    }

    if (kind === 'panel') {
      var mcb2 = mcbRatingFor(loadA, margin);
      if (mcb2 !== null) {
        out.device = D.newProt({ kind: 'mcb', ir: mcb2, icu: icuFor(fKA), trip: tripFor(mcb2, 'mcb'),
          poles: item.phases === '1' ? 2 : 4 });
        out.why = 'Final circuit at ' + loadA.toFixed(1) + ' A — MCB ' + mcb2 + ' A, curve ' + out.device.trip + '.';
        return out;
      }
      ir = deviceRatingFor(loadA * margin);
    }

    /* MCCB path — main boards, distribution boards, and any circuit above the
       MCB range. Graded against whatever sits below it. */
    var needsSel = hasDownstream(p, item, kind);
    var dev = D.newProt({ kind: 'mccb', ir: ir, frame: mccbFrameFor(ir), icu: icuFor(fKA),
      trip: tripFor(ir, 'mccb', needsSel), poles: item.phases === '1' ? 2 : 4 });
    out.device = dev;
    out.why = (kind === 'pdb' ? 'Main board' : kind === 'pdp' ? 'Distribution board' : 'Circuit') +
      (loadA > 0 ? ' at ' + loadA.toFixed(0) + ' A' : ' with nothing connected') +
      (rating ? ', on a ' + rating + ' A board' : '') + ' — MCCB ' + ir + ' A in a ' +
      dev.frame + ' A frame, ' + dev.trip + (needsSel ? ' trip unit, for grading against what is below it' : ' trip unit') +
      ', Icu ' + dev.icu + ' kA' + (fKA ? ' against a calculated ' + fKA.toFixed(1) + ' kA' : '') + '.';
    return out;
  }

  /* The next available MCCB setting at or above a required rating. Device
     ratings come from the trip-unit range, not from the incomer size list — the
     two are different series and a device cannot be set to every value a busbar
     can be rated at. */
  function deviceRatingFor(need) {
    var list = D.MCCB_SETTINGS;
    for (var i = 0; i < list.length; i++) if (list[i] >= num(need, 0)) return list[i];
    return list[list.length - 1];
  }

  /* Is there anything downstream that this device has to be selective against?
     A board with one circuit below it still needs grading; an empty board does
     not, and there is no point paying for a short-time stage on it. */
  function hasDownstream(p, item, kind) {
    if (kind === 'pdb') return pdpOfPdb(p, item.id).length > 0 || panelsOnPdb(p, item.id).length > 0;
    if (kind === 'pdp') return panelsOf(p, item.id).length > 0 || dbOfPdp(p, item.id).length > 0;
    if (kind === 'db') return panelsOnDb(p, item.id).length > 0;
    return false;
  }
  /* Apply a proposal to the item and report it.

     With `replace` false, a device that is already set is left exactly as it is
     — that is what "only fill in what's missing" has to mean, because a project
     imported from a switchgear schedule arrives with every circuit's real device
     on it. Only the fields a proposal is the authority for (the breaking
     capacity, which nothing else knows) are filled in on a device that has a
     rating but no Icu. */
  function applyProt(p, item, kind, replace) {
    var existing = item.prot;
    var hasReal = existing && num(existing.ir, 0) > 0;

    if (hasReal && !replace) {
      var fKA2 = faultAt(p, item, kind);
      if (!num(existing.icu, 0) && fKA2) existing.icu = icuFor(fKA2);
      if (existing.kind === 'mccb' && !num(existing.frame, 0) && num(existing.ir, 0)) {
        existing.frame = mccbFrameFor(existing.ir);
      }
      if (existing.notes === undefined || existing.notes === null) existing.notes = '';
      return { device: existing, kept: true, why: 'Left as set — ' +
        (existing.kind === 'mcb' ? 'MCB ' : 'MCCB ') + existing.ir + ' A' +
        (existing.frame && existing.frame !== existing.ir ? ' in a ' + existing.frame + ' A frame' : '') +
        (existing.trip ? ', ' + existing.trip : '') + '. Breaking capacity' +
        (existing.icu ? ' ' + existing.icu + ' kA' : ' filled in from the fault level') + '.',
        faultKA: fKA2, amp: kind === 'panel' ? panelDemand(p, item).amp : boardStats(p, item, kind).amp };
    }

    var res = proposeProt(p, item, kind);
    if (!res.device) return res;
    var keep = existing || null;
    /* keep anything the proposal cannot know — the vendor's own notes */
    if (keep && keep.notes && !res.device.notes) res.device.notes = keep.notes;
    if (keep && keep.aux && !res.device.aux) res.device.aux = keep.aux;
    item.prot = res.device;
    return res;
  }
  /* Propose protection for every supply in the project at once. */
  function protAll(p, opts) {
    opts = opts || {};
    var n = 0, out = [];
    function doIt(item, kind) {
      var res = applyProt(p, item, kind, opts.replace);
      n++; out.push({ kind: kind, tag: item.tag, why: res.why });
    }
    p.pdbs.forEach(function (b) { doIt(b, 'pdb'); });
    p.pdps.forEach(function (b) { doIt(b, 'pdp'); });
    p.dbs.forEach(function (b) { doIt(b, 'db'); });
    if (opts.circuits !== false) p.panels.forEach(function (b) { doIt(b, 'panel'); });
    return { count: n, detail: out };
  }

  /* ------------------------------------------------- fault level propagation --
     Indicative. The short-circuit current at the LV terminals comes from the
     transformer's impedance, not its rating:

         Ssc = Sn / uk        so a 3,150 kVA transformer at 6% has a
         Isc = Ssc / (√3·V)   short-circuit power of 52.5 MVA, which at 400 V
                              is 75.8 kA.

     Taking the rating as if it were the fault power gives 4.5 kA and is wrong
     by a factor of about 17 — which is the difference between specifying a 6 kA
     device and a 100 kA one. `faultMVAFactor` scales the assumed fault power for
     an upstream source weaker than an infinite bus, and only matters when it is
     set above 1.
                                                                       */
  function txFaultKA(p, tx) {
    var fac = num(p.design.faultMVAFactor, 1);
    var sn = num(tx.kva, 0);                       // kVA
    if (sn <= 0) return null;
    var zpu = num(tx.impZ, 6);                     // percent impedance
    /* An unknown or zero impedance would divide by nothing. 6% is the usual
       figure for a distribution transformer and is what the field defaults to. */
    if (!isFinite(zpu) || zpu <= 0) zpu = 6;
    /* The fault power seen at the terminals is the rating divided by the
       impedance, scaled by how strong the source is. */
    var sscKva = sn / (zpu / 100) * fac;           // kVA
    var V = Math.max(50, num(tx.kvOut, 0.415) * 1000);
    return (sscKva * 1000) / (Math.sqrt(3) * V) / 1000;   // kA
  }
  function faultAt(p, item, kind) {
    var zpu = D.num(p.design.zpuPerStage, 0.06);
    var tx = null, stages = 0;
    if (kind === 'tx') return txFaultKA(p, item);
    if (kind === 'pdb') { tx = get(p, 'tx', item.txId); stages = 1; }
    else if (kind === 'pdp') { var pdb = get(p, 'pdb', item.pdbId); tx = pdb && get(p, 'tx', pdb.txId); stages = 2; }
    else if (kind === 'db') {
      var pdp2 = get(p, 'pdp', item.pdpId);
      var pdb2 = pdp2 && get(p, 'pdb', pdp2.pdbId);
      tx = pdb2 && get(p, 'tx', pdb2.txId);
      stages = 3;
    }
    else {
      /* A circuit. The number of distribution stages is whatever actually sits
         between it and the transformer — counting a stage that is not there
         understates the fault level, which is the wrong way to be wrong. */
      var ch = chain(p, item);
      tx = ch.tx;
      stages = 0;
      if (ch.pdb) stages = 1;
      if (ch.pdp) stages = 2;
      if (item.dbId && get(p, 'db', item.dbId)) stages = 3;
      stages = stages + 1;                 // the final circuit itself
    }
    if (!tx) return null;
    var div = 1;
    for (var i = 0; i < stages; i++) div *= (1 + zpu);
    return txFaultKA(p, tx) / div;
  }

  /* ---------------------------------------------------------------- board  */
  /* Aggregate everything fed by a board, with per-phase kVA allocation. */
  function boardStats(p, item, kind) {
    var panels = [], i;
    /* a sub-board carries only the circuits sitting on it; everything else
       rolls up through the PDP, which keeps the chain additive */
    if (kind === 'db') panels = panelsOnDb(p, item.id);
    else if (kind === 'pdp') panels = panelsOf(p, item.id);
    else if (kind === 'pdb') {
      /* circuits taking their supply straight off this board, then everything
         fed through its distribution boards */
      panels = panels.concat(panelsOnPdb(p, item.id));
      pdpOfPdb(p, item.id).forEach(function (d) { panels = panels.concat(panelsOf(p, d.id)); });
    } else if (kind === 'tx') {
      pdbOfTx(p, item.id).forEach(function (b) {
        /* the main board's own circuits, then those fed through its
           distribution boards — otherwise the transformer would under-read by
           exactly the load sitting on the boards' incomers */
        panels = panels.concat(panelsOnPdb(p, b.id));
        pdpOfPdb(p, b.id).forEach(function (d) { panels = panels.concat(panelsOf(p, d.id)); });
      });
    }
    var phaseKva = { L1: 0, L2: 0, L3: 0 }, phaseAmp = { L1: 0, L2: 0, L3: 0 };
    var kw = 0, kva = 0, amp = 0, ampSum = 0;
    var sort = panels.slice().sort(function (a, b) { return a.tag < b.tag ? -1 : 1; });
    for (i = 0; i < sort.length; i++) {
      var d = panelDemand(p, sort[i]);
      var ph = phaseSplit(sort[i].phases, phaseKva, d.kva);
      phaseKva.L1 += ph.L1; phaseKva.L2 += ph.L2; phaseKva.L3 += ph.L3;
      var v = voltFor(sort[i].phases, sort[i].volt);
      var a3 = currentFor(d.kva, d.pf, sort[i].phases, v);
      if (String(sort[i].phases) === '1') { phaseAmp[ph.solo] += a3; }
      else { phaseAmp.L1 += a3 / 3; phaseAmp.L2 += a3 / 3; phaseAmp.L3 += a3 / 3; }
      kw += d.kw; kva += d.kva; amp += d.amp; ampSum += Math.max(a3, 0);
    }
    var rating = kind === 'tx' ? null : D.num(item.incomerA, 0);
    var util = rating ? (amp / rating) * 100 : null;
    var tot = phaseKva.L1 + phaseKva.L2 + phaseKva.L3;
    var dev = 0, imax = 0, imin = 0;
    if (tot > 0) {
      imax = Math.max(phaseKva.L1, phaseKva.L2, phaseKva.L3);
      imin = Math.min(phaseKva.L1, phaseKva.L2, phaseKva.L3);
      dev = ((imax - imin) / (tot / 3)) * 100;
    }
    /* ways are a board-and-sub-board concept: a PDP has ways for the circuits on
       it directly, a sub-board for the circuits on it */
    var spareUsed = (kind === 'pdp' || kind === 'db') ? panels.length : 0;
    /* `spare` is spare capacity; `ways` is the enclosure total. They are
       different numbers and conflating them makes a full board look broken. */
    var waysKnown = kind === 'db' ? (item.ways !== undefined && item.ways !== null && item.ways > 0)
                  : kind === 'pdp' ? (item.ways !== undefined && item.ways !== null && item.ways > 0)
                  : false;
    return {
      panels: sort, kw: kw, kva: kva, amp: amp, ampSum: ampSum,
      phaseKva: phaseKva, phaseAmp: phaseAmp,
      rating: rating, util: util, dev: dev, spareUsed: spareUsed,
      spare: kind === 'pdp' ? D.num(item.spareWays, 0) : kind === 'db' ? D.num(item.ways, D.num(item.spareWays, 0)) : 0,
      ways: waysKnown ? D.num(kind === 'db' ? item.ways : item.ways, 0) : null,
      faultKA: faultAt(p, item, kind)
    };
  }
  /* Assign a panel's kVA to phases, landing single-phase loads on the lightest
     phase of the board (this is the balancing rule). Returns {L1,L2,L3,solo} */
  function phaseSplit(phases, acc, kva) {
    var s = String(phases);
    if (s === '1') {
      var mn = 'L1';
      if (acc.L2 < acc[mn] - 0.001) mn = 'L2';
      if (acc.L3 < acc[mn] - 0.001) mn = 'L3';
      var o = { L1: 0, L2: 0, L3: 0 }; o[mn] = kva; o.solo = mn;
      return o;
    }
    if (s === '2') return { L1: kva / 2, L2: kva / 2, L3: 0 };
    return { L1: kva / 3, L2: kva / 3, L3: kva / 3 };
  }

  /* ---------------------------------------------------------------- audit  */
  function audit(p) {
    var out = [], i;
    var add = function (lvl, scope, id, t, d) { out.push({ level: lvl, scope: scope, id: id, title: t, detail: d }); };

    /* board capacity */
    p.pdps.forEach(function (b) {
      var st = boardStats(p, b, 'pdp');
      if (st.util > 100) add('bad', 'pdp', b.id, b.tag + ' overloaded (' + st.util.toFixed(0) + '%)',
        st.amp.toFixed(1) + ' A on a ' + st.rating + ' A incomer. Move a load to a new board or increase the incomer.');
      else if (st.util > 85) add('warn', 'pdp', b.id, b.tag + ' heavily loaded (' + st.util.toFixed(0) + '%)',
        st.amp.toFixed(1) + ' A of ' + st.rating + ' A. Headroom ' + (st.rating - st.amp).toFixed(1) + ' A.');
      if (st.panels.length === 0) add('warn', 'pdp', b.id, b.tag + ' has no outgoing circuits', 'Board has no control panels assigned.');
      /* only judge the enclosure when the way count is actually stated */
      if (st.ways !== null && st.spareUsed > st.ways) add('bad', 'pdp', b.id, b.tag + ' more circuits than ways',
        st.spareUsed + ' circuits on a ' + st.ways + '-way board. The enclosure will not take them.');
      if (st.dev > D.num(p.design.imbalanceBad, 25)) add('bad', 'pdp', b.id, b.tag + ' phase imbalance ' + st.dev.toFixed(0) + '%',
        'L1 ' + st.phaseKva.L1.toFixed(1) + ' kVA · L2 ' + st.phaseKva.L2.toFixed(1) + ' kVA · L3 ' + st.phaseKva.L3.toFixed(1) + ' kVA.');
      else if (st.dev > D.num(p.design.imbalanceWarn, 15)) add('warn', 'pdp', b.id, b.tag + ' phase imbalance ' + st.dev.toFixed(0) + '%',
        'Balance single-phase loads across L1/L2/L3.');
    });

    /* A sub-board is a 125 A or 250 A feeder off a distribution board, treated
       like a machine main control panel: it carries lighting, small power and
       the other small final circuits. More than one on the same PDP is normal —
       a busy distribution board may want a second area — but one each is the
       usual starting point, and spare capacity is worth knowing about. */
    var LOADA = D.DB_LOAD_MAX_A || 63;
    p.dbs.forEach(function (b) {
      var st = boardStats(p, b, 'db');
      if (st.panels.length === 0) add('info', 'db', b.id, b.tag + ' is spare',
        'No circuits assigned yet — worth keeping for future small loads.');
      /* The largest single equipment on a sub-board is a 63 A board. Anything
         bigger belongs directly on the distribution board, both because the
         board will not carry it and because a big feeder on a small board
         makes its protection coordination awkward. Every offending circuit is
         reported, not just the biggest — a designer wants the whole list. */
      var up = (get(p, 'pdp', b.pdpId) || {}).tag || 'the distribution board';
      st.panels.forEach(function (pn) {
        var ba = panelDemand(p, pn).amp;
        if (ba <= LOADA) return;
        add('warn', 'db', b.id, pn.tag + ' at ' + ba.toFixed(0) + ' A is too large for ' + b.tag,
          'The largest equipment fed from a sub-board is ' + LOADA + ' A. Move ' + pn.tag +
          ' to ' + up + ' directly.');
      });
      if (st.util > 100) add('bad', 'db', b.id, b.tag + ' overloaded (' + st.util.toFixed(0) + '%)',
        st.amp.toFixed(1) + ' A on a ' + st.rating + ' A incomer. Move a load to another board or increase the incomer.');
      else if (st.util > 85) add('warn', 'db', b.id, b.tag + ' heavily loaded (' + st.util.toFixed(0) + '%)',
        st.amp.toFixed(1) + ' A of ' + st.rating + ' A. Headroom ' + (st.rating - st.amp).toFixed(1) + ' A.');
      if (st.panels.length === 0) add('info', 'db', b.id, b.tag + ' has no outgoing circuits',
        'Sub-board is spare — worth keeping for growth, but check it is needed.');
      if (st.spareUsed > st.spare) add('warn', 'db', b.id, b.tag + ' more circuits than ways',
        st.spareUsed + ' circuits on a ' + st.spare + '-way board. The enclosure will not take them.');
      if (st.dev > D.num(p.design.imbalanceBad, 25)) add('bad', 'db', b.id, b.tag + ' phase imbalance ' + st.dev.toFixed(0) + '%',
        'L1 ' + st.phaseKva.L1.toFixed(1) + ' kVA · L2 ' + st.phaseKva.L2.toFixed(1) + ' kVA · L3 ' + st.phaseKva.L3.toFixed(1) + ' kVA.');
      else if (st.dev > D.num(p.design.imbalanceWarn, 15)) add('warn', 'db', b.id, b.tag + ' phase imbalance ' + st.dev.toFixed(0) + '%',
        'Balance single-phase loads across L1/L2/L3.');
      if (!b.pdpId) add('warn', 'db', b.id, b.tag + ' not connected to a distribution board', 'Set the upstream PDP in its properties.');
      var cab = cableCheck(p, b, st, 'db');
      if (cab) add(cab.level, 'db', b.id, cab.title, cab.detail);
    });

    /* A distribution board usually gets a sub-board for its lighting and small
       power. Not having one is a choice worth surfacing, not an error — the
       plant may be fed entirely from the board itself. */
    p.pdps.forEach(function (d) {
      if (!dbOfPdp(p, d.id).length) add('info', 'pdp', d.id, d.tag + ' has no sub-board',
        'A distribution board usually carries one for lighting and small power, and you would have use for it later.');
    });

    /* ---------------------------------------------------- protection devices */
    /* Each supply is checked three ways, which are three different failures:
       the device has to interrupt the fault (Icu), it has to carry the load
       without nuisance tripping (Ir), and it has to protect the cable it sits
       on (In vs the cable's ampacity — an oversized device cooks the cable). */
    /* Cable thermal withstand under fault: can the conductor survive until the
       device clears? This is a different failure from the device being set above
       the cable's *continuous* rating, which is an overload question. Here the
       fault current is many times the continuous rating and the only thing that
       matters is how long it lasts. */
    function checkWithstandFinding(p, item, kind, faultKA) {
      var w = checkWithstand(item, faultKA);
      if (!w) return;
      var con = (item.conductor === 'Al' || item.conductor === 'Alu') ? 'aluminium' : 'copper';
      /* how long the conductor can actually carry this fault before it is past
         its limit — the useful number, because it says whether a faster device
         would fix it */
      var survives = w.maxT;
      var what = item.tag + (w.runs > 1 ? ' (' + w.runs + ' runs of ' + w.csa + ' mm²)' : ' (' + w.csa + ' mm²)');
      /* The clearing times above are band-wide, not from curves, and the fault
       level is indicative. So the finding leads with the two numbers and the
       ratio between them and leaves the judgement to the reader, rather than
       asserting a verdict from inputs this crude.

         A supply that survives is not reported at all. Every board here is
         checked, so adding a passing line for each one would bury the failures
         under a hundred rows saying nothing is wrong. The numbers are on the
         properties panel instead, for whoever wants them. */
      var over = w.clearing.t / survives;
      if (over <= 1) return;
      var verdict = over <= 4 ? 'marginal' : 'fails';
      add(over <= 4 ? 'warn' : 'bad', kind, item.id,
        what + ' thermal withstand under fault: ' + verdict,
        'At the calculated ' + w.kA.toFixed(1) + ' kA this ' + w.insul + ' ' + con + ' core reaches its ' +
        'temperature limit after ' + msOrS(survives) + '. The device clears in ' + msOrS(w.clearing.t) +
        ' on its ' + w.clearing.why + (w.runs > 1 ? ', and all ' + w.runs + ' runs see the fault together' : '') +
        '. The device is ' + over.toFixed(over > 20 ? 0 : 1) + '× too slow for this core — a larger core, ' +
            'a lower fault level or a faster device would be needed.' +
        ' Both figures are indicative: the fault level rests on the assumed transformer impedance, and the ' +
        'clearing time is a band rather than a curve. Check against the manufacturer\'s data before sizing on this.');
    }

    function checkProt(p, item, kind, loadA, cableA, faultKA) {
      var d = item.prot;
      if (!d) { add('warn', kind, item.id, item.tag + ' has no protective device',
        'Nothing is interrupting this supply. Use Propose, or enter the device by hand.'); return; }
      var ir = num(d.ir, 0);
      if (ir <= 0) {
        add('warn', kind, item.id, item.tag + ' protection has no rating set', 'Enter the rating the device is set to (Ir).');
      } else if (loadA > 0 && ir < loadA) {
        add('bad', kind, item.id, item.tag + ' protection set below its load',
          'Set to ' + ir + ' A but the supply carries ' + loadA.toFixed(1) + ' A. It will nuisance-trip. Set it at ' +
          suggestIncomer(loadA, 1).toFixed(0) + ' A or above.');
      } else if (loadA > 0 && loadA / ir > 0.9) {
        add('info', kind, item.id, item.tag + ' protection close to its load',
          loadA.toFixed(1) + ' A on a ' + ir + ' A device — ' + (loadA / ir * 100).toFixed(0) + '% of the setting.');
      }
      if (d.kind === 'mccb') {
        var icu = num(d.icu, 0);
        if (faultKA && icu > 0 && icu < faultKA) {
          add('bad', kind, item.id, item.tag + ' breaking capacity below the fault level',
            'Icu ' + icu + ' kA against a calculated ' + faultKA.toFixed(1) +
            ' kA. It would fail to interrupt. Order ' + icuFor(faultKA) + ' kA.');
        } else if (faultKA && icu > 0 && icu < faultKA * 1.15) {
          add('warn', kind, item.id, item.tag + ' breaking capacity marginal',
            'Icu ' + icu + ' kA against a calculated ' + faultKA.toFixed(1) +
            ' kA. The fault level is indicative, so leave margin on it.');
        }
        if (!d.icu) add('info', kind, item.id, item.tag + ' breaking capacity not stated',
          'Nothing says what fault current this device can switch.');
        var fr = num(d.frame, 0), irv = num(d.ir, 0);
        if (fr > 0 && irv > fr) add('bad', kind, item.id, item.tag + ' set above its frame',
          'Ir ' + irv + ' A cannot be set in a ' + fr + ' A frame. The device would be destroyed.');
        if (fr > 0 && irv > 0 && irv < fr * 0.4 && d.trip === 'TM') {
          add('info', kind, item.id, item.tag + ' frame much larger than its setting',
            'Set to ' + irv + ' A in a ' + fr + ' A frame. Legal, but check the frame is the size the switchgear actually offers.');
        }
        if (num(d.trip, 0) >= 0 && d.trip && d.trip !== 'TM' && d.trip !== 'LI' && d.trip !== 'LS' && d.trip !== 'LSI' && d.trip !== 'eLSI') {
          add('info', kind, item.id, item.tag + ' unrecognised trip unit "' + d.trip + '"');
        }
      }
      /* An MCB above the largest that exists is a data-entry error, not a
         design choice — no MCB exists at 250 A whatever the manufacturer. */
      if (d.kind === 'mcb' && ir > D.MCB_MAX_A) {
        add('bad', kind, item.id, item.tag + ' MCB rated above ' + D.MCB_MAX_A + ' A',
          'No MCB exists at ' + ir + ' A. It needs an MCCB, or an MCB assembly with a shunt trip and undervoltage release.');
      }
      if (d.kind === 'mcb' && d.trip && !D.MCB_CURVES[d.trip]) {
        add('info', kind, item.id, item.tag + ' unrecognised MCB curve "' + d.trip + '"');
      }
      /* The device protects the conductor as much as the load. A device set
         well above the cable's ampacity will let the cable reach its thermal
         limit before the device trips. */
      if (cableA && ir > cableA) {
        var ceiling = maxCableA(p, item.cable || {});
        if (ceiling && ir > ceiling) {
          /* Past what parallel copper can carry, a bigger core does not help.
             Saying so is more use than "the cable is too small", which invites
             someone to keep adding runs that will never be enough. */
          add('bad', kind, item.id, item.tag + ' incomer is above what a cable can carry',
            'A ' + ir + ' A device needs a feeder rated ' + ir + ' A. The most ' + D.MAX_CABLE_RUNS +
            ' parallel ' + D.CSA[D.CSA.length - 1] + ' mm² cables give is about ' + Math.round(ceiling) +
            ' A in this installation, so this incomer wants a busbar, not more copper.');
        } else {
          add('bad', kind, item.id, item.tag + ' device too large for its cable',
            'Set to ' + ir + ' A on a cable rated ' + cableA.toFixed(0) +
            ' A. The cable will overheat before the device trips. The device must not exceed the cable rating.');
        }
      } else if (cableA && ir > cableA * 0.95) {
        add('info', kind, item.id, item.tag + ' device only just matched to its cable',
          ir + ' A device on a ' + cableA.toFixed(0) + ' A cable.');
      }
    }

    p.pdbs.forEach(function (b) {
      var st = boardStats(p, b, 'pdb');
      var cab = b.cable && b.cable.csa ? cableRating(b.cable) : null;
      checkProt(p, b, 'pdb', st.amp, cab && cab.derated, st.faultKA);
      checkWithstandFinding(p, b, 'pdb', st.faultKA);
    });
    p.pdps.forEach(function (d) {
      var st = boardStats(p, d, 'pdp');
      var cab = d.cable && d.cable.csa ? cableRating(d.cable) : null;
      checkProt(p, d, 'pdp', st.amp, cab && cab.derated, st.faultKA);
      checkWithstandFinding(p, d, 'pdp', st.faultKA);
    });
    p.dbs.forEach(function (b) {
      var st = boardStats(p, b, 'db');
      var cab = b.cable && b.cable.csa ? cableRating(b.cable) : null;
      checkProt(p, b, 'db', st.amp, cab && cab.derated, st.faultKA);
      checkWithstandFinding(p, b, 'db', st.faultKA);
    });
    p.panels.forEach(function (pn) {
      if (!pn.pdpId && !pn.pdbId) return;
      var d = panelDemand(p, pn);
      var cab = pn.cable && pn.cable.csa ? cableRating(pn.cable) : null;
      var f = faultAt(p, pn, 'panel');
      checkProt(p, pn, 'panel', d.amp, cab && cab.derated, f);
      checkWithstandFinding(p, pn, 'panel', f);
    });

    /* Coordination across a supply chain: the device downstream must be able to
       clear a fault on its own before the one above it starts to. With thermal
       and magnetic devices only, that is a comparison of both ratings — if the
       device below is not materially smaller than the one above, an overload
       upstream clears first. This is a coarse check, not a study: it ignores
       curves, energy classes and let-through. */
    function grade(item, kind) {
      if (!item.prot || !num(item.prot.ir, 0)) return;
      var up = null, upKind = null;
      if (kind === 'pdb') { var tx = get(p, 'tx', item.txId); }
      else if (kind === 'pdp') { up = get(p, 'pdb', item.pdbId); upKind = 'pdb'; }
      else if (kind === 'db') {
        var pdp0 = get(p, 'pdp', item.pdpId);
        up = pdp0 && get(p, 'pdb', pdp0.pdbId); upKind = 'pdb';
      } else {
        var ch = chain(p, item);
        up = item.dbId && get(p, 'db', item.dbId) ? get(p, 'db', item.dbId) : (ch.pdp || ch.pdb);
        upKind = item.dbId ? 'db' : (ch.pdp ? 'pdp' : 'pdb');
      }
      if (!up || !up.prot) return;
      var a = num(up.prot.ir, 0), b = num(item.prot.ir, 0);
      if (!a || !b) return;
      /* Both thermal-magnetic: the one below must be clearly smaller, or an
         overload on the lower board clears the upper device first. */
      if (up.prot.kind === 'mccb' && up.prot.trip === 'TM' && up.prot.trip === item.prot.trip && b / a > 0.75) {
        add('warn', kind, item.id, item.tag + ' not selectively graded against ' + up.tag,
          'Set to ' + b + ' A against ' + a + ' A above it — ' + (b / a * 100).toFixed(0) +
          '% of the upstream setting. On thermal-magnetic devices that is close enough that a fault on this circuit may clear ' +
          'the ' + up.tag + ' device first. Check the curves, or give the upstream device a short-time stage.');
      }
    }
    p.pdps.forEach(function (d) { grade(d, 'pdp'); });
    p.dbs.forEach(function (b) { grade(b, 'db'); });
    p.panels.forEach(function (pn) { if (pn.pdpId || pn.pdbId) grade(pn, 'panel'); });

    p.pdbs.forEach(function (b) {
      var st = boardStats(p, b, 'pdb');
      if (st.util > 100) add('bad', 'pdb', b.id, b.tag + ' main board overloaded (' + st.util.toFixed(0) + '%)',
        st.amp.toFixed(1) + ' A on a ' + st.rating + ' A incomer.');
      else if (st.util > 85) add('warn', 'pdb', b.id, b.tag + ' at ' + st.util.toFixed(0) + '%', '');
      if (!b.txId) add('warn', 'pdb', b.id, b.tag + ' not connected to a transformer', 'Set the upstream TX in its properties.');
      var cab = cableCheck(p, b, st, 'pdb');
      if (cab) add(cab.level, 'pdb', b.id, cab.title, cab.detail);
    });

    p.txs.forEach(function (t) {
      var st = boardStats(p, t, 'tx');
      var cap = D.num(t.kva, 0);
      var util = cap ? (st.kva / cap) * 100 : 0;
      if (util > 100) add('bad', 'tx', t.id, t.tag + ' transformer overloaded (' + util.toFixed(0) + '%)',
        st.kva.toFixed(0) + ' kVA design load on a ' + cap + ' kVA transformer.');
      else if (util > 90) add('warn', 'tx', t.id, t.tag + ' at ' + util.toFixed(0) + '% of rating', st.kva.toFixed(0) + ' kVA of ' + cap + ' kVA.');
      if (t.kva >= 1000 && util < 40) add('info', 'tx', t.id, t.tag + ' under-used (' + util.toFixed(0) + '%)',
        'Consider consolidating onto a smaller transformer or a shared LV board.');
      if (t.kvOut < 0.2) add('warn', 'tx', t.id, t.tag + ' no LV voltage set', 'Enter the LV secondary voltage (e.g. 0.415 kV).');
      if (st.dev > D.num(p.design.imbalanceWarn, 15)) add('warn', 'tx', t.id, t.tag + ' LV phase imbalance ' + st.dev.toFixed(0) + '%', '');
    });

    /* panels: cables, drop, voltage, stand-alone faults */
    p.panels.forEach(function (pn) {
      var d = panelDemand(p, pn);
      /* A circuit is placed if it is fed from anything: a distribution board, a
         sub-board, or a main board directly. */
      if (!pn.pdpId && !pn.pdbId) { add('warn', 'panel', pn.id, pn.tag + ' not assigned to a board', 'Set a grid reference or press Auto-assign.'); return; }
      if (pn.phases === '1' && D.num(pn.volt, 400) < 230) add('info', 'panel', pn.id, pn.tag + ' single phase at ' + pn.volt + ' V', 'Check the phase-to-neutral voltage.');
      if (pn.kw > 90 && String(pn.start) === 'DOL') add('info', 'panel', pn.id, pn.tag + ' large DOL starting load',
        'Confirm the incomer and contactor withstand the starting current and check voltage dip.');
      /* a reserved circuit with no load yet (e.g. a generator connection
         point) is a placeholder, not a missing design decision */
      var placeholder = d.kw <= 0 && d.kva <= 0;
      if (!pn.cable || !pn.cable.csa) {
        if (!placeholder) add('warn', 'panel', pn.id, pn.tag + ' no feeder cable defined', 'Select a cross-section to complete the schedule.');
        else add('info', 'panel', pn.id, pn.tag + ' is a reserved circuit (no load)', 'Feeder size left open until the load is defined.');
        return;
      }
      var r = cableRating(pn.cable);
      if (d.amp > r.derated) add('bad', 'panel', pn.id, pn.tag + ' cable undersized',
        'Load ' + d.amp.toFixed(1) + ' A > ' + r.csa + ' mm² rated ' + r.derated.toFixed(0) + ' A (' + r.method.name + ').');
      else if (d.amp > r.derated * 0.9) add('warn', 'panel', pn.id, pn.tag + ' cable at ' + ((d.amp / r.derated) * 100).toFixed(0) + '% of capacity', '');
      var vd = voltDrop(pn.cable, d.amp, d.pf, pn.phases, pn.volt);
      if (vd.pct > D.num(p.design.vdropLimitLv, 3) + 0.01) add('warn', 'panel', pn.id, pn.tag + ' volt drop ' + vd.pct.toFixed(1) + '%',
        'Limit ' + p.design.vdropLimitLv + '% over ' + vd.len + ' m. Consider ' + (suggestCable(d.amp, vd.len, d.pf, pn.phases, pn.volt, pn.cable.method, p).csa) + ' mm² or a nearer board.');
    });

    /* topology */
    p.pdps.forEach(function (b) { if (!b.pdbId) add('bad', 'pdp', b.id, b.tag + ' orphaned', 'No parent main board selected.'); });
    p.dbs.forEach(function (b) { if (!b.pdpId) add('bad', 'db', b.id, b.tag + ' orphaned', 'No parent distribution board selected.'); });
    /* a panel on a sub-board must also sit on that board's PDP, otherwise the
       two statements about where it is fed from contradict each other */
    p.panels.forEach(function (pn) {
      var b = pn.dbId ? get(p, 'db', pn.dbId) : null;
      if (b && pn.pdpId && b.pdpId && b.pdpId !== pn.pdpId) {
        add('bad', 'panel', pn.id, pn.tag + ' is on ' + b.tag + ' but assigned to a different PDP',
          b.tag + ' is fed from ' + (get(p, 'pdp', b.pdpId) || {}).tag + '. Set one and the other follows.');
      }
    });
    if (!p.panels.length) add('info', '-', '-', 'No control panels yet', 'Add panels from the toolbar or press Sample.');

    var order = { bad: 0, warn: 1, info: 2 };
    out.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return out;
  }

  /* ------------------------------------------------- thermal withstand -----
     How long a cable survives a short circuit, and therefore whether the
     device is fast enough to clear the fault before the conductor melts.

     The adiabatic equation gives the highest current the conductor can carry for
     a given time without its temperature exceeding the insulation limit:

         k = 1 / sqrt(t) / c       with t in seconds and c the material factor
         I²t = k² S² / R20

     Only the ratio matters for a pass/fail comparison, and R20 has already been
     folded into the cross-section term, so the allowable I²t for a core is:

         allowable I²t = (1 / c)² × S² / t_max

     R20 is not tabulated here. It is absorbed into a constant fitted to
     copper, and for aluminium the constant is divided by roughly 0.5 in the
     (1/α)²·R20 product, so aluminium gets its own factor. The comparison is
     therefore indicative in the same way the fault level is: the sign is right,
     the margin is not to be relied on.

     The clearing time compared against is taken from the device's own band,
     not from a fixed reference. A device with no short-time stage genuinely can
     take seconds to clear while one with a short-time stage clears in a
     fraction of a second; using one figure for both would fail the slow device
     on a fault it would in practice survive, and pass the fast one on a fault it
     would not. */
  /* A duration, in whichever unit makes it readable: anything under a second is
     far clearer in milliseconds, and this number is compared against a device's
     clearing time, so sub-second precision is what matters. */
  function msOrS(t) {
    if (!isFinite(t) || t <= 0) return '—';
    if (t >= 1) return t.toFixed(1) + ' s';
    var ms = t * 1000;
    return (ms >= 100 ? ms.toFixed(0) : ms.toFixed(1)) + ' ms';
  }

  /* Allowable I²t for one conductor, from the adiabatic heating relation the
     standards use for fault checking:

         I²t = k² S² / t        I in amps, t in seconds, S in mm²

     k is the material's constant, taken from the conventional values in
     IEC 60364-5-54 Table 43.1:

         XLPE   143      PVC   115

     These are the *initial* adiabatic constants, applying from a cold start to
     the insulation's limiting temperature within its time rating. That is the
     condition the standard sets them for, and it is the one a protection check
     needs: the conductor is at fault temperature, not at its 90 °C operating
     temperature, so no temperature correction is applied here and the result
     should not be compared with a table of "I²t at 70 K rise" values, which are
     measured from a different starting point.

     Aluminium is not handled: the factor of 0.5 applied below is a rough
     approximation and is not accurate enough to size a cable on, so an aluminium
     circuit is reported as not checked rather than checked wrongly. */
  var WITHSTAND_K = { 'XLPE': 143, 'PVC': 115 };

  /* allowable I²t in A²s for a conductor of `csa` mm² over `seconds` */
  function withstandI2t(csa, insul, seconds, conductor) {
    var k = WITHSTAND_K[insul];
    if (!k || !(csa > 0) || !(seconds > 0)) return null;
    var metal = (conductor || 'Cu');
    if (metal !== 'Cu' && metal !== 'copper') return null;   // see above
    return (k * k * csa * csa) / seconds;
  }
  

  /* How long the device takes to clear, in seconds.

     This is what makes the check meaningful, and it is where the accuracy of the
     whole check lives. A fault current far above what the cable can take is
     survivable if the device cuts it quickly, and fatal if it does not.

     The distinction that matters is between a device that trips on the fault
     current *magnitude* and one that waits for the *thermal* element:

       MCB magnetic      the curve's magnetic multiple, so a 63 A device clears
                         a 61 kA fault in single-digit milliseconds. The IEC
                         test value for this is 0.5 s with no manometer fitted,
                         which is an upper bound the test must pass, not a
                         typical operating time — using it as the design figure
                         overstates the clearing time by two orders of magnitude
                         and fails every circuit on the project.
       MCCB magnetic     the same idea with a moulded case and a larger contact
                         structure, so somewhat slower: tens of milliseconds
                         including the arc.
       short-time stage  an electronic LS/Lsi stage set to pick up between the
                         long-time and magnetic settings — a tenth of a second
                         or so, and settable.
       long-time only    an LI unit with no short-time stage has nothing to trip
                         on except the long-time element, which is deliberately
                         slow. On a large fault current it can take seconds.
       fuse              inverse-time, seconds by design.

     Without the manufacturer's curves these are bands, not values, so the result
     is reported as a pass/marginal/fail against the band's own figure and says
     so. The bands are set toward the slow end of their published range, so the
     check errs towards reporting a problem rather than missing one. */
  function clearingTimeS(prot, isFuse) {
    if (isFuse) return { t: 5, band: 'inverse-time', why: 'a fuse is inverse-time by design' };
    if (!prot) return null;
    if (prot.kind === 'mcb') {
      return { t: 0.01, band: 'magnetic', why: 'magnetic trip, typically 2.5–10 ms' };
    }
    switch (prot.trip) {
      case 'TM':    return { t: 0.05, band: 'magnetic',  why: 'magnetic trip, typically 20–50 ms with the arc' };
      case 'LI':    return { t: 5,    band: 'thermal',   why: 'no short-time stage, so the long-time element clears it' };
      case 'LS':    return { t: 0.3,  band: 'short-time', why: 'short-time stage, typically 0.1–0.3 s' };
      case 'LSI':   return { t: 0.3,  band: 'short-time', why: 'short-time stage, typically 0.1–0.3 s' };
      case 'eLSI':  return { t: 0.3,  band: 'short-time', why: 'short-time stage, typically 0.1–0.3 s' };
      default:      return { t: 0.05, band: 'magnetic',  why: 'magnetic trip' };
    }
  }

  /* Does the cable survive the fault this device lets through? */
  function checkWithstand(item, faultKA) {
    var cab = item.cable;
    if (!item.prot || !cab || !cab.csa) return null;
    if (!faultKA || !isFinite(faultKA) || faultKA <= 0) return null;
    var r = cableRating(cab);
    if (!r.ok) return null;
    var ct = clearingTimeS(item.prot, false);
    if (!ct) return null;
    var csa = D.num(cab.csa);
    /* faultKA arrives in kA, which is how the fault level is reported everywhere
       else in the app; the withstand relation works in amps */
    var iFault = D.num(faultKA, 0) * 1000;
    var kA = iFault / 1000;
    /* every parallel run shares the fault — they all see it together */
    var runs = Math.max(1, D.num(cab.runs, 1));
    var allowPer = withstandI2t(csa, r.insul, ct.t, item.conductor);
    if (!allowPer) return null;
    var allowAll = allowPer * runs;
    var actual = iFault * iFault * ct.t;
    var ratio = actual / allowAll;
    /* How long this conductor can actually carry this fault current before it is
       past its limit: t = allowable I²t / I². Note this is *not* the square root
       of the ratio — ratio is (t_clearing / t_allowable)², because both sides
       scale with the same I², so the times compare linearly. */
    var maxT = allowAll / (iFault * iFault);
    return { ratio: ratio, csa: csa, runs: runs, insul: r.insul, kA: kA,
             clearing: ct, allow: allowAll, actual: actual, maxT: maxT, conductor: item.conductor };
  }

  function cableCheck(p, b, st, kind) {
    if (!b.cable || !b.cable.csa) return { level: 'warn', title: b.tag + ' supply cable not specified', detail: 'Enter the TX → board cross-section.' };
    var r = cableRating(b.cable);
    if (st.amp > r.derated) return { level: 'bad', title: b.tag + ' supply cable undersized', detail: st.amp.toFixed(1) + ' A > ' + r.derated.toFixed(0) + ' A rated.' };
    var vd = voltDrop(b.cable, st.amp, 0.9, b.phases, 400);
    if (vd.pct > D.num(p.design.vdropLimitLv, 3) + 0.01) return { level: 'warn', title: b.tag + ' volt drop ' + vd.pct.toFixed(1) + '%', detail: 'Consider a larger core or shorter route.' };
    return null;
  }

  /* ======================================================== AUTO-ASSIGNMENT */
  /* Find the best PDP for a panel: nearest upstream chain with the most
     headroom. 'balance' spreads load; 'pack' fills the nearest board.        */
  /* Score every board for this load: headroom first, then how close it is,
     then whether a spare way is left. Crossing a transformer boundary is
     penalised so it only happens when it is clearly the better answer. */
  function choosePdp(p, panel, opts) {
    opts = opts || {};
    if (!p.pdps.length) return null;
    var add = panelDemand(p, panel).amp;
    var myTx = null;
    var c0 = chain(p, panel);
    if (c0.tx) myTx = c0.tx.id;
    if (!myTx) {
      var bd = Infinity;
      p.txs.forEach(function (t) {
        var d = t.pos && panel.pos ? Math.hypot(t.pos.x - panel.pos.x, t.pos.y - panel.pos.y) : 0;
        if (d < bd) { bd = d; myTx = t.id; }
      });
    }
    var mode = opts.mode || 'balance';
    /* A big circuit is worth chasing headroom for; a small one is better off
       on the nearest board, so the run length matters more the lighter the
       load. Weighting distance this way keeps short feeders for small loads
       without letting a 3 kW outlet chase a free board across the site. */
    var distW = 1.6 * clamp(30 / Math.max(add, 5), 1, 4);
    var candidates = p.pdps.map(function (d) {
      var st = boardStats(p, d, 'pdp');
      var utilAfter = st.rating ? ((st.amp + add) / st.rating) * 100 : 0;
      var d2 = d.pos && panel.pos ? Math.hypot(d.pos.x - panel.pos.x, d.pos.y - panel.pos.y) : 0;
      var pdb = get(p, 'pdb', d.pdbId);
      var crosses = !!(pdb && myTx && pdb.txId && pdb.txId !== myTx);
      var score;
      if (utilAfter > 100) {
        /* full: rank purely on how close it is, so the new board that gets
           created lands on the same side of the site as the load */
        score = 1000 + (utilAfter - 100) + d2 * distW;
      } else {
        if (mode === 'pack') score = utilAfter * 0.75;
        else score = utilAfter * 1.5;                                 // prefer the lightest board
        score += (num(d.spareWays, 0) <= 0) ? 60 : 0;                // no ways left on the board
        score += d2 * distW;                                          // keep the run short
        score += crosses ? 25 : 0;                                    // don't cross a TX lightly
        /* A distribution board's spare ways are for circuits that land on it
           directly. Counting the ones its sub-board carries here would make a
           board look full because its lighting board is well used, which is
           exactly backwards — those circuits cannot be moved to another board
           without taking the sub-board with them. */
        var onBoard = p.panels.filter(function (pn) { return pn.pdpId === d.id && !pn.dbId; }).length;
        score += (onBoard >= num(d.spareWays, 0)) ? 60 : 0;
      }
      return { pdp: d, score: score, utilAfter: utilAfter, dist: d2, crosses: crosses, st: st };
    });
    candidates.sort(function (a, b) { return a.score - b.score; });
    var best = candidates[0];
    if (best.utilAfter > 100) return { pdp: null, candidates: candidates, reason: 'full' };
    return { pdp: best.pdp, candidates: candidates, reason: 'ok' };
  }

  /* The heart of it: place / re-place a panel. If the best board has no
     headroom, a NEW PDP is created beside its parent at the next practical
     grid reference and the panel goes there.

     A circuit fed straight from a main board is left alone. Somebody put it
     there on purpose — it is a piece of plant with its own feeder panel — and
     dragging it onto a distribution board would be the tool second-guessing
     the design.                                                     */
  function assignPanel(p, panel, opts) {
    opts = opts || {};
    if (panel.pdbId && !panel.pdpId) {
      return { created: null, moved: false, from: null, to: panel.pdbId, reason: 'main-board' };
    }
    var log = { created: null, moved: false, from: panel.pdpId, to: null, reason: '' };
    var res = choosePdp(p, panel, opts);
    if (!res) { log.reason = 'no-pdp'; return log; }
    if (res.reason === 'full' || !res.pdp) {
      /* every candidate is full → build a new board beside the best-placed
         one (candidates are already sorted: nearest, then least loaded), so
         the new board lands on the same side of the site as the load */
      var anchorPdp = (res.candidates && res.candidates.length) ? res.candidates[0].pdp : null;
      var newBoard = createPdpFor(p, panel, anchorPdp, opts);
      log.created = newBoard;
      log.to = newBoard.id;
      log.moved = true;
      log.reason = 'created';
      panel.pdpId = newBoard.id;
      panel.dbId = null;
      sizeCablesFor(p, newBoard);
      sizeCableForPanel(p, panel);
      return log;
    }
    log.to = res.pdp.id;
    log.moved = panel.pdpId !== res.pdp.id;
    if (log.moved) log.reason = 'rebalanced';
    panel.pdpId = res.pdp.id;
    /* auto-assignment lands the circuit on the PDP itself. A sub-board is a
       deliberate placement decision, so it is cleared here — otherwise a
       circuit moved to another board would stay pointing at a sub-board that
       is on the old one. */
    if (panel.dbId) panel.dbId = null;
    sizeCableForPanel(p, panel);
    return log;
  }

  function createPdpFor(p, panel, anchorPdp, opts) {
    /* Anchor the new board next to the distribution board closest to the
       load, and hang it off the same main board — a new board appearing on
       the far side of the site is not a practical answer. */
    var parent = anchorPdp;
    if (parent && parent.pos && panel.pos) {
      var nearest = null, nd = Infinity;
      pdpOfPdb(p, parent.pdbId).forEach(function (d) {
        if (!d.pos) return;
        var dd = (d.pos.x - panel.pos.x) * (d.pos.x - panel.pos.x) + (d.pos.y - panel.pos.y) * (d.pos.y - panel.pos.y);
        if (dd < nd) { nd = dd; nearest = d; }
      });
      if (nearest) parent = nearest;
    }
    if (!parent) parent = p.pdps[0];
    if (!parent) return null;
    var pdb = get(p, 'pdb', parent.pdbId);
    if (!pdb) return null;
    var st = boardStats(p, parent, 'pdp');
    var panelAmp = panelDemand(p, panel).amp;
    var carry = st.amp + panelAmp;
    var need = Math.max(160, suggestIncomer(carry, D.num(p.design.spreadMargin, 1.25)));
    var siblings = pdpOfPdb(p, pdb.id);
    var pos = nextPracticalPos(p, { anchor: parent.pos, offset: num((opts && opts.offset) || 2, 2), w: D.SHAPE.pdp.w, h: D.SHAPE.pdp.h, clear: num((opts && opts.clear) || 1.5, 1.5) });
    var pdp = D.newPdp({
      tag: 'PDP',                       // placeholder; applyNumbering sets the real one
      name: 'New distribution board ' + (siblings.length + 1),
      pdbId: pdb.id, incomerA: need, spareWays: 4, pos: pos
    });
    pdp.cable = { csa: null, runs: 1, cores: 4, len: dist(parent.pos, pos), method: parent.cable ? parent.cable.method : 'XL-A1', group: 3, ambient: 40, sheathed: true };
    p.pdps.push(pdp);
    return pdp;
  }
  function uniqueTag(base, p, kind) {
    var taken = {};
    p[kind === 'pdp' ? 'pdps' : kind === 'pdb' ? 'pdbs' : kind === 'tx' ? 'txs' : 'panels'].forEach(function (o) { taken[o.tag] = 1; });
    if (!taken[base]) return base;
    for (var i = 2; i < 200; i++) { if (!taken[base + '-' + i]) return base + '-' + i; }
    return base + '-' + Date.now();
  }
  function dist(a, b) { if (!a || !b) return 0; return D.r1(Math.hypot(a.x - b.x, a.y - b.y)); }

  /* Feeder route length taken from the drawn geometry: the straight-line
     distance from the upstream board, with a 20% allowance for the route. */
  function feederLen(p, item) {
    if (!item || !item.pos) return 0;
    var parent = null, kind = item.__kind || kindOf(item);
    if (kind === 'panel') parent = (item.dbId && get(p, 'db', item.dbId)) || get(p, 'pdp', item.pdpId);
    else if (kind === 'db') parent = get(p, 'pdp', item.pdpId);
    else if (kind === 'pdp') parent = get(p, 'pdb', item.pdbId);
    else if (kind === 'pdb') parent = get(p, 'tx', item.txId);
    if (!parent || !parent.pos) return 0;
    return D.r1(Math.hypot(parent.pos.x - item.pos.x, parent.pos.y - item.pos.y) * 1.2 + 1);
  }
  function syncLen(p, item) {
    if (!item || !item.cable) return;
    var L = feederLen(p, item);
    if (L > 0) item.cable.len = L;
  }
  /* What a feeder has to carry.

     Not the present load. A cable runs behind the protective device, and the
     device is rated above the load with margin, so a cable sized on the load
     alone is always smaller than the device protecting it — the conductor then
     reaches its thermal limit before the device trips. Sizing on the device
     where one is set, and on the load where one is not, keeps the two
     consistent whichever way round the work is done. */
  function feederAmp(p, item, loadA, boardRating) {
    var need = num(loadA, 0);
    if (item.prot) need = Math.max(need, num(item.prot.ir, 0));
    if (boardRating) need = Math.max(need, num(boardRating, 0));
    return need;
  }
  /* Does this feeder need sizing? True when it is blank, and also when it is
     too small for what it now has to carry — a cable chosen before the device
     was set is undersized the moment a device lands on it, and leaving it would
     mean every one of them reads as an error. Sizing it is the fix, not a
     redefinition of the design. */
  function needsSizing(cable, amp) {
    if (!cable) return false;
    if (!cable.csa) return amp > 0;
    if (amp <= 0) return false;
    var r = cableRating(cable);
    return !(r.derated && r.derated >= amp);
  }
  /* Fill in a blank feeder for a control panel */
  function sizeCableForPanel(p, panel) {
    var st = panelDemand(p, panel);
    var amp = feederAmp(p, panel, st.amp, 0);
    if (needsSizing(panel.cable, amp)) {
      syncLen(p, panel);
      var L = D.num(panel.cable.len, 0) || 12;
      var s = suggestCable(amp, L, st.pf, panel.phases, panel.volt, panel.cable.method, p);
      panel.cable.csa = s.csa; panel.cable.runs = s.runs;
    }
  }
  /* Pick feeder lengths/cross-sections for anything still empty */
  function sizeCablesFor(p, pdp) {
    var st = boardStats(p, pdp, 'pdp');
    var amp = feederAmp(p, pdp, st.amp, 0);
    if (needsSizing(pdp.cable, amp)) {
      syncLen(p, pdp);
      var L = D.num(pdp.cable.len, 0) || 5;
      var s = suggestCable(amp, L, 0.9, pdp.phases, 400, pdp.cable.method, p);
      pdp.cable.csa = s.csa; pdp.cable.runs = s.runs;
    }
  }
  function sizeCablesForPdb(p, pdb) {
    var st = boardStats(p, pdb, 'pdb');
    var amp = feederAmp(p, pdb, st.amp, 0);
    if (needsSizing(pdb.cable, amp)) {
      syncLen(p, pdb);
      var L = D.num(pdb.cable.len, 0) || 6;
      var s = suggestCable(amp, L, 0.9, pdb.phases, 400, pdb.cable.method, p);
      pdb.cable.csa = s.csa; pdb.cable.runs = s.runs;
    }
  }
  function sizeCablesForDb(p, db) {
    var st = boardStats(p, db, 'db');
    /* The feeder must serve the board at its rating, not at its present
       load: a board at 20% now will be full eventually, and the cable is
       sized for the board, not for the circuits currently on it. */
    var amp = feederAmp(p, db, st.amp, D.num(db.incomerA, 63));
    if (needsSizing(db.cable, amp)) {
      syncLen(p, db);
      var L = D.num(db.cable.len, 0) || 6;
      var s = suggestCable(amp, L, 0.9, db.phases, 400, db.cable.method, p);
      db.cable.csa = s.csa; db.cable.runs = s.runs;
    }
  }
  /* A brand-new sub-board carries nothing, so there is no load to size a
     feeder from. Propose one for the incomer rating instead: it has to be big
     enough to feed the board at its rating, which is what the cable is there
     for. Blank is arguably honest, but an unsized feeder on a board the user
     has just created is a warning they did not ask for. */
  function suggestDbFeeder(p, db) {
    if (!db || !db.cable || db.cable.csa) return;
    var amp = D.num(db.incomerA, 125) * D.num(p.design.designMargin, 1.15);
    syncLen(p, db);
    var L = D.num(db.cable.len, 0) || 6;
    var s = suggestCable(amp, L, 0.9, db.phases, 400, db.cable.method, p);
    db.cable.csa = s.csa; db.cable.runs = s.runs;
  }

  /* --------------------------------------------------- plan grid-reference  */
  /* "Next practical grid reference": spiral outward on the offset ring
     (N, NE, E, SE, S, SW, W, NW) to the first position that is inside the
     site, clear of every other footprint by the clearance distance, and on a
     whole grid step. */
  function nextPracticalPos(p, o) {
    var step = D.num(o.step, 0.5) || 0.5;
    var off  = Math.max(step, D.num(o.offset, 2));
    var clr  = D.num(o.clear, 1.5);
    var a = o.anchor || { x: p.site.w / 2, y: p.site.h / 2 };
    var w = o.w || 2, h = o.h || 1.6;
    var dirs = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
    var all = allItems(p);
    function clash(x, y) {
      if (x - w / 2 - clr / 2 < 0 || y - h / 2 - clr / 2 < 0) return true;
      if (x + w / 2 + clr / 2 > p.site.w || y + h / 2 + clr / 2 > p.site.h) return true;
      for (var i = 0; i < all.length; i++) {
        var o2 = all[i];
        if (o2 === o.exclude) continue;
        var s = D.SHAPE[o2.__kind || kindOf(o2)];
        if (!o2.pos) continue;
        if (Math.abs(x - o2.pos.x) < (w + s.w) / 2 + clr && Math.abs(y - o2.pos.y) < (h + s.h) / 2 + clr) return true;
      }
      return false;
    }
    /* 1. walk outward on the snap grid in the eight practical directions,
          so new boards appear in a tidy ring around their parent            */
    var rings = Math.ceil(Math.max(p.site.w, p.site.h) / off) + 1;
    for (var r = 0; r <= rings; r++) {
      var rad = r === 0 ? 0 : r * off;
      for (var d = 0; d < dirs.length; d++) {
        var x = D.snapTo(a.x + dirs[d][0] * rad, step);
        var y = D.snapTo(a.y + dirs[d][1] * rad, step);
        if (!clash(x, y)) return { x: D.r2(x), y: D.r2(y) };
      }
    }
    /* 2. the ring search can run out of room on a crowded site: fall back to
          the nearest free cell on the whole grid, by true distance           */
    var best = null, bestD = Infinity;
    for (var gx = 0; gx <= p.site.w + 1e-9; gx += step) {
      for (var gy = 0; gy <= p.site.h + 1e-9; gy += step) {
        if (clash(gx, gy)) continue;
        var dd = (gx - a.x) * (gx - a.x) + (gy - a.y) * (gy - a.y);
        if (dd < bestD) { bestD = dd; best = { x: D.r2(gx), y: D.r2(gy) }; }
      }
    }
    if (best) return best;
    return { x: D.r2(a.x + off), y: D.r2(a.y) };
  }
  function kindOf(o) {
    if (!o) return 'panel';
    if (o.kva !== undefined && o.kvOut !== undefined) return 'tx';
    if (o.txId !== undefined) return 'pdb';
    if (o.pdbId !== undefined) return 'pdp';
    if (o.pdpId !== undefined) return 'db';
    return 'panel';
  }
  function allItems(p) {
    var out = [];
    p.txs.forEach(function (o)   { o.__kind = 'tx'; out.push(o); });
    p.pdbs.forEach(function (o)  { o.__kind = 'pdb'; out.push(o); });
    p.pdps.forEach(function (o)  { o.__kind = 'pdp'; out.push(o); });
    (p.dbs || []).forEach(function (o) { o.__kind = 'db'; out.push(o); });
    p.panels.forEach(function (o){ o.__kind = 'panel'; out.push(o); });
    return out;
  }

  /* ======================================================================
     UNDERLAY (raster image or DXF) placed behind the electrical items

     A DXF is drawn in its own drawing units (usually millimetres). The
     underlay carries a metres-per-unit scale and an offset in site metres,
     so every drawing coordinate maps to a site grid reference. That mapping
     is what makes "E22.0 N14.0" mean the same thing on the plan as it does
     in the CAD file.
     ==================================================================== */
  function underlayOf(p) { return p.underlay || null; }

  function underlayFit(p) {
    var u = underlayOf(p);
    if (!u || !u.geo) return null;
    var s = u.scale;
    return {
      geoToSiteX: function (x) { return u.ox + x * s; },
      geoToSiteY: function (y) { return u.oy + y * s; }
    };
  }
  /* site metres back to drawing units — used by the coordinate read-out so
     the engineer can read a position off the CAD file as well */
  function underlayInverse(p) {
    var u = underlayOf(p);
    if (!u || !u.geo || !u.scale) return null;
    return {
      siteToGeoX: function (x) { return (x - u.ox) / u.scale; },
      siteToGeoY: function (y) { return (y - u.oy) / u.scale; }
    };
  }

  /* Scale and centre an underlay over the site, leaving a small margin. */
  function underlayAutoFit(p, u) {
    u = u || underlayOf(p);
    if (!u || !u.geo || !u.geo.width || !u.geo.height) return;
    var margin = 0.04;                      // 4% breathing room each side
    var availW = p.site.w * (1 - margin * 2);
    var availH = p.site.h * (1 - margin * 2);
    /* fit the larger of width/height: never distort the aspect ratio */
    var s = Math.min(availW / u.geo.width, availH / u.geo.height);
    u.scale = s;
    u.ox = (p.site.w - u.geo.width * s) / 2 - u.geo.minX * s;
    u.oy = (p.site.h - u.geo.height * s) / 2 - u.geo.minY * s;
  }

  /* the site's grid extent, expressed in drawing units — this is the number
     an engineer needs to check that a board really sits on a grid reference */
  function underlaySiteInGeo(p, u) {
    u = u || underlayOf(p);
    if (!u || !u.scale) return null;
    return {
      x0: (0 - u.ox) / u.scale, y0: (0 - u.oy) / u.scale,
      x1: (p.site.w - u.ox) / u.scale, y1: (p.site.h - u.oy) / u.scale
    };
  }

  /* Snap a dragged item to the grid and, if that cell is taken, walk to the
     next practical reference instead of stacking boards. */
  function resolveDrop(p, item, x, y, opts) {
    opts = opts || {};
    var kind = item.__kind || kindOf(item);
    var s = D.SHAPE[kind] || D.SHAPE.pdp;
    var step = num(opts.snap, 1) || 1;
    var off = num(opts.offset, 2);
    var clr = num(opts.clear, 1.5);
    var snap = { x: D.snapTo(x, step), y: D.snapTo(y, step) };
    var probe = Object.assign({}, item, { pos: snap, __kind: kind });
    var all = allItems(p);
    var hit = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i] === item) continue;
      var os = D.SHAPE[all[i].__kind];
      if (!all[i].pos) continue;
      if (Math.abs(snap.x - all[i].pos.x) < (s.w + os.w) / 2 + clr / 2 &&
          Math.abs(snap.y - all[i].pos.y) < (s.h + os.h) / 2 + clr / 2) { hit = all[i]; break; }
    }
    if (!hit) return { pos: snap, moved: true };
    var np = nextPracticalPos(p, { anchor: snap, offset: off, clear: clr, w: s.w, h: s.h, step: step, exclude: item });
    return { pos: np, moved: true, bumped: hit };
  }

  /* -------------------------------------------------------- auto-balance   */
  /* Level board loading with best-improvement moves. Boards are only ever
     compared with boards on the same main board (PDB) unless crossPdb is set
     — moving a circuit between transformers or main boards changes the
     supply topology, which has to be a deliberate act.                       */
  function autoBalance(p, opts) {
    opts = opts || {};
    var moves = [];
    /* Circuits sitting on a sub-board move with the sub-board, not on their
       own — they cannot be separated from it. Only circuits sitting directly
       on a PDP are candidates for individual moves. */
    var boards = p.pdps.filter(function (d) {
      if (!d.pdbId) return false;
      if (opts.pdbId && d.pdbId !== opts.pdbId) return false;
      return true;
    });
    var groups = {};
    boards.forEach(function (d) { var k = opts.crossPdb ? '*' : d.pdbId; (groups[k] = groups[k] || []).push(d); });
    Object.keys(groups).forEach(function (k) {
      levelGroup(p, groups[k].map(function (d) { return d.id; }), opts, moves);
    });
    /* Split anything still over capacity. A sub-board and the circuits on it
       move as one unit, so the heaviest single circuit is only a candidate
       when it sits directly on the board being relieved. */
    p.pdps.forEach(function (d) {
      var st = boardStats(p, d, 'pdp');
      if (st.util <= 100) return;
      var loose = st.panels.filter(function (pn) { return !pn.dbId; });
      var worst = loose.slice().sort(function (a, b) { return panelDemand(p, b).amp - panelDemand(p, a).amp; })[0];
      if (worst) {
        var log = assignPanel(p, worst, opts);
        if (log.created) moves.push({ panel: worst.tag, from: d.tag, to: log.created.tag, kva: panelDemand(p, worst).kva });
        return;
      }
      /* everything here hangs off a sub-board: move the heaviest sub-board */
      var subs = dbOfPdp(p, d.id).filter(function (b) { return boardStats(p, b, 'db').amp > 0; });
      subs.sort(function (x, y) { return boardStats(p, y, 'db').amp - boardStats(p, x, 'db').amp; });
      if (subs.length) moves.push(subBoardMove(p, subs[0], opts));
    });
    sizeAll(p);
    return moves;
  }
  /* Move a whole sub-board, with everything on it, to another PDP. */
  function subBoardMove(p, db, opts) {
    var st = boardStats(p, db, 'db');
    var res = choosePdp(p, { pos: db.pos, pdpId: db.pdpId, kw: st.kw, kva: st.kva, pf: 0.9, phases: db.phases, volt: 400 }, opts);
    if (!res || res.reason === 'full' || !res.pdp) return null;
    db.pdpId = res.pdp.id;
    st.panels.forEach(function (pn) { pn.pdpId = res.pdp.id; });
    sizeCablesForDb(p, db);
    return { panel: db.tag, from: opts._from || '', to: res.pdp.tag, kva: st.kva };
  }
  function levelGroup(p, ids, opts, moves) {
    var tol = num(opts.tolerance, 12), guard = 0;
    var util = {}, i;
    function refresh() {
      util = {};
      ids.forEach(function (id) { var st = boardStats(p, get(p, 'pdp', id), 'pdp'); util[id] = st.util; });
    }
    function spread() {
      var v = ids.map(function (id) { return util[id]; });
      return Math.max.apply(null, v) - Math.min.apply(null, v);
    }
    while (guard++ < 60) {
      refresh();
      if (ids.length < 2 || spread() <= tol) break;
      var cur = spread(), best = null;
      for (var a = 0; a < ids.length; a++) {
        var src = get(p, 'pdp', ids[a]);
        var stSrc = boardStats(p, src, 'pdp');
        if (!stSrc.rating) continue;
        /* only circuits sitting directly on the board — a circuit on a sub-board
           cannot be moved on its own without taking the board with it */
        var cands = stSrc.panels.filter(function (pn) { return !pn.dbId; })
          .sort(function (x, y) { return panelDemand(p, y).amp - panelDemand(p, x).amp; });
        for (var c = 0; c < cands.length; c++) {
          var pn = cands[c], da = panelDemand(p, pn);
          if (!pn.cable) continue;
          if (da.amp < stSrc.rating * 0.04) continue;          // ignore trivial circuits
          var oldLen = num(pn.cable.len, 0);
          for (var b = 0; b < ids.length; b++) {
            if (a === b) continue;
            var dst = get(p, 'pdp', ids[b]);
            if (!dst || !dst.pos || !pn.pos) continue;
            var uA = util[src.id] - (da.amp / stSrc.rating) * 100;
            var uB = util[dst.id] + (da.amp / boardStats(p, dst, 'pdp').rating) * 100;
            if (uB > 100) continue;
            /* do not stretch a feeder across the site to save a few amps */
            var newLen = dist(dst.pos, pn.pos);
            if (!opts.allowLongRuns && newLen > oldLen * 1.5 + 5) continue;
            /* new spread, measured over the whole group */
            var trial = [], g;
            for (g = 0; g < ids.length; g++) {
              if (ids[g] === src.id) trial.push(uA);
              else if (ids[g] === dst.id) trial.push(uB);
              else trial.push(util[ids[g]]);
            }
            var ns = Math.max.apply(null, trial) - Math.min.apply(null, trial);
            if (ns >= cur - 0.5) continue;                    // no real improvement
            if (!best || ns < best.ns) best = { panel: pn, from: src, to: dst, ns: ns, newLen: newLen, kva: da.kva };
          }
        }
      }
      if (!best) break;
      best.panel.pdpId = best.to.id;
      best.panel.dbId = null;              // moved off any sub-board onto the PDP itself
      if (!opts.keepLen) best.panel.cable.len = best.newLen;
      moves.push({ panel: best.panel.tag, from: best.from.tag, to: best.to.tag, kva: best.kva });
    }
  }
  function sizeAll(p) {
    p.pdbs.forEach(function (b) { sizeCablesForPdb(p, b); });
    p.pdps.forEach(function (d) { sizeCablesFor(p, d); });
    p.dbs.forEach(function (b) { sizeCablesForDb(p, b); });
    p.panels.forEach(function (n) { sizeCableForPanel(p, n); });
  }

  /* ------------------------------------------------------------- totals    */
  function totals(p) {
    var kw = 0, kva = 0, amp = 0, panels = 0;
    var phases = { L1: 0, L2: 0, L3: 0 };
    p.panels.forEach(function (pn) {
      /* placed means it is fed from something — a distribution board, a
         sub-board, or a main board directly */
      if (!pn.pdpId && !pn.pdbId) return;
      var d = panelDemand(p, pn);
      kw += d.kw; kva += d.kva; amp += d.amp; panels++;
      var ph = phaseSplit(pn.phases, phases, d.kva);
      phases.L1 += ph.L1; phases.L2 += ph.L2; phases.L3 += ph.L3;
    });
    var txKva = p.txs.reduce(function (a, t) { return a + D.num(t.kva, 0); }, 0);
    return {
      kw: kw, kva: kva, amp: amp, panels: panels, txKva: txKva,
      txUtil: txKva ? (kva / txKva) * 100 : 0,
      unassigned: p.panels.filter(function (x) { return !x.pdpId && !x.pdbId; }).length,
      phases: phases,
      dev: (function () { var t = phases.L1 + phases.L2 + phases.L3; if (!t) return 0;
        return ((Math.max(phases.L1, phases.L2, phases.L3) - Math.min(phases.L1, phases.L2, phases.L3)) / (t / 3)) * 100; })()
    };
  }
  /* every board's worst case imbalance for the badge counts */
  function boardList(p) {
    var rows = [];
    p.dbs.forEach(function (b)   { rows.push({ kind: 'db',   o: b, st: boardStats(p, b, 'db') }); });
    p.pdps.forEach(function (d)  { rows.push({ kind: 'pdp',  o: d, st: boardStats(p, d, 'pdp') }); });
    p.pdbs.forEach(function (b)  { rows.push({ kind: 'pdb',  o: b, st: boardStats(p, b, 'pdb') }); });
    p.txs.forEach(function (t)   { rows.push({ kind: 'tx',   o: t, st: boardStats(p, t, 'tx'), kva: D.num(t.kva, 0) }); });
    return rows;
  }

  return {
    index, byId, get, pdbOfTx, pdpOfPdb, dbOfPdp, panelsOf, panelsOnDb, panelsOnPdb,
    chain, parentOf, kindOf, allItems,
    panelDemand, currentFor, voltFor, cableRating, cableImpedance, voltDrop, suggestCable, suggestIncomer, maxCableA,
    txFaultKA, faultAt, boardStats, phaseSplit, audit, cableCheck,
    mccbFrameFor, icuFor, mcbRatingFor, tripFor, deviceRatingFor, proposeProt, applyProt, protAll, hasDownstream,
    withstandI2t, clearingTimeS, checkWithstand, msOrS, WITHSTAND_K,
    choosePdp, assignPanel, createPdpFor, feederLen, syncLen,
    sizeCablesFor, sizeCablesForPdb, sizeCablesForDb, suggestDbFeeder, sizeCableForPanel, sizeAll, feederAmp, needsSizing,
    nextPracticalPos, resolveDrop, autoBalance, totals, boardList, dist, uniqueTag,
    underlayOf, underlayFit, underlayInverse, underlayAutoFit, underlaySiteInGeo,
    PREFIX, computedTag, applyNumbering, numberingIssues
  };
})();
