// Reference data used by the sizing engine.
//
// Ampacity figures, ambient/grouping derating factors and voltage-drop limits
// are published values from the cited standards. They are facts, not creative
// content; the surrounding implementation is original.
//
//   IEC  : BS 7671 Tables 4D1A, 4B1, 4C1 (Method C, 3 current-carrying conductors)
//   ABYC : E-11 Table VI-A / VI-B
//   NEC  : NFPA 70 Table 310.16 (copper, 30 C ambient)

export const COPPER_RESISTIVITY_20C = 1.724e-8; // ohm metre
export const COPPER_TEMP_COEFF = 0.00393; // per degree C

export const METRIC_SIZES = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];

export const AWG_SIZES = [
  '18', '16', '14', '12', '10', '8', '6', '4', '3', '2', '1',
  '1/0', '2/0', '3/0', '4/0', '250 kcmil', '300 kcmil', '350 kcmil',
];

// mm^2 for each AWG entry above (used for resistance and metric conversion).
export const AWG_AREA = {
  '18': 0.82, '16': 1.31, '14': 2.08, '12': 3.31, '10': 5.26, '8': 8.37,
  '6': 13.3, '4': 21.15, '3': 26.67, '2': 33.62, '1': 42.41, '1/0': 53.49,
  '2/0': 67.43, '3/0': 85.03, '4/0': 107.2, '250 kcmil': 126.7,
  '300 kcmil': 152, '350 kcmil': 177.3,
};

const IEC_AMPACITY = {
  metric: {
    60: { 1: 11, 1.5: 14.5, 2.5: 19.5, 4: 26, 6: 34, 10: 46, 16: 61, 25: 80, 35: 99, 50: 119, 70: 151, 95: 182, 120: 210, 150: 240, 185: 273, 240: 321, 300: 367 },
    75: { 1: 13, 1.5: 17.5, 2.5: 24, 4: 32, 6: 41, 10: 57, 16: 76, 25: 101, 35: 125, 50: 151, 70: 192, 95: 232, 120: 269, 150: 300, 185: 341, 240: 400, 300: 458 },
    90: { 1: 15, 1.5: 20, 2.5: 27, 4: 36, 6: 47, 10: 65, 16: 87, 25: 114, 35: 141, 50: 168, 70: 213, 95: 258, 120: 299, 150: 344, 185: 392, 240: 461, 300: 530 },
    105: { 1: 17, 1.5: 22, 2.5: 30, 4: 40, 6: 52, 10: 71, 16: 96, 25: 126, 35: 156, 50: 186, 70: 236, 95: 286, 120: 331, 150: 381, 185: 434, 240: 510, 300: 587 },
  },
  awg: {
    60: { '18': 5, '16': 10, '14': 15, '12': 20, '10': 30, '8': 40, '6': 55, '4': 70, '2': 95, '1': 110, '1/0': 125, '2/0': 145, '3/0': 165, '4/0': 195 },
    75: { '18': 7, '16': 13, '14': 20, '12': 25, '10': 35, '8': 50, '6': 65, '4': 85, '2': 115, '1': 130, '1/0': 150, '2/0': 175, '3/0': 200, '4/0': 230 },
    90: { '18': 10, '16': 15, '14': 25, '12': 30, '10': 40, '8': 55, '6': 75, '4': 95, '2': 130, '1': 145, '1/0': 170, '2/0': 195, '3/0': 225, '4/0': 260 },
    105: { '18': 12, '16': 18, '14': 28, '12': 35, '10': 45, '8': 65, '6': 85, '4': 110, '2': 145, '1': 170, '1/0': 195, '2/0': 225, '3/0': 260, '4/0': 300 },
  },
};

const ABYC_AMPACITY = {
  metric: {
    60: { 1.5: 15, 2.5: 20, 4: 25, 6: 40, 10: 55, 16: 80, 25: 105, 35: 140, 50: 165, 70: 225, 95: 260, 120: 300, 150: 340, 185: 420, 240: 455, 300: 515 },
    75: { 1.5: 15, 2.5: 20, 4: 25, 6: 40, 10: 65, 16: 95, 25: 125, 35: 170, 50: 195, 70: 265, 95: 310, 120: 360, 150: 405, 185: 505, 240: 545, 300: 620 },
    90: { 1.5: 25, 2.5: 30, 4: 40, 6: 55, 10: 70, 16: 100, 25: 135, 35: 180, 50: 210, 70: 285, 95: 330, 120: 385, 150: 455, 185: 570, 240: 615, 300: 700 },
    105: { 1.5: 25, 2.5: 35, 4: 45, 6: 60, 10: 80, 16: 120, 25: 160, 35: 210, 50: 245, 70: 330, 95: 385, 120: 445, 150: 455, 185: 570, 240: 615, 300: 700 },
  },
  awg: {
    60: { '18': 10, '16': 15, '14': 20, '12': 25, '10': 40, '8': 55, '6': 80, '4': 105, '2': 140, '1': 165, '1/0': 195, '2/0': 225, '3/0': 260, '4/0': 300 },
    75: { '18': 10, '16': 15, '14': 20, '12': 25, '10': 40, '8': 65, '6': 95, '4': 125, '2': 170, '1': 195, '1/0': 230, '2/0': 265, '3/0': 310, '4/0': 360 },
    90: { '18': 20, '16': 25, '14': 30, '12': 40, '10': 55, '8': 70, '6': 100, '4': 135, '2': 180, '1': 210, '1/0': 245, '2/0': 285, '3/0': 330, '4/0': 385 },
    105: { '18': 20, '16': 25, '14': 35, '12': 45, '10': 60, '8': 80, '6': 120, '4': 160, '2': 210, '1': 245, '1/0': 285, '2/0': 330, '3/0': 385, '4/0': 445 },
  },
};

export const STANDARDS = {
  iec: {
    id: 'iec',
    label: 'BS 7671 / IEC 60364',
    short: 'IEC',
    ampacity: IEC_AMPACITY,
    defaultTempRating: 90,
    defaultAmbientC: 30,
    ambient: [
      { tempC: 25, factor: 1.03 }, { tempC: 30, factor: 1 }, { tempC: 35, factor: 0.94 },
      { tempC: 40, factor: 0.87 }, { tempC: 45, factor: 0.79 }, { tempC: 50, factor: 0.71 },
      { tempC: 55, factor: 0.61 }, { tempC: 60, factor: 0.5 },
    ],
    grouping: [
      { count: 1, factor: 1 }, { count: 2, factor: 0.8 }, { count: 3, factor: 0.7 },
      { count: 4, factor: 0.65 }, { count: 5, factor: 0.6 }, { count: 6, factor: 0.57 },
      { count: 7, factor: 0.54 }, { count: 8, factor: 0.52 }, { count: 9, factor: 0.5 },
      { count: 10, factor: 0.48 },
    ],
    methods: [
      { id: 'C', label: 'Method C — clipped direct', factor: 1 },
      { id: 'B1', label: 'Method B1 — conduit on a surface', factor: 0.85 },
      { id: 'A1', label: 'Method A1 — in an insulated wall', factor: 0.77 },
      { id: 'D', label: 'Method D — buried in ground', factor: 0.72 },
    ],
    defaultMethod: 'C',
    vdTargets: [
      { value: 3, label: '3% — lighting, electronics, critical loads' },
      { value: 5, label: '5% — other circuits' },
    ],
    defaultVd: 3,
    continuousFactor: 1.25,
    continuousCitation: 'BS 7671 §523.7',
    minDcSize: 1,
    minPvSize: 2.5,
    ambientCitation: 'BS 7671 Table 4B1',
    groupingCitation: 'BS 7671 Table 4C1',
    ampacityCitation: 'BS 7671 Table 4D1A',
    vdCitation: 'BS 7671 Appendix 4',
    offersBundling: true,
    bundling: 'circuits',
  },
  abyc: {
    id: 'abyc',
    label: 'ABYC E-11',
    short: 'ABYC',
    ampacity: ABYC_AMPACITY,
    defaultTempRating: 105,
    defaultAmbientC: 30,
    ambient: [
      { tempC: 30, factor: 1 }, { tempC: 40, factor: 0.91 }, { tempC: 50, factor: 0.82 },
      { tempC: 60, factor: 0.71 }, { tempC: 70, factor: 0.58 }, { tempC: 80, factor: 0.41 },
    ],
    grouping: [
      { count: 1, factor: 1 }, { count: 2, factor: 0.8 }, { count: 3, factor: 0.7 },
      { count: 4, factor: 0.6 },
    ],
    methods: [{ id: 'single', label: 'Single cable, outside engine space', factor: 1 }],
    defaultMethod: 'single',
    vdTargets: [
      { value: 3, label: '3% — critical: panel feeds, electronics, navigation' },
      { value: 10, label: '10% — non-critical: cabin lights, pumps' },
    ],
    defaultVd: 3,
    continuousFactor: 1.25,
    continuousCitation: 'ABYC E-11 §11.5',
    minDcSize: 1,
    minPvSize: 2.5,
    ambientCitation: 'ABYC E-11 Table VI-B',
    groupingCitation: 'ABYC E-11 §11.6 (bundling)',
    ampacityCitation: 'ABYC E-11 Table VI-A',
    vdCitation: 'ABYC E-11 §11.4',
    offersBundling: false,
    bundling: 'conductors',
    bundlingNote: 'ABYC rates a cable run singly. Bundled with other circuits for more than 24 in, apply ×0.70 for up to three current-carrying conductors and ×0.60 for four to six.',
  },
  nec: {
    id: 'nec',
    label: 'NEC (NFPA 70)',
    short: 'NEC',
    ampacity: {
      awg: ABYC_AMPACITY.awg,
      metric: ABYC_AMPACITY.metric,
    },
    defaultTempRating: 75,
    defaultAmbientC: 30,
    ambient: [
      { tempC: 25, factor: 1.04 }, { tempC: 30, factor: 1 }, { tempC: 35, factor: 0.94 },
      { tempC: 40, factor: 0.88 }, { tempC: 45, factor: 0.82 }, { tempC: 50, factor: 0.75 },
      { tempC: 55, factor: 0.67 }, { tempC: 60, factor: 0.58 },
    ],
    grouping: [
      { count: 1, factor: 1 }, { count: 2, factor: 0.8 }, { count: 3, factor: 0.7 },
      { count: 4, factor: 0.6 },
    ],
    methods: [{ id: 'freeair', label: 'Single conductor in free air', factor: 1 }],
    defaultMethod: 'freeair',
    vdTargets: [
      { value: 3, label: '3% — branch circuit' },
      { value: 5, label: '5% — feeder plus branch' },
    ],
    defaultVd: 3,
    continuousFactor: 1.25,
    continuousCitation: 'NEC 210.19(A)',
    minDcSize: 1,
    minPvSize: 2.5,
    ambientCitation: 'NEC 310.15(B)(2)(a)',
    groupingCitation: 'NEC 310.15(C)(1)',
    ampacityCitation: 'NEC Table 310.16',
    vdCitation: 'NEC 210.19(A) Informational Note No. 4',
    offersBundling: true,
    bundling: 'conductors',
  },
};

export const TEMP_RATINGS = [
  { value: 60, label: '60 °C — basic PVC', description: 'The most conservative column.' },
  { value: 75, label: '75 °C — heat-resistant PVC', description: 'THW / THWN and most general-purpose cable.' },
  { value: 90, label: '90 °C — XLPE / EPR', description: 'THHN, XHHW and tri-rated panel wire.' },
  { value: 105, label: '105 °C — marine boat cable', description: 'UL 1426 tinned boat cable or silicone.' },
];

export const FUSE_FAMILIES = {
  blade: { id: 'blade', label: 'ATC/ATO blade fuse', maxDesignCurrent: 40, note: 'Branch circuits up to 40 A.' },
  midi: { id: 'midi', label: 'MIDI fuse', minDesignCurrent: 20, maxDesignCurrent: 150, note: 'Compact bolt-down; DC-DC chargers and sub-panels.' },
  anl: { id: 'anl', label: 'ANL fuse', minDesignCurrent: 30, maxDesignCurrent: 400, note: 'High-current DC circuits.' },
  mega: { id: 'mega', label: 'MEGA fuse', minDesignCurrent: 80, note: 'Battery mains and inverter feeds.' },
  'class-t': { id: 'class-t', label: 'Class-T fuse', minDesignCurrent: 80, note: '20 kA+ interrupt rating for lithium banks.' },
  mbrf: { id: 'mbrf', label: 'MRBF terminal fuse', maxDesignCurrent: 300, note: 'Mounts directly on the battery post.' },
  breaker: { id: 'breaker', label: 'DC circuit breaker', maxDesignCurrent: 300, note: 'Resettable thermal breaker.' },
  rcbo: { id: 'rcbo', label: 'RCBO / RCD', maxDesignCurrent: 63, note: 'AC residual-current protection.' },
};

export const FUSE_RATINGS = [
  1, 2, 3, 4, 5, 7.5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 75, 80,
  90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 325, 350, 400, 450, 500, 600,
];

export const TERMINAL_KINDS = {
  'dc+': { label: 'DC +', color: '#c2413b' },
  'dc-': { label: 'DC −', color: '#1f2937' },
  'ac-l': { label: 'AC L', color: '#8a5a2b' },
  'ac-n': { label: 'AC N', color: '#2b5f8a' },
  'ac-pe': { label: 'AC PE', color: '#2f7d4f' },
  'pv+': { label: 'PV +', color: '#c2413b' },
  'pv-': { label: 'PV −', color: '#1f2937' },
  gnd: { label: 'Ground', color: '#2f7d4f' },
  signal: { label: 'Signal', color: '#6b7280' },
};

export const WIRE_COLORS = {
  'dc+': '#c2413b',
  'dc-': '#1f2937',
  'ac-l': '#8a5a2b',
  'ac-n': '#2b5f8a',
  'ac-pe': '#2f7d4f',
  'pv+': '#c2413b',
  'pv-': '#1f2937',
  gnd: '#2f7d4f',
  signal: '#6b7280',
};

export function metricArea(size, unit) {
  if (unit === 'AWG') return AWG_AREA[String(size)] ?? null;
  return Number(size);
}

export function formatSize(size, unit) {
  if (size == null) return '—';
  if (unit === 'AWG') return `${size} AWG`;
  const n = Number(size);
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')} mm²`;
}

export function resistancePerMetre(areaMm2, conductorTempC = 20) {
  const tempFactor = 1 + COPPER_TEMP_COEFF * (conductorTempC - 20);
  return (COPPER_RESISTIVITY_20C * tempFactor * 1e6) / areaMm2;
}
