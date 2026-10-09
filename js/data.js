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

  /* ===================================================== Schneider NSX ======

     The NSX range, as reference data rather than as numbers scattered through the
     arithmetic. A device is selected from it the way it is in practice: pick the
     frame the rating needs, pick the trip unit that gives the functions the
     coordination requires, set those functions to the values the coordination
     works out, and take the interrupting rating the fault level demands.

     Each frame is quoted over the range of long-time settings it offers, not at
     a single rating, because that is the whole point of an adjustable pickup — a
     1,250 A frame covers 630 to 1,250 A and the selection sits inside that, not
     on it. `icu` is the catalogue ladder in kA at 415 V; the suffix after it is
     Schneider's: N is the standard build, L the high-interrupting one.

     Nothing here decides anything on its own. nsxSelect() in calc.js chooses from
     it, and the reasoning that goes with the choice is in the findings. */

  var NSX = [
    /* The compact frame. Below 100 A it is thermal-magnetic only — Micrologic 2
       or 3 — and there is no short-time stage, so it cannot be made selective
       against anything. That is a real limit of the product and the selector has
       to say so rather than pretending an electronic unit exists at this size. */
    { size: 'NSX100', lo: 12.5, hi: 100,  icu: [25, 50, 100], suffix: { 25: 'N', 50: 'H', 100: 'L' },
      compact: true, trip: ['2.2', '3.2'] },
    { size: 'NSX160', lo: 100,  hi: 160,  icu: [25, 50, 100], suffix: { 25: 'N', 50: 'H', 100: 'L' },
      trip: ['2.2', '3.2', '5.2', '6.2', '7.2'] },
    { size: 'NSX250', lo: 100,  hi: 250,  icu: [25, 50, 100], suffix: { 25: 'N', 50: 'H', 100: 'L' },
      trip: ['2.2', '3.2', '5.2', '6.2', '7.2'] },
    { size: 'NSX400', lo: 160,  hi: 400,  icu: [25, 50, 100], suffix: { 25: 'N', 50: 'H', 100: 'L' },
      trip: ['5.2', '5.3', '6.3', '7.3', '8.3'] },
    { size: 'NSX630', lo: 250,  hi: 630,  icu: [25, 50, 100], suffix: { 25: 'N', 50: 'H', 100: 'L' },
      trip: ['5.2', '5.3', '6.3', '7.3', '8.3'] },
    { size: 'NSX800', lo: 500,  hi: 800,  icu: [50, 100], suffix: { 50: 'N', 100: 'L' },
      trip: ['5.2', '5.3', '6.3', '7.3', '8.3'] },
    { size: 'NSX1000', lo: 500, hi: 1000, icu: [50, 100], suffix: { 50: 'N', 100: 'L' },
      trip: ['5.2', '5.3', '6.3', '7.3', '8.3'] },
    { size: 'NSX1250', lo: 630, hi: 1250, icu: [50, 100], suffix: { 50: 'N', 100: 'L' },
      trip: ['5.2', '5.3', '6.3', '7.3', '8.3'] },
    { size: 'NSX1600', lo: 800, hi: 1600, icu: [50, 100], suffix: { 50: 'N', 100: 'L' },
      trip: ['5.2', '5.3', '6.3', '7.3', '8.3'] },
    { size: 'NSX2000', lo: 1000, hi: 2000, icu: [50, 100], suffix: { 50: 'N', 100: 'L' },
      trip: ['6.3', '7.3', '8.3'] },
    { size: 'NSX2500', lo: 1250, hi: 2500, icu: [50, 100], suffix: { 50: 'N', 100: 'L' },
      trip: ['6.3', '7.3', '8.3'] },
    { size: 'NSX3000', lo: 1600, hi: 3000, icu: [50, 100], suffix: { 50: 'N', 100: 'L' },
      trip: ['6.3', '7.3', '8.3'] },
    { size: 'NSX4000', lo: 2000, hi: 4000, icu: [50, 100], suffix: { 50: 'N', 100: 'L' },
      trip: ['6.3', '7.3', '8.3'] },
    { size: 'NSX5000', lo: 2500, hi: 5000, icu: [50, 100], suffix: { 50: 'N', 100: 'L' },
      trip: ['6.3', '7.3', '8.3'] },
    { size: 'NSX6000', lo: 3000, hi: 6000, icu: [50, 100], suffix: { 50: 'N', 100: 'L' },
      trip: ['6.3', '7.3', '8.3'] }
  ];

  /* What the digit pairs in a Micrologic reference mean, because "7.3" on a
     schedule is otherwise unreadable and the difference between 5.3 and 7.3 is
     the whole of the coordination.

     The first digit is the family — 2 is thermal-magnetic, 5 and up are
     electronic — and the second is the number of protected poles plus one, so 2
     is single-pole and 3 is the three-phase build. The lettered versions (5.3A,
     7.3L) add earth-leakage or earth-fault measurement and are not auto-selected
     here because nothing in the schedule asks for it. */
  var MICLOGIC_FUNCTIONS = {
    '2.2': { long: true,  short: false, instant: false, thermal: true,  label: 'L, thermal' },
    '3.2': { long: true,  short: false, instant: true,  thermal: true,  label: 'L + I, thermal-magnetic' },
    '5.2': { long: true,  short: false, instant: false, thermal: false, label: 'L' },
    '5.3': { long: true,  short: false, instant: false, thermal: false, label: 'L' },
    '6.2': { long: true,  short: true,  instant: false, thermal: false, label: 'L + S' },
    '6.3': { long: true,  short: true,  instant: false, thermal: false, label: 'L + S' },
    '7.2': { long: true,  short: true,  instant: true,  thermal: false, label: 'L + S + I' },
    '7.3': { long: true,  short: true,  instant: true,  thermal: false, label: 'L + S + I' },
    '8.3': { long: true,  short: true,  instant: true,  thermal: false, label: 'L + S + I + G, earth fault' }
  };

  /* The adjustment a Micrologic actually offers, so the coordination search does
     not propose a number the unit cannot be set to.

     Ir runs 0.4 to 1.0 of the frame on the electronic units and in 5 A steps,
     which is what lets a 1,250 A frame be set to the 847 A its board actually
     carries. Isd is 1.1 to 10 of Ir in the published steps, and tsd is the delay
     list below it. Ii is OFF or 0.1 to 10 of Ir. */
  var NSX_IR_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  var NSX_ISD_STEPS = [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3, 4, 5, 6, 8, 10];
  var NSX_II_STEPS  = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 3, 4, 5, 6, 8, 10];

  /* Frame that covers a rating, or null. The smallest frame whose range does,
     which is not the same as the nearest size above it — NSX1250 covers 630 up,
     so an 800 A device does not need the 1,000 A frame. */
  function nsxFor(amps) {
    var a = num(amps, 0);
    if (!(a > 0)) return null;
    var hits = NSX.filter(function (n) { return a >= n.lo && a <= n.hi; });
    return hits.length ? hits[0] : (a < NSX[0].lo ? null : null);
  }

  /* The smallest interrupting rating in a frame that clears the fault level with
     the margin the design margin asks for. Returns null when the frame cannot do
     it at any rating it offers, which is a real answer and not a failure. */
  function nsxIcu(frame, faultKA, margin) {
    if (!frame || !(faultKA > 0)) return null;
    var need = faultKA * num(margin, 1.25);
    for (var i = 0; i < frame.icu.length; i++) {
      if (frame.icu[i] >= need) return frame.icu[i];
    }
    return null;
  }
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
  /* What each trip unit family has, as separate from how fast it is.

     The curve says how long a device takes at a given multiple. It cannot say
     whether the device is *able* to hold — and holding is the whole of
     selectivity. An LS unit has no instantaneous element at all, so set its
     short-time delay to 0.3 s and it will hold for 0.3 s on any fault above its
     long-time pickup, however large, which is exactly what makes it selective
     with the device below it. An LI has no short-time stage, so it cannot be made
     to hold at all and its instantaneity is fixed.

     Without this the app could report thirty-four pairs as non-selective and had
     no way to make any of them selective, because there was nothing to change. */
  var TRIP_STAGES = {
    'TM':    { shortTime: false, instantaneous: 9.5,  name: 'thermal-magnetic' },
    'LI':    { shortTime: false, instantaneous: 10,   name: 'long-time and instantaneous' },
    'LS':    { shortTime: true,  instantaneous: null, name: 'long-time and short-time, no instantaneous' },
    'LSI':   { shortTime: true,  instantaneous: 10,   name: 'long-time, short-time and instantaneous' },
    'eLSI':  { shortTime: true,  instantaneous: 10,   name: 'electronic, long-time, short-time and instantaneous' }
  };
  function tripStages(trip) {
    return TRIP_STAGES[trip || 'TM'] || TRIP_STAGES.TM;
  }

  /* A device's stages with its own settings folded in. tripStages() answers what
     the TYPE can do; this answers what THIS unit is set to do, which is the only
     question selectivity can be answered from. Blank settings fall back to the
     type, and a thermal-magnetic device ignores a pickup that is not adjustable
     on it rather than pretending one is. */
  function stageSettings(prot) {
    var stg = tripStages(prot && prot.trip);
    var adjustable = stg.shortTime || prot && (prot.trip === 'eLSI' || prot.trip === 'LSI');
    var out = {
      shortTime: stg.shortTime,
      instantaneous: stg.instantaneous,
      /* where the hold starts, in multiples of the long-time setting */
      ss: num(prot && prot.ss, 0) > 0 ? num(prot.ss) : null,
      /* adjustable at all? a TM device's instantaneous is fixed by its bimetal */
      ssAdjustable: !!stg.shortTime,
      iiAdjustable: prot && (prot.trip === 'eLSI' || prot.trip === 'LSI')
    };
    if (out.ss === null && out.ssAdjustable) out.ss = 2;
    var ii = num(prot && prot.ii, 0) > 0 ? num(prot.ii) : null;
    if (ii !== null && out.iiAdjustable) out.instantaneous = ii;
    return out;
  }

  /* The standard short-time delays an electronic trip unit offers. A delay is
     only useful if it is one the manufacturer makes, so the search is over this
     list rather than over arithmetic. */
  var SHORT_TIME_DELAYS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0];

  /* Where the short-time stage starts, as a multiple of the long-time setting.
     IEC 60947-2 gives Isd from 1.1 to 10 times In; electronic units commonly
     reach below 1, and that is where the selectivity on this project lives, so
     the list starts where the standard does rather than where it is convenient.
     Listed in the order a person would scan it — smallest first, because lowering
     it is what buys selectivity. */
  var SHORT_TIME_PICKUPS = [1.1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

  /* Where the instantaneous stage starts. Fixed on thermal-magnetic and LI
     units, which is why those appear at the top of the range only; an electronic
     unit will pick up well below its own setting. */
  var INSTANT_PICKUPS = [0.4, 0.6, 0.8, 1, 1.5, 2, 3, 4, 5, 6, 8, 10];

  var TRIP_CURVES = {
    /* IEC 60898-1 for the thermal band: 1.13 In shall not clear within an hour,
       1.45 In shall clear within an hour, 1.61 In within 1800 s, and the
       magnetic release shall operate within 0.1 s at the multiple its curve
       names. The slow end of each magnetic band is used.

       IEC 60947-2 requires the magnetic release to operate within 0.1 s and
       gives 10-50 ms as the usual band. Every magnetic point above is at or
       below 0.05 s, inside it: an LI ending at 0.06 s sat just outside, which
       is enough to fail a 240 mm² feeder's thermal withstand that a real 40 ms
       device would pass. Where a device has no published curve the worst case
       in the band is used, not a number chosen outside it.

       Between 1.45 In and the magnetic multiple the standard specifies nothing,
       and it is exactly that region that decides whether two devices overlap —
       so it cannot be left as one long interpolation. With a single jump from
       60 s at 2.5 In to 0.2 s at 5 In, a log-log interpolation reports a 16 A MCB
       carrying 44 A as taking 25 s. No engineer believes that, and it made the
       disconnection-time check look broken rather than making it strict. The
       intermediate points are representative rather than standardised: real
       bimetal releases fall steeply through this region, and they are set
       towards the slow side so the check errs towards reporting a problem. */
    'MCB_B': { points: [[1.00, 3600], [1.13, 3600], [1.45, 3600], [1.61, 1800], [2.5, 20], [3, 2], [4, 0.4], [5, 0.1]] },
    'MCB_C': { points: [[1.00, 3600], [1.13, 3600], [1.45, 3600], [1.61, 1800], [2.5, 20], [3, 2], [4, 0.4], [5, 0.2], [9.9, 0.1], [10, 0.02]] },
    'MCB_D': { points: [[1.00, 3600], [1.13, 3600], [1.45, 3600], [1.61, 1800], [2.5, 20], [3, 2], [4, 0.5], [6, 0.3], [10, 0.2], [19.9, 0.1], [20, 0.02]] },
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
    'LI': { points: [[0.80, 20], [0.94, 10], [1.05, 2], [1.20, 1.2], [1.50, 0.9], [2, 0.6], [3, 0.35], [6, 0.2], [9.5, 0.2], [10, 0.04]] },
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

  /* IEC 60947-4-1 overload relay classes: the permitted trip time at 6x rated
     current. The number IS the trip time in seconds. */
  var MOTOR_CLASSES = {
    10: { seconds: 10, note: 'Trip within 10 s at 6 × rated current. The usual choice where the machine can be restarted quickly, and the safe default for anything whose value of lost production is not high.' },
    20: { seconds: 20, note: 'Trip within 20 s at 6 × rated current. For a machine that can tolerate a short delay before it is restarted, or where nuisance tripping on a transient has been a problem.' },
    30: { seconds: 30, note: 'Trip within 30 s at 6 × rated current. For a process that cannot be restarted without significant delay or cost — a continuous line, a transformer, an item where the rest of the plant waits on it.' }
  };

  var DEFAULTS = {
    /* The largest incomer a distribution board may have. See pdpMaxA() in
       calc.js for why 1,600 A is the point at which a board stops being a
       board. Declared here because it is a project specification and not a
       constant — some contracts set it lower, and a small transformer makes a
       1,600 A board pointless whatever the rule says. */
    pdpMaxIncomer  : 1600,
    /* The tap range a distribution transformer's selector offers. +/-3 x 2.5% is
       the usual complement on a transformer of this size, seven positions in all.
       It is declared rather than assumed because a tap advice that offers a
       position the transformer does not have is worse than no advice. */
    tapRange       : 7.5,
    tapStep        : 2.5,
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
    thdWatch       : 15,     // % harmonic distortion above which a circuit is flagged

    /* ------------------------------------------- motor protection classes ---
       IEC 60947-4-1 classes 10, 20 and 30: the maximum time an overload relay
       takes to trip at 6 × the motor's rated current. The number is the trip
       time in seconds, so class 10 means at most 10 s.

       The class exists because a motor's thermal capacity is finite and its
       permissible temperature rise depends on what is hard to restart. A
       conveyor that can be restarted in ten minutes can afford class 30; a
       chiller or a transformer in a control system cannot, because the cost of
       an hour of downtime is far higher than the cost of a faster relay.

       This is one of the few places in a specification where the right answer is
       a commercial judgement rather than a calculation, which is why it is a
       declared field and never inferred from anything. */

    /* ------------------------------------------------- arc flash -----------
       Deliberately not a working distance and an arcing time as editable
       numbers. IEEE 1584 needs an electrode configuration, enclosure dimensions
       and a conductor gap, none of which can be inferred from a cable schedule —
       and reclassifying VCB to HCB roughly doubled the energy when that standard
       was revised. What the app holds instead is the fault current and the real
       trip curve, which fix the ARCING TIME, and that is the dominant term. */
    arcTimeMax: 0.5,           // s — only ever a stated assumption, never a default

    /* IEC 60947-4-1 overload relay class when none is declared on the circuit.
       Class 10 trips sooner, so it protects the motor more readily; class 30 is
       chosen for availability, which is the opposite trade. */
    motorClassDefault: 10,

    /* ------------------------------------------------------- bill of materials
       The quantities are derived from the design on every render, so they cannot
       go stale. The tails and drum length are the two settings that turn a
       cutting list into something orderable. */
    /* Slack at each end of a run, in metres. A panel in a plant room wants far
       more than one in a field cabinet, so this is a setting rather than a
       constant — and the bill shows both the route length and the length with
       tails, so the assumption is visible rather than buried. */
    cableTailsPerEnd: 1.5,
    /* Standard drum length. A circuit rarely divides into one, and the offcut
       is the next termination rather than waste — so both are reported. */
    cableDrumM: 100,
    /* Lines the design cannot know about: a gland plate, a label printer, an
       enclosure the standard range does not cover. */
    bomExtra: [],

    /* --------------------------------------------- demand and coincidence ---
       Two ways from connected load to the load a supply carries, and they are
       alternatives rather than layers. `per-circuit` sums each circuit's own
       demand factor. `coincidence` sums the connected load and applies one
       factor to the board, because its circuits do not all peak together.

       Applying both double-counts the same diversification and can report half
       the real load, silently. The method is therefore a declared setting rather
       than a default in the arithmetic, and the schedule reports both figures so
       the choice is visible. */
    demandMethod: 'per-circuit',   // 'per-circuit' | 'coincidence'
    demandMethodBand: null,        // which coincidence band, when that method is used
    /* Kept false and explained rather than offered as a checkbox: the two
       methods compound the same assumption, so there is no setting of this
       switch that is correct. */
    applyCoincidence: false,

    /* ---------------------------------------------------- PF correction -----
       Whether a power factor is worth correcting, and to what. The economics are
       a supplier's tariff rather than physics, so the target is a setting with
       a stated basis rather than a constant buried in the code. */
    pfTarget      : 0.98,   // what to correct to when a bank is fitted
    /* Above this the supply authority or the transformer owner will usually
       charge for it, so it is the point at which correction starts to pay. */
    pfPenaltyLimit: 0.95,
    /* A drive-fed site changes the answer, because a capacitor bank resonates
       with the system inductance and the resonance can land on the 5th or 7th
       harmonic a bank of drives produces. Below this much non-linear load the
       resonance is treated as a low risk. */
    capHarmonicWatch: 20,   // % of load on non-linear circuits, above which the
                            // resonance of a capacitor bank is a live concern
    /* Detuning reactor, as a percentage of the capacitor's reactance at 50 Hz.
       This is what moves the resonance above the harmonics instead of onto
       them. 7% is the usual figure and puts the resonance near 3.8× the
       fundamental, comfortably above the 7th. */
    capDetune     : 7,
    /* Allowed voltage rise on a capacitor under harmonic magnification. IEC
       60831-1 allows 110% of rated at the fundamental; a detuned bank on a
       harmonic-rich supply can exceed it, and 110% is the figure that decides
       whether the bank needs an overrating. */
    capVoltageLimit: 110,

    /* ------------------------------------------------ earth fault looping --
       Automatic disconnection of a faulty circuit is a two-part requirement: the
       loop has to be low enough that the device carries enough current to
       operate, and it has to do so within a stated time. The first half is a
       resistance calculation, the second half is the device's time-current
       characteristic — which is why the curves in TRIP_CURVES are needed here
       as well as for selectivity.

       Maximum disconnection times, IEC 60364-41 Table 41.4, which BS 7671
       Regulation 411.3.3 reproduces. The ≤32 A case assumes 30 mA additional
       protection, which is what makes 0.1 s rather than 0.5 s achievable on a
       final circuit; without an RCD the row above applies. */
    /* TN-S: the neutral is earthed at the source and stays a separate conductor
       all the way to every board, never re-bonded to earth downstream and never
       interrupted. TN-C-S shares the PEN conductor over part of the run, which
       means a lower loop impedance but also that every PEN is a neutral. TT
       returns through an electrode. IT has no earthed source point at all and
       needs an RCD by definition. */
    supplySystem   : 'TN-S', // TN-S | TN-C-S | TT | IT
    earthElectrodeR: 0.0,    // ohms; only read for a TT supply
    /* Which conductors the earthing arrangement puts on a feeder. TN-S is
       3 phase + neutral + PE throughout; TN-C-S shares them as one PEN between
       the source and the first RCD; TT and IT still need a neutral and a PE but
       the neutral is not earthed downstream. This is what decides the core
       count, and it is a property of the arrangement rather than of the load. */
    neutralEarthedDownstream: false,
    /* How the protective conductor reaches each feeder, declared once for the
       site rather than asked of every circuit.

       A four-core three-phase feeder is ordinary on TN-S — three phases, a
       neutral, and a protective conductor formed separately or alongside. What
       the core count cannot tell you is whether that fourth core is a neutral
       doing its own job or a combined protective and neutral conductor, because
       a four-core cable with a separate PE looks identical on a schedule. The
       question is real and it is one question about the installation, not
       seventy-nine about circuits: answered here, it stops being repeated and
       the audit can flag the circuits that contradict the answer instead. */
    peArrangement: null
  };

  /* Maximum disconnection time in seconds, IEC 60364-41 Table 41.4.
     `final` is a final circuit with additional protection. */
  var DISC_TN = [
    /* rating A */ /* final ≤32 A */ /* other */
    [32, 0.1, 0.5],
    [400, 0.5, 0.5],
    [Infinity, 2.0, 2.0]
  ];
  var DISC_TT = [
    [32, 0.1, 0.1],
    [400, 0.5, 0.5],
    [Infinity, 2.0, 2.0]
  ];
  function maxDisconnectionTime(ratingA, finalCircuit, system) {
    var table = String(system || 'TN-S').indexOf('TT') === 0 ? DISC_TT : DISC_TN;
    var a = D_num(ratingA, 0);
    var row = table[table.length - 1];
    for (var i = 0; i < table.length; i++) if (a <= table[i][0]) { row = table[i]; break; }
    /* A final circuit gets the tighter of its two columns; anything else the
       wider one. For a TT supply the ≤32 A figure only holds with an RCD, so
       without one the row above is used. */
    if (finalCircuit) return row[1];
    return Math.max(row[2], a <= 32 && String(system || '').indexOf('TT') === 0 ? 0.5 : row[2]);
  }

  /* Minimum protective conductor cross-section, copper, BS 7671 Table 54.7 for
     installation methods B1/B2 and the reference methods. The small sizes keep
     a full-size core because there is nothing smaller to go down to in the
     cable itself; above 2.5 mm² the conductor reduces.

     This is the *minimum*. A designer may fit a larger PE, and doing so is the
     normal way to satisfy the loop requirement without increasing the phase
     conductor — so the value is an input, not only a calculation. */
  var PE_MIN_CSA = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400];
  var PE_MIN = [1.5, 2.5, 2.5, 4, 6, 10, 16, 16, 25, 35, 50, 70, 95, 95, 120, 150, 185];
  function peMinCsa(csa) {
    var i = CSA.indexOf(csa);
    if (i < 0) {
      /* not a standard size: take the nearest one below, never above */
      i = 0;
      for (var k = 0; k < CSA.length; k++) if (CSA[k] <= csa) i = k;
    }
    var v = PE_MIN[i];
    /* A lookup table must not be able to hand back nothing. Past the last
       listed size the rule is half the phase conductor, which is what the table
       is doing at the top of its range anyway, snapped down to a size that
       exists. Returning undefined here is what let a whole class of fault hide
       behind an arithmetic fallback three functions away. */
    if (v === undefined) {
      v = CSA.filter(function (x) { return x <= csa / 2; }).pop() || CSA[CSA.length - 1];
    }
    return v;
  }

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
      phases: '3', pf: 0.9,
      /* Tap position as a percentage of nominal, or null while it is undecided.

         It is the transformer's own setting and it exists on the transformer, not
         on the project, because two transformers on one site are very often on
         different taps — which on this project they are, and there is no way to
         know that from anywhere else. Null means nobody has decided yet, which is
         not the same as 0 and must not be read as it. */
      tap: p.tap === undefined || p.tap === null || p.tap === '' ? null : num(p.tap, 0),
      /* Percent impedance, and whether it is KNOWN.

         This is the single most consequential number in the app and it is
         usually a guess. %Z is the drop at rated current, so it sets the fault
         level directly — and the fault level decides the minimum conductor size
         a feeder may use, which device breaking capacity is needed, and whether
         the protection coordination works at all.

         On a real project the default of 6% produced 73 kA, which meant a 16 mm²
         feeder "failed" thermal withstand when the true impedance might be 10%
         and the fault 44 kA, where it passes comfortably. The answer changed
         completely on an assumption nobody had made and nobody could see.

         So a stated impedance is recorded as a fact (impZStated true) and a
         default is recorded as an assumption (impZStated false). The audit says
         which, at the top, before any finding that depends on it. */
      impZ: 6, impZStated: p.impZStated === undefined ? null : !!p.impZStated,
      faultKVA: null, at: 0,
      /* Vector group. Only the part that matters here is modelled: whether the
         LV side is a delta or a star, and whether the winding is earthed. A
         delta on the LV blocks third-harmonic zero-sequence current from
         reaching the neutral, which is the single biggest lever on neutral
         loading in an installation full of switch-mode supplies. Dyn11 and DYn11
         both have an LV delta; Dyn1 and Yyn11 do not. */
      vecGroup: p.vecGroup || 'Dyn11',
      /* Where the star point is brought out and bonded */
      neutralBonded: p.neutralBonded === undefined ? false : !!p.neutralBonded,
      pos: p.pos || { x: 6, y: 12 }, notes: ''
    }, p);
  }
  function newPdb(p) {
    return Object.assign({
      id: uid('pdb'), tag: p.tag || 'PDB', name: p.name || 'Main LV board',
      num: p.num === undefined ? null : p.num,
      ref: p.ref === undefined || p.ref === null ? '' : p.ref,
      txId: p.txId || null, incomerA: num(p.incomerA, 1600), phases: '3', spareWays: 0,
      /* Busbar incomer. Above about 2,500 A a feeder is a busbar rather than a
         cable, and a main board fed straight from a transformer is where that
         happens. Blank means the incomer is cable, which is right for most boards
         and impossible for a large one — so the audit asks rather than assumes.
         busbarIcw is the permitted short-circuit current for busbarIcwT seconds:
         a busbar that carries the load can still be destroyed by the fault it
         exists to survive, and that figure is certified, not calculated. */
      busbarA: p.busbarA === undefined ? null : num(p.busbarA),
      busbarIcw: p.busbarIcw === undefined ? null : num(p.busbarIcw),
      busbarIcwT: p.busbarIcwT === undefined || p.busbarIcwT === null ? null : num(p.busbarIcwT),
      pos: p.pos || { x: 10, y: 12 }, notes: '',
      /* Power factor correction connected at this board. A bank is specified by
         its output and its detuning, because the detuning is not an accessory —
         it decides where the bank's resonance sits relative to the harmonics the
         supply already carries. Blank means no bank, which is a real and common
         answer rather than an omission. */
      capacitors: p.capacitors || [],
      cable: p.cable || { csa: null, cores: 3, len: 0, method: 'XL-A1', group: 1, ambient: 30, sheathed: true }
    }, p);
  }
  function newPdp(p) {
    return Object.assign({
      id: uid('pdp'), tag: p.tag || 'PDP', name: p.name || 'Distribution board',
      num: p.num === undefined ? null : p.num,
      ref: p.ref === undefined || p.ref === null ? '' : p.ref,
      pdbId: p.pdbId || null, incomerA: num(p.incomerA, 400), busbarA: null,
      busbarIcw: p.busbarIcw === undefined ? null : num(p.busbarIcw),
      busbarIcwT: p.busbarIcwT === undefined || p.busbarIcwT === null ? null : num(p.busbarIcwT), phases: '3',
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
  /* ---------------------------------------------------- harmonic spectrums ---
     Total harmonic distortion is not the number that matters for a neutral, and
     treating it as one produces findings that cannot be true.

     A six-pulse drive is a balanced three-phase rectifier. Its characteristic
     harmonics are 6k ± 1 — the 5th, 7th, 11th, 13th — and none of those are
     triplen. Its third harmonic cancels between the phases before it reaches any
     conductor, so a panel of drives loads the cable and does nothing to the
     neutral. It is still a 30-40 % distortion load, which is what heats the
     feeder.

     A single-phase switch-mode supply is the opposite. Its rectifier is between
     phase and neutral, so its third harmonic is in phase with itself and returns
     along the neutral — this is where the triplen in a control panel actually
     comes from, along with LED drivers, electronic ballasts, PLC racks and
     instrumentation.

     `triplen` is the fraction of the declared THD that is third harmonic. Zero
     for a drive, high for a switch-mode supply. The distinction matters: applying
     a general 60% to a drive feeder reported a neutral carrying 159 % of a phase
     conductor, which that waveform cannot produce.

     `note` says what the figure means, because a drive's 35% and a lighting
     supply's 35% are not the same problem and a reader deserves to know which
     one they are looking at. */
  var HARMONIC_SPECTRUMS = {
    drive: {
      name: 'Six-pulse drive (rectifier)',
      /* IEC 60000-2-3 / IEEE 519 typical line-side THD for a 6-pulse converter
         with no input reactor. With a line reactor it falls to roughly half. */
      thd: 35, triplen: 0,
      note: 'A drive is a balanced three-phase rectifier. Its harmonics are 6k ± 1 — the 5th and 7th are ' +
        'the big ones — and none are triplen, so the third harmonic cancels between the phases before it ' +
        'reaches any conductor. A panel of these heats its feeder and loads its cable, but puts nothing ' +
        'into the neutral. An input reactor cuts the distortion roughly in half. A measured figure from the ' +
        'drive is better than this one.'
    },
    drive_reactor: {
      name: 'Drive with input reactor',
      thd: 15, triplen: 0,
      note: 'The reactor is there to cut the harmonics, and it does — roughly halving the total distortion. ' +
        'Still no triplen, so still nothing in the neutral.'
    },
    drive_afe: {
      name: 'Drive with active front end',
      thd: 5, triplen: 2,
      note: 'An active front end regenerates cleanly and distorts very little. What triplen it does produce ' +
        'comes from its own auxiliaries and control supply rather than the main converter.'
    },
    smps_single: {
      name: 'Single-phase switch-mode supply',
      /* the classic: rectified from phase to neutral, so the third harmonic
         returns through the neutral instead of cancelling */
      thd: 40, triplen: 35,
      note: 'A single-phase rectifier between phase and neutral. Its third harmonic is in phase with itself ' +
        'and returns along the neutral, and it is the usual source of neutral current in a control panel. ' +
        'Several hundred watts per supply is a normal figure for a PLC rack or instrumentation.'
    },
    led: {
      name: 'LED driver / electronic ballast',
      thd: 30, triplen: 25,
      note: 'Constant-current LED drivers are single-phase switched-capacitor circuits with a high triplen ' +
        'content. A lighting installation with many of them is a well-known case of an overloaded neutral.'
    },
    ups: {
      name: 'UPS on a three-phase supply',
      thd: 20, triplen: 8,
      note: 'A three-phase UPS is balanced, so most of its distortion is 5th and 7th. Its triplen comes from ' +
        'the bypass and the control circuitry rather than the main inverter.'
    },
    welder: {
      name: 'Welding machine / intermittent load',
      thd: 10, triplen: 0,
      note: 'Mostly a nuisance on voltage and a poor power factor, rather than a harmonic source. Six-pulse ' +
        'converters again, so nothing triplen.'
    },
    measured: {
      name: 'Measured spectrum',
      thd: null, triplen: null,
      note: 'A measured spectrum always overrides anything inferred here. Declare the total and, if it was ' +
        'measured separately, the third-harmonic fraction.'
    }
  };

  /* What fraction of this circuit's declared distortion is third harmonic.
     An explicit declaration wins; otherwise the load type decides; otherwise
     nothing is asserted, because the default that produced the 159% finding was
     a guess applied to a load that has no third harmonic to guess about. */
  function triplenFractionOf(pn) {
    if (pn.triplen !== undefined && pn.triplen !== null && pn.triplen !== '') {
      return Math.max(0, Math.min(100, num(pn.triplen, 0))) / 100;
    }
    var sp = HARMONIC_SPECTRUMS[String(pn.harmonicType || '')];
    if (sp && sp.triplen !== null && sp.triplen !== undefined) return sp.triplen / 100;
    /* An undeclared load type asserts nothing. Returning zero rather than 0.6 is
       deliberate: an unknown three-phase load is more likely to be balanced —
       motors, and balanced rectifiers — than to be a single-phase supply, and
       guessing high puts a false alarm on every board. */
    return 0;
  }

  /* A declared THD and a load type together: the type supplies a default total
     where the user has not measured one, but never overrides a measured figure. */
  function defaultThd(pn) {
    if (pn.thd !== undefined && pn.thd !== null && pn.thd !== '') return num(pn.thd, 0);
    var sp = HARMONIC_SPECTRUMS[String(pn.harmonicType || '')];
    return sp && sp.thd !== null && sp.thd !== undefined ? sp.thd : null;
  }

  /* ------------------------------------------------------- starting methods --
     What each method does to the current a motor draws from the board.

     The current multiple is the locked-rotor current the method actually
     presents, and it is the number that decides whether the upstream device
     survives. The design figures used are the slow end of the published ranges,
     because overshooting a starting current is safe and undershooting it trips a
     board.

     `torque` is the starting torque as a fraction of full-load torque, and it is
     the reason the reduced-current methods exist: star-delta gives a third of the
     current and a third of the torque, which is not enough for a constant-torque
     load and is ample for a fan.

     `accel` is the usual accelerating period, which matters because an upstream
     magnetic device clears in well under a second — so the inrush has to be
     below the upstream pick-up, or below it only briefly, and duration is the
     thing that decides which.

     The curve letter a motor's own device needs follows from the multiple: a
     device whose magnetic pick-up is below the inrush will operate during
     starting, which on a MCB means it trips. */
  var START_METHODS = {
    'DOL': {
      name: 'Direct on line', multiple: 7, torque: 2.5, accel: 4,
      note: '6–8 × full load current, which is the range IEC 60034-1 gives for locked rotor. Highest torque, so the fastest start and the highest inrush.',
      needsCurve: 'D'
    },
    'Star-delta': {
      name: 'Star-delta', multiple: 2.3, torque: 0.85, accel: 12,
      note: 'About a third of the direct-on-line current, because the motor is started in star. The cost is a third of the torque and roughly three times the starting time, so it suits fan and pump loads and will not start a conveyor against a full belt.',
      needsCurve: 'C'
    },
    'Soft starter': {
      name: 'Soft starter', multiple: 3, torque: 1.6, accel: 15,
      note: 'Ramps the voltage, so the current is limited by the ramp setting rather than by the motor. The figure assumes a moderate ramp — set too short and it approaches direct on line.',
      needsCurve: 'C'
    },
    'VFD': {
      name: 'Variable speed drive', multiple: 1.4, torque: 1.5, accel: 40,
      note: 'Frequency-converting, so the motor draws only magnetising current at standstill — there is essentially no inrush. Torque is available up to about 150 % at low speed. The trade is a long acceleration and a drive that has to be rated for the motor.',
      needsCurve: 'B'
    },
    'Static': {
      name: 'Static / SVC starter', multiple: 1.2, torque: 1.1, accel: 10,
      note: 'A switched capacitor or thyristor starter. Very little inrush, and no harmonics — the reason to choose it over a soft starter where both fit.',
      needsCurve: 'B'
    }
  };

  /* Load torque characteristics. Which of these a machine is determines whether a
     reduced-current start can accelerate it at all, and this is the single most
     useful thing to know before choosing one. */
  var LOAD_TORQUES = {
    'constant': {
      name: 'Constant torque (conveyor, hoist, compressor)',
      note: 'Needs the same torque at standstill as at full speed. Star-delta gives only a third of the direct-on-line torque, so it will not start against a full belt unless the drive can be left unloaded first.'
    },
    'variable': {
      name: 'Variable torque (fan, pump, blower)',
      note: 'Torque rises with speed, so almost all of it is available at standstill anyway. This is the load a reduced-current start suits, and the reason fans and pumps are routinely started star-delta.'
    },
    'constantpower': {
      name: 'Constant power (machine tool, test rig)',
      note: 'Torque falls as speed rises, so a low-speed starter has to be rated for more than the running power. Check the drive against the full torque, not the kW.'
    },
    'inertia': {
      name: 'High inertia (fan with long blades, large flywheel)',
      note: 'Starts easily but accelerates slowly, so the inrush lasts far longer than a normal start. This is the case where an upstream device picks up even though the current is not unusual — the duration is the problem, not the peak.'
    }
  };

  /* The common vector groups, for the dropdown. */
  var VECTOR_GROUPS = [
    'Dyn11', 'Dyn1', 'Dyn5', 'Dyn7',
    'Yyn0', 'Yyn6', 'Yyn11', 'Yd11', 'Dz11'
  ];

  /* Whether the vector group has a delta on the LV winding, which is what
     blocks third-harmonic zero-sequence current from reaching the neutral.

     An explicit list rather than parsing the letters. The notation reads
     HV-phase, HV-neutral, LV-phase, LV-neutral, clock — but the four-character
     forms drop a letter, so 'Dz11' has its LV winding at position 1 rather than
     position 2, and any positional rule gets one of the two wrong. Reading the
     character at index 3, which is the first thing this function did, tested the
     clock number against a letter and therefore reported a Dyn11 as a
     star-star — the exact opposite of the answer. */
  var VEC_LV_DELTA = {
    Dyn11: 1, Dyn1: 1, Dyn5: 1, Dyn7: 1, Dyn3: 1, Dyn9: 1,
    Yd11: 1, Dd0: 1, Dd1: 1, Dd11: 1, Dd5: 1
  };
  function blocksTriplen(vecGroup) {
    return !!VEC_LV_DELTA[String(vecGroup || 'Dyn11')];
  }

  /* Whether the star point is brought out and bonded on the LV side. */
  function lvNeutralEarthed(vecGroup) {
    var s = String(vecGroup || 'Dyn11');
    /* four-letter forms end in the LV neutral letter; 'Dz11'-style forms do not
       carry one, so there is nothing to bond on that side */
    return s.length >= 5 ? s[3] === 'n' : false;
  }

  function newDb(p) {
    return Object.assign({
      id: uid('db'), tag: p.tag || 'DB', name: p.name || 'Sub-distribution board',
      num: p.num === undefined ? null : p.num,
      ref: p.ref === undefined || p.ref === null ? '' : p.ref,
      pdpId: p.pdpId || null, incomerA: num(p.incomerA, 125), busbarA: null,
      busbarIcw: p.busbarIcw === undefined ? null : num(p.busbarIcw),
      busbarIcwT: p.busbarIcwT === undefined || p.busbarIcwT === null ? null : num(p.busbarIcwT),
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
      /* Blank rather than DOL. A circuit that is not a motor has no starting
         current, and defaulting to DOL gave every lighting and socket circuit a
         7 x inrush that then appeared on the schedule. Blank means not stated,
         which is the same convention the rest of the model uses: nothing is
         asserted that has not been declared. */
      start: p.start || '',
      /* Set when the load is a rotating machine, or inferred from the panel type
         and the starting method. The starting model is only applied where this
         is true — a motor not declared as one gets no verdict rather than a
         wrong one. */
      isMotor: p.isMotor === undefined ? null : !!p.isMotor,
      /* IEC 60947-4-1 overload relay class — the permitted trip time at 6 × rated
         current. A commercial judgement about how long the machine can be down,
         so it is declared and never inferred. */
      motorClass: p.motorClass === undefined || p.motorClass === null || p.motorClass === ''
        ? null : clamp(num(p.motorClass, 10), 10, 30),
      /* Set when this field came from a machine name rather than from a sheet or a
         question asked. Not a label — the audit refuses to pass an inferred
         starting method off as a decision, because a guess that reads like data
         is worse than a blank that asks. */
      startInferred: p.startInferred === undefined ? false : !!p.startInferred,
      contingency: num(p.contingency, 0),
      /* A fitted but unterminated spare way.

         This is not the same thing as an empty way on a board, and it is not a
         circuit. A spare breaker is installed, rated and tested; what it has not
         got is a cable to anything. So none of the checks that assume a circuit
         terminates somewhere apply to it — there is no conductor to overheat, no
         protective conductor to ask about, no earth fault loop to calculate.

         Without this distinction the audit reported 96 findings against spares on
         a real project, every one of them meaningless: 1.5 mm² of cable "failing"
         a thermal withstand check for a breaker that terminates nothing.

         Blank means not stated, which is not the same as false — a circuit with
         no kW could be a spare or a machine someone has not sized yet, and only
         the engineer knows which. */
      isSpare: p.isSpare === undefined || p.isSpare === null ? null : !!p.isSpare,
      /* Total harmonic distortion, as a percentage of the fundamental. Null
         unless a circuit declares it: assuming harmonic content for every motor
         would derate every cable on the project, and the great majority of
         circuits genuinely have little. */
      thd: p.thd === undefined || p.thd === null || p.thd === '' ? null : clamp(num(p.thd, 0), 0, 100),
      /* The kind of non-linear load, which decides whether its distortion is
         triplen. This is the field that separates a drive — balanced, 5th and
         7th, nothing in the neutral — from a switch-mode control supply —
         single-phase, third harmonic returns through the neutral. */
      harmonicType: p.harmonicType || '',
      /* Third harmonic as a percentage of the fundamental, where it has been
         measured separately. Overrides the load type's implied fraction. */
      triplen: p.triplen === undefined || p.triplen === null || p.triplen === '' ? null : clamp(num(p.triplen, 0), 0, 100),
      /* Whether this circuit's neutral conductor comes back to the board.
         Blank falls back to the core count, which is the usual case: four cores
         to a three-phase circuit carries a neutral, three is three poles. */
      neutral: p.neutral === undefined || p.neutral === null || p.neutral === '' ? null : !!p.neutral,
      /* Phase imbalance on a three-phase circuit, as a percentage of its rating.
         What the neutral carries from an otherwise balanced load, and the one
         thing a TN-S neutral is never allowed to carry at all. */
      imbalance: p.imbalance === undefined || p.imbalance === null || p.imbalance === '' ? null : clamp(num(p.imbalance, 0), 0, 100),
      /* Whether this cable also carries the protective conductor. On TN-S the
         PE and the neutral must be separate conductors, so this says whether
         they share a cable — not whether the PE exists, which it must. */
      peInCable: p.peInCable === undefined || p.peInCable === null || p.peInCable === '' ? null : !!p.peInCable,
      /* Load torque characteristic. Decides whether a reduced-current start can
         accelerate the machine at all, and is the thing to ask the vendor for. */
      loadTorque: p.loadTorque || '',
      /* Set when a circuit is one of several motors that will be started
         together, and the others on this board are too. Two motors inrush at once
         is a different problem from one, and it is invisible per-circuit. */
      simultaneousStart: p.simultaneousStart === undefined ? null : (p.simultaneousStart ? Math.max(1, num(p.simultaneousStart, 2)) : null),
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
  function D_num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }

  function newProt(o) {
    o = o || {};
    var kind = o.kind || 'mccb';
    var isMcb = kind === 'mcb';
    return {
      kind: kind,
      /* Short-time delay, seconds. The deliberate hold that selectivity is made
         of, and blank until somebody sets it — the curve alone cannot express
         it, and inventing a figure here would grade every device on a delay
         nobody chose. Blank means the family envelope applies and the app says
         so when it reports the pair as non-selective. */
      sd: o.sd === undefined || o.sd === null ? null : num(o.sd),
      /* Short-time PICKUP, as a multiple of the long-time setting. This is the
         other half of the same thing and it was a constant, which is how thirteen
         pairs of devices came to be reported as impossible to grade.

         A short-time stage does two separate jobs and they were being done by one
         number. It decides WHERE the deliberate hold starts, and it decides HOW
         LONG it lasts. Only the second is a delay. The first is the current at
         which the device stops following its long-time band and starts holding —
         and on every LS, LSI and electronic unit it is adjustable, 1.1 to 10
         times the setting, precisely so that a board can enter its hold band low
         enough to clear the things below it.

         Held at 2 times by default, which is a reasonable mid-range figure and
         the value everything published so far used. */
      ss: o.ss === undefined || o.ss === null ? null : num(o.ss),
      /* Instantaneous PICKUP, as a multiple of the long-time setting. Fixed on a
         thermal-magnetic device, adjustable on an electronic one over roughly
         0.4 to 10 times, which is the range that lets a unit be set to clear a
         short circuit in tens of milliseconds at currents where its frame is far
         larger than its setting. Blank means the type's own figure applies. */
      ii: o.ii === undefined || o.ii === null ? null : num(o.ii),
      /* frame rating — the largest the device is built for */
      frame: o.frame === undefined || o.frame === null ? null : num(o.frame),
      /* the rating it actually protects at */
      ir: o.ir === undefined || o.ir === null ? null : num(o.ir),
      /* breaking capacity, in kA */
      icu: o.icu === undefined || o.icu === null ? null : num(o.icu),
      /* Let-through: the energy and the peak the device permits before it opens.
         Both come from the manufacturer's published data and neither is derivable
         from a time-current curve — which bounds clearing time but says nothing
         about what got through in the meantime. Blank means not looked up, which
         is the normal state, and the withstand check then stays optimistic. */
      letIt: o.letIt === undefined || o.letIt === null ? null : num(o.letIt),
      letIp: o.letIp === undefined || o.letIp === null ? null : num(o.letIp),
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
    maxDisconnectionTime, peMinCsa, PE_MIN_CSA, PE_MIN, DISC_TN, DISC_TT,
    TRIP_STAGES, tripStages, stageSettings, SHORT_TIME_DELAYS,
    NSX, MICLOGIC_FUNCTIONS, NSX_IR_STEPS, NSX_ISD_STEPS, NSX_II_STEPS, nsxFor, nsxIcu,
    SHORT_TIME_PICKUPS, INSTANT_PICKUPS,
    VECTOR_GROUPS, blocksTriplen, lvNeutralEarthed, VEC_LV_DELTA,
    START_METHODS, LOAD_TORQUES,
    HARMONIC_SPECTRUMS, triplenFractionOf, defaultThd, MOTOR_CLASSES,
    PANEL_TYPES, DEFAULTS, SHAPE, PHASE_COLOR, PHASE_EDGE, phaseColor, phaseEdge,
    DB_SIZES_A, DB_LOAD_MAX_A, DB_LOAD_TYPES,
    MCCB_FRAMES, MCCB_SETTINGS, ICU_KA, TRIP_UNITS,
    MCB_RATINGS, MCB_CURVES, MCB_ICU_KA, MCB_MAX_A, TRIP_CURVES, curveKeyFor,
    newProt, protLabel,
    uid, num, r1, r2, clamp, esc, snapTo, fmtGrid, gridRef, closest,
    newProject, newTx, newPdb, newPdp, newDb, newPanel, sampleProject
  };
})();
