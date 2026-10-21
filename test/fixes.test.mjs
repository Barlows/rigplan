// Automatic repair regression tests. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeCurrents, evaluateDiagram, terminalKind, DEFAULT_SETTINGS } from '../js/core/engine.js';
import { fixForCheck } from '../js/core/fixes.js';
import { templateCampervan } from '../js/data/templates.js';
import { makeNode } from '../js/data/catalog.js';

function withoutNodes(source, ids) {
  const doc = structuredClone(source);
  doc.nodes = doc.nodes.filter((n) => !ids.has(n.id));
  doc.wires = doc.wires.filter((w) => !ids.has(w.from.node) && !ids.has(w.to.node));
  return doc;
}

function finding(doc, id) {
  return evaluateDiagram(doc).checks.find((c) => c.id === id) || null;
}

function applyFix(doc, check) {
  const fix = fixForCheck(check, doc);
  assert.ok(fix, `expected a repair for ${check.id}`);
  const draft = structuredClone(doc);
  const result = fix.run(draft);
  assert.ok(result, `repair for ${check.id} should complete`);
  return { doc: draft, result };
}

function hybridSystem() {
  const system = {
    nodes: [
      makeNode('battery-lifepo4', 100, 200, { id: 'bat', props: { hasBMS: true, supplyA: 100, capacityAh: 100 } }),
      makeNode('class-t-fuse', 250, 200, { id: 'fuse', props: { ratingA: 400 } }),
      makeNode('hybrid-inverter', 400, 200, { id: 'hybrid', props: { watts: 3000, efficiency: 0.93, chargeA: 50 } }),
      makeNode('solar-panel', 100, 450, { id: 'panel', props: { watts: 200 } }),
      makeNode('chassis-ground', 100, 350, { id: 'gnd' }),
    ],
    wires: [
      { id: 'bat-fuse', from: { node: 'bat', terminal: 'pos' }, to: { node: 'fuse', terminal: 'in' }, lengthM: 0.5 },
      { id: 'fuse-hybrid', from: { node: 'fuse', terminal: 'out' }, to: { node: 'hybrid', terminal: 'pos' }, lengthM: 1 },
      { id: 'bat-hybridneg', from: { node: 'bat', terminal: 'neg' }, to: { node: 'hybrid', terminal: 'neg' }, lengthM: 1 },
      { id: 'hybrid-pvpos', from: { node: 'panel', terminal: 'pvpos' }, to: { node: 'hybrid', terminal: 'pvpos' }, lengthM: 2 },
      { id: 'hybrid-pvneg', from: { node: 'panel', terminal: 'pvneg' }, to: { node: 'hybrid', terminal: 'pvneg' }, lengthM: 2 },
      { id: 'bat-gnd', from: { node: 'bat', terminal: 'neg' }, to: { node: 'gnd', terminal: 'gnd' }, lengthM: 0.5 },
    ],
    settings: { ...DEFAULT_SETTINGS },
  };
  return system;
}

test('the battery isolator repair inserts a switch in the positive feed', () => {
  const original = templateCampervan();
  const isolator = original.nodes.find((n) => n.type === 'main-switch');
  const mainFuse = original.nodes.find((n) => n.type === 'class-t-fuse');
  const fuseBox = original.nodes.find((n) => n.type === 'fuse-box');
  const inverter = original.nodes.find((n) => n.type === 'inverter');
  const broken = withoutNodes(original, new Set([isolator.id]));
  // Put the downstream distribution back on the fuse output, as it would be
  // in a van that was drawn without an isolator in the first place.
  broken.wires.push({
    id: 'w_test_fuse_to_box',
    from: { node: mainFuse.id, terminal: 'out' },
    to: { node: fuseBox.id, terminal: 'inpos' },
    lengthM: 1.2,
  });
  const check = finding(broken, 'no-isolator');
  assert.ok(check, 'fixture should be missing its isolator');

  const { doc, result } = applyFix(broken, check);
  assert.equal(finding(doc, 'no-isolator'), null);
  const inserted = doc.nodes.find((n) => n.id === result.selectNodeId);
  assert.equal(inserted.type, 'main-switch');
  for (const downstream of [fuseBox, inverter]) {
    assert.ok(doc.wires.some((w) => (
      (w.from.node === inserted.id || w.to.node === inserted.id)
      && (w.from.node === downstream.id || w.to.node === downstream.id)
    )), `${downstream.label} should be fed through the new isolator`);
  }
});

test('the battery fuse repair protects the main positive terminal', () => {
  const original = templateCampervan();
  const mainFuse = original.nodes.find((n) => n.type === 'class-t-fuse');
  const broken = withoutNodes(original, new Set([mainFuse.id]));
  const check = finding(broken, 'battery-unfused');
  assert.ok(check, 'fixture should have an unprotected battery');

  const { doc } = applyFix(broken, check);
  assert.equal(finding(doc, 'battery-unfused'), null);
  assert.equal(finding(doc, 'class-t'), null, 'a Class-T fuse also resolves the high-current warning');
});

test('the shore RCD repair puts an RCBO in the shore line', () => {
  const original = templateCampervan();
  const rcbo = original.nodes.find((n) => n.type === 'rcbo');
  const broken = withoutNodes(original, new Set([rcbo.id]));
  const shore = broken.nodes.find((n) => n.type === 'shore-inlet');
  const charger = broken.nodes.find((n) => n.type === 'ac-charger');
  broken.wires.push(
    { id: 'w_test_shore_l', from: { node: shore.id, terminal: 'l' }, to: { node: charger.id, terminal: 'l' }, lengthM: 2 },
    { id: 'w_test_shore_n', from: { node: shore.id, terminal: 'n' }, to: { node: charger.id, terminal: 'n' }, lengthM: 2 },
  );
  const check = finding(broken, 'shore-no-rcd');
  assert.ok(check, 'fixture should be missing its RCBO');

  const { doc, result } = applyFix(broken, check);
  assert.equal(finding(doc, 'shore-no-rcd'), null);
  const inserted = doc.nodes.find((n) => n.id === result.selectNodeId);
  assert.equal(inserted.type, 'rcbo');
  assert.ok(doc.wires.some((w) => w.from.node === inserted.id || w.to.node === inserted.id));
});

test('the PV isolator repair keeps the array circuit on the PV polarity', () => {
  const original = templateCampervan();
  const check = finding(original, 'pv-no-isolator');
  assert.ok(check, 'fixture should be missing a PV isolator');

  const { doc, result } = applyFix(original, check);
  assert.equal(finding(doc, 'pv-no-isolator'), null);
  const inserted = doc.nodes.find((n) => n.id === result.selectNodeId);
  assert.equal(inserted.label, 'PV isolator');
  assert.deepEqual(inserted.props.terminalKinds, { in: 'pv+', out: 'pv+' });

  const attached = doc.wires.filter((w) => w.from.node === inserted.id || w.to.node === inserted.id);
  assert.ok(attached.length >= 2, 'isolator should have an input and an output cable');
  for (const wire of attached) {
    const from = doc.nodes.find((n) => n.id === wire.from.node);
    assert.equal(terminalKind(from, wire.from.terminal), 'pv+');
  }
  const panel = doc.nodes.find((n) => n.type === 'solar-panel');
  const mppt = doc.nodes.find((n) => n.type === 'mppt');
  const panelWire = doc.wires.find((w) => (w.from.node === panel.id && w.from.terminal === 'pvpos')
    || (w.to.node === panel.id && w.to.terminal === 'pvpos'));
  assert.equal(panelWire.to.node, inserted.id);
  assert.equal(panelWire.to.terminal, 'in');
  const mpptWire = doc.wires.find((w) => (w.from.node === mppt.id && w.from.terminal === 'pvpos')
    || (w.to.node === mppt.id && w.to.terminal === 'pvpos'));
  assert.equal(mpptWire.to.node, inserted.id);
  assert.equal(mpptWire.to.terminal, 'out');

  const { currents } = computeCurrents(doc);
  const livePv = doc.wires.filter((wire) => {
    const from = doc.nodes.find((n) => n.id === wire.from.node);
    return terminalKind(from, wire.from.terminal).startsWith('pv') && currents.get(wire.id) > 1;
  });
  assert.ok(livePv.length >= 3, 'the array should still carry PV current through the isolator');
});

test('the PV isolator repair also works on a hybrid inverter', () => {
  const original = hybridSystem();
  const check = finding(original, 'pv-no-isolator');
  assert.ok(check, 'hybrid fixture should be missing a PV isolator');
  assert.ok(check.nodeIds.includes('hybrid'));

  const { doc, result } = applyFix(original, check);
  assert.equal(finding(doc, 'pv-no-isolator'), null);
  const inserted = doc.nodes.find((n) => n.id === result.selectNodeId);
  assert.equal(inserted.label, 'PV isolator');
  assert.deepEqual(inserted.props.terminalKinds, { in: 'pv+', out: 'pv+' });

  const { currents } = computeCurrents(doc);
  const livePv = doc.wires.filter((wire) => {
    const from = doc.nodes.find((n) => n.id === wire.from.node);
    return terminalKind(from, wire.from.terminal).startsWith('pv') && currents.get(wire.id) > 1;
  });
  assert.ok(livePv.length >= 3, 'the hybrid PV input still carries current through the isolator');
});

test('hybrid DC repairs size for the larger charge current', () => {
  const original = hybridSystem();
  const hybrid = original.nodes.find((n) => n.id === 'hybrid');
  hybrid.props.watts = 300;
  hybrid.props.chargeA = 200;
  const fuse = original.nodes.find((n) => n.type === 'class-t-fuse');
  const broken = withoutNodes(original, new Set([fuse.id]));
  broken.wires.push({
    id: 'bat-to-hybrid',
    from: { node: 'bat', terminal: 'pos' },
    to: { node: 'hybrid', terminal: 'pos' },
    lengthM: 1,
  });

  const unfused = finding(broken, 'inverter-unfused');
  assert.ok(unfused);
  const { doc: fusedDoc, result: fuseResult } = applyFix(broken, unfused);
  const breaker = fusedDoc.nodes.find((n) => n.id === fuseResult.selectNodeId);
  assert.equal(breaker.type, 'breaker-dc');
  assert.ok(breaker.props.ratingA >= 250, `expected at least 250 A, got ${breaker.props.ratingA}`);

  const unisolated = finding(broken, 'inverter-isolator');
  assert.ok(unisolated);
  const { doc: isolatedDoc, result: isolatorResult } = applyFix(broken, unisolated);
  const isolator = isolatedDoc.nodes.find((n) => n.id === isolatorResult.selectNodeId);
  assert.equal(isolator.type, 'main-switch');
  assert.ok(isolator.props.ratedA >= 250, `expected at least 250 A, got ${isolator.props.ratedA}`);
});

test('the missing ground repair bonds the DC negative and AC earth', () => {
  const original = templateCampervan();
  const ground = original.nodes.find((n) => n.type === 'chassis-ground');
  const broken = withoutNodes(original, new Set([ground.id]));
  const check = finding(broken, 'no-ground');
  assert.ok(check);

  const { doc, result } = applyFix(broken, check);
  assert.equal(finding(doc, 'no-ground'), null);
  const inserted = doc.nodes.find((n) => n.id === result.selectNodeId);
  assert.equal(inserted.type, 'chassis-ground');
  assert.ok(doc.wires.some((w) => w.from.node === inserted.id || w.to.node === inserted.id));
});

test('an unused ground point can be bonded instead of deleted', () => {
  const original = templateCampervan();
  const extra = structuredClone(original);
  const ground = {
    id: 'n_extra_ground', type: 'chassis-ground', label: 'Extra ground',
    x: 1500, y: 1000, w: 110, h: 80, props: { resistanceOhm: 0.1, bonded: true },
    brand: '', model: '', price: 8, notes: '',
  };
  extra.nodes.push(ground);
  const check = finding(extra, 'ground-unused');
  assert.ok(check);

  const { doc } = applyFix(extra, check);
  assert.equal(finding(doc, 'ground-unused'), null);
  assert.ok(doc.wires.some((w) => w.from.node === ground.id || w.to.node === ground.id));
});
