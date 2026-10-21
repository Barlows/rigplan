// Sizing, validation and bill-of-materials engine.
//
// The engine is deliberately explicit: every suggestion carries the rule that
// produced it, so a user can check the arithmetic instead of trusting a number.

import {
  STANDARDS, FUSE_FAMILIES, FUSE_RATINGS, METRIC_SIZES, AWG_SIZES, AWG_AREA,
  TERMINAL_KINDS, resistancePerMetre, metricArea, formatSize,
} from '../data/standards.js';
import { CATALOG_BY_ID } from '../data/catalog.js';

export const DEFAULT_SETTINGS = {
  standard: 'abyc',
  tempRating: 105,
  ambientC: 30,
  vdTarget: 3,
  units: 'mm2',
  method: 'single',
  groupingCount: 1,
  currency: 'GBP',
  labourRate: 65,
};

export const SEVERITY = { critical: 3, warning: 2, info: 1 };

function standardOf(diagram) {
  return STANDARDS[diagram.settings?.standard] || STANDARDS.abyc;
}

export function ampacityFor(standardId, size, unit, tempRating) {
  const std = STANDARDS[standardId] || STANDARDS.abyc;
  const key = unit === 'AWG' ? 'awg' : 'metric';
  const table = std.ampacity[key];
  if (!table) return null;
  const column = table[tempRating] || table[std.defaultTempRating] || table[90];
  const value = column?.[size];
  if (value != null) return value;
  // Nearest published size at or below the requested size.
  const keys = Object.keys(column || {})
    .map((k) => ({ k, area: metricArea(k, unit) }))
    .filter((x) => x.area != null)
    .sort((a, b) => a.area - b.area);
  const area = metricArea(size, unit);
  let best = null;
  for (const entry of keys) if (entry.area <= area + 1e-6) best = entry;
  return best ? column[best.k] : null;
}

function factorAt(table, value, key) {
  if (!table?.length) return 1;
  let factor = table[0].factor;
  for (const row of table) if (row[key] <= value) factor = row.factor;
  return factor;
}

export function deratingFactors(diagram) {
  const std = standardOf(diagram);
  const s = { ...DEFAULT_SETTINGS, ...diagram.settings };
  const ambient = factorAt(std.ambient, s.ambientC, 'tempC');
  const grouping = factorAt(std.grouping, s.groupingCount, 'count');
  const method = std.methods.find((m) => m.id === s.method)?.factor ?? 1;
  return { ambient, grouping, method, total: ambient * grouping * method };
}

export function sizeOptions(unit) {
  return unit === 'AWG' ? AWG_SIZES : METRIC_SIZES;
}

/** Suggest a cable for one run. Returns the complete reasoning. */
export function sizeRun(diagram, params) {
  const std = standardOf(diagram);
  const s = { ...DEFAULT_SETTINGS, ...diagram.settings };
  const {
    currentA, lengthM, isPv = false, isAc = false, voltage,
    unit = s.units, overrideSize = null, overrideUnit = null, minAmpacity = 0,
  } = params;

  const runUnit = overrideUnit || unit;
  const designA = Math.max(0.1, currentA) * (params.continuous === false ? 1 : std.continuousFactor);
  const requiredA = Math.max(designA, minAmpacity);
  const derate = deratingFactors(diagram);
  const options = sizeOptions(runUnit).filter((sz) => (metricArea(sz, runUnit) || 0) >= (isPv ? std.minPvSize : std.minDcSize) - 1e-9);
  const targetPct = params.vdTarget ?? s.vdTarget;
  const vdLimit = (targetPct / 100) * (voltage || 12);
  const conductorTemp = Math.min(s.tempRating, 90);
  const assumptions = [];

  if (isPv) assumptions.push(`PV cable has a ${std.minPvSize} mm² minimum.`);
  assumptions.push(`${std.continuousCitation}: continuous load ×${std.continuousFactor}.`);
  const methodId = std.methods.find((m) => m.id === s.method)?.id;
  const methodNote = methodId ? `, method ${methodId}` : '';
  assumptions.push(`Ampacity from ${std.ampacityCitation}, derated ×${derate.total.toFixed(2)} (${s.ambientC} °C ambient, ${s.groupingCount} circuit(s)${methodNote}).`);

  const evaluate = (size) => {
    const area = metricArea(size, runUnit);
    const base = ampacityFor(std.id, size, runUnit, s.tempRating);
    const ampacity = base == null ? null : base * derate.total;
    const r = resistancePerMetre(area, conductorTemp);
    const vd = 2 * Math.max(0.1, currentA) * (lengthM || 0) * r;
    const vdPct = (vd / (voltage || 12)) * 100;
    return {
      size,
      unit: runUnit,
      area,
      baseAmpacity: base,
      ampacity,
      resistancePerMetre: r,
      voltageDropV: vd,
      voltageDropPct: vdPct,
      ampacityPass: ampacity != null && ampacity >= requiredA,
      vdPass: vdPct <= targetPct + 1e-9,
    };
  };

  let candidates = options.map(evaluate);
  if (overrideSize != null) candidates = candidates.filter((c) => String(c.size) === String(overrideSize));
  if (!candidates.length) candidates = options.map(evaluate);

  const byAmpacity = candidates.filter((c) => c.ampacityPass);
  let chosen = byAmpacity.find((c) => c.vdPass) || byAmpacity[0] || candidates[candidates.length - 1];
  let limiting = 'ampacity';
  if (chosen?.vdPass && chosen?.ampacityPass) limiting = chosen.voltageDropPct > targetPct * 0.75 ? 'voltage-drop' : 'ampacity';
  if (chosen && !chosen.vdPass && chosen.ampacityPass) limiting = 'voltage-drop';
  if (chosen && !chosen.ampacityPass) limiting = 'capacity';
  if (overrideSize != null) limiting = 'manual';

  if (chosen && chosen.voltageDropPct > targetPct) {
    assumptions.push(`Voltage drop ${chosen.voltageDropPct.toFixed(1)}% exceeds the ${targetPct}% target at this length — shorten the run or accept the drop.`);
  }

  return {
    designA: round(designA, 2),
    currentA: round(currentA, 2),
    ...chosen,
    targetPct,
    lengthM,
    vdLimitV: round(vdLimit, 3),
    limiting,
    assumptions,
    fuse: null,
  };
}

/** Pick the smallest standard fuse above the design current, within a family. */
export function pickFuse(designA, familyId = null, forcedFamily = null) {
  const families = familyId ? [FUSE_FAMILIES[familyId]] : Object.values(FUSE_FAMILIES).filter((f) => f.id !== 'rcbo');
  for (const family of families) {
    if (!family) continue;
    if (family.minDesignCurrent != null && designA < family.minDesignCurrent) continue;
    if (family.maxDesignCurrent != null && designA > family.maxDesignCurrent) continue;
    if (forcedFamily && family.id !== forcedFamily) continue;
    const rating = FUSE_RATINGS.find((r) => r >= designA - 1e-9 && (family.maxDesignCurrent == null || r <= family.maxDesignCurrent));
    if (rating != null) return { family: family.id, label: family.label, ratingA: rating };
  }
  return null;
}

function round(n, dp = 2) {
  if (n == null || Number.isNaN(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// --------------------------------------------------------------------------
// Graph helpers
// --------------------------------------------------------------------------

export function buildGraph(diagram) {
  const byNode = new Map();
  const wires = diagram.wires || [];
  const nodeById = new Map((diagram.nodes || []).map((n) => [n.id, n]));
  for (const w of wires) {
    if (!nodeById.has(w.from.node) || !nodeById.has(w.to.node)) continue;
    if (!byNode.has(w.from.node)) byNode.set(w.from.node, []);
    if (!byNode.has(w.to.node)) byNode.set(w.to.node, []);
    byNode.get(w.from.node).push({ wire: w, other: w.to.node, end: 'from' });
    byNode.get(w.to.node).push({ wire: w, other: w.from.node, end: 'to' });
  }
  return { byNode, nodeById, wires };
}

export function terminalKind(node, terminalId) {
  const override = node?.props?.terminalKinds?.[terminalId];
  if (override) return override;
  const def = CATALOG_BY_ID[node?.type];
  return def?.terminals.find((t) => t.id === terminalId)?.kind || 'dc+';
}

export function wireKind(diagram, wire) {
  const from = diagram.nodes.find((n) => n.id === wire.from.node);
  if (!from) return 'dc+';
  const to = diagram.nodes.find((n) => n.id === wire.to.node);
  const fromKind = terminalKind(from, wire.from.terminal);
  const toKind = to ? terminalKind(to, wire.to.terminal) : '';
  // A PV run through a generic busbar keeps its PV identity.
  if (fromKind.startsWith('pv') && toKind.startsWith('pv')) return fromKind;
  if (fromKind.startsWith('pv')) return fromKind;
  if (toKind.startsWith('pv')) return toKind;
  return fromKind;
}

export function isAcKind(kind) {
  return kind.startsWith('ac-');
}

function isSourceNode(node) {
  const roles = CATALOG_BY_ID[node.type]?.roles || [];
  return roles.includes('source') || roles.includes('charger');
}

function isBattery(node) {
  return node.type.startsWith('battery');
}

function isSolarPanel(node) {
  return Boolean(node) && (node.type === 'solar-panel'
    || node.type?.startsWith('solar-panel-')
    || CATALOG_BY_ID[node.type]?.symbol === 'panel');
}

function isProtectionNode(node) {
  return (CATALOG_BY_ID[node.type]?.roles || []).includes('protection');
}

/** BFS from a node; stop at the first node matching `stop`. Returns the wire path. */
function pathTo(graph, startId, stop, { skipStart = true } = {}) {
  const queue = [startId];
  const seen = new Set([startId]);
  const prev = new Map();
  while (queue.length) {
    const current = queue.shift();
    if (!skipStart && current !== startId && stop(graph.nodeById.get(current), current)) {
      return unwind(prev, current);
    }
    for (const edge of graph.byNode.get(current) || []) {
      if (seen.has(edge.other)) continue;
      seen.add(edge.other);
      prev.set(edge.other, { from: current, wire: edge.wire });
      const node = graph.nodeById.get(edge.other);
      if (node && stop(node, edge.other)) return unwind(prev, edge.other);
      queue.push(edge.other);
    }
  }
  return null;
}

function unwind(prev, endId) {
  const wires = [];
  const nodes = [endId];
  let cursor = endId;
  while (prev.has(cursor)) {
    const step = prev.get(cursor);
    wires.push(step.wire);
    nodes.push(step.from);
    cursor = step.from;
  }
  return { wires: wires.reverse(), nodes: nodes.reverse(), endId, startId: nodes[nodes.length - 1] };
}

function familyOf(kind) {
  return kind;
}

/**
 * Walk only conductors of one polarity family, so a load's supply is followed
 * along the positive cable and its return along the negative one — never mixed.
 */
function traceFamily(graph, startId, family, stop) {
  const queue = [startId];
  const seen = new Set([startId]);
  const prev = new Map();
  while (queue.length) {
    const current = queue.shift();
    for (const edge of graph.byNode.get(current) || []) {
      const wire = edge.wire;
      const kind = wireFamily(wire, graph);
      if (kind !== family) continue;
      if (seen.has(edge.other)) continue;
      seen.add(edge.other);
      prev.set(edge.other, { from: current, wire });
      const node = graph.nodeById.get(edge.other);
      if (node && stop(node, edge.other)) return unwind(prev, edge.other);
      queue.push(edge.other);
    }
  }
  return null;
}

function wireFamily(wire, graph) {
  const from = graph.nodeById.get(wire.from.node);
  if (!from) return 'dc+';
  const to = graph.nodeById.get(wire.to.node);
  const fromKind = terminalKind(from, wire.from.terminal);
  const toKind = to ? terminalKind(to, wire.to.terminal) : '';
  // A PV conductor sometimes lands on a generic DC terminal (for example a
  // busbar used as a combiner). Keep it in the PV family if either end is PV.
  if (fromKind.startsWith('pv') && toKind.startsWith('pv')) return fromKind;
  if (fromKind.startsWith('pv')) return fromKind;
  if (toKind.startsWith('pv')) return toKind;
  return fromKind;
}

/** All wires in the PV circuit attached to a charger, including series links. */
function pvComponent(graph, startId) {
  const nodes = new Set([startId]);
  const wires = new Set();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    for (const edge of graph.byNode.get(id) || []) {
      if (!wireFamily(edge.wire, graph).startsWith('pv')) continue;
      wires.add(edge.wire);
      if (!nodes.has(edge.other)) {
        nodes.add(edge.other);
        queue.push(edge.other);
      }
    }
  }
  return { nodes, wires };
}

function isSeriesPvLink(from, to, fromKind, toKind) {
  return isSolarPanel(from) && isSolarPanel(to) && from.id !== to.id
    && ((fromKind === 'pv+' && toKind === 'pv-') || (fromKind === 'pv-' && toKind === 'pv+'));
}

/** Short-circuit current used for PV conductor sizing. */
function panelIsc(panel) {
  const props = panel?.props || {};
  const isc = Number(props.isc);
  if (isc > 0) return isc;
  const imp = Number(props.supplyA);
  if (imp > 0) return imp;
  const watts = Number(props.watts);
  const volts = Number(props.voltage);
  return watts > 0 && volts > 0 ? watts / volts : 0;
}

/** Nominal maximum-power voltage of a panel, used for PV voltage drop. */
function panelVmp(panel) {
  const props = panel?.props || {};
  const volts = Number(props.voltage);
  if (volts > 0) return volts;
  const watts = Number(props.watts);
  const amps = Number(props.supplyA) || Number(props.isc);
  return watts > 0 && amps > 0 ? watts / amps : 0;
}

/**
 * Work out the series strings in the array attached to a charger. Panels joined
 * by a direct pv+ to pv- link are in series; every remaining panel starts its
 * own parallel string. Branch and string current is the lowest Isc in the
 * string, while the combined trunk current is the sum of every string.
 */
function pvArraySummary(graph, startId) {
  const component = pvComponent(graph, startId);
  const panels = [...component.nodes]
    .map((id) => graph.nodeById.get(id))
    .filter((node) => isSolarPanel(node));
  if (!panels.length) return null;

  const seriesLinks = [...component.wires].filter((wire) => {
    const from = graph.nodeById.get(wire.from.node);
    const to = graph.nodeById.get(wire.to.node);
    return isSeriesPvLink(from, to, terminalKind(from, wire.from.terminal), terminalKind(to, wire.to.terminal));
  });

  const parent = new Map(panels.map((panel) => [panel.id, panel.id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== root) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  for (const wire of seriesLinks) union(wire.from.node, wire.to.node);

  const groups = new Map();
  for (const panel of panels) {
    const root = find(panel.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(panel);
  }

  const panelCurrent = new Map();
  const panelVoltage = new Map();
  let totalIsc = 0;
  let minStringVoltage = 0;
  for (const group of groups.values()) {
    const rated = group.map(panelIsc).filter((amps) => amps > 0);
    const stringIsc = rated.length ? Math.min(...rated) : 0;
    const stringVoltage = group.reduce((sum, panel) => sum + panelVmp(panel), 0);
    totalIsc += stringIsc;
    if (stringVoltage > 0) {
      minStringVoltage = minStringVoltage > 0 ? Math.min(minStringVoltage, stringVoltage) : stringVoltage;
    }
    for (const panel of group) {
      panelCurrent.set(panel.id, stringIsc);
      panelVoltage.set(panel.id, stringVoltage);
    }
  }

  return {
    ...component, panels, seriesLinks, panelCurrent, panelVoltage,
    totalIsc, strings: groups.size, minStringVoltage,
  };
}

/** Add PV conductor currents and voltages: branches get string values, trunks get totals. */
function addPvArrayCurrents(summary, mppt, add, voltages) {
  if (!summary || summary.totalIsc <= 0) return;
  const panelIds = new Set(summary.panels.map((panel) => panel.id));
  for (const wire of summary.wires) {
    const fromPanel = panelIds.has(wire.from.node);
    const toPanel = panelIds.has(wire.to.node);
    let amps = summary.totalIsc;
    let volts = summary.minStringVoltage;
    if (fromPanel || toPanel) {
      const panelId = fromPanel ? wire.from.node : wire.to.node;
      amps = summary.panelCurrent.get(panelId) || 0;
      volts = summary.panelVoltage.get(panelId) || volts;
      // A direct link between two strings can carry both string currents.
      if (fromPanel && toPanel) {
        const otherId = fromPanel ? wire.to.node : wire.from.node;
        amps = Math.max(amps, summary.panelCurrent.get(otherId) || 0);
        const otherVolts = summary.panelVoltage.get(otherId) || volts;
        if (otherVolts > 0) volts = volts > 0 ? Math.min(volts, otherVolts) : otherVolts;
      }
    }
    if (amps > 0) add(wire, amps, `${mppt.label} PV array ${round(amps, 1)} A`);
    if (volts > 0) voltages.set(wire.id, volts);
  }
}

const SUPPLY_FAMILIES = ['dc+', 'pv+', 'ac-l'];
const RETURN_FAMILIES = ['dc-', 'pv-', 'ac-n'];

export function computeCurrents(diagram) {
  const graph = buildGraph(diagram);
  const currents = new Map((diagram.wires || []).map((w) => [w.id, 0]));
  const reasons = new Map();
  const voltages = new Map();
  const pvArraysDone = new Set();

  const add = (wire, amps, reason) => {
    currents.set(wire.id, (currents.get(wire.id) || 0) + amps);
    if (!reasons.has(wire.id)) reasons.set(wire.id, reason);
  };

  // Loads: follow the supply conductor to a source, then the return conductor
  // back from the load. Both directions carry the same current.
  for (const node of diagram.nodes || []) {
    const roles = CATALOG_BY_ID[node.type]?.roles || [];
    if (!roles.includes('load')) continue;
    const draw = Number(node.props?.drawA) || 0;
    if (draw <= 0) continue;
    for (const family of SUPPLY_FAMILIES) {
      const path = traceFamily(graph, node.id, family, (n) => n && isSourceNode(n));
      if (path) for (const wire of path.wires) add(wire, draw, `${node.label} draws ${round(draw, 1)} A`);
    }
    for (const family of RETURN_FAMILIES) {
      const path = traceFamily(graph, node.id, family, (n) => n && isSourceNode(n));
      if (path) for (const wire of path.wires) add(wire, draw, `${node.label} return ${round(draw, 1)} A`);
    }
  }

  // Chargers: output into the battery through the positive conductor, and the
  // input side back to the source it draws from.
  for (const node of diagram.nodes || []) {
    const roles = CATALOG_BY_ID[node.type]?.roles || [];
    if (!roles.includes('charger')) continue;
    const props = node.props || {};
    const isInverter = ['inverter', 'inverter-charger', 'hybrid-inverter'].includes(node.type);
    const watts = Number(props.watts) || 0;
    const eff = Number(props.efficiency) || 0.9;
    const inputV = Number(props.inputV) || 12;

    if (isInverter) {
      const amps = watts / eff / inputV;
      // A hybrid inverter can also charge from its PV input. Size the battery
      // conductor for the larger of the inverter draw and the charge current
      // rather than adding them, because power flows one way at a time.
      const batteryAmps = node.type === 'hybrid-inverter'
        ? Math.max(amps, Number(props.chargeA) || 0)
        : amps;
      const path = traceFamily(graph, node.id, 'dc+', (n) => n && isBattery(n) && n.id !== node.id);
      if (path) for (const wire of path.wires) add(wire, batteryAmps, `${node.label} battery ${round(batteryAmps, 1)} A`);
      const ret = traceFamily(graph, node.id, 'dc-', (n) => n && isBattery(n) && n.id !== node.id);
      if (ret) for (const wire of ret.wires) add(wire, batteryAmps, `${node.label} return ${round(batteryAmps, 1)} A`);
      if (node.type !== 'hybrid-inverter') continue;
    } else {
      const outputA = Number(props.outputA ?? props.chargeA ?? 0);
      if (outputA > 0) {
        const path = traceFamily(graph, node.id, 'dc+', (n) => n && isBattery(n) && n.id !== node.id);
        if (path) for (const wire of path.wires) add(wire, outputA, `${node.label} output ${round(outputA, 1)} A`);
        const ret = traceFamily(graph, node.id, 'dc-', (n) => n && isBattery(n) && n.id !== node.id);
        if (ret) for (const wire of ret.wires) add(wire, outputA, `${node.label} return ${round(outputA, 1)} A`);
      }

      if (node.type === 'dcdc') {
        const inputA = Number(props.inputA) || (outputA * (Number(props.voltage) || 12.8)) / (Number(props.inputV) || 12);
        const path = traceFamily(graph, node.id, 'dc+', (n) => n && n.id !== node.id && (isBattery(n) || n.type === 'alternator' || isSourceNode(n)));
        if (path && inputA > 0) for (const wire of path.wires) add(wire, inputA, `${node.label} input ${round(inputA, 1)} A`);
        const ret = traceFamily(graph, node.id, 'dc-', (n) => n && n.id !== node.id && (isBattery(n) || n.type === 'alternator' || isSourceNode(n)));
        if (ret && inputA > 0) for (const wire of ret.wires) add(wire, inputA, `${node.label} return ${round(inputA, 1)} A`);
      }

      if (node.type === 'ac-charger') {
        const acIn = outputA * ((Number(props.voltage) || 12.8) / (230 * (Number(props.powerFactor) || 0.9)));
        for (const family of ['ac-l', 'ac-n']) {
          const path = traceFamily(graph, node.id, family, (n) => n && n.id !== node.id && isSourceNode(n));
          if (path && acIn > 0) for (const wire of path.wires) add(wire, acIn, `${node.label} AC input ${round(acIn, 1)} A`);
        }
      }
    }

    if (node.type === 'mppt' || node.type === 'hybrid-inverter') {
      const summary = pvArraySummary(graph, node.id);
      if (summary) {
        const key = summary.panels.map((panel) => panel.id).sort().join('|');
        if (!pvArraysDone.has(key)) {
          pvArraysDone.add(key);
          addPvArrayCurrents(summary, node, add, voltages);
        }
      }
    }
  }

  return { currents, reasons, voltages };
}

// --------------------------------------------------------------------------
// Evaluate a whole diagram
// --------------------------------------------------------------------------

export function evaluateDiagram(diagram) {
  const settings = { ...DEFAULT_SETTINGS, ...diagram.settings };
  const { currents, reasons, voltages } = computeCurrents(diagram);
  const std = STANDARDS[settings.standard] || STANDARDS.abyc;
  const results = new Map();

  for (const wire of diagram.wires || []) {
    const from = diagram.nodes.find((n) => n.id === wire.from.node);
    const to = diagram.nodes.find((n) => n.id === wire.to.node);
    if (!from || !to) continue;
    const kind = wireKind(diagram, wire);
    const auto = currents.get(wire.id) || 0;
    const currentA = wire.currentA != null && wire.currentA !== '' ? Number(wire.currentA) : (auto || 1);
    const voltage = isAcKind(kind) ? (Number(from.props?.voltage) || 230) : (voltages.get(wire.id) || Number(from.props?.voltage) || Number(to.props?.voltage) || 12.8);
    const continuous = to.props?.continuous !== false && from.props?.continuous !== false;

    const sized = sizeRun(diagram, {
      currentA,
      lengthM: Number(wire.lengthM) || 0,
      isPv: kind.startsWith('pv'),
      isAc: isAcKind(kind),
      voltage,
      continuous,
      overrideSize: wire.size ?? null,
    });

    const fuse = wire.fuse === 'none'
      ? null
      : (wire.fuse?.ratingA
        ? { family: wire.fuse.family || 'auto', ratingA: Number(wire.fuse.ratingA), label: FUSE_FAMILIES[wire.fuse.family]?.label || 'Fuse' }
        : pickFuse(sized.designA, wire.fuse?.family || null));

    // A fuse must not sit above the cable's derated ampacity. If the chosen
    // fuse needs more copper, step the cable up until it is coordinated.
    let coordinated = sized;
    if (fuse && sized.ampacity != null && fuse.ratingA > sized.ampacity && wire.size == null) {
      coordinated = sizeRun(diagram, {
        currentA,
        lengthM: Number(wire.lengthM) || 0,
        isPv: kind.startsWith('pv'),
        isAc: isAcKind(kind),
        voltage,
        continuous,
        minAmpacity: fuse.ratingA,
      });
    }

    const fuseOverCable = fuse && coordinated.ampacity != null && fuse.ratingA > coordinated.ampacity + 1e-9;
    const fuseUnderLoad = fuse && fuse.ratingA < coordinated.designA - 1e-9;

    results.set(wire.id, {
      ...coordinated,
      autoCurrentA: round(auto, 2),
      currentSource: wire.currentA != null && wire.currentA !== '' ? 'manual' : (reasons.get(wire.id) || 'default'),
      voltage: round(voltage, 1),
      kind,
      fuse,
      fuseOverCable: Boolean(fuseOverCable),
      fuseUnderLoad: Boolean(fuseUnderLoad),
      standard: std.id,
      standardLabel: std.label,
    });
  }

  const checks = runChecks(diagram, results);
  const bom = buildBom(diagram, results);
  return { wires: results, checks, bom, settings };
}

// --------------------------------------------------------------------------
// Safety checks
// --------------------------------------------------------------------------

function finding(id, severity, title, detail, refs = {}) {
  return { id, severity, title, detail, nodeIds: refs.nodeIds || [], wireIds: refs.wireIds || [] };
}

export function runChecks(diagram, sizing) {
  const out = [];
  const nodes = diagram.nodes || [];
  const wires = diagram.wires || [];
  const graph = buildGraph(diagram);
  const settings = { ...DEFAULT_SETTINGS, ...diagram.settings };
  const std = STANDARDS[settings.standard] || STANDARDS.abyc;
  const byRole = (role) => nodes.filter((n) => (CATALOG_BY_ID[n.type]?.roles || []).includes(role));
  const adjacent = (nodeId) => (graph.byNode.get(nodeId) || []);
  const degree = (nodeId) => adjacent(nodeId).length;
  const wiredTerminals = new Set();
  for (const w of wires) {
    wiredTerminals.add(`${w.from.node}:${w.from.terminal}`);
    wiredTerminals.add(`${w.to.node}:${w.to.terminal}`);
  }

  if (!nodes.length) {
    return [finding('empty', 'info', 'Empty diagram', 'Drop a component from the library to begin.')];
  }

  // ---- battery and source protection -------------------------------------
  for (const battery of byRole('source').filter(isBattery)) {
    const cap = Number(battery.props?.supplyA) || 0;
    if (cap < 40) continue;
    const positiveEdges = adjacent(battery.id).filter((e) => {
      const kind = terminalKind(battery, e.end === 'from' ? e.wire.from.terminal : e.wire.to.terminal);
      return kind === 'dc+' || kind === 'pv+';
    });
    const protectedNext = positiveEdges.some((e) => isProtectionNode(graph.nodeById.get(e.other)));
    if (!protectedNext) {
      out.push(finding('battery-unfused', 'critical', 'Battery has no primary fuse',
        `${battery.label} can deliver ${cap} A into a short circuit. Fit a fuse rated for the cable within 180 mm of the positive terminal.`,
        { nodeIds: [battery.id], wireIds: positiveEdges.map((e) => e.wire.id) }));
    }
    if (String(battery.props?.chemistry || '').toLowerCase().includes('lifepo')) {
      if (!battery.props?.hasBMS) {
        out.push(finding('battery-no-bms', 'critical', 'Lithium battery with no BMS',
          `${battery.label} is configured without a battery management system. Add a BMS or use a battery with an integrated one.`,
          { nodeIds: [battery.id] }));
      }
      if (cap >= 200 && !positiveEdges.some((e) => ['class-t', 'mega'].includes(graph.nodeById.get(e.other)?.type === 'class-t-fuse' ? 'class-t' : graph.nodeById.get(e.other)?.props?.family))) {
        out.push(finding('class-t', 'warning', 'Large lithium bank without high-interrupt protection',
          'A bank this size can supply a very high fault current. A Class-T or MEGA fuse at the battery main is the usual answer.',
          { nodeIds: [battery.id] }));
      }
    }
    if (!traceFamily(graph, battery.id, 'dc+', (n) => n && n.type === 'main-switch')) {
      out.push(finding('no-isolator', 'warning', 'No battery isolator',
        'Fit a manual isolator on the battery positive so the system can be made dead for service.',
        { nodeIds: [battery.id] }));
    }
  }

  // ---- inverters ----------------------------------------------------------
  for (const inv of nodes.filter((n) => n.type === 'inverter' || n.type === 'inverter-charger' || n.type === 'hybrid-inverter')) {
    const dcEdges = adjacent(inv.id).filter((e) => {
      const kind = terminalKind(inv, e.end === 'from' ? e.wire.from.terminal : e.wire.to.terminal);
      return kind === 'dc+';
    });
    const fused = dcEdges.some((e) => isProtectionNode(graph.nodeById.get(e.other)));
    if (!fused) {
      out.push(finding('inverter-unfused', 'critical', 'Inverter DC feed is unprotected',
        'An inverter can draw hundreds of amps. Protect the DC feed with a fuse or breaker sized to the cable.',
        { nodeIds: [inv.id], wireIds: dcEdges.map((e) => e.wire.id) }));
    }
    if (!inv.props?.hasIsolator && !traceFamily(graph, inv.id, 'dc+', (n) => n && n.type === 'main-switch')) {
      out.push(finding('inverter-isolator', 'warning', 'Inverter has no DC isolation',
        'Add a DC isolator so the inverter can be serviced without dismantling the battery connection.',
        { nodeIds: [inv.id] }));
    }
    if (!inv.props?.hasAcBreaker && !adjacent(inv.id).some((e) => graph.nodeById.get(e.other)?.type === 'rcbo' || graph.nodeById.get(e.other)?.type === 'ac-panel')) {
      out.push(finding('inverter-ac-protection', 'warning', 'Inverter AC output has no breaker',
        'Protect the AC output with a breaker or RCBO before it reaches sockets or appliances.',
        { nodeIds: [inv.id] }));
    }
  }

  // ---- solar --------------------------------------------------------------
  const panels = nodes.filter(isSolarPanel);
  const pvChargers = nodes.filter((n) => n.type === 'mppt' || n.type === 'hybrid-inverter');
  for (const charger of pvChargers) {
    if (charger.type === 'mppt') {
      const outEdges = adjacent(charger.id).filter((e) => {
        const kind = terminalKind(charger, e.end === 'from' ? e.wire.from.terminal : e.wire.to.terminal);
        return kind === 'dc+';
      });
      if (!outEdges.some((e) => isProtectionNode(graph.nodeById.get(e.other)))) {
        out.push(finding('mppt-unfused', 'warning', 'MPPT output is unprotected',
          'Fit a fuse on the charger output, sized to the cable and the charger rating.',
          { nodeIds: [charger.id] }));
      }
    }
    if (!traceFamily(graph, charger.id, 'pv+', (n) => n && n.type === 'main-switch')) {
      out.push(finding('pv-no-isolator', 'warning', 'No PV isolator',
        'Add a DC isolator between the array and the solar charger so the panels can be isolated for service.',
        { nodeIds: [charger.id] }));
    }
  }
  if (panels.length >= 2) {
    const parallel = panels.some((p) => adjacent(p.id).length > 2);
    if (parallel && !panels.every((p) => adjacent(p.id).some((e) => isProtectionNode(graph.nodeById.get(e.other))))) {
      out.push(finding('pv-string-fuse', 'warning', 'Parallel PV strings without string fuses',
        'Two or more parallel strings can back-feed a faulted string. Fit a fuse per string.',
        { nodeIds: panels.map((p) => p.id) }));
    }
  }

  // ---- AC ----------------------------------------------------------------
  const shore = nodes.filter((n) => n.type === 'shore-inlet');
  for (const inlet of shore) {
    const hasRcd = nodes.some((n) => n.type === 'rcbo');
    if (!hasRcd) {
      out.push(finding('shore-no-rcd', 'critical', 'Shore power without RCD protection',
        'A shore connection must pass through a 30 mA RCD/RCBO before any circuit. This is the one that protects people.',
        { nodeIds: [inlet.id] }));
    }
    if (!inlet.props?.galvanicIsolator && !nodes.some((n) => n.type === 'galvanic-isolator')) {
      out.push(finding('galvanic', 'info', 'No galvanic isolator',
        'For a metal hull, a galvanic isolator on the shore earth limits hull corrosion.',
        { nodeIds: [inlet.id] }));
    }
  }
  for (const node of nodes) {
    if (!['chassis-ground', 'earth-bar', 'galvanic-isolator'].includes(node.type)) continue;
    if (degree(node.id) === 0) {
      out.push(finding('ground-unused', 'info', 'Ground point is not connected',
        `${node.label} has no cables. Connect it or remove it.`, { nodeIds: [node.id] }));
    }
  }
  if (!nodes.some((n) => (CATALOG_BY_ID[n.type]?.roles || []).includes('ground'))) {
    out.push(finding('no-ground', 'critical', 'No ground point in the diagram',
      'Add a chassis or earth point and bond the DC negative and AC protective earth to it.', {}));
  }

  // ---- per-wire -----------------------------------------------------------
  for (const wire of wires) {
    const sized = sizing.get(wire.id);
    if (!sized) continue;
    if (!sized.ampacityPass) {
      out.push(finding('cable-ampacity', 'critical', 'Cable is undersized for its current',
        `This run carries ${sized.currentA} A but the derated ampacity of ${formatSize(sized.size, sized.unit)} is ${sized.ampacity?.toFixed(1)} A.`,
        { wireIds: [wire.id] }));
    }
    if (!sized.vdPass) {
      out.push(finding('cable-vd', 'warning', 'Voltage drop above target',
        `${sized.voltageDropPct.toFixed(1)}% over ${sized.lengthM} m, against a ${sized.targetPct}% target.`,
        { wireIds: [wire.id] }));
    }
    if (sized.fuseOverCable) {
      out.push(finding('fuse-over-cable', 'critical', 'Fuse is bigger than the cable can carry',
        `A ${sized.fuse.ratingA} A fuse protects cable rated ${sized.ampacity?.toFixed(1)} A after derating. The cable becomes the fuse.`,
        { wireIds: [wire.id] }));
    }
    if (sized.fuseUnderLoad) {
      out.push(finding('fuse-undersized', 'warning', 'Fuse below the continuous load',
        `${sized.fuse.ratingA} A fuse on a ${sized.designA} A design current will nuisance-blow.`,
        { wireIds: [wire.id] }));
    }
    if (sized.fuse && !sized.fuseOverCable) {
      const fam = FUSE_FAMILIES[sized.fuse.family];
      if (fam && fam.maxDesignCurrent != null && sized.designA > fam.maxDesignCurrent) {
        out.push(finding('fuse-family', 'info', 'Fuse type does not suit this current',
          `${fam.label} is intended up to ${fam.maxDesignCurrent} A. Consider a ${sized.designA > 80 ? 'MEGA or Class-T' : 'MIDI'} fuse.`,
          { wireIds: [wire.id] }));
      }
    }
    const from = graph.nodeById.get(wire.from.node);
    const to = graph.nodeById.get(wire.to.node);
    if (!from || !to) continue;
    const kind = sized.kind;
    const fromKind = terminalKind(from, wire.from.terminal);
    const toKind = terminalKind(to, wire.to.terminal);
    const opp = { 'dc+': 'dc-', 'dc-': 'dc+', 'pv+': 'pv-', 'pv-': 'pv+', 'ac-l': 'ac-n', 'ac-n': 'ac-l' };
    if (opp[fromKind] === toKind && !isSeriesPvLink(from, to, fromKind, toKind)) {
      out.push(finding('short', 'critical', 'Cable links opposite polarities',
        `A cable runs from ${TERMINAL_KINDS[fromKind].label} to ${TERMINAL_KINDS[toKind].label}. That is a short circuit.`,
        { wireIds: [wire.id], nodeIds: [from.id, to.id] }));
    }
    if (isAcKind(fromKind) !== isAcKind(toKind) && fromKind !== 'gnd' && toKind !== 'gnd') {
      out.push(finding('ac-dc-mix', 'critical', 'AC and DC on the same cable',
        'AC and DC conductors must be kept in separate circuits and enclosures.',
        { wireIds: [wire.id] }));
    }
    if (kind.startsWith('pv') && metricArea(sized.size, sized.unit) < std.minPvSize - 1e-9) {
      out.push(finding('pv-min', 'warning', 'PV cable below the minimum size',
        `PV cable should be at least ${std.minPvSize} mm² for mechanical and fault-current reasons.`,
        { wireIds: [wire.id] }));
    }
    if (Number(wire.lengthM) === 0) {
      out.push(finding('no-length', 'info', 'Cable has no length',
        'Set the run length so voltage drop can be calculated.', { wireIds: [wire.id] }));
    }
  }

  // Duplicate cable between the same pair of terminals.
  const pairs = new Map();
  for (const w of wires) {
    const a = `${w.from.node}:${w.from.terminal}`;
    const b = `${w.to.node}:${w.to.terminal}`;
    const key = [a, b].sort().join('|');
    pairs.set(key, [...(pairs.get(key) || []), w.id]);
  }
  for (const ids of pairs.values()) {
    if (ids.length > 1) {
      out.push(finding('duplicate-wire', 'warning', 'Two cables on the same terminals',
        'This doubles the current path without doubling the protection. Remove one or join them at a busbar.',
        { wireIds: ids }));
    }
  }

  // ---- components ---------------------------------------------------------
  for (const node of nodes) {
    const def = CATALOG_BY_ID[node.type];
    if (!def) continue;
    const unwired = def.terminals.filter((t) => !wiredTerminals.has(`${node.id}:${t.id}`));
    if (degree(node.id) === 0) {
      out.push(finding('orphan', 'info', 'Component is not connected',
        `${node.label} has no cables.`, { nodeIds: [node.id] }));
    } else if (unwired.length && def.terminals.length <= 3 && !['chassis-ground', 'busbar'].includes(node.type)) {
      out.push(finding('terminal-open', 'info', 'Terminal left unconnected',
        `${node.label}: ${unwired.map((t) => t.label).join(', ')} not used. Check that this is intentional.`,
        { nodeIds: [node.id] }));
    }
    if (node.type === 'busbar') {
      const total = adjacent(node.id).reduce((sum, edge) => {
        const sized = sizing.get(edge.wire.id);
        return sum + (sized?.currentA || 0);
      }, 0);
      if (Number(node.props?.ratedA) < total) {
        out.push(finding('busbar-rating', 'warning', 'Busbar rating below connected current',
          `${node.label} is rated ${node.props?.ratedA} A but carries about ${Math.round(total)} A.`,
          { nodeIds: [node.id] }));
      }
    }
    if (node.type === 'fuse-box') {
      const total = adjacent(node.id).reduce((sum, edge) => {
        const sized = sizing.get(edge.wire.id);
        return sum + (sized?.currentA || 0);
      }, 0);
      if (Number(node.props?.ratedA) < total) {
        out.push(finding('fusebox-rating', 'warning', 'Fuse box rating below connected current',
          `${node.label} is rated ${node.props?.ratedA} A but its circuits add up to about ${Math.round(total)} A.`,
          { nodeIds: [node.id] }));
      }
    }
    if (node.type === 'alternator') {
      const lithium = nodes.some((n) => isBattery(n) && String(n.props?.chemistry).toLowerCase().includes('lifepo'));
      if (lithium && !nodes.some((n) => n.type === 'dcdc')) {
        out.push(finding('alternator-lithium', 'warning', 'Alternator charging a lithium bank directly',
          'A lithium bank can accept more current than the alternator can sustain. Use a DC-DC charger or a regulated alternator.',
          { nodeIds: [node.id] }));
      }
    }
  }

  // ---- system -------------------------------------------------------------
  const batteries = nodes.filter(isBattery);
  if (batteries.length > 1) {
    const chemistries = new Set(batteries.map((b) => b.props?.chemistry).filter(Boolean));
    if (chemistries.size > 1) {
      out.push(finding('mixed-chemistry', 'warning', 'Mixed battery chemistries',
        'Batteries on one bank should share chemistry, age and capacity, or they will fight each other.',
        { nodeIds: batteries.map((b) => b.id) }));
    }
    const voltages = new Set(batteries.map((b) => Number(b.props?.voltage)).filter(Boolean));
    if (voltages.size > 1) {
      out.push(finding('mixed-voltage', 'warning', 'Batteries at different voltages',
        'A 12 V and a 24 V battery cannot be paralleled. Check the bank configuration.',
        { nodeIds: batteries.map((b) => b.id) }));
    }
  }
  const sources = nodes.filter(isSourceNode);
  const loadCurrent = nodes.filter((n) => (CATALOG_BY_ID[n.type]?.roles || []).includes('load'))
    .reduce((sum, n) => sum + (Number(n.props?.drawA) || 0), 0);
  const supply = sources.filter(isBattery).reduce((sum, n) => sum + (Number(n.props?.supplyA) || 0), 0);
  if (supply > 0 && loadCurrent > supply) {
    out.push(finding('source-overload', 'critical', 'Connected load exceeds battery output',
      `Loads add up to ${Math.round(loadCurrent)} A against ${Math.round(supply)} A of battery capability.`,
      { nodeIds: batteries.map((b) => b.id) }));
  }
  if (batteries.length && !nodes.some((n) => (CATALOG_BY_ID[n.type]?.roles || []).includes('charger'))) {
    out.push(finding('no-charger', 'warning', 'No charging source',
      'Add solar, a DC-DC charger or a shore charger so the bank can be replenished.',
      { nodeIds: batteries.map((b) => b.id) }));
  }

  return out.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
}

// --------------------------------------------------------------------------
// Bill of materials
// --------------------------------------------------------------------------

export function buildBom(diagram, sizing) {
  const groups = new Map();
  const add = (key, row) => {
    const existing = groups.get(key);
    if (existing) {
      existing.qty += row.qty;
      existing.total = round(existing.qty * existing.unitPrice, 2);
    } else groups.set(key, { ...row, total: round(row.qty * row.unitPrice, 2) });
  };

  for (const node of diagram.nodes || []) {
    const key = `part:${node.type}:${node.brand}:${node.model}:${node.price}`;
    add(key, {
      kind: 'Component',
      name: node.model ? `${node.brand ? `${node.brand} ` : ''}${node.model}` : node.label,
      detail: CATALOG_BY_ID[node.type]?.label || node.type,
      qty: 1,
      unitPrice: Number(node.price) || 0,
      unit: 'ea',
    });
  }

  const cableGroups = new Map();
  const fuseGroups = new Map();
  for (const wire of diagram.wires || []) {
    const sized = sizing.get(wire.id);
    if (!sized) continue;
    const cableKey = `${sized.size}|${sized.unit}`;
    const entry = cableGroups.get(cableKey) || { size: sized.size, unit: sized.unit, lengthM: 0, runs: 0 };
    entry.lengthM += Number(wire.lengthM) || 0;
    entry.runs += 1;
    cableGroups.set(cableKey, entry);
    if (sized.fuse) {
      const fk = `${sized.fuse.family}|${sized.fuse.ratingA}`;
      const f = fuseGroups.get(fk) || { family: sized.fuse.family, ratingA: sized.fuse.ratingA, qty: 0 };
      f.qty += 1;
      fuseGroups.set(fk, f);
    }
  }

  const unitPriceForCable = (size) => {
    const area = metricArea(size.unit === 'AWG' ? size.size : size.size, size.unit) || 1;
    return round(1.2 + area * 0.55, 2);
  };

  for (const c of cableGroups.values()) {
    add(`cable:${c.size}:${c.unit}`, {
      kind: 'Cable',
      name: `${formatSize(c.size, c.unit)} tinned copper`,
      detail: `${c.runs} run${c.runs === 1 ? '' : 's'}`,
      qty: round(c.lengthM, 1),
      unitPrice: unitPriceForCable(c),
      unit: 'm',
    });
  }
  for (const f of fuseGroups.values()) {
    if (f.family === 'auto') continue;
    add(`fuse:${f.family}:${f.ratingA}`, {
      kind: 'Fuse',
      name: `${FUSE_FAMILIES[f.family]?.label || f.family} ${f.ratingA} A`,
      detail: 'Circuit protection',
      qty: f.qty,
      unitPrice: round(f.ratingA > 100 ? 18 : f.ratingA > 40 ? 9 : 4, 2),
      unit: 'ea',
    });
  }

  const rows = [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const total = round(rows.reduce((sum, r) => sum + (r.total || 0), 0), 2);
  return { rows, total, cableTotalM: round([...cableGroups.values()].reduce((s, c) => s + c.lengthM, 0), 1) };
}
