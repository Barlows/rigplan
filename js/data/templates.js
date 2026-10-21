// Starter diagrams.

import { makeNode } from './catalog.js?v=20261043';
import { emptyProject } from '../core/store.js?v=20261043';
import { DEFAULT_SETTINGS } from '../core/engine.js?v=20261043';

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

function doc(name, notes, build) {
  counter = 0;
  const nodes = [];
  const wires = [];
  const add = (node) => { nodes.push(node); return node; };
  const link = (...args) => { wires.push(w(...args)); };
  build(add, link);
  return emptyProject({ name, notes, nodes, wires, settings: { ...DEFAULT_SETTINGS } });
}

export function templateCampervan() {
  return doc('Campervan — solar, DC-DC and inverter',
    '12 V system with 200 W solar, alternator charging, 300 Ah lithium and a 2000 W inverter. Replace the example parts with your own.',
    (add, link) => {
      const panel = add(n('solar-panel', 100, 80, { watts: 200, supplyA: 11.1 }));
      const mppt = add(n('mppt', 380, 80, { outputA: 30 }));
      const alt = add(n('alternator', 100, 300, { supplyA: 150 }));
      const dcdc = add(n('dcdc', 380, 300, { outputA: 30 }));
      const battery = add(n('battery-lifepo4', 640, 520, { capacityAh: 300, supplyA: 300, hasBMS: true }));
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

export const TEMPLATES = [
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
