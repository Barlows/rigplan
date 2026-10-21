// Starter diagrams.

import { makeNode } from './catalog.js?v=20261045';
import { emptyProject } from '../core/store.js?v=20261045';
import { DEFAULT_SETTINGS } from '../core/engine.js?v=20261045';

let counter = 0;
const n = (type, x, y, props = {}, label) => {
  counter += 1;
  return makeNode(type, x, y, { id: `n_${counter}_${type}`, props, label });
};

const w = (from, fromT, to, toT, lengthM, extra = {}) => ({
  id: `w_${Math.random().toString(36).slice(2, 9)}`,
  from: { node: from.id, terminal: fromT },
  to: { node: to.id, terminal: toT },
  lengthM,
  ...extra,
});

function doc(name, notes, build, settings = {}) {
  counter = 0;
  const nodes = [];
  const wires = [];
  const add = (node) => { nodes.push(node); return node; };
  const link = (...args) => { wires.push(w(...args)); };
  build(add, link);
  return emptyProject({ name, notes, nodes, wires, settings: { ...DEFAULT_SETTINGS, ...settings } });
}

export function templateCampervan() {
  return doc('Campervan — solar, DC-DC and inverter',
    '12 V system with 200 W solar, alternator charging, 300 Ah lithium and a 2000 W inverter. Replace the example parts with your own.',
    (add, link) => {
      const panel = add(n('solar-panel', 100, 80, { watts: 200, supplyA: 11.1 }));
      const mppt = add(n('mppt', 380, 80, { outputA: 30 }));
      const alt = add(n('alternator', 100, 300, { supplyA: 150 }));
      const dcdc = add(n('dcdc', 380, 300, { outputA: 30 }));
      const battery = add(n('battery-lifepo4', 640, 520, { capacityAh: 300, supplyA: 300, maxChargeA: 100, hasBMS: true }));
      const mainFuse = add(n('class-t-fuse', 480, 560, { ratingA: 300 }));
      const isolator = add(n('main-switch', 900, 560, { ratedA: 275 }));
      const box = add(n('fuse-box', 1080, 520, { ratedA: 100 }));
      const shunt = add(n('shunt', 640, 760, {}));
      const inverter = add(n('inverter', 900, 800, { watts: 2000, hasIsolator: true, hasAcBreaker: true }));
      const acPanel = add(n('ac-panel', 1150, 800, {}));
      const fridge = add(n('fridge', 1450, 140, {}));
      const lights = add(n('lights', 1450, 270, {}));
      const pump = add(n('water-pump', 1450, 400, {}));
      const sockets = add(n('sockets', 1450, 800, {}));
      const hob = add(n('induction-hob', 1450, 600, {}));
      const ground = add(n('chassis-ground', 640, 980, {}));
      const shore = add(n('shore-inlet', 80, 860, {}));
      const rcbo = add(n('rcbo', 300, 860, { ratingA: 16 }));
      const charger = add(n('ac-charger', 520, 860, { outputA: 30 }));

      link(panel, 'pvpos', mppt, 'pvpos', 3);
      link(panel, 'pvneg', mppt, 'pvneg', 3);
      link(mppt, 'batpos', battery, 'pos', 2.5);
      link(mppt, 'batneg', battery, 'neg', 2.5);
      link(alt, 'pos', dcdc, 'inpos', 2);
      link(alt, 'neg', dcdc, 'inneg', 2);
      link(dcdc, 'outpos', battery, 'pos', 3);
      link(dcdc, 'outneg', battery, 'neg', 3);
      link(battery, 'pos', mainFuse, 'in', 0.6);
      link(mainFuse, 'out', isolator, 'in', 0.8);
      link(isolator, 'out', box, 'inpos', 0.9);
      link(battery, 'neg', shunt, 'in', 0.6);
      link(shunt, 'out', box, 'inneg', 1.8);
      link(box, 'o1pos', fridge, 'pos', 5);
      link(box, 'o1neg', fridge, 'neg', 5);
      link(box, 'o2pos', lights, 'pos', 3.5);
      link(box, 'o2neg', lights, 'neg', 3.5);
      link(box, 'o3pos', pump, 'pos', 4);
      link(box, 'o3neg', pump, 'neg', 4);
      link(mainFuse, 'out', inverter, 'pos', 1.5);
      link(inverter, 'neg', battery, 'neg', 1.2);
      link(inverter, 'l', acPanel, 'inl', 0.8);
      link(inverter, 'n', acPanel, 'inn', 0.8);
      link(inverter, 'pe', acPanel, 'inpe', 0.8);
      link(acPanel, 'o1l', sockets, 'l', 6);
      link(acPanel, 'o1n', sockets, 'n', 6);
      link(acPanel, 'o2l', hob, 'l', 3);
      link(acPanel, 'o2n', hob, 'n', 3);
      link(shore, 'l', rcbo, 'inl', 2);
      link(shore, 'n', rcbo, 'inn', 2);
      link(shore, 'pe', ground, 'gnd', 3);
      link(rcbo, 'outl', charger, 'l', 1);
      link(rcbo, 'outn', charger, 'n', 1);
      link(charger, 'outpos', battery, 'pos', 1.5);
      link(charger, 'outneg', battery, 'neg', 1.5);
      link(battery, 'neg', ground, 'gnd', 0.8);
      link(acPanel, 'inpe', ground, 'gnd', 1.5);
    });
}

export function templateSimple() {
  return doc('Simple 12 V DC system',
    'Battery, isolator, fuse box and three circuits. The smallest useful diagram.',
    (add, link) => {
      const battery = add(n('battery-agm', 260, 380, { capacityAh: 110 }));
      const fuse = add(n('fuse', 160, 300, { ratingA: 100, family: 'midi' }));
      const isolator = add(n('main-switch', 460, 380, {}));
      const box = add(n('fuse-box', 700, 360, {}));
      const fridge = add(n('fridge', 1000, 220, {}));
      const lights = add(n('lights', 1000, 360, {}));
      const pump = add(n('water-pump', 1000, 500, {}));
      const ground = add(n('chassis-ground', 260, 620, {}));
      link(battery, 'pos', fuse, 'in', 0.4);
      link(fuse, 'out', isolator, 'in', 0.6);
      link(isolator, 'out', box, 'inpos', 0.8);
      link(battery, 'neg', box, 'inneg', 1.2);
      link(box, 'o1pos', fridge, 'pos', 4);
      link(box, 'o1neg', fridge, 'neg', 4);
      link(box, 'o2pos', lights, 'pos', 3);
      link(box, 'o2neg', lights, 'neg', 3);
      link(box, 'o3pos', pump, 'pos', 3.5);
      link(box, 'o3neg', pump, 'neg', 3.5);
      link(battery, 'neg', ground, 'gnd', 0.5);
    });
}

export function templateSolar() {
  return doc('Solar charging only',
    'Two panels in parallel through an MPPT into a 100 Ah lithium battery.',
    (add, link) => {
      const p1 = add(n('solar-panel', 120, 120, { watts: 200 }));
      const p2 = add(n('solar-panel', 120, 280, { watts: 200 }));
      const bus = add(n('busbar', 380, 200, { ratedA: 100 }));
      const mppt = add(n('mppt', 600, 180, { outputA: 40 }));
      const fuse = add(n('fuse', 820, 240, { ratingA: 50, family: 'midi' }));
      const battery = add(n('battery-lifepo4', 1000, 200, { hasBMS: true }));
      const ground = add(n('chassis-ground', 1000, 400, {}));
      link(p1, 'pvpos', bus, 'in', 2);
      link(p1, 'pvneg', bus, 'o3', 2);
      link(p2, 'pvpos', bus, 'o1', 2);
      link(p2, 'pvneg', bus, 'o2', 2);
      link(bus, 'o1', mppt, 'pvpos', 1.5);
      link(bus, 'o2', mppt, 'pvneg', 1.5);
      link(mppt, 'batpos', fuse, 'in', 1);
      link(fuse, 'out', battery, 'pos', 0.8);
      link(mppt, 'batneg', battery, 'neg', 1);
      link(battery, 'neg', ground, 'gnd', 0.6);
    });
}

export function templateHome48() {
  return doc('48 V home — PV, battery and hybrid inverter',
    'Off-grid 48 V core to BS 7671 / IEC 60364. Two strings of 465 W panels feed a 2-in 1-out combiner, and a 51.2 V 280 Ah battery runs through a Class-T fuse and a 2-pole MCCB into a 5 kW hybrid inverter. Outgoing way 1 is protected by a 30 mA RCBO; way 2 is spare. Lengths and cable sizes are examples — measure your own runs and confirm every rating against the equipment you buy.',
    (add, link) => {
      const p1 = add(n('solar-panel-465', 60, 80, {}, 'PV string 1a'));
      const p2 = add(n('solar-panel-465', 60, 220, {}, 'PV string 1b'));
      const p3 = add(n('solar-panel-465', 60, 380, {}, 'PV string 2a'));
      const p4 = add(n('solar-panel-465', 60, 520, {}, 'PV string 2b'));
      const combiner = add(n('pv-combiner', 330, 180, { stringFuseA: 20, outBreakerA: 32, poles: 2 }, 'PV combiner'));
      const hybrid = add(n('hybrid-inverter', 800, 200, {
        voltage: 51.2, inputV: 51.2, watts: 5000, chargeA: 80,
        maxPvVoc: 450, maxPvA: 20, efficiency: 0.94, acOutA: 22,
      }, '5 kW hybrid inverter'));
      const mainFuse = add(n('class-t-fuse', 700, 480, { voltage: 48, ratingA: 150 }, 'Battery main fuse'));
      const mccb = add(n('mccb-2p', 880, 560, { voltage: 48, ratingA: 125, poles: 2 }, 'Battery MCCB'));
      const battery = add(n('battery-lifepo4-48', 660, 620, {}, '48 V battery'));
      const panel = add(n('ac-panel', 1100, 420, { voltage: 230, ratedA: 32, circuits: 4 }, 'AC consumer unit'));
      const rcbo = add(n('rcbo', 1120, 620, { voltage: 230, ratingA: 32, sensitivity: 30 }, 'Sockets RCBO'));
      const sockets = add(n('sockets', 1400, 620, {}, 'Sockets'));
      const earth = add(n('earth-bar', 760, 900, { bonded: true }, 'Main earth terminal'));

      // String 1: two panels in series, then into fused input 1.
      link(p1, 'pvpos', p2, 'pvneg', 0.8);
      link(p2, 'pvpos', combiner, 'in1pos', 3.2);
      link(p1, 'pvneg', combiner, 'in1neg', 4.1);

      // String 2: same, into fused input 2.
      link(p3, 'pvpos', p4, 'pvneg', 0.8);
      link(p4, 'pvpos', combiner, 'in2pos', 3.2);
      link(p3, 'pvneg', combiner, 'in2neg', 4.1);

      // Combined array into the hybrid MPPT input.
      link(combiner, 'outpos', hybrid, 'pvpos', 4.5);
      link(combiner, 'outneg', hybrid, 'pvneg', 4.5);

      // Battery: positive through the Class-T and the 2-pole MCCB.
      link(battery, 'pos', mainFuse, 'in', 1.2);
      link(mainFuse, 'out', mccb, 'inpos', 1.2);
      link(battery, 'neg', mccb, 'inneg', 1.8);
      link(mccb, 'outpos', hybrid, 'pos', 2.6);
      link(mccb, 'outneg', hybrid, 'neg', 2.6);

      // AC out to the consumer unit, then one protected outgoing way.
      link(hybrid, 'outl', panel, 'inl', 6);
      link(hybrid, 'outn', panel, 'inn', 6);
      link(panel, 'o1l', rcbo, 'inl', 1.5);
      link(panel, 'o1n', rcbo, 'inn', 1.5);
      link(rcbo, 'outl', sockets, 'l', 8);
      link(rcbo, 'outn', sockets, 'n', 8);

      // One earth terminal for the array, DC and AC protective conductors.
      link(combiner, 'gnd', earth, 'g1', 6.5);
      link(battery, 'neg', earth, 'g2', 3.4);
      link(hybrid, 'pe', earth, 'g3', 7.2);
      link(panel, 'inpe', earth, 'g4', 3.6);
      link(sockets, 'pe', earth, 'g5', 6.4);
    },
    { standard: 'iec', tempRating: 90, ambientC: 30, vdTarget: 3, units: 'mm2', method: 'C', groupingCount: 1 });
}

export const TEMPLATES = [
  {
    id: 'home48', name: '48 V home — PV, battery and hybrid inverter',
    blurb: 'UK/EU 48 V off-grid core: two PV strings, a combiner, a 14 kWh battery and AC outgoing ways.',
    build: templateHome48,
  },
  {
    id: 'campervan', name: 'Campervan — solar, DC-DC and inverter',
    blurb: 'A full 12 V system with AC, shore charging and 2000 W inverter.',
    build: templateCampervan,
  },
  {
    id: 'simple', name: 'Simple 12 V DC system',
    blurb: 'Battery, isolator, fuse box and three loads.',
    build: templateSimple,
  },
  {
    id: 'solar', name: 'Solar charging only',
    blurb: 'Two panels, an MPPT and a lithium battery.',
    build: templateSolar,
  },
];
