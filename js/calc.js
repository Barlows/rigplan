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
    var kvaD = kva * dem;
    /* kVA below kW is a power factor above 1, which does not exist. It
       happens when a kVA override is typed in that is smaller than the load
       it is meant to contain, and it propagates: summed over a board it makes
       the aggregate power factor nonsense too. Flagged rather than silently
       corrected, because the entered number is probably a typo worth seeing. */
    /* A kVA below its kW is a power factor above 1, which does not exist — but
       the two figures must be on the SAME basis before that means anything.

       kvaD is the diversified kVA and kw is the connected kW, so any demand
       factor below 1 makes the diversified figure the smaller one and the check
       fires on every circuit whose demand is not 1. It fired on 78 of 97 here,
       every one of them false: a 44.8 kW circuit at 0.5 demand is 23.6 kVA and
       44.8 kW, which is an ordinary machine and not a power factor of 1.9.

       So the impossibility test is against the CONNECTED kVA, which is like for
       like. A genuine data error — a kVA override smaller than the kW it is
       meant to contain — still trips, and that is the case worth catching. */
    var impossible = kva > 0 && kva < kw;
    /* Reactive power falls out of kW, kVA and power factor by the
       Pythagorean relation, so nothing needs storing: S² = P² + Q². This is the
       number that decides whether a supply is penalised for a poor power
       factor, and it is the number a capacitor calculation works from.

       Computed on the connected figures, where S and P share a basis, then
       scaled by the demand factor — the right way round, because demand scales
       the whole load rather than one term of it. */
    var kvar = Math.sqrt(Math.max(0, kva * kva - kw * kw));
    var kvarD = kvar * dem;
    if (impossible) { kvar = 0; kvarD = 0; }
    /* Total demand distortion, as a percentage of the fundamental. A circuit
       that declares harmonics raises its own RMS current, which is what actually
       heats a cable — the fundamental alone understates it.

       A declared THD wins. Failing that, a declared non-linear load type supplies
       its own typical figure: a six-pulse drive distorts by around 35% whether or
       not anyone measured it, and derating its feeder on that is more correct than
       treating it as a clean load. Left null when neither is declared, because
       assuming harmonic content for every motor would derate every cable. */
    var thd = D.defaultThd(pn);
    thd = thd === null || thd === undefined ? null : D.clamp(D.num(thd, 0), 0, 100);
    /* RMS current with harmonics present: the fundamental plus every harmonic
       in quadrature, which for a stated total THD is sqrt(1 + (THD/100)²) times
       the fundamental. */
    var harmF = thd === null ? 1 : Math.sqrt(1 + Math.pow(thd / 100, 2));
    return {
      kw: kw,
      kvaConn: kva,
      kva: kvaD,                       // design / diversified kVA
      kvar: kvarD,
      pf: pf, demand: dem, thd: thd, impossible: impossible,
      /* Whether this THD is measured or the load type's typical figure, because a
         schedule should not present a typical as a measurement. */
      thdAssumed: thd !== null && (pn.thd === null || pn.thd === undefined || pn.thd === ''),
      /* The third harmonic specifically, as a percentage of the fundamental — the
         part that reaches a neutral. Zero for a drive; high for a single-phase
         switch-mode supply. */
      triplen: thd === null ? null : thd * D.triplenFractionOf(pn),
      /* CONNECTED current — what the machine draws when it runs.

         Distinct from amp below because a demand factor is a statement about how
         many machines run at once, not a derating of any one of them. A 13.8 kW
         circuit at a demand of 0.45 contributes 9.5 A to the board, but the motor
         on it draws its full 21 A every time it starts, and anything that asks
         about the MACHINE — its starting current, its overload relay setting,
         whether it will trip the board above — has to ask about the 21 A.

         Using the diversified figure for those questions understated every motor
         by its demand factor. The overload class check on this project reported a
         30 A device taking 349 seconds at "six times the motor current"; the
         six was six times 9.5 A rather than six times 21 A, so it was not asking
         the question it thought it was. */
      ampConn: currentFor(kva, pf, pn.phases, pn.volt),
      amp: currentFor(kvaD, pf, pn.phases, pn.volt),
      /* what actually flows in the cable */
      ampHarm: currentFor(kvaD, pf, pn.phases, pn.volt) * harmF,
      harmFactor: harmF,
      phases: pn.phases
    };
  }

  /* The power factor a board sees, and the reactive power that arrives at it.

     Summing kW and kVA gives the aggregate power factor, which is lower than
     the average of the individual factors — a board of good circuits and one
     bad circuit is judged on the arithmetic, not on the best of them. */
  function reactive(p, panels) {
    /* Connected kW and diversified kVA again — the same trap as in totals().
       Adding them gives a power factor above 1, and the kvar comes out as zero
       because kva² < kw². On the real project every board reported pf 1.00 and
       0 kvar, so the reactive-power finding never fired and a capacitor
       calculation had nothing to work from. The clamp below was hiding it by
       pinning the result to 1. */
    var kw = 0, kva = 0, kwDiv = 0;
    panels.forEach(function (pn) {
      var d = panelDemand(p, pn);
      kw += d.kw; kva += d.kva;
      kwDiv += d.kw * (d.demand === undefined || d.demand === null ? 1 : d.demand);
    });
    /* The kW that shares the kVA's basis is the only one a power factor can be
       taken against. */
    var kwForPf = kwDiv < kw * 0.999 ? kwDiv : kw;
    var pf = kva > 0 ? D.clamp(kwForPf / kva, 0, 1) : 1;
    var kvar = Math.sqrt(Math.max(0, kva * kva - kwForPf * kwForPf));
    return {
      kw: kw, kwDiv: kwDiv, kva: kva, kvar: kvar, pf: pf,
      /* a kVA below the kW on the same basis is a data error, reported by the
         audit against the circuits rather than papered over here */
      diversified: kwDiv < kw * 0.999
    };
  }
  /* Current from apparent power. S = √3 · V · I, so I = S / (√3 · V) for three
     phase and S / V for single — and neither has a power factor in it, because S
     is kVA and the power factor has already been applied to get there.

     This function divided by pf as well, applying it twice: a 45 kW circuit at
     0.85 power factor and 400 V was reported as 90 A instead of 76 A. Every
     three-phase current in the app was overstated by 1/pf — 18% at a typical
     industrial power factor — and it fed cable sizing, board loading, incomer
     ratings, volt drop and motor starting current, so the whole schedule was
     built on it. The `pf` argument is kept in the signature so that a call site
     passing it is not silently wrong in the other direction, but it is not used;
     a caller with watts should divide by pf itself and pass watts, not kVA. */
  function currentFor(kva, pf, phases, volt) {
    var v = D.num(volt, 400) || 400;
    if (String(phases) === '1') return (kva * 1000) / v;
    return (kva * 1000) / (Math.sqrt(3) * v);
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
  /* The maximum incomer a distribution board may have.

     1,600 A is the practical ceiling for a distribution board: above it the
     switchgear is a switchboard, and the things that make a board a board — a
     moulded orWithdrawable panel, ways you can add a circuit to on site, an
     incomer you set with a screwdriver — stop being true. 2,000 A is not a
     bigger board, it is a different product, and specifying it as one is how a
     project ends up with a switchboard nobody priced.

     It is a declared project setting rather than a constant, because it is a
     commercial and standards decision — some specifications set a lower figure,
     and a site with a 630 A transformer has no business with a 1,600 A board
     whatever the rule says. */
  /* Is this supply's feeder a busbar rather than a cable?

     Above about 2,500 A a feeder is not a cable at all. Eight parallel 500 mm²
     cores reach about 4,088 A in this installation and stop, and a transformer
     incomer above that is a busbar section from the transformer to the main
     board — which is how every one of them is built.

     The app had a busbar rating field, stored it, exported it to the schedule and
     the JSON, and never checked it. So a main board whose incomer was genuinely
     a busbar was reported as needing a cable that cannot exist, with no way to
     say otherwise: an error the engineer could not resolve because the answer was
     a field the app already had and ignored.

     A busbar is a conductor, so it has its own two checks — its rating against
     the load, and its short-time withstand against the fault level — and neither
     of them is a cable-table lookup. The withstand is what matters: a busbar that
     carries the current can still be destroyed by the fault it is supposed to
     survive, and that is a specification rather than a calculation. */
  function isBusbar(item) {
    return !!(item && num(item.busbarA, 0) > 0);
  }

  /* The busbar's own two questions: can it carry the load, and can it survive
     the fault. Returns null where there is nothing to check. */
  function busbarCheck(p, item, kind, loadA, faultKA) {
    if (!isBusbar(item)) return null;
    var rating = num(item.busbarA, 0);
    var icw = num(item.busbarIcw, 0);
    var icwT = num(item.busbarIcwT, 1) || 1;
    var problems = [];
    if (loadA > 0 && loadA > rating) {
      problems.push({
        level: 'bad',
        title: item.tag + ' busbar is below the load it carries',
        detail: 'The busbar is rated ' + rating + ' A and carries ' + loadA.toFixed(0) +
          ' A. A main board incomer busbar is chosen for the transformer rating, ' +
          'not for the load it happens to carry today, so this is either a busbar ' +
          'that is too small for the transformer or a load figure worth rechecking.'
      });
    }
    if (faultKA && icw > 0 && icw < faultKA) {
      problems.push({
        level: 'bad',
        title: item.tag + ' busbar short-time withstand is below the fault level',
        detail: 'Rated ' + icw + ' kA for ' + (icwT * 1000).toFixed(0) +
          ' ms against a calculated fault of ' + faultKA.toFixed(1) + ' kA. The busbar would be ' +
          'destroyed before the device could open. This is the figure the switchgear ' +
          'manufacturer certifies for the assembly — Icw, the permitted short-circuit current ' +
          'for the stated time — and it is a specification rather than something derived, ' +
          'so it has to come from the data for that busbar system rather than be assumed.'
      });
    } else if (faultKA && icw > 0 && icw < faultKA * 1.25) {
      problems.push({
        level: 'warn',
        title: item.tag + ' busbar short-time withstand is marginal',
        detail: icw + ' kA for ' + (icwT * 1000).toFixed(0) + ' ms against a calculated ' +
          faultKA.toFixed(1) + ' kA. The fault level rests on an assumed transformer impedance, ' +
          'so leave margin on it.'
      });
    } else if (faultKA && !(icw > 0)) {
      /* An absent input is not the same as nothing to say.

         The certified Icw comes off the busbar system own test certificate and
         cannot be derived here — but the REQUIREMENT can, and it is the half that
         actually goes on the enquiry. "What is the short-time withstand of this
         busbar?" gets an answer to check. "It must withstand no less than 92 kA
         for 1 s at this fault level, please confirm" gets one that can be
         accepted or rejected on the spot, and turns a blank field into a
         procurement item with a number against it.

         One second is the short-time withstand IEC 61439-1 gives for the
         reference design current, and the same 1.25 margin the check above uses
         is applied, so the number quoted here and the number tested are one and
         not two that can disagree. */
      var needKA = faultKA * 1.25;
      problems.push({
        level: 'info',
        title: item.tag + ' busbar short-time withstand not stated — ' +
          needKA.toFixed(0) + ' kA for 1 s required',
        detail: 'The busbar is declared at ' + rating + ' A, which answers whether it ' +
          'can carry the load, but nothing says what fault current it is permitted to ' +
          'withstand, and that is the figure which decides whether it survives a short ' +
          'circuit. It cannot be derived here — it is a property of the busbar system and ' +
          'comes off its own certification — but the requirement against it can. This ' +
          'board sits at a calculated ' + faultKA.toFixed(1) + ' kA, so with the same 1.25 ' +
          'margin the check above applies it needs Icw of at least ' +
          needKA.toFixed(0) + ' kA for 1 s, which is the short-time withstand IEC 61439-1 ' +
          'gives for the reference design current. Put that in the enquiry rather than ' +
          'asking the question open-ended: a system certified at ' + needKA.toFixed(0) +
          ' kA or above is acceptable, and one certified below it is not for this fault ' +
          'level and wants either a higher withstand or a rated fuse at the transformer. ' +
          'Set the figure when the certificate arrives and the check becomes a real one.'
      });
    }
    return problems.length ? { level: 'bad', problems: problems } : null;
  }

  /* What a stated transformer impedance would be worth, so an unconfirmed figure
     becomes a priced question rather than a blocker.

     The instinct on seeing "impedance not stated" is to leave everything else
     alone until the nameplate arrives. On this project that instinct is wrong,
     and the reason is worth showing: at 6% the fault level is 69 kA and 42
     feeders want 120 mm²; at 10% it is 41 kA and they want 70 mm². Confirming the
     figure changes about 2,000 mm² of cable — real money — and changes nothing
     about whether any of those feeders is undersized. Every row from 4% to 12%
     leaves the design needing attention.

     So the work does not wait for the nameplate; the order does. That is a very
     different instruction from "cannot proceed", and it is the one an engineer
     can act on this week.

     Returned, not asserted: these are the same calculation the audit makes, run
     at other impedances, so the table cannot disagree with the findings. */
  function impedanceSensitivity(p, tx) {
    var sn = num(tx.kva, 0);
    if (!(sn > 0)) return [];
    var v = Math.max(50, num(tx.kvOut, 0.415) * 1000);
    var out = [];
    [4, 5, 6, 7, 8, 10, 12].forEach(function (z) {
      var kA = (sn * 1000 / (Math.sqrt(3) * v)) / (z / 100) / 1000;
      out.push({ z: z, kA: kA, minCsa: csaForFault(kA, 0.04, 'XLPE', 'Cu') });
    });
    return out;
  }

  /* The tap. A distribution transformer has an on-load tap selector and the one
     thing it exists for is to cancel the transformer's own voltage drop, so that
     the far end of the installation sits at nominal when it is carrying its
     design load.

     That makes it a SETTING and not a design, which is why this project has two
     tap findings and neither of them is a defect: the cables are inside every
     limit everywhere — the wiring drop here is 0.54% to 1.86% against a 5% limit
     — and what sits outside is the transformer, which the tap is there to remove.

     So the finding was reporting the wrong thing. It counted circuits finishing
     outside the limit end to end and said so, without noticing that on TX7 a tap
     of +5% puts all thirty-four of them inside, and on TX8 +2.5% puts all
     sixty-three. That is not a defect spread over thirty-four circuits; it is one
     selector position per transformer, and an engineer reading the old finding
     would have gone looking for thirty-four separate cable problems.

     tapAdvice sweeps the positions the selector actually offers and reports what
     each one does. Two figures matter and they are in tension: the far end wants
     the tap to cancel the transformer drop, while the supply terminals rise by
     the tap itself and must stay inside what the installation may be fed at.
     Reported together, because a tap advice that only quoted one of them would
     be recommending the high-voltage end of the problem. */

  function tapPositions(p) {
    var d = (p && p.design) || {};
    var range = num(d.tapRange, 7.5);
    var step = num(d.tapStep, 2.5);
    if (!(step > 0)) step = 2.5;
    var out = [];
    for (var t = -range; t <= range + step * 1e-6; t += step) {
      out.push(Math.round(t * 1000) / 1000);
    }
    return out;
  }

  /* What one tap position does to every circuit on one transformer. */
  function tapAt(p, tx, tap) {
    var all = voltageProfileWorst(p).profiles;
    var mine = all.filter(function (v) {
      return v.steps.some(function (st) { return st.kind === 'tx' && st.id === tx.id; });
    });
    if (!mine.length) return null;
    var over = 0, worst = null, lo = Infinity, hi = -Infinity;
    var txLo = Infinity, txHi = -Infinity, overList = [];
    mine.forEach(function (v) {
      /* The tap is a setting on the supply, so it lifts every voltage downstream
         of it by the same percentage — the far end, the boards and the terminals
         all move together. */
      var total = v.pct - tap;
      if (total > v.limit + 1e-9) {
        over++;
        if (v.pn) overList.push(v.pn.tag || v.pn.name);
      }
      if (total < lo) lo = total;
      if (total > hi) hi = total;
      if (v.transformer.pct < txLo) txLo = v.transformer.pct;
      if (v.transformer.pct > txHi) txHi = v.transformer.pct;
    });
    return {
      tap: tap, over: over, of: mine.length, overList: overList,
      /* the voltage drop to the far end, after the tap has been applied */
      farLo: lo, farHi: hi,
      /* what the tap asks of this transformer on its own */
      txLo: txLo, txHi: txHi, meanTx: (txLo + txHi) / 2,
      /* and what the supply terminals are left running at, which is the tap
         less the transformer drop the tap was set to cancel */
      termLo: 100 + tap - txHi, termHi: 100 + tap - txLo
    };
  }

  function tapAdvice(p, tx) {
    var rows = tapPositions(p).map(function (t) { return tapAt(p, tx, t); })
      .filter(Boolean);
    if (!rows.length) return null;
    var best = rows[0];
    rows.forEach(function (r) {
      /* Fewest circuits outside first. Then the position that over-corrects least,
         which is the one that leaves the supply terminals nearest nominal — a tap
         two steps beyond what is needed holds the far end up rather than at
         nominal, and pays for it in the voltage every board on the installation
         is fed at. */
      if (r.over < best.over) { best = r; return; }
      if (r.over > best.over) return;
      if (Math.abs(r.tap - r.meanTx) < Math.abs(best.tap - best.meanTx)) best = r;
    });
    var clears = rows.filter(function (r) { return r.over === 0; });
    /* How close the recommendation is to cancelling the transformer's own drop,
       which is the textbook rule and is what the sweep should agree with. */
    var ideal = best.meanTx;
    return {
      tx: tx, rows: rows, best: best, clears: clears.length,
      ideal: ideal, set: tx.tap === undefined || tx.tap === null ? null : num(tx.tap, 0),
      now: tx.tap === undefined || tx.tap === null ? null : tapAt(p, tx, num(tx.tap, 0))
    };
  }

  /* Which fault level a question is about.

     Two different numbers, and asking one question with the other is how a
     10 mm² feeder gets reported as facing 61 kA on one line and 8.8 kA on the
     next.

     **The device** is tested against the fault at its OWN terminals. A circuit's
     device sits on the distribution board, so the level that matters for its
     breaking capacity and for selectivity with what is below it is the board's,
     not the far end of the feeder it protects.

     **The conductor** is tested against the fault at its OWN far end. That is
     the fault the conductor has to survive, and on a thin feeder the conductor is
     what limits it: 1.5 mm² thirteen metres from a 3,150 kVA transformer carries
     226 mΩ against a source of 3 mΩ, so the fault at its far end is about 1 kA
     and not the 70 kA the board can produce. That is why a small control circuit
     is self-protecting, and it is invisible unless the conductor's impedance is
     in the sum.

     `faultAt` was the per-stage approximation and neither of those. The board
     gets `faultLevel` at itself and the conductor `faultLevel` at itself. */
  function deviceFaultKA(p, item, kind) {
    if (kind === 'panel') {
      /* The device is at the distribution board, not at the load. */
      var up = (item.dbId && get(p, 'db', item.dbId)) || get(p, 'pdp', item.pdpId) || get(p, 'pdb', item.pdbId);
      if (up) {
        var f = faultLevel(p, up, up.__kind || 'pdp');
        if (f) return f.kA;
      }
    }
    var self = faultLevel(p, item, kind);
    return self ? self.kA : faultAt(p, item, kind);
  }

  /* ================================================ selecting an NSX ======

     A device is chosen the way one is chosen in practice, in four steps, and each
     step answers a different question — so each is reported separately, because
     "we need 50 kA" and "we need 630 A" are not the same conversation.

     1. FRAME, from the rating the load needs. The frame is the physical device
        and its rating is the top of the adjustable range, not the setting: an
        NSX1250 covers 630 to 1,250 A and a board carrying 847 A is an NSX1250
        with the long-time pickup at 847 A. Choosing the frame on the setting
        instead would put every board on the smallest frame that happened to
        cover its load and leave no adjustment at all — which is how the grading
        problem came about in the first place.

     2. TRIP UNIT, from what the coordination requires and nothing else. The
        Micrologic digit decides it: 5 is long-time only, 6 adds the short-time
        stage that selectivity is made of, 7 adds the adjustable instantaneous.
        A board with boards below it needs a 6 or a 7 or it cannot be graded at
        any setting. Below 100 A the range offers no electronic unit at all — the
        compact frame is thermal-magnetic and has no short-time stage — so that is
        reported rather than quietly given a unit that cannot do it.

     3. SETTINGS, from the coordination that has already been worked out: the
        long-time pickup the grading chose or the load, the short-time pickup and
        delay it chose, the instantaneous setting if one was chosen.

     4. INTERRUPTING RATING, from the fault level with the design margin. Where
        the frame cannot reach it, that is said plainly — an NSX5000 tops out at
        100 kA and no setting changes that, which is exactly the kind of thing
        that has to reach the person choosing the switchgear. */

  function nsxSelect(p, item, kind) {
    if (!item || !item.prot || item.prot.kind !== 'mccb') return null;
    var prot = item.prot;

    /* 1. The frame. Taken from the frame rating if the device has one, otherwise
          from the setting, and in both cases rounded UP to a standard size so the
          device is not a bespoke rating between two catalogue frames. */
    var wanted = num(prot.frame, 0) || num(prot.ir, 0);
    var frame = D.nsxFor(wanted) || D.nsxFor(D.SIZES_A.filter(function (a) {
      return a >= wanted;
    })[0]);
    if (!frame) return {
      item: item, kind: kind, ok: false,
      why: 'No NSX frame covers ' + Math.round(wanted) + ' A. The range runs to ' +
        D.NSX[D.NSX.length - 1].hi.toFixed(0) + ' A; above that the answer is a '
    };

    /* 2. What the coordination needs from the unit. */
    var hasChild = false;
    if (kind === 'pdb') {
      hasChild = p.pdps.some(function (d) { return d.pdbId === item.id; });
    } else if (kind === 'pdp') {
      hasChild = p.dbs.some(function (b) { return b.pdpId === item.id; }) ||
        p.panels.some(function (pn) { return pn.pdpId === item.id && !pn.dbId; });
    } else if (kind === 'db') {
      hasChild = p.panels.some(function (pn) { return pn.dbId === item.id; });
    }
    var needShort = hasChild || num(prot.sd, 0) > 0 || num(prot.ss, 0) > 0;

    /* An instantaneous stage is required on EVERY device, not only where the
       grading happens to want one.

       Micrologic 2.2 is a long-time unit and nothing else: no magnetic release,
       no electronic instantaneous. It will clear a sustained overload and it will
       not clear a short circuit, and it offers nothing for an earth fault. A
       first pass at this selection picked the first unit in the frame's list that
       met the other requirements, and on this project that put 2.2 on
       forty-eight circuits including fifteen of them Compact NSX100s — devices
       with no fault protection on them at all, quoted as though they were a
       selection.

       The minimum is therefore 3.2, which is long-time plus magnetic, and every
       device gets it unless the frame has nothing better. Anything above that is
       added for coordination, never for protection. */
    var needInstant = true;

    var pick = null, whyNot = null;
    function acceptable(mic) {
      var f = D.MICLOGIC_FUNCTIONS[mic] || {};
      if (needShort && !f.short) return false;
      if (needInstant && !f.instant) return false;
      return true;
    }
    for (var i = 0; i < frame.trip.length && !pick; i++) {
      if (acceptable(frame.trip[i])) pick = frame.trip[i];
    }
    /* Nothing in this frame does what is needed. Say so rather than downgrading
       to a unit that will not coordinate — that is the mistake the finding is
       already there to prevent. */
    if (!pick) {
      var closest = frame.trip[frame.trip.length - 1];
      var cf = D.MICLOGIC_FUNCTIONS[closest] || {};
      return {
        item: item, kind: kind, ok: false, frame: frame, mic: closest,
        why: frame.size + ' has no ' + (needShort ? 'short-time' : 'instantaneous') +
          ' stage at any rating — its units are ' + frame.trip.join(' and ') +
          ', and ' + (cf.label || 'none of them') + ' cannot be graded against ' +
          'what is below it. Above 100 A the range is electronic throughout; ' +
          'below it the compact frame is thermal-magnetic and this is a limit of ' +
          'the product, not a setting.'
      };
    }

    /* 3. The settings, each one only if it was asked for. */
    var irWant = num(prot.ir, 0) || frame.hi;
    var irSet = Math.min(Math.max(irWant, frame.lo), frame.hi);
    var mf = D.MICLOGIC_FUNCTIONS[pick] || {};
    var ssSet = mf.short ? num(prot.ss, 0) || null : null;
    var sdSet = mf.short ? num(prot.sd, 0) || null : null;
    var iiSet = mf.instant ? num(prot.ii, 0) || null : null;

    /* 4. The interrupting rating. */
    /* The device's own terminals, which for a circuit is the board it sits on.
       A leftover 'kind === panel ? pdb' in the first draft of this asked a panel
       for the main board's path and threw. */
    var fKA = deviceFaultKA(p, item, kind);
    var icu = D.nsxIcu(frame, fKA, p.design && p.design.spreadMargin);

    var icuSuffix = icu && frame.suffix ? frame.suffix[icu] : '';
    var poles = num(prot.poles, 4) >= 4 ? 4 : 3;
    /* The reference is assembled from the selection, field by field, in
       Schneider's own order: size and interrupting suffix, poles, the trip unit,
       then the settings. Every one of those parts is here to be checked against
       the catalogue before an order goes in — which is the point of quoting them
       separately rather than as one opaque string. */
    var ref = frame.size + icuSuffix + poles + ' MIC ' + pick +
      (irSet ? ' N' + Math.round(irSet) : '') +
      (ssSet ? ' Isd ' + ssSet.toFixed(1) : '') +
      (sdSet ? ' tsd ' + Math.round(sdSet * 1000) + 'ms' : '') +
      (iiSet ? ' Ii ' + iiSet : '') +
      (icu ? ' Icu ' + icu + 'kA' : '');

    return {
      item: item, kind: kind, ok: icu !== null, frame: frame, mic: pick,
      funcs: mf, icu: icu, icuSuffix: icuSuffix, poles: poles,
      frameA: frame.hi, ir: irSet, ss: ssSet, sd: sdSet, ii: iiSet,
      faultKA: fKA, ref: ref,
      why: icu === null
        ? frame.size + ' tops out at ' + frame.icu[frame.icu.length - 1] +
          ' kA and this board sees ' + (fKA ? fKA.toFixed(1) : '?') + ' kA. No ' +
          'setting of this device reaches it — a fuse at the transformer, a ' +
          'different source impedance, or a busbar system with a higher ' +
          'interrupting rating are the answers, not a larger frame.'
        : null
    };
  }

  /* The whole installation, ordered the way a switchgear schedule reads: from the
     incomer down. */
  function nsxSchedule(p) {
    var rows = [];
    var order = { pdb: 0, pdp: 1, db: 2, panel: 3 };
    function add(item, kind) { var r = nsxSelect(p, item, kind); if (r) rows.push(r); }
    (p.pdbs || []).forEach(function (b) { add(b, 'pdb'); });
    (p.pdps || []).forEach(function (d) { add(d, 'pdp'); });
    (p.dbs || []).forEach(function (b) { add(b, 'db'); });
    (p.panels || []).forEach(function (pn) { add(pn, 'panel'); });
    rows.sort(function (a, b) {
      return (order[a.kind] - order[b.kind]) || String(a.item.tag).localeCompare(String(b.item.tag));
    });
    return rows;
  }

  function pdpMaxA(p) {
    return num(p && p.design && p.design.pdpMaxIncomer, 1600);
  }

  /* How many amps a board may actually take.

     The declared incomer, except on a distribution board where the cap binds.
     Stated as a separate figure rather than folded into boardStats().rating so
     that every number the app prints about a board stays true: a board rated
     4,000 A with 683 A on it is 17% loaded, and saying 43% because only
     1,600 A of the board may be used would be a different and worse lie.

     Zero when the rating is not stated, which keeps the existing behaviour of
     "cannot say" rather than inventing a capacity. */
  function usableA(p, board, kind) {
    var r = num(board && board.incomerA, 0);
    if (!(r > 0)) return 0;
    return kind === 'pdp' ? Math.min(r, pdpMaxA(p)) : r;
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
    /* The same basis the check will use. Choosing the breaking capacity from the
       per-stage estimate and then testing it against the computed path gave
       thirty-one devices a marginal warning on a project where nothing had
       changed — the device was specified against one number and audited against
       another, and the two differ by whatever the real cable data adds.

       deviceFaultKA() is the fault at the device's own terminals, which is what
       Icu has to survive: a circuit's device sits on the board above. */
    fKA = deviceFaultKA(p, item, kind);

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
      var fKA2 = deviceFaultKA(p, item, kind);
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
    var rq = reactive(p, sort);
    /* Which transformer feeds this board — the vector group decides whether the
       third harmonic ever reaches the incomer, so the neutral cannot be
       calculated without knowing it. */
    var upTx = null;
    if (kind === 'tx') upTx = item;
    else if (kind === 'pdb') upTx = get(p, 'tx', item.txId);
    else if (kind === 'pdp') { var up1 = get(p, 'pdb', item.pdbId); if (up1) upTx = get(p, 'tx', up1.txId); }
    else if (kind === 'db') { var up2 = get(p, 'pdp', item.pdpId); if (up2) { var up3 = get(p, 'pdb', up2.pdbId); if (up3) upTx = get(p, 'tx', up3.txId); } }
    /* The board's own per-phase current, which is the reference the neutral has
       to be judged against. A board's neutral conductor is sized against the
       current in one of its phases, not against its largest single circuit —
       the two differ by the number of circuits, and comparing a summed neutral
       against one circuit made a correctly-sized neutral look five times
       overloaded. */
    var boardPhaseAmp = Math.max(phaseAmp.L1, phaseAmp.L2, phaseAmp.L3);
    var neut = neutralCurrent(p, sort, upTx, boardPhaseAmp);
    var neutCsa = neutralCsaFor(sort.length && sort[0].cable ? sort[0].cable.csa : null);
    var thdMax = 0, thdPanels = [];
    sort.forEach(function (pn) {
      var t = D.num(pn.thd, 0);
      if (pn.thd === null || pn.thd === undefined || pn.thd === '') return;
      if (t > thdMax) thdMax = t;
      thdPanels.push(pn);
    });
    return {
      panels: sort, kw: kw,
      /* the diversified kW and whether the two bases differ, passed through so a
         power-factor calculation is not handed connected kW against diversified
         kVA — which is how a board reported 1.000 pf and 0 kvar on a real project
         carrying 600 kvar of reactive power */
      kwDiv: rq.kwDiv, diversified: rq.diversified,
      kva: kva, kvar: rq.kvar, pf: rq.pf, amp: amp, ampSum: ampSum,
      neutral: neut, neutralCsa: neutCsa, vectorGroup: upTx ? (upTx.vecGroup || 'Dyn11') : null,
      /* the neutral conductor the board's own circuits imply, which is the
         largest phase conductor going into it */
      neutralPhaseCsa: sort.reduce(function (a, pn) {
        var c = num(pn.cable && pn.cable.csa, 0);
        return c > a ? c : a;
      }, 0),
      /* the worst declared harmonic content on the board, and how many circuits
         declare any at all */
      thdMax: thdPanels.length ? thdMax : null, thdPanels: thdPanels.length,
      phaseKva: phaseKva, phaseAmp: phaseAmp,
      rating: rating, util: util, dev: dev, spareUsed: spareUsed,
      spare: kind === 'pdp' ? D.num(item.spareWays, 0) : kind === 'db' ? D.num(item.ways, D.num(item.spareWays, 0)) : 0,
      ways: waysKnown ? D.num(kind === 'db' ? item.ways : item.ways, 0) : null,
      /* The fault level from summed impedance where the path has real data, and
         from the 6%-per-stage assumption where it does not. Both are kept: the
         stage count is the honest fallback, and the ratio between them is the
         measure of how much the cable data was worth. */
      faultKA: faultAt(p, item, kind),
      fault: faultLevel(p, item, kind)
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
    /* `key` is an optional grouping handle. Two findings with the same key are
       the same problem seen on two different items, which is what lets a check
       that fires on every circuit be reported as one line instead of ninety —
       see groupFindings(). Omit it and the finding stands on its own. */
    /* `kw` is whatever quantity the group is summing, and `unit` says which, so
       that a group of starting-current findings does not print its amps as kW. */
    var add = function (lvl, scope, id, t, d, key, kw, unit) {
      var rec = { level: lvl, scope: scope, id: id, title: t, detail: d,
                  groupKey: key || null, groupKw: kw || null, groupUnit: unit || 'kW' };
      /* The item and the board it sits on, so a grouped row can name where the
         problem is without the check having to word it that way. */
      if (id && id !== '-') {
        var o = get(p, scope, id);
        if (o) {
          rec.item = o;
          rec.boardTag = boardTagOf(p, scope, o);
        }
      }
      out.push(rec);
    };

    /* board capacity */
    p.pdps.forEach(function (b) {
      var st = boardStats(p, b, 'pdp');
      if (st.util > 100) add('bad', 'pdp', b.id, b.tag + ' overloaded (' + st.util.toFixed(0) + '%)',
        st.amp.toFixed(1) + ' A on a ' + st.rating + ' A incomer. Move a load to a new board or increase the incomer.');
      else if (st.util > 85) add('warn', 'pdp', b.id, b.tag + ' heavily loaded (' + st.util.toFixed(0) + '%)',
        st.amp.toFixed(1) + ' A of ' + st.rating + ' A. Headroom ' + (st.rating - st.amp).toFixed(1) + ' A.');
      if (st.panels.length === 0) add('warn', 'pdp', b.id, b.tag + ' has no outgoing circuits',
        'No control panels are assigned to this board, and it is on the switchgear schedule.',
        'board-empty');
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
      /* One finding, not two. "Is spare" and "has no outgoing circuits" are the
         same condition reached twice, and a switchgear schedule with six spare
         sub-boards produced twelve rows saying one thing. The spare way count on
         the board is the interesting half — a board with nothing on it is
         ordinary while a project is being built, but a board with no circuits and
         no spare ways left is a design decision nobody made. */
      /* An empty sub-board is only an omission if the schedule says ways are in
         use. newDb() gives every board twelve spare ways out of thirty-six by
         default, so "no circuits" on its own cannot mean anything — the test for
         it has to be the gap, and the gap is what is provable: a board that says
         it has ways taken up and lists none of them.

         On this project six sub-boards each claimed thirty-six ways of which
         twelve were spare, so twenty-four ways in use, and carried no circuits at
         all. They had not been designed in: the import writes dbs: [] and the
         vendor sheet puts all ninety-seven circuits off distribution boards. They
         had been created by the convention, one beside every PDP, with the
         application own defaults — the same descriptor, "lighting, small power",
         and the same way count on all six, which is what gives them away.

         So they came off the schedule, and this is the check that would have
         said so. A board with no circuits and no ways claimed spare is provided
         capacity and needs no decision; one that claims ways in use has either
         lost circuits or is carrying a default it never meant. */
      if (st.panels.length === 0 && st.ways !== null &&
          st.ways - num(b.spareWays, 0) > 0)
        add('info', 'db', b.id, b.tag + ' claims ways in use but carries no circuits',
          'This sub-board states ' + st.ways + ' ways of which ' + num(b.spareWays, 0) +
          ' are spare, so ' + (st.ways - num(b.spareWays, 0)) + ' are in use — and no ' +
          'circuits are assigned to it. Either circuits are missing from it, or the ' +
          'way count is a default this board was created with rather than something ' +
          'that was decided. Check it before the schedule is issued: a sub-board with ' +
          'nothing on it and nothing spare is a board that was paid for and has ' +
          'nothing to do.',
          'board-empty');
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

    /* Nothing here about a board with no sub-board.

       There used to be a finding saying that a distribution board "usually
       carries one for lighting and small power, and you would have use for it
       later". That was the application's own house style reported back as if it
       were an expectation, and it fired on every board in any design that put
       its circuits straight onto the board — which is a perfectly ordinary
       design, and on this project the stated convention is exactly that: circuits
       land on distribution boards, not on sub-boards. Removing six vestigial
       sub-boards from the schedule created it on all six boards at once, which is
       what showed it up: a change that made the design more honest produced six
       findings saying the honest design was incomplete.

       There is no rule that a distribution board must carry a sub-board. If
       nothing is fed from one, there is nothing to report. */

    /* ---------------------------------------------------- the board size limit --
       A distribution board is capped at 1,600 A of incomer. Above that the
       switchgear is a switchboard: the things that make a board a board — a
       moulded or withdrawable panel, ways a circuit can be added to on site, an
       incomer set with a screwdriver — stop being true, and it has to be
       specified, priced and built as a different product.

       This is raised as an error rather than a warning because a board over the
       limit is the wrong object, not a design that happens to be aggressive.
       Nothing downstream can rescue it: the feeder to it has to be sized for
       4,000 A whether the board is justified or not, and that cable is on the
       bill.

       The remedy is a second board off the same main board, not a bigger one,
       and the message says how much is actually on it — because a 4,000 A board
       carrying 683 A is usually a board that was bought big on day one and never
       filled, and the honest answer there is to reduce it rather than split it. */
    (function () {
      var cap = pdpMaxA(p);
      var over = p.pdps.filter(function (d) { return num(d.incomerA, 0) > cap; });
      if (!over.length) return;
      over.forEach(function (d) {
        var st = boardStats(p, d, 'pdb' === d.__kind ? 'pdb' : 'pdp');
        var need = Math.ceil(st.amp / cap) || 1;
        var used = num(d.incomerA, 0);
        add('bad', 'pdp', d.id,
          d.tag + ' is ' + used.toLocaleString() + ' A, above the ' + cap.toLocaleString() + ' A limit for a distribution board',
          'A distribution board above ' + cap.toLocaleString() + ' A of incomer is a switchboard, not a board, and has ' +
          'to be specified as one. Its feeder is sized for ' + used.toLocaleString() +
          ' A whether that is justified or not, so the cable is on the bill either way.' +
          ' This board actually carries ' + st.amp.toFixed(0) + ' A' +
          (st.amp <= cap
            ? ', which is inside the limit — so the honest fix is to set the incomer to ' +
              /* The project's own sizing margin, not 1.0. Sizing a board to its
                 exact present load is how "heavily loaded" warnings get created
                 by the very correction meant to remove them, and a board with no
                 headroom has to be replaced the first time a circuit is added. */
              suggestIncomer(st.amp, D.num(p.design.spreadMargin, 1.25)) + ' A, not to split it.'
            : ', which needs ' + need + ' board' + (need > 1 ? 's' : '') + ' at ' + cap.toLocaleString() +
              ' A each. Add another distribution board off ' + ((get(p, 'pdb', d.pdbId) || {}).tag || 'the same main board') +
              ' and move circuits until both are under the limit. Press <b>Balance</b> to do that move: it measures a ' +
              'board against the capacity it may actually use, so a board this size is relieved into a new board off ' +
              'the same main board rather than filled.'),
          'pdp-cap', st.amp, 'A');
      });
    })();

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
        'clearing time is a band rather than a curve. Check against the manufacturer\'s data before sizing on this.',
        'withstand', 0);
    }

      /* ---------------------------------------------------- reactive & harmonics --
     Two things that a schedule expressed only in kW cannot show.

     Reactive power is not a separate decision — it falls out of the kW, the kVA
     and the power factor already entered — but it is a separate *consequence*.
     A supply at 0.8 power factor draws the same current as one at 1.0 with a
     fifth more load on it, and utility tariffs penalise it. Reporting it here
     turns a number nobody looks at into a number with a consequence attached.

     Harmonic content is different: it is not in the load schedule at all, and
     the cable size that follows from the fundamental current understates what
     actually heats the conductor. Only circuits that declare it are affected,
     which is why nothing is assumed for the rest. */
    function checkReactive(p, item, kind, st) {
      if (st.panels.length < 2 || st.kva <= 0) return;
      var lim = num(p.design.pfLimit, 0.9);
      if (!(st.pf < lim)) return;
      /* The correction. Real power stays fixed and the reactive falls, so the
         target is the reactive the same kW would draw at the wanted power
         factor — and the capacitor has to supply the *difference*, which is
         larger than it looks, not smaller. Q_target = √(S² − P²) with
         S = P / limit, and the capacitor covers Q − Q_target.

           Getting this sign wrong reported "0 kvar of correction" on a board
           carrying 122 kvar, which is exactly backwards. */
      var target = Math.sqrt(Math.max(0, Math.pow(st.kw / lim, 2) - st.kw * st.kw));
      var need = Math.max(0, st.kvar - target);
      add('warn', kind, item.id,
        item.tag + ' power factor ' + st.pf.toFixed(2) + ' — ' + st.kvar.toFixed(0) + ' kvar of it is reactive',
        'This board sums to ' + st.kw.toFixed(0) + ' kW in ' + st.kva.toFixed(0) + ' kVA, which is a power ' +
        'factor of ' + st.pf.toFixed(2) + '. Below ' + lim.toFixed(2) + ' the same kW needs more current, ' +
        'and most supply tariffs charge for it. About ' + need.toFixed(0) + ' kvar of correction would bring ' +
        'it to ' + lim.toFixed(2) + '. No capacitor is modelled here, so this is the size of the question ' +
        'rather than a proposal.', 'power-factor', st.kvar);
    }

    /* A circuit that declares harmonic content raises its own RMS current, and
       the cable is sized on the fundamental. The relationship is on the
       conductor's thermal limit, not the fault limit, so this is an overload
       question rather than a withstand one. */
    function checkHarmonics(p, pn, kind) {
      if (pn.thd === null || pn.thd === undefined || pn.thd === '') return;
      var thd = num(pn.thd, 0);
      if (thd < num(p.design.thdWatch, 15)) return;
      var d = panelDemand(p, pn);
      if (d.harmFactor <= 1.001) return;
      var cab = pn.cable;
      if (!cab || !cab.csa) return;
      var r = cableRating(cab);
      if (!r.ok) return;
      var ampHarm = d.ampHarm;
      /* Conductor heating goes as I², so the rise is the square of the current
         rise. Quoting the current factor as though it were the heat understates
         it by half — at 45% THD, 10% more current is 20% more heat. */
      var heat = (d.harmFactor * d.harmFactor - 1) * 100;
      add(ampHarm > r.derated ? 'bad' : 'warn', kind, pn.id,
        pn.tag + ' carries ' + thg(thd) + ' harmonic content',
        'Stated at ' + thg(thd) + ' total harmonic distortion, which raises the RMS current from ' +
        d.amp.toFixed(1) + ' A to ' + ampHarm.toFixed(1) + ' A — ' +
        ((d.harmFactor - 1) * 100).toFixed(0) + '% more current, and about ' + heat.toFixed(0) +
        '% more heat in the same conductor because heating goes as the square of the current. The feeder is sized for ' +
        r.derated.toFixed(0) + ' A' +
        (ampHarm > r.derated
          ? ', so at this load it is ' + ((ampHarm / r.derated - 1) * 100).toFixed(0) + '% overloaded once the harmonics are counted.'
          : ', which covers it with ' + ((1 - ampHarm / r.derated) * 100).toFixed(0) + '% to spare — but only while the declared distortion holds.') +
        ' Harmonic content is only checked where a circuit declares it; nothing is assumed for the others.',
        'harmonics', d.kw);
    }

    /* kVA below kW is a power factor above 1, which does not exist. Caught here
       because it is invisible downstream: the current comes out right, the
       reactive comes out zero, and only the ratio looks wrong. */
    function checkImpossiblePf(p, pn) {
      var d = panelDemand(p, pn);
      if (!d.impossible) return;
      add('warn', 'panel', pn.id, pn.tag + ' is entered with less kVA than kW',
        d.kw.toFixed(1) + ' kW cannot fit inside ' + d.kva.toFixed(1) + ' kVA \u2014 that is a power factor of ' +
        (d.kw / d.kva).toFixed(2) + ', which does not exist. The reactive power has been taken as zero and '
        + 'the current is unaffected, so nothing downstream is wrong, but one of the two figures is a typo. '
        + 'Leave the kVA override blank to derive it from kW and the power factor.', 'bad-kva', d.kw);
    }

    function thg(t) { return (Math.round(t * 10) / 10) + '%'; }

    /* Earth fault disconnection. Two separate failures, reported separately,
       because they have different fixes and confusing them wastes a site visit:
       a loop that is too high needs a bigger protective conductor or a shorter
       route, while a device that is too slow to clear needs a faster one. */
    function checkEarthFault(p, item, kind) {
      var e = earthFaultCheck(p, item, kind);
      if (!e) return;
      var what = item.tag;

      if (e.needs) {
        add('info', kind, item.id, what + ' earth fault loop cannot be assessed',
          'The supply is ' + e.system + ', whose loop runs through the earth ' +
          'electrode, so it needs the electrode resistance before the disconnection ' +
          'time can be checked. Set it on the site page, and note that a TT supply ' +
          'also needs the 30 mA RCD that makes a 0.1 s disconnection achievable at all.');
        return;
      }
      if (e.unachievable) {
        add('bad', kind, item.id, what + ' cannot disconnect within ' +
          (e.tMax * 1000).toFixed(0) + ' ms',
          'The device is set at ' + e.ir + ' A and its curve does not clear in less than ' +
          (e.tMax * 1000).toFixed(0) + ' ms at any current, so no loop impedance can meet the ' +
          'requirement — IEC 60364-41 Table 41.4 allows ' + (e.tMax * 1000).toFixed(0) +
          ' ms for a ' + e.ir + ' A ' + (kind === 'panel' ? 'final circuit' : 'circuit') +
          ' on a ' + e.system + ' supply. This is a device choice, not a cable choice.');
        return;
      }
      if (!e.pass) {
        add('bad', kind, item.id, what + ' earth fault loop too high to disconnect in time',
          'R1 + R2 is ' + e.loop.total.toFixed(2) + ' Ω over ' + (e.loop.km * 1000).toFixed(0) +
          ' m, which lets ' + e.ia.toFixed(0) + ' A flow — the device takes ' +
          (e.tActual === null ? 'longer than its curve allows' : LC_ms(e.tActual)) +
          ' and the limit is ' + (e.tMax * 1000).toFixed(0) + ' ms. It needs ' +
          (e.maxLoop === null ? 'a lower loop impedance than the current conductors can give — ' + peNeededCsa(e) :
            'R1 + R2 below ' + e.maxLoop.toFixed(2) + ' Ω, which over this route means ' + peNeededCsa(e) + '.'));
        return;
      }
      /* Passing silently is the right default, and so is the test for "closer to
         failing than it looks".

         The first version of this asked whether the loop current was high
         against the device rating, which is backwards: a low loop impedance gives
         a *large* current, and a large current is safe — it is what the device
         wants. On the sample project every short fat feeder carries tens of
         kiloamps through the loop and the check fired on 68 of 103 rows, which is
         precisely the noise the grouped list exists to remove.

         The risk is the other end. A circuit that passes only just is one where
         the achieved time is a large fraction of the time allowed, because then
         the conductor has to be at its limit temperature, the joints have to be
         good and the route must not be extended. */
      /* How close this circuit is to FAILING, not how much time it used.

         The rule used to fire when the achieved disconnection time was over 40% of
         the time allowed, which sounds cautious and is not. A circuit that clears
         in 50 ms against a 100 ms limit has used half the time available whether
         its loop impedance is 14% of the permitted value or 90% of it — the time
         saturates at the device's own floor, so the further the circuit is from
         failing the less the ratio moves. Five control circuits on this project
         were reported at 50% while carrying R1 + R2 of 0.11 to 0.16 Ω against
         0.81 Ω permitted, which is a fifth of the limit and not a finding at all.

         So the measure is proximity to the limit on the impedance, which is what
         actually decides whether it passes. A circuit within a quarter of its
         permitted loop impedance is worth a second look, because then the
         conductor has to be at its limit temperature, the joints have to be good
         and the route cannot be extended without another calculation. The
         disconnection time is still checked, and still fails a circuit that does
         not disconnect in time — this only governs the advisory note. */
      var room = e.maxLoop ? 1 - e.loop.total / e.maxLoop : null;
      var ratio = e.tActual === null ? null : e.tActual / e.tMax;
      if (room !== null && room < 0.25) {
        if (!isSpare(item)) add('info', kind, item.id, what + ' earth fault loop leaves little margin',
          'The loop carries ' + e.ia.toFixed(0) + ' A against a ' + e.ir +
          ' A setting, which clears in ' + LC_ms(e.tActual) + ' against a ' +
          (e.tMax * 1000).toFixed(0) + ' ms limit — ' + (ratio * 100).toFixed(0) +
          '% of the time available used. It passes, and R1 + R2 is ' + e.loop.total.toFixed(2) +
          ' Ω against a permitted ' + (e.maxLoop === null ? '—' : e.maxLoop.toFixed(2)) +
          ' Ω, but the calculation assumes the conductor at its operating temperature with ' +
          'sound joints, and any later extension of the route eats into what is left.',
          'loop-margin', 0);
      }
    }

    function LC_ms(t) { return t >= 1 ? t.toFixed(2) + ' s' : (t * 1000).toFixed(0) + ' ms'; }

    /* Motor starting. Three failures, reported separately because they have
       different fixes: the upstream device picks up and trips, the motor's own
       device does the same, or the board voltage dips far enough that the motor
       cannot accelerate and draws even more current. */
    function checkStarting(p, pn, kind) {
      var r = startingCheck(p, pn, kind);
      if (!r || !pn.prot) return;
      var what = pn.tag;
      var sc = r.sc, m = sc.method;
      var groupWord = sc.group > 1 ? ' (' + sc.group + ' starting together)' : '';

      /* 1. the upstream device. This is the failure that catches people out: the
            motor is perfectly capable of starting on its own, and trips the board
            because of what the board above it can see. */
      if (r.tripsUpstream) {
        add('bad', kind, pn.id, what + ' starting current trips ' + (r.up ? r.up.tag : 'the board above'),
          'Starting at ' + sc.amps.toFixed(0) + ' A' + (sc.group > 1 ? ' per circuit and ' + sc.combined.toFixed(0) +
            ' A together' : '') + ' — ' + sc.multiple + ' × full load — which is above the ' +
          (r.up ? r.up.tag : 'upstream') + ' device\'s pick-up at ' + r.upPickup + ' × its ' + r.upIr +
          ' A setting. That device clears in ' + LC_ms(r.upClears) + ' and the motor takes about ' +
          sc.accel + ' s to accelerate, so the upstream device wins. Soft starting, star-delta or a drive ' +
          'brings the current below the pick-up; staggering the start so nothing else lands on that board ' +
          'at the same moment also works, and costs nothing.', 'start-upstream', sc.amps, 'A');
        return;
      }
      /* 2. the motor's own device. */
      if (r.tripsSelf) {
        add('bad', kind, pn.id, what + ' starting current exceeds its own device\'s pick-up',
          'The motor draws ' + sc.amps.toFixed(0) + ' A starting, ' + sc.multiple +
          ' × its full load current, against a ' + (pn.prot.kind === 'mcb' ? 'curve ' + (pn.prot.trip || 'C') :
            (pn.prot.trip || 'TM')) + ' device whose magnetic stage picks up at ' + r.ownPickup +
          ' × In. It will operate during every start. A curve ' + m.needsCurve + ' device, or an MCCB with ' +
          'its instantaneous setting taken above ' + sc.amps.toFixed(0) + ' A, is what this needs.',
          'start-own', sc.amps, 'A');
        return;
      }
      /* 3. A machine with no rated load. The starting check needs a full load
            current to take a multiple of, and there is nothing to take it of. */
      if (r.noRating) {
        add('info', kind, pn.id, what + ' has no rated load to check its starting current against',
          'The sheet gives this machine no kW, which is what a stand-by machine usually means. ' +
          'It still draws a full inrush when it starts, so the question worth asking is the vendor\'s ' +
          'rated current and starting method rather than anything the schedule can work out here.');
        return;
      }
      /* 4. Inferred data, reported before anything is computed from it. A motor
            whose starting method came from a machine name has no assessed dip in
            this design yet, and the fix is to ask the vendor — which is a
            different action from anything below. */
      if (pn.startInferred && !pn.start) {
        add('warn', kind, pn.id, what + ' is a motor with no starting method',
          'The machine name suggests rotating equipment, but nothing states how it starts. ' +
          'Direct on line takes about ' + D.START_METHODS.DOL.multiple + ' × full load current, ' +
          'which is the figure that decides whether the board above survives it — so this circuit ' +
          'has not actually been checked. Set the starting method from the vendor\'s data.',
          'start-unstated', r.sc.flc, 'A full load');
        return;
      }
      /* Only when the method is NOT declared. The flag records where a value
         originally came from, and once somebody has declared one it is declared
         however it was arrived at first — reporting it as inferred afterwards was
         reporting the provenance instead of the state. Seven circuits on this
         project carried an explicit VFD with this note against them, which reads
         as "we do not know" about something the schedule does state. */
      if (pn.startInferred && !pn.startInferredOverridden && pn.start) {
        add('info', kind, pn.id, what + ' starting method inferred from the machine name',
          'Recorded as ' + pn.start + ', originally taken from the machine name rather ' +
          'than from a sheet. Worth confirming — it moves the starting current from about ' +
          r.sc.amps.toFixed(0) + ' A down to ' +
          (r.sc.amps / D.START_METHODS.DOL.multiple * D.START_METHODS[pn.start].multiple).toFixed(0) +
          ' A, and that is the difference between keeping the board and tripping it.',
          'start-inferred', r.sc.flc, 'A full load');
      }

      /* 5. The dip, and whether there is enough torque left to accelerate. */
      if (!r.dip) return;
      var need = torqueNeeded(pn.loadTorque);
      if (need !== null && r.dip.torqueAvail < need) {
        add('bad', kind, pn.id, what + ' will not accelerate — the dip leaves too little torque',
          'At ' + r.dip.pct.toFixed(1) + '% dip on ' + (r.board ? r.board.tag : 'its board') +
          ' the motor has ' + r.dip.motorV.toFixed(0) + ' V across it, so its starting torque falls to ' +
          r.dip.torqueAvail.toFixed(2) + ' of full load against the ' + need +
          ' this load needs. Torque goes as the square of voltage, which is why a dip that looks ' +
          'modest on the schedule matters. The motor will stall, and a stalled motor draws more current ' +
          'than one accelerating, so the dip deepens. Reduce the starting current — a drive or soft ' +
          'starter — or improve the supply at that board.', 'start-torque', sc.amps, 'A');
        return;
      }
      if (r.dip.pct > 10 && sc.multiple >= 4) {
        add('warn', kind, pn.id, what + ' starting dips ' + (r.board ? r.board.tag : 'its board') + ' by ' + r.dip.pct.toFixed(1) + '%',
          sc.multiple + ' × full load current' + groupWord + ' pulls the board down by ' +
          r.dip.volts.toFixed(0) + ' V, leaving ' + r.dip.motorV.toFixed(0) + ' V during the start and ' +
          r.dip.torqueAvail.toFixed(2) + ' × full load torque' +
          (need === null ? '' : ', against the ' + need + ' this load needs') + '. Every other circuit on ' +
          'that board sees the dip as well, and a contactor elsewhere drops out if it is already close ' +
          'to its holding voltage. The impedance comes from the ' + r.faultKA.toFixed(1) +
          ' kA fault level at this board, so it is only as good as that — and the fault level rests on ' +
          'the assumed transformer impedance.', 'start-dip', sc.amps, 'A');
      }
    }

    /* The earthing arrangement against one circuit. Reported per circuit rather
       than per board because the fault is in the cable: a four-core feeder on a
       TN-S installation is not a neutral problem at the board, it is a PEN that
       re-bonds earth to neutral at every downstream point, which is the
       arrangement the S exists to avoid. */
    function checkEarthing(p, pn) {
      var c = neutralCheck(p, pn);
      if (!c) return;
      var arr = c.arr;
      /* The honest form of this check. A four-core three-phase feeder is normal
         and correct on TN-S: three phases and a neutral, with the protective
         conductor formed separately or carried alongside in the same duct. The
         arrangement is only broken when the neutral is doing the PE's job, and
         the core count alone cannot tell you that — 4 cores plus a separate PE
         is the same cable as 4 cores that are a PEN. So this asks the question
         rather than reporting a fault it cannot establish, and it stays at info
         for the same reason. */
      var declared = p.design && p.design.peArrangement;
      if (!isSpare(pn) && declared === 'pen' && c.needsNeutral && c.cores === 4 && !c.peInCable) {
        /* The arrangement is declared to be a PEN, and this feeder is carrying a
           neutral in a four-core cable without saying the fourth core is it.
           That is the one combination that is actually broken: the neutral is
           earthed and not switched, and the cable's protective conductor has not
           been counted anywhere in this schedule. */
        add('bad', 'panel', pn.id, pn.tag + ' — fourth core not accounted for on a PEN arrangement',
          'The earthing arrangement is declared as a combined protective and neutral conductor, and this ' +
          'feeder has ' + c.cores + ' cores carrying ' + c.needsNeutral + ' phase and a neutral with no ' +
          'separate protective conductor. On a PEN the neutral is earthed and must not be interrupted, so the ' +
          'neutral needs its own device, and the cable\'s fourth core is the earth reference for everything ' +
          'downstream of it. Either declare the arrangement as separate — which is the normal case on TN-S — or ' +
          'state the protective conductor on this feeder.',
          'pe-method', num(pn.kw, 0));
        return;
      }
      if (!isSpare(pn) && declared && c.needsNeutral && c.cores === 4 && c.peInCable) {
        /* The other contradiction, and the harmless-looking one: the feeder says
           its protective conductor is in the cable while the arrangement says
           the cable carries a neutral. Both can be true — a five-core cable, or a
           neutral that is not the PEN — so this asks which rather than assuming. */
        add('info', 'panel', pn.id, pn.tag + ' — protective conductor in the cable, arrangement declared separate',
          'The earthing arrangement is declared as a separate protective conductor, and this feeder carries its ' +
          'own. That is consistent — a five-core cable, or a neutral that is not a PEN — but the arrangement ' +
          'setting is what the rest of the project is calculated against, so it is worth saying which of the two ' +
          'this is.',
          'pe-method', num(pn.kw, 0));
        return;
      }
      if (!isSpare(pn) && !declared && c.needsNeutral && arr.system === 'TN-S' && c.cores === 4 && !c.peInCable) {
        add('info', 'panel', pn.id, pn.tag + ' — confirm how the protective conductor is provided',
          'Four cores to a three-phase circuit carries three phases and a neutral, which is correct for TN-S ' +
          'provided the protective conductor is formed separately. If this cable\'s fourth core is in fact the ' +
          'earth conductor, then this feeder is a PEN and the installation is TN-C-S from here down whatever it ' +
          'is called upstream: the neutral is no longer safe to interrupt, and losing it removes the earth ' +
          'reference from every board beyond it. Nothing in a cable schedule distinguishes those two cases, so ' +
          'this is worth confirming against how the feeder is actually installed.',
          'pe-method', num(pn.kw, 0));
        return;
      }
      /* Three-pole feeder to a machine that needs an earth reference. Not an error
         — a three-pole motor feeder is correct as built — but it means the
         circuit contributes nothing to the neutral's loading, and saying so stops
         someone later treating it as a source of neutral current. */
      if (!c.needsNeutral && pn.neutral === false) {
        add('info', 'panel', pn.id, pn.tag + ' is three-pole, so it does not load the neutral',
          'No neutral conductor, so the third harmonic in this load circulates in the machine rather than ' +
          'returning along a neutral bar. The neutral current at its board comes from elsewhere — from the ' +
          'single-phase circuits, or from any three-phase and neutral circuits on it.');
      }
    }

    /* The neutral. Reported per board, from the declared harmonic content of
       the single-phase circuits on it. */
    function checkNeutral(p, item, kind, st) {
      var n = st.neutral;
      if (!n || (n.thirdAmp <= 0 && n.imbalanceAmp <= 0)) return;
      /* What the neutral would carry with a full-size conductor of the same
         size as the phases. The ampacity comparison uses the phase conductor's
         rating as a proxy, which is right for a multicore cable and indicative
         for a separate one. */
      var phaseCsa = st.neutralPhaseCsa;
      if (!(phaseCsa > 0)) return;
      var cab = { csa: phaseCsa, runs: 1, cores: 4, len: 1, method: 'XL-A1', group: 3, ambient: 40, sheathed: true };
      var rated = cableRating(cab).derated;
      /* Imbalance and triplen are both real loads on the conductor and both
         count against its rating. Previously only the triplen did, which on a
         TN-S board with no declared harmonics at all reported nothing — and a
         neutral carrying imbalance is still a neutral carrying current. */
      var total = n.amps + n.imbalanceAmp;
      var over = total > rated;
      /* Two conductors, and they are not in the same state.

         `amps` is what this board's INCOMER neutral carries. `thirdAmp` is what
         the board's own neutral BAR and its feeder carry, because the triplen
         from the three-phase and neutral circuits below has to return through
         them whatever the transformer does. A delta on the LV winding zeroes the
         first and leaves the second untouched.

         Gating this on `ampsIfUnblocked <= rated` tested the INCOMER's
         hypothetical loading against the BAR's conductor, so the boards that
         needed it most — a big one, badly loaded — fell through to the generic
         path and printed "neutral carries 0 A — more than its conductors", which
         is nonsense and reads as reassurance. Each is now judged against the
         conductor that actually carries it. */
      if (n.blocked) {
        /* The delta keeps zero-sequence out of the INCOMER. It does nothing for
           the board's own neutral bar, which the triplen from the three-phase and
           neutral circuits below still has to return through — and that is where
           the current actually is on a board like this one.

           Getting this wrong in the reassuring direction is the easy mistake: the
           vector group is specified, the finding reports "protected", and a neutral
           bar carrying 159 % of a phase conductor is never looked at. So the two
           are reported separately, and the local bar is judged against its own
           conductors whatever the incomer is doing. */
        var localOver = n.thirdAmp > rated;
        if (localOver || n.thirdAmp > n.maxPhase * 0.6) {
          add(localOver ? 'bad' : 'warn', kind, item.id,
            item.tag + ' neutral bar carries ' + n.thirdAmp.toFixed(0) + ' A' +
            (localOver ? ' — more than its conductors' : ''),
            'The ' + st.vectorGroup + ' vector group keeps zero-sequence current out of this board\'s INCOMER, ' +
            'and nothing comes back along that conductor: it would carry ' +
            n.ampsIfUnblocked.toFixed(0) + ' A on a star-star group. That part is settled. ' +
            'But the board\'s own neutral bar and its feeder are a different conductor and a different ' +
            'question — the third harmonic from the ' + n.threePhase.length + ' three-phase and neutral ' +
            'circuits below has to return through it, because a delta on the transformer is too far away ' +
            'to help. It carries ' + n.thirdAmp.toFixed(0) + ' A, which is ' +
            (n.maxPhase ? (n.thirdAmp / n.maxPhase * 100).toFixed(0) + '% of a phase conductor' :
              'a large fraction of the load') + '. ' +
            (localOver ? 'That exceeds what a ' + phaseCsa + ' mm² conductor carries — about ' +
              rated.toFixed(0) + ' A here — so this neutral has to be enlarged, or the circuits below it ' +
              'have to be split across more boards so that no one bar carries all of it. ' :
              'On a ' + phaseCsa + ' mm² neutral, about ' + rated.toFixed(0) + ' A, that leaves margin but ' +
              'not much. ') +
            'The usual fix is not a larger conductor but a 4 % impedance reactor or a 3rd-harmonic ' +
            'filter at the drive, which removes the harmonic at the load rather than carrying it ' +
            'everywhere.');
        }
        /* The delta's credit, reported independently of the bar rather than in
           place of it. These are two facts about two different conductors: a
           reader shown only "the vector group protects the neutral" has been told
           something true and something dangerously incomplete, and an else-if made
           the note vanish on exactly the boards with the worst bar loading. */
        if (n.ampsIfUnblocked > n.maxPhase * 0.6 || n.ampsIfUnblocked > rated) {
          add('info', kind, item.id,
            item.tag + ' incoming neutral protected by the ' + st.vectorGroup + ' vector group',
            'The delta on the low-voltage winding stops zero-sequence current reaching this incomer, so its ' +
            'neutral conductor carries nothing at all. Without it this feeder would put ' +
            n.ampsIfUnblocked.toFixed(0) + ' A into that conductor — ' +
            (n.maxPhase ? (n.ampsIfUnblocked / n.maxPhase * 100).toFixed(0) + '% of a phase conductor' : 'a large fraction of the load') +
            (n.ampsIfUnblocked > rated ? ', and over what a ' + phaseCsa + ' mm² neutral carries (about ' +
              rated.toFixed(0) + ' A)' : '') + '. Worth recording on the specification: a star-star group ' +
            'here would mean sizing every incomer neutral for its own third harmonic, and the same cost would ' +
            'buy nothing. Note this protects the incomer only — the board\'s neutral bar, if it is carrying ' +
            'anything, is a separate conductor the delta cannot help.');
        }
        return;
      }

      /* Only the star-star case reaches here: the delta case returned above with
         its own wording, because the two conductors are not in the same state. */
      var passTotal = n.amps + n.imbalanceAmp;
      /* Judged on BOTH conductors. With a star-star the incoming neutral carries
         the triplen as well as the board's own bar, and either can be the one
         that is too small. */
      var passOver = passTotal > rated || n.thirdAmp > rated;
      var where = 'The ' + st.vectorGroup + ' vector group is star-star, so the third harmonic passes through: ' +
        'the currents add in the neutral instead of cancelling, and the incoming conductor carries ' +
        n.amps.toFixed(0) + ' A against a phase conductor of ' + n.maxPhase.toFixed(0) + ' A, while the ' +
        'board\'s own bar carries ' + n.thirdAmp.toFixed(0) + ' A of it.';

      /* Where the load actually is. A board of three-pole motor feeders has a
         neutral conductor carrying almost nothing, and one of three-phase and
         neutral circuits full of drives has the opposite problem. The two were
         previously reported identically, which is how a genuinely overloaded
         neutral goes unremarked on a real site. */
      var tp = n.threePole, threeN = n.threePhase.length;
      var where3p = tp > 0 && threeN > 0
        ? ' ' + threeN + ' three-phase circuit' + (threeN === 1 ? '' : 's') + ' on this board have a neutral conductor and ' +
          tp + ' three-pole circuit' + (tp === 1 ? ' has' : 's have') + ' not, so only the first group loads it.'
        : threeN > 0 && tp === 0
          ? ' All ' + threeN + ' three-phase circuits on this board carry a neutral, and their triplen currents add in it — ' +
            'three times the per-phase value, which is why drives and switch-mode loads are the usual cause of an ' +
            'undersized neutral.'
          : tp > 0 && threeN === 0
            ? ' Every three-phase circuit on this board is three-pole, so none of them can put zero-sequence current ' +
              'into the neutral bar. The conductor is here for the single-phase circuits and for earth reference.'
            : '';

      add(passOver ? 'bad' : total > rated * 0.6 ? 'warn' : 'info', kind, item.id,
        item.tag + ' neutral carries ' + total.toFixed(0) + ' A' +
        (passOver ? ' — more than its conductors' : '') +
        (n.imbalanceAmp > 0 ? ' (third harmonic ' + n.amps.toFixed(0) + ' A, imbalance ' + n.imbalanceAmp.toFixed(0) + ' A)' : ''),
        where + where3p + ' The neutral is sized here as the same cross-section as the phases (' + phaseCsa +
        ' mm², about ' + rated.toFixed(0) + ' A), which is the convention: the usual reduced-size neutral assumes a balanced ' +
        'load, and a balanced load is exactly what is not present here. ' +
        n.declared + ' of ' + (n.declared + n.undeclared + n.ruledOut) + ' circuits on this board put triplen in the ' +
        'neutral. ' + (n.ruledOut ? n.ruledOut + ' are ruled out by their load type — a drive is a balanced ' +
        'three-phase rectifier whose harmonics are 5th and 7th, and its third harmonic cancels between the phases ' +
        'before it reaches any conductor. ' : '') +
        'Third harmonic comes from single-phase switch-mode loads: control supplies, PLC racks, instrumentation, ' +
        'LED drivers. A measured spectrum overrides any of this, and a board of drives with no control loads on it ' +
        'has a neutral that carries nothing.');
    }


    /* `deviceOnly` asks the questions that are about the DEVICE alone — does it
       exist, is its setting coherent, can it interrupt the fault — and skips the
       ones that compare the device against a conductor or a load. It is what an
       unterminated spare way gets: a breaker that is fitted and rated but has
       nothing connected to it, so it cannot be too large for a cable and there is
       no load for it to be under. */

    function checkProt(p, item, kind, loadA, cableA, faultKA, deviceOnly) {
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
      /* Everything above is a question about the device alone — does it exist, is
         its setting coherent, is its frame big enough, can it interrupt the
         fault. That is the whole of what can be asked about an unterminated
         spare way, and the first of the questions below is the first that needs
         a conductor to compare against. Everything from here to the end of the
         function is about the circuit the device protects, which a spare way
         does not have. */
      if (deviceOnly) return;

      /* A busbar feeder has no cable, so every comparison against a cable table
         below is meaningless — and comparing a 5,000 A incomer with the biggest
         cable in the schedule reports a fault that cannot be fixed, when the
         feeder is a busbar and always was. Its own two questions are asked
         instead: its rating against the load, and its withstand against the
         fault. */
      var bb = busbarCheck(p, item, kind, loadA, faultKA);
      if (bb) bb.problems.forEach(function (pr) { add(pr.level, kind, item.id, pr.title, pr.detail); });

      /* The device protects the conductor as much as the load. A device set
         well above the cable's ampacity will let the cable reach its thermal
         limit before the device trips. */
      if (!isBusbar(item) && cableA && ir > cableA) {
        var ceiling = maxCableA(p, item.cable || {});
        if (ceiling && ir > ceiling) {
          /* Past what parallel copper can carry, a bigger core does not help.
             Saying so is more use than "the cable is too small", which invites
             someone to keep adding runs that will never be enough. */
          add('bad', kind, item.id, item.tag + ' incomer is above what a cable can carry',
            'A ' + ir + ' A device needs a feeder rated ' + ir + ' A. The most ' + D.MAX_CABLE_RUNS +
            ' parallel ' + D.CSA[D.CSA.length - 1] + ' mm² cables give is about ' + Math.round(ceiling) +
            ' A in this installation, so this incomer wants a busbar, not more copper — above about ' +
            '2,500 A it is one in practice, from the transformer to the main board. Declare it in the ' +
            'Busbar field on this board: the cable checks then stop asking and the busbar\'s own rating ' +
            'and short-time withstand are checked instead, which is the pair of questions that actually ' +
            'decides whether the conductor survives.');
        } else {
          add('bad', kind, item.id, item.tag + ' device too large for its cable',
            'Set to ' + ir + ' A on a cable rated ' + cableA.toFixed(0) +
            ' A. The cable will overheat before the device trips. The device must not exceed the cable rating.');
        }
      }
      /* There is deliberately nothing here for a device that FITS its cable.

         BS 7671 433.1 asks for the protective device not to exceed the current
         carrying capacity of the cable it protects, and the check above enforces
         exactly that: a device over the cable rating is an error and says so. So
         a device sitting between 95% and 100% of the cable is not a near miss —
         it is the requirement being met with nothing to spare, which is what a
         correctly matched device looks like. On this project it reported a
         1,000 A device on a 1,022 A cable at 2% and an 800 A on an 802 A at 0%,
         and both of those are the design working: the cable will not overheat
         before the device trips, which is the whole point of choosing the two
         together.

         It used to be reported as information on the reasoning that tight
         matching was worth knowing about. It is not, and reporting it teaches the
         reader that findings are noise — which is how the real ones above get
         missed. A finding has to be something a person would change. */
    }

    p.pdbs.forEach(function (b) {
      var st = boardStats(p, b, 'pdb');
      var cab = b.cable && b.cable.csa ? cableRating(b.cable) : null;
      var fB = faultLevel(p, b, 'pdb');
      checkProt(p, b, 'pdb', st.amp, cab && cab.derated, fB ? fB.kA : st.faultKA);
      if (!isBusbar(b)) checkWithstandFinding(p, b, 'pdb', fB ? fB.kA : st.faultKA);
      checkReactive(p, b, 'pdb', st);
      checkEarthFault(p, b, 'pdb');
      checkNeutral(p, b, 'pdb', st);
    });
    p.pdps.forEach(function (d) {
      var st = boardStats(p, d, 'pdp');
      var cab = d.cable && d.cable.csa ? cableRating(d.cable) : null;
      var fD = faultLevel(p, d, 'pdp');
      checkProt(p, d, 'pdp', st.amp, cab && cab.derated, fD ? fD.kA : st.faultKA);
      if (!isBusbar(d)) checkWithstandFinding(p, d, 'pdp', fD ? fD.kA : st.faultKA);
      checkReactive(p, d, 'pdp', st);
      checkEarthFault(p, d, 'pdp');
      checkNeutral(p, d, 'pdp', st);
    });
    p.dbs.forEach(function (b) {
      var st = boardStats(p, b, 'db');
      var cab = b.cable && b.cable.csa ? cableRating(b.cable) : null;
      var fB2 = faultLevel(p, b, 'db');
      checkProt(p, b, 'db', st.amp, cab && cab.derated, fB2 ? fB2.kA : st.faultKA);
      if (!isBusbar(b)) checkWithstandFinding(p, b, 'db', fB2 ? fB2.kA : st.faultKA);
      checkReactive(p, b, 'db', st);
      checkEarthFault(p, b, 'db');
    });
    p.panels.forEach(function (pn) {
      if (!pn.pdpId && !pn.pdbId) return;
      var d = panelDemand(p, pn);
      /* A fitted but unterminated spare way: the device is installed and rated,
         so it still has to be a device that can interrupt the fault — the moment
         anything is connected to that way, the question is live. Everything that
         assumes a conductor going somewhere is skipped, because there is no
         conductor: no thermal withstand, no loop, no protective conductor, no
         harmonics, no starting, no earthing.

         Skipping the whole item instead was wrong and lost a real check: it is
         the one thing a spare breaker still has to get right. */
      if (isSpare(pn)) {
        checkProt(p, pn, 'panel', 0, null, deviceFaultKA(p, pn, 'panel'), true);
        return;
      }
      var cab = pn.cable && pn.cable.csa ? cableRating(pn.cable) : null;
      /* Two levels, deliberately. The device sits on the board above, so its
         breaking capacity and its grading are about the fault there. The feeder
         is tested against the fault at its own far end, which its own impedance
         largely determines. */
      var fAtLoad = faultLevel(p, pn, 'panel');
      checkProt(p, pn, 'panel', d.ampHarm, cab && cab.derated, deviceFaultKA(p, pn, 'panel'));
      checkWithstandFinding(p, pn, 'panel', fAtLoad ? fAtLoad.kA : faultAt(p, pn, 'panel'));
      checkHarmonics(p, pn, 'panel');
      checkImpossiblePf(p, pn);
      checkEarthFault(p, pn, 'panel');
      if (motorTypeUnstated(pn)) {
        /* Not a fault. A gap, and the gap is that nobody can say whether this
           panel starts a motor.

           The whole starting analysis is keyed off the panel type, and a type this
           list has never heard of falls straight through it — no inrush is
           calculated and nothing is reported, which reads exactly like a machine
           that does not exist. On this project that is eighteen circuits, and the
           first version of this finding did not exist because every one of them
           was silently excluded rather than reported.

           The remedy is one field on the schedule. A panel that starts a motor
           says so and gets its starting current checked against the board above;
           one that does not says that too, and stops being a question. */
        add('info', 'panel', pn.id,
          pn.tag + ' — the load type does not say whether this panel starts a motor',
          'Type "' + (pn.type || 'unset') + '" is not one the application recognises ' +
          'as rotating machinery, and it is not one it can rule out either, so no ' +
          'starting current has been calculated for this circuit and nothing has been ' +
          'checked about whether the board above survives it. That is a gap in the ' +
          'schedule rather than a fault in it: if this panel starts a motor, its ' +
          'inrush is unexamined, and a drive-fed panel commonly draws several times ' +
          'its running current for a second or two. Declare it on the Starting method ' +
          'field — direct on start is the honest answer for most, and a soft-starter ' +
          'or VFD feed changes the number materially.', 'motor-type');
      }
      checkStarting(p, pn, 'panel');
      checkEarthing(p, pn);
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

      /* The largest fault this pair can see, at the lower device's busbar. A
         fault beyond that never reaches the lower device and is a breaking
         capacity question, not a grading one. */
      /* The fault this pair can see, at the lower device own terminals.
         deviceFaultKA() rather than the per-stage estimate: this is the last
         place the old approximation survived, and it was the reason the grading
         search and the grading check could disagree — the search verified a
         setting against one figure and the check then tested it against another,
         so a plan that had genuinely solved a pair still reported it. */
      var fKA = deviceFaultKA(p, item, kind === 'panel' ? 'panel' : kind);
      var s = selectivity(item, kind, up, upKind, fKA ? fKA * 1000 : null);
      if (!s || s.pass) return;

      /* Overload overlap and short-circuit overlap are both reported as a
         warning. Neither is automatically wrong — the alternative is often to
         accept a deliberate compromise — but both have to be a decision rather
         than an accident, and only a deliberate one is visible. */
      /* Two keys, not one, because a board and a circuit are different problems:
         a board that is not selective with the board above it is a coordination
         setting, while a final circuit that is not selective with the board it
         sits on is usually a deliberate compromise and is far more common. The
         key is what lets thirty-four instances of the second read as one row
         naming the boards, instead of thirty-four lines saying the same thing. */
      /* The delay the grading plan wants on the device above, so the finding
         carries a number instead of an idea — and where the plan has none,
         carries the reason instead. */
      var hint = (function () {
        var chUp = chain(p, item);
        var upKindFor = item.dbId ? 'db' : (chUp.pdp ? 'pdp' : 'pdb');
        var d = delayFor(p, item, kind === 'panel' ? 'panel' : kind, up, upKindFor);
        if (!d) return null;
        if (d.delay !== null) {
          return 'Set the ' + up.tag + ' short-time delay to ' + d.delay + ' s' +
            (up.prot && num(up.prot.sd, 0) && Number(up.prot.sd) !== d.delay
              ? ' — it is set to ' + up.prot.sd + ' s now, which grades the pairs ' +
                'below but not this one'
              : '') + '.';
        }
        if (d.reason === 'nothing-below' || d.reason === 'final-circuit') return null;
        return d.detail ? 'Grading: ' + d.detail : null;
      })();
      add('warn', kind, item.id,
        item.tag + ' not selectively graded against ' + up.tag +
        (s.regime === 'overload' ? ' (overload)' : ' (above ' + s.fromKA.toFixed(1) + ' kA)'),
        selectivityMessage(s, item.tag, hint) +
        ' The curves used are the conventional envelopes from IEC 60898 and IEC 60947-2, not the ' +
        'manufacturer\'s, so this says the two settings do not separate — check the actual curves before changing anything.',
        kind === 'panel' ? 'selectivity-circuit' : 'selectivity-board',
        num(kind === 'panel' ? item.kw : 0, 0));
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
    /* The vector group is not a nameplate detail here. Whether the low-voltage
       winding has a delta decides whether third harmonic can reach the incoming
       neutral at all — the difference between a neutral carrying hundreds of
       amps and carrying none. The app assumes Dyn11 when nothing is declared,
       which quietly makes every neutral look protected, and that assumption is
       not free to make on someone's installation. */
    p.txs.forEach(function (t) {
      if (t.vecGroup) return;
      /* Only worth asking where there is something for it to protect. */
      var feeds = p.pdbs.filter(function (b) { return b.txId === t.id; }).length;
      if (!feeds) return;
      var nThreePN = 0;
      p.panels.forEach(function (pn) {
        var ch = chain(p, pn);
        if (!ch.tx || ch.tx.id !== t.id) return;
        if (LC.isThreePhaseWithNeutral(pn)) nThreePN++;
      });
      if (!nThreePN) return;
      add('warn', 'tx', t.id, t.tag + ' vector group not stated, and ' + nThreePN + ' three-phase and neutral circuits depend on it',
        'Assumed Dyn11, which puts a delta on the low-voltage winding and keeps zero-sequence current out of ' +
        'the incoming neutral. Nothing on the project says so. A star-star group instead would let the third ' +
        'harmonic through, the triplens from every three-phase and neutral circuit would add in the neutral at ' +
        'three times the per-phase value, and the neutral conductors on the boards above would need to be ' +
        'larger than the phase conductors to carry it. It costs the same either way on the order — a delta ' +
        'here is the cheapest available fix and the specification should say so.',
        'vector-group', nThreePN, 'circuits');
    });

    /* The assumed transformer impedance, stated first because everything below
       depends on it.

       %Z sets the fault level, and the fault level sets the minimum conductor a
       feeder may use, the breaking capacity a device needs, and whether the
       coordination holds. On a real project the field default of 6% gave 73 kA,
       which failed a 16 mm² feeder's thermal withstand — and at 10% the fault is
       44 kA and the same feeder passes easily.

       A finding buried at the bottom of a list of 200 is not a finding. This one
       goes at the top, with the numbers, so nobody acts on the conclusions
       before seeing the assumption they rest on. */
    (p.txs || []).forEach(function (tx) {
      if (num(tx.kva, 0) <= 0) return;
      var zpu = num(tx.impZ, 6);
      if (!isFinite(zpu) || zpu <= 0) zpu = 6;
      var v = Math.max(50, num(tx.kvOut, 0.415) * 1000);
      var kA = (num(tx.kva, 0) * 1000 / (Math.sqrt(3) * v)) / (zpu / 100) / 1000;
      /* The minimum conductor a 20 ms device needs at this fault level. Shown
         because it turns an abstract impedance into a cable size. */
      var minCsa = Math.ceil(kA * 1000 * Math.sqrt(0.02) / 143);
      /* Only an EXPLICIT tick on the nameplate counts as stated. Blank, and the
         field default stands as an assumption — which is the whole point of
         recording the flag separately from the number. The test of it is `===
         true` rather than `!== false`, because the common case is the one that
         has not been ticked and it must not be the one that reads as stated. */
      if (tx.impZStated !== true) {
        add('warn', 'tx', tx.id, tx.tag + ' impedance is an assumption, not a fact',
          'Percent impedance is not stated for this transformer, so ' + zpu.toFixed(1) +
          '% has been assumed — a usual figure for a distribution transformer, and nothing more. ' +
          'That single number sets the fault level at ' + kA.toFixed(1) + ' kA, and the fault level ' +
          'sets the smallest conductor a feeder may use: at ' + kA.toFixed(0) +
          ' kA a device clearing in 20 ms needs about ' + minCsa + ' mm². Every thermal withstand, ' +
          'breaking capacity and coordination finding below is computed from this figure. ' +
          'It is on the transformer nameplate or in its test certificate — one number, and the whole ' +
          'protection case stops being an estimate. If the transformer is one of a pair on a common ' +
          'LV board, the impedance has to be checked against the shared contribution as well.' +
          (function () {
            var rows = impedanceSensitivity(p, tx);
            if (rows.length < 3) return '';
            return ' What the figure is worth, computed the same way as the findings above: ' +
              rows.map(function (r) {
                return r.z + '% → ' + r.kA.toFixed(0) + ' kA and ' +
                  (r.minCsa === null ? 'beyond the standard range' : r.minCsa + ' mm² minimum');
              }).join('; ') + '. The answer changes how much copper the feeders want, and ' +
              'does not change whether they want it — so the design work does not wait for the ' +
              'nameplate, the cable order does.';
          })(),
          'impz-assumed', num(tx.kva, 0), 'kVA');
      } else {
        add('info', 'tx', tx.id, tx.tag + ' impedance ' + zpu.toFixed(1) +
          '% gives a fault level of ' + kA.toFixed(1) + ' kA',
          'Taken as stated. The smallest conductor a feeder may use at that fault level, with a device ' +
          'clearing in 20 ms, is about ' + minCsa + ' mm².',
          'impz-stated', num(tx.kva, 0), 'kVA');
      }
    });
    /* Power factor correction, assessed where a bank is actually connected: at
       the main board, against the whole site. Sizing it is exact arithmetic; the
       finding that matters is whether the bank's resonance lands on a harmonic
       the site produces, which is a drive-fed site's standing problem. */
    p.pdbs.forEach(function (pdb) {
      if (!pdb.txId) return;
      var banks = pdb.capacitors || [];
      var fitted = banks.length ? num(banks[0].kvar, 0) : 0;
      var st = boardStats(p, pdb, 'pdb');
      var fit = pfCorrection(p, st, num(p.design.pfTarget, 0.98), fitted);
      if (!fit) return;

      if (!fitted) {
        /* Only worth raising when it is worth doing. Inside the penalty limit
           the arithmetic is interesting and the answer is "no". */
        if (!fit.worthIt || fit.kvarNeeded < 1) return;
        add('info', 'tx', pdb.txId, 'site power factor ' + fit.pfNow.toFixed(3) + ' — ' +
          fit.kvarNeeded.toFixed(0) + ' kvar of correction available',
          'At the target power factor of ' + fit.target + ' this supply would take about ' +
          fit.kvarNeeded.toFixed(0) + ' kvar of correction and release ' + fit.kvaSaving.toFixed(0) +
          ' kVA of transformer and feeder capacity. On a drive-fed supply that bank would be ' +
          'detuned: every circuit below this board is a drive panel, and an undetuned bank ' +
          'resonates against the source at a multiple of 50 Hz that can land on the 5th or 7th ' +
          'harmonic a six-pulse converter produces. Nothing is specified here — this is the ' +
          'arithmetic, and whether to spend on it is a commercial decision.',
          'pf-available', fit.kvarNeeded, 'kvar');
        return;
      }

      var res = capResonance(p, faultAt(p, pdb, 'pdb'), fitted, banks[0].detune);
      var where = 'A ' + fitted.toFixed(0) + ' kvar bank at ' + pdb.tag;

      if (fit.overCorrected) {
        add('bad', 'pdb', pdb.id, pdb.tag + ' capacitor bank larger than the reactive load',
          where + ' supplies more than the ' + fit.kvarNow.toFixed(0) + ' kvar of reactive power on ' +
          'the load. The surplus goes back up the supply: the power factor leads, the reactive ' +
          'quarter of the meter runs backwards, and some supplies treat that as a fault rather ' +
          'than as correction. Size the bank to the measured kvar, not to the calculated one.');
        return;
      }
      var res7 = capResonance(p, faultAt(p, pdb, 'pdb'), fitted, 7);
      if (res && res.onHarmonicDetuned) {
        add('bad', 'pdb', pdb.id, pdb.tag + ' capacitor bank resonates on a drive harmonic',
          where + ', with a ' + (res.detune || 0) + '% detuning reactor, resonates at ' +
          (res.fDetuned * 50).toFixed(0) + ' Hz — ' + res.fDetuned.toFixed(2) + ' × the ' +
          'fundamental, which is the ' + res.nearestDetuned.order + 'th harmonic. Every circuit ' +
          'on this supply is a drive panel, and a six-pulse converter produces that harmonic in ' +
          'quantity. At resonance the harmonic current sees a low impedance and the voltage ' +
          'across the capacitor rises, which is what fails capacitors. A 7% reactor would put ' +
          'it at ' + (res7 ? res7.fDetuned.toFixed(2) : '3.78') + ' × — below the 5th, where a ' +
          'six-pulse drive produces nothing.');
        return;
      }
      if (res && !res.belowFirst) {
        add('warn', 'pdb', pdb.id, pdb.tag + ' capacitor bank resonance close to a drive harmonic',
          where + ' resonates at ' + (res.fDetuned * 50).toFixed(0) +
          ' Hz, ' + res.fDetuned.toFixed(2) + ' × the fundamental. That is between the harmonics ' +
          'rather than on one, but above the 5th where the drives produce their largest, and it is ' +
          'not where a bank is usually chosen to sit. A 7% reactor would move it to ' +
          (res7 ? res7.fDetuned.toFixed(2) : '3.78') + ' × — below the 5th — at a cost of about ' +
          (fitted * 0.07).toFixed(0) + ' kvar of output.');
        return;
      }
      add('info', 'pdb', pdb.id, pdb.tag + ' power factor corrected to ' + fit.achieved.toFixed(3),
        where + ' brings ' + fit.pfNow.toFixed(3) + ' to ' +
        fit.achieved.toFixed(3) + ', releasing ' + fit.releasedKva.toFixed(0) + ' kVA of ' +
        'transformer and feeder capacity. Its resonance is at ' + (res.fDetuned * 50).toFixed(0) +
        ' Hz, ' + res.fDetuned.toFixed(2) + ' × the fundamental — below the 5th harmonic, which ' +
        'is where a drive-fed supply wants it' + (res.detune ? ', with a ' + res.detune.toFixed(0) +
        '% detuning reactor delivering ' + res.delivered.toFixed(0) + ' kvar of the ' + fitted.toFixed(0) : '') + '.');
    });
    /* Demand and coincidence. Two methods exist and they are alternatives, not
       layers; and a per-circuit ratio far below what the duty cycles can support
       is worth a second look, because it is the assumption the whole supply size
       rests on. */
    (p.pdbs || []).forEach(function (pdb) {
      if (!pdb.txId) return;
      var m = demandMethods(p, pdb, 'pdb');
      if (!(m.connectedKva > 0)) return;

      /* A ratio this low means the schedule assumes the board runs at a small
         fraction of its connected load. That can be right — a bank of identical
         pumps genuinely does not all run at once — but it is a big claim and it
         sizes the transformers, so it is asked about rather than assumed. */
      if (m.perCircuitRatio < 0.35) {
        var lowest = m.bands.slice().sort(function (a, b) { return a.kva - b.kva; })[0];
        var pn = boardStats(p, pdb, 'pdb').panels;
        var nLow = pn.filter(function (x) { return D.num(x.demand, 1) < 0.35; }).length;
        /* What the assumption is actually worth.

           The transformer order rests on this number, so the question is not
           whether 0.30 is right — it is whether the ORDER would be different if
           it were wrong. The two methods bracket the answer, and an order that
           survives both ends of the bracket does not need the number settled
           before it is placed. Saying so is the difference between this finding
           holding up a purchase order and this finding being something to confirm
           at commissioning. */
        var installed = p.txs.reduce(function (a, t) { return a + num(t.kva, 0); }, 0);
        var sitePer = 0, siteCoin = 0;
        (p.pdbs || []).forEach(function (b2) {
          if (!b2.txId) return;
          var m2 = demandMethods(p, b2, 'pdb');
          if (!(m2.connectedKva > 0)) return;
          sitePer += m2.perCircuitKva;
          siteCoin += m2.connectedKva * lowest.factor;
        });
        var bracket = installed > 0 && sitePer <= installed && siteCoin <= installed;
        add('warn', 'pdb', pdb.id, pdb.tag + ' runs at ' +
          (m.perCircuitRatio * 100).toFixed(0) + '% of its connected load',
          'The per-circuit demand factors on this board sum to ' +
          m.perCircuitRatio.toFixed(2) + ' of the connected load, giving ' +
          m.perCircuitKva.toFixed(0) + ' kVA against ' + m.connectedKva.toFixed(0) +
          ' kVA connected. ' + nLow + ' of ' + pn.length + ' circuits are below 0.35' +
          (nLow ? ', and the lowest is ' + Math.min.apply(null, pn.map(function (x) { return D.num(x.demand, 1); })).toFixed(2) : '') +
          '. That may be right — these are drive panels, and a board of drives ' +
          'seldom runs flat out — but it is the single assumption the transformer ' +
          'size rests on, and a factor this low is worth confirming against ' +
          'measured data rather than taking from the vendor’s sheet. The same ' +
          'diversity expressed as a coincidence factor would land at about ' +
          lowest.factor.toFixed(2) + ' and give ' + lowest.kva.toFixed(0) + ' kVA; the two ' +
          'methods are alternatives and applying both would give ' +
          (lowest.kva * m.perCircuitRatio).toFixed(0) + ' kVA, which is ' +
          ((1 - m.perCircuitRatio) * 100).toFixed(0) + '% below the honest answer. ' +
          'What the assumption is worth: applied across the whole site the ' +
          'per-circuit factors give ' + sitePer.toFixed(0) + ' kVA and the same ' +
          'diversity expressed as a coincidence factor gives ' + siteCoin.toFixed(0) +
          ' kVA, against ' + installed.toFixed(0) + ' kVA of transformer installed. ' +
          (bracket
            ? 'Both ends of that bracket sit inside what is installed, so the ' +
              'transformer order does not depend on which of them is right — the ' +
              'assumption moves the running load, not the capacity. Confirm it ' +
              'against measured data before commissioning; it does not hold up the order. '
            : 'One end of that bracket is outside what is installed, so the ' +
              'transformer order DOES depend on this number and it has to be settled ' +
              'before the transformers are ordered. '),
          'demand-ratio', m.connectedKva, 'kVA');
      }

      /* The method in force, stated where a reader will meet it. */
      if (m.method === 'coincidence' && !p.design.demandMethodBand) {
        add('warn', 'pdb', pdb.id, pdb.tag + ' uses a coincidence factor with no band declared',
          'The project is set to the coincidence method but no band has been chosen, so the ' +
          'conservative connected load of ' + m.connectedKva.toFixed(0) + ' kVA is being used. ' +
          'That is the safe direction and it is almost certainly more than the board carries, ' +
          'but it is a placeholder rather than an answer. Declaring a band puts a number on the ' +
          'page that somebody chose.',
          'demand-band', m.connectedKva, 'kVA');
      }
    });
    /* Voltage drop, accumulated along the whole path from the transformer rather
       than across the circuit's own feeder alone. Judged on the wiring only: the
       transformer's own drop is cancelled by the tap, so counting it would fail
       every circuit for the same reason and say nothing about which are the
       problem. */
    var vprof = voltageProfileWorst(p);
    var vpById = {};
    vprof.profiles.forEach(function (v) { vpById[v.pn.id] = v; });
    p.panels.forEach(function (pn) {
      if (!pn.pdpId && !pn.pdbId) return;
      if (isSpare(pn)) return;
      var vp = vpById[pn.id];
      if (!vp || !vp.over) return;
      var own = vp.steps.filter(function (s) { return s.kind === 'panel' && !s.unknown; })[0];
      var upstream = vp.wiring.volts - (own ? own.volts : 0);
      add('bad', 'panel', pn.id, pn.tag + ' volt drop from the transformer is ' +
        vp.wiring.pct.toFixed(2) + '% — over the ' + vp.limit + '% limit' +
        (vp.lighting ? ' for a lighting circuit' : ''),
        'Total from the transformer to this circuit is ' + vp.wiring.pct.toFixed(2) +
        '%, of which ' + (own ? own.volts.toFixed(2) + ' V' : 'nothing') + ' is this circuit’s own ' +
        (own && own.csa ? own.csa + ' mm² over ' + own.len + ' m' : 'feeder') +
        ' and ' + upstream.toFixed(2) + ' V is everything above it' +
        (vp.incomplete ? ' — and ' + vp.unknownCount + ' of the hops above it have no route data' : '') +
        '. The transformer’s own ' + vp.transformer.pct.toFixed(2) + '% is a tap setting rather than a ' +
        'design limit and is not counted here. The limit applied is ' + vp.limitWhy + '. ' +
        'Where the drop is mostly in the final leg, up-sizing it is the cheapest fix because it is ' +
        'usually the shortest; where it is mostly upstream, the fix belongs in the board feeder, and ' +
        'moving the circuit to a nearer board can be cheaper than either.',
        'vdrop-path', num(pn.kw, 0));
    });
    /* A gap in the data rather than a proven failure, so a warning. */
    var vgaps = vprof.profiles.filter(function (v) { return v.incomplete; });
    if (vgaps.length) {
      add('warn', 'tx', p.txs[0] && p.txs[0].id, vgaps.length + ' of ' +
        vprof.profiles.length + ' circuits have an incomplete voltage drop profile',
        'A hop in the path has no conductor size or no route length, so its contribution is unknown ' +
        'rather than zero, and the totals for those circuits are optimistic. Affected: ' +
        vgaps.slice(0, 12).map(function (v) { return v.pn.tag; }).join(', ') +
        (vgaps.length > 12 ? ' and ' + (vgaps.length - 12) + ' more' : '') +
        '. Stating a length and a size for each feeder above them completes the profile. Busbars and ' +
        'joints are not modelled at all, so these figures are a small under-estimate.',
        'vdrop-incomplete', vgaps.length, 'circuits');
    }

    /* The tap. See tapAdvice() for why this is a selector position rather than a
       defect.

       The old finding counted circuits finishing outside the limit end to end and
       reported the count. On this project that read as thirty-four faults on TX7
       and twenty-three on TX8, and every one of them was the same single thing:
       a transformer running at nominal tap while dropping four to five per cent
       across its own impedance. The cables are inside every limit — the wiring
       drop is 0.54% to 1.86% against a 5% limit — and no cable was ever going to
       fix it, because the drop being counted was not in a cable.

       So it is reported as what it is. A transformer that nobody has decided the
       tap on is one open item, and the answer is a number. A transformer with the
       tap set and the far end inside is one closed item, and worth stating because
       the number has to go in the commissioning instructions. A transformer with
       the tap set and the far end still outside is a real finding, and the advice
       says which position would settle it. */
    p.txs.forEach(function (tx) {
      var adv = tapAdvice(p, tx);
      if (!adv) return;
      var best = adv.best;
      var pos = (best.tap > 0 ? '+' : '') + best.tap.toFixed(1) + '%';
      var supply = 'supply terminals ' + best.termLo.toFixed(1) + '-' + best.termHi.toFixed(1) + '%';

      if (adv.set === null) {
        if (!adv.clears) {
          /* No position on the selector brings the far end inside. That is not a
             tap problem — it means the wiring drop alone exceeds the limit
             somewhere, and the cables are the answer. */
          add('warn', 'tx', tx.id,
            tx.tag + ' tap — no position brings the far end inside the limit',
            'The far end of this installation drops ' + (best.farHi).toFixed(2) +
            '% below nominal before any tap is applied, against a ' +
            'limit that the wiring drop of ' + best.txLo.toFixed(2) + '-' +
            best.txHi.toFixed(2) + '% transformer contribution has to sit inside. ' +
            'The selector offers +/-' + num((p.design || {}).tapRange, 7.5).toFixed(1) +
            '% in ' + num((p.design || {}).tapStep, 2.5).toFixed(1) +
            '% steps and no combination of them closes a gap of this size, so the ' +
            'cables are what has to change. Raising the tap as far as ' + pos +
            'still leaves ' + best.over + ' of ' + best.of + ' outside.',
            'tap-setting', best.over, 'circuits');
          return;
        }
        add('warn', 'tx', tx.id,
          tx.tag + ' tap not set — ' + best.over + ' of ' + best.of +
          ' circuit(s) finish outside the limit end to end',
          'Nothing is wrong with the cables: the wiring drop on this transformer ' +
          'is ' + best.farLo.toFixed(2) + '% to ' + best.farHi.toFixed(2) +
          '% depending on circuit, inside every limit. What sits outside is the ' +
          'transformer, which contributes ' + best.txLo.toFixed(2) + '-' +
          best.txHi.toFixed(2) + '% at the loading on this project and has a tap ' +
          'selector there to cancel exactly that. This is one open item, not ' +
          best.over + '. The selector offers +/-' +
          num((p.design || {}).tapRange, 7.5).toFixed(1) + '% in ' +
          num((p.design || {}).tapStep, 2.5).toFixed(1) + '% steps; on ' + pos +
          ' every circuit finishes inside the limit and the ' + supply +
          ', which is what the tap is for. The textbook rule is to cancel the ' +
          'transformer own drop at design load, which here is about ' +
          adv.ideal.toFixed(1) + '% and gives the same answer. Set against ' +
          'measured voltage at the far end rather than by calculation alone.',
          'tap-setting', best.over, 'circuits');
        return;
      }

      var was = adv.set > 0 ? '+' : '';
      if (adv.now.over === 0) {
        add('info', 'tx', tx.id,
          tx.tag + ' tap set to ' + was + adv.set.toFixed(1) + '% — far end ' +
          adv.now.farLo.toFixed(2) + '-' + adv.now.farHi.toFixed(2) +
          '% below nominal, ' + supply,
          'All ' + adv.now.of + ' circuits finish inside the limit and the supply ' +
          'terminals sit at ' + adv.now.termLo.toFixed(1) + '-' +
          adv.now.termHi.toFixed(1) + '% of nominal, so nothing runs high at the ' +
          'boards either. Goes in the commissioning instructions; if the tap is ' +
          'moved at any stage, the far end moves with it.',
          'tap-setting', adv.now.of, 'circuits');
        return;
      }
      add('warn', 'tx', tx.id,
        tx.tag + ' tap set to ' + was + adv.set.toFixed(1) + '% — ' +
        adv.now.over + ' of ' + adv.now.of + ' circuit(s) still outside the limit',
        'This transformer still finishes outside the limit on ' +
        adv.now.over + ' circuit(s) with the tap where it is. On ' + pos +
        ' all ' + adv.of + ' are inside and the ' + supply +
        '. Verify against measured voltage at the far end before moving it, ' +
        'because the transformer own contribution of ' + adv.now.txLo.toFixed(2) +
        '-' + adv.now.txHi.toFixed(2) + '% is itself computed from an assumed ' +
        'impedance.',
        'tap-setting', adv.now.over, 'circuits');
    });

    /* Motor overload relay class, and the let-through a device permits.

       Both are the same shape of problem: a cable is asked whether it survives
       a fault, and the honest answer needs data a time-current curve does not
       contain. */
    p.panels.forEach(function (pn) {
      if (!pn.pdpId && !pn.pdbId) return;
      if (isSpare(pn)) return;
      var prot = pn.prot;
      if (!prot) return;
      var fl = faultLevel(p, pn, 'panel');
      if (!fl || !(fl.kA > 0) || !pn.cable || !num(pn.cable.csa, 0)) return;

      /* --- overload relay class, on a machine that has one ---

         And a machine fed through a drive does not have one on this circuit.

         IEC 60947-4-1 classes are a property of a thermal overload relay, and a
         relay is fitted to a motor that is started across its terminals. Where the
         motor is fed from a variable speed drive the drive does the overload
         protection: it knows its own motor current, it has an adjustable class,
         and it trips the motor rather than the feeder. There is no relay on this
         circuit to have a class, and the feeder device above the drive is
         protecting the drive's input — so asking whether it meets a class of 10 at
         six times the motor current is asking about a device that is not doing that
         job.

         On this project every one of the ninety-seven circuits is drive fed, and
         the check was reporting three of them as unable to meet a class they were
         never going to be asked to meet. It had been dormant until the motor
         recognition was fixed; what it then produced was a question with the wrong
         subject rather than a fault.

         The class still matters where it does apply, so the check is kept and
         gated on the machine actually being started across its terminals. */
      var fedFromDrive = startMethod(pn).multiple < 2;
      if (isMotorLoad(pn) && pn.kw > 0 && !fedFromDrive) {
        var cls = pn.motorClass === null || pn.motorClass === undefined
          ? num(p.design.motorClassDefault, 10) : num(pn.motorClass, 10);
        var spec = D.MOTOR_CLASSES[cls] || D.MOTOR_CLASSES[10];
        var st = panelDemand(p, pn);
        /* The relay is set to the motor's rated current, so the multiple at which
           the class is quoted is 6 x that — by definition. */
        /* Six times the motor's RATED current — the relay is set to that, and
           the class is quoted there. Six times its diversified share is a
           different and much smaller number. */
        var atSix = 6 * (num(st.ampConn, 0) > 0 ? st.ampConn : st.amp);
        var tAtSix = clearingTimeAt(prot, atSix / Math.max(1, num(prot.ir, 1)));
        if (tAtSix !== null && tAtSix > spec.seconds * 1.02) {
          add('warn', 'panel', pn.id, pn.tag + ' overload relay class ' + cls + ' cannot be met by its device',
            'At 6 × the motor current — the point the class is quoted at — ' +
            (prot.trip === 'mcb' ? 'this device' : 'the thermal characteristic') +
            ' takes ' + (tAtSix * 1000).toFixed(0) + ' ms, against the ' +
            (spec.seconds * 1000).toFixed(0) + ' ms a class ' + cls + ' relay permits. ' +
            (prot.trip === 'mcb' ? 'An MCB is not a motor protective device: its thermal element is sized ' +
              'for a cable, not for a machine, and it has no adjustable trip class. A motor overload relay ' +
              'with the right class, or a motor-rated MCCB, is what this circuit needs.'
              : 'An electronic trip unit can usually be set to a shorter class; a thermal-magnetic one cannot.') +
            ' The class is a commercial choice about how long the machine can be down — ' + spec.note,
            'motor-class', num(pn.kw, 0));
        }
      }

      /* --- let-through, where the cable is close enough for it to matter --- */
      var lt = letThrough(prot, fl.kA, {
        csa: num(pn.cable.csa, 0), len: num(pn.cable.len, 0),
        insul: (D.METHODS[pn.cable.method] || D.METHODS['A1']).insul,
        /* The device's real clearing time at this fault current, from its curve. */
        clearSeconds: clearingTimeAt(prot, fl.kA * 1000 / Math.max(1, num(prot.ir, 1)))
      });
      if (lt && lt.verdict === 'fails') {
        add('bad', 'panel', pn.id, pn.tag + ' feeder conductor cannot survive the fault',
          'At ' + fl.kA.toFixed(1) + ' kA the conductor can withstand ' +
          (lt.cableIt / 1e3).toFixed(0) + ' kA²s, which is ' +
          (lt.cableSeconds * 1000).toFixed(0) + ' ms at that current — and the device does not ' +
          (lt.published ? 'stop below that (published let-through ' + lt.letIt.toFixed(0) +
            ' kA²s, giving a margin of ' + (lt.margin || 0).toFixed(2) + '×).'
            : 'clear fast enough. This is the ideal case with zero let-through, so the real answer is ' +
              'worse still.') +
          ' A smaller conductor does not help: the withstand goes as S² while the fault current ' +
          'barely moves over a run this length, so the only ways down are a faster device or a lower ' +
          'fault level.' + (function () {
            var m = minimumCsa(p, pn);
            if (!m || !m.byFault || m.byFault <= num(pn.cable.csa, 0)) return '';
            return ' The smallest conductor that survives is ' + m.byFault + ' mm², against ' +
              num(pn.cable.csa, 0) + ' mm² now' +
              (m.governed === 'load' && m.byLoad ? ', and the load on its own needs ' + m.byLoad + ' mm²' : '') + '.';
          })(),
          'let-through', num(pn.kw, 0));
      }
    });

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

/* ======================================================= selectivity =====
  Two devices in series are selective if, for a fault between them, the one
  nearer the fault clears first. That sounds simple and is not, because a
  fault can be any current: an overload at 1.2 × In is cleared by the thermal
  elements, a bolt at 40 kA by the magnetic ones. A pair can be perfectly
  graded at one and hopelessly ungraded at the other, and that is the normal
  case — a thermal-magnetic device below an electronic one is selective on
  overload and not on short circuit, which is the reason electronic trip
  units have a short-time stage at all.

  Comparing two ratings, as this used to, can only ever see one of those two
  regimes and so cannot tell a good pair from a bad one. With curves it can:
  walk up through the fault current, find where each device clears, and see
  which does it first.

  The curves are the conventional envelopes from js/data.js, not a
  manufacturer's, so the result is a finding about the *scheme* rather than a
  certificate about a *device*, and it says so. The three outcomes are
  separated because they need different fixes:

    overload       both devices clear thermally and the lower one is not
                   enough smaller — lower its setting or raise the upper one
    short circuit  the upper device's instantaneous stage reaches this fault
                   before the lower one has cleared — give the upper device a
                   short-time stage, or set its instantaneous higher
    partly         selective up to some current and not above it. This is the
                   common case and the one a rating comparison would either
                   pass or fail wholesale.
  */
/* The clearing time of a device at a given multiple of its setting, in
  seconds. Interpolated in log-log, which is how the curves are drawn and the
  only interpolation that stays plausible between two published points: a
  straight line in log-log between a thermal point at 1.2 In and a magnetic
  point at 10 In does not cut across the corner of the curve that decides
  whether the two devices overlap.

  Returns null when the multiple is below the curve — the device never
  clears at that current. */
function clearingTimeAt(prot, multiple) {
 var ck = D.curveKeyFor(prot);
 var curve = ck && D.TRIP_CURVES[ck];
 if (!curve) return null;
 var pts = curve.points;
 var m = multiple;
 if (!(m > 0)) return null;

 /* A stated short-time delay overrides the envelope. This is the one place
    where a device's behaviour is a setting rather than a characteristic.

    Above the long-time band the device leaves its thermal characteristic behind
    and hands over to its short-time stage, which is a *definite* delay: it does
    not shorten as the fault grows, it holds. Past the instantaneous pickup the
    device is on its magnetic element and clears in tens of milliseconds whatever
    the short-time stage says, because the instantaneity sits in parallel with it
    and the faster of the two operates.

    An LS unit has no instantaneous, so a stated delay on it applies the whole way
    up — which is exactly why an LS is the device that makes a board selective and
    an LI is not, since an LI has no stage to delay.

    A blank delay means the family envelope stands, which is the state every
    project is in until somebody sets one. Nothing changes unless a setting is
    made, so this cannot silently alter a result that was already published. */
 var sd = num(prot && prot.sd, 0);
 var stg = D.tripStages(prot && prot.trip);
 if (sd > 0 && stg.shortTime && m > SHORT_TIME_FROM) {
  var ii = stg.instantaneous;
  /* No instantaneous, or not yet onto it: the device holds for the set delay. */
  if (ii === null || m < ii) return sd;
  /* Otherwise fall through and let the curve give the magnetic time. */
 }

 if (m < pts[0][0]) return null;
 if (m >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
 /* Return the published value where the multiple is one of the published
    points. Interpolating to exactly 1.13 through a log-log segment whose
    endpoints are 1.00 and 1.13 lands a hair under the point by floating point,
    and the published points are where a hand calculation and a standard's own
    table both check this — so they should come back exact. */
 for (var k = 0; k < pts.length; k++) {
   if (Math.abs(m - pts[k][0]) <= 1e-9 * Math.max(1, pts[k][0])) return pts[k][1];
 }
 for (var i = 1; i < pts.length; i++) {
   if (m <= pts[i][0]) {
     var a = pts[i - 1], b = pts[i];
     var la = Math.log(a[0]), lb = Math.log(b[0]);
     var ta = Math.log(a[1]), tb = Math.log(b[1]);
     var f = (Math.log(m) - la) / (lb - la);
     return Math.exp(ta + f * (tb - ta));
   }
 }
 return null;
}

/* ======================================================== the neutral =====
     The conductor that carries most of the risk in a modern installation and
     the one a load schedule never mentions.

     In a balanced three-phase load the fundamental currents are 120 degrees
     apart and sum to zero in the neutral. The third harmonic is not: it is a
     zero-sequence component, in phase in all three phases, so it arrives at the
     neutral as an arithmetic sum rather than cancelling. A board whose
     single-phase circuits each carry a 20% third harmonic puts roughly 60% of a
     phase conductor's worth of current into the neutral, and a board of LED
     drivers can exceed the phase current outright.

     The transformer decides how much of it gets that far. A delta on the LV
     winding blocks zero-sequence current from passing through the transformer
     at all — it circulates in the delta instead — so a Dyn11 or DYn11 has a
     fourth-harmonic-free neutral regardless of what is connected to it. A
     star-star group lets it straight through, and it is the single cheapest
     lever on neutral loading: specify the vector group rather than upsizing the
     neutral.

     So the neutral current is modelled per board, from the declared harmonic
     content of the single-phase circuits on it, and compared against the size of
     neutral the board would be given. Nothing is assumed: a circuit that
     declares no THD contributes no third harmonic, because guessing would put a
     number on the schedule that nobody measured. */
  /* Whether a circuit's neutral conductor comes back to the board.

     This is not a formality. On a three-pole motor feeder there is no neutral
     conductor, so no zero-sequence current can return — the third harmonic
     circulates in the machine and never touches the board's neutral bar. On a
     three-phase-and-neutral feeder the triplens add and the neutral carries three
     times the per-phase value. The two cases differ by more than an order of
     magnitude in the neutral's loading, and a schedule that treats them alike is
     either alarming about every motor or silent about every drive.

     Declaration wins. Failing that, a four-core feeder to a three-phase circuit
     has a neutral in it, which is the normal case for a TN-S installation where
     the equipment needs an earth reference. Three cores means three poles, and
     for a machine that is the usual answer. */
  function isThreePhaseWithNeutral(pn) {
    return String(pn.phases) === '3' && hasNeutralConductor(pn);
  }

  function hasNeutralConductor(pn) {
    if (pn.neutral !== undefined && pn.neutral !== null && pn.neutral !== '') return !!pn.neutral;
    var cores = num(pn.cable && pn.cable.cores, 4);
    return cores >= 4;
  }

  function neutralCurrent(p, panels, transformer, boardPhaseAmp) {
    var sum = { fundamental: 0, third: 0, imbalance: 0, perPhase: [0, 0, 0],
                threePhase: [], threePole: 0 };
    var declared = 0, undeclared = 0, ruledOut = 0;
    var blocks = !transformer || D.blocksTriplen(transformer.vecGroup || 'Dyn11');

    var supplySystem = String(p.design.supplySystem || 'TN-S');

    panels.forEach(function (pn) {
      var d = panelDemand(p, pn);
      var onePhase = String(pn.phases) === '1';

      /* Whether this circuit's neutral comes back to the board at all.
         A three-phase circuit with no neutral conductor — a three-pole motor
         feeder, most of them — has no path for zero-sequence current, so its
         triplen content circulates in the motor windings and never appears on
         any neutral bar. Treating such a circuit as if it loaded the board
         neutral is the error this check exists to avoid. */
      var hasNeutral = onePhase ? true : hasNeutralConductor(pn);
      if (!hasNeutral) { sum.threePole++; return; }

      if (onePhase) {
        var ph = pn.phase || 'L1';
        var idx = ph === 'L2' ? 1 : ph === 'L3' ? 2 : 0;
        sum.fundamental += d.amp;
        sum.perPhase[idx] += d.amp;
      } else {
        /* A three-phase load is balanced, so its fundamental contributes nothing
           to the neutral. The imbalance does, but a balanced design is the
           assumption being made here and it is stated as such rather than
           pretended to be measured. */
        sum.threePhase.push(d.amp);
        sum.imbalance += d.amp * num(pn.imbalance, 0) / 100;
      }

      if (d.thd === null) { undeclared++; return; }
      declared++;

      /* A stated total harmonic distortion does not say how much of it is third
         harmonic, which is the part that adds in the neutral. For the switched
         supplies that produce it — LED drivers, SMPS, VFDs — third harmonic is
         the largest single component, so it is taken at 60% of the total and the
         assumption is stated wherever the number is shown. A circuit that
         declares its own spectrum should override this.

         What the 60% is a fraction OF differs between the two cases, and getting
         it wrong is a factor of three:

         On a single-phase circuit the current that returns is that circuit's own
         triplen content.

         On a balanced three-phase circuit the triplens are in phase in all three
         conductors, so they add: the neutral carries three times the per-phase
         value.

         **Except where the load type rules the triplen out entirely**, which is
         the case for a drive. A six-pulse rectifier is a balanced three-phase
         load and its characteristic harmonics are 6k ± 1 — 5, 7, 11, 13, none of
         them triplen. Its third harmonic cancels between phases before it ever
         reaches a conductor. So a panel of drives raises the CABLE's RMS current
         and puts nothing at all in the neutral.

         This distinction was worth 159% of a phase conductor on one real board,
         because the code applied the triplen fraction to a drive feeder and
         reported a neutral problem that the drive's own waveform cannot produce.
         The load type decides; see triplenFractionOf(). */
      /* A load type that rules the triplen out — a drive — is not "undeclared",
         it is known to contribute nothing. Counting it as clean-but-unknown put
         drives in the "declared nothing" tally and made a board of them read as
         though nobody had measured it. */
      var tf = D.triplenFractionOf(pn);
      if (tf <= 0) { ruledOut++; return; }
      sum.third += d.amp * (d.thd / 100) * tf * (onePhase ? 1 : 3);
    });

    /* Triplen harmonics add; that is the whole point. And a delta on the LV
       winding does not merely reduce them — it stops them reaching the incoming
       neutral at all. The board's own neutral bar still carries them locally,
       but between the board and the transformer there is nowhere for zero
       sequence to go, so that conductor carries none.

       This is why the vector group is the cheapest fix available: a star-star
       and a Dyn11 cost the same on the order and the difference between them is
       the whole neutral loading. */
    var neutral = blocks ? 0 : 3 * sum.third;

    /* The phase reference the neutral is judged against. It used to be the
       heaviest single-phase circuit alone, which on a board of three-phase
       circuits is zero — so a neutral carrying hundreds of amps was being
       compared against nothing and reported as a percentage of itself. The
       heaviest phase conductor is the right reference: on a three-phase board
       that is the phase current of its largest circuit. */
    var maxSingle = Math.max(sum.perPhase[0], sum.perPhase[1], sum.perPhase[2]) || 0;
    var maxThree = sum.threePhase.length ? Math.max.apply(null, sum.threePhase) : 0;
    /* Given, not derived: the board's heaviest phase. Falling back to the
       heaviest single circuit is wrong by the number of circuits, but it is
       better than nothing when the function is called on its own. */
    var maxPhase = num(boardPhaseAmp, 0) > 0 ? num(boardPhaseAmp, 0) : Math.max(maxSingle, maxThree);
    var phaseRefIsBoard = num(boardPhaseAmp, 0) > 0;
    return {
      /* what the neutral carries, and what it would carry if the transformer let
         the triplen through — the difference is what specifying a delta buys */
      amps: neutral,
      ampsIfUnblocked: 3 * sum.third,
      thirdAmp: sum.third,
      /* The imbalance contribution from three-phase circuits, which is what a
         neutral carries on a TN-S supply from loads that are supposed to be
         balanced. Reported separately because it is an assumption about the
         design rather than a measurement of the load. */
      imbalanceAmp: sum.imbalance,
      imbalance: sum.imbalance,
      fundamental: sum.fundamental,
      maxPhase: maxPhase,
      /* whether that reference is the board's heaviest phase or a proxy for it —
         a summary should not present the two as the same number */
      phaseRefIsBoard: phaseRefIsBoard,
      perPhase: sum.perPhase,
      threePhase: sum.threePhase,
      /* three-pole circuits on this board: no neutral path at all */
      threePole: sum.threePole,
      blocked: blocks,
      declared: declared,
      undeclared: undeclared,
      /* circuits whose load type means they carry no triplen — drives, and the
         balanced six-pulse converters on a welding supply */
      ruledOut: ruledOut,
      supplySystem: supplySystem
    };
  }

  /* How much neutral a board gets if nothing says otherwise. The convention is
     a neutral the same size as the phases, with a reduced size permitted for a
     three-phase circuit — but that reduction assumes a balanced load, which is
     exactly the assumption that fails with harmonics. So the default here is a
     full-size neutral. */
  function neutralCsaFor(phaseCsa) {
    return D.num(phaseCsa, 0) || null;
  }

/* ========================================================= motor starting =====
     Three things go wrong when a motor starts, and only one of them is the peak.

     **The peak.** Direct on line draws 6 to 8 times full load current. That is
     what the starting method table is for, and the design figures used are the
     slow end of each range: overshooting a starting current is safe, undershooting
     it trips a board.

     **The dip.** A large current through the source impedance pulls the board
     voltage down, and every other circuit on that board sees it. From the fault
     level already calculated, the Thevenin impedance looking into the board is
     known, so the dip during starting is

         ΔU = I_start × Z_th

     which is only large when the supply is weak or the feeder is long — the two
     cases where it matters, and neither of which can be guessed at.

     **The duration**, which is the one that catches people out. An upstream
     magnetic device clears in well under a second. A motor accelerating normally
     takes several seconds to draw inrush, so any inrush above the upstream
     pick-up trips it — unless the motor's own impedance is inside the upstream
     device's thermal band, which it is not. This is why a motor that starts
     perfectly well on its own can fail to start when other plant comes in at the
     same moment, and why the fix is sequencing rather than a bigger cable.

     Torque is the fourth, and the reason any of this is worth doing: torque goes
     as the square of voltage, so a 10 % dip is a 19 % loss of starting torque. A
     motor that is marginal at nominal voltage can stall on a dip — and a stalled
     motor draws more current than one accelerating, which makes the dip worse.
     That cascade is the actual failure mode, and it is why the check compares the
     available torque against what the load needs rather than only reporting a
     percentage. */
  /* Whether the starting model applies at all. A rotating machine draws an
     inrush; a lighting circuit does not, and applying a motor model to one is
     how a schedule ends up with a 7 x figure on a 4 A luminaire circuit.

     Declared wins. Failing that, a non-default starting method is itself the
     declaration — nobody types "VFD" against a socket outlet — and so is a
     panel type that only ever contains rotating machines. A motor that is
     simply a motor in a panel typed "Plant" gets nothing, which is the correct
     outcome for undeclared data. */
  /* Is this item an unterminated spare way?

     Only an EXPLICIT spare counts. A circuit with no load could be a spare or an
     unsized machine, and guessing would silence real findings — the failure mode
     this app has been bitten by more than once. Declared means declared. */
  function isSpare(o) {
    return !!(o && o.isSpare === true);
  }

  function isMotorLoad(pn) {
    /* The properties panel writes this from a dropdown, so it arrives as 'yes'
       or 'no' rather than a boolean. Both are accepted; 'no' being a non-empty
       string is exactly the trap that would silently invert the whole model. */
    if (pn.isMotor === false || pn.isMotor === 'no') return false;
    if (pn.isMotor === true || pn.isMotor === 'yes') return true;
    var st = String(pn.start || '');
    if (st && D.START_METHODS[st] && D.START_METHODS[st].multiple < 2) return true;
    if (st && st !== 'DOL') return true;
    if (pn.loadTorque) return true;
    return MOTOR_PANEL_TYPES[String(pn.type || '')] === true;
  }

  /* Panel types whose load is rotating machinery. Not exhaustive and not
     exclusive — a lighting board is never a motor, but an "Other" panel might
     be, which is why the declaration above can override this either way. */
  var MOTOR_PANEL_TYPES = {
    mcc: true, ahu: true, pump: true, chiller: true, boiler: true, lift: true,
    gen: false, plant: true
  };

  /* Panel types that say nothing either way. A lighting board and a socket board
     are never rotating machinery, and the types above are nearly always it. What
     is left is the honest remainder — "other", and anything this list has never
     heard of — and those are not assumed either way, because assuming they are
     not motors is exactly how a check goes missing without anybody noticing. */
  var NON_MOTOR_PANEL_TYPES = { db_lg: true, db_sk: true, ups: true, ev: true };

  function motorTypeUnstated(pn) {
    var t = String(pn.type || '');
    if (MOTOR_PANEL_TYPES[t] === true) return false;
    if (NON_MOTOR_PANEL_TYPES[t] === true) return false;
    /* A declaration on the panel itself beats the type, either way. */
    if (pn.isMotor === true || pn.isMotor === 'yes' ||
        pn.isMotor === false || pn.isMotor === 'no') return false;
    if (pn.start || pn.loadTorque) return false;
    return true;
  }

  function startMethod(pn) {
    return D.START_METHODS[String(pn.start || 'DOL')] || D.START_METHODS.DOL;
  }

  /* Full load current, which is the base every multiple is taken against. */
  function startingCurrentA(p, pn) {
    if (!isMotorLoad(pn)) return null;
    var d = panelDemand(p, pn);
    /* The motor's own rated current, not its share of the board. */
    var flc = num(d.ampConn, 0) > 0 ? d.ampConn : d.amp;
    /* A stand-by machine with no rated load on the sheet. It is a real motor and
       it will draw real inrush when it starts — but with no rated current there
       is no multiple to apply, and printing "0 A starting" would read as a
       figure that had been calculated. Flagged instead. */
    if (!(d.amp > 0)) {
      return {
        method: startMethod(pn), flc: 0, amps: null, multiple: null,
        torque: startMethod(pn).torque, accel: startMethod(pn).accel,
        group: 1, combined: null, volt: D.num(pn.volt, 400), noRating: true
      };
    }
    var m = startMethod(pn);
    var group = num(pn.simultaneousStart, 1) > 1 ? num(pn.simultaneousStart, 1) : 1;
    return {
      method: m,
      flc: flc,
      amps: flc * m.multiple,
      multiple: m.multiple,
      torque: m.torque,
      accel: m.accel,
      group: group,
      /* what the board sees if several of these come in together */
      combined: flc * m.multiple * group,
      volt: D.num(pn.volt, 400)
    };
  }

  /* The Thevenin impedance looking into a supply point, derived from the fault
     level already calculated rather than from a separate impedance model.

     Ssc = V² / Z_th, and the fault level the app computes is exactly that. So
     the impedance falls straight out of it, and the two numbers stay consistent
     — a separate source impedance would drift out of step with the fault level
     the moment either was edited. */
  function sourceImpedanceAt(faultKA, volt) {
    var v = D.num(volt, 400) || 400;
    var ifl = (D.num(faultKA, 0) || 0) * 1000;
    if (!(ifl > 0)) return null;
    /* per-phase: Z = V / (√3 · I) */
    return v / (Math.sqrt(3) * ifl);
  }

  /* The whole picture for one motor. Returns null when there is nothing to
     assess — no device to trip, or no fault level to derive the impedance from. */
  function startingCheck(p, pn, kind) {
    var sc = startingCurrentA(p, pn);
    if (!sc) return null;
    /* The supply point the motor starts from: its own board, which is where the
       dip is felt by everything else on it. */
    var ch = chain(p, pn);
    var board = pn.dbId ? get(p, 'db', pn.dbId) : (ch.pdp || ch.pdb || get(p, 'pdb', pn.pdbId));
    var boardKind = board ? (board.__kind || kindOf(board)) : null;
    var fKA = board ? faultAt(p, board, boardKind) : null;
    /* A main board with no voltage of its own falls back to 400 V rather than
       to 0 — which produced a NaN dip on the real project, where the biggest
       motor sits straight off PDB7. num() returns 0 for a missing value, and a
       zero denominator hides the answer rather than giving a wrong one. */
    var volt = board ? (D.num(board.volt, 0) || 400) : sc.volt;
    var zth = sourceImpedanceAt(fKA, volt);

    /* The device above the motor — the one that sees the inrush as a fault. */
    var up = null, upKind = null;
    if (kind === 'pdp' || kind === 'db') {
      up = kind === 'pdp' ? get(p, 'pdb', pn.pdbId) : get(p, 'pdb', (get(p, 'pdp', pn.pdpId) || {}).pdbId);
      upKind = 'pdb';
    } else {
      if (pn.dbId) up = get(p, 'db', pn.dbId);
      else if (ch.pdp) up = ch.pdp;
      else if (ch.pdb) up = ch.pdb;
    }

    var upIr = up && up.prot ? D.num(up.prot.ir, 0) : 0;
    var upPickup = null, upClears = null;
    if (up && up.prot && upIr > 0) {
      /* The multiple at which the upstream device's magnetic stage picks up —
         the last point of its curve before it drops into the instantaneous band.
         Beyond it the device operates, and the question is whether it operates
         before the motor has finished accelerating. */
      upPickup = curveInstantaneousMultiple(up.prot);
      if (upPickup) {
        var over = sc.combined / upIr;
        upClears = over > upPickup ? clearingTimeAt(up.prot, over) : null;
      }
    }
    var ownPickup = pn.prot ? curveInstantaneousMultiple(pn.prot) : null;

    var dip = null;
    if (zth && zth > 0 && volt > 0) {
      var dropV = sc.combined * zth;
      dip = {
        zth: zth,
        volts: dropV,
        pct: (dropV / volt) * 100,
        /* what the motor actually gets, and what it can then produce */
        motorV: Math.max(0, volt - dropV),
        motorPct: Math.max(0, 100 - (dropV / volt) * 100),
        torqueAvail: sc.torque * Math.pow(Math.max(0, 1 - dropV / volt), 2)
      };
    }
    if (sc.noRating) {
      return { sc: sc, board: board, up: up, upKind: upKind, dip: null, faultKA: fKA,
        upIr: upIr, upPickup: null, upClears: null, ownPickup: ownPickup,
        tripsUpstream: false, tripsSelf: false, kind: kind, pn: pn, noRating: true };
    }
    return {
      sc: sc, board: board, up: up, upKind: upKind, dip: dip, faultKA: fKA,
      upIr: upIr, upPickup: upPickup, upClears: upClears, ownPickup: ownPickup,
      /* the upstream operates on this inrush, and does it so faster than the
         motor accelerates */
      tripsUpstream: upClears !== null && sc.accel > upClears,
      /* the motor's own device operates on its own inrush */
      tripsSelf: ownPickup !== null && sc.multiple > ownPickup,
      kind: kind, pn: pn
    };
  }

  /* The multiple at which a device's magnetic or instantaneous stage picks up:
     the last point on its curve before the drop. Null when the curve has no such
     stage — an LS without instantaneous holds its plateau to the end. */
  function curveInstantaneousMultiple(prot) {
    var ck = D.curveKeyFor(prot);
    var curve = ck && D.TRIP_CURVES[ck];
    if (!curve) return null;
    var pts = curve.points;
    if (pts.length < 2) return null;
    var last = pts[pts.length - 1];
    var prev = pts[pts.length - 2];
    /* A curve that ends on a plateau has no instantaneous stage at all — that is
       the whole point of an LS trip unit, and it is why the plateau must not be
       mistaken for a threshold. A 30% fall on the final segment is enough to
       call it a drop: a magnetic pickup modelled as a threshold shows up as a
       two-fold step, and demanding a four-fold one missed every MCCB. */
    return (last[1] < prev[1] * 0.7) ? last[0] : null;
  }

  /* Torque a machine needs to accelerate, as a fraction of full load. A figure to
     judge against rather than a standard: an unloaded fan needs very little, a
     loaded conveyor needs more than full-load torque before it will move at all. */
  function torqueNeeded(loadTorque) {
    switch (String(loadTorque || '')) {
      case 'constant': return 1.2;
      case 'variable': return 0.4;
      case 'constantpower': return 0.3;
      case 'inertia': return 0.6;
      default: return null;      // not stated, so nothing is asserted
    }
  }

/* ==================================================== earth fault loop =====
     Automatic disconnection has two halves and the app had neither.

     The first is a resistance: the loop from the fault, back through the
     protective conductor to the source, has to be low enough that enough
     current flows. The second is a time: that current has to make the device
     operate within a stated maximum, which is a question about the device's
     time-current characteristic and nothing else.

     The second half is why the trip curves are needed here as well as for
     selectivity. A device's rating says nothing about how quickly it clears —
     a 63 A MCB and a 63 A MCCB with a long-time delay above 1 In clear a
     modest fault at completely different speeds, and the required time is
     0.5 s for both.

     The method is the conventional one of IEC 60364-5-54 Annex B, which BS 7671
     Regulation 543.1.3 reproduces:

         Ia = U0 / (R1 + R2)        the current the loop will carry
         the device must clear that current within t_max

     and the design form of the same condition:

         R1 + R2 ≤ U0 / Ia(t_max)   where Ia(t_max) is the current at which the
                                    device clears in exactly the allowed time

     R1 and R2 are taken at the conductor's operating temperature rather than at
     20 °C, which is the conservative reading: the resistance is higher when hot
     and the loop current lower. */
  function earthLoop(p, cable) {
    if (!cable || !num(cable.csa)) return null;
    var runs = Math.max(1, num(cable.runs, 1));
    var peCsa = num(cable.peCsa, 0) || D.peMinCsa(num(cable.csa));
    var km = num(cable.len, 0) / 1000;
    /* 22.5 Ω·mm²/m for copper at 20 °C, and ×1.15 for roughly 70 °C operating.
       The temperature matters here and nowhere else in the app, because this is
       the only check where the resistance sets the current rather than merely
       reducing it. */
    /* Dividing by a missing size is how a 500 mm² feeder ended up with an
       earth fault loop of 0.29 Ω. The size is validated here rather than trusted,
       because a silent fallback to 1 mm² is worse than no answer: it produces a
       number, and the number goes in a report. */
    if (!(peCsa > 0)) return null;
    var rPerKm = function (csa) { return (22.5 * 1.15) / num(csa, 1); };
    var r1 = rPerKm(cable.csa) * km / runs;
    var r2 = rPerKm(peCsa) * km / runs;
    return { r1: r1, r2: r2, total: r1 + r2, peCsa: peCsa, runs: runs, km: km };
  }

  /* The protective conductor size that would meet the requirement over this
     route, found from the same resistance relation rather than guessed. */
  function peNeededCsa(e) {
    var target = e.maxLoop * e.loop.runs;      // back to one run
    if (!(target > 0)) return null;
    /* R2 must come down to target minus R1, which is fixed by the phase core */
    var r2max = target - e.loop.r1 * e.loop.runs;

    /* Returns a whole clause, not a noun phrase. Spliced into "a protective
       conductor of about … over this route" it produced "a protective conductor
       of about the minimum 1.5 mm² is already all this route allows", which
       reads as advice to fit a *smaller* conductor to a loop that needs a lower
       one. The minimum is a floor and never the remedy: where it is all the
       route allows, the route is the answer. */
    if (!(r2max > 0)) {
      return 'the phase conductor alone uses up the allowance, so this needs a shorter route or conductors in parallel';
    }
    var csa = (22.5 * 1.15 * e.loop.km) / r2max;
    var min = D.peMinCsa(num(e.loop.csa, 0) || 1.5);
    if (csa >= (D.CSA[D.CSA.length - 1] || 400) * 1.25) {
      return 'no listed conductor size meets it, so this needs a shorter route or conductors in parallel';
    }
    if (csa < min * 1.25) {
      return 'the ' + min + ' mm² minimum is already all this route allows, so the route itself has to change — shorter, or conductors in parallel';
    }
    var c = D.CSA.filter(function (v) { return v <= csa * 1.25; }).pop();
    if (!c) return 'no listed conductor size meets it, so this needs a shorter route or conductors in parallel';
    return 'a protective conductor of about ' + c + ' mm² over this route';
  }

  /* The multiple of the setting at which a device clears in exactly `t` seconds,
     by bisection on the curve — the inverse of clearingTimeAt().

     Returns null when the device cannot clear that fast at all, which is a
     design failure rather than a number: a device with nothing below 2 s on its
     curve cannot meet a 0.5 s requirement however good the loop is. */
  function disconnectionMultipleAt(prot, t) {
    var ck = D.curveKeyFor(prot);
    var curve = ck && D.TRIP_CURVES[ck];
    if (!curve || !(t > 0)) return null;
    var pts = curve.points;
    var lo = pts[0][0], hi = pts[pts.length - 1][0];
    /* still too slow at the fastest point on the curve: cannot be achieved */
    if (clearingTimeAt(prot, hi) > t) return null;
    /* never clears at all within the published band: anything at or below the
       first multiple is outside it */
    if (clearingTimeAt(prot, lo) < t) return lo;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      var tm = clearingTimeAt(prot, mid);
      if (tm === null) { lo = mid; continue; }
      if (tm > t) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* The whole check for one supply. Returns null when there is nothing to say —
     no cable, no device, no length, or a supply arrangement that cannot be
     assessed without data this app does not hold. */
  function earthFaultCheck(p, item, kind) {
    var prot = item.prot;
    if (!prot || !num(prot.ir, 0)) return null;
    var loop = earthLoop(p, item.cable);
    if (!loop || loop.total <= 0) return null;

    var system = String(p.design.supplySystem || 'TN-S');
    var volt = num(item.volt, 400) || 400;
    /* U0 is the line-to-neutral voltage, which is what the loop is across
       whichever way the circuit is connected. */
    var u0 = String(item.phases) === '3' ? volt / Math.sqrt(3) : volt;
    var finalCct = kind === 'panel';
    var ir = num(prot.ir, 0);

    /* A TT supply's loop is through the earth electrode, so it cannot be
       verified without the electrode resistance and the RCD that would limit it.
       Saying so is better than applying a TN formula to a TT system. */
    if (system.indexOf('TT') === 0) {
      var re = num(p.design.earthElectrodeR, 0);
      if (!(re > 0)) {
        return { needs: 'earth electrode resistance', system: system, kind: kind, item: item };
      }
      loop.total += re;
      loop.re = re;
    }

    var ia = u0 / loop.total;
    var tMax = D.maxDisconnectionTime(ir, finalCct, system);
    var tActual = clearingTimeAt(prot, ia / ir);
    var mNeeded = disconnectionMultipleAt(prot, tMax);
    var maxLoop = mNeeded === null ? null : u0 / (mNeeded * ir);
    return {
      system: system, kind: kind, item: item, prot: prot, ir: ir,
      u0: u0, loop: loop, ia: ia, tMax: tMax, tActual: tActual,
      maxLoop: maxLoop, multipleNeeded: mNeeded,
      pass: tActual !== null && tActual <= tMax,
      /* the device cannot clear this fast however good the loop is */
      unachievable: mNeeded === null
    };
  }

/* ================================================================= merging ===
     True multi-user is not available here and the reason is structural, not an
     oversight: the app has no server, no dependencies and runs from a file://
     URL. Shared live editing means one of those three things stops being true,
     and the property is what makes the whole thing work — a copy on a laptop
     that opens by double-clicking is why it is worth using.

     What IS available is the problem multi-user actually creates in practice.
     Two engineers each open the same project, each works on it, each exports a
     file, and now there are two versions and no way to tell which is which. That
     is a merge, and a merge can be done entirely in the browser.

     The approach is a **three-way merge**, because two-way is not enough:

         base      the common ancestor, which is what tells you whether a
                   difference is a change or a conflict
         mine      the first engineer's file
         theirs    the second's

     A field is a conflict only when BOTH sides changed it away from the base.
     If only one did, that change is taken. This is the whole difference between
     merging and concatenating, and getting it wrong either loses work or
     invents it.

     What can be merged cleanly is anything keyed on a **reference**, for the
     same reason revision tracking is keyed that way: a circuit is the same
     circuit because of what it is called, not because of an id a session
     happened to mint. Anything with no reference cannot be matched between two
     files, so it is never merged — it is listed for a decision.

     The result is not written over anything. It is offered, with every conflict
     named and every automatic decision shown, because the person who has to sign
     the resulting schedule is not the person who merged it.
 */
  function mergeBase(p) {
    /* Flattened to reference-keyed records, the same shape revision tracking
       diffs, so the two features cannot disagree about what a circuit is. */
    var out = {};
    function add(kind, o, fields) {
      var ref = (o.tag || o.ref || '').trim();
      if (!ref) return false;
      var rec = { kind: kind, ref: ref };
      fields.forEach(function (f) {
        var v = o[f];
        rec[f] = (v === null || v === undefined) ? null
          : (typeof v === 'object' ? stable(v) : v);
      });
      out[kind + ':' + ref] = rec;
      return true;
    }
    (p.txs || []).forEach(function (o) {
      add('tx', o, ['kva', 'impZ', 'kvIn', 'kvOut', 'vectorGroup', 'phases', 'notes']);
    });
    (p.pdbs || []).forEach(function (o) {
      add('pdb', o, ['num', 'name', 'incomerA', 'busbarA', 'phases', 'cable', 'prot', 'notes']);
    });
    (p.pdps || []).forEach(function (o) {
      add('pdp', o, ['num', 'name', 'incomerA', 'busbarA', 'ways', 'cable', 'prot', 'notes']);
    });
    (p.dbs || []).forEach(function (o) {
      add('db', o, ['num', 'name', 'incomerA', 'ways', 'cable', 'prot', 'enclosure', 'notes']);
    });
    (p.panels || []).forEach(function (o) {
      if (!add('pn', o, ['name', 'type', 'kw', 'kva', 'pf', 'demand', 'phases', 'volt',
        'cable', 'prot', 'harmonicType', 'thd', 'triplen', 'neutral', 'peInCable',
        'isMotor', 'start', 'loadTorque', 'motorClass', 'notes', 'isMotor'])) return;
      out['pn:' + o.tag].fedFrom = o.pdpId ? (get(p, 'pdp', o.pdpId) || {}).tag
        : (o.pdbId ? (get(p, 'pdb', o.pdbId) || {}).tag : '');
    });
    /* Anything with no reference cannot be matched across two files, so it is
       never merged silently. Named instead. */
    var orphans = [];
    (p.panels || []).concat(p.pdps || [], p.dbs || [], p.pdbs || [], p.txs || []).forEach(function (o) {
      if (!(o.tag || o.ref || '').trim()) orphans.push(o.name || '(unnamed)');
    });
    return { records: out, orphans: orphans };
  }

  function mergeProjects(base, mine, theirs, opts) {
    opts = opts || {};
    /* Which side wins a genuine conflict. The default is the second file, and
       the reason is stated rather than implied: it is a choice somebody has to
       make, not a default that should be discovered later. */
    var prefer = opts.prefer || 'theirs';
    var B = mergeBase(base).records, M = mergeBase(mine).records, T = mergeBase(theirs).records;
    var keys = {};
    Object.keys(B).forEach(function (k) { keys[k] = 1; });
    Object.keys(M).forEach(function (k) { keys[k] = 1; });
    Object.keys(T).forEach(function (k) { keys[k] = 1; });

    var merged = {}, conflicts = [], taken = [], same = 0;
    var order = Object.keys(keys).sort();

    order.forEach(function (k) {
      var b = B[k], m = M[k], t = T[k];
      /* Present on one side only, and not deleted by the other: a plain add. */
      if (b === undefined && t !== undefined && m === undefined) { merged[k] = t; taken.push({ key: k, kind: 'added in theirs' }); return; }
      if (b === undefined && m !== undefined && t === undefined) { merged[k] = m; taken.push({ key: k, kind: 'added in yours' }); return; }
      /* Deleted on one side and untouched on the other: the deletion stands.
         Someone removed a circuit; not hearing about it would resurrect it. */
      if (t === undefined && m !== undefined) {
        if (b === undefined) { taken.push({ key: k, kind: 'removed in theirs' }); return; }
        if (equal(b, m)) { taken.push({ key: k, kind: 'removed in theirs' }); return; }
        conflicts.push({ key: k, field: '*', mine: m, theirs: undefined, base: b,
          kind: 'deleted in theirs, changed in yours' });
        merged[k] = prefer === 'theirs' ? undefined : m;
        return;
      }
      if (m === undefined && t !== undefined) {
        if (b === undefined) { taken.push({ key: k, kind: 'added in theirs' }); return; }
        if (equal(b, t)) { taken.push({ key: k, kind: 'removed in yours' }); return; }
        conflicts.push({ key: k, field: '*', mine: undefined, theirs: t, base: b,
          kind: 'deleted in yours, changed in theirs' });
        merged[k] = prefer === 'theirs' ? t : undefined;
        return;
      }
      /* Present in both. */
      if (!m || !t) { if (m) merged[k] = m; else if (t) merged[k] = t; return; }

      var rec = { kind: m.kind, ref: m.ref }, changed = false;
      Object.keys(m).forEach(function (f) {
        if (f === 'kind' || f === 'ref') return;
        var bv = b ? b[f] : undefined, mv = m[f], tv = t[f];
        var mSame = bv === undefined || JSON.stringify(mv) === JSON.stringify(bv);
        var tSame = bv === undefined || JSON.stringify(tv) === JSON.stringify(bv);
        if (JSON.stringify(mv) === JSON.stringify(tv)) {
          /* Both made the same change, or neither did. Either way there is no
             decision to make — which is the common case and the reason a merge
             this way is quick. */
          if (!mSame) { rec[f] = mv; changed = true; }
          else rec[f] = mv;
          return;
        }
        if (mSame) { rec[f] = tv; changed = true; return; }   // only theirs moved
        if (tSame) { rec[f] = mv; changed = true; return; }   // only mine moved
        /* Both moved it, differently. That is the only real conflict. */
        rec[f] = prefer === 'theirs' ? tv : mv;
        conflicts.push({
          key: k, field: f, mine: mv, theirs: tv, base: bv,
          kind: 'both changed'
        });
        changed = true;
      });
      if (changed) taken.push({ key: k, kind: 'merged' });
      else same++;
      merged[k] = rec;
    });

    return {
      merged: merged,
      conflicts: conflicts,
      /* Every automatic decision, so the merge can be checked rather than
         trusted. */
      taken: taken,
      unchanged: same,
      orphansMine: mergeBase(mine).orphans,
      orphansTheirs: mergeBase(theirs).orphans,
      canApply: conflicts.length === 0 || !!opts.prefer
    };
  }
  function equal(a, b) {
    if (!a || !b) return false;
    var ks = Object.keys(a), kt = Object.keys(b);
    if (ks.length !== kt.length) return false;
    for (var i = 0; i < ks.length; i++) {
      if (JSON.stringify(a[ks[i]]) !== JSON.stringify(b[kt[i]])) return false;
    }
    return true;
  }

  /* Write a merge back into a project. Records become items again, parent links
     are restored from the references the merge carried, and anything that cannot
     be rebuilt — a record with no live parent — is named rather than dropped. */
  function applyMerge(p, merge) {
    var built = { tx: [], pdb: [], pdp: [], db: [], pn: [] };
    var missing = [];
    Object.keys(merge.merged).forEach(function (k) {
      var rec = merge.merged[k];
      var kind = rec.kind, ref = rec.ref;
      var item = {
        id: uidFor(p, kind), tag: ref,
        num: rec.num, name: rec.name || ref, notes: rec.notes || ''
      };
      /* Fields the merge carried that the factory does not know about are set
         after, so a new field added to the engine does not need this function
         changed before it survives a merge. */
      /* Object fields were flattened to a canonical string for comparison, so
         they are revived here rather than written straight back — a cable
         arriving as a JSON string is not a cable, and the first symptom is a
         feeder with no conductor size on it. Reviving is safe because the string
         was produced by JSON.stringify on a plain object. */
      Object.keys(rec).forEach(function (f) {
        if (f === 'kind' || f === 'ref' || f === 'num') return;
        item[f] = revive(rec[f]);
      });
      if (kind === 'pn') {
        /* Already revived above; these only supply the default when the merge
           carried none at all. Assigning rec.cable here would put the flattened
           string straight back over the object the loop had just rebuilt. */
        if (item.cable === undefined) item.cable = null;
        if (item.prot === undefined) item.prot = null;
        item.__kind = 'panel';
        /* The parent comes back from a reference, resolved against what has
           already been built, so the merge cannot create a dangling circuit. */
        if (rec.fedFrom) {
          var found = null;
          built.pdp.concat(built.pdb).forEach(function (b) { if (b.tag === rec.fedFrom) found = b; });
          if (found) {
            if (found.__kind === 'pdb') item.pdbId = found.id; else item.pdpId = found.id;
          } else {
            missing.push(ref + ' (fed from ' + rec.fedFrom + ', which is not in the merge)');
          }
        }
      }
      if (kind === 'db' || kind === 'pdp') {
        if (item.cable === undefined) item.cable = null;
        if (item.prot === undefined) item.prot = null;
      }
      built[kind].push(item);
    });
    p.txs = built.tx; p.pdbs = built.pdb; p.pdps = built.pdp;
    p.dbs = built.db; p.panels = built.pn;
    return { p: p, missing: missing };
  }
  /* Reverse of stable(): a canonical string becomes the object it came from.
     Applied only to strings that were flattened, which is recorded rather than
     guessed at — a name that happens to be JSON-looking must not be revived
     into an object. */
  function revive(v) {
    if (typeof v !== 'string') return v;
    if (v.charAt(0) !== '{' && v.charAt(0) !== '[') return v;
    try { var out = JSON.parse(v); return (out && typeof out === 'object') ? out : v; }
    catch (e) { return v; }
  }

  /* A fresh id, because a merge is a new document rather than an edit of one.
     The reference is what carries the identity; the id is bookkeeping. */
  function uidFor(p, kind) {
    var prefix = { tx: 'tx', pdb: 'pdb', pdp: 'pdp', db: 'db', pn: 'pnl' }[kind] || 'x';
    var n = 0, id;
    do { n++; id = prefix + '_m' + n + '_' + Math.floor(Math.random() * 1e6).toString(36); }
    while (p.txs.concat(p.pdbs, p.pdps, p.dbs, p.panels).some(function (o) { return o.id === id; }));
    return id;
  }

/* ============================================================ equipment ========
     A bill of materials needs quantities and catalogue references. The design
     already knows what everything is — how many boards, how many circuits, what
     rating, what conductor — so the count is arithmetic. What it does not know is
     what any of it costs or what it is called in a manufacturer's catalogue.

     So the library holds **what the app can derive** and the **items it cannot**.
     Anything derivable is grouped from the design on every render, so it cannot
     go stale: three 160 A MCBs are three 160 A MCBs whether or not anybody
     remembered to add them. Anything not derivable — a gland plate, a label
     printer, an enclosure — is a manual line the engineer adds, because only the
     engineer knows it is needed.

     That split is the design. A catalogue database would need to be maintained
     and would be out of date the moment a manufacturer revised a datasheet. What
     is worth having is the **count**, and the count is exact.

     What is deliberately absent is pricing. A price is commercial, it changes,
     it depends on the supplier and on the day, and a figure in a design tool
     that nobody can trace is worse than no figure. There is a unit-cost field
     because somebody will want it, and a total that is explicitly labelled as
     built from entered costs — not as a quotation.

     Cable quantities are the interesting part and they are genuinely worth
     getting right, because they are the largest line in most bills and the one
     everybody gets wrong. A circuit's cable is its length plus the tails at
     either end, and the tails are the difference between a cable schedule and a
     cutting list: without them every drum is short. The allowance per end is a
     declared setting because it varies — a panel in a plant room has far more
     than one in a field cabinet — and the drum rounding below is what turns a
     cutting list into something you can actually order. */
  var EQUIPMENT_GROUPS = {
    tx: 'Transformers',
    pdb: 'Main boards',
    pdp: 'Distribution boards',
    db: 'Sub-boards',
    enclosure: 'Enclosures',
    mcb: 'Circuit breakers',
    mccb: 'Moulded case breakers',
    cable: 'Cable',
    gland: 'Cable glands',
    accessories: 'Accessories'
  };

  /* Grouped straight off the design. Counts and references are exact; nothing
     here can be out of date because it is read rather than stored. */
  function billOfMaterials(p) {
    var items = [];
    function add(group, desc, qty, each, ref) {
      /* Rounded up to whole units: you cannot buy 2.4 boards. */
      var n = Math.ceil(qty - 1e-9);
      if (!(n > 0)) return;
      items.push({ group: group, desc: desc, qty: n, each: each || 1, ref: ref || '',
        /* where it comes from, so the bill can be traced back to the design
           rather than being a number somebody typed */
        source: 'design' });
    }

    /* --- power transformers --- */
    (p.txs || []).forEach(function (o) {
      /* Both sides of the ratio carry the unit. The fields hold kilovolts, so
         writing "11/0.415 kV" reads as though the 11 were volts — and an 11 kV
         transformer described that way is a genuinely confusing thing to hand a
         contractor. */
      add('tx', (o.tag || 'TX') + ' — ' + num(o.kva, 0) + ' kVA transformer' +
        (num(o.kvIn, 0) ? ', ' + num(o.kvIn, 0) + '/' + num(o.kvOut, 0) + ' kV' : '') +
        (o.vectorGroup ? ', ' + o.vectorGroup : ''), 1, 1, o.tag);
    });

    /* --- boards, and their enclosures --- */
    (p.pdbs || []).forEach(function (b) {
      add('pdb', (b.tag || 'PDB') + ' — main board, ' + num(b.incomerA, 0) + ' A incomer' +
        (b.enclosure ? ', ' + b.enclosure : ''), 1, 1, b.tag);
    });
    (p.pdps || []).forEach(function (b) {
      add('pdp', (b.tag || 'PDP') + ' — distribution board, ' + num(b.incomerA, 0) +
        ' A incomer, ' + num(b.ways, 0) + ' ways' + (b.enclosure ? ', ' + b.enclosure : ''), 1, 1, b.tag);
    });
    (p.dbs || []).forEach(function (b) {
      add('db', (b.tag || 'DB') + ' — sub-board, ' + num(b.incomerA, 0) + ' A incomer, ' +
        num(b.ways, 0) + ' ways' + (b.enclosure ? ', ' + b.enclosure : ''), 1, 1, b.tag);
    });

    /* --- protective devices, grouped by rating and curve ---
       This is where a bill of quantities earns its keep: 97 circuits with
       devices scattered through 6 A to 400 A produce a dozen or so distinct
       catalogue entries, and that is the line the contractor actually prices. */
    var mcbs = {}, mccbs = {};
    (p.panels || []).concat(p.pdps || [], p.dbs || [], p.pdbs || []).forEach(function (o) {
      var pr = o.prot;
      if (!pr) return;
      var key = [pr.kind, num(pr.ir, 0), num(pr.frame, 0), num(pr.icu, 0), pr.trip || '', num(pr.poles, 0)].join('|');
      var isMcb = pr.kind === 'mcb';
      var bag = isMcb ? mcbs : mccbs;
      if (!bag[key]) {
        bag[key] = {
          group: isMcb ? 'mcb' : 'mccb',
          desc: (isMcb ? 'MCB ' : 'MCCB ') + num(pr.ir, 0) + ' A' +
            (num(pr.frame, 0) && num(pr.frame, 0) !== num(pr.ir, 0) ? ' / ' + num(pr.frame, 0) + ' A frame' : '') +
            (pr.trip ? ' curve ' + pr.trip : '') +
            (num(pr.icu, 0) ? ', ' + num(pr.icu, 0) + ' kA' : '') +
            ', ' + num(pr.poles, 0) + ' pole',
          qty: 0, each: 1, source: 'design', refs: []
        };
      }
      bag[key].qty++;
      if (o.tag) bag[key].refs.push(o.tag);
    });
    Object.keys(mcbs).forEach(function (k) { items.push(mcbs[k]); });
    Object.keys(mccbs).forEach(function (k) { items.push(mccbs[k]); });

    /* --- cable, as a cutting list ---
       Length plus tails, then rounded up to a drum. Without the tails every drum
       is short, and a bill that understates the cable by the tails is a bill
       somebody has to fix before they can order anything. */
    var tails = num(p.design.cableTailsPerEnd, 1.5);       // m, each end
    var drum = num(p.design.cableDrumM, 100);             // m, standard drum
    var cables = {}, unmeasured = [];
    (p.panels || []).concat(p.pdps || [], p.dbs || [], p.pdbs || []).forEach(function (o) {
      var c = o.cable;
      if (!c || !(num(c.csa, 0) > 0)) return;
      var key = [num(c.csa, 0), num(c.runs, 1), num(c.cores, 0), c.method || ''].join('|');
      if (!cables[key]) {
        cables[key] = {
          group: 'cable', csa: num(c.csa, 0), runs: num(c.runs, 1), cores: num(c.cores, 0),
          method: c.method || '', bare: 0, withTails: 0, refs: [], source: 'design'
        };
      }
      var L = num(c.len, 0);
      var one = L + tails * 2;
      var rec = cables[key];
      rec.bare += L;
      rec.withTails += one;
      /* The tail is charged per run, because a twin run needs its tail twice. */
      rec.withTails += tails * (num(c.runs, 1) - 1);
      if (o.tag) rec.refs.push(o.tag);
    });
    Object.keys(cables).forEach(function (k) {
      var c = cables[k];
      /* A drum is ordered whole, and a part-drum left over is not waste — it is
         the offcut for the next termination. Both are reported.

         A run with no stated route length is a gap in the data, and it must not
         become a hundred metres of cable on a bill. It is counted and marked, so
         somebody goes and finds the length rather than a contractor ordering
         nine drums of 500 mm² because three routes were never entered. */
      c.qty = c.withTails > 0 ? Math.ceil(c.withTails / drum) : 0;
      c.unmeasured = c.bare <= 0;
      c.desc = c.csa + ' mm² ' + (c.runs > 1 ? c.runs + ' × ' : '') + c.cores + '-core ' +
        (c.method || '') + (c.unmeasured
          ? ' — LENGTH NOT STATED, no cable ordered for ' + c.refs.length + ' circuit(s)'
          : ' — ' + c.withTails.toFixed(0) + ' m with tails (' + c.bare.toFixed(0) +
            ' m route), ' + c.qty + ' × ' + drum.toFixed(0) + ' m drum' +
            (c.qty * drum - c.withTails > 0.5 ? ', ' + (c.qty * drum - c.withTails).toFixed(0) + ' m offcut' : ''));
      c.each = drum;
      /* A run with no stated length is not a bill line. Dropping it silently
         would make the bill look complete when it is not, so it goes to its own
         list and the view says how many there are. */
      if (c.unmeasured) unmeasured.push(c);
      else items.push(c);
    });

    /* --- the manual lines --- */
    (p.bomExtra || []).forEach(function (l) {
      items.push({ group: l.group || 'accessories', desc: l.desc, qty: num(l.qty, 1),
        each: 1, ref: l.ref || '', unitCost: num(l.unitCost, 0), source: 'manual' });
    });

    /* Grouped, in the order a bill is read: down the installation, then the
       devices, then the cable, then the extras. */
    var order = ['tx', 'pdb', 'pdp', 'db', 'enclosure', 'mccb', 'mcb', 'cable', 'gland', 'accessories'];
    items.sort(function (a, b) {
      var d = order.indexOf(a.group) - order.indexOf(b.group);
      if (d) return d;
      /* Ratings in their natural order, not string order — 100 before 160
         before 250 reads properly; "100" before "16" does not. */
      var av = parseFloat(String(a.desc).match(/([\\d.]+)\\s*A/)?.[1] || 0);
      var bv = parseFloat(String(b.desc).match(/([\\d.]+)\\s*A/)?.[1] || 0);
      if (av !== bv) return av - bv;
      return String(a.desc).localeCompare(String(b.desc));
    });

    var derived = items.filter(function (i) { return i.source === 'design'; }).length;
    return {
      items: items,
      /* Runs with no stated length: counted, named, and deliberately ordered
         nothing for. A bill that looked complete and was short of nine hundred
         metres of cable is worse than one that says it is short. */
      unmeasured: unmeasured,
      unmeasuredRefs: unmeasured.reduce(function (a, c) { return a.concat(c.refs); }, []),
      groups: EQUIPMENT_GROUPS,
      /* What the design produced and what a person added. Worth stating, because
         a bill that is entirely derived is a different document from one that is
         half catalogue knowledge. */
      derived: derived, manual: items.length - derived,
      cableMeters: Object.keys(cables).reduce(function (a, k) { return a + cables[k].withTails; }, 0),
      /* A total is only ever as good as the costs entered into it. Built from
         entered unit costs and labelled as such — never presented as a price. */
      costed: items.some(function (i) { return i.unitCost > 0; }),
      total: items.reduce(function (a, i) { return a + (i.unitCost || 0) * i.qty; }, 0)
    };
  }

/* ======================================================== revision tracking ===
     A load schedule is a controlled document. Somebody approves it, it goes out
     for construction, and then it changes — and the question that gets asked
     later is not "what is the current design" but "what did we actually issue,
     and what has changed since".

     Undo is not an answer to that. Undo is 25 levels of in-session editing, it
     vanishes when the tab closes, and it has no notion of an issue. A revision
     history is the opposite: deliberately kept, labelled, and meant to outlive
     the session.

     What is recorded is not a blob but a **diff**, because a list of timestamps
     tells you nothing and a list of changes does. The three things that matter on
     a load schedule are:

       - a circuit added, removed or resized
       - a protection device changed
       - a board's rating or cable changed

     Those are the edits that invalidate a drawing, a cable schedule or an
     approval. Renaming a circuit or moving one on the plan is recorded but
     marked as not affecting the schedule, so a reader can filter to the changes
     that would actually have required a reissue.

     Nothing is recorded automatically on every keystroke. A revision is
     something somebody says happened — "rev C, wiring coordinator's comments" —
     because a revision number is a claim about the document's status and only
     the engineer can make that claim. */
  var REVISION_FIELDS = {
    /* The fields whose change would invalidate something already issued. Board
       rating, busbar and cable are here as well as the circuit's own: an
       incomer changed from 1000 A to 800 A alters the board schedule and every
       drawing that shows it, so it cannot be filed as cosmetic. A circuit's
       parent is included too — moving it between boards is a different circuit
       as far as the contractor is concerned — though the stored value is an id,
       which diffProjects replaces with the board's reference before comparing. */
    critical: ['kw', 'kva', 'phases', 'volt', 'demand', 'pf', 'harmonicType',
      'cable', 'prot', 'neutral', 'peInCable', 'fedFrom', 'onTx', 'onPdb', 'onPdp',
      'incomerA', 'busbarA', 'impZ', 'vectorGroup', 'kvOut', 'ways', 'enclosure',
      'capacitors'],
    /* the fields that change the document but not its validity */
    cosmetic: ['name', 'notes', 'type', 'thd', 'triplen', 'imbalance',
      'loadTorque', 'start', 'motorClass', 'isMotor', 'pos']
  };

  function snapshotForDiff(p) {
    /* A flat map of every electrically meaningful thing, keyed so a diff is a
       plain key comparison. Built fresh rather than diffing two JSON trees,
       because the question is never "what does the JSON look like" — it is
       "what has the designer's answer changed from". */
    /* Keyed on the REFERENCE, not the id.

       This is the whole basis of a revision history and getting it wrong is
       silently catastrophic. Ids are generated per session: a project exported
       and re-imported keeps them, but a project re-created, merged or imported
       from a vendor's file does not. Diffing on ids then reports every object as
       removed and added, which is both unreadable and uniformly critical, since
       a removal always is. That is exactly what the first version did.

       The reference is the stable identity. It is what appears on the drawing
       and what the contractor quotes, so it is the right key and the right thing
       to name in the history.

       A circuit whose reference is blank cannot be keyed by it, so those fall
       back to the id and are marked — a blank reference is itself worth knowing
       about, and a revision history that silently conflated them would be worse
       than one that says so. */
    var out = {};
    function key(o, kind, tag, num) {
      var ref = (tag || '').trim();
      if (!ref) return kind + ':_:' + o.id;
      return kind + ':' + ref;
    }
    (p.txs || []).forEach(function (o) { out[key(o, 'tx', o.tag, o.num)] = pick(o, ['tag', 'num', 'kva', 'impZ', 'kvIn', 'kvOut', 'vectorGroup', 'phases']); });
    (p.pdbs || []).forEach(function (o) { out[key(o, 'pdb', o.tag, o.num)] = pick(o, ['tag', 'num', 'incomerA', 'busbarA', 'phases', 'cable', 'prot', 'capacitors']);
    out[key(o, 'pdb', o.tag, o.num)].onTx = o.txId ? (get(p, 'tx', o.txId) || {}).tag : ''; });
    (p.pdps || []).forEach(function (o) { out[key(o, 'pdp', o.tag, o.num)] = pick(o, ['tag', 'num', 'incomerA', 'busbarA', 'ways', 'cable', 'prot']);
    out[key(o, 'pdp', o.tag, o.num)].onPdb = o.pdbId ? (get(p, 'pdb', o.pdbId) || {}).tag : ''; });
    (p.dbs || []).forEach(function (o) { out[key(o, 'db', o.tag, o.num)] = pick(o, ['tag', 'num', 'incomerA', 'ways', 'cable', 'prot', 'enclosure']);
    out[key(o, 'db', o.tag, o.num)].onPdp = o.pdpId ? (get(p, 'pdp', o.pdpId) || {}).tag : ''; });
    (p.panels || []).forEach(function (o) {
      out[key(o, 'pn', o.tag, o.num)] = pick(o, ['name', 'type'].concat(REVISION_FIELDS.critical, REVISION_FIELDS.cosmetic));
    /* pdpId/pdbId are ids, and ids are not comparable across a re-created
       project — they changed for every circuit in this diff even though
       none of them moved. The board's REFERENCE is the identity that matters,
       and fedFrom below already resolves it. */
    delete out[key(o, 'pn', o.tag, o.num)].pdpId;
    delete out[key(o, 'pn', o.tag, o.num)].pdbId;
    delete out[key(o, 'pn', o.tag, o.num)].dbId;
    });
    /* Where a circuit hangs is part of its identity on the schedule: the same
       reference on a different board is a different circuit as far as the
       contractor is concerned, and a move is a change worth recording. */
    Object.keys(out).forEach(function (k) {
      if (k.slice(0, 3) !== 'pn:') return;
    });
    (p.panels || []).forEach(function (o) {
      var k = key(o, 'pn', o.tag, o.num);
      if (!out[k]) return;
      out[k].fedFrom = o.pdpId ? (get(p, 'pdp', o.pdpId) || {}).tag
        : (o.pdbId ? (get(p, 'pdb', o.pdbId) || {}).tag : '');
    });
    return out;
  }
  function pick(o, fields) {
    var r = {};
    fields.forEach(function (f) {
      var v = o[f];
      if (v === null || v === undefined) { r[f] = null; return; }
      /* A cable is compared field by field rather than as a JSON blob, because
         the blob is what a diff must never show a reader: a changed conductor
         appears as "cable: {...forty characters of JSON...} -> {...}" and the one
         thing that changed is invisible in it. */
      /* Compact but labelled, so a reader sees what changed rather than having
         to remember which position held the conductor size. */
      if (f === 'cable') {
        r['cable'] = num(v.csa, 0) + ' mm²' + (num(v.runs, 1) > 1 ? ' × ' + num(v.runs, 1) : '') +
          ', ' + num(v.cores, 0) + ' core, ' + num(v.len, 0) + ' m, ' + (v.method || '') +
          ', group ' + num(v.group, 1) + ', ' + num(v.ambient, 0) + ' °C';
        return;
      }
      if (f === 'prot') {
        r['prot'] = (v.kind === 'mcb' ? 'MCB' : 'MCCB') + ' ' + num(v.ir, 0) + ' A' +
          (num(v.frame, 0) ? ' / ' + num(v.frame, 0) + ' A frame' : '') +
          (num(v.icu, 0) ? ', ' + num(v.icu, 0) + ' kA' : '') +
          (v.trip ? ', ' + v.trip : '') +
          (num(v.poles, 0) ? ', ' + num(v.poles, 0) + ' pole' : '');
        return;
      }
      if (f === 'pos') {
        r['pos'] = num(v.x, 0).toFixed(1) + ' , ' + num(v.y, 0).toFixed(1);
        return;
      }
      if (f === 'capacitors') {
        r['capacitors'] = (v || []).map(function (c) {
          return num(c.kvar, 0) + ' kvar at ' + num(c.detune, 0) + '% detuning';
        }).join(', ') || 'none';
        return;
      }
      /* Nested objects are compared by value, so two identical things are equal
         rather than merely structurally similar. JSON with sorted keys gives a
         canonical string for that. */
      r[f] = (typeof v === 'object') ? stable(v) : v;
    });
    return r;
  }
  /* Key order in an object is insertion order, which is stable for the same
     construction path but not across two loads of the same data. Sorting the keys
     is what makes "unchanged" mean unchanged. */
  function stable(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(stable);
    var k = Object.keys(v).sort(), o = {};
    k.forEach(function (x) { o[x] = stable(v[x]); });
    return JSON.stringify(o);
  }

  /* The diff itself. Each entry says what changed and whether it would have
     required the drawing or the schedule to be reissued — which is the only
     reason to record the distinction. */
  function diffProjects(pBefore, pAfter) {
    var a = snapshotForDiff(pBefore), b = snapshotForDiff(pAfter);
    var changes = [];
    Object.keys(b).forEach(function (k) {
      var before = a[k], after = b[k];
      if (before === undefined) {
        changes.push({ kind: 'added', key: k, after: after, critical: true });
        return;
      }
      if (before === null) return;
      var fields = [];
      Object.keys(after).forEach(function (f) {
        if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) {
          fields.push({ field: f, from: before[f], to: after[f] });
        }
      });
      if (!fields.length) return;
      /* A change is critical if any field it touches is. The position of a
         circuit on the plan is not; its rating is. */
      var critical = fields.some(function (f) {
        return REVISION_FIELDS.critical.indexOf(f.field) >= 0;
      });
      changes.push({ kind: 'changed', key: k, fields: fields, critical: critical });
    });
    Object.keys(a).forEach(function (k) {
      if (b[k] === undefined) changes.push({ kind: 'removed', key: k, before: a[k], critical: true });
    });
    return {
      changes: changes,
      critical: changes.filter(function (c) { return c.critical; }).length,
      total: changes.length
    };
  }

/* ======================================================== demand coincidence ==
     There are two ways to get from connected load to the load a supply actually
     carries, and they are alternatives rather than layers.

     **Per-circuit demand factor.** Every circuit is given its own multiplier,
     from its own duty cycle — a chiller at 0.8, a sump pump at 0.3. The board
     total is the sum of the diversified circuits. This is what a load schedule
     carries, and it is right for a board whose circuits have genuinely different
     duty cycles.

     **Coincidence factor.** The connected load is summed first and the *board*
     is then given a multiplier, because its circuits do not all peak together.
     This is right for a board of identical loads — twenty identical pumps do not
     all run at once — and it is the only one of the two that says anything about
     simultaneity.

     Stacking them is the common mistake, and it is a serious one: applying a
     0.8 coincidence factor on top of per-circuit factors of 0.1 to 0.8
     double-counts the same diversification and can report half the real load.
     Worse, it does it silently — the numbers still look plausible.

     So the method is a *declared choice*, and the app says which one is in use
     and what each would give. That way the assumption is visible and the two
     figures can be compared rather than one being quietly compounded.

     Neither is wrong. They answer different questions, and the honest thing is
     to state which question was asked. */
  var COINCIDENCE_BANDS = [
    { name: 'identical mixed loads', factor: 0.70, note: 'A board of identical or similar loads — a bank of pumps, a row of fans — where the diversity is entirely in the simultaneity rather than in the duty cycles.' },
    { name: 'repetitive plant',       factor: 0.60, note: 'Repetitive production load with a well-established running pattern: a test rig, a filling line, a set of identical machines on a common cycle.' },
    { name: 'mixed plant, known duty', factor: 0.80, note: 'A mixed board whose per-circuit demand factors are known and well founded. The diversity is in the duty cycles, and the simultaneity is assumed to follow it.' },
    { name: 'mixed plant, unknown duty', factor: 0.90, note: 'No information about duty cycles. A conservative figure — it assumes most of the board is running together.' },
    { name: 'continuous, no diversity', factor: 1.00, note: 'Everything runs continuously and there is no diversity to allow for. A value of 1.0 is the honest answer for a board of constant loads.' }
  ];

  /* One board, by both methods, so the comparison is on the page rather than in
     someone's head. */
  function demandMethods(p, board, kind) {
    var st = boardStats(p, board, kind);
    /* Method 1: sum of per-circuit diversified loads. This is what the schedule
       already carries, so it is the default and it is what everything else in
       the app has been reporting. */
    var perCircuit = 0, connected = 0;
    st.panels.forEach(function (pn) {
      var d = panelDemand(p, pn);
      perCircuit += d.kva;
      connected += d.kw / d.pf;
    });
    /* Method 2: connected total times a coincidence factor. */
    var bands = COINCIDENCE_BANDS.map(function (b) {
      return {
        name: b.name, factor: b.factor, note: b.note,
        kva: connected * b.factor,
        /* How far this lands from the per-circuit answer, which is the useful
           number: a factor that nearly halves the load is worth knowing about. */
        vsPerCircuit: perCircuit > 0 ? (connected * b.factor) / perCircuit : null
      };
    });
    return {
      connectedKva: connected,
      perCircuitKva: perCircuit,
      perCircuitRatio: connected > 0 ? perCircuit / connected : null,
      bands: bands,
      /* Declared on the project, so the choice is a fact about the design rather
         than a default buried in the arithmetic. */
      method: p.design.demandMethod || 'per-circuit',
      /* Stating whether both are in play is the whole point of this section. */
      stacking: p.design.applyCoincidence === true && p.design.demandMethod !== 'per-circuit'
    };
  }

  /* Which figure the app uses. Kept in one place so the schedule, the board
     statistics, the audit and the capacity check cannot disagree about it. */
  function boardDemandKva(p, board, kind) {
    var st = boardStats(p, board, kind);
    var m = demandMethods(p, board, kind);
    if (p.design.demandMethod === 'coincidence') {
      /* Which band, if declared. An undeclared band is a gap and is reported
         rather than filled with a number nobody chose. */
      var band = null;
      if (p.design.demandMethodBand) {
        m.bands.forEach(function (b) { if (b.name === p.design.demandMethodBand) band = b; });
      }
      /* With no band declared the conservative end is used — the one that does
         not understate the load — and the audit says so. */
      return band ? band.kva : m.connectedKva;
    }
    return m.perCircuitKva;
  }

/* =========================================================== voltage profile ===
     Voltage drop is not a property of a circuit. It is a property of a *path*:
     every metre of cable between the transformer and the far end of the site
     carries every ampere flowing through it, and the drops add.

     BS 7671 sets 3% on lighting and 5% on other uses for the total from the
     origin. Almost every spreadsheet reports one number per circuit — the drop
     across that circuit's own feeder — and it is the wrong number, because the
     drop across the board's own feeder, and the main board's feeder, and the
     transformer's own winding, are all upstream of it and all count.

     The difference is not marginal. On this project the feeders contribute a few
     tenths of a percent, so the total is dominated by whatever sits above them.
     A circuit reported at 1.2% that sits 180 m from the transformer on a long
     thin feeder can be at 4% overall, which fails.

     What is summed here, in order from the source:

       - the transformer's own impedance, as a voltage drop at the load power
         factor — a transformer has a finite %Z and it drops voltage under load
         exactly as a cable does
       - each board's incoming feeder
       - the circuit's own feeder

     Busbars and joints are neglected. That is the honest approximation: busbar
     drops are small, joint contact resistances are unknown, and a figure quoted
     to a thousandth of a percent that ignores both is theatre.

     The result is the one number that answers "is the far end of this site
     within limits", and it is the number that decides whether the answer is
     still yes after another phase is added to the plant. */
  function voltageProfile(p, pn, opts) {
    opts = opts || {};
    /* Walk the path from the transformer down to the circuit. Each hop carries
       the load below it, which is the whole point — the drop on a feeder is
       driven by everything downstream of it, not by the circuit it serves. */
    var ch = chain(p, pn);
    var path = [];
    if (ch.tx) path.push({ item: ch.tx, kind: 'tx', cable: null });
    if (ch.pdb) path.push({ item: ch.pdb, kind: 'pdb', cable: ch.pdb.cable });
    if (ch.pdp) path.push({ item: ch.pdp, kind: 'pdp', cable: ch.pdp.cable });
    /* A sub-board, if there is one. chain() does not resolve it, because a
       circuit may hang off a sub-board or straight off a distribution board. */
    var db = pn.dbId ? get(p, 'db', pn.dbId) : null;
    if (db) path.push({ item: db, kind: 'db', cable: db.cable });
    path.push({ item: pn, kind: 'panel', cable: pn.cable });

    /* The current each hop carries is everything below it. Building it from the
       bottom up means the deepest feeder is asked for its own current and each
       level above inherits that plus its own other children. */
    var steps = [];
    var volts = 0;
    for (var i = 0; i < path.length; i++) {
      var hop = path[i];
      /* What flows through this hop: the total of every circuit at or below it.
         For a board that is the whole sub-tree, for a circuit it is itself. */
      var below = loadBelow(p, hop.item, hop.kind);
      if (!below || !(below.amp > 0)) continue;
      var drop;
      if (hop.kind === 'tx') {
        /* The transformer's own voltage drop. %Z is measured at rated current,
           so the drop is (%Z/100) × V × cos(φ) at the load power factor — the
           resistive part only, because the reactance's contribution to a drop
           is small at these power factors and excluding it is conservative in
           the wrong direction only marginally. */
        var zpu = num(hop.item.impZ, 6);
        if (!isFinite(zpu) || zpu <= 0) zpu = 6;
        var vtx = num(hop.item.kvOut, num(hop.item.volt, 400), 400) * 1000;
        /* %Z is the drop at RATED current, so the drop at the actual load scales
           with the loading ratio. Omitting that ratio reports the worst case
           always, which on a lightly-loaded transformer is several times the real
           figure — and a volt drop that is overstated everywhere is worthless,
           because the point of the number is finding the circuits that genuinely
           fail. */
        var ratedA = (num(hop.item.kva, 0) * 1000) / (Math.sqrt(3) * vtx);
        var loading = ratedA > 0 ? below.amp / ratedA : 1;
        /* Above rating the drop keeps rising, but the linear extrapolation stops
           being meaningful — a transformer at 130% is a problem the volt drop
           calculation is not the way to find. Capped, and flagged. */
        var capped = loading > 1.25;
        drop = (zpu / 100) * vtx * Math.max(0, below.pf) * Math.min(loading, 1.25);
      } else if (hop.cable && num(hop.cable.csa, 0) && num(hop.cable.len, 0)) {
        var cab = hop.cable;
        var r = voltDrop(cab, below.amp, below.pf, below.phases, below.volt);
        drop = r.volts;
      } else {
        /* No cable stated. Not zero — unknown. The hop is recorded so the total
           is visibly incomplete rather than quietly optimistic. */
        steps.push({
          /* The id as well as the tag: a tag is editable and a caller matching on
             it silently matches nothing after a rename, which is how the tap
             finding ended up finding no transformer at all. */
          id: hop.item.id,
          tag: hop.item.tag || hop.item.ref || '—', kind: hop.kind,
          volts: 0, unknown: true, amp: below.amp,
          label: hop.cable && num(hop.cable.len, 0)
            ? 'no conductor size stated'
            : 'no route length stated'
        });
        continue;
      }
      volts += drop;
      steps.push({
        id: hop.item.id,
        tag: hop.item.tag || hop.item.ref || '—', kind: hop.kind,
        volts: drop, amp: below.amp, pf: below.pf,
        loading: loading, overloaded: capped,
        csa: hop.cable ? num(hop.cable.csa, 0) : null,
        len: hop.cable ? num(hop.cable.len, 0) : null
      });
    }

    var v = num(pn.volt, 400) || 400;
    var pct = (volts / v) * 100;

    /* The transformer's own drop is a commissioning setting, not a design
       defect.

       A distribution transformer has a tap selector — normally on-load — and it
       is set to raise the LV terminals so the voltage at the expected load
       point is right. The %Z drop is what the tap is there to cancel. Including
       it in the design total would make every circuit on the installation fail
       for the same reason, which destroys the one thing the number is for:
       telling you which circuits are the problem.

       So both figures are reported. The wiring drop is what the design controls
       and what the limit is applied to. The transformer drop is stated
       separately, as the number that sets the tap. */
    var txVolts = 0, wiringVolts = 0;
    steps.forEach(function (s) {
      if (s.kind === 'tx') txVolts += s.volts; else wiringVolts += s.volts;
    });

    /* Which limit applies, and why.

       There are two and they are not interchangeable. BS 7671 allows 3% of the
       supply voltage for a lighting final circuit and 5% for any other final
       circuit, and 3% for the distribution wiring between boards. Applying the
       distribution figure to a final circuit judged every power circuit against
       the wrong number — and the finding's own text said "3% for lighting and 5%
       for other uses" while the arithmetic underneath it used 3% for both.

       The project carries both settings; the final-circuit one was never read
       anywhere in the app. Lighting is taken from the declared load type and the
       reference, and where neither says so the more permissive figure is used:
       a limit that cannot be justified from the data should not be the one that
       fails a circuit. */
    var lighting = /light/i.test((D.PANEL_TYPES[pn.type] || {}).name || '') ||
                   /light/i.test(pn.name || '') || /light/i.test(pn.tag || '');
    var limit, limitWhy;
    if (opts.limit !== undefined) {
      limit = opts.limit;
      limitWhy = 'the figure supplied for this call';
    } else if (lighting) {
      limit = num(p.design.vdropLimitLv, 3);
      limitWhy = '3% for a lighting final circuit';
    } else if (pn.__kind === 'panel' || !pn.__kind) {
      limit = num(p.design.vdropLimitFinal, 5);
      limitWhy = '5% for a final circuit that is not lighting';
    } else {
      limit = num(p.design.vdropLimitLv, 3);
      limitWhy = '3% for the distribution wiring between boards';
    }
    return {
      volts: volts, pct: pct, steps: steps,
      volt: v, limit: limit, limitWhy: limitWhy, lighting: lighting,
      /* the design figure: what the cables cost */
      wiring: { volts: wiringVolts, pct: (wiringVolts / v) * 100 },
      /* what the tap has to cancel */
      transformer: { volts: txVolts, pct: (txVolts / v) * 100 },
      /* Anything unaccounted for is flagged, not folded in silently. */
      incomplete: steps.some(function (s) { return s.unknown; }),
      unknownCount: steps.filter(function (s) { return s.unknown; }).length,
      /* Judged on the wiring, because that is what the design can change. */
      over: (wiringVolts / v) * 100 > limit + 1e-9,
      /* and the total, for anyone who wants it — reported, not used to fail it */
      overIncludingTransformer: pct > limit + 1e-9
    };
  }

  /* Everything fed at or below one point, as the current that actually flows
     through the feeder arriving at it. This is the load the *upstream* cable
     carries, and getting it right is what makes the profile a profile rather
     than a sum of individual circuit drops. */
  function loadBelow(p, item, kind) {
    if (kind === 'tx') {
      /* A transformer's outgoing total is the site total — every main board it
         feeds, in parallel. */
      var all = [], seen = {};
      (p.pdbs || []).forEach(function (b) {
        if (b.txId !== item.id) return;
        panelsBelow(p, b, 'pdb').forEach(function (pn) {
          var k = (pn.__kind || 'panel') + ':' + pn.id;
          if (seen[k]) return;
          seen[k] = 1; all.push(pn);
        });
      });
      return summariseLoad(p, all);
    }
    if (kind === 'pdb')  return summariseLoad(p, panelsBelow(p, item, 'pdb'));
    if (kind === 'pdp')  return summariseLoad(p, panelsBelow(p, item, 'pdp'));
    if (kind === 'db')    return summariseLoad(p, panelsBelow(p, item, 'db'));
    if (kind === 'panel') return summariseLoad(p, [item]);
    return null;
  }

  /* Everything downstream of a board, circuit by circuit.

     Written as a walk rather than by reusing the panelsOn* helpers because each
     of those answers a different question — panelsOnPdb is deliberately the
     circuits hanging *directly* off a main board, not the whole sub-tree — and
     reaching for the nearest one that looked right would have quietly counted
     half a board's load. */
  function collectDown(p, board, kind, out) {
    if (kind === 'pdb') {
      /* circuits straight off this board, plus everything under each PDP */
      (p.panels || []).forEach(function (pn) { if (pn.pdbId === board.id && !pn.pdpId) out.push(pn); });
      (p.pdps || []).forEach(function (b) { if (b.pdbId === board.id) collectDown(p, b, 'pdp', out); });
    } else if (kind === 'pdp') {
      (p.panels || []).forEach(function (pn) { if (pn.pdpId === board.id && !pn.dbId) out.push(pn); });
      (p.dbs || []).forEach(function (b) { if (b.pdpId === board.id) collectDown(p, b, 'db', out); });
    } else if (kind === 'db') {
      (p.panels || []).forEach(function (pn) { if (pn.dbId === board.id) out.push(pn); });
    }
  }

  /* The same walk, but returning a de-duplicated list. A circuit reachable by two
     routes would otherwise be counted twice, which is precisely what a tree
     prevents — and a load counted twice reports a volt drop twice as large as
     it is, which is the more dangerous of the two errors here. */
  function panelsBelow(p, board, kind) {
    var acc = [];
    collectDown(p, board, kind, acc);
    var seen = {}, uniq = [];
    acc.forEach(function (pn) {
      var k = (pn.__kind || 'panel') + ':' + pn.id;
      if (seen[k]) return;
      seen[k] = 1; uniq.push(pn);
    });
    return uniq;
  }

  /* One set of circuits, as the current their feeder carries. Three-phase is
     the default because that is what a board feeder is; a site mixing phases
     cannot be summarised by a single number, and saying so beats a figure
     that silently assumes. */
  function summariseLoad(p, panels) {
    if (!panels || !panels.length) return null;
    var amp = 0, kva = 0, kw = 0, mixed = false, phases = '3';
    panels.forEach(function (pn) {
      var d = panelDemand(p, pn);
      /* Harmonic current adds to the RMS the conductor carries, and this is the
         one place that matters: a run sized on the fundamental RMS can be
         driven harder by the harmonic content than by the load itself. */
      amp += d.ampHarm || d.amp;
      kva += d.kva; kw += d.kw;
      if (String(pn.phases) !== '3') mixed = true;
    });
    return {
      amp: amp, kva: kva, kw: kw,
      pf: kva > 0 ? D.clamp(kw / kva, 0.01, 1) : 1,
      phases: mixed ? '1' : '3',
      count: panels.length,
      /* Stated rather than assumed away: a path that mixes single- and
         three-phase cannot be given one volt drop. */
      mixedPhases: mixed
    };
  }

  /* The worst end of the site, which is the answer to the question a client
     actually asks. Not an average and not a worst case — the circuit with the
     largest total drop from its transformer, which is the one that decides
     whether the installation complies. */
  function voltageProfileWorst(p, opts) {
    var worst = null, profiles = [];
    (p.panels || []).forEach(function (pn) {
      var vp = voltageProfile(p, pn, opts);
      if (!vp) return;
      vp.pn = pn;
      profiles.push(vp);
      if (!worst || vp.pct > worst.pct) worst = vp;
    });
    profiles.sort(function (a, b) { return b.pct - a.pct; });
    return { worst: worst, profiles: profiles };
  }

/* ============================================================ arc flash =====
     Deliberately not an incident energy number.

     IEEE 1584-2018 is the method an arc flash study uses, and it is a
     multi-step interpolation across three reference voltages requiring inputs
     this app does not hold and cannot infer:

     - **electrode configuration** (VCB, VCBB, HCB, VOA, HOA). Reclassifying
       equipment from VCB to HCB roughly doubled the calculated energy when the
       standard was revised — it is not a detail.
     - enclosure dimensions, for the containment correction factor
     - conductor gap between phases
     - the arcing current, which is *below* the bolted fault current and is
       itself an interpolation

     All of those come from inspecting the equipment or from a manufacturer's
     drawings. Guessing them would produce a number that looks authoritative on a
     label governing whether someone wears an arc flash suit, and NFPA 70E does
     not permit the table method and the incident energy method to be mixed on the
     same equipment — so a wrong number here does not merely mislead, it puts two
     incompatible bases on one piece of gear.

     So this calculates the two things that ARE determined by the data the app
     actually has, and states the scaling that turns them into energy. Both are
     exact and neither depends on the missing inputs.

     **Arcing time** is set by the device that clears the fault, at the fault
     current — which is already computed from real trip curves. It dominates the
     answer, linearly: a device clearing in 100 ms rather than 500 ms gives a
     fifth of the incident energy. This is why selective coordination and arc
     flash safety are the same study, and it is the one finding worth acting on.

     **Working distance** matters through the inverse-square law for a point
     source, tempered by an arc that is not a point. NFPA's tables fit an exponent
     near 0.58 rather than 2, which is the difference between "assume the
     worst" and "what the standard actually says".

     The boundary at 1.2 cal/cm² — the onset of a second-degree burn on bare skin,
     and the distance an unprotected person must stand — is defined by the same
     energy, so the ratio of one energy to another gives the distance without ever
     needing the absolute value. That is a genuinely useful result and it is
     obtainable. */
  function arcTimeAt(p, item) {
    /* How long the arc burns before the device above it clears. Taken from the
       trip curve at the fault current, which is what a study does — and the
       honest answer when no device is specified is "not knowable", not a
       default. */
    var prot = item.prot;
    if (!prot || !(num(prot.ir, 0) > 0)) return null;
    var fl = faultLevel(p, item, kindOf(item));
    if (!fl || !(fl.kA > 0)) return null;
    var ia = fl.kA * 1000;
    var t = clearingTimeAt(prot, ia / num(prot.ir, 1));
    if (t === null || !isFinite(t)) return null;
    /* A curve that clears in over a second is not a curve anyone publishes past,
       and the model is not valid out there. Said rather than extrapolated. */
    return {
      seconds: t, ms: t * 1000, faultKA: fl.kA, ir: num(prot.ir, 0),
      /* the time an unprotected worker is exposed for */
      atBoundary: t
    };
  }

  /* The working-distance scaling NFPA's tables embody: an exponent near 0.58
     rather than the inverse-square of a point source, because the arc is a column
     of plasma a metre or so long rather than a point. */
  function arcDistanceFactor(distance, ref, exponent) {
    var a = num(exponent, 0.58);
    var d = num(distance, 0.5);
    var r = num(ref, 0.5);
    if (!(d > 0) || !(r > 0)) return null;
    return Math.pow(d / r, a);
  }

  /* What can be said honestly about a piece of equipment, given what the app
     knows: the arcing time, and the ratio between two candidate arrangements. */
  function arcAssessment(p, item) {
    var t = arcTimeAt(p, item);
    if (!t) return { known: false };
    return {
      known: true,
      seconds: t.seconds, ms: t.ms, faultKA: t.faultKA,
      /* A clearing time under 100 ms puts this in the range where the energy is
         usually low enough for ordinary arc-rated clothing. Over 500 ms and it is
         a flash suit question. The bands are NFPA's PPE levels, and saying which
         band a device falls into is more useful than a fabricated figure. */
      band: t.seconds <= 0.1 ? 'likely Category 1–2 (≤ 8 cal/cm²)' :
            t.seconds <= 0.2 ? 'Category 2–3 (8–25 cal/cm²)' :
            'Category 3–4, possibly above 40 cal/cm²',
      /* The two changes that dominate, in order. */
      levers: [
        'Arcing time — linear. Clearing in ' + (t.ms).toFixed(0) +
          ' ms rather than ' + (t.ms * 2).toFixed(0) + ' ms halves the energy.',
        'Working distance — a 0.58 power, so doubling the distance from 0.5 m to ' +
          '1.0 m gives about 60% of the energy at 0.5 m.'
      ]
    };
  }

/* ================================================ short-circuit impedance =====
     The fault level was a single assumption: 6% per distribution stage, whatever
     is actually there. That is defensible as a placeholder and wrong as an
     answer, because the impedance between the transformer and a board is not a
     stage count — it is the transformer's impedance, the busbars, and the length
     and size of every cable above the point in question.

     Doing it properly means summing per-unit impedances down the chain:

         Z_pu(source) = Z_pu(transformer)
         Z_pu(board)   = Z_pu(source) + Z_pu(busbars above) + Z_pu(cable above)

     where the cable's impedance in per-unit is

         Z_pu = (R + jX)·S_base / V_base²

     and a fault current follows from

         I_f = V / (√3 · Z_base · Z_pu)

     The difference matters because the blanket figure overstates the fault level
     on a long, thin feeder and understates it on a short, fat one — and fault
     level decides device breaking capacity and cable thermal withstand, so the
     error runs straight into two other checks.

     What this is NOT: a protected network. It assumes every source is
     energised, ignores generator contribution, and does not model an
     auto-transformer tap or a pre-inserted resistor. It is a strong short-circuit
     calculation, not a network study, and the findings say so. */
  function impedanceBase(tx, volt) {
    var sn = num(tx.kva, 0);
    if (!(sn > 0)) return null;
    var v = num(volt, 400) || 400;
    var ib = (sn * 1000) / (Math.sqrt(3) * v);
    /* Z_base = V²/S, with S in VA. Written from the base current so that the
       kVA/VA conversion happens once, visibly, in one place.
         Z_base = V / (√3 · Ib) = V / (√3 · S/√3V) = V²/S

       Every cable impedance is divided by this to become per-unit, so a mistake
       here is a mistake in every fault level on the project. It was made twice,
       below, by writing V²/S with S in kVA — which is 1000× too large, so every
       cable looked 1000× more conductive than it is. A 16 mm² feeder 11 m from a
       3,150 kVA transformer has 0.0157 Ω against a source of 0.0030 Ω: it is
       five times the source and limits the fault at its own far end to about
       12 kA. The app reported 75 kA there, which is the prospective fault at the
       board and not the fault in that cable — and every thermal withstand finding
       downstream was computed against a current the conductor cannot actually
       carry. */
    var zBase = v / (Math.sqrt(3) * ib);
    return {
      snKva: sn, volt: v,
      /* base current — the per-unit reference for everything below */
      ibA: ib,
      zBase: zBase,
      /* the transformer, referred to this base rather than to its own */
      puTransformer: (function () {
        var zpu = num(tx.impZ, 6);
        if (!isFinite(zpu) || zpu <= 0) zpu = 6;
        return zpu / 100;
      })()
    };
  }

  /* One element's impedance in per-unit on the transformer's base. A cable's
     contribution depends on its length and size; a busbar's on nothing at all,
     which is why it needs to be counted rather than assumed. */
  function puImpedance(cable, base) {
    if (!cable || !base) return 0;
    var z = cableImpedance(cable);
    var km = num(cable.len, 0) / 1000;
    var runs = Math.max(1, num(cable.runs, 1));
    /* Ohms in series with the load, referred to the source base by the standard
       Z_base = V²/S three-phase. */
    var zOhm = Math.sqrt(z.r * z.r + z.x * z.x) * km / runs;
    /* The base from the one place it is computed, not recomputed. See the note
       in impedanceBase(): writing V²/S with S in kVA made every feeder look
       1000× more conductive than it is. */
    var zBaseOhm = base.zBase;
    if (!(zBaseOhm > 0)) return 0;
    return zOhm / zBaseOhm;
  }

  /* Every element between the transformer and a board, as per-unit on the
     transformer's base. Busbars are counted as a fixed impedance because they
     have a length and a rating; a board 3 m away and a board 60 m away are
     genuinely different. */
  function pathImpedance(p, item, kind, base) {
    var total = 0, parts = [];
    /* chain() returns the ANCESTORS of an item, so for a main board it comes
       back empty and the transformer has to be found from the item itself. */
    var ch = chain(p, item);
    if (kind === 'tx') ch = { tx: item };
    else if (kind === 'pdb' && !ch.tx && item.txId) ch = { tx: get(p, 'tx', item.txId) };
    function add(label, ohms) {
      if (!(ohms > 0)) return;
      total += ohms;
      parts.push({ label: label, ohm: ohms });
    }
    /* The transformer itself, which is the only impedance that is certain. */
    var tx = kind === 'tx' ? item : ch.tx;
    if (tx && base.puTransformer > 0) {
      add(tx.tag + ' at ' + (base.puTransformer * 100).toFixed(1) + '%', base.puTransformer);
    }
    var zBaseOhm = base ? base.zBase : 0;
    if (zBaseOhm > 0) {
      /* The busbar run at each board between it and its parent, and the cable. */
      /* A board's own incoming feeder. The parent lookup that used to guard this
         was doing nothing useful and silently dropping the cable: a main board
         fed from a transformer has no pdbId, so the lookup failed and the feeder
         was never added — which is why the impedance and the stage count came out
         identical at every board. */
      function via(o, what) {
        if (!o || !o.cable) return;
        var csa = num(o.cable.csa, 0);
        var len = num(o.cable.len, 0);
        if (!(csa > 0) || !(len > 0)) return;
        var pu = puImpedance(o.cable, base);
        if (pu > 0) add((o.tag || what) + ' ' + csa + ' mm² × ' + len + ' m', pu);
      }
      if (kind === 'pdb') via(item, 'pdb');
      else if (kind === 'pdp') via(item, 'pdp');
      else if (kind === 'db') via(item, 'db');
      else {
        /* A circuit: every board above it, then the circuit's own feeder. */
        if (ch.pdp) via(ch.pdp, 'pdp');
        if (ch.db) via(ch.db, 'db');
        if (ch.pdb) via(ch.pdb, 'pdb');
        var cp = puImpedance(item.cable, base);
        if (cp > 0) add(item.tag + ' feeder ' + num(item.cable && item.cable.csa, 0) + ' mm² × ' + num(item.cable && item.cable.len, 0) + ' m', cp);
      }
    }
    return { pu: total, parts: parts, ohm: total * zBaseOhm };
  }

  /* The fault level at a point, from the summed impedance rather than a stage
     count. Falls back to the stage-count figure where there is no cable data to
     sum, and says which was used — the two can differ by a factor of two, and a
     reader must not be left assuming the better one. */
  function faultLevel(p, item, kind) {
    /* Same trap as in pathImpedance: chain() gives an item's ancestors, and for a
       main board that is nothing at all — the transformer comes off the item. */
    var ch = chain(p, item);
    if (kind === 'tx') ch = { tx: item };
    else if (kind === 'pdb') ch = { tx: get(p, 'tx', item.txId) };
    var tx = ch.tx;
    if (!tx) return null;
    var volt = num(item.volt, 400) || 400;
    var base = impedanceBase(tx, volt);
    if (!base) return null;
    base.volt = volt;
    var path = pathImpedance(p, item, kind, base);
    var zpu = path.pu;
    if (!(zpu > 0)) return null;
    /* I_f = I_base / Z_pu */
    var amps = base.ibA / zpu;
    var kA = amps / 1000;
    /* The old stage-count figure, for comparison. */
    var zpuStage = num(p.design.zpuPerStage, 0.06);
    var stages = 1;
    if (kind === 'pdp') stages = 2;
    else if (kind === 'db') stages = 3;
    else if (kind !== 'tx') stages = 4;
    var legacy = txFaultKA(p, tx);
    for (var i = 0; i < stages; i++) legacy /= (1 + zpuStage);
    return {
      kA: kA, pu: zpu, parts: path.parts, ohm: path.ohm,
      base: base, tx: tx, volt: volt,
      legacyKA: legacy,
      /* how far apart the two methods are, which is the honest measure of whether
         the impedance data was worth having */
      ratio: legacy > 0 ? kA / legacy : null,
      /* true only when every element above had real data, not a default */
      fromImpedance: path.parts.length > (kind === 'tx' ? 1 : 2)
    };
  }

/* ========================================================= PF correction =====
     Correcting a power factor is arithmetic; knowing whether it is safe to do is
     not, and the safety is where the engineering actually is.

     **The arithmetic.** To move from pf1 to pf2 at a load of P kW:

         Q1 = P·tan(φ1)      the reactive power now
         Q2 = P·tan(φ2)      the reactive power wanted
         Qc = Q1 − Q2        what the bank supplies

     That is the whole sizing calculation and it is exact.

     **The risk.** A capacitor is a reactance. The supply is an inductance. Put
     them together and they resonate, and at resonance the harmonic currents a
     bank of drives produces are amplified rather than absorbed:

         f_r = √(S_sc / Qc)     for an undamped bank, in multiples of 50 Hz

     This is not a theoretical concern on a drive-fed site. A six-pulse drive's
     characteristic harmonics are the 5th (250 Hz) and 7th (350 Hz), so a bank
     whose resonance lands between about 4× and 8× the fundamental sits directly
     on them. On the real project, 1,300 kvar of correction on a source of about
     50 MVA resonates near the 7th — which is one of the two frequencies the
     drives produce most of.

     **The fix is a detuning reactor**, which puts a series inductor in front of
     each capacitor to move the resonance up and out of the way:

         f_r = 1 / √k        for a detuned branch, k = the reactor's fraction

     Per unit on the capacitor's reactance, a series reactor-capacitor branch has
     an impedance of j(h·k − 1/h) at harmonic h, which vanishes when h² = 1/k. So
     a 7% reactor puts the resonance at 3.79× the fundamental — clear above the 7th
     — and it does so regardless of what the system impedance is doing. That is
     the point of a detuning reactor: it sets the frequency rather than hoping the
     source happens to be stiff enough. The cost is about 1.7% of the capacitor's
     output, which is a small price for taking the resonance off a harmonic.

     **Why it matters physically.** At resonance the harmonic current sees a low
     impedance and the voltage across the capacitor rises. The standard allows
     110% of rated; a resonant bank can exceed that, and the capacitor fails. It
     is also loud, and the losses go up. Every serious capacitor application on a
     drive-fed site is detuned for this reason, and the cost of the reactors is
     part of the bank, not an accessory. */
  function pfCorrection(p, load, targetPf, capKvar) {
    /* The kW that shares the kVA's basis. `load.kw` is connected and `load.kva`
       is diversified, so using the former gave a ratio of 3.2 on the real project,
       which clamped to a power factor of 1 and a kvar of zero — and a capacitor
       calculation that cannot see the reactive power it exists to cancel. */
    var kva = load.kva;
    var kw = (load.diversified && load.kwDiv > 0) ? load.kwDiv : load.kw;
    if (!(kw > 0) || !(kva > 0)) return null;
    var pfNow = D.clamp(kw / kva, 0.01, 1);
    var tgt = Math.min(0.999, Math.max(0.5, num(targetPf, 0.98)));
    /* tan(φ) = √(1/pf² − 1), which is also the kvar per kW. */
    var tanNow = Math.sqrt(Math.max(0, 1 / (pfNow * pfNow) - 1));
    var tanTgt = Math.sqrt(Math.max(0, 1 / (tgt * tgt) - 1));
    var qNow = kw * tanNow, qTgt = kw * tanTgt;
    var needed = qNow - qTgt;
    /* A bank larger than the whole reactive load leaves the supply exporting
       reactive power, which is as wrong as being under-corrected and is harder
       to detect. */
    var fitted = num(capKvar, 0);
    /* A bank larger than the load's own reactive power exports reactive power
       rather than correcting it. 2% of tolerance, because a bank is switched in
       steps and a bank sitting exactly on the load's kvar is measured slightly
       over in practice. */
    var over = fitted > qNow * 1.02 && fitted > 1;
    var achieved = fitted > 0 && qNow > fitted
      ? (kw / Math.sqrt(kw * kw + Math.pow(qNow - fitted, 2)))
      : (fitted >= qNow ? 1 : pfNow);
    return {
      pfNow: pfNow, target: tgt, kw: kw, kva: kva,
      kvarNow: qNow, kvarTarget: qTgt, kvarNeeded: needed,
      kvaAtTarget: Math.sqrt(kw * kw + qTgt * qTgt),
      kvaSaving: kva - Math.sqrt(kw * kw + qTgt * qTgt),
      /* what is actually fitted, and where it lands */
      kvarFitted: fitted, achieved: achieved, overCorrected: over,
      worthIt: pfNow < num(p.design.pfPenaltyLimit, 0.95),
      /* the number that decides it: released kVA is transformer capacity */
      releasedKva: kva - Math.sqrt(kw * kw + Math.pow(qNow - Math.min(fitted, qNow), 2))
    };
  }

  /* Where a capacitor bank's resonance lands, and whether that is a problem.

     `faultKA` is the three-phase fault level at the board, from which the
     short-circuit power and hence the source inductance follow. `kvar` is the
     bank size. The answer is the resonance as a multiple of the fundamental,
     and the two harmonics a six-pulse drive produces most of are 5× and 7×. */
  function capResonance(p, faultKA, kvar, detune) {
    var volt = num(p.design.busVoltage, 400) || 400;
    var scVA = num(faultKA, 0) * 1000 * volt * Math.sqrt(3);   // VA
    var qVA = num(kvar, 0) * 1000;
    if (!(scVA > 0) || !(qVA > 0)) return null;
    /* S_sc / Q_c is dimensionless, so this is already in multiples of f0. */
    var ratio = scVA / qVA;
    var fUndamped = Math.sqrt(ratio);
    var k = num(detune, num(p.design.capDetune, 7)) / 100;
    /* The detuned branch is a series reactor and capacitor. Per unit on the
       capacitor's reactance at the fundamental, its impedance at harmonic h is
         Z = j(h·k − 1/h)
       which is zero when h² = 1/k. So the resonance is at 1/√k regardless of
       what the system is doing — which is the whole point of a detuning reactor:
       it sets the frequency itself, rather than hoping the system impedance puts
       the resonance somewhere harmless. A 7% reactor gives 3.79×, which clears
       the 7th harmonic of a six-pulse drive. */
    var fDetuned = k > 0 ? 1 / Math.sqrt(k) : fUndamped;
    /* Drives: characteristic harmonics of a six-pulse converter, as multiples. */
    var driveOrders = [5, 7, 11, 13];
    function nearest(f) {
      var best = null, bd = 1e9;
      driveOrders.forEach(function (o) {
        var d = Math.abs(Math.log(f / o));
        if (d < bd) { bd = d; best = o; }
      });
      return { order: best, distance: bd, ratio: f / best };
    }
    /* Voltage magnification at resonance, with the source's own resistance as
       the only damping. This is the number that decides whether the capacitor
       sees more than its rating: it is the reactance ratio at the resonant
       harmonic, and a 3rd harmonic on an undamped bank is many times rated. */
    function magnification(f) {
      /* Z_s at harmonic f, in per-unit on the bank. Source reactance scales with
         harmonic number; capacitor reactance scales inversely. */
      var xS = f;      // source reactance at f× fundamental, ∝ f
      var xC = 1 / f;  // capacitor reactance at f× fundamental, ∝ 1/f
      var rS = 0.05;   // a 5% source resistance, typical of a distribution source
      /* Parallel combination, magnitude. */
      var num2 = Math.sqrt(rS * rS + xS * xS) * xC;
      var den = Math.sqrt(Math.pow(rS, 2) + Math.pow(xS - xC, 2));
      return den > 0 ? num2 / den : 0;
    }
    var nU = nearest(fUndamped);
    var nD = nearest(fDetuned);
    /* Harmful means *on* a harmonic, not merely in the same neighbourhood.
       A wide band flagged 3.78× — which is exactly where a 7% reactor puts it —
       as harmful, and that is the position a detuned bank is chosen to reach.
       Below the 5th is the good place for a six-pulse load, because the 5th is
       the first harmonic it produces at all. */
    function onHarmonic(f) {
      return driveOrders.some(function (o) { return Math.abs(f / o - 1) < 0.15; });
    }
    function belowFirst(f) { return f < 4.6; }
    return {
      f: fUndamped, fDetuned: fDetuned,
      onHarmonic: onHarmonic(fUndamped),
      onHarmonicDetuned: onHarmonic(fDetuned),
      /* below the 5th, which is where a six-pulse load wants the resonance */
      belowFirst: belowFirst(fDetuned),
      nearest: nU, nearestDetuned: nD,
      detune: k * 100,
      /* kvar actually delivered with a reactor in circuit */
      delivered: num(kvar, 0) * (k > 0 ? (1 - k) : 1),
      /* what the source resistance alone can limit the magnification to */
      magAtFundamentalHarmonic: magnification(5)
    };
  }

/* ====================================================== earthing arrangements ==
     The supply system is not a label. It decides three things that change real
     numbers, and getting it wrong produces a design that passes the checks and
     still will not work.

     **The loop.** TN-S and TN-C-S both return the earth fault through the
     protective conductor, but TN-C-S shares the neutral and the protective
     conductor as one PEN over part of the run, so its loop impedance is lower
     for the length that is shared. TN-S runs them separately throughout, which
     gives a higher loop and the stricter requirement in practice. TT returns
     through the earth electrode and cannot be checked without its resistance.
     IT has no earthed source point, so a single fault does not raise the
     voltage on healthy metalwork — and disconnection must be by RCD.

     **The neutral.** On TN-S the neutral is bonded to earth at the source and
     nowhere else. It must not be interrupted by a single-pole isolator, it must
     not be re-bonded to earth downstream, and its voltage to earth is zero only
     because it is earthed at that one point. On TN-C-S the PEN does the same
     job for part of the run, so the rules there are about the PEN rather than
     about a separate neutral.

     **The conductors.** TN-S needs three phases, a neutral and a protective
     conductor, and the last two are separate for the whole installation. A
     three-phase-and-neutral feeder therefore needs five cores — four is a
     three-phase-and-neutral feeder with a bare PEN, which is TN-C-S and not
     TN-S. That is the difference between a cable that is correct and one that
     quietly converts the arrangement downstream of the first board. */
  function supplyArrangement(p) {
    var sys = String((p.design && p.design.supplySystem) || 'TN-S');
    if (sys.indexOf('TN-S') === 0) {
      return {
        system: 'TN-S',
        /* the neutral is a live conductor for its whole length and is earthed at
           one point only */
        neutralSeparate: true, pen: false,
        coresFor3PN: 5,      // L1 L2 L3 N PE, all separate
        earthedAt: 'source only',
        note: 'TN-S. The neutral is earthed at the source and stays a separate conductor throughout. ' +
              'It must not be interrupted by a single-pole switch, re-bonded to earth downstream, or used ' +
              'as a protective conductor, and the voltage to earth of the installation metalwork depends ' +
              'on that single earth connection staying intact.'
      };
    }
    if (sys.indexOf('TN-C-S') === 0) {
      return {
        system: 'TN-C-S',
        neutralSeparate: false, pen: true,
        /* 4 cores carries a PEN, which is this arrangement rather than TN-S */
        coresFor3PN: 4,
        earthedAt: 'source, then continuously exposed metalwork',
        note: 'TN-C-S. The neutral and protective conductors are combined as a PEN between the source and ' +
              'the first RCD, and separated downstream of it. A three-phase-and-neutral feeder therefore ' +
              'needs four cores, not five — but every PEN downstream of the source is also a neutral, and ' +
              'the arrangement only holds while that PEN is unbroken.'
      };
    }
    if (sys.indexOf('TT') === 0) {
      return {
        system: 'TT',
        neutralSeparate: true, pen: false,
        coresFor3PN: 5,
        earthedAt: 'the installation\'s own electrode',
        note: 'TT. The installation makes its own earth connection and the fault returns through it. The ' +
              'loop impedance depends on the electrode resistance, which is not a design choice and has to ' +
              'be measured — and an RCD is required, because that resistance can be high enough that an ' +
              'overcurrent device will not clear a 50 V touch voltage.'
      };
    }
    return {
      system: sys || 'IT',
      neutralSeparate: true, pen: false,
      coresFor3PN: 5,
      earthedAt: 'nothing — the system is unearthed',
      note: 'IT. There is no earthed source point, so a single fault does not raise the voltage on healthy ' +
            'metalwork. Disconnection cannot be by overcurrent device: an RCD is the only thing that clears a ' +
            'first fault, and the second fault is the one that matters.'
    };
  }

  /* What the arrangement demands of one feeder, against what the cable has. */
  function neutralCheck(p, pn) {
    var arr = supplyArrangement(p);
    if (String(pn.phases) !== '3') return null;
    var cores = num(pn.cable && pn.cable.cores, 4);
    var needsNeutral = hasNeutralConductor(pn);
    return {
      arr: arr, cores: cores, needsNeutral: needsNeutral,
      /* Declared, not inferred: whether this cable also carries the protective
         conductor. Blank is the normal state and says nothing either way. */
      peInCable: pn.peInCable === true,
      /* A cable carrying the PE in a fourth core alongside three phases and no
         neutral is a PEN, and that is TN-C-S on this feeder whatever the
         installation is called elsewhere. */
      pen: cores >= 5 && !needsNeutral
    };
  }

/* The fault currents to judge a pair over, in amps.

  The range starts where the *higher* of the two settings has just been reached,
  not the lower, and that distinction matters more than anything else here.

  Below the upstream setting the upstream device is barely warm and will take
  minutes. Comparing its fifteen-second clearing time against the lower device's
  thirteen finds a "failure" at a current where the upstream was never going to
  operate at all. A 63 A circuit under a 250 A board passes through 190 A on its
  way up, and at 190 A the upstream is at 76% — nothing is wrong, nothing needs
  to be selective, and reporting it teaches the reader to ignore the check.

  It ends at the prospective fault at the lower device's busbar, capped at 500 ×
  its own setting because no curve is published beyond that and extrapolating a
  logarithmic interpolation that far is arithmetic, not engineering.

  Logarithmic spacing, because the interesting behaviour is at both ends and
  evenly-spaced samples would find neither. */
var SELECTIVITY_STEPS = 60;
function selectivityLadder(downProt, upProt, faultAmps) {
 var irD = num(downProt.ir, 0), irU = num(upProt.ir, 0);
 if (!(irD > 0) || !(irU > 0)) return null;
 var lo = Math.max(irD, irU) * 1.02;
 var hi = faultAmps || irD * 50;
 if (hi > irD * 500) hi = irD * 500;   // beyond any curve's published end
 if (hi <= lo * 1.05) return null;
 var out = [], r = hi / lo;
 for (var i = 0; i <= SELECTIVITY_STEPS; i++) {
   out.push(lo * Math.pow(r, i / SELECTIVITY_STEPS));
 }
 return out;
}

/* Selectivity between a downstream device and the one above it.

  Returns null when there is nothing to compare. Otherwise:
    { pass, regime, fromA, fromKA, up, down }  */
function selectivity(down, downKind, up, upKind, faultAmps) {
 if (!down || !up || !down.prot || !up.prot) return null;
 var irD = num(down.prot.ir, 0), irU = num(up.prot.ir, 0);
 if (!(irD > 0) || !(irU > 0)) return null;
 var ladder = selectivityLadder(down.prot, up.prot, faultAmps);
 if (!ladder) return null;

 for (var i = 0; i < ladder.length; i++) {
   var I = ladder[i];
   var tD = clearingTimeAt(down.prot, I / irD);
   var tU = clearingTimeAt(up.prot, I / irU);
   /* Neither clears: the fault is above what either device is rated to
      interrupt, which is a breaking-capacity finding, not a selectivity
      one. Skip rather than report. */
   if (tD === null || tU === null) continue;
   /* The margin the standards ask for. A plain "clears first" would call a
      pair selective when one device clears at 0.0999 s and the other at
      0.1000 s, which is a coin toss at the tolerance of every real curve.
      A factor of 1.25 is the usual working figure and is what is used
      here; below it the pair is reported as partial, not as a pass. */
   if (tU / tD < 1.25) {
     /* Which regime, judged on the device that has to hold.

        The obvious test looks only at the device below, and it is wrong. A fault
        at 5.6 kA is 5.6 times the setting of a 1,000 A circuit device — well
        into its short circuit — and 1.4 times the setting of the 4,000 A board
        above it, which is still on that board's long-time characteristic. No
        delay can help there, because the board has not reached its short-time
        stage to be delayed. Reported as a short-circuit overlap it sends an
        engineer looking for a trip setting that does not exist; the answer is to
        stagger the ratings.

        Both devices decide it: the pair only counts as a short-circuit overlap
        when the current is high enough on the device ABOVE to be in its
        short-time band. */
     var upBelowS = I < SHORT_TIME_FROM * irU;
     var overload = I < irD * 1.5 || upBelowS;
     return {
       pass: false, partial: true, regime: overload ? 'overload' : 'short circuit',
       upBelowShortTime: upBelowS, upMultiple: I / irU, downMultiple: I / irD,
       fromA: I, fromKA: I / 1000,
       tDown: tD, tUp: tU, irDown: irD, irUp: irU,
       down: down, up: up, downKind: downKind, upKind: upKind
     };
   }
 }
 return { pass: true, regime: null, down: down, up: up, downKind: downKind, upKind: upKind,
          irDown: irD, irUp: irU };
}

function selectivityMessage(s, unit, delayHint) {
 var what = unit + ' on ' + s.down.tag + ' against ' + s.up.tag;
 if (s.regime === 'overload') {
  /* The overlap is below the short-time band of the device above. Nothing that
     can be set on that device changes it, and telling someone to set a short-time
     delay here sends them to a setting that does not apply at this current. */
  if (s.upBelowShortTime) {
   return 'The curves overlap at ' + s.fromKA.toFixed(1) + ' kA, which is ' +
     s.downMultiple.toFixed(1) + ' × the ' + s.down.tag + ' setting but only ' +
     s.upMultiple.toFixed(1) + ' × the ' + s.up.tag + ' one — the ' +
     s.down.tag + ' device takes ' + msOrS(s.tDown) + ' and the ' + s.up.tag +
     ' device above it ' + msOrS(s.tUp) + '. That current is on ' +
     'the long-time characteristic of the board above, where its short-time ' +
     'stage has not taken over, so a delay cannot reach it and grading cannot ' +
     'fix this pair. What is needed is spacing in the ratings: the ' + s.up.tag +
     ' should sit well clear of the current at which the ' + s.down.tag +
     ' acts, so that a fault on ' + s.down.tag + ' is unmistakably above the ' +
     'board\'s long-time pickup. There are two ways to get there and the second ' +
     'is usually the right one. Stagger the ratings — lower the ' + s.down.tag +
     ' setting, or raise the ' + s.up.tag + ' one — which is limited, because ' +
     'the ' + s.down.tag + ' device is already holding for ' + msOrS(s.tDown) +
     ' and the ratings are fixed by the load. Or fit the ' + s.up.tag +
     ' with a trip unit whose long-time pickup is adjustable — an IˡLS or IˡLSI — ' +
     'and set it so the board is already inside its short-time band at the ' +
     'currents below it see. That is the standard answer to exactly this ' +
     'overlap: it separates the pair at every current rather than only above ' +
     'the board\'s long-time knee, and it costs a trip unit rather than a ' +
     'redesign. If the current here is one the board will seldom see, accepting ' +
     'the overlap and saying so is defensible — what is not defensible is ' +
     'leaving it undecided.';
  }
  return 'The curves overlap on overload. At ' + s.fromKA.toFixed(1) +
    ' kA — only ' + (s.fromA / s.irDown).toFixed(1) + ' × its own setting — the ' +
    s.down.tag + ' device takes ' + msOrS(s.tDown) + ' and the ' + s.up.tag +
    ' device above it takes ' + msOrS(s.tUp) + '. An overload on this circuit would ' +
    'clear the wrong one. Raise the ' + s.up.tag + ' setting, or lower the ' +
    s.down.tag + ' one, so the curves separate.' +
    (delayHint ? ' ' + delayHint : '');
 }
 return 'The curves overlap above ' + s.fromKA.toFixed(1) + ' kA. At that current the ' +
   s.down.tag + ' device takes ' + msOrS(s.tDown) + ' and the ' + s.up.tag +
   ' device above it ' + msOrS(s.tUp) + ', so a fault on this circuit clears both — ' +
   'or the wrong one first. The fix is a short-time delay on the ' + s.up.tag +
   ' device, which holds it back over exactly this range' +
   (delayHint ? ': ' + delayHint + '. The whole installation has to be graded ' +
     'together, because a delay set on one board has to beat everything below it.' : '.');
}

/* ================================================== grading for selectivity ===
   The finding says a pair does not separate. This works out what would make it
   separate — for the whole installation at once, because grading is not a
   property of a pair.

   Solving each pair on its own gives an answer that inverts itself. On this
   project PDB8 came out wanting 0.15 s while the board below it wanted 0.8 s,
   and setting both leaves the main board opening before the distribution board
   on a fault anywhere below it — the opposite of the intent, and a harder fault
   than the one being fixed. The delay belongs to a device, and a device is
   graded against everything beneath it, so the requirement propagates up from
   the leaves and each board takes a delay longer than everything below it.

   So one pass, deepest board first:

     a device that is going to hold clears in its delay, above its long-time band
     and below any instantaneous pickup;
     a device that is not going to hold — a final circuit, or a trip unit with no
     short-time stage — presents whatever its own curve gives across the range
     where a delay could have acted;
     a board's delay is then the smallest standard one that clears more than
     1.25 times the slowest of those, which is the margin the selectivity check
     itself applies.

   The delay is searched over the manufacturer's standard values rather than over
   arithmetic, because a delay is only useful if it is one the device can be set
   to.

   Boards a delay cannot fix are reported with the reason rather than with a
   number that will not work:

     an LI above                     nothing to delay. Selective grading needs an
                                     LS or LSI unit.
     the lower device is itself slow  a longer delay above is not the answer,
                                     and past about a second the hold becomes a
                                     risk in its own right.
     nothing below it                nothing to grade against.

   Final circuits are listed but never given a delay: a device out at the end of
   a feeder is what it is, and holding it back would defeat the point of having
   one.

   Returned rather than applied. A trip unit setting is a commissioning action on
   installed equipment and has to be written against the device as well as
   entered here. */
/* Where a short-time stage begins to act, as a multiple of the setting.

   At 1.5 × In the device is still leaving its long-time band — the curves put
   it near 0.9 s there, on the thermal characteristic, which is overload
   territory and which no delay can improve. A short-time stage operates above
   about 2 × In, and that is the range in which a deliberate hold is both
   available and meaningful.

   Including the knee made every board on the project report that no standard
   delay could grade it, because the child appeared to present a second when it
   was really presenting the transition between two characteristics. */
var SHORT_TIME_FROM = 2;

function selectivityPlan(p) {
  var plan = [];
  var byItem = {};

  /* What a device presents across the range a delay could act in. For a device
     that will hold it is the delay; for one that will not it is the slowest its
     curve gives in that range, which is the number the parent has to beat. */
  function presentedTime(item, kind, delay) {
    if (delay !== null && delay !== undefined) return delay;
    /* No device means nothing to grade against, and reaching into a missing
       prot for its rating is how the audit came to depend on every circuit
       having one. */
    if (!item || !item.prot) return null;
    var fKA = faultAt(p, item, kind);
    var amps = fKA ? fKA * 1000 : null;
    var ladder = amps ? selectivityLadder(item.prot, item.prot, amps) : null;
    if (!ladder) return null;
    var ir = num(item.prot.ir, 0);
    if (!(ir > 0)) return null;
    var stg = D.tripStages(item.prot.trip);
    /* Only the range where a delay on the parent could have acted: above the
       long-time band, and below the parent's own instantaneous pickup. Below
       that range an overlap is an overload overlap and a delay changes nothing. */
    var ceiling = stg.instantaneous === null ? Infinity : stg.instantaneous * ir;
    var worst = 0;
    for (var i = 0; i < ladder.length; i++) {
      var m = ladder[i] / ir;
      if (m <= SHORT_TIME_FROM) continue;
      if (ladder[i] > ceiling) break;
      var t = clearingTimeAt(item.prot, m);
      if (t === null) continue;
      if (t > worst) worst = t;
    }
    return worst > 0 ? worst : null;
  }

  /* Deepest boards first, so a board has already been told what everything
     below it presents before its own delay is chosen. */
  var seq = [];
  /* Every device this pass touches, snapshotted, and put back at the end.

     The search has to apply a candidate to score it, and the board above has to
     see the winner while the board below is still being worked out — that cascade
     is the whole reason the plan exists. But it is a PLAN, and a plan that quietly
     leaves the design changed is a trap: it ran once here, found a candidate for
     one board, wrote it onto the project, and the next load came up with a long-time
     pickup the user had never chosen and could not see. One board's pickup drifted
     from 1,250 A to 1,188 A and nothing on the screen said so.

     So the candidates are applied and withdrawn, and the chosen settings are
     returned for whoever asked to grade. Nothing survives this function unless the
     caller applies it. */
  var snapshot = [];
  var remember = function (it) {
    if (!snapshot.some(function (r) { return r.item === it; })) {
      snapshot.push({ item: it, prot: it.prot ? Object.assign({}, it.prot) : null });
    }
  };
  var restoreAll = function () {
    snapshot.forEach(function (r) { r.item.prot = r.prot; });
    snapshot.length = 0;
  };

  p.dbs.forEach(function (b) { seq.push({ item: b, kind: 'db' }); });
  p.pdps.forEach(function (d) { seq.push({ item: d, kind: 'pdp' }); });
  p.pdbs.forEach(function (b) { seq.push({ item: b, kind: 'pdb' }); });

  seq.forEach(function (node) {
    var it = node.item;
    if (!it.prot || it.prot.kind !== 'mccb') return;
    remember(it);
    var parent = node.kind === 'db' ? get(p, 'pdp', it.pdpId)
             : node.kind === 'pdp' ? get(p, 'pdb', it.pdbId)
             : null;
    /* Everything directly below, and the slowest time any of them presents. */
    var kids = [];
    if (node.kind === 'pdb') {
      p.pdps.forEach(function (d) { if (d.pdbId === it.id) kids.push({ item: d, kind: 'pdp' }); });
    } else if (node.kind === 'pdp') {
      p.dbs.forEach(function (b) { if (b.pdpId === it.id) kids.push({ item: b, kind: 'db' }); });
      p.panels.forEach(function (pn) { if (pn.pdpId === it.id && !pn.dbId) kids.push({ item: pn, kind: 'panel' }); });
    } else {
      p.panels.forEach(function (pn) { if (pn.dbId === it.id) kids.push({ item: pn, kind: 'panel' }); });
    }
    var slowest = 0, hasChild = false;
    kids.forEach(function (k) {
      var t = presentedTime(k.item, k.kind, byItem[k.item.id] ? byItem[k.item.id].delay : null);
      if (t !== null && t > slowest) { slowest = t; hasChild = true; }
    });

    var stg = D.tripStages(it.prot.trip);
    var rec = { item: it, kind: node.kind, delay: null, kids: kids.length,
                up: parent, reason: null, beat: slowest };
    if (!hasChild) {
      rec.reason = 'nothing-below';
    } else if (!stg.shortTime) {
      rec.reason = 'no-short-time';
      rec.detail = it.tag + ' has a ' + stg.name + ' unit, which has no ' +
        'short-time stage, so there is nothing to delay it with. Selective ' +
        'grading against what is below it needs an LS or LSI trip unit: an LI is ' +
        'instantaneous at every fault current above ' + stg.instantaneous +
        ' × its own setting and cannot be made to hold at all.';
    } else {
      /* Search the settings this unit can actually be given, and check every
         candidate with the same calculation the audit uses — not a rule of thumb
         about what ought to separate. Two settings are in play, not one, and
         they do different jobs: the PICKUP is where the deliberate hold begins
         and the DELAY is how long it lasts. Only the second was ever searched,
         which is why thirteen pairs came back saying they could not be graded
         when on this project a setting change separates them.

         The hold band has to start above the load the board really carries. Set
         it below and the board trips on its own sustained overload inside the
         short-time delay, which is a fault-protection device doing a load's job
         — so that is a hard constraint and not a preference, and it is the reason
         the pickup cannot simply be wound down to its lowest step.

         Lowest pickup first, then lowest delay: the least intrusion into the
         board's own behaviour that still works. Applying the winner as it goes,
         because a board is graded against what is below it and the board below
         has to be holding its chosen value while this one searches. */
      var loadA = boardStats(p, it, node.kind).amp;

      /* Everything below this board, and not only the boards.

         A first attempt at this searched for the shortest delay that separates a
         board from the board under it, and that is the wrong objective. On this
         project it solved all three board pairs and turned ten circuit pairs into
         fourteen: the boards were given 250 and 400 ms where they had held 800,
         every board pair passed, and ten circuits underneath lost the margin they
         had been getting from a longer hold. Thirteen pairs became fourteen. The
         search was answering a question nobody had asked.

         So the objective is what the settings actually achieve for everything
         below, final circuits included — the largest number of things that clear
         before this board does — and if no combination beats leaving the device
         alone, it is left alone. A shorter delay that helps three boards and
         hurts ten circuits is not a shorter delay, it is a worse board. */
      var belowAll = kids.slice();
      kids.forEach(function (k) {
        if (k.kind === 'pdp') {
          p.dbs.forEach(function (b3) { if (b3.pdpId === k.item.id) belowAll.push({ item: b3, kind: 'db' }); });
          p.panels.forEach(function (pn) { if (pn.pdpId === k.item.id && !pn.dbId) belowAll.push({ item: pn, kind: 'panel' }); });
        } else if (k.kind === 'db') {
          p.panels.forEach(function (pn) { if (pn.dbId === k.item.id) belowAll.push({ item: pn, kind: 'panel' }); });
        }
      });
      /* Two kinds of thing below a board, and they do not count the same.

         Discrimination between a MAIN incomer and the board under it is a
         requirement: a fault on one sub-board must not open the incomer feeding
         the others. Discrimination between a board and its final circuits is
         not required to be complete — BS 7671 and IEC 60364 ask for disconnection
         within a stated time, and every installation on earth has partial
         discrimination somewhere. Treating them as the same objective is what
         made the search refuse to grade the main incomers: on this project doing
         so costs about ten final circuits, and a flat count called that a loss.

         So the score is weighted to put board separation first and circuits
         second. The 1000 is only there to say "never in exchange", and there are
         never a thousand sub-boards. */
      /* Each child's own fault current does not depend on this board's settings,
         so it is worked out once instead of on every candidate. Recomputing it
         inside the search made a sweep of a couple of thousand combinations take
         long enough to look like a hang. */
      var ampsFor = belowAll.map(function (k) {
        if (!k.item.prot) return null;
        var fk = deviceFaultKA(p, k.item, k.kind);
        return fk ? fk * 1000 : null;
      });
      function scoreWith(cand) {
        var was = it.prot;
        it.prot = cand;
        var boardsOk = 0, circuitsOk = 0;
        belowAll.forEach(function (k, ci2) {
          if (!k.item.prot) return;
          /* The same call the audit makes, with the same fault current, so a
             candidate that scores here scores there by construction. */
          var res = selectivity(k.item, k.kind, it, node.kind, ampsFor[ci2]);
          if (res === null || res.pass) {
            if (k.kind === 'panel') circuitsOk++; else boardsOk++;
          }
        });
        it.prot = was;
        return { score: boardsOk * 1000 + circuitsOk, boardsOk: boardsOk, circuitsOk: circuitsOk };
      }
      var base = scoreWith(it.prot);
      var chosen = null, best = base, tried = 0;
      /* The long-time pickup is adjustable on every unit of this kind, and it is
         the setting the overlap actually turns on.

         Every device on this project was proposed with the pickup at its frame
         rating, which is the least selective setting there is: the higher the
         pickup, the further out along the long-time band the board is when a
         fault arrives, and the faster it is — and a board that is faster than
         what it protects is the whole failure. The overlap on PDB8 sits at 7.8 kA,
         which is 1.95 × its own pickup; set the pickup to 3,000 A instead, still
         comfortably above the 2,788 A the board carries, and the same current is
         2.6 × — above where the short-time stage starts, so the board is holding
         its deliberate delay when the sub-board is not.

         So the search runs over the pickup as well, within the only limits that
         are not negotiable: it may not go below the load the board carries, or
         the board trips on its own running current, and it may not go above the
         frame, because that is the device. Both bounds are the manufacturer's.
         Everything between them is a dial the engineer turns, and on this project
         turning it is what grades the installation. */
      var wantAll = base.boardsOk + belowAll.filter(function (k) { return k.kind !== 'panel'; }).length;
      var stop = false;
      var irSteps = [];
      var frameA = num(it.prot.frame, 0) || num(it.prot.ir, 0);
      if (frameA > 0) {
        [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.5, 0.4].forEach(function (f) {
          var v = Math.round(frameA * f);
          if (v >= loadA && v <= frameA && irSteps.indexOf(v) < 0) irSteps.push(v);
        });
      }
      if (!irSteps.length) irSteps = [num(it.prot.ir, 0)];
      /* Three settings decide whether a pair separates: the long-time pickup,
         where the hold begins, and how long it lasts. Every combination of those
         is searched, but the pickup is swept coarsely — it changes the multiple
         by a factor, and a quarter-turn of a dial is a different answer from a
         whole one — and the search stops at the first that solves it, running
         from the highest long-time pickup downwards so the answer is the least
         change that works. */
      for (var ir2 = 0; ir2 < irSteps.length && !stop; ir2++) {
      for (var a = 0; a < D.SHORT_TIME_PICKUPS.length && !stop; a++) {
        var ssA = D.SHORT_TIME_PICKUPS[a];
        if (a > 0 && D.SHORT_TIME_PICKUPS[a] > 3) break;
        if (!(ssA * irSteps[ir2] > loadA)) continue;
        for (var b = 0; b < D.SHORT_TIME_DELAYS.length; b++) {
          var sdA = D.SHORT_TIME_DELAYS[b];
          tried++;
          var cand = Object.assign({}, it.prot, { ss: ssA, sd: sdA, ir: irSteps[ir2] });
          /* Strictly better, so ties keep the earlier candidate and the search
             ends on the least intrusive setting that works. */
          var got = scoreWith(cand);
          if (got.score > best.score) {
            best = got;
            chosen = { ss: ssA, sd: sdA, ir: irSteps[ir2] };
            /* Stop on the first pickup that solves it: the search runs from the
               frame downwards, so the first one to work is the highest pickup
               that works — the least change to the device's behaviour, and the
               one that keeps the board protecting its own load with most margin. */
            if (got.boardsOk === wantAll) { stop = true; break; }
          }
        }
      }
      }
      if (!chosen) {
        rec.reason = 'insufficient-delay';
        rec.detail = it.tag + ' holds nothing, and no combination of short-time ' +
          'pickup and delay improves on that. Everything below it that cannot be ' +
          'graded needs something other than a longer hold above — see the ' +
          'selectivity findings, which say which device is wanted. The delay and ' +
          'the pickup are both left as they are rather than changed for its own sake.';
      }
      if (chosen) {
        rec.pickup = chosen.ss;
        rec.delay = chosen.sd;
        rec.ir = chosen.ir;
        remember(it);
        if (chosen.ir && chosen.ir !== num(it.prot.ir, 0)) it.prot.ir = chosen.ir;
        /* Applied here rather than left for the caller, so the board above this
           one searches against the value this board is actually holding. */
        it.prot.ss = chosen.ss;
        it.prot.sd = chosen.sd;
        rec.reason = 'graded';
        rec.detail = it.tag + ' set to ' + chosen.ir + ' A — above the ' +
          loadA.toFixed(0) + ' A it carries — holding from ' + chosen.ss.toFixed(1) +
          ' × that (' + Math.round(chosen.ss * chosen.ir) +
          ' A, against ' + loadA.toFixed(0) + ' A of load) for ' +
          msOrS(chosen.sd) + '. The hold band starts above the load so the board ' +
          'does not trip on its own overload, and the delay is the shortest that ' +
          'clears the sub-boards below it first, which is the pair that has to be ' +
          'separated. ' + tried + ' setting combinations tried.' +
          (best.boardsOk >= base.boardsOk && best.circuitsOk < base.circuitsOk
            ? ' The trade is stated because it is real: this leaves ' +
              (base.circuitsOk - best.circuitsOk) + ' final circuit(s) below this ' +
              'board less discriminated than they would otherwise be. Complete ' +
              'discrimination to a final circuit is not a requirement — the ' +
              'disconnection time is, and it is checked separately — so the main ' +
              'incomer is separated in exchange and the circuits are recorded as ' +
              'partial. Say so if that is not what was wanted.'
            : '');
      }
    }
    byItem[it.id] = rec;
    plan.push(rec);
  });

  restoreAll();

  /* The final circuits, listed so the plan accounts for the whole installation.
     They are never given a delay: a device out at the end of a feeder is what it
     is, and holding it back would defeat the point of having one. */
  p.panels.forEach(function (pn) {
    if (!pn.prot || pn.prot.kind !== 'mccb') return;
    var up = pn.dbId ? get(p, 'db', pn.dbId) : (get(p, 'pdp', pn.pdpId) || get(p, 'pdb', pn.pdbId));
    if (!up) return;
    plan.push({ item: pn, kind: 'panel', delay: null, up: up,
                reason: 'final-circuit', beat: presentedTime(pn, 'panel', null) });
  });

  /* Outer boards first, so the plan reads the way the installation does. */
  plan.sort(function (a, b) {
    var depth = { pdb: 0, pdp: 1, db: 2, panel: 3 };
    return depth[a.kind] - depth[b.kind];
  });
  return plan;
}

/* What the plan says about the device above a given pair, for the finding. */
function delayFor(p, down, downKind, up, upKind) {
  if (!up || !up.prot) return null;
  var plan = selectivityPlan(p);
  for (var i = 0; i < plan.length; i++) {
    if (plan[i].item.id === up.id) return plan[i];
  }
  return null;
}


/* Selective up to `fromKA`, and the useful number to quote. */
function selectivityBand(s) {
  return s.pass ? null : s.fromKA;
}


  /* ------------------------------------------------------- grouped findings
     The audit reports what it finds, item by item, because that is the truth
     about the checks. But a check that fires on every large motor, or on every
     circuit whose device is too slow, produces one finding per item and the
     list stops being readable — on the real project 56 of 97 circuits failed the
     new withstand check, all for the same reason, and the ones that genuinely
     differed from their neighbours were the four lost in the middle.

     So the list is grouped on the way out. Findings that share a group key are
     the same finding about different equipment, and collapse into one row
     that carries the count and the total load. The row lists the items so
     nothing is hidden, and it can be expanded back to the individual findings
     for the ones that differ.

     Two thresholds matter. Below MIN_GROUP the items are shown in full, because
     two of something is usually two separate problems and grouping them
     hides that. Above MAX_LIST the row is left collapsed by default, because
     a list of ninety tags is not information anyone reads. */
  var MIN_GROUP = 3, MAX_LIST = 8;

  /* How a group's severity is read: the worst member decides the row, so a
     group of notes containing one error is still an error. */
  var LEVEL_RANK = { bad: 0, warn: 1, info: 2 };
  function worstLevel(list) {
    return list.map(function (f) { return f.level; })
      .sort(function (a, b) { return LEVEL_RANK[a] - LEVEL_RANK[b]; })[0];
  }

  /* The row's title and detail, per group. A group with one member keeps its
     own wording — there is nothing to summarise. */
  function groupWord(findings) {
    var tags = findings.map(function (f) {
      var o = f.item || null;
      return o && (o.tag || o.name) ? (o.tag || o.name) : 'item';
    });
    var kw = findings.reduce(function (a, f) { return a + (f.groupKw || 0); }, 0);
    var board = findings.map(function (f) { return f.boardTag; })
      .filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });
    return {
      tags: tags,
      kw: kw,
      where: board,
      /* The unit travels with the group. The starting findings sum amps, and
         labelling that "kW" would print 19965 kW on a project with 9525 kW of
         load on it — a number larger than the site. */
      load: kw > 0 ? kw.toFixed(0) + ' ' + (findings[0].groupUnit || 'kW') +
        (findings[0].groupUnit && findings[0].groupUnit.indexOf('full load') >= 0 ? ' of full load current in total' : ' between them') : ''
    };
  }

  /* Fold a list of findings into grouped rows. Anything without a group key
     passes through untouched, so a one-off finding is never summarised. */
  function groupFindings(findings) {
    var order = { bad: 0, warn: 1, info: 2 };
    var out = [], byKey = {}, idx = {};
    findings.forEach(function (f) {
      if (!f.groupKey) { out.push(f); return; }
      /* the key is scoped by level, because a warn and a bad with the same key
         are different problems and must not be merged into one row */
      var k = f.groupKey + ' ' + f.level;
      if (!byKey[k]) {
        idx[k] = { level: f.level, groupKey: f.groupKey, members: [], sample: f };
        byKey[k] = idx[k];
      }
      idx[k].members.push(f);
    });
    Object.keys(idx).forEach(function (k) {
      var g = idx[k];
      if (g.members.length < MIN_GROUP) { g.members.forEach(function (m) { out.push(m); }); return; }
      var w = groupWord(g.members);
      out.push({
        level: g.level, scope: g.sample.scope, id: g.sample.id,
        title: g.members.length + ' × ' + groupTitle(g.groupKey, w),
        detail: w.where.length
          ? 'On ' + w.where.join(', ') + '.' + (w.load ? ' ' + w.load + '.' : '')
          : (w.load ? w.load + '.' : 'Expand the row for the individual items.'),
        groupKey: g.groupKey, grouped: true, members: g.members,
        tags: w.tags, kw: w.kw, groupUnit: g.sample.groupUnit
      });
    });
    out.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return out;
  }

  /* Which board an item hangs off, for a grouped row to say where the problem
     is. Deliberately the immediate parent only: a group spread across four
     main boards is four problems, and naming the parent is what tells them
     apart. */
  function boardTagOf(p, scope, o) {
    if (scope === 'panel') {
      if (o.dbId) return (get(p, 'db', o.dbId) || {}).tag;
      if (o.pdpId) return (get(p, 'pdp', o.pdpId) || {}).tag;
      if (o.pdbId) return (get(p, 'pdb', o.pdbId) || {}).tag;
      return null;
    }
    if (scope === 'db') return (get(p, 'pdp', o.pdpId) || {}).tag;
    if (scope === 'pdp') return (get(p, 'pdb', o.pdbId) || {}).tag;
    if (scope === 'pdb') return (get(p, 'tx', o.txId) || {}).tag;
    return null;
  }

  function groupTitle(key, w) {
    if (key === 'motor-type') return 'panel whose load type does not say whether it starts a motor';
    if (key === 'start-upstream') return 'motor whose starting current trips the board above';
    if (key === 'start-own') return 'motor whose starting current exceeds its own device';
    if (key === 'start-torque') return 'motor that will not accelerate through the dip';
    if (key === 'start-dip') return 'motor starting that dips its board';
    if (key === 'start-unstated') return 'motor with no starting method stated';
    if (key === 'start-inferred') return 'starting method taken from the machine name';
    if (key === 'pe-method') return 'three-phase feeder whose protective conductor method is not stated';
    if (key === 'pf-available') return 'supply below the power factor penalty limit';
    if (key === 'motor-class') return 'machine whose overload relay class its device cannot meet';
    if (key === 'let-through') return 'feeder conductor that cannot survive the fault';
    if (key === 'selectivity-circuit') return 'circuit not selectively graded against the board it sits on';
    if (key === 'selectivity-board') return 'board not selectively graded against the board above it';
    if (key === 'board-empty') return 'board on the schedule with nothing fed from it';
    if (key === 'just-matched') return 'device matched to its cable with under 5% headroom';
    if (key === 'pdp-cap') return 'distribution board above the incomer limit';
    if (key === 'vdrop-path') return 'circuit whose total volt drop from the transformer exceeds the limit';
    if (key === 'vdrop-incomplete') return 'circuits whose voltage drop profile cannot be completed';
    if (key === 'tap-setting') return 'transformer whose far end finishes outside the limit end to end';
    if (key === 'impz-assumed') return 'transformers whose impedance is assumed rather than stated';
    if (key === 'impz-stated') return 'transformer fault levels';
    if (key === 'spare-way') return 'unterminated spare ways';
    if (key === 'demand-ratio') return 'boards running at a small fraction of their connected load';
    if (key === 'demand-band') return 'boards using a coincidence factor with no band declared';
    if (key === 'vector-group') return 'transformer whose vector group is not stated';
    if (key === 'withstand') return 'cable that cannot survive the fault';
  if (key === 'power-factor') return 'board below the power factor limit';
  if (key === 'harmonics') return 'circuit carrying harmonic content';
  if (key === 'bad-kva') return 'circuit entered with less kVA than kW';
  if (key === 'loop-margin') return 'earth fault loop with little margin';
    return key;
  }

  /* ------------------------------------------------- thermal withstand -----
     How long a cable survives a short circuit, and therefore whether the device
     is fast enough to clear the fault before the conductor melts. Nothing else
     in the app looks at this: the ampacity checks ask whether a cable can carry
     its load all day, and this asks whether it can carry sixty times its load
     for the fraction of a second the protection takes to react.

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
  

  /* Let-through: what the device lets past before it opens.

     Cable thermal withstand is asked "can this conductor survive the fault, given
     the device clears in t?" — which assumes the fault current flows until the
     device operates and then stops dead. It does not: a breaker interrupts at a
     finite current, and the part of the arc before that is what the conductor
     actually has to survive.

     Two numbers decide it, and neither can be read off a time-current curve:

     - **I²t let-through**, the energy the device passes. Modern devices publish
       it and it is small enough to be the dominant term on a high-resistance
       cable.
     - **Ip let-through**, the peak the device permits. It governs the mechanical
       force on the conductor and the magnetic force in the arc chute, and it is
       not an energy at all.

     A published device figure is taken as given, because it comes from the
     manufacturer's own test data and there is nothing to derive. Where none is
     published the check says so: the time-current curve bounds the clearing
     TIME but says nothing about the let-through, so quoting it as though it did
     would be a made-up number in a calculation about whether a cable survives.

     What can be bounded without a datasheet is the ideal case — zero let-through,
     i.e. an instantaneous ideal switch — which gives the best case the cable can
     hope for. A cable that fails even that is a definite failure; a cable that
     passes may or may not, and the difference is the device's published data. */
  function letThrough(prot, faultKA, opts) {
    var iKA = num(faultKA, 0);
    if (!(iKA > 0) || !prot) return null;
    opts = opts || {};
    /* Published figures, when the project carries them. */
    var itL = num(prot.letIt, 0);          // A²s
    var ipL = num(prot.letIp, 0);          // kA peak
    /* The ideal: the device opens with no delay and no arc energy. Everything
       here is in A²s, so the fault current must be in amps — faultKA is in kA and
       squaring it made every figure wrong by a factor of a million. */
    var iA = iKA * 1000;
    var ideal = iA * iA;
    /* The published figure is quoted in kA²s — thousands of A²s — which is how
       manufacturers print it, so it is converted once here rather than at every
       comparison. */
    var itA2s = itL * 1000;
    var out = {
      faultKA: iKA,
      /* The whole fault energy, for reference. Comparing a conductor against this
         is comparing it against a fault that never runs to completion — the
         device opens, and the question is what it let past before it did. */
      idealA2s: ideal,
      published: itL > 0,
      letIt: itL || null,
      letItA2s: itL > 0 ? itA2s : null,
      letIp: ipL || null
    };
    /* The energy the conductor sees, and what it can stand. */
    var csa = num(opts.csa, 0);
    var km = num(opts.len, 0) / 1000;
    var insul = opts.insul || 'XLPE';
    var conductor = opts.conductor || 'Cu';
    if (csa > 0 && km > 0) {
      /* I²t of the cable is k²S²·1000 for km, in the same A²s units. */
      var k = WITHSTAND_K[insul];
      if (k && (conductor === 'Cu' || conductor === 'copper')) {
        /* The conductor's I²t capacity, from k²S². That is a property of the
           conductor alone and does not vary with length — a 10 m run and an
           800 m run of the same cable withstand the same energy, and what differs
           is how long they take to reach it. `km` is not in this expression
           because it is not in the formula. */
        out.cableIt = k * k * csa * csa;
        /* Seconds the cable would survive at this fault current. */
        out.cableSeconds = out.cableIt / ideal;
        /* Where the length does enter: the time to reach the temperature limit
           under a sustained fault, which is the adiabatic time and is a different
           question from the I²t one. */
        out.adiabaticSeconds = out.cableIt / ideal;
      }
      /* With published let-through, the conductor sees the lesser of the two. */
      /* The decisive comparison is against the device's actual clearing time, not
         against the whole fault. A 250 A MCCB clears 60 kA in about 20 ms, and a
         240 mm² conductor survives that comfortably — comparing against the full
         energy as though the fault persisted reported almost every feeder as a
         failure, which is what a first pass did here.

         With a published I²t let-through, that figure already accounts for both
         the time and the arc energy, and it is the right thing to compare.
         Without one, the clearing time from the curve is the best available
         bound — and it is a bound, not a measurement, so the verdict says so. */
      if (opts.clearSeconds !== undefined && opts.clearSeconds !== null) {
        var t = num(opts.clearSeconds, 0);
        if (t > 0) {
          out.clearSeconds = t;
          /* The whole I²t for the full clearing time, not the triangle under it.
             The current does not fall away linearly — the device opens part way
             through — so the triangle is the true figure and this is its upper
             bound. A check whose job is to catch the case where the conductor does
             not survive takes the bound, and says which bound it took. */
          out.energyToClear = ideal * t;
          out.survivesClearingTime = out.cableIt > out.energyToClear;
          out.clearMargin = out.cableIt / out.energyToClear;
        }
      }
      if (itA2s > 0) {
        out.survivesLetThrough = out.cableIt > itA2s;
        /* The margin against the published let-through, kept separate from the
           clearing-time one. They answer different questions — one is what the
           manufacturer published, the other is what the curve implies — and
           overwriting one with the other reported a margin sixteen times better
           than the figure it was computed from. */
        out.letMargin = out.cableIt / itA2s;
        out.margin = out.letMargin;
      }
    }
    /* What the check should conclude. */
    /* The verdict is only ever 'fails' on evidence. Without a published let-through
       the worst case is assumed, and a conductor that survives that has simply
       not been shown to fail — which is a different statement and is what the
       findings have to say. */
    if (out.published && out.survivesLetThrough === false) {
      out.verdict = 'fails';
    } else if (out.survivesClearingTime === false) {
      out.verdict = 'fails';
    } else if (out.published) {
      out.verdict = 'passes';
    } else {
      out.verdict = 'unproven';
    }
    return out;
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
  /* How long the device takes to clear a SHORT CIRCUIT — not an overload.

     These are band-wide figures, not manufacturer curves, and the distinction
     matters more than it looks. Every device here has an instantaneous element:
     TM picks up at 5–10 × In, LI/LS/LSI at 10 × In. A short circuit on a
     distribution board is several hundred times In, so every one of them is deep
     on its magnetic trip and clears in tens of milliseconds. The long-time
     element is never involved.

     An LI used to report 5 seconds here, on the reasoning that it has no
     short-time stage. That is true of its SHORT-TIME element and irrelevant to
     an instantaneous one: the LI has no S-stage precisely so that the I-element
     can clear the short circuit. It reported a 250 A LI as taking 5 s to clear a
     75 kA fault, and every cable behind it as failing thermal withstand by a
     factor of 485. The cables were fine. The band was wrong.

     IEC 60947-2 gives 10–50 ms for the magnetic operation; the slow end is used
     throughout, because the slow end is the one that has to survive. */
  function clearingTimeS(prot, isFuse) {
    if (isFuse) return { t: 5, band: 'inverse-time', why: 'a fuse is inverse-time by design' };
    if (!prot) return null;
    if (prot.kind === 'mcb') {
      return { t: 0.01, band: 'magnetic', why: 'magnetic trip, typically 2.5–10 ms' };
    }
    switch (prot.trip) {
      /* TM at 5–10 × In. */
      case 'TM':    return { t: 0.05, band: 'magnetic',  why: 'magnetic trip, typically 20–50 ms with the arc' };
      /* LI at 10 × In. The absence of a short-time stage makes no difference to
         a fault at several hundred × In — it is all instantaneous. */
      case 'LI':    return { t: 0.04, band: 'magnetic',  why: 'instantaneous element, typically 20–40 ms with the arc' };
      /* LS and LSI have a short-time stage that deliberately holds the device
         back — but only up to the instantaneous pickup at 10 × In, which a
         distribution short circuit is far beyond. The short-time band belongs
         to selectivity, not to the withstand case. */
      case 'LS':    return { t: 0.04, band: 'magnetic',  why: 'instantaneous element, typically 20–40 ms with the arc' };
      case 'LSI':   return { t: 0.04, band: 'magnetic',  why: 'instantaneous element, typically 20–40 ms with the arc' };
      case 'eLSI':  return { t: 0.03, band: 'magnetic',  why: 'instantaneous element, typically 15–30 ms with the arc' };
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
      /* Measured against the capacity the board may actually use, not its label.
         A 4,000 A board is 1,600 A of board as far as adding circuits to it is
         concerned, so a circuit that would take the useful load past 1,600 A has
         to go somewhere else — which is how an extra board gets created off the
         same main board instead of the existing one being quietly overloaded. */
      var usable = usableA(p, d, 'pdp');
      var utilAfter = usable ? ((st.amp + add) / usable) * 100 : 0;
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
    /* Clamped to the cap, and then to a real size again — a board created by the
       app must not come out above the limit the app enforces, and a clamped
       figure is not a catalogue rating either. */
    var want = Math.max(160, suggestIncomer(carry, D.num(p.design.spreadMargin, 1.25)));
    var cap = pdpMaxA(p);
    var need = want > cap ? Math.min(cap, suggestIncomer(carry, 1)) : want;
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
    /* A circuit sits on a sub-board, a distribution board or a main board, and
       the main board case was missing. A panel fed straight off a main board
       carries pdbId and no pdpId, so both of the original lookups returned
       nothing, the parent stayed null and the length came back zero — with no
       error, because a zero length is a valid answer to the question asked.

       Eight circuits fed off the main boards got it, and a voltage drop profile
       that cannot be completed because one hop's length is unknown is
       optimistic by an unknown amount. The engineering answer on a panel is to
       measure it; the app's job is to ask, and to offer the drawn distance as
       the starting point rather than leave a blank that reads as zero. */
    if (kind === 'panel') {
      parent = (item.dbId && get(p, 'db', item.dbId)) || get(p, 'pdp', item.pdpId) || get(p, 'pdb', item.pdbId);
    }
    else if (kind === 'db') parent = get(p, 'pdp', item.pdpId);
    else if (kind === 'pdp') parent = get(p, 'pdb', item.pdbId);
    else if (kind === 'pdb') parent = get(p, 'tx', item.txId);
    if (!parent || !parent.pos) return 0;
    return D.r1(Math.hypot(parent.pos.x - item.pos.x, parent.pos.y - item.pos.y) * 1.2 + 1);
  }
  /* Keep a feeder length in step with the drawn position — but ONLY where the
     length is not already known.

     This ran on every panel at load, overwriting a stated route length with the
     distance between two points on a schematic plan. That is not the same thing:
     a layout drawing positions equipment for legibility, so the straight-line
     distance between a board and a machine is close to meaningless as a route.
     On a real project it quietly rewrote measured lengths and inflated the
     bill of materials — 2,039 m of cable became 2,072 m, with no change to the
     design and nothing to indicate where the extra metres came from.

     So a length that has been stated wins. The drawn distance is a starting
     point for a circuit nobody has measured yet, which is all it is good for,
     and saying so is better than presenting it as a route. */
  function syncLen(p, item) {
    if (!item || !item.cable) return false;
    if (num(item.cable.len, 0) > 0) return false;
    var L = feederLen(p, item);
    if (!(L > 0)) return false;
    item.cable.len = L;
    /* Recorded as inferred rather than measured, so anything that reports route
       lengths can tell the two apart. */
    item.cable.lenSource = 'drawn';
    return true;
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
    /* Split anything still over capacity, and keep going until nothing is.

       A sub-board and the circuits on it move as one unit, so the heaviest
       single circuit is only a candidate when it sits directly on the board
       being relieved.

       One move per board was enough when "over capacity" meant the board was
       over its own rating, because a single circuit was usually most of the
       overload. It is not enough against the incomer limit: a board rated
       4,000 A and loaded to 4,862 A needs three circuits moved before it is
       legal, and one press of Balance leaving the board over capacity looks
       like the button does not work. So the split runs until every board is
       inside what it may take, with a guard against a pair of circuits that
       cannot help each other. */
    var guardSplit = 0;
    var relieved;
    do {
      relieved = false;
      guardSplit++;
      p.pdps.slice().forEach(function (d) {
        var st = boardStats(p, d, 'pdp');
        if (st.amp <= usableA(p, d, 'pdp')) return;
        var was = st.amp;
        var loose = st.panels.filter(function (pn) { return !pn.dbId; });
        var worst = loose.slice().sort(function (a, b) { return panelDemand(p, b).amp - panelDemand(p, a).amp; })[0];
        if (worst) {
          var log = assignPanel(p, worst, opts);
          /* Relief, not board creation, is what the loop is waiting for.
             Counting only a new board meant that once there were two boards the
             second circuit moved onto the existing one, nothing was recorded, and
             the loop decided it was finished with the board still overloaded —
             one press of Balance left it 3,646 A on a 1,600 A board. */
          var now = boardStats(p, d, 'pdp').amp;
          if (now < was - 0.5) {
            moves.push({ panel: worst.tag, from: d.tag,
                         to: (log.to ? (get(p, 'pdp', log.to) || {}).tag : ''),
                         created: log.created ? log.created.tag : null,
                         kva: panelDemand(p, worst).kva });
            relieved = true;
          }
          return;
        }
        /* everything here hangs off a sub-board: move the heaviest sub-board */
        var subs = dbOfPdp(p, d.id).filter(function (b) { return boardStats(p, b, 'db').amp > 0; });
        subs.sort(function (x, y) { return boardStats(p, y, 'db').amp - boardStats(p, x, 'db').amp; });
        if (subs.length) {
          var mv = subBoardMove(p, subs[0], opts);
          if (mv && boardStats(p, d, 'pdp').amp < was - 0.5) { moves.push(mv); relieved = true; }
        }
      });
    } while (relieved && guardSplit < 40 && p.pdps.length < 200);
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
      ids.forEach(function (id) {
        var b = get(p, 'pdp', id), st = boardStats(p, b, 'pdp');
        var u = usableA(p, b, 'pdp');
        util[id] = u ? (st.amp / u) * 100 : 0;
      });
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
            /* Both sides measured on usable capacity, so a move cannot push the
               destination past the cap while its own label says there is room. */
            var uSrc = usableA(p, src, 'pdp') || stSrc.rating;
            var uDst = usableA(p, dst, 'pdp') || boardStats(p, dst, 'pdp').rating;
            var uA = util[src.id] - (da.amp / uSrc) * 100;
            var uB = util[dst.id] + (da.amp / uDst) * 100;
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

/* ============================================== sizing cables to the protection ==
     The single most common fault on a schedule built from a vendor's switchgear
     sheet: the device rating and the cable size come from different columns and
     are not consistent with each other.

     A vendor's schedule states, per circuit, the device rating (400 A) AND the
     machine's actual current (66 A). The cable gets sized for the machine,
     because that is what carries the load. The device keeps its rating,
     because that is what was ordered. Nothing checks the two against each
     other, and nothing should — until now.

     IEC 60364-5-52 requires the protective device's rating not to exceed the
     conductor's current-carrying capacity. A 400 A device on 35 mm² is not a
     marginal case, it is a cable that will be destroyed long before the device
     protects it.

     What is done here is the calculation, not the decision. The minimum size
     this device needs is computed and reported; whether to upsize the cable or
     downrate the device is a commercial and engineering judgement, because a
     400 A device on a 217 kW machine may be deliberate — the machine may be
     capable of more than it currently does, and the breaker sized for what it
     could become.

     That is why this is a tool and not a silent correction. */
  /* What this conductor has to be. Two independent constraints, and the larger
     answer wins.

     AMPACITY — the device rating the conductor exists to protect. Searched
     through the standard sizes rather than by inverting the rating table,
     because the rating is a table lookup with derating applied and inverting it
     by hand is right to within 5% and wrong in exactly the cases that matter.

     SHORT CIRCUIT — k²S² against I²t for the time the device takes to clear. On a
     weak supply this never binds and the ampacity answer stands. On a strong one
     it binds hard and can demand two or three sizes more than the load needs,
     which is invisible on a schedule that only records load current: 95 mm²
     carries 240 A comfortably and cannot survive 76 kA for 40 ms.

     Which of the two drove the answer is returned with it, because "load" and
     "fault" are different conversations and one number for both hides which is
     actually governing. */
  function minimumCsa(p, pn) {
    var prot = pn.prot;
    if (!prot) return null;
    var need = feederAmp(p, pn);
    var c = pn.cable || { cores: 4, method: 'XL-A1', group: 2, ambient: 40, sheathed: true, runs: 1 };
    var byLoad = null;
    if (need > 0) {
      var sizes = D.CSA;
      for (var i = 0; i < sizes.length; i++) {
        var trial = Object.assign({}, c, { csa: sizes[i], runs: 1 });
        var r = cableRating(trial);
        if (r && r.derated >= need) { byLoad = sizes[i]; break; }
      }
    }
    var kind = pn.__kind === 'panel' ? 'panel' : pn.__kind;
    var fl = faultLevel(p, pn, kind);
    var clear = fl ? clearingTimeAt(prot, fl.kA * 1000 / Math.max(1, num(prot.ir, 1))) : null;
    var insul = (D.METHODS[c.method] || D.METHODS['A1']).insul;
    var byFault = (fl && clear) ? csaForFault(fl.kA, clear, insul, pn.conductor) : null;
    /* The fault case is judged against ONE run. Parallel runs share the fault, so
       a single run has to stand on its own — they are not independent paths. */
    var csa, governed;
    if (byFault && (!byLoad || byFault > byLoad)) { csa = byFault; governed = 'fault'; }
    else { csa = byLoad; governed = 'load'; }
    return { csa: csa, byLoad: byLoad, byFault: byFault, governed: governed,
             faultKA: fl ? fl.kA : null, clearSeconds: clear };
  }
  /* The smallest conductor that survives a short circuit of this current for
     this long.

     The adiabatic equation rearranged. A conductor carries I²t to a limit of
     k²S², so the conductor this fault demands is

         S = I·√t / k

     which for 76 kA cleared in 40 ms on XLPE copper is 106 mm² — the next
     standard size up. That is a result worth being able to read straight off
     the schedule, because it is the constraint that decides the size on a strong
     supply: ampacity runs to 240 A through 95 mm², and nothing in the cable
     schedule shows that the same conductor cannot take the fault.

     Returned as an orderable size by searching the standard list rather than by
     reporting 106. Nobody specifies 106 mm², and a number that is not a size is
     a number nobody can act on.

     The time used is the device's own clearing time, so a faster device buys a
     smaller conductor — which is why this belongs beside the device rather than
     in the cable. */
  function csaForFault(iKA, seconds, insul, conductor) {
    var k = WITHSTAND_K[insul];
    if (!k || conductor === 'Al' || conductor === 'Alu') return null;
    if (!(iKA > 0) || !(seconds > 0) || !isFinite(seconds)) return null;
    var need = iKA * 1000 * Math.sqrt(seconds) / k;
    var list = D.CSA;
    for (var i = 0; i < list.length; i++) if (list[i] >= need) return list[i];
    return null;                       // beyond the range — say so, do not guess
  }

  /* Every feeder whose conductor is smaller than minimumCsa() says it may be,
     with the size it needs and which of the two constraints is asking.

     Two different reasons end up here, and they are worth telling apart because
     the remedy is different:

       device over-rates the cable   the breaker is larger than the conductor it
                                     protects. Either the breaker is downrated or
                                     the conductor upsized — a commercial choice,
                                     since a breaker sized for the machine's
                                     possible output rather than its present duty
                                     is deliberate and common on drives.

       cable will not take the fault  the conductor carries the load comfortably
                                     and still fails a short circuit. There is no
                                     choice here: the size has to go up, or the
                                     device has to clear faster, or the fault
                                     level has to come down.

     Sorting on the larger of the two puts the ones that cannot be argued with at
     the top. Returned rather than applied — see the note above the function. */
  function cableShortfalls(p) {
    var out = [];
    p.panels.forEach(function (pn) {
      if (isSpare(pn) || !pn.prot || !pn.cable || !num(pn.cable.csa, 0)) return;
      var m = minimumCsa(p, pn);
      if (!m || !m.csa) return;
      var now = num(pn.cable.csa, 0);
      if (now >= m.csa) return;
      var r = cableRating(pn.cable);
      var ir = num(pn.prot.ir, 0);
      var dm = panelDemand(p, pn);
      out.push({
        pn: pn,
        ir: ir,
        now: now,
        rated: r ? r.derated : null,
        min: m.csa,
        governed: m.governed,
        byLoad: m.byLoad,
        byFault: m.byFault,
        faultKA: m.faultKA,
        loadA: dm.amp,
        /* how far short, in sizes rather than in amps — the useful measure */
        short: m.csa / now,
        /* A breaker many times the machine's own load is sized for starting and
           for what the machine could become, not for present duty. That does not
           excuse the cable, but it changes who should be downrated. */
        deliberate: ir > dm.amp * 4
      });
    });
    /* Faults first: no one can argue with those. */
    out.sort(function (a, b) {
      if (a.governed !== b.governed) return a.governed === 'fault' ? -1 : 1;
      return b.short - a.short;
    });
    return out;
  }

  /* ------------------------------------------------------------- totals    */
  function totals(p) {
    /* Connected kW and diversified kVA are different quantities, and adding them
       to each other produces a power factor above 1 — which is not a power factor
       at all. On the real project, 9,525 kW connected against 4,172 kVA
       diversified reads as pf 2.28, and every kvar figure derived from it is
       nonsense.

       Both are reported, on their own basis, and the power factor is taken from
       the pair that belong together. */
    var kw = 0, kva = 0, amp = 0, panels = 0;
    var kwDiv = 0;
    var phases = { L1: 0, L2: 0, L3: 0 };
    p.panels.forEach(function (pn) {
      /* placed means it is fed from something — a distribution board, a
         sub-board, or a main board directly */
      if (!pn.pdpId && !pn.pdbId) return;
      var d = panelDemand(p, pn);
      kw += d.kw; kva += d.kva; amp += d.amp; panels++;
      /* the same kW on the same diversified basis as the kVA it is compared with */
      kwDiv += d.kw * (d.demand === undefined || d.demand === null ? 1 : d.demand);
      var ph = phaseSplit(pn.phases, phases, d.kva);
      phases.L1 += ph.L1; phases.L2 += ph.L2; phases.L3 += ph.L3;
    });
    /* Where the demand factor is 1 throughout, kwDiv equals kw and the two
       figures agree — which is the sample project's case, and the ordinary one
       on a small installation. */
    var diverse = kwDiv < kw * 0.999;
    var kwForPf = diverse ? kwDiv : kw;
    var pf = kva > 0 ? kwForPf / kva : 1;
    var kvar = Math.sqrt(Math.max(0, kva * kva - kwForPf * kwForPf));
    var txKva = p.txs.reduce(function (a, t) { return a + D.num(t.kva, 0); }, 0);
    return {
      /* connected kW — the number on the nameplate sum */
      kw: kw,
      /* the same kW diversified, for comparison with the kVA below */
      kwDiv: kwDiv,
      /* design kVA — already diversified, and what the transformers are loaded against */
      kva: kva, amp: amp, panels: panels, txKva: txKva,
      /* whether those two kW figures differ, so a reader is never left guessing
         which basis a power factor was taken on */
      diversified: diverse,
      pf: Math.min(1, Math.max(0, pf)),
      kvar: kvar,
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
    withstandI2t, letThrough, clearingTimeS, checkWithstand, msOrS, WITHSTAND_K,
    selectivityPlan, delayFor, selectivityMessage,
    groupFindings, worstLevel, groupTitle, boardTagOf, MIN_GROUP, MAX_LIST,
    clearingTimeAt, selectivity, selectivityBand, selectivityLadder, reactive,
    arcTimeAt, arcDistanceFactor, arcAssessment,
    COINCIDENCE_BANDS, demandMethods, boardDemandKva,
    EQUIPMENT_GROUPS, billOfMaterials, mergeBase, mergeProjects, applyMerge,
    REVISION_FIELDS, snapshotForDiff, diffProjects, stable,
    voltageProfile, voltageProfileWorst, loadBelow, panelsBelow,
    pfCorrection, capResonance, impedanceBase, puImpedance, pathImpedance, faultLevel,
    earthLoop, disconnectionMultipleAt, earthFaultCheck, neutralCurrent, neutralCsaFor,
    hasNeutralConductor, isThreePhaseWithNeutral, supplyArrangement, neutralCheck,
    peNeededCsa,
    startMethod, startingCurrentA, startingCheck, sourceImpedanceAt, curveInstantaneousMultiple, torqueNeeded,
    isMotorLoad, isSpare, minimumCsa, cableShortfalls, csaForFault, pdpMaxA, usableA,
    isBusbar, busbarCheck, impedanceSensitivity, deviceFaultKA,
    tapPositions, tapAt, tapAdvice, nsxSelect, nsxSchedule,
    SELECTIVITY_STEPS,
    choosePdp, assignPanel, createPdpFor, feederLen, syncLen,
    sizeCablesFor, sizeCablesForPdb, sizeCablesForDb, suggestDbFeeder, sizeCableForPanel, sizeAll, feederAmp, needsSizing,
    nextPracticalPos, resolveDrop, autoBalance, totals, boardList, dist, uniqueTag,
    underlayOf, underlayFit, underlayInverse, underlayAutoFit, underlaySiteInGeo,
    PREFIX, computedTag, applyNumbering, numberingIssues
  };
})();
