/* ============================================================================
   data.js — reference data, project model, sample project
   No dependencies. Global namespace: LS
   ==========================================================================*/
'use strict';

var LS = (function () {

  /* ----------------------------------------------------------------------
     1. CABLE / AMPACITY REFERENCE
     Indicative current-carrying capacity (A) for copper conductors, loaded as
     3-phase balanced, 30 °C ambient / 30 °C earth. Based on the IEC 60364-5-52
     / BS 7671 Appendix 4 method tables. ALWAYS verify against the edition of
     the wiring rules you are designing to — these values are for schedule
     building and comparison, not certification.
     ---------------------------------------------------------------------- */
  var CSA = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500];

  var METHODS = {
    'A1'  : { name: 'Free air, on tray / cleats ≥ 1 m clearance (ref A1)', insul: 'PVC',  group: 'air',    amp: [15.5,21,28,36,50,68,89,110,134,171,214,250,290,330,390,450,520,580] },
    'A2'  : { name: 'Free air, ≥ 1 m from other cables (ref A2)',          insul: 'PVC',  group: 'air',    amp: [15,20,27,34,47,62,82,102,125,160,200,235,271,308,364,420,485,540] },
    'B1'  : { name: 'In conduit / trunking in air (ref B1)',               insul: 'PVC',  group: 'air',    amp: [15,19,26,33,44,58,77,96,115,146,182,214,245,278,328,380,440,490] },
    'C'   : { name: 'Clipped direct to wall / structure (ref C)',          insul: 'PVC',  group: 'air',    amp: [16.5,22,30,38,52,70,89,110,133,171,214,250,290,330,390,450,520,580] },
    'E'   : { name: 'Buried in ground / trench, 0.75 m depth (ref E)',      insul: 'PVC',  group: 'earth',  amp: [19,26,34,42,57,76,99,123,151,192,240,281,328,379,445,510,585,650] },
    'F'   : { name: 'Buried, 30 °C earth, low thermal resistivity (ref F)',  insul: 'PVC',  group: 'earth',  amp: [17,23,31,38,49,65,85,105,129,164,205,240,278,321,377,431,494,550] },
    'XL-A1': { name: 'XLPE / SWA, free air on tray (ref A1 equivalent)',   insul: 'XLPE', group: 'air',    amp: [20,28,37,47,64,87,114,141,182,232,289,340,393,455,535,612,700,780] },
    'XL-A2': { name: 'XLPE / SWA, free air, ≥ 1 m clearance (ref A2 equiv.)',insul:'XLPE', group: 'air',    amp: [19,26,34,44,60,81,106,131,168,213,264,310,359,415,487,557,638,710] },
    'XL-B1': { name: 'XLPE / SWA in conduit / trunking in air (ref B1 equiv.)',insul:'XLPE',group: 'air',    amp: [18,25,33,42,57,76,100,124,158,200,248,290,335,386,453,519,593,660] },
    'XL-D2': { name: 'XLPE twin & earth, buried sharing ground (ref D2)',   insul: 'XLPE', group: 'earth',  amp: [22,29,38,49,66,88,115,144,176,224,279,327,381,440,517,591,675,750] },
    'XL-E' : { name: 'XLPE, buried in ground / trench 0.75 m (ref E equiv.)',insul:'XLPE', group: 'earth',  amp: [25,33,44,56,75,100,130,162,198,252,315,369,430,496,583,668,762,850] }
  };

  /* Ambient temperature correction factors (30 °C base) */
  var TEMP_FACTORS = {
    'PVC' : { 10:1.22, 20:1.13, 25:1.04, 30:1.00, 35:0.94, 40:0.87, 45:0.79, 50:0.71, 55:0.61, 60:0.50 },
    'XLPE': { 10:1.15, 20:1.08, 25:1.02, 30:1.00, 35:0.96, 40:0.91, 45:0.86, 50:0.79, 55:0.71, 60:0.63 }
  };

  /* Grouping / bunching derating, by number of similar circuits */
  var GROUP_FACTORS = {
    air:   { 1:1.00, 2:0.80, 3:0.70, 4:0.65, 5:0.60, 6:0.57, 7:0.54, 8:0.52, 9:0.50, 10:0.47, 12:0.45, 16:0.42, 20:0.40 },
    earth: { 1:1.00, 2:0.75, 3:0.65, 4:0.60, 5:0.55, 6:0.50, 7:0.48, 8:0.45, 9:0.42, 10:0.40, 12:0.38, 16:0.35, 20:0.33 }
  };

  /* conductor material / insulation thermal withstand (c factor) for fault checks */
  var WITHSTAND = { 'PVC': 0.115, 'XLPE': 0.057 };

  /* How many identical circuits may be put in parallel. Past this a feeder
     wants a busbar rather than more copper: eight runs of the largest
     cross-section in the table is already about 2.9 MVA of XL-A1, and a main
     board incomer above that is a busbar job. */
  var MAX_CABLE_RUNS = 8;

  /* ----------------------------------------------------------------------
     2. STANDARD SIZES
     ---------------------------------------------------------------------- */
  var SIZES_A    = [16,20,25,32,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000];
  var SIZES_KVA  = [50,100,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150];
  var SIZES_KW   = [1,1.5,2.2,2.5,3,4,5.5,7.5,9,11,15,18.5,22,30,37,45,55,75,90,110,132,160,185,250,315,400];
  var PHASES     = ['3', '1', '2'];          // 3 = balanced 3-ph, 1 = single phase, 2 = 2-phase (L1+L2)
  var VOLT_LV    = [400, 415, 208, 240, 230];
  var VOLT_HV    = [3.3, 6.6, 11, 22, 33];

  /* ----------------------------------------------------------------------
     2b. PROTECTIVE DEVICES
     ----------------------------------------------------------------------
     What a device is for is three separate jobs, and the app keeps all three
     apart because they are checked separately:

       In   the frame rating — what the mechanism and the contacts are built for
       Ir   the setting it actually protects at — the long-time pickup
       Icu  the breaking capacity — the largest fault it can switch off

     Confusing In with Ir is the classic way to under-size a board: a 250 A
     frame set to 200 A is a 200 A device for the supply's purposes, and the
     250 A frame exists so the 200 A one can be set up to its rating.

     The frame list and the current list are the Compact NS / Acti9 families,
     which is what most industrial installations use. They are indicative —
     any manufacturer whose ranges differ can be typed in by hand.          */

  /* MCCB frames, in amps. A device rating above its frame does not exist. */
  var MCCB_FRAMES = [100, 125, 160, 250, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300];
  /* Long-time settings available within each frame (a subset of the frames). */
  var MCCB_SETTINGS = [10, 12.5, 16, 20, 25, 32, 40, 50, 63, 70, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300];
  /* Breaking capacities, in kA at 415 V / 440 V. */
  var ICU_KA = [6, 10, 15, 20, 25, 36, 50, 80, 100];
  /* Trip unit families. TM = thermal-magnetic, the cheap answer up to 160 A.
     LI = long-time + instantaneous, LI+LS adds a short-time stage for a
     downstream earth fault, LSI adds instantaneous selectivity. */
  var TRIP_UNITS = {
    'TM'    : { name: 'TM — thermal-magnetic',              ls: false, inst: true },
    'LI'    : { name: 'LI — long-time + instantaneous',    ls: false, inst: true },
    'LS'    : { name: 'LS — long-time + short-time',       ls: true,  inst: false },
    'LSI'   : { name: 'LSI — long-time + short + inst',    ls: true,  inst: true },
    'eLSI'  : { name: 'eLSI — with earth-fault element',    ls: true,  inst: true, ef: true }
  };
  /* MCB (Acti9) ratings and curves. The curve picks the magnetic pickup as a
     multiple of In, so it is really an inertia choice: B for resistive loads
     and long runs, C the general case, D for transformers and motors. */
  var MCB_RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125];
  var MCB_CURVES = {
    'B' : { name: 'B — 3-5 × In, resistive loads', mag: '3-5' },
    'C' : { name: 'C — 5-10 × In, mixed loads',    mag: '5-10' },
    'D' : { name: 'D — 10-20 × In, motors, transformers', mag: '10-20' }
  };
  var MCB_ICU_KA = [6, 10, 15, 20, 25, 36, 50];
  /* An MCB tops out well below a 250 A board. Past this a board cannot be
     protected by a single MCB whatever the make — it needs an MCCB, or an MCB
     assembly with a shunt trip and an undervoltage release. */
  var MCB_MAX_A = 125;

  /* ---------------------------------------------------------- trip curves --
     Time-current characteristics, as [multiple of In, seconds] points. Read
     left to right: the device picks up at the first multiple and has cleared by
     the last. `null` for the time means it never clears at that multiple.

     These are the conventional envelopes the standards set, not any
     manufacturer's curves: the thermal band from IEC 60898 for MCBs and the
     long-time and short-time bands from IEC 60947-2 for MCCBs. Where the
     standard gives a range — the magnetic pickup between 5 and 10 In on a curve
     C MCB, for instance — the value used is the *slow* end of it.

     That direction is deliberate. On the overload side a fast pickup
     nuisance-trips, so the slow end is the right number to design with. On the
     short-circuit side it makes the check report a selectivity problem where a
     particular make might not have one, which costs a note; the opposite error
     would pass a circuit that trips the whole board.

     The curves are what turn the selectivity check from a comparison of two
     ratings into an actual study: two devices are selective at a given fault
     level if the lower one clears first *at that level*, and a pair can be
     selective over one range of currents and not another — which is the whole
     point, and is invisible without the curves. */
  var TRIP_CURVES = {
    /* IEC 60898-1 for the thermal band: 1.13 In shall not clear within an hour,
       1.45 In shall clear within an hour, 1.61 In within 1800 s, and the
       magnetic release shall operate within 0.1 s at the multiple its curve
       names. The slow end of each magnetic band is used, and the points between
       the thermal band and the magnetic pickup are filled in by interpolation —
       which is why they are listed rather than left as one long straight run.
       Between 1.45 In and the magnetic multiple the standard specifies nothing,
       and it is exactly that region that decides whether two devices overlap. */
    'MCB_B': { points: [[1.00, 3600], [1.13, 3600], [1.45, 3600], [1.61, 1800], [2.5, 60], [3, 0.5], [4.9, 0.1], [5, 0.02]] },
    'MCB_C': { points: [[1.00, 3600], [1.13, 3600], [1.45, 3600], [1.61, 1800], [2.5, 60], [5, 0.2], [9.9, 0.1], [10, 0.02]] },
    'MCB_D': { points: [[1.00, 3600], [1.13, 3600], [1.45, 3600], [1.61, 1800], [2.5, 60], [10, 0.2], [19.9, 0.1], [20, 0.02]] },
    /* Thermal-magnetic MCCB. The bimetal keeps operating well past the long-time
       band and only hands over to the magnetic release at several times its
       setting, which is the whole reason two of these can be graded: the lower
       one is deep in its magnetic region while the upper one is still on its
       thermal band. Flattening the curve between 1.45 and 6 — as a first attempt
       did — destroys exactly that separation and reports every ordinary pair
       as unselective. */
    'TM': { points: [[0.70, 20], [0.85, 10], [1.00, 6], [1.20, 3], [1.45, 1.0], [2, 0.3], [3, 0.15], [6, 0.1], [9.5, 0.1], [10, 0.05]] },
    /* Long-time + instantaneous. The long-time element is a current transformer
       and a timer with a deliberate delay, so it stays slow well above its
       setting — seconds at twice the setting, not tenths. The instantaneous
       stage then picks up at 10 In, which in absolute terms is a high current
       and is why an LI above a TM can be selective where an LI above an LI
       cannot. */
    'LI': { points: [[0.80, 20], [0.94, 10], [1.05, 2], [1.20, 1.2], [1.50, 0.9], [2, 0.6], [3, 0.35], [6, 0.2], [9.5, 0.2], [10, 0.06]] },
    /* With a short-time stage: the long-time band as LI, then a deliberate
       plateau at 0.1 s across the short-time band — the stage exists precisely
       to hold the device back over the range where the instantaneous would
       otherwise take the whole installation out.

       The instantaneous pickup is written as a threshold, not a ramp: a point
       at 9.5 holding the plateau and a point at 10 dropping to the
       instantaneous time. Interpolating a long straight run between them is
       what produced a "selective up to 7 kA" answer for a device whose plateau
       actually extends to 10, which is not a small error. */
    'LS': { points: [[0.80, 20], [0.94, 10], [1.05, 2], [1.20, 1.2], [1.50, 0.9], [2, 0.3], [6, 0.1], [12, 0.1]] },
    'LSI': { points: [[0.80, 20], [0.94, 10], [1.05, 2], [1.20, 1.2], [1.50, 0.9], [2, 0.3], [6, 0.1], [9.5, 0.1], [10, 0.02]] },
    'eLSI': { points: [[0.80, 20], [0.94, 10], [1.05, 2], [1.20, 1.2], [1.50, 0.9], [2, 0.3], [6, 0.1], [9.5, 0.1], [10, 0.02]] }
  };
  /* A fuse, for completeness: inverse time down to a very large multiple. */
  TRIP_CURVES.FUSE = { points: [[1.25, 14400], [2, 3600], [4, 300], [6, 60], [10, 6], [19, 0.5], [20, 0.05]] };

  /* Which curve applies to a device. A MCCB's frame does not decide it; the
     trip unit does. */
  function curveKeyFor(prot) {
    if (!prot) return null;
    if (prot.kind === 'mcb') return 'MCB_' + (prot.trip || 'C');
    if (prot.kind === 'fuse') return 'FUSE';
    return prot.trip || 'TM';
  }

  var PANEL_TYPES = {
    'mcc'     : { name: 'MCC / control panel',        pf: 0.85, phases: '3' },
    'db_lg'   : { name: 'Lighting distribution board', pf: 0.90, phases: '3' },
    'db_sk'   : { name: 'Small power / socket board', pf: 0.90, phases: '3' },
    'ahu'     : { name: 'AHU / ventilation panel',    pf: 0.85, phases: '3' },
    'pump'    : { name: 'Pump panel',                 pf: 0.80, phases: '3' },
    'chiller' : { name: 'Chiller / cooling plant',    pf: 0.87, phases: '3' },
    'boiler'  : { name: 'Boiler / heating plant',     pf: 0.85, phases: '3' },
    'lift'    : { name: 'Lift / motor control panel', pf: 0.80, phases: '3' },
    'ups'     : { name: 'UPS / IT panel',             pf: 0.95, phases: '3' },
    'ev'      : { name: 'EV charge points (1-ph)',    pf: 0.95, phases: '1' },
    'gen'     : { name: 'Generator / changeover',     pf: 0.80, phases: '3' },
    'plant'   : { name: 'Plant / process panel',      pf: 0.85, phases: '3' },
    'other'   : { name: 'Other / miscellaneous',      pf: 0.90, phases: '3' }
  };

  var DEFAULTS = {
    designMargin   : 1.15,   // board sizing / loading design factor
    vdropLimitLv   : 3.0,    // % for LV distribution
    vdropLimitFinal: 5.0,    // % lighting final circuit
    imbalanceWarn  : 15,     // % max phase deviation of a board's total kVA
    imbalanceBad   : 25,     // % hard limit
    spreadMargin   : 1.25,   // spread on a new board's incomer rating
    pdbMargin      : 1.10,   // TX -> PDB design margin
    zpuPerStage    : 0.06,   // indicative impedance per distribution stage
    faultMVAFactor : 1.0,    // LV fault MVA as a multiple of transformer rating
    pfLimit        : 0.90,   // aggregate power factor below which a board is flagged
    thdWatch       : 15      // % harmonic distortion above which a circuit is flagged
  };

  /* ----------------------------------------------------------------------
     3. FOOTPRINTS (metres) & COLOURS
     ---------------------------------------------------------------------- */
  var SHAPE = {
    tx   : { w: 3.2, h: 2.4, color: '#4ade80', fill: '#0d2a19' },
    pdb  : { w: 2.6, h: 2.0, color: '#60a5fa', fill: '#0b1f38' },
    pdp  : { w: 2.0, h: 1.6, color: '#fbbf24', fill: '#2e2307' },
    db   : { w: 1.5, h: 1.2, color: '#c084fc', fill: '#241a33' },
    panel: { w: 1.6, h: 1.2, color: '#94a3b8', fill: '#1a2028' }
  };

  /* Phase identity colours, used by the plan's phase vectors, the phase bars
     in the properties panel and the CSS variables. Kept here as the single
     source of truth so the canvas and the DOM cannot drift apart.
     L2 is near-black, so it needs a light outline to stay visible against the
     dark canvas — see `phaseEdge`.                                          */
  var PHASE_COLOR = {
    L1: '#8b5a2b',   // brown
    L2: '#1a1a1a',   // black
    L3: '#9aa5b1'    // grey
  };
  var PHASE_EDGE = { L1: '#c98f4a', L2: '#e8e8e8', L3: '#cbd5e1' };
  function phaseColor(ph) { return PHASE_COLOR[ph] || '#94a3b8'; }
  function phaseEdge(ph) { return PHASE_EDGE[ph] || '#94a3b8'; }

  /* ----------------------------------------------------------------------
     4. UTILITIES
     ---------------------------------------------------------------------- */
  var _seq = 0;
  function uid(p) { _seq++; return p + '_' + Date.now().toString(36).slice(-5) + _seq.toString(36); }

  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function snapTo(v, step) { return step > 0 ? Math.round(v / step) * step : v; }
  function fmtGrid(x, y) { return 'E ' + r1(x).toFixed(1) + ' / N ' + r1(y).toFixed(1); }
  function closest(target, list) {
    var best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) { var d = Math.abs(list[i] - target); if (d < bd) { bd = d; best = list[i]; } }
    return best;
  }
  function gridRef(s) { return s ? 'E' + r1(s.x).toFixed(1) + ' N' + r1(s.y).toFixed(1) : '—'; }

  /* ----------------------------------------------------------------------
     5. PROJECT MODEL
     ---------------------------------------------------------------------- */
  function newProject(o) {
    o = o || {};
    return {
      name: o.name || 'Untitled project',
      client: o.client || '',
      designer: o.designer || '',
      date: o.date || new Date().toISOString().slice(0, 10),
      ref: o.ref || 'LV-DIST-001',
      site: Object.assign({ w: num(o.site && o.site.w, 44), h: num(o.site && o.site.h, 30), ox: 0, oy: 0 }, o.site || {}),
      place: Object.assign({ snap: 1, offset: 2, clearance: 1.5 }, o.place || {}),
      design: Object.assign({}, DEFAULTS, o.design || {}),
      txs: o.txs || [],
      pdbs: o.pdbs || [],
      pdps: o.pdps || [],
      dbs: o.dbs || [],
      panels: o.panels || [],
      underlay: o.underlay || null
    };
  }

  function newTx(p) {
    return Object.assign({
      id: uid('tx'), tag: 'TX-' + (p.tag || '?'), name: p.name || 'Transformer',
      num: p.num === undefined ? null : p.num,
      ref: p.ref === undefined || p.ref === null ? '' : p.ref,
      kva: num(p.kva, 1000), kvIn: num(p.kvIn, 11), kvOut: num(p.kvOut, 0.415),
      phases: '3', pf: 0.9, impZ: 6, faultKVA: null, at: 0,
      pos: p.pos || { x: 6, y: 12 }, notes: ''
    }, p);
  }
  function newPdb(p) {
    return Object.assign({
      id: uid('pdb'), tag: p.tag || 'PDB', name: p.name || 'Main LV board',
      num: p.num === undefined ? null : p.num,
      ref: p.ref === undefined || p.ref === null ? '' : p.ref,
      txId: p.txId || null, incomerA: num(p.incomerA, 1600), phases: '3', spareWays: 0,
      pos: p.pos || { x: 10, y: 12 }, notes: '',
      cable: p.cable || { csa: null, cores: 3, len: 0, method: 'XL-A1', group: 1, ambient: 30, sheathed: true }
    }, p);
  }
  function newPdp(p) {
    return Object.assign({
      id: uid('pdp'), tag: p.tag || 'PDP', name: p.name || 'Distribution board',
      num: p.num === undefined ? null : p.num,
      ref: p.ref === undefined || p.ref === null ? '' : p.ref,
      pdbId: p.pdbId || null, incomerA: num(p.incomerA, 400), busbarA: null, phases: '3',
      spareWays: 4,
      /* total ways in the enclosure. Null means "not stated", in which case the
         audit cannot say whether the circuits fit and says nothing — better
         than comparing the circuit count against the spare count and crying
         "too many circuits" on a board with plenty of room. */
      ways: p.ways === undefined || p.ways === null ? null : num(p.ways),
      pos: p.pos || { x: 14, y: 12 }, notes: '',
      cable: p.cable || { csa: null, cores: 4, len: 0, method: 'XL-A1', group: 1, ambient: 40, sheathed: true }
    }, p);
  }
  /* Sub-distribution board — the small board at the end of the chain, e.g. a
     63 A Acti9 supplying lighting, small power and other small final circuits.
     Fed from a PDP; control panels hang off it. One per PDP. */
  function newDb(p) {
    return Object.assign({
      id: uid('db'), tag: p.tag || 'DB', name: p.name || 'Sub-distribution board',
      num: p.num === undefined ? null : p.num,
      ref: p.ref === undefined || p.ref === null ? '' : p.ref,
      pdpId: p.pdpId || null, incomerA: num(p.incomerA, 125), busbarA: null,
      phases: '3', spareWays: 12, enclosure: p.enclosure || 'Acti9', ways: num(p.ways, 36),
      serves: p.serves || 'lighting, small power',
      pos: p.pos || { x: 17, y: 12 }, notes: '',
      cable: p.cable || { csa: null, cores: 4, len: 0, method: 'XL-A1', group: 3, ambient: 40, sheathed: true }
    }, p);
  }
  function newPanel(p) {
    var t = PANEL_TYPES[p.type] || PANEL_TYPES.other;
    var ph = p.phases || t.phases;
    return Object.assign({
      id: uid('pnl'), tag: p.tag || 'PNL', name: p.name || 'Control panel',
      /* a control panel is a load, not a board: it carries whatever
         reference the drawing team uses (MCC-01, AHU-02) and is not part of
         the derived numbering scheme. */
      description: p.description || '', type: p.type || 'other',
      kw: num(p.kw, 0), kva: p.kva === undefined || p.kva === null || p.kva === '' ? null : num(p.kva),
      pf: num(p.pf, t.pf), demand: num(p.demand, 1), phases: ph,
      /* single-phase circuits are fed at the phase-to-neutral voltage */
      volt: num(p.volt, String(ph) === '1' ? 230 : 400),
      start: p.start || 'DOL', contingency: num(p.contingency, 0),
      /* Total harmonic distortion, as a percentage of the fundamental. Null
         unless a circuit declares it: assuming harmonic content for every motor
         would derate every cable on the project, and the great majority of
         circuits genuinely have little. */
      thd: p.thd === undefined || p.thd === null || p.thd === '' ? null : clamp(num(p.thd, 0), 0, 100),
      /* the panel is normally fed from a PDP; `dbId` is the sub-board within
         that PDP it sits on, if any.

         A circuit may instead take its supply straight from a main board, by
         setting `pdbId` and leaving `pdpId` empty. That is what a large piece of
         plant with its own feeder panel looks like on a real drawing: the
         machine panel is one way on the MSB, not one way on a distribution
         board. The main board is a deliberate placement, so such a circuit is
         never touched by auto-assignment or re-balancing. */
      pdbId: p.pdbId || null, pdpId: p.pdpId || null, dbId: p.dbId || null,
      autoAssign: p.autoAssign === undefined ? true : !!p.autoAssign,
      pos: p.pos || { x: 20, y: 12 }, notes: '',
      cable: p.cable || { csa: null, cores: 4, len: 0, method: 'XL-A1', group: 1, ambient: 40, sheathed: true }
    }, p);
  }

  /* A sub-distribution board is a 125 A or 250 A board — an Acti9, Acti9P or
     similar — fed from a distribution board and carrying lighting, small power
     and the other small final circuits. It behaves exactly like a machine main
     control panel: just another feeder off the PDP.

     The board's own rating is one of the two sizes below. The 63 A limit is on
     the largest single piece of equipment fed *from* it — anything bigger is
     supplied directly from the PDP. */
  var DB_SIZES_A = [125, 250];
  var DB_LOAD_MAX_A = 63;

  /* The final circuits that actually sit on a sub-board. Each is within the
     63 A limit on its own, and the "typical" figures are the design load of the
     circuit type rather than its protective device rating — a 32 A socket
     circuit is not usually run at 32 A. */
  var DB_LOAD_TYPES = {
    'lighting':  { name: 'Lighting circuit',        volts: 230, device: 16, typical: 4 },
    'socket-230':{ name: '230 V socket circuit',     volts: 230, device: 32, typical: 7.4 },
    'socket-400':{ name: '400 V socket circuit',     volts: 400, device: 32, typical: 11 },
    'inspection':{ name: 'Inspection system',        volts: 230, device: 32, typical: 5.5 },
    'process':   { name: 'General process sockets',  volts: 230, device: 32, typical: 7.4 }
  };

  /* ----------------------------------------------------------------------
     5b. A PROTECTIVE DEVICE
     ----------------------------------------------------------------------
     One shape for every device in the project, whether it is an MCCB on a
     board incomer, an MCB feeding a sub-board, or the thermal-magnetic device
     on a final circuit. Keeping them in one shape is what lets the schedules
     and the audit treat them all the same way.                            */
  function newProt(o) {
    o = o || {};
    var kind = o.kind || 'mccb';
    var isMcb = kind === 'mcb';
    return {
      kind: kind,
      /* frame rating — the largest the device is built for */
      frame: o.frame === undefined || o.frame === null ? null : num(o.frame),
      /* the rating it actually protects at */
      ir: o.ir === undefined || o.ir === null ? null : num(o.ir),
      /* breaking capacity, in kA */
      icu: o.icu === undefined || o.icu === null ? null : num(o.icu),
      /* MCCB: trip unit family. MCB: curve letter. */
      trip: o.trip || (isMcb ? 'C' : 'TM'),
      /* how many poles are cut — 4 for a 3-phase circuit with neutral */
      poles: o.poles === undefined || o.poles === null ? 4 : num(o.poles),
      /* release / actuator notes, e.g. a shunt trip on an MCB assembly */
      aux: o.aux || '',
      notes: o.notes || ''
    };
  }
  /* A one-line label for a schedule: what a person would write on the drawing. */
  function protLabel(d) {
    if (!d) return '';
    var bits = [];
    if (d.kind === 'mcb') {
      bits.push('MCB ' + (d.ir === null ? '?' : num(d.ir)) + ' A');
      if (d.trip) bits.push(d.trip);
    } else {
      bits.push('MCCB ' + (d.ir === null ? '?' : num(d.ir)) + ' A');
      /* show the frame only when the device is set below it */
      if (d.frame !== null && num(d.frame, 0) !== num(d.ir, 0)) bits.push('/' + num(d.frame) + ' A');
      if (d.trip) bits.push(d.trip);
    }
    return bits.join(' ');
  }

  /* ----------------------------------------------------------------------
     6. SAMPLE PROJECT  (two transformers, factory / office mixed use)
     ---------------------------------------------------------------------- */
  function sampleProject() {
    const tx1 = newTx({ tag: 'TX-A',  name: 'Main distribution transformer A', kva: 1000, kvIn: 11, kvOut: 0.415, pos: { x: 5, y: 24 }, num: 1 });
    const tx2 = newTx({ tag: 'TX-B',  name: 'Main distribution transformer B', kva: 800,  kvIn: 11, kvOut: 0.415, pos: { x: 41, y: 24 }, num: 2 });

    const pdbA = newPdb({ tag: 'PDB-A1', name: 'Main LV board A1', txId: tx1.id, incomerA: 1600, pos: { x: 9.5, y: 24 },
      cable: { csa: null, runs: 1, cores: 4, len: 7, method: 'XL-A1', group: 2, ambient: 40, sheathed: true } });
    const pdbB = newPdb({ tag: 'PDB-B1', name: 'Main LV board B1', txId: tx2.id, incomerA: 1250, pos: { x: 37, y: 24 },
      cable: { csa: null, runs: 1, cores: 4, len: 7, method: 'XL-A1', group: 2, ambient: 40, sheathed: true } });

    const P = [];
    const pdp = (pdb, tag, name, inc, spare, pos, group) => newPdp({ tag, name, pdbId: pdb.id, incomerA: inc, spareWays: spare, pos,
      cable: { csa: null, runs: 1, cores: 4, len: 0, method: 'XL-A1', group: group || 2, ambient: 40, sheathed: true } });

    /* incomers are sized with ~1.3× headroom over the connected load, which
       is what leaves room for the growth and diversity the audit expects */
    const A1 = pdp(pdbA, 'PDP-A1-1', 'Production & plant west', 500, 12, { x: 15, y: 28 });
    const A2 = pdp(pdbA, 'PDP-A1-2', 'Production & plant east', 500, 12, { x: 15, y: 23 });
    const A3 = pdp(pdbA, 'PDP-A1-3', 'Cooling plant',            800, 10, { x: 15, y: 18 });
    const A4 = pdp(pdbA, 'PDP-A1-4', 'Offices & welfare',        250, 12, { x: 15, y: 13 });
    const B1 = pdp(pdbB, 'PDP-B1-1', 'High load IT & labs',     630, 12, { x: 31, y: 28 });
    const B2 = pdp(pdbB, 'PDP-B1-2', 'Energy centre',           500, 10, { x: 31, y: 23 });
    const B3 = pdp(pdbB, 'PDP-B1-3', 'External, EV & generator',400, 16, { x: 31, y: 18 });

    /* Sub-distribution boards — the 125 A / 250 A boards carrying lighting, small
       power and the other small final circuits. Each is just another feeder off
       its distribution board, in the same way a machine main control panel is.
       One per distribution board is the usual starting point. */
    const DB = [];
    const sub = (pdp2, name, inc, ways, pos, serves) => {
      const b = newDb({ name, pdpId: pdp2.id, incomerA: inc || 125, ways: ways || 36, pos,
        serves: serves || 'lighting, small power',
        cable: { csa: null, runs: 1, cores: 4, len: 0, method: 'XL-A1', group: 3, ambient: 40, sheathed: true } });
      DB.push(b);
      return b;
    };

    /* placed clear of the columns the circuits get laid out in below */
    /* One per distribution board — that is the design rule. The small loads go on
       them; the plant (chillers, compressors, boilers, MCCs) stays directly on
       the distribution board, where it belongs. */
    const a1SP = sub(A1, 'Production lighting & small power', 125, 36, { x: 32.5, y: 30.2 });
    const a2SP = sub(A2, 'Packing lighting & small power', 125, 36, { x: 32.5, y: 25.2 });
    const a3SP = sub(A3, 'Plant room lighting & small power', 250, 54, { x: 32.5, y: 20.2 }, 'lighting, process sockets');
    const a4LT = sub(A4, 'Offices lighting & small power', 125, 36, { x: 32.5, y: 11.2 });
    const b1SP = sub(B1, 'IT small power', 125, 36, { x: 43.5, y: 30.2 });
    const b2SP = sub(B2, 'Energy centre small power', 125, 36, { x: 43.5, y: 25.2 });
    const b3SP = sub(B3, 'External lighting & small power', 125, 36, { x: 43.5, y: 20.2 });
    /* a second area board where the distribution board needs it */
    const a4LT2 = sub(A4, 'Offices small power — east wing', 125, 36, { x: 38.5, y: 11.2 }, 'small power, inspection system');

    /* Control panels keep their own reference — MCC-01, AHU-02 — which is the
       name the drawing team already uses. Only the boards are numbered. */
    const pn = (o) => {
      const p = newPanel(o);
      P.push(p);
      return p;
    };
    /* feeder cables are left blank: the tool sizes them from load, length,
       installation method and the volt drop limit. Press "Size all cables"
       to re-suggest at any time. */
    const cbl = (len, method, group, ambient) => ({ csa: null, runs: 1, cores: 4, len,
      method: method || 'XL-A1', group: group || 3, ambient: ambient || 40, sheathed: true });

    pn({ tag: 'MCC-01', name: 'Conveyor line 1 panel', type: 'mcc',  kw: 45, pdpId: A1.id, cable: cbl(14), description: 'CV-01 / CV-02 / CV-03 drives' });
    pn({ tag: 'MCC-02', name: 'Conveyor line 2 panel', type: 'mcc',  kw: 38, pdpId: A1.id, cable: cbl(15), description: 'CV-04 / CV-05 drives' });
    pn({ tag: 'MCC-03', name: 'Packing line panel',    type: 'mcc',  kw: 30, pdpId: A1.id, cable: cbl(16), description: 'Case packer, wrappers' });
    pn({ tag: 'AHU-01', name: 'AHU-1 supply & return', type: 'ahu',  kw: 22, pdpId: A1.id, cable: cbl(12), description: 'Supply 5.5 kW + return fan' });
    pn({ tag: 'PMP-A1', name: 'Process water pump set', type: 'pump', kw: 18, pdpId: A1.id, cable: cbl(10), description: '2 × 9 kW duty/standby' });
    pn({ tag: 'DB-PROD', name: 'Production small power',type: 'db_sk',kw: 26, pdpId: A1.id, dbId: a1SP.id, cable: cbl(18), description: 'Process sockets, 32 A outlets' });
    pn({ tag: 'DB-PROD-LT', name: 'Production lighting', type: 'db_lg', kw: 6, pdpId: A1.id, dbId: a1SP.id, cable: cbl(20, 'XL-B1', 2, 30), description: 'High bay LED' });
    pn({ tag: 'PLT-01', name: 'Dosing plant panel',    type: 'plant',kw: 9,  pdpId: A1.id, cable: cbl(14), description: 'Dosing pumps' });

    pn({ tag: 'MCC-04', name: 'Mixing & batching MCC', type: 'mcc',  kw: 55, pdpId: A2.id, cable: cbl(20), description: '3 × mixers, dosing' });
    pn({ tag: 'MCC-05', name: 'Filling line MCC',      type: 'mcc',  kw: 42, pdpId: A2.id, cable: cbl(22), description: 'Filler, capper, labeller' });
    pn({ tag: 'AHU-02', name: 'AHU-2 ventilation',     type: 'ahu',  kw: 18, pdpId: A2.id, cable: cbl(12), description: 'Production extract' });
    pn({ tag: 'PMP-A2', name: 'Effluent pump panel',   type: 'pump', kw: 11, pdpId: A2.id, cable: cbl(11), description: 'Duty/standby, non-auto' });
    pn({ tag: 'DB-PACK', name: 'Packing small power',  type: 'db_sk',kw: 21, pdpId: A2.id, dbId: a2SP.id, cable: cbl(16), description: 'Packing sockets' });
    pn({ tag: 'COMP-01',name: 'Screw compressor panel',type: 'mcc',  kw: 37, pdpId: A2.id, cable: cbl(9),  description: '150 kW compressor, 400 V' });

    pn({ tag: 'CHL-01', name: 'Chiller 1 panel',       type: 'chiller', kw: 110, pdpId: A3.id, cable: cbl(13), description: '550 kW centrifugal chiller' });
    pn({ tag: 'CHL-02', name: 'Chiller 2 panel',       type: 'chiller', kw: 110, pdpId: A3.id, cable: cbl(13), description: '550 kW centrifugal chiller' });
    pn({ tag: 'AHU-03', name: 'AHU-3 kitchen extract', type: 'ahu',  kw: 11, pdpId: A3.id, cable: cbl(10), description: 'Kitchen extract' });
    pn({ tag: 'PMP-CHL',name: 'Chilled water pumps',   type: 'pump', kw: 15, pdpId: A3.id, cable: cbl(8),  description: '3 × 5.5 kW' });
    pn({ tag: 'PMP-CT', name: 'Cooling tower panel',   type: 'pump', kw: 11, pdpId: A3.id, pos: { x: 20, y: 8.7  }, cable: cbl(9),  description: 'CT fans' });
    pn({ tag: 'PLT-SP',  name: 'Plant room sockets',    type: 'db_sk',kw: 9,  pdpId: A3.id, dbId: a3SP.id, cable: cbl(12), description: 'Workshop and plant room outlets' });

    pn({ tag: 'DB-LT-O', name: 'Office lighting — west', type: 'db_lg', kw: 11, pdpId: A4.id, dbId: a4LT.id, cable: cbl(20), description: 'LED, DALI' });
    pn({ tag: 'DB-INSP', name: 'Inspection system', type: 'plant', kw: 2, pdpId: A4.id, dbId: a4LT.id, cable: cbl(18, 'XL-B1', 2, 30), description: 'Electrical inspection outlets, 32 A' });
    pn({ tag: 'DB-SK-O', name: 'Office socket DB — west', type: 'db_sk', kw: 16, pdpId: A4.id, dbId: a4LT.id, pos: { x: 20, y: 8.8  }, cable: cbl(22), description: 'Small power, 32 A outlets' });
    pn({ tag: 'DB-SO-400', name: '400 V socket outlets', type: 'db_sk', kw: 9, pdpId: A4.id, dbId: a4LT.id, cable: cbl(20), description: 'Three-phase sockets, 32 A' });
    /* the kitchen extract and the catering equipment are plant, not small
       power — they stay on the distribution board */
    pn({ tag: 'DB-SK-E', name: 'Office socket DB — east', type: 'db_sk', kw: 16, pdpId: A4.id, dbId: a4LT2.id, cable: cbl(24), description: 'Small power, 32 A outlets' });
    pn({ tag: 'KITCHEN', name: 'Catering / kitchen DB',type: 'db_sk', kw: 28, pdpId: A4.id, pos: { x: 20, y: 7.1  }, cable: cbl(16), description: 'Kitchen equipment' });
    pn({ tag: 'LIFT-01', name: 'Goods lift panel',      type: 'lift', kw: 15, pdpId: A4.id, pos: { x: 20, y: 5.4  }, cable: cbl(12), description: '1 × 1000 kg, 13 kW' });
    pn({ tag: 'DB-FIRE', name: 'Fire services DB',     type: 'plant', kw: 8,  pdpId: A4.id, pos: { x: 20, y: 3.7  }, cable: cbl(14, 'XL-B1', 2, 30), description: 'Pump + smoke control' });
    pn({ tag: 'DB-LT-R', name: 'Reception lighting (1-ph)', type: 'db_lg', kw: 3, pdpId: A4.id, dbId: a4LT.id, cable: cbl(24, 'XL-B1', 2, 30), description: 'Single-phase supply to reception lighting' });

    pn({ tag: 'UPS-01',  name: 'Main UPS panel',       type: 'ups',  kw: 60, pdpId: B1.id, cable: cbl(12), description: '2 × 60 kVA, 400 V' });
    pn({ tag: 'IT-01',   name: 'IT rack & comms — riser A', type: 'db_sk', kw: 15, pdpId: B1.id, dbId: b1SP.id, cable: cbl(15), description: 'Racks, PDUs, comms, riser A' });
    pn({ tag: 'IT-02',  name: 'IT rack & comms — riser B', type: 'db_sk', kw: 17, pdpId: B1.id, cable: cbl(16), description: 'Racks, PDUs, comms, riser B' });
    /* 28 kW of lab sockets is more than a 63 A board takes, so half the
       laboratories go on the sub-board and half on the distribution board */
    pn({ tag: 'LAB-01',  name: 'Laboratory sockets — block A', type: 'db_sk', kw: 14, pdpId: B1.id, dbId: b1SP.id, cable: cbl(17), description: 'Lab bench outlets, block A' });
    pn({ tag: 'LAB-02',  name: 'Laboratory sockets — block B', type: 'db_sk', kw: 14, pdpId: B1.id, cable: cbl(19), description: 'Lab bench outlets, block B' });
    /* the BMS head panel is plant, not a small-power outlet board */
    pn({ tag: 'BMS-01',  name: 'BMS / ELV panel',      type: 'plant', kw: 5,  pdpId: B1.id, cable: cbl(14, 'XL-B1', 2, 30), description: 'Controls & ELV' });
    pn({ tag: 'UPS-02',  name: 'UPS bypass panel',     type: 'ups',  kw: 30, pdpId: B1.id, cable: cbl(13), description: 'Bypass / static switch' });

    pn({ tag: 'BLR-01',  name: 'Boiler 1 panel',       type: 'boiler', kw: 90, pdpId: B2.id, cable: cbl(14), description: '2 × 45 kW modulating boilers' });
    pn({ tag: 'BLR-02',  name: 'Boiler 2 panel',       type: 'boiler', kw: 60, pdpId: B2.id, cable: cbl(15), description: '1 × 60 kW' });
    pn({ tag: 'PMP-B1',  name: 'Heating pump panel',   type: 'pump',   kw: 12, pdpId: B2.id, cable: cbl(10), description: '2 × 6 kW' });
    pn({ tag: 'WTP-01',  name: 'Water treatment panel',type: 'plant',  kw: 14, pdpId: B2.id, cable: cbl(13), description: 'RO plant, dosing' });
    pn({ tag: 'AHU-PLT', name: 'Plant room AHU',       type: 'ahu',    kw: 16, pdpId: B2.id, cable: cbl(11), description: 'Plant room ventilation' });
    pn({ tag: 'B2-SP',   name: 'Energy centre sockets', type: 'db_sk', kw: 7, pdpId: B2.id, dbId: b2SP.id, cable: cbl(14), description: 'Plant room outlets' });

    /* single-phase circuits: these are what the phase balancer is for.
       Each EV bank is 2 × 7 kW on one phase (~15 A), the way real charge
       points are grouped, not a whole 4-point bank on a single phase. */
    pn({ tag: 'EV-01',   name: 'EV charge points — bank 1 (1-ph)', type: 'ev', kw: 14, pdpId: B3.id, cable: cbl(22), description: '2 × 7 kW, single phase' });
    pn({ tag: 'EV-02',   name: 'EV charge points — bank 2 (1-ph)', type: 'ev', kw: 14, pdpId: B3.id, cable: cbl(24), description: '2 × 7 kW, single phase' });
    pn({ tag: 'EV-03',   name: 'EV charge points — bank 3 (1-ph)', type: 'ev', kw: 14, pdpId: B3.id, cable: cbl(26), description: '2 × 7 kW, single phase' });
    pn({ tag: 'LT-CP',   name: 'Car park light columns (1-ph)', type: 'db_lg', kw: 4, pdpId: B3.id, dbId: b3SP.id, cable: cbl(28, 'XL-E', 2, 25), description: 'Column lighting, single phase' });
    pn({ tag: 'EXT-LT',  name: 'External & street lighting', type: 'db_lg', kw: 11, pdpId: B3.id, dbId: b3SP.id, cable: cbl(25, 'XL-E', 2, 25), description: 'Yard, street and boundary lights' });
    pn({ tag: 'GENSET-01', name: 'Generator changeover', type: 'gen', kw: 0, pdpId: B3.id, cable: cbl(18), description: 'Standby generator 500 kVA, connect here' });
    pn({ tag: 'DB-YARD', name: 'Yard & gates DB',      type: 'db_sk', kw: 12, pdpId: B3.id, dbId: b3SP.id, cable: cbl(20), description: 'Gate, barriers, washdown' });

    /* two panels that have not been placed on the distribution yet: on load
       they are assigned automatically (one of them tips a board over). */
    pn({ tag: 'MCC-06', name: 'Palletiser MCC', type: 'mcc', kw: 26, pdpId: null, cable: cbl(12), description: 'End-of-line palletiser' });
    pn({ tag: 'DB-EXT2', name: 'New wing lighting DB', type: 'db_lg', kw: 13, pdpId: null, cable: cbl(18, 'XL-B1', 2, 30), description: 'New extension' });

    /* Lay the control panels out on a tidy grid in columns beside their
       supply, so the sample plan is legible and nothing overlaps. */
    const group = {};
    [A1, A2, A3, A4].forEach(function (d) { group[d.id] = 'A'; });
    [B1, B2, B3].forEach(function (d) { group[d.id] = 'B'; });
    const sideA = [], sideB = [];
    P.forEach(function (pn) { if (!pn.pdpId || group[pn.pdpId] === 'A') sideA.push(pn); else sideB.push(pn); });
    /* The circuits are laid in columns between the distribution boards (x = 15/31)
       and the sub-boards (x = 32.5, 38.5 on side A and 43.5 on side B). Side A
       needs three columns and side B two, so the two blocks are offset to keep
       their last columns clear of each other. */
    const lay = (list, colX) => {
      const perCol = 13, colW = 2.4, rowH = 1.75, top = 30.5;
      list.forEach(function (pn, i) {
        pn.pos = { x: colX + Math.floor(i / perCol) * colW, y: top - (i % perCol) * rowH };
      });
    };
    lay(sideA, 18);
    lay(sideB, 25.6);

    return newProject({
      name: 'Riverside Production Facility — LV distribution',
      client: 'Riverside Manufacturing Ltd',
      designer: 'E. Reynolds (CEng)',
      ref: 'LV-DIST-001',
      site: { w: 46, h: 32 },
      txs: [tx1, tx2], pdbs: [pdbA, pdbB],
      pdps: [A1, A2, A3, A4, B1, B2, B3], dbs: DB, panels: P
    });
  }

  /* ---------------------------------------------------------------------- */
  return {
    CSA, METHODS, TEMP_FACTORS, GROUP_FACTORS, WITHSTAND, MAX_CABLE_RUNS,
    SIZES_A, SIZES_KVA, SIZES_KW, PHASES, VOLT_LV, VOLT_HV,
    PANEL_TYPES, DEFAULTS, SHAPE, PHASE_COLOR, PHASE_EDGE, phaseColor, phaseEdge,
    DB_SIZES_A, DB_LOAD_MAX_A, DB_LOAD_TYPES,
    MCCB_FRAMES, MCCB_SETTINGS, ICU_KA, TRIP_UNITS,
    MCB_RATINGS, MCB_CURVES, MCB_ICU_KA, MCB_MAX_A, TRIP_CURVES, curveKeyFor,
    newProt, protLabel,
    uid, num, r1, r2, clamp, esc, snapTo, fmtGrid, gridRef, closest,
    newProject, newTx, newPdb, newPdp, newDb, newPanel, sampleProject
  };
})();
