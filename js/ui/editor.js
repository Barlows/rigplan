// Canvas editor: rendering, selection, drag, wiring, pan and zoom.

import { CATALOG_BY_ID } from '../data/catalog.js?v=20261039';
import { WIRE_COLORS, TERMINAL_KINDS, formatSize } from '../data/standards.js';
import { renderSymbol } from './symbols.js?v=20261039';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GRID = 10;

const el = (name, attrs = {}, children = '') => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (children) node.innerHTML = children;
  return node;
};

function roundedPath(points, radius = 12) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 1) { d += ` L ${cur.x} ${cur.y}`; continue; }
    const inX = cur.x - ((cur.x - prev.x) / inLen) * r;
    const inY = cur.y - ((cur.y - prev.y) / inLen) * r;
    const outX = cur.x + ((next.x - cur.x) / outLen) * r;
    const outY = cur.y + ((next.y - cur.y) / outLen) * r;
    d += ` L ${inX} ${inY} Q ${cur.x} ${cur.y} ${outX} ${outY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function routePoints(a, b, aVertical, bVertical) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 2) return [a, b];
  if (Math.abs(dy) < 2) return [a, { x: b.x, y: a.y }, b];
  if (aVertical && bVertical) {
    const midY = a.y + dy / 2;
    return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
  }
  if (!aVertical && !bVertical) {
    const midX = a.x + dx / 2;
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  if (aVertical) return [a, { x: a.x, y: b.y }, b];
  return [a, { x: b.x, y: a.y }, b];
}

export function createEditor({ svg, store, onSelection, onNotice }) {
  const viewport = svg.parentElement;
  let pan = { x: 40, y: 40 };
  let zoom = 0.62;
  let tool = 'select';
  let selection = null; // {type:'node'|'wire', id}
  let selected = new Set();
  let pending = null; // {node, terminal}
  let drag = null;
  let panning = null;
  let spaceDown = false;
  let hoverTerminal = null;
  let lastSize = { w: 1800, h: 1100 };
  let sizedMap = new Map();

  const state = () => store.get();
  const doc = () => state().doc;

  function selectedNodeIds() {
    return selected.size ? [...selected] : (selection?.type === 'node' ? [selection.id] : []);
  }

  // ------------------------------------------------------------- geometry
  function terminalPoint(node, terminalId) {
    const def = CATALOG_BY_ID[node.type];
    const term = def?.terminals.find((t) => t.id === terminalId);
    const moving = drag?.positions.get(node.id);
    const x = moving ? moving.x : node.x;
    const y = moving ? moving.y : node.y;
    if (!term) return { x: x + node.w / 2, y: y + node.h / 2, vertical: true };
    return {
      x: x + node.w * term.x,
      y: y + node.h * term.y,
      vertical: term.x === 0.5,
    };
  }

  function wireGeometry(wire) {
    const d = doc();
    const from = d.nodes.find((n) => n.id === wire.from.node);
    const to = d.nodes.find((n) => n.id === wire.to.node);
    if (!from || !to) return null;
    const a = terminalPoint(from, wire.from.terminal);
    const b = terminalPoint(to, wire.to.terminal);
    const points = routePoints(a, b, a.vertical, b.vertical);
    return { d: roundedPath(points), points, a, b };
  }

  function worldPoint(evt) {
    const rect = svg.getBoundingClientRect();
    return { x: (evt.clientX - rect.left - pan.x) / zoom, y: (evt.clientY - rect.top - pan.y) / zoom };
  }

  // --------------------------------------------------------------- render
  function render() {
    const d = doc();
    const width = svg.clientWidth || viewport.clientWidth || 1200;
    const height = svg.clientHeight || viewport.clientHeight || 800;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    lastSize = { w: width, h: height };

    const defs = `
      <defs>
        <pattern id="grid-minor" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e3e9ef" stroke-width="1"/>
        </pattern>
        <pattern id="grid-major" width="100" height="100" patternUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="url(#grid-minor)"/>
          <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#d3dde6" stroke-width="1"/>
        </pattern>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#0f1c2e" flood-opacity="0.10"/>
        </filter>
      </defs>`;

    const sheet = `
      <rect x="0" y="0" width="1800" height="1100" fill="#ffffff" stroke="#c9d4de" stroke-width="1.5"/>
      <rect x="14" y="14" width="1772" height="1072" fill="none" stroke="#c9d4de" stroke-width="1"/>
      <text x="32" y="42" class="sheet-kicker">${escapeXml(d.name.toUpperCase())}</text>
      <text x="1768" y="42" text-anchor="end" class="sheet-kicker">${escapeXml(d.settings.standard.toUpperCase())} · ${d.settings.units === 'AWG' ? 'AWG' : 'mm²'} · ${escapeXml(d.rev ? `REV ${d.rev}` : '')}</text>`;

    const titleBlock = renderTitleBlock(d);

    const wires = (d.wires || []).map((wire) => renderWire(wire)).join('');
    const nodes = (d.nodes || []).map((node) => renderNode(node)).join('');

    svg.innerHTML = `${defs}
      <rect width="100%" height="100%" fill="#f4f7fa"/>
      <g transform="translate(${pan.x} ${pan.y}) scale(${zoom})">
        ${sheet}
        ${titleBlock}
        <g class="wires">${wires}</g>
        <g class="nodes">${nodes}</g>
        ${renderPending()}
      </g>`;
  }

  function renderTitleBlock(d) {
    const x = 1800 - 372;
    const y = 1100 - 130;
    const cell = (cx, cy, label, value, w = 118) => `
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + 44}" stroke="#c9d4de"/>
      <text x="${cx + 8}" y="${cy + 15}" class="tb-label">${label}</text>
      <text x="${cx + 8}" y="${cy + 31}" class="tb-value">${escapeXml(value || '—')}</text>`;
    return `
      <g class="titleblock">
        <rect x="${x}" y="${y}" width="358" height="126" fill="#fbfcfd" stroke="#9fb0c0" stroke-width="1.2"/>
        <text x="${x + 12}" y="${y + 22}" class="tb-title">${escapeXml(d.name)}</text>
        <text x="${x + 12}" y="${y + 40}" class="tb-sub">${escapeXml(d.notes || 'Electrical schematic')}</text>
        <line x1="${x}" y1="${y + 50}" x2="${x + 358}" y2="${y + 50}" stroke="#9fb0c0"/>
        ${cell(x, y + 50, 'DRAWING NO.', d.drawingNo, 90)}
        ${cell(x + 90, y + 50, 'REV', d.rev, 50)}
        ${cell(x + 140, y + 50, 'DATE', d.date, 90)}
        ${cell(x + 230, y + 50, 'CLIENT', d.client, 128)}
        <line x1="${x}" y1="${y + 94}" x2="${x + 358}" y2="${y + 94}" stroke="#e0e7ee"/>
        <text x="${x + 12}" y="${y + 112}" class="tb-label">PROJECT</text>
        <text x="${x + 70}" y="${y + 112}" class="tb-value">${escapeXml(d.projectRef || '—')}</text>
        <text x="${x + 250}" y="${y + 112}" class="tb-label">REF</text>
        <text x="${x + 282}" y="${y + 112}" class="tb-value">${escapeXml(d.drawingNo)}</text>
      </g>`;
  }

  function renderNode(node) {
    const pos = drag?.positions.get(node.id) || node;
    const def = CATALOG_BY_ID[node.type];
    if (!def) return '';
    const isSelected = selection?.type === 'node' ? selection.id === node.id : selected.has(node.id);
    const terminals = def.terminals.map((t) => {
      const x = node.w * t.x;
      const y = node.h * t.y;
      const active = pending && pending.node === node.id && pending.terminal === t.id;
      const hovered = hoverTerminal && hoverTerminal.node === node.id && hoverTerminal.terminal === t.id;
      const r = active ? 6 : hovered ? 6 : 4.5;
      return `${hovered ? `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#0e7c86" stroke-width="2" opacity=".9" pointer-events="none"/>` : ''}
        <circle class="terminal ${active ? 'terminal-active' : ''}" data-terminal="${t.id}" data-node="${node.id}"
        cx="${x}" cy="${y}" r="${r}" fill="${WIRE_COLORS[t.kind] || '#1d2b3a'}" stroke="#ffffff" stroke-width="2">
        <title>${TERMINAL_KINDS[t.kind]?.label || t.kind} — ${t.label}</title></circle>`;
    }).join('');
    const hoverTerm = hoverTerminal && hoverTerminal.node === node.id
      ? def.terminals.find((t) => t.id === hoverTerminal.terminal) : null;
    const tip = hoverTerm ? (() => {
      const x = node.w * hoverTerm.x;
      const y = node.h * hoverTerm.y;
      const value = hoverTerm.label;
      const width = 14 + value.length * 5.6;
      const tx = hoverTerm.x > 0.62 ? -(width + 11) : 11;
      return `<g class="terminal-tip" transform="translate(${x} ${y}) scale(${1 / zoom})" pointer-events="none">
        <rect x="${tx}" y="-10" width="${width}" height="20" rx="4" fill="#1d2b3a"/>
        <text x="${tx + width / 2}" y="4" text-anchor="middle" font-size="10" font-weight="600"
          font-family="IBM Plex Sans, system-ui, sans-serif" fill="#ffffff">${escapeXml(value)}</text>
      </g>`;
    })() : '';
    return `
      <g class="node ${isSelected ? 'node-selected' : ''}" data-node="${node.id}" transform="translate(${pos.x} ${pos.y})">
        <rect class="node-hit" x="-2" y="-2" width="${node.w + 4}" height="${node.h + 4}" rx="8" fill="transparent"/>
        <g class="node-art" filter="url(#soft)">${renderSymbol(node, def.symbol)}</g>
        ${isSelected ? `<rect class="selection" x="-5" y="-5" width="${node.w + 10}" height="${node.h + 10}" rx="9" fill="none" stroke="#0e7c86" stroke-width="2" stroke-dasharray="6 4"/>` : ''}
        ${terminals}
        ${tip}
      </g>`;
  }

  function renderWire(wire) {
    const geo = wireGeometry(wire);
    if (!geo) return '';
    const sized = sizedMap.get(wire.id);
    const color = WIRE_COLORS[sized?.kind] || '#1d2b3a';
    const isSelected = selection?.type === 'wire' && selection.id === wire.id;
    const mid = geo.points[Math.floor(geo.points.length / 2)];
    const prev = geo.points[Math.floor(geo.points.length / 2) - 1] || geo.points[0];
    const horizontal = Math.abs(mid.x - prev.x) >= Math.abs(mid.y - prev.y);
    const sign = sized?.kind?.endsWith('+') || sized?.kind === 'ac-l' ? 1 : -1;
    const labelX = (mid.x + prev.x) / 2 + (horizontal ? 0 : sign * 11);
    const labelY = (mid.y + prev.y) / 2 - 8 + (horizontal ? -sign * 9 : 0);
    const sizeText = sized ? formatSize(sized.size, sized.unit) : '—';
    const fuseText = sized?.fuse ? ` · ${sized.fuse.ratingA} A` : '';
    const labelText = `${sizeText}${fuseText}`;
    const width = 14 + labelText.length * 5.6;
    return `
      <g class="wire ${isSelected ? 'wire-selected' : ''}" data-wire="${wire.id}">
        <path d="${geo.d}" fill="none" stroke="transparent" stroke-width="18" class="wire-hit"/>
        <path d="${geo.d}" fill="none" stroke="${isSelected ? '#0e7c86' : color}" stroke-width="${isSelected ? 3.4 : 2.2}" stroke-linecap="round" stroke-linejoin="round"/>
        ${sized?.fuseOverCable || !sized?.ampacityPass ? `<path d="${geo.d}" fill="none" stroke="#c2413b" stroke-width="1" stroke-dasharray="2 4"/>` : ''}
        <rect x="${labelX - width / 2}" y="${labelY - 11}" width="${width}" height="17" rx="3" fill="#ffffff" stroke="${isSelected ? '#0e7c86' : '#dbe3ea'}"/>
        <text x="${labelX}" y="${labelY + 1}" class="wire-label" fill="${isSelected ? '#0e7c86' : '#526273'}">${escapeXml(labelText)}</text>
      </g>`;
  }

  function renderPending() {
    if (!pending) return '';
    const node = doc().nodes.find((n) => n.id === pending.node);
    if (!node) return '';
    const p = terminalPoint(node, pending.terminal);
    return `<circle cx="${p.x}" cy="${p.y}" r="12" fill="none" stroke="#0e7c86" stroke-width="2" stroke-dasharray="3 3"/>`;
  }

  function centerOn(point) {
    const w = svg.clientWidth || 1200;
    const h = svg.clientHeight || 800;
    if (zoom < 0.55) zoom = 0.85;
    pan = { x: w / 2 - point.x * zoom, y: h / 2 - point.y * zoom };
    render();
  }

  function revealNode(id) {
    const node = doc().nodes.find((n) => n.id === id);
    if (!node) return;
    centerOn({ x: node.x + node.w / 2, y: node.y + node.h / 2 });
  }

  function revealWire(id) {
    const wire = doc().wires.find((w) => w.id === id);
    if (!wire) return;
    const geo = wireGeometry(wire);
    if (!geo) return;
    const mid = geo.points[Math.floor(geo.points.length / 2)];
    centerOn(mid);
  }

  // -------------------------------------------------------------- selection
  function select(next, additive = false) {
    hoverTerminal = null;
    if (!next) {
      selection = null;
      selected.clear();
    } else if (next.type === 'node' && additive) {
      if (selected.has(next.id)) selected.delete(next.id); else selected.add(next.id);
      selection = selected.size ? { type: 'node', id: [...selected][selected.size - 1] } : null;
    } else {
      selection = next;
      selected.clear();
      if (next.type === 'node') selected.add(next.id);
    }
    render();
    onSelection?.(selection);
  }

  // ------------------------------------------------------------ interaction
  svg.addEventListener('wheel', (evt) => {
    evt.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;
    const before = { x: (mx - pan.x) / zoom, y: (my - pan.y) / zoom };
    const factor = Math.exp(-evt.deltaY * 0.0015);
    zoom = Math.max(0.15, Math.min(2.6, zoom * factor));
    pan = { x: mx - before.x * zoom, y: my - before.y * zoom };
    render();
  }, { passive: false });

  svg.addEventListener('pointerdown', (evt) => {
    if (evt.button === 1 || spaceDown) {
      panning = { startX: evt.clientX, startY: evt.clientY, pan: { ...pan } };
      svg.setPointerCapture(evt.pointerId);
      svg.classList.add('panning');
      return;
    }
    const terminalEl = evt.target.closest?.('[data-terminal]');
    const nodeEl = evt.target.closest?.('[data-node]');
    const wireEl = evt.target.closest?.('[data-wire]');

    if (terminalEl) {
      const nodeId = terminalEl.dataset.node;
      const terminal = terminalEl.dataset.terminal;
      if (tool === 'wire' || pending) {
        if (!pending) pending = { node: nodeId, terminal };
        else if (pending.node === nodeId && pending.terminal === terminal) pending = null;
        else {
          finishWire(pending, { node: nodeId, terminal });
          pending = null;
        }
        render();
        return;
      }
      // In select mode, dragging from a terminal also starts a wire.
      pending = { node: nodeId, terminal };
      render();
      return;
    }

    if (nodeEl) {
      const id = nodeEl.dataset.node;
      if (evt.shiftKey) select({ type: 'node', id }, true);
      else if (selection?.id !== id) select({ type: 'node', id });
      const node = doc().nodes.find((n) => n.id === id);
      if (!node) return;
      const point = worldPoint(evt);
      const ids = selectedNodeIds();
      const origins = new Map(ids.map((nid) => {
        const item = doc().nodes.find((n) => n.id === nid);
        return [nid, { x: item.x, y: item.y }];
      }));
      drag = {
        start: point,
        moved: false,
        origins,
        positions: new Map([...origins].map(([nid, p]) => [nid, { ...p }])),
      };
      svg.setPointerCapture(evt.pointerId);
      return;
    }

    if (wireEl) {
      select({ type: 'wire', id: wireEl.dataset.wire });
      return;
    }

    if (pending) { pending = null; render(); return; }
    select(null);
    panning = { startX: evt.clientX, startY: evt.clientY, pan: { ...pan } };
    svg.setPointerCapture(evt.pointerId);
    svg.classList.add('panning');
  });

  svg.addEventListener('pointermove', (evt) => {
    if (panning) {
      pan = { x: panning.pan.x + (evt.clientX - panning.startX), y: panning.pan.y + (evt.clientY - panning.startY) };
      render();
      return;
    }
    if (drag) {
      const point = worldPoint(evt);
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
      for (const [id, origin] of drag.origins) {
        const node = doc().nodes.find((n) => n.id === id);
        if (!node) continue;
        let x = origin.x + dx;
        let y = origin.y + dy;
        if (!evt.altKey) { x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID; }
        drag.positions.set(id, { x, y });
      }
      render();
      return;
    }
    if (pending) {
      const terminalEl = evt.target.closest?.('[data-terminal]');
      const next = terminalEl ? { node: terminalEl.dataset.node, terminal: terminalEl.dataset.terminal } : null;
      const same = (!next && !hoverTerminal) || (next && hoverTerminal && next.node === hoverTerminal.node && next.terminal === hoverTerminal.terminal);
      if (!same) { hoverTerminal = next; render(); }
    }
  });

  svg.addEventListener('pointerup', (evt) => {
    if (panning) {
      panning = null;
      svg.classList.remove('panning');
      return;
    }
    if (drag) {
      if (drag.moved) {
        const positions = drag.positions;
        const ids = [...positions.keys()];
        store.mutate((d) => {
          for (const id of ids) {
            const node = d.nodes.find((n) => n.id === id);
            if (node) Object.assign(node, positions.get(id));
          }
        });
      }
      drag = null;
      render();
      return;
    }
    if (pending) {
      // Released outside the canvas: keep the wire pending so it can be finished.
      return;
    }
  });

  svg.addEventListener('dblclick', (evt) => {
    const nodeEl = evt.target.closest?.('[data-node]');
    if (nodeEl) {
      select({ type: 'node', id: nodeEl.dataset.node });
      onSelection?.(selection, { focusLabel: true });
    }
  });

  function finishWire(from, to) {
    if (from.node === to.node) {
      onNotice?.('A cable needs two different components.');
      return;
    }
    const exists = doc().wires.some((w) => (
      (w.from.node === from.node && w.from.terminal === from.terminal && w.to.node === to.node && w.to.terminal === to.terminal)
      || (w.to.node === from.node && w.to.terminal === from.terminal && w.from.node === to.node && w.from.terminal === to.terminal)
    ));
    if (exists) { onNotice?.('Those terminals are already wired.'); return; }
    const id = `w_${Math.random().toString(36).slice(2, 9)}`;
    store.mutate((d) => {
      d.wires.push({ id, from, to, lengthM: 1 });
    });
    select({ type: 'wire', id });
  }

  function deleteSelection() {
    if (selected.size) {
      store.mutate((d) => {
        d.nodes = d.nodes.filter((n) => !selected.has(n.id));
        d.wires = d.wires.filter((w) => !selected.has(w.from.node) && !selected.has(w.to.node));
      });
      select(null);
      return;
    }
    if (!selection) return;
    store.mutate((d) => {
      if (selection.type === 'node') {
        d.nodes = d.nodes.filter((n) => n.id !== selection.id);
        d.wires = d.wires.filter((w) => w.from.node !== selection.id && w.to.node !== selection.id);
      } else {
        d.wires = d.wires.filter((w) => w.id !== selection.id);
      }
    });
    select(null);
  }

  function duplicateSelection() {
    const ids = selectedNodeIds();
    if (!ids.length) return;
    const mapping = new Map();
    store.mutate((d) => {
      for (const id of ids) {
        const source = d.nodes.find((n) => n.id === id);
        if (!source) continue;
        const copy = { ...structuredClone(source), id: `n_${Math.random().toString(36).slice(2, 9)}`, x: source.x + 30, y: source.y + 30 };
        mapping.set(id, copy.id);
        d.nodes.push(copy);
      }
      for (const w of [...d.wires]) {
        if (mapping.has(w.from.node) && mapping.has(w.to.node)) {
          d.wires.push({ ...structuredClone(w), id: `w_${Math.random().toString(36).slice(2, 9)}`, from: { ...w.from, node: mapping.get(w.from.node) }, to: { ...w.to, node: mapping.get(w.to.node) } });
        }
      }
    });
    selected = new Set(mapping.values());
    selection = { type: 'node', id: [...selected][0] };
    render();
    onSelection?.(selection);
  }

  // ------------------------------------------------------------------ view
  function fit() {
    const nodes = doc().nodes;
    if (!nodes.length) {
      pan = { x: 40, y: 40 }; zoom = 0.62; render(); return;
    }
    const minX = Math.min(...nodes.map((n) => n.x)) - 60;
    const minY = Math.min(...nodes.map((n) => n.y)) - 80;
    const maxX = Math.max(...nodes.map((n) => n.x + n.w)) + 60;
    const maxY = Math.max(...nodes.map((n) => n.y + n.h)) + 80;
    const w = svg.clientWidth || 1200;
    const h = svg.clientHeight || 800;
    zoom = Math.min((w - 60) / (maxX - minX), (h - 60) / (maxY - minY), 1.2);
    zoom = Math.max(0.15, Math.min(2.2, zoom));
    pan = { x: (w - (maxX - minX) * zoom) / 2 - minX * zoom, y: (h - (maxY - minY) * zoom) / 2 - minY * zoom };
    render();
  }

  function zoomBy(factor) {
    const w = svg.clientWidth || 1200;
    const h = svg.clientHeight || 800;
    const cx = { x: (w / 2 - pan.x) / zoom, y: (h / 2 - pan.y) / zoom };
    zoom = Math.max(0.15, Math.min(2.6, zoom * factor));
    pan = { x: w / 2 - cx.x * zoom, y: h / 2 - cx.y * zoom };
    render();
  }

  // ------------------------------------------------------------------ wire
  function setTool(next) {
    tool = next;
    if (next !== 'wire') pending = null;
    render();
  }

  function addNodeAt(typeId, clientX, clientY) {
    const point = clientX != null ? worldPoint({ clientX, clientY }) : { x: 200, y: 200 };
    const def = CATALOG_BY_ID[typeId];
    const id = `n_${Math.random().toString(36).slice(2, 9)}`;
    store.mutate((d) => {
      d.nodes.push({
        id, type: typeId, label: def.label,
        x: Math.round((point.x - def.w / 2) / GRID) * GRID,
        y: Math.round((point.y - def.h / 2) / GRID) * GRID,
        w: def.w, h: def.h, props: { ...def.defaults }, brand: '', model: '', price: def.price, notes: '',
      });
    });
    select({ type: 'node', id });
  }

  function exportSvgString() {
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', '1800');
    clone.setAttribute('height', '1100');
    clone.setAttribute('viewBox', '0 0 1800 1100');
    // Strip the interactive viewport transform, keep the drawing world.
    const world = clone.querySelector('g[transform]');
    if (world) world.setAttribute('transform', 'translate(20 20) scale(1)');
    clone.querySelectorAll('.terminal').forEach((t) => t.remove());
    clone.querySelectorAll('.node-hit, .wire-hit').forEach((t) => t.remove());
    clone.querySelectorAll('.selection').forEach((t) => t.remove());
    return new XMLSerializer().serializeToString(clone);
  }

  // ------------------------------------------------------------------ keys
  window.addEventListener('keydown', (evt) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (typing) return;
    if (evt.code === 'Space') { spaceDown = true; svg.classList.add('space'); }
    if ((evt.key === 'Delete' || evt.key === 'Backspace')) { evt.preventDefault(); deleteSelection(); }
    if (evt.key === 'Escape') { pending = null; select(null); render(); }
    if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === 'z') {
      evt.preventDefault();
      if (evt.shiftKey) store.redo(); else store.undo();
    }
    if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === 'd') { evt.preventDefault(); duplicateSelection(); }
    if (evt.key.toLowerCase() === 'w') setTool('wire');
    if (evt.key.toLowerCase() === 'v') setTool('select');
    if (evt.key === 'f') fit();
  });
  window.addEventListener('keyup', (evt) => {
    if (evt.code === 'Space') { spaceDown = false; svg.classList.remove('space'); }
  });

  window.addEventListener('resize', () => render());

  return {
    render, fit, zoomBy, setTool, addNodeAt, exportSvgString,
    getSelection: () => selection,
    getSelectedNodes: selectedNodeIds,
    clearSelection: () => select(null),
    deleteSelection,
    duplicateSelection,
    getView: () => ({ pan, zoom }),
    setView(nextPan, nextZoom) {
      if (nextPan) pan = nextPan;
      if (nextZoom) zoom = nextZoom;
      render();
    },
    selectNode(id, reveal = false) {
      select({ type: 'node', id });
      if (reveal) revealNode(id);
      onSelection?.(selection);
    },
    selectWire(id, reveal = false) {
      select({ type: 'wire', id });
      if (reveal) revealWire(id);
      onSelection?.(selection);
    },
    setSizedWires(next) {
      sizedMap = next || new Map();
      render();
    },
    highlightTerminal(nodeId, terminalId) {
      const next = nodeId && terminalId ? { node: nodeId, terminal: terminalId } : null;
      const same = (!next && !hoverTerminal)
        || (next && hoverTerminal && next.node === hoverTerminal.node && next.terminal === hoverTerminal.terminal);
      if (same) return;
      hoverTerminal = next;
      render();
    },
    refresh() { render(); },
  };
}

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}
