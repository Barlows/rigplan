// Component library. Every part is defined by its terminals, its electrical
// defaults and an icon key understood by js/ui/symbols.js.

const dcPair = (extra = []) => ([
  { id: 'pos', x: 0.5, y: 0, kind: 'dc+', label: '+' },
  { id: 'neg', x: 0.5, y: 1, kind: 'dc-', label: '−' },
  ...extra,
]);

const acTriple = () => ([
  { id: 'l', x: 0.25, y: 0, kind: 'ac-l', label: 'L' },
  { id: 'n', x: 0.5, y: 0, kind: 'ac-n', label: 'N' },
  { id: 'pe', x: 0.75, y: 0, kind: 'ac-pe', label: 'PE' },
]);

const pvPair = () => ([
  { id: 'pvpos', x: 0.35, y: 1, kind: 'pv+', label: 'PV+' },
  { id: 'pvneg', x: 0.65, y: 1, kind: 'pv-', label: 'PV−' },
]);

export const CATEGORIES = [
  'Sources', 'Charging', 'Distribution', 'Protection', 'Loads', 'Grounding', 'Monitoring', 'Connectors',
];

export const CATALOG = [
  // ---------------------------------------------------------------- sources
  {
    id: 'battery-lifepo4', cat: 'Sources', label: 'LiFePO4 battery', symbol: 'battery', w: 160, h: 90,
    roles: ['source'], price: 620,
    defaults: { voltage: 12.8, capacityAh: 100, supplyA: 100, chemistry: 'LiFePO4', hasBMS: false, maxChargeA: 50 },
    terminals: dcPair(),
  },
  {
    id: 'battery-agm', cat: 'Sources', label: 'AGM battery', symbol: 'battery', w: 160, h: 90,
    roles: ['source'], price: 240,
    defaults: { voltage: 12.0, capacityAh: 100, supplyA: 100, chemistry: 'AGM', hasBMS: true, maxChargeA: 25 },
    terminals: dcPair(),
  },
  {
    id: 'battery-bank', cat: 'Sources', label: 'Battery bank', symbol: 'battery', w: 190, h: 96,
    roles: ['source'], price: 2400,
    defaults: { voltage: 12.8, capacityAh: 400, supplyA: 400, chemistry: 'LiFePO4', hasBMS: true, maxChargeA: 200 },
    terminals: dcPair(),
  },
  {
    id: 'solar-panel', cat: 'Sources', label: 'Solar panel', symbol: 'panel', w: 170, h: 100,
    roles: ['source'], price: 180,
    defaults: {
      watts: 200, voc: 22.5, isc: 11.8, voltage: 18, supplyA: 11.1,
      moduleEfficiency: 21, technology: 'mono',
    },
    terminals: pvPair(),
  },
  {
    id: 'solar-panel-465', cat: 'Sources', label: '465 W solar panel', symbol: 'panel', w: 170, h: 100,
    roles: ['source'], price: 260,
    defaults: {
      watts: 465, voc: 36.46, isc: 15.88, voltage: 31.21, supplyA: 14.91,
      moduleEfficiency: 23.3, technology: 'mono',
    },
    terminals: pvPair(),
  },
  {
    id: 'solar-panel-450', cat: 'Sources', label: '450 W solar panel', symbol: 'panel', w: 170, h: 100,
    roles: ['source'], price: 250,
    defaults: {
      watts: 450, voc: 40.25, isc: 14.17, voltage: 33.91, supplyA: 13.27,
      moduleEfficiency: 22.5, technology: 'mono',
    },
    terminals: pvPair(),
  },
  {
    id: 'alternator', cat: 'Sources', label: 'Alternator', symbol: 'alternator', w: 150, h: 90,
    roles: ['source'], price: 0,
    defaults: { voltage: 14.4, supplyA: 150, smart: false },
    terminals: [{ id: 'pos', x: 1, y: 0.35, kind: 'dc+', label: 'B+' }, { id: 'neg', x: 1, y: 0.7, kind: 'dc-', label: 'B−' }],
  },
  {
    id: 'shore-inlet', cat: 'Sources', label: 'Shore power inlet', symbol: 'shore', w: 150, h: 90,
    roles: ['source'], price: 95,
    defaults: { voltage: 230, supplyA: 16, rcd: false, galvanicIsolator: false },
    terminals: [
      { id: 'l', x: 0.3, y: 1, kind: 'ac-l', label: 'L' },
      { id: 'n', x: 0.55, y: 1, kind: 'ac-n', label: 'N' },
      { id: 'pe', x: 0.8, y: 1, kind: 'ac-pe', label: 'PE' },
    ],
  },
  {
    id: 'generator', cat: 'Sources', label: 'Generator', symbol: 'generator', w: 160, h: 90,
    roles: ['source'], price: 900,
    defaults: { voltage: 230, supplyA: 13, watts: 3000 },
    terminals: acTriple(),
  },

  // --------------------------------------------------------------- charging
  {
    id: 'mppt', cat: 'Charging', label: 'MPPT solar charger', symbol: 'mppt', w: 165, h: 96,
    roles: ['charger'], price: 320,
    defaults: { voltage: 12.8, outputA: 30, maxPvVoc: 100, maxPvA: 35, hasLoadTerminal: false, hasIsolator: false },
    terminals: [
      { id: 'pvpos', x: 0.12, y: 0, kind: 'pv+', label: 'PV IN +' },
      { id: 'pvneg', x: 0.32, y: 0, kind: 'pv-', label: 'PV IN −' },
      { id: 'batpos', x: 0.68, y: 1, kind: 'dc+', label: 'BAT OUT +' },
      { id: 'batneg', x: 0.88, y: 1, kind: 'dc-', label: 'BAT OUT −' },
    ],
  },
  {
    id: 'dcdc', cat: 'Charging', label: 'DC-DC charger', symbol: 'dcdc', w: 165, h: 96,
    roles: ['charger'], price: 260,
    defaults: { voltage: 12.8, outputA: 30, inputV: 12, inputA: 40, isolated: false },
    terminals: [
      { id: 'inpos', x: 0.12, y: 0, kind: 'dc+', label: 'IN+' },
      { id: 'inneg', x: 0.32, y: 0, kind: 'dc-', label: 'IN−' },
      { id: 'outpos', x: 0.68, y: 1, kind: 'dc+', label: 'OUT+' },
      { id: 'outneg', x: 0.88, y: 1, kind: 'dc-', label: 'OUT−' },
    ],
  },
  {
    id: 'ac-charger', cat: 'Charging', label: 'AC battery charger', symbol: 'charger', w: 160, h: 96,
    roles: ['charger'], price: 380,
    defaults: { voltage: 12.8, outputA: 30, inputV: 230, powerFactor: 0.9 },
    terminals: [
      { id: 'l', x: 0.2, y: 0, kind: 'ac-l', label: 'AC IN L' },
      { id: 'n', x: 0.45, y: 0, kind: 'ac-n', label: 'AC IN N' },
      { id: 'pe', x: 0.7, y: 0, kind: 'ac-pe', label: 'AC IN PE' },
      { id: 'outpos', x: 0.5, y: 1, kind: 'dc+', label: 'BAT+' },
      { id: 'outneg', x: 0.8, y: 1, kind: 'dc-', label: 'BAT−' },
    ],
  },
  {
    id: 'inverter', cat: 'Charging', label: 'Inverter', symbol: 'inverter', w: 170, h: 96,
    roles: ['charger'], price: 750,
    defaults: { voltage: 12.8, inputV: 12, watts: 2000, efficiency: 0.9, acOutA: 8.7, hasIsolator: false, hasAcBreaker: false },
    terminals: [
      { id: 'pos', x: 0.25, y: 1, kind: 'dc+', label: 'DC IN +' },
      { id: 'neg', x: 0.5, y: 1, kind: 'dc-', label: 'DC IN −' },
      { id: 'l', x: 0.75, y: 0, kind: 'ac-l', label: 'AC OUT L' },
      { id: 'n', x: 0.85, y: 0, kind: 'ac-n', label: 'AC OUT N' },
      { id: 'pe', x: 0.95, y: 0, kind: 'ac-pe', label: 'AC OUT PE' },
    ],
  },
  {
    id: 'inverter-charger', cat: 'Charging', label: 'Inverter / charger', symbol: 'invertercharger', w: 180, h: 100,
    roles: ['charger'], price: 1450,
    defaults: { voltage: 12.8, inputV: 12, watts: 3000, chargeA: 120, efficiency: 0.93, acOutA: 13, hasIsolator: false, hasAcBreaker: false },
    terminals: [
      { id: 'pos', x: 0.2, y: 1, kind: 'dc+', label: 'DC IN +' },
      { id: 'neg', x: 0.4, y: 1, kind: 'dc-', label: 'DC IN −' },
      { id: 'acl', x: 0.65, y: 0, kind: 'ac-l', label: 'AC in L' },
      { id: 'acn', x: 0.8, y: 0, kind: 'ac-n', label: 'AC in N' },
      { id: 'outl', x: 0.65, y: 1, kind: 'ac-l', label: 'AC out L' },
      { id: 'outn', x: 0.8, y: 1, kind: 'ac-n', label: 'AC out N' },
      { id: 'pe', x: 0.95, y: 1, kind: 'ac-pe', label: 'PE' },
    ],
  },
  {
    id: 'hybrid-inverter', cat: 'Charging', label: 'Hybrid inverter / charger', symbol: 'hybridinverter', w: 200, h: 120,
    roles: ['charger'], price: 2200,
    defaults: {
      voltage: 12.8, inputV: 12, watts: 3000, chargeA: 50,
      maxPvVoc: 450, maxPvA: 20, efficiency: 0.93, acOutA: 13,
      hasIsolator: false, hasAcBreaker: false,
    },
    terminals: [
      { id: 'pvpos', x: 0.12, y: 0, kind: 'pv+', label: 'PV IN +' },
      { id: 'pvneg', x: 0.3, y: 0, kind: 'pv-', label: 'PV IN −' },
      { id: 'acl', x: 0.55, y: 0, kind: 'ac-l', label: 'AC IN L' },
      { id: 'acn', x: 0.72, y: 0, kind: 'ac-n', label: 'AC IN N' },
      { id: 'pos', x: 0.12, y: 1, kind: 'dc+', label: 'BAT +' },
      { id: 'neg', x: 0.3, y: 1, kind: 'dc-', label: 'BAT −' },
      { id: 'outl', x: 0.55, y: 1, kind: 'ac-l', label: 'AC OUT L' },
      { id: 'outn', x: 0.72, y: 1, kind: 'ac-n', label: 'AC OUT N' },
      { id: 'pe', x: 1, y: 0.5, kind: 'ac-pe', label: 'PE' },
    ],
  },

  // ----------------------------------------------------------- distribution
  {
    id: 'fuse-box', cat: 'Distribution', label: 'DC fuse box', symbol: 'fusebox', w: 220, h: 130,
    roles: ['distribution'], price: 85,
    defaults: { voltage: 12, ratedA: 100, circuits: 6, hasNegativeBus: true },
    terminals: [
      { id: 'inpos', x: 0.15, y: 0, kind: 'dc+', label: 'IN+' },
      { id: 'inneg', x: 0.4, y: 0, kind: 'dc-', label: 'IN−' },
      { id: 'o1pos', x: 0.1, y: 1, kind: 'dc+', label: 'OUT 1+' },
      { id: 'o1neg', x: 0.24, y: 1, kind: 'dc-', label: 'OUT 1−' },
      { id: 'o2pos', x: 0.34, y: 1, kind: 'dc+', label: 'OUT 2+' },
      { id: 'o2neg', x: 0.48, y: 1, kind: 'dc-', label: 'OUT 2−' },
      { id: 'o3pos', x: 0.58, y: 1, kind: 'dc+', label: 'OUT 3+' },
      { id: 'o3neg', x: 0.72, y: 1, kind: 'dc-', label: 'OUT 3−' },
      { id: 'o4pos', x: 0.82, y: 1, kind: 'dc+', label: 'OUT 4+' },
      { id: 'o4neg', x: 0.96, y: 1, kind: 'dc-', label: 'OUT 4−' },
    ],
  },
  {
    id: 'busbar', cat: 'Distribution', label: 'Busbar', symbol: 'busbar', w: 180, h: 70,
    roles: ['distribution'], price: 45,
    defaults: { voltage: 12, ratedA: 250, polarity: 'positive' },
    terminals: [
      { id: 'in', x: 0.15, y: 0.5, kind: 'dc+', label: 'IN' },
      { id: 'o1', x: 0.4, y: 0.5, kind: 'dc+', label: 'OUT 1' },
      { id: 'o2', x: 0.6, y: 0.5, kind: 'dc+', label: 'OUT 2' },
      { id: 'o3', x: 0.8, y: 0.5, kind: 'dc+', label: 'OUT 3' },
    ],
  },
  {
    id: 'ac-panel', cat: 'Distribution', label: 'AC distribution panel', symbol: 'acpanel', w: 220, h: 120,
    roles: ['distribution'], price: 140,
    defaults: { voltage: 230, ratedA: 63, circuits: 4 },
    terminals: [
      { id: 'inl', x: 0.15, y: 0, kind: 'ac-l', label: 'IN L' },
      { id: 'inn', x: 0.4, y: 0, kind: 'ac-n', label: 'IN N' },
      { id: 'inpe', x: 0.65, y: 0, kind: 'ac-pe', label: 'PE' },
      { id: 'o1l', x: 0.2, y: 1, kind: 'ac-l', label: 'OUT 1 L' },
      { id: 'o1n', x: 0.4, y: 1, kind: 'ac-n', label: 'OUT 1 N' },
      { id: 'o2l', x: 0.6, y: 1, kind: 'ac-l', label: 'OUT 2 L' },
      { id: 'o2n', x: 0.8, y: 1, kind: 'ac-n', label: 'OUT 2 N' },
    ],
  },
  {
    id: 'main-switch', cat: 'Distribution', label: 'Battery isolator switch', symbol: 'switch', w: 130, h: 80,
    roles: ['protection'], price: 55,
    defaults: { voltage: 12, ratedA: 275, remote: false },
    terminals: [
      { id: 'in', x: 0.2, y: 0.5, kind: 'dc+', label: 'IN' },
      { id: 'out', x: 0.8, y: 0.5, kind: 'dc+', label: 'OUT' },
    ],
  },
  {
    id: 'shunt', cat: 'Monitoring', label: 'Battery shunt', symbol: 'shunt', w: 150, h: 70,
    roles: ['monitor'], price: 130,
    defaults: { voltage: 12, ratedA: 500, hasMonitor: true },
    terminals: [
      { id: 'in', x: 0.15, y: 0.5, kind: 'dc-', label: 'BAT−' },
      { id: 'out', x: 0.85, y: 0.5, kind: 'dc-', label: 'LOAD−' },
    ],
  },

  // ------------------------------------------------------------- protection
  {
    id: 'fuse', cat: 'Protection', label: 'Inline fuse', symbol: 'fuse', w: 120, h: 60,
    roles: ['protection'], price: 12,
    defaults: { voltage: 12, ratingA: 30, family: 'blade', atSource: true },
    terminals: [
      { id: 'in', x: 0.1, y: 0.5, kind: 'dc+', label: 'IN' },
      { id: 'out', x: 0.9, y: 0.5, kind: 'dc+', label: 'OUT' },
    ],
  },
  {
    id: 'class-t-fuse', cat: 'Protection', label: 'Class-T fuse', symbol: 'fuse', w: 130, h: 60,
    roles: ['protection'], price: 48,
    defaults: { voltage: 12, ratingA: 400, family: 'class-t', atSource: true },
    terminals: [
      { id: 'in', x: 0.1, y: 0.5, kind: 'dc+', label: 'IN' },
      { id: 'out', x: 0.9, y: 0.5, kind: 'dc+', label: 'OUT' },
    ],
  },
  {
    id: 'breaker-dc', cat: 'Protection', label: 'DC breaker', symbol: 'breaker', w: 130, h: 60,
    roles: ['protection'], price: 34,
    defaults: { voltage: 12, ratingA: 50, family: 'breaker', curve: 'C', atSource: true },
    terminals: [
      { id: 'in', x: 0.1, y: 0.5, kind: 'dc+', label: 'IN' },
      { id: 'out', x: 0.9, y: 0.5, kind: 'dc+', label: 'OUT' },
    ],
  },
  {
    id: 'rcbo', cat: 'Protection', label: 'RCBO 30 mA', symbol: 'rcd', w: 140, h: 70,
    roles: ['protection'], price: 42,
    defaults: { voltage: 230, ratingA: 16, tripMa: 30, poles: 2, atSource: true },
    terminals: [
      { id: 'inl', x: 0.15, y: 1, kind: 'ac-l', label: 'IN L' },
      { id: 'inn', x: 0.4, y: 1, kind: 'ac-n', label: 'IN N' },
      { id: 'outl', x: 0.6, y: 0, kind: 'ac-l', label: 'OUT L' },
      { id: 'outn', x: 0.85, y: 0, kind: 'ac-n', label: 'OUT N' },
    ],
  },
  {
    id: 'pv-combiner', cat: 'Protection', label: 'PV combiner box (2 in, 1 out)', symbol: 'pvcombiner', w: 230, h: 160,
    roles: ['protection'], price: 180,
    defaults: {
      maxPvVoc: 500, stringFuseA: 20, outBreakerA: 32,
      hasSpd: true, spdType: 'Type 2',
    },
    terminals: [
      { id: 'in1pos', x: 0, y: 0.22, kind: 'pv+', label: 'STRING 1 +' },
      { id: 'in1neg', x: 0, y: 0.4, kind: 'pv-', label: 'STRING 1 −' },
      { id: 'in2pos', x: 0, y: 0.6, kind: 'pv+', label: 'STRING 2 +' },
      { id: 'in2neg', x: 0, y: 0.78, kind: 'pv-', label: 'STRING 2 −' },
      { id: 'outpos', x: 1, y: 0.34, kind: 'pv+', label: 'OUT +' },
      { id: 'outneg', x: 1, y: 0.68, kind: 'pv-', label: 'OUT −' },
      { id: 'gnd', x: 0.6, y: 1, kind: 'gnd', label: 'SPD GND' },
    ],
  },

  // ------------------------------------------------------------------ loads
  {
    id: 'fridge', cat: 'Loads', label: 'Fridge', symbol: 'fridge', w: 120, h: 90,
    roles: ['load'], price: 900,
    defaults: { voltage: 12, drawA: 5, continuous: true, watts: 60 },
    terminals: dcPair(),
  },
  {
    id: 'lights', cat: 'Loads', label: 'Lighting circuit', symbol: 'light', w: 120, h: 80,
    roles: ['load'], price: 60,
    defaults: { voltage: 12, drawA: 2, continuous: true, watts: 24 },
    terminals: dcPair(),
  },
  {
    id: 'water-pump', cat: 'Loads', label: 'Water pump', symbol: 'pump', w: 120, h: 90,
    roles: ['load'], price: 120,
    defaults: { voltage: 12, drawA: 8, continuous: false, watts: 96 },
    terminals: dcPair(),
  },
  {
    id: 'fan', cat: 'Loads', label: 'Vent fan', symbol: 'fan', w: 120, h: 90,
    roles: ['load'], price: 180,
    defaults: { voltage: 12, drawA: 3, continuous: true, watts: 36 },
    terminals: dcPair(),
  },
  {
    id: 'diesel-heater', cat: 'Loads', label: 'Diesel heater', symbol: 'heater', w: 130, h: 90,
    roles: ['load'], price: 350,
    defaults: { voltage: 12, drawA: 10, continuous: true, watts: 120 },
    terminals: dcPair(),
  },
  {
    id: 'induction-hob', cat: 'Loads', label: 'Induction hob', symbol: 'hob', w: 140, h: 90,
    roles: ['load'], price: 320,
    defaults: { voltage: 230, drawA: 7.8, watts: 1800, continuous: false, ac: true },
    terminals: acTriple(),
  },
  {
    id: 'air-fryer', cat: 'Loads', label: 'Air fryer', symbol: 'hob', w: 140, h: 90,
    roles: ['load'], price: 90,
    defaults: { voltage: 230, drawA: 6.5, watts: 1500, continuous: false, ac: true },
    terminals: acTriple(),
  },
  {
    id: 'sockets', cat: 'Loads', label: 'AC sockets', symbol: 'sockets', w: 130, h: 90,
    roles: ['load'], price: 40,
    defaults: { voltage: 230, drawA: 10, watts: 2300, continuous: false, ac: true },
    terminals: acTriple(),
  },
  {
    id: 'water-heater', cat: 'Loads', label: 'Water heater', symbol: 'heater', w: 130, h: 90,
    roles: ['load'], price: 220,
    defaults: { voltage: 230, drawA: 3.5, watts: 800, continuous: true, ac: true },
    terminals: acTriple(),
  },
  {
    id: 'stereo', cat: 'Loads', label: 'Stereo', symbol: 'generic', w: 120, h: 80,
    roles: ['load'], price: 150,
    defaults: { voltage: 12, drawA: 3, continuous: false, watts: 36 },
    terminals: dcPair(),
  },
  {
    id: 'winch', cat: 'Loads', label: 'Winch', symbol: 'generic', w: 130, h: 90,
    roles: ['load'], price: 600,
    defaults: { voltage: 12, drawA: 100, continuous: false, watts: 1200 },
    terminals: dcPair(),
  },

  // -------------------------------------------------------------- grounding
  {
    id: 'chassis-ground', cat: 'Grounding', label: 'Chassis ground point', symbol: 'ground', w: 110, h: 80,
    roles: ['ground'], price: 8,
    defaults: { resistanceOhm: 0.1, bonded: true },
    terminals: [{ id: 'gnd', x: 0.5, y: 0, kind: 'gnd', label: 'GND' }],
  },
  {
    id: 'earth-bar', cat: 'Grounding', label: 'Earth bar', symbol: 'earthbar', w: 170, h: 60,
    roles: ['ground'], price: 25,
    defaults: { bonded: true },
    terminals: [
      { id: 'g1', x: 0.2, y: 0.5, kind: 'gnd', label: '1' },
      { id: 'g2', x: 0.4, y: 0.5, kind: 'gnd', label: '2' },
      { id: 'g3', x: 0.6, y: 0.5, kind: 'gnd', label: '3' },
      { id: 'g4', x: 0.8, y: 0.5, kind: 'gnd', label: '4' },
    ],
  },
  {
    id: 'galvanic-isolator', cat: 'Grounding', label: 'Galvanic isolator', symbol: 'connector', w: 140, h: 70,
    roles: ['protection'], price: 120,
    defaults: { voltage: 230, ratingA: 16 },
    terminals: [
      { id: 'in', x: 0.1, y: 0.5, kind: 'ac-pe', label: 'IN' },
      { id: 'out', x: 0.9, y: 0.5, kind: 'ac-pe', label: 'OUT' },
    ],
  },

  // ------------------------------------------------------------- monitoring
  {
    id: 'battery-monitor', cat: 'Monitoring', label: 'Battery monitor', symbol: 'monitor', w: 150, h: 80,
    roles: ['monitor'], price: 180,
    defaults: { voltage: 12, hasShunt: true },
    terminals: [{ id: 'sig', x: 0.5, y: 1, kind: 'signal', label: 'SIG' }],
  },
  {
    id: 'cerbo', cat: 'Monitoring', label: 'System gateway', symbol: 'monitor', w: 160, h: 80,
    roles: ['monitor'], price: 320,
    defaults: { voltage: 12, protocol: 'VE.Direct / CAN' },
    terminals: [{ id: 'sig', x: 0.5, y: 1, kind: 'signal', label: 'BUS' }],
  },

  // -------------------------------------------------------------- connectors
  {
    id: 'mc4', cat: 'Connectors', label: 'MC4 connector pair', symbol: 'connector', w: 110, h: 55,
    roles: ['connector'], price: 6,
    defaults: { ratingA: 30, voltage: 1000 },
    terminals: [
      { id: 'inp', x: 0.1, y: 0.5, kind: 'pv+', label: 'IN+' },
      { id: 'outp', x: 0.9, y: 0.5, kind: 'pv+', label: 'OUT+' },
    ],
  },
  {
    id: 'anderson', cat: 'Connectors', label: 'Anderson plug', symbol: 'connector', w: 120, h: 55,
    roles: ['connector'], price: 14,
    defaults: { ratingA: 50, voltage: 12 },
    terminals: [
      { id: 'pos', x: 0.3, y: 0.5, kind: 'dc+', label: '+' },
      { id: 'neg', x: 0.7, y: 0.5, kind: 'dc-', label: '−' },
    ],
  },
];

export const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((c) => [c.id, c]));

export const TERMINAL_INDEX = Object.fromEntries(
  CATALOG.map((c) => [c.id, Object.fromEntries(c.terminals.map((t) => [t.id, t]))]),
);

export function makeNode(typeId, x, y, overrides = {}) {
  const def = CATALOG_BY_ID[typeId];
  if (!def) throw new Error(`Unknown component: ${typeId}`);
  return {
    id: overrides.id || `n_${Math.random().toString(36).slice(2, 9)}`,
    type: typeId,
    label: overrides.label || def.label,
    x: Math.round(x),
    y: Math.round(y),
    w: def.w,
    h: def.h,
    props: { ...def.defaults, ...(overrides.props || {}) },
    brand: overrides.brand || '',
    model: overrides.model || '',
    price: overrides.price ?? def.price,
    notes: overrides.notes || '',
  };
}
