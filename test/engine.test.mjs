// Engine regression tests. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ampacityFor, deratingFactors, sizeRun, pickFuse, evaluateDiagram,
  computeCurrents, buildBom, DEFAULT_SETTINGS,
} from '../js/core/engine.js';
import { templateCampervan, templateSimple, templateSolar, templateHome48 } from '../js/data/templates.js';
import { recoverOffSheet } from '../js/core/store.js';
import { CATALOG_BY_ID, makeNode } from '../js/data/catalog.js';
import { STANDARDS, FUSE_FAMILIES, METRIC_SIZES } from '../js/data/standards.js';

const doc = (settings = {}) => ({
  nodes: [], wires: [],
  settings: { ...DEFAULT_SETTINGS, ...settings },
});

// ---------------------------------------------------------------------------
test('ampacity tables return published values per standard and rating', () => {
  assert.equal(ampacityFor('abyc', 16, 'mm2', 105), 120);
  assert.equal(ampacityFor('iec', 16, 'mm2', 90), 87);
  assert.equal(ampacityFor('nec', 16, 'mm2', 75), 95);
  assert.equal(ampacityFor('abyc', '6', 'AWG', 105), 120);
  assert.equal(ampacityFor('abyc', 1000, 'mm2', 105), 700, 'falls back to the nearest published size');
});

test('default derivation factors are exactly 1', () => {
  const factors = deratingFactors(doc());
  assert.equal(factors.total, 1);
  assert.equal(factors.ambient, 1);
  assert.equal(factors.grouping, 1);
  assert.equal(factors.method, 1);
});

test('derating stacks ambient, grouping and method', () => {
  const factors = deratingFactors(doc({ standard: 'iec', ambientC: 40, groupingCount: 3, method: 'B1' }));
  assert.equal(factors.ambient, 0.87);
  assert.equal(factors.grouping, 0.7);
  assert.equal(factors.method, 0.85);
  assert.ok(Math.abs(factors.total - 0.87 * 0.7 * 0.85) < 1e-9);
});

// ---------------------------------------------------------------------------
test('continuous factor of 1.25 is applied to the design current', () => {
  const sized = sizeRun(doc(), { currentA: 40, lengthM: 5, voltage: 12 });
  assert.equal(sized.designA, 50);
  assert.equal(sized.currentA, 40);
});

test('12 V, 40 A, 5 m needs 25 mm² for a 3% drop on ABYC', () => {
  const sized = sizeRun(doc(), { currentA: 40, lengthM: 5, voltage: 12 });
  assert.equal(sized.unit, 'mm2');
  assert.equal(sized.size, 25);
  assert.equal(sized.limiting, 'voltage-drop');
  assert.ok(sized.vdPass, 'chosen size must pass voltage drop');
  assert.ok(sized.ampacityPass);
  assert.ok(sized.voltageDropPct <= 3);
});

test('ampacity wins when the run is short', () => {
  const sized = sizeRun(doc(), { currentA: 80, lengthM: 0.5, voltage: 12 });
  assert.ok(sized.ampacityPass);
  assert.equal(sized.limiting, 'ampacity');
});

test('manual override is respected and still reports failures', () => {
  const sized = sizeRun(doc(), { currentA: 40, lengthM: 5, voltage: 12, overrideSize: 6 });
  assert.equal(sized.size, 6);
  assert.equal(sized.limiting, 'manual');
  assert.equal(sized.ampacityPass, true, 'ABYC 105 °C 6 mm² carries 60 A');
  assert.equal(sized.vdPass, false, 'but it drops far more than 3%');
});

test('PV runs are held to the 2.5 mm² minimum', () => {
  const sized = sizeRun(doc(), { currentA: 1, lengthM: 1, voltage: 18, isPv: true });
  assert.ok(sized.area >= 2.5 - 1e-9, `got ${sized.size} mm²`);
});

// ---------------------------------------------------------------------------
test('fuse selection picks the next standard rating in a suitable family', () => {
  const fuse = pickFuse(43.75);
  assert.equal(fuse.ratingA, 50);
  assert.equal(fuse.family, 'midi');

  const small = pickFuse(5);
  assert.equal(small.ratingA, 5);
  assert.equal(small.family, 'blade');

  const big = pickFuse(280);
  assert.ok(big.ratingA >= 280);
  assert.ok(big.ratingA <= 300);
});

test('a forced fuse family is honoured, or returns null when it cannot fit', () => {
  const midi = pickFuse(30, 'midi');
  assert.equal(midi.family, 'midi');
  assert.equal(midi.ratingA, 30);

  assert.equal(pickFuse(1, 'anl'), null, 'ANL has a 30 A minimum design current');
  assert.equal(pickFuse(1000), null, 'above every family');
});

test('every blade fuse stays within its family ceiling', () => {
  for (let amps = 1; amps <= 45; amps += 1) {
    const fuse = pickFuse(amps, 'blade');
    if (fuse) assert.ok(fuse.ratingA <= FUSE_FAMILIES.blade.maxDesignCurrent);
  }
});

// ---------------------------------------------------------------------------
test('campervan template evaluates without critical findings', () => {
  const diagram = templateCampervan();
  assert.equal(diagram.nodes.length, 20);
  assert.equal(diagram.wires.length, 37);

  const result = evaluateDiagram(diagram);
  assert.equal(result.wires.size, 37);

  const critical = result.checks.filter((c) => c.severity === 'critical');
  assert.deepEqual(critical, [], `unexpected critical checks: ${critical.map((c) => c.id).join(', ')}`);

  for (const [id, sized] of result.wires) {
    assert.equal(sized.fuseOverCable, false, `fuse over cable on ${id}`);
    assert.equal(sized.ampacityPass, true, `undersized cable on ${id}`);
  }
});

test('campervan template produces the expected warnings', () => {
  const result = evaluateDiagram(templateCampervan());
  const ids = result.checks.map((c) => c.id);
  assert.ok(ids.includes('mppt-unfused'));
  assert.ok(ids.includes('pv-no-isolator'));
  assert.ok(result.checks.filter((c) => c.severity === 'warning').length >= 2);
});

test('inverter current is calculated from watts, efficiency and voltage', () => {
  const diagram = templateCampervan();
  const { currents } = computeCurrents(diagram);
  const inverter = diagram.nodes.find((n) => n.type === 'inverter');
  const feed = diagram.wires.find((w) => w.to.node === inverter.id && w.to.terminal === 'pos');
  assert.ok(feed, 'inverter DC feed exists');
  const amps = currents.get(feed.id);
  assert.ok(Math.abs(amps - 185.19) < 0.5, `expected about 185.2 A, got ${amps}`);
});

test('bill of materials totals the campervan template', () => {
  const diagram = templateCampervan();
  const result = evaluateDiagram(diagram);
  assert.equal(result.bom.cableTotalM, 88.1);
  assert.equal(result.bom.total, 5190.13);
  assert.ok(result.bom.rows.some((r) => r.kind === 'Cable' && r.name.includes('16 mm²')));
  assert.ok(result.bom.rows.some((r) => r.kind === 'Fuse'));
});

test('simple and solar templates are also free of critical findings', () => {
  for (const build of [templateSimple, templateSolar]) {
    const result = evaluateDiagram(build());
    const critical = result.checks.filter((c) => c.severity === 'critical');
    assert.deepEqual(critical, [], `${build.name}: ${critical.map((c) => c.id).join(', ')}`);
  }
});

// ---------------------------------------------------------------------------
// Targeted safety checks on small hand-built diagrams.
// ---------------------------------------------------------------------------
function miniSystem(extra = {}) {
  const base = doc(extra.settings);
  base.nodes = [
    { id: 'bat', type: 'battery-lifepo4', label: 'Battery', x: 0, y: 0, w: 100, h: 100, props: { voltage: 12.8, supplyA: 300, capacityAh: 100, chemistry: 'LiFePO4', hasBMS: true } },
    { id: 'load', type: 'fridge', label: 'Fridge', x: 300, y: 0, w: 100, h: 100, props: { voltage: 12, drawA: 5 } },
    { id: 'gnd', type: 'chassis-ground', label: 'Ground', x: 0, y: 300, w: 100, h: 80, props: {} },
    ...(extra.nodes || []),
  ];
  base.wires = [...(extra.wires || [])];
  return base;
}

test('a battery without a primary fuse is critical', () => {
  const diagram = miniSystem();
  const result = evaluateDiagram(diagram);
  assert.ok(result.checks.some((c) => c.id === 'battery-unfused' && c.severity === 'critical'));
});

test('a cable joining opposite polarities is reported as a short', () => {
  const diagram = miniSystem({
    wires: [
      { id: 'w1', from: { node: 'bat', terminal: 'pos' }, to: { node: 'load', terminal: 'pos' }, lengthM: 1 },
      { id: 'w2', from: { node: 'bat', terminal: 'neg' }, to: { node: 'load', terminal: 'neg' }, lengthM: 1 },
      { id: 'short', from: { node: 'bat', terminal: 'pos' }, to: { node: 'bat', terminal: 'neg' }, lengthM: 0.1 },
    ],
  });
  const result = evaluateDiagram(diagram);
  assert.ok(result.checks.some((c) => c.id === 'short'));
});

const solarPanel = (id, extra = {}) => ({
  id, type: 'solar-panel', label: `Panel ${id}`, x: 0, y: 0, w: 170, h: 100,
  props: { watts: 200, voc: 22.5, isc: 11.8, voltage: 18, supplyA: 11.1, moduleEfficiency: 21, ...extra },
});
const mpptNode = (id, extra = {}) => ({
  id, type: 'mppt', label: 'MPPT', x: 400, y: 0, w: 165, h: 96,
  props: { voltage: 12.8, outputA: 30, maxPvVoc: 100, maxPvA: 35, ...extra },
});
const combinerNode = (id, extra = {}) => ({
  id, type: 'pv-combiner', label: 'PV combiner', x: 250, y: 0, w: 230, h: 160,
  props: { maxPvVoc: 500, stringFuseA: 20, outBreakerA: 32, hasSpd: true, spdType: 'Type 2', ...extra },
});

test('two panels joined pv+ to pv- are a valid series string', () => {
  const diagram = doc();
  diagram.nodes = [solarPanel('p1'), solarPanel('p2'), mpptNode('mppt')];
  diagram.wires = [
    { id: 'series', from: { node: 'p1', terminal: 'pvpos' }, to: { node: 'p2', terminal: 'pvneg' }, lengthM: 0.5 },
    { id: 'pos', from: { node: 'p2', terminal: 'pvpos' }, to: { node: 'mppt', terminal: 'pvpos' }, lengthM: 2 },
    { id: 'neg', from: { node: 'mppt', terminal: 'pvneg' }, to: { node: 'p1', terminal: 'pvneg' }, lengthM: 2 },
  ];
  const result = evaluateDiagram(diagram);
  assert.equal(result.checks.some((c) => c.id === 'short'), false, 'series link must not be a short');
  for (const id of ['series', 'pos', 'neg']) {
    assert.equal(result.wires.get(id).currentA, 11.8, `${id} carries one string of Isc`);
    assert.equal(result.wires.get(id).voltage, 36, `${id} is sized at the two-panel string voltage`);
    assert.equal(result.wires.get(id).size, 2.5);
  }
});

test('parallel PV branches carry their own Isc and the trunk carries the sum', () => {
  const diagram = doc();
  diagram.nodes = [
    solarPanel('p1'), solarPanel('p2'),
    { id: 'bus', type: 'busbar', label: 'PV combiner', x: 250, y: 0, w: 150, h: 120, props: { ratedA: 100 } },
    mpptNode('mppt'),
  ];
  diagram.wires = [
    { id: 'p1pos', from: { node: 'p1', terminal: 'pvpos' }, to: { node: 'bus', terminal: 'in' }, lengthM: 2 },
    { id: 'p2pos', from: { node: 'p2', terminal: 'pvpos' }, to: { node: 'bus', terminal: 'o1' }, lengthM: 3 },
    { id: 'p1neg', from: { node: 'p1', terminal: 'pvneg' }, to: { node: 'bus', terminal: 'o2' }, lengthM: 2 },
    { id: 'p2neg', from: { node: 'p2', terminal: 'pvneg' }, to: { node: 'bus', terminal: 'o3' }, lengthM: 3 },
    { id: 'trunkpos', from: { node: 'bus', terminal: 'o1' }, to: { node: 'mppt', terminal: 'pvpos' }, lengthM: 2 },
    { id: 'trunkneg', from: { node: 'bus', terminal: 'o2' }, to: { node: 'mppt', terminal: 'pvneg' }, lengthM: 2 },
  ];
  const result = evaluateDiagram(diagram);
  for (const id of ['p1pos', 'p2pos', 'p1neg', 'p2neg']) {
    assert.equal(result.wires.get(id).currentA, 11.8, `${id} carries one panel branch`);
    assert.equal(result.wires.get(id).voltage, 18);
  }
  for (const id of ['trunkpos', 'trunkneg']) {
    assert.equal(result.wires.get(id).currentA, 23.6, `${id} carries both parallel branches`);
    assert.equal(result.wires.get(id).voltage, 18);
  }
});

test('inverter/charger DC input accepts the MPPT output on the battery bus', () => {
  const def = CATALOG_BY_ID['inverter-charger'];
  assert.deepEqual(
    def.terminals.filter((t) => t.id === 'pos' || t.id === 'neg').map((t) => t.label),
    ['DC IN +', 'DC IN −'],
  );

  const diagram = doc();
  diagram.nodes = [
    makeNode('battery-lifepo4', 100, 200, { id: 'bat', props: { hasBMS: true, supplyA: 100, capacityAh: 100 } }),
    makeNode('class-t-fuse', 250, 200, { id: 'fuse', props: { ratingA: 300 } }),
    makeNode('inverter-charger', 400, 200, { id: 'inv', props: { watts: 3000, efficiency: 0.93 } }),
    makeNode('mppt', 400, 400, { id: 'mppt', props: { outputA: 30 } }),
    makeNode('solar-panel', 100, 450, { id: 'panel', props: { watts: 200 } }),
    makeNode('chassis-ground', 100, 350, { id: 'gnd' }),
  ];
  diagram.wires = [
    { id: 'bat-fuse', from: { node: 'bat', terminal: 'pos' }, to: { node: 'fuse', terminal: 'in' }, lengthM: 0.5 },
    { id: 'fuse-inv', from: { node: 'fuse', terminal: 'out' }, to: { node: 'inv', terminal: 'pos' }, lengthM: 1 },
    { id: 'bat-invneg', from: { node: 'bat', terminal: 'neg' }, to: { node: 'inv', terminal: 'neg' }, lengthM: 1 },
    { id: 'mppt-inv', from: { node: 'mppt', terminal: 'batpos' }, to: { node: 'inv', terminal: 'pos' }, lengthM: 0.8 },
    { id: 'mppt-invneg', from: { node: 'mppt', terminal: 'batneg' }, to: { node: 'inv', terminal: 'neg' }, lengthM: 0.8 },
    { id: 'pvpos', from: { node: 'panel', terminal: 'pvpos' }, to: { node: 'mppt', terminal: 'pvpos' }, lengthM: 2 },
    { id: 'pvneg', from: { node: 'panel', terminal: 'pvneg' }, to: { node: 'mppt', terminal: 'pvneg' }, lengthM: 2 },
    { id: 'bat-gnd', from: { node: 'bat', terminal: 'neg' }, to: { node: 'gnd', terminal: 'gnd' }, lengthM: 0.5 },
  ];
  const result = evaluateDiagram(diagram);
  assert.equal(result.wires.get('mppt-inv').currentA, 30, 'MPPT output feeds the inverter/charger DC input');
  assert.ok(result.wires.get('fuse-inv').currentA > 250, 'the battery bus also carries the inverter draw');
  assert.equal(result.checks.some((c) => c.id === 'short'), false);
  assert.deepEqual(result.checks.filter((c) => c.severity === 'critical'), []);
});

test('the 465 W and 450 W panel presets carry their nameplate values', () => {
  const p465 = CATALOG_BY_ID['solar-panel-465'];
  const p450 = CATALOG_BY_ID['solar-panel-450'];
  assert.deepEqual(
    [p465.defaults.watts, p465.defaults.voc, p465.defaults.isc, p465.defaults.voltage, p465.defaults.supplyA, p465.defaults.moduleEfficiency],
    [465, 36.46, 15.88, 31.21, 14.91, 23.3],
  );
  assert.deepEqual(
    [p450.defaults.watts, p450.defaults.voc, p450.defaults.isc, p450.defaults.voltage, p450.defaults.supplyA, p450.defaults.moduleEfficiency],
    [450, 40.25, 14.17, 33.91, 13.27, 22.5],
  );

  const diagram = doc();
  diagram.nodes = [
    makeNode('solar-panel-465', 100, 0, { id: 'p1' }),
    makeNode('solar-panel-465', 300, 0, { id: 'p2' }),
    mpptNode('mppt'),
  ];
  diagram.wires = [
    { id: 'series', from: { node: 'p1', terminal: 'pvpos' }, to: { node: 'p2', terminal: 'pvneg' }, lengthM: 1 },
    { id: 'stringpos', from: { node: 'p2', terminal: 'pvpos' }, to: { node: 'mppt', terminal: 'pvpos' }, lengthM: 2 },
    { id: 'stringneg', from: { node: 'mppt', terminal: 'pvneg' }, to: { node: 'p1', terminal: 'pvneg' }, lengthM: 2 },
  ];
  const result = evaluateDiagram(diagram);
  for (const id of ['series', 'stringpos', 'stringneg']) {
    assert.equal(result.wires.get(id).currentA, 15.88, `${id} carries the 465 W panel Isc`);
    assert.equal(result.wires.get(id).voltage, 62.4, `${id} carries the rounded two-panel Vmp`);
  }
  assert.equal(result.checks.some((c) => c.id === 'short'), false);
});

test('a hybrid inverter accepts a PV array and a battery on one part', () => {
  const def = CATALOG_BY_ID['hybrid-inverter'];
  assert.deepEqual(
    def.terminals.filter((t) => ['pvpos', 'pvneg', 'pos', 'neg'].includes(t.id)).map((t) => t.label),
    ['PV IN +', 'PV IN −', 'BAT +', 'BAT −'],
  );

  const diagram = doc();
  diagram.nodes = [
    makeNode('battery-lifepo4', 100, 200, { id: 'bat', props: { hasBMS: true, supplyA: 100, capacityAh: 100 } }),
    makeNode('class-t-fuse', 250, 200, { id: 'fuse', props: { ratingA: 400 } }),
    makeNode('hybrid-inverter', 400, 200, { id: 'hybrid', props: { watts: 3000, efficiency: 0.93, chargeA: 50 } }),
    makeNode('solar-panel', 100, 450, { id: 'panel', props: { watts: 200 } }),
    makeNode('chassis-ground', 100, 350, { id: 'gnd' }),
  ];
  diagram.wires = [
    { id: 'bat-fuse', from: { node: 'bat', terminal: 'pos' }, to: { node: 'fuse', terminal: 'in' }, lengthM: 0.5 },
    { id: 'fuse-hybrid', from: { node: 'fuse', terminal: 'out' }, to: { node: 'hybrid', terminal: 'pos' }, lengthM: 1 },
    { id: 'bat-hybridneg', from: { node: 'bat', terminal: 'neg' }, to: { node: 'hybrid', terminal: 'neg' }, lengthM: 1 },
    { id: 'hybrid-pvpos', from: { node: 'panel', terminal: 'pvpos' }, to: { node: 'hybrid', terminal: 'pvpos' }, lengthM: 2 },
    { id: 'hybrid-pvneg', from: { node: 'panel', terminal: 'pvneg' }, to: { node: 'hybrid', terminal: 'pvneg' }, lengthM: 2 },
    { id: 'bat-gnd', from: { node: 'bat', terminal: 'neg' }, to: { node: 'gnd', terminal: 'gnd' }, lengthM: 0.5 },
  ];
  const result = evaluateDiagram(diagram);
  const inverterA = 3000 / 0.93 / 12;
  assert.ok(Math.abs(result.wires.get('fuse-hybrid').currentA - inverterA) < 0.01, 'battery feed carries the inverter draw');
  assert.equal(result.wires.get('hybrid-pvpos').currentA, 11.8, 'PV input carries the array current');
  assert.equal(result.wires.get('hybrid-pvpos').voltage, 18, 'PV input uses the array Vmp');
  assert.equal(result.checks.some((c) => c.id === 'mppt-unfused'), false, 'the MPPT is internal');
  assert.ok(result.checks.some((c) => c.id === 'pv-no-isolator' && c.nodeIds.includes('hybrid')));
  assert.equal(result.checks.some((c) => c.id === 'short'), false);
  assert.deepEqual(result.checks.filter((c) => c.severity === 'critical'), []);
});

test('a PV combiner box fuses two strings and feeds a hybrid inverter', () => {
  const def = CATALOG_BY_ID['pv-combiner'];
  assert.ok(def, 'the combiner box is in the catalogue');
  assert.deepEqual(def.roles, ['protection']);
  assert.deepEqual(
    def.terminals.map((t) => t.id),
    ['in1pos', 'in1neg', 'in2pos', 'in2neg', 'outpos', 'outneg', 'gnd'],
  );
  assert.equal(def.terminals.filter((t) => t.kind.startsWith('pv')).length, 6, 'six PV conductors');

  const diagram = doc();
  diagram.nodes = [
    solarPanel('p1'), solarPanel('p2'), solarPanel('p3'), solarPanel('p4'),
    combinerNode('comb'),
    makeNode('hybrid-inverter', 600, 0, { id: 'hybrid', props: { watts: 3000, efficiency: 0.93, chargeA: 50 } }),
    makeNode('battery-lifepo4', 600, 400, { id: 'bat', props: { hasBMS: true, supplyA: 100, capacityAh: 100 } }),
    makeNode('class-t-fuse', 600, 550, { id: 'fuse', props: { ratingA: 400 } }),
    makeNode('chassis-ground', 100, 700, { id: 'gnd' }),
  ];
  diagram.wires = [
    // string A: p1 and p2 in series
    { id: 'a1', from: { node: 'p1', terminal: 'pvpos' }, to: { node: 'p2', terminal: 'pvneg' }, lengthM: 0.5 },
    { id: 'a2', from: { node: 'p2', terminal: 'pvpos' }, to: { node: 'comb', terminal: 'in1pos' }, lengthM: 2 },
    { id: 'a3', from: { node: 'p1', terminal: 'pvneg' }, to: { node: 'comb', terminal: 'in1neg' }, lengthM: 2 },
    // string B: p3 and p4 in series
    { id: 'b1', from: { node: 'p3', terminal: 'pvpos' }, to: { node: 'p4', terminal: 'pvneg' }, lengthM: 0.5 },
    { id: 'b2', from: { node: 'p4', terminal: 'pvpos' }, to: { node: 'comb', terminal: 'in2pos' }, lengthM: 2 },
    { id: 'b3', from: { node: 'p3', terminal: 'pvneg' }, to: { node: 'comb', terminal: 'in2neg' }, lengthM: 2 },
    // combined feed to the hybrid PV input
    { id: 'trunkpos', from: { node: 'comb', terminal: 'outpos' }, to: { node: 'hybrid', terminal: 'pvpos' }, lengthM: 3 },
    { id: 'trunkneg', from: { node: 'comb', terminal: 'outneg' }, to: { node: 'hybrid', terminal: 'pvneg' }, lengthM: 3 },
    // battery, earth and the bonded SPD
    { id: 'bat-fuse', from: { node: 'bat', terminal: 'pos' }, to: { node: 'fuse', terminal: 'in' }, lengthM: 0.5 },
    { id: 'fuse-hybrid', from: { node: 'fuse', terminal: 'out' }, to: { node: 'hybrid', terminal: 'pos' }, lengthM: 1 },
    { id: 'bat-hybridneg', from: { node: 'bat', terminal: 'neg' }, to: { node: 'hybrid', terminal: 'neg' }, lengthM: 1 },
    { id: 'bat-gnd', from: { node: 'bat', terminal: 'neg' }, to: { node: 'gnd', terminal: 'gnd' }, lengthM: 0.5 },
    { id: 'spd', from: { node: 'comb', terminal: 'gnd' }, to: { node: 'gnd', terminal: 'gnd' }, lengthM: 1 },
  ];
  const result = evaluateDiagram(diagram);
  for (const id of ['a2', 'a3', 'b2', 'b3']) {
    assert.equal(result.wires.get(id).currentA, 11.8, `${id} carries one string Isc`);
    assert.equal(result.wires.get(id).voltage, 36, `${id} is sized at the string Vmp`);
  }
  for (const id of ['trunkpos', 'trunkneg']) {
    assert.equal(result.wires.get(id).currentA, 23.6, `${id} carries the combined array`);
  }
  const ids = result.checks.map((c) => c.id);
  assert.equal(ids.includes('pv-string-fuse'), false, 'the combiner fuses the strings');
  assert.equal(ids.includes('pv-no-isolator'), false, 'the combiner output MCB isolates the array');
  assert.equal(ids.includes('pv-combiner-spd'), false, 'the SPD is bonded');
  assert.equal(ids.includes('pv-combiner-current'), false);
  assert.equal(ids.includes('pv-combiner-voltage'), false);
  assert.equal(ids.includes('short'), false);
  assert.deepEqual(result.checks.filter((c) => c.severity === 'critical'), []);
});

test('the PV combiner flags a floating SPD and an undersized output breaker', () => {
  const diagram = doc();
  diagram.nodes = [
    solarPanel('p1'), solarPanel('p2'),
    combinerNode('comb', { outBreakerA: 20 }),
    makeNode('hybrid-inverter', 600, 0, { id: 'hybrid', props: { watts: 3000, efficiency: 0.93, chargeA: 50 } }),
    makeNode('battery-lifepo4', 600, 400, { id: 'bat', props: { hasBMS: true, supplyA: 100, capacityAh: 100 } }),
    makeNode('class-t-fuse', 600, 550, { id: 'fuse', props: { ratingA: 400 } }),
    makeNode('chassis-ground', 100, 700, { id: 'gnd' }),
  ];
  diagram.wires = [
    { id: 'p1pos', from: { node: 'p1', terminal: 'pvpos' }, to: { node: 'comb', terminal: 'in1pos' }, lengthM: 2 },
    { id: 'p1neg', from: { node: 'p1', terminal: 'pvneg' }, to: { node: 'comb', terminal: 'in1neg' }, lengthM: 2 },
    { id: 'p2pos', from: { node: 'p2', terminal: 'pvpos' }, to: { node: 'comb', terminal: 'in2pos' }, lengthM: 2 },
    { id: 'p2neg', from: { node: 'p2', terminal: 'pvneg' }, to: { node: 'comb', terminal: 'in2neg' }, lengthM: 2 },
    { id: 'trunkpos', from: { node: 'comb', terminal: 'outpos' }, to: { node: 'hybrid', terminal: 'pvpos' }, lengthM: 3 },
    { id: 'trunkneg', from: { node: 'comb', terminal: 'outneg' }, to: { node: 'hybrid', terminal: 'pvneg' }, lengthM: 3 },
    { id: 'bat-fuse', from: { node: 'bat', terminal: 'pos' }, to: { node: 'fuse', terminal: 'in' }, lengthM: 0.5 },
    { id: 'fuse-hybrid', from: { node: 'fuse', terminal: 'out' }, to: { node: 'hybrid', terminal: 'pos' }, lengthM: 1 },
    { id: 'bat-hybridneg', from: { node: 'bat', terminal: 'neg' }, to: { node: 'hybrid', terminal: 'neg' }, lengthM: 1 },
    { id: 'bat-gnd', from: { node: 'bat', terminal: 'neg' }, to: { node: 'gnd', terminal: 'gnd' }, lengthM: 0.5 },
  ];
  const result = evaluateDiagram(diagram);
  const ids = result.checks.map((c) => c.id);
  assert.ok(ids.includes('pv-combiner-spd'), 'an unbonded SPD is reported');
  assert.ok(ids.includes('pv-combiner-current'), '2 x 11.8 A exceeds a 20 A breaker');
  assert.equal(ids.includes('pv-combiner-voltage'), false, 'the voltage rating is ample');
});

test('a 2-pole MCCB between the battery and inverter protects and isolates the feed', () => {
  const def = CATALOG_BY_ID['mccb-2p'];
  assert.ok(def, 'the 2-pole MCCB is in the catalogue');
  assert.deepEqual(def.roles, ['protection']);
  assert.equal(def.defaults.poles, 2);
  assert.deepEqual(def.terminals.map((t) => t.id), ['inpos', 'inneg', 'outpos', 'outneg']);
  assert.deepEqual(def.terminals.map((t) => t.kind), ['dc+', 'dc-', 'dc+', 'dc-']);
  assert.equal(CATALOG_BY_ID['pv-combiner'].defaults.poles, 2, 'the combiner output MCB is 2-pole');

  const diagram = doc();
  diagram.nodes = [
    makeNode('battery-lifepo4', 0, 0, { id: 'bat', props: { hasBMS: true, supplyA: 100, capacityAh: 100 } }),
    makeNode('mccb-2p', 320, 0, { id: 'mccb' }),
    makeNode('inverter', 640, 0, { id: 'inv', props: { watts: 2000, efficiency: 0.9, inputV: 12 } }),
    makeNode('chassis-ground', 0, 400, { id: 'gnd' }),
  ];
  diagram.wires = [
    { id: 'w1', from: { node: 'bat', terminal: 'pos' }, to: { node: 'mccb', terminal: 'inpos' }, lengthM: 1 },
    { id: 'w2', from: { node: 'bat', terminal: 'neg' }, to: { node: 'mccb', terminal: 'inneg' }, lengthM: 1 },
    { id: 'w3', from: { node: 'mccb', terminal: 'outpos' }, to: { node: 'inv', terminal: 'pos' }, lengthM: 1 },
    { id: 'w4', from: { node: 'mccb', terminal: 'outneg' }, to: { node: 'inv', terminal: 'neg' }, lengthM: 1 },
    { id: 'w5', from: { node: 'bat', terminal: 'neg' }, to: { node: 'gnd', terminal: 'gnd' }, lengthM: 0.5 },
  ];
  const result = evaluateDiagram(diagram);
  const ids = result.checks.map((c) => c.id);
  assert.equal(ids.includes('battery-unfused'), false, 'the MCCB protects the battery feed');
  assert.equal(ids.includes('inverter-unfused'), false, 'the MCCB protects the inverter feed');
  assert.equal(ids.includes('no-isolator'), false, 'the MCCB isolates the battery');
  assert.equal(ids.includes('inverter-isolator'), false, 'the MCCB isolates the inverter');
  assert.equal(ids.includes('short'), false);
});

test('an unconnected ground point is a note, not a failure', () => {
  const result = evaluateDiagram(miniSystem());
  const ground = result.checks.find((c) => c.id === 'ground-unused');
  assert.ok(ground);
  assert.equal(ground.severity, 'info');
});

test('an empty diagram returns a single informational finding', () => {
  const result = evaluateDiagram(doc());
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].id, 'empty');
});

// ---------------------------------------------------------------------------
test('all metric sizes in the table are ordered and positive', () => {
  assert.deepEqual(METRIC_SIZES, [...METRIC_SIZES].sort((a, b) => a - b));
  for (const size of METRIC_SIZES) assert.ok(size > 0);
});

test('standards share a common shape', () => {
  for (const std of Object.values(STANDARDS)) {
    assert.ok(std.continuousFactor >= 1);
    assert.ok(std.defaultTempRating >= 60);
    assert.ok(Array.isArray(std.methods) && std.methods.length);
    assert.ok(std.ampacity.metric && std.ampacity.awg);
  }
});

// ---------------------------------------------------------------------------
test('off-sheet and non-finite components are pulled back onto the sheet', () => {
  const diagram = {
    nodes: [
      { id: 'a', x: 50000, y: 42000, w: 120, h: 90 },
      { id: 'b', x: -8000, y: NaN, w: 100, h: 80 },
      { id: 'c', x: 900, y: 400, w: 120, h: 90 },
    ],
  };
  assert.equal(recoverOffSheet(diagram), 2);
  for (const node of diagram.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.x >= 40 && node.x + node.w <= 1760);
    assert.ok(node.y >= 40 && node.y + node.h <= 1060);
  }
  assert.deepEqual({ x: diagram.nodes[2].x, y: diagram.nodes[2].y }, { x: 900, y: 400 });
  assert.equal(recoverOffSheet({ nodes: [{ id: 'd', x: 100, y: 100, w: 50, h: 50 }] }), 0);
});

// ---------------------------------------------------------------------------
// 48 V safety pack: DC voltage ratings and battery charge limits.
test('the 48 V home template evaluates without findings', () => {
  const result = evaluateDiagram(templateHome48());
  assert.deepEqual(result.checks, [], 'the reference 48 V design should be clean');
});

test('a device rated below the battery charge voltage is flagged', () => {
  const diagram = templateHome48();
  const fuse = diagram.nodes.find((n) => n.type === 'class-t-fuse');
  fuse.props.dcV = 32;
  const check = evaluateDiagram(diagram).checks.find((c) => c.id === 'dc-voltage-rating');
  assert.ok(check, 'a 32 V DC fuse should not pass on a 58.4 V battery bus');
  assert.match(check.detail, /58\.4/);
  assert.deepEqual(check.nodeIds, [fuse.id]);
});

test('the DC voltage check uses array open-circuit voltage on the PV side', () => {
  const diagram = templateHome48();
  const combiner = diagram.nodes.find((n) => n.type === 'pv-combiner');
  combiner.props.dcV = 60;
  const check = evaluateDiagram(diagram).checks.find((c) => c.id === 'dc-voltage-rating');
  assert.ok(check, 'two 465 W panels in series reach 72.9 V open circuit');
  assert.match(check.detail, /72\.9/);
});

test('a battery-side device is not judged against the PV string voltage', () => {
  const diagram = templateHome48();
  const mccb = diagram.nodes.find((n) => n.type === 'mccb-2p');
  mccb.props.dcV = 60; // above 58.4 V charge, below the 72.9 V array
  assert.deepEqual(evaluateDiagram(diagram).checks, []);
});

test('charge sources above the battery limit are flagged', () => {
  const diagram = templateHome48();
  const battery = diagram.nodes.find((n) => n.type === 'battery-lifepo4-48');
  battery.props.maxChargeA = 50; // the hybrid alone charges at 80 A
  const check = evaluateDiagram(diagram).checks.find((c) => c.id === 'battery-charge-limit');
  assert.ok(check);
  assert.match(check.detail, /80/);
  assert.deepEqual(check.nodeIds, [battery.id]);
});

test('the 48 V battery part declares a charge voltage and a BMS', () => {
  const battery = makeNode('battery-lifepo4-48', 100, 100, {});
  assert.equal(battery.props.voltage, 51.2);
  assert.equal(battery.props.chargeV, 58.4);
  assert.equal(battery.props.hasBMS, true);
  assert.ok(battery.props.maxChargeA > 0);
});
