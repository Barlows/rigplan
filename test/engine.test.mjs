// Engine regression tests. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ampacityFor, deratingFactors, sizeRun, pickFuse, evaluateDiagram,
  computeCurrents, buildBom, DEFAULT_SETTINGS,
} from '../js/core/engine.js';
import { templateCampervan, templateSimple, templateSolar } from '../js/data/templates.js';
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
  assert.equal(result.bom.total, 5196.73);
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
