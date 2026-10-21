// Safe, deterministic repairs for the findings produced by the checks engine.
//
// Each repair only uses parts that already exist in the catalogue. Repairs are
// ordinary store mutations, so they are undoable and are saved with the
// project just like a manual edit.

import { CATALOG_BY_ID, makeNode } from '../data/catalog.js?v=20261045';
import { evaluateDiagram, sizeRun, sizeOptions } from './engine.js?v=20261045';
import { FUSE_RATINGS, STANDARDS, metricArea } from '../data/standards.js';

const SHEET_W = 1800;
const SHEET_H = 1100;
const MARGIN = 40;
const GAP = 18;

function uid(doc, prefix) {
  let id;
  do {
    id = `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  } while (doc.nodes.some((n) => n.id === id) || doc.wires.some((w) => w.id === id));
  return id;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function overlaps(doc, x, y, w, h) {
  return doc.nodes.some((n) => (
    x < n.x + n.w + GAP && x + w + GAP > n.x
    && y < n.y + n.h + GAP && y + h + GAP > n.y
  ));
}

function freeSpot(doc, preferredX, preferredY, w, h) {
  const maxX = SHEET_W - w - MARGIN;
  const maxY = SHEET_H - h - MARGIN;
  const x = clamp(preferredX, MARGIN, Math.max(MARGIN, maxX));
  const y = clamp(preferredY, MARGIN, Math.max(MARGIN, maxY));
  if (!overlaps(doc, x, y, w, h)) return { x: Math.round(x), y: Math.round(y) };

  // Search outwards on a fine grid, nearest candidate first. A coarse ring
  // search can jump past a perfectly good gap and drop the new part far away.
  const step = 10;
  const rings = 30;
  const candidates = [];
  for (let dy = -rings; dy <= rings; dy++) {
    for (let dx = -rings; dx <= rings; dx++) {
      candidates.push([dx, dy, dx * dx + dy * dy]);
    }
  }
  candidates.sort((a, b) => a[2] - b[2]);
  for (const [dx, dy] of candidates) {
    const cx = clamp(x + dx * step, MARGIN, Math.max(MARGIN, maxX));
    const cy = clamp(y + dy * step, MARGIN, Math.max(MARGIN, maxY));
    if (!overlaps(doc, cx, cy, w, h)) return { x: Math.round(cx), y: Math.round(cy) };
  }
  return { x: Math.round(x), y: Math.round(y) };
}

function addPart(doc, typeId, preferredX, preferredY, props = {}, label = '') {
  const def = CATALOG_BY_ID[typeId];
  if (!def) throw new Error(`Unknown component ${typeId}`);
  const spot = freeSpot(doc, preferredX, preferredY, def.w, def.h);
  const node = makeNode(typeId, spot.x, spot.y, {
    id: uid(doc, 'n'),
    props,
    label: label || def.label,
  });
  doc.nodes.push(node);
  return node;
}

function addWire(doc, from, to, lengthM = 1, extra = {}) {
  const wire = {
    id: uid(doc, 'w'),
    from: { ...from },
    to: { ...to },
    lengthM: Number(lengthM) || 0,
    ...extra,
  };
  doc.wires.push(wire);
  return wire;
}

function touches(wire, nodeId, terminalId) {
  return (wire.from.node === nodeId && wire.from.terminal === terminalId)
    || (wire.to.node === nodeId && wire.to.terminal === terminalId);
}

function terminalKind(node, terminalId) {
  return node?.props?.terminalKinds?.[terminalId]
    || CATALOG_BY_ID[node?.type]?.terminals.find((t) => t.id === terminalId)?.kind
    || '';
}

function isProtection(node) {
  return Boolean((CATALOG_BY_ID[node?.type]?.roles || []).includes('protection'));
}

function nodeById(doc, id) {
  return doc.nodes.find((n) => n.id === id);
}

function nextFuseRating(amps) {
  return FUSE_RATINGS.find((r) => r >= Number(amps) - 1e-9) ?? FUSE_RATINGS[FUSE_RATINGS.length - 1];
}

function roundUp(value, step) {
  return Math.ceil(Number(value) / step) * step;
}

/**
 * Put a node in series with everything already connected to one terminal.
 * Existing cables are re-pointed at the new node's output, and a short tail
 * connects the original terminal to the new node's input.
 */
function redirectThrough(doc, sourceId, sourceTerminal, node, inTerminal, outTerminal, lengthM = 0.4) {
  const existing = doc.wires.filter((w) => touches(w, sourceId, sourceTerminal));
  for (const wire of existing) {
    if (wire.from.node === sourceId && wire.from.terminal === sourceTerminal) {
      wire.from = { node: node.id, terminal: outTerminal };
    } else if (wire.to.node === sourceId && wire.to.terminal === sourceTerminal) {
      wire.to = { node: node.id, terminal: outTerminal };
    }
  }
  addWire(doc, { node: sourceId, terminal: sourceTerminal }, { node: node.id, terminal: inTerminal }, lengthM);
  return existing.length;
}

function protectionNextToBattery(doc, battery) {
  for (const wire of doc.wires) {
    if (!touches(wire, battery.id, 'pos')) continue;
    const otherId = wire.from.node === battery.id ? wire.to.node : wire.from.node;
    const other = nodeById(doc, otherId);
    if (!other || !isProtection(other)) continue;
    const def = CATALOG_BY_ID[other.type];
    if (def?.terminals.some((t) => t.id === 'out' && terminalKind(other, 'out') === terminalKind(battery, 'pos'))) {
      return other;
    }
  }
  return null;
}

function batteryFor(check, doc) {
  const node = nodeById(doc, check.nodeIds?.[0]);
  if (node?.type?.startsWith('battery')) return node;
  return doc.nodes.find((n) => n.type.startsWith('battery') && n.props?.supplyA >= 40) || null;
}

function hasWire(doc, nodeId, terminalId) {
  return (doc.wires || []).some((w) => touches(w, nodeId, terminalId));
}

function addBatterySeriesPart(check, doc, { typeId, label, buttonLabel, props = {} }) {
  const battery = batteryFor(check, doc);
  if (!battery) return null;
  return {
    label: buttonLabel || label || 'Fix',
    run(d) {
      const liveBattery = nodeById(d, battery.id);
      if (!liveBattery) return null;
      const node = addPart(d, typeId, liveBattery.x + liveBattery.w + 48, liveBattery.y + 18, props, label);
      redirectThrough(d, liveBattery.id, 'pos', node, 'in', 'out', 0.4);
      return {
        notice: `Fitted ${node.label} at ${liveBattery.label}.`,
        selectNodeId: node.id,
      };
    },
  };
}

function upsizeCable(doc, wireId) {
  const wire = doc.wires.find((w) => w.id === wireId);
  if (!wire) return null;
  const sized = evaluateDiagram(doc).wires.get(wire.id);
  if (!sized) return null;
  const currentArea = metricArea(sized.size, sized.unit) || 0;
  const options = sizeOptions(sized.unit)
    .filter((size) => (metricArea(size, sized.unit) || 0) > currentArea + 1e-9);
  for (const size of options) {
    const test = sizeRun(doc, {
      currentA: sized.currentA,
      lengthM: Number(wire.lengthM) || 0,
      isPv: sized.kind?.startsWith('pv'),
      isAc: sized.kind?.startsWith('ac-'),
      voltage: sized.voltage,
      overrideSize: size,
    });
    if (test.ampacityPass && test.vdPass) {
      wire.size = size;
      return { size, unit: sized.unit };
    }
  }
  return null;
}

function removeWire(doc, wireId) {
  const wire = doc.wires.find((w) => w.id === wireId);
  if (!wire) return null;
  const from = nodeById(doc, wire.from.node);
  const to = nodeById(doc, wire.to.node);
  doc.wires = doc.wires.filter((w) => w.id !== wireId);
  return { from: from?.label || 'component', to: to?.label || 'component' };
}

function rcboPair(doc, sourceId, label, lTerm, nTerm) {
  const source = nodeById(doc, sourceId);
  if (!source) return null;
  return {
    label: 'Fit RCBO',
    run(d) {
      const live = nodeById(d, sourceId);
      if (!live) return null;
      const rcbo = addPart(d, 'rcbo', live.x + live.w + 45, live.y + live.h + 25, { ratingA: 16, tripMa: 30 }, label);
      redirectThrough(d, live.id, lTerm, rcbo, 'inl', 'outl', 0.4);
      redirectThrough(d, live.id, nTerm, rcbo, 'inn', 'outn', 0.4);
      return { notice: `Fitted ${rcbo.label} on ${live.label}.`, selectNodeId: rcbo.id };
    },
  };
}

// ---------------------------------------------------------------------------
// Repairs
// ---------------------------------------------------------------------------

const FIXES = {
  'battery-unfused': (check, doc) => {
    const battery = batteryFor(check, doc);
    if (!battery || !hasWire(doc, battery.id, 'pos')) return null;
    const cap = Number(battery.props?.supplyA) || 0;
    // A 48 V bank charges to about 58 V, well above the 32 V DC rating of most
    // blade, MIDI and ANL fuses, so those systems need a Class-T.
    const chargeV = Number(battery.props?.chargeV) || (Number(battery.props?.voltage) || 12) * 1.15;
    const typeId = cap >= 200 || chargeV > 32 ? 'class-t-fuse' : 'fuse';
    return addBatterySeriesPart(check, doc, {
      typeId,
      label: typeId === 'class-t-fuse' ? 'Battery main fuse' : 'Battery fuse',
      buttonLabel: 'Fit fuse',
      props: {
        voltage: Number(battery.props?.voltage) || 12,
        ratingA: cap || CATALOG_BY_ID[typeId].defaults.ratingA,
        family: typeId === 'class-t-fuse' ? 'class-t' : (cap > 150 ? 'anl' : 'midi'),
      },
    });
  },

  'battery-no-bms': (check, doc) => {
    const battery = batteryFor(check, doc);
    if (!battery) return null;
    return {
      label: 'Mark BMS fitted',
      run(d) {
        const live = nodeById(d, battery.id);
        if (!live) return null;
        live.props.hasBMS = true;
        return { notice: `Marked ${live.label} as having an integrated BMS.`, selectNodeId: live.id };
      },
    };
  },

  'class-t': (check, doc) => {
    const battery = batteryFor(check, doc);
    if (!battery || !hasWire(doc, battery.id, 'pos')) return null;
    return addBatterySeriesPart(check, doc, {
      typeId: 'class-t-fuse',
      label: 'Class-T fuse',
      buttonLabel: 'Fit fuse',
      props: {
        voltage: Number(battery.props?.voltage) || 12,
        ratingA: Number(battery.props?.supplyA) || 300,
        family: 'class-t',
      },
    });
  },

  'no-isolator': (check, doc) => {
    const battery = batteryFor(check, doc);
    if (!battery || !hasWire(doc, battery.id, 'pos')) return null;
    return {
      label: 'Fit isolator',
      run(d) {
        const liveBattery = nodeById(d, battery.id);
        if (!liveBattery) return null;
        const protection = protectionNextToBattery(d, liveBattery);
        const source = protection && CATALOG_BY_ID[protection.type]?.terminals.some((t) => t.id === 'out')
          ? protection : liveBattery;
        const sourceTerminal = source === liveBattery ? 'pos' : 'out';
        const ratedA = Math.max(100, roundUp(Number(liveBattery.props?.supplyA) || 100, 50));
        const node = addPart(d, 'main-switch', source.x + source.w + 48, source.y + 18, {
          voltage: Number(liveBattery.props?.voltage) || 12,
          ratedA,
        }, 'Battery isolator');
        redirectThrough(d, source.id, sourceTerminal, node, 'in', 'out', 0.4);
        return { notice: `Fitted a battery isolator on ${liveBattery.label}.`, selectNodeId: node.id };
      },
    };
  },

  'inverter-unfused': (check, doc) => {
    const inv = nodeById(doc, check.nodeIds?.[0]);
    if (!inv || !hasWire(doc, inv.id, 'pos')) return null;
    return {
      label: 'Fit DC breaker',
      run(d) {
        const live = nodeById(d, inv.id);
        if (!live) return null;
        const inverterA = (Number(live.props?.watts) || 2000)
          / (Number(live.props?.efficiency) || 0.9)
          / (Number(live.props?.inputV) || 12);
        const feedA = live.type === 'hybrid-inverter'
          ? Math.max(inverterA, Number(live.props?.chargeA) || 0)
          : inverterA;
        const breaker = addPart(d, 'breaker-dc', live.x - 170, live.y + 10, {
          voltage: Number(live.props?.voltage) || 12,
          ratingA: nextFuseRating(feedA * 1.25),
        }, 'Inverter DC breaker');
        redirectThrough(d, live.id, 'pos', breaker, 'out', 'in', 0.4);
        return { notice: `Fitted a DC breaker on ${live.label}'s DC feed.`, selectNodeId: breaker.id };
      },
    };
  },

  'inverter-isolator': (check, doc) => {
    const inv = nodeById(doc, check.nodeIds?.[0]);
    if (!inv || !hasWire(doc, inv.id, 'pos')) return null;
    return {
      label: 'Fit isolator',
      run(d) {
        const live = nodeById(d, inv.id);
        if (!live) return null;
        const inverterA = (Number(live.props?.watts) || 2000)
          / (Number(live.props?.efficiency) || 0.9)
          / (Number(live.props?.inputV) || 12);
        const feedA = live.type === 'hybrid-inverter'
          ? Math.max(inverterA, Number(live.props?.chargeA) || 0)
          : inverterA;
        const node = addPart(d, 'main-switch', live.x - 170, live.y + 10, {
          voltage: Number(live.props?.voltage) || 12,
          ratedA: Math.max(100, roundUp(feedA * 1.25, 25)),
        }, 'Inverter isolator');
        redirectThrough(d, live.id, 'pos', node, 'out', 'in', 0.4);
        return { notice: `Fitted a DC isolator on ${live.label}.`, selectNodeId: node.id };
      },
    };
  },

  'inverter-ac-protection': (check, doc) => {
    const inv = nodeById(doc, check.nodeIds?.[0]);
    if (!inv) return null;
    const isCharger = inv.type === 'inverter-charger' || inv.type === 'hybrid-inverter';
    const lTerm = isCharger ? 'outl' : 'l';
    const nTerm = isCharger ? 'outn' : 'n';
    if (!hasWire(doc, inv.id, lTerm) || !hasWire(doc, inv.id, nTerm)) return null;
    return rcboPair(doc, inv.id, 'Inverter AC RCBO', lTerm, nTerm);
  },

  'mppt-unfused': (check, doc) => {
    const mppt = nodeById(doc, check.nodeIds?.[0]);
    if (!mppt || !hasWire(doc, mppt.id, 'batpos')) return null;
    return {
      label: 'Fit output fuse',
      run(d) {
        const live = nodeById(d, mppt.id);
        if (!live) return null;
        const amps = Number(live.props?.outputA) || 30;
        const volts = Number(live.props?.voltage) || 12;
        // Above 32 V a blade/MIDI/ANL fuse is the wrong device; a DC breaker carries
        // the higher DC rating a 48 V bank needs.
        const highVoltage = volts > 32;
        const fuse = addPart(d, highVoltage ? 'breaker-dc' : 'fuse', live.x + live.w + 45, live.y + 15, {
          voltage: volts,
          ratingA: nextFuseRating(amps * 1.25),
          family: highVoltage ? 'breaker' : (amps > 80 ? 'anl' : 'midi'),
        }, highVoltage ? 'MPPT output breaker' : 'MPPT output fuse');
        redirectThrough(d, live.id, 'batpos', fuse, 'in', 'out', 0.4);
        return { notice: `Fitted an output fuse on ${live.label}.`, selectNodeId: fuse.id };
      },
    };
  },

  'pv-no-isolator': (check, doc) => {
    const mppt = nodeById(doc, check.nodeIds?.[0]);
    if (!mppt || !hasWire(doc, mppt.id, 'pvpos')) return null;
    return {
      label: 'Fit PV isolator',
      run(d) {
        const live = nodeById(d, mppt.id);
        if (!live) return null;
        const node = addPart(d, 'main-switch', live.x - 170, live.y + 10, {
          voltage: 600,
          ratedA: 25,
          dcV: 600,
          terminalKinds: { in: 'pv+', out: 'pv+' },
        }, 'PV isolator');
        redirectThrough(d, live.id, 'pvpos', node, 'out', 'in', 0.4);
        return { notice: `Fitted a PV isolator ahead of ${live.label}.`, selectNodeId: node.id };
      },
    };
  },

  'pv-string-fuse': (check, doc) => {
    const panels = (check.nodeIds || []).map((id) => nodeById(doc, id)).filter(Boolean);
    if (!panels.length || !panels.some((panel) => hasWire(doc, panel.id, 'pvpos'))) return null;
    return {
      label: 'Fit string fuses',
      run(d) {
        let last = null;
        let count = 0;
        for (const panel of panels) {
          const live = nodeById(d, panel.id);
          if (!live || !hasWire(d, live.id, 'pvpos')) continue;
          const alreadyProtected = d.wires.some((wire) => {
            if (!touches(wire, live.id, 'pvpos')) return false;
            const otherId = wire.from.node === live.id ? wire.to.node : wire.from.node;
            return isProtection(nodeById(d, otherId));
          });
          if (alreadyProtected) continue;
          const amps = Number(live.props?.isc) || 12;
          const fuse = addPart(d, 'fuse', live.x + live.w + 45, live.y + 15, {
            voltage: Number(live.props?.voc) || 30,
            ratingA: nextFuseRating(amps * 1.56),
            family: 'midi',
            terminalKinds: { in: 'pv+', out: 'pv+' },
          }, 'PV string fuse');
          redirectThrough(d, live.id, 'pvpos', fuse, 'in', 'out', 0.4);
          last = fuse;
          count++;
        }
        if (!last) return null;
        return { notice: `Fitted ${count} PV string fuse${count === 1 ? '' : 's'}.`, selectNodeId: last.id };
      },
    };
  },

  'pv-combiner-spd': (check, doc) => {
    const combiner = nodeById(doc, check.nodeIds?.[0]);
    if (!combiner) return null;
    const ground = doc.nodes.find((n) => n.type === 'chassis-ground' && n.id !== combiner.id)
      || doc.nodes.find((n) => n.type === 'earth-bar' && n.id !== combiner.id);
    return {
      label: 'Bond SPD earth',
      run(d) {
        const live = nodeById(d, combiner.id);
        if (!live) return null;
        const target = ground ? nodeById(d, ground.id) : null;
        if (target) {
          const terminals = CATALOG_BY_ID[target.type]?.terminals || [];
          const terminalId = (terminals.find((t) => !hasWire(d, target.id, t.id)) || terminals[0])?.id;
          if (!terminalId) return null;
          addWire(d, { node: live.id, terminal: 'gnd' }, { node: target.id, terminal: terminalId }, 1);
          return { notice: `Bonded the ${live.label} SPD to ${target.label}.`, selectNodeId: live.id };
        }
        const g = addPart(d, 'chassis-ground', live.x + live.w + 40, live.y + live.h + 50, {}, 'Chassis ground');
        addWire(d, { node: live.id, terminal: 'gnd' }, { node: g.id, terminal: 'gnd' }, 1);
        return { notice: `Added an earth point for the ${live.label} SPD.`, selectNodeId: g.id };
      },
    };
  },

  'shore-no-rcd': (check, doc) => {
    const shore = nodeById(doc, check.nodeIds?.[0]);
    if (!shore || !hasWire(doc, shore.id, 'l') || !hasWire(doc, shore.id, 'n')) return null;
    return rcboPair(doc, shore.id, 'Shore RCBO', 'l', 'n');
  },

  'galvanic': (check, doc) => {
    const shore = nodeById(doc, check.nodeIds?.[0]);
    if (!shore || !hasWire(doc, shore.id, 'pe')) return null;
    return {
      label: 'Fit isolator',
      run(d) {
        const live = nodeById(d, shore.id);
        if (!live) return null;
        const node = addPart(d, 'galvanic-isolator', live.x + live.w + 45, live.y + 10, {}, 'Galvanic isolator');
        redirectThrough(d, live.id, 'pe', node, 'in', 'out', 0.4);
        return { notice: `Fitted a galvanic isolator on ${live.label}'s shore earth.`, selectNodeId: node.id };
      },
    };
  },

  'ground-unused': (check, doc) => {
    const ground = nodeById(doc, check.nodeIds?.[0]);
    if (!ground) return null;
    const gndTerm = CATALOG_BY_ID[ground.type]?.terminals[0]?.id;
    const battery = doc.nodes.find((n) => n.type.startsWith('battery'));
    const target = battery
      || doc.nodes.find((n) => n.id !== ground.id && CATALOG_BY_ID[n.type]?.terminals.some((t) => t.kind === 'dc-' || t.kind === 'ac-pe'));
    const targetTerm = battery ? 'neg' : CATALOG_BY_ID[target?.type]?.terminals.find((t) => t.kind === 'dc-' || t.kind === 'ac-pe')?.id;
    if (!gndTerm || !target || !targetTerm) return null;
    return {
      label: 'Bond it',
      run(d) {
        const g = nodeById(d, ground.id);
        const t = nodeById(d, target.id);
        if (!g || !t) return null;
        addWire(d, { node: g.id, terminal: gndTerm }, { node: t.id, terminal: targetTerm }, 0.8);
        return { notice: `Bonded ${g.label} to ${t.label}.`, selectNodeId: g.id };
      },
    };
  },

  'no-ground': (check, doc) => {
    const battery = doc.nodes.find((n) => n.type.startsWith('battery'));
    const shore = doc.nodes.find((n) => n.type === 'shore-inlet');
    const inverter = doc.nodes.find((n) => n.type === 'inverter' || n.type === 'inverter-charger' || n.type === 'hybrid-inverter');
    if (!battery && !shore && !inverter) return null;
    return {
      label: 'Add ground',
      run(d) {
        const b = battery ? nodeById(d, battery.id) : null;
        const sh = shore ? nodeById(d, shore.id) : null;
        const inv = inverter ? nodeById(d, inverter.id) : null;
        const anchor = b || sh || inv;
        if (!anchor) return null;
        const ground = addPart(d, 'chassis-ground', anchor.x, anchor.y + anchor.h + 70, {}, 'Chassis ground');
        if (b) addWire(d, { node: b.id, terminal: 'neg' }, { node: ground.id, terminal: 'gnd' }, 0.8);
        if (sh) addWire(d, { node: sh.id, terminal: 'pe' }, { node: ground.id, terminal: 'gnd' }, 0.8);
        if (inv) addWire(d, { node: inv.id, terminal: 'pe' }, { node: ground.id, terminal: 'gnd' }, 0.8);
        return { notice: 'Added a bonded chassis ground point.', selectNodeId: ground.id };
      },
    };
  },

  'cable-ampacity': (check, doc) => {
    const wire = doc.wires.find((w) => w.id === check.wireIds?.[0]);
    if (!wire) return null;
    return {
      label: 'Upsize cable',
      run(d) {
        const result = upsizeCable(d, wire.id);
        if (!result) return null;
        return { notice: `Upsized the cable to ${result.size} ${result.unit}.`, selectNodeId: wire.from.node };
      },
    };
  },

  'cable-vd': (check, doc) => {
    const wire = doc.wires.find((w) => w.id === check.wireIds?.[0]);
    if (!wire) return null;
    return {
      label: 'Upsize cable',
      run(d) {
        const result = upsizeCable(d, wire.id);
        if (!result) return null;
        return { notice: `Upsized the cable to ${result.size} ${result.unit} to reduce voltage drop.`, selectNodeId: wire.from.node };
      },
    };
  },

  'fuse-over-cable': (check, doc) => {
    const wire = doc.wires.find((w) => w.id === check.wireIds?.[0]);
    if (!wire) return null;
    return {
      label: 'Upsize cable',
      run(d) {
        const live = d.wires.find((w) => w.id === wire.id);
        if (!live) return null;
        const sized = evaluateDiagram(d).wires.get(live.id);
        if (!sized?.fuse) return null;
        const test = sizeRun(d, {
          currentA: sized.currentA,
          lengthM: Number(live.lengthM) || 0,
          isPv: sized.kind?.startsWith('pv'),
          isAc: sized.kind?.startsWith('ac-'),
          voltage: sized.voltage,
          minAmpacity: sized.fuse.ratingA,
        });
        if (!test.ampacityPass || !test.size) return null;
        live.size = test.size;
        return { notice: `Upsized the cable to carry the ${sized.fuse.ratingA} A fuse.`, selectNodeId: live.from.node };
      },
    };
  },

  'fuse-undersized': (check, doc) => {
    const wire = doc.wires.find((w) => w.id === check.wireIds?.[0]);
    if (!wire) return null;
    return {
      label: 'Use auto fuse',
      run(d) {
        const live = d.wires.find((w) => w.id === wire.id);
        if (!live) return null;
        live.fuse = null;
        live.size = null;
        return { notice: 'Set the fuse and cable back to automatic sizing.', selectNodeId: live.from.node };
      },
    };
  },

  'fuse-family': (check, doc) => {
    const wire = doc.wires.find((w) => w.id === check.wireIds?.[0]);
    if (!wire?.fuse || wire.fuse === 'none') return null;
    return {
      label: 'Use auto fuse',
      run(d) {
        const live = d.wires.find((w) => w.id === wire.id);
        if (!live?.fuse || live.fuse === 'none') return null;
        live.fuse = { ...live.fuse, family: null };
        return { notice: 'Set the fuse type back to automatic.', selectNodeId: live.from.node };
      },
    };
  },

  'short': (check, doc) => {
    const wire = doc.wires.find((w) => w.id === check.wireIds?.[0]);
    if (!wire) return null;
    return {
      label: 'Remove cable',
      run(d) {
        const result = removeWire(d, wire.id);
        if (!result) return null;
        return { notice: `Removed the cable between ${result.from} and ${result.to}.` };
      },
    };
  },

  'ac-dc-mix': (check, doc) => {
    const wire = doc.wires.find((w) => w.id === check.wireIds?.[0]);
    if (!wire) return null;
    return {
      label: 'Remove cable',
      run(d) {
        const result = removeWire(d, wire.id);
        if (!result) return null;
        return { notice: `Removed the mixed AC/DC cable between ${result.from} and ${result.to}.` };
      },
    };
  },

  'pv-min': (check, doc) => {
    const wire = doc.wires.find((w) => w.id === check.wireIds?.[0]);
    if (!wire) return null;
    const std = STANDARDS[doc.settings?.standard] || STANDARDS.abyc;
    return {
      label: 'Use PV cable',
      run(d) {
        const live = d.wires.find((w) => w.id === wire.id);
        if (!live) return null;
        const sized = evaluateDiagram(d).wires.get(live.id);
        const unit = sized?.unit || d.settings?.units || 'mm2';
        const size = sizeOptions(unit).find((s) => (metricArea(s, unit) || 0) >= std.minPvSize - 1e-9);
        if (!size) return null;
        live.size = size;
        return { notice: `Set the PV cable to at least ${std.minPvSize} mm².`, selectNodeId: live.from.node };
      },
    };
  },

  'no-length': (check, doc) => {
    const wire = doc.wires.find((w) => w.id === check.wireIds?.[0]);
    if (!wire) return null;
    return {
      label: 'Set 1 m',
      run(d) {
        const live = d.wires.find((w) => w.id === wire.id);
        if (!live) return null;
        live.lengthM = 1;
        return { notice: 'Set the cable run to 1 m. Edit the length for a real measurement.', selectNodeId: live.from.node };
      },
    };
  },

  'duplicate-wire': (check, doc) => {
    const ids = (check.wireIds || []).filter((id) => doc.wires.some((w) => w.id === id));
    if (ids.length < 2) return null;
    return {
      label: 'Remove duplicate',
      run(d) {
        const remove = new Set(ids.slice(1));
        const before = d.wires.length;
        d.wires = d.wires.filter((w) => !remove.has(w.id));
        return { notice: `Removed ${before - d.wires.length} duplicate cable${before - d.wires.length === 1 ? '' : 's'}.` };
      },
    };
  },

  'busbar-rating': (check, doc) => {
    const node = nodeById(doc, check.nodeIds?.[0]);
    if (!node) return null;
    const total = Number((check.detail.match(/about (\d+) A/) || [])[1]);
    if (!total) return null;
    return {
      label: 'Upsize rating',
      run(d) {
        const live = nodeById(d, node.id);
        if (!live) return null;
        live.props.ratedA = Math.max(Number(live.props.ratedA) || 0, roundUp(total, 10));
        return { notice: `Raised ${live.label}'s rating to ${live.props.ratedA} A.`, selectNodeId: live.id };
      },
    };
  },

  'fusebox-rating': (check, doc) => {
    const node = nodeById(doc, check.nodeIds?.[0]);
    if (!node) return null;
    const total = Number((check.detail.match(/about (\d+) A/) || [])[1]);
    if (!total) return null;
    return {
      label: 'Upsize rating',
      run(d) {
        const live = nodeById(d, node.id);
        if (!live) return null;
        live.props.ratedA = Math.max(Number(live.props.ratedA) || 0, roundUp(total, 10));
        return { notice: `Raised ${live.label}'s rating to ${live.props.ratedA} A.`, selectNodeId: live.id };
      },
    };
  },

  'alternator-lithium': (check, doc) => {
    const alt = nodeById(doc, check.nodeIds?.[0]);
    if (!alt || !hasWire(doc, alt.id, 'pos') || !hasWire(doc, alt.id, 'neg')) return null;
    return {
      label: 'Fit DC-DC',
      run(d) {
        const live = nodeById(d, alt.id);
        if (!live) return null;
        const dcdc = addPart(d, 'dcdc', live.x + live.w + 50, live.y, {
          outputA: 30,
          inputA: 40,
          inputV: Number(live.props?.voltage) || 12,
          voltage: 12.8,
        }, 'DC-DC charger');
        redirectThrough(d, live.id, 'pos', dcdc, 'inpos', 'outpos', 0.4);
        redirectThrough(d, live.id, 'neg', dcdc, 'inneg', 'outneg', 0.4);
        return { notice: `Fitted a DC-DC charger to protect the lithium bank from ${live.label}.`, selectNodeId: dcdc.id };
      },
    };
  },

  'orphan': (check, doc) => {
    const node = nodeById(doc, check.nodeIds?.[0]);
    if (!node) return null;
    const degree = (doc.wires || []).filter((w) => w.from.node === node.id || w.to.node === node.id).length;
    if (degree) return null;
    return {
      label: 'Remove part',
      run(d) {
        const live = nodeById(d, node.id);
        if (!live) return null;
        d.nodes = d.nodes.filter((n) => n.id !== live.id);
        d.wires = (d.wires || []).filter((w) => w.from.node !== live.id && w.to.node !== live.id);
        return { notice: `Removed the unused ${live.label}.` };
      },
    };
  },
};

export function fixForCheck(check, doc) {
  const make = FIXES[check?.id];
  if (!make) return null;
  try {
    return make(check, doc) || null;
  } catch {
    return null;
  }
}
