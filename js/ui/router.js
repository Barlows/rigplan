// Orthogonal autorouter for schematic cables.
//
// Cables should run in the gaps between components, never behind them, and
// should not sit on top of each other. The router lays a coarse grid over the
// sheet, blocks the components (plus a clearance margin) and runs an A* search
// that prefers straight runs (bend penalty) and empty lanes (occupancy penalty).
// Every cable reserves the cells it uses, so later cables fan out into parallel
// lanes instead of overlapping.

const TURN_COST = 6;
const OVERLAP_COST = 16;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const UP = { x: 0, y: -1 };
const DOWN = { x: 0, y: 1 };
const LEFT = { x: -1, y: 0 };
const RIGHT = { x: 1, y: 0 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Outward normal of a terminal placed on a component edge. */
export function terminalNormal(term) {
  if (!term) return DOWN;
  if (term.y <= 0.001) return UP;
  if (term.y >= 0.999) return DOWN;
  if (term.x <= 0.001) return LEFT;
  if (term.x >= 0.999) return RIGHT;
  if (term.x <= 0.2) return LEFT;
  if (term.x >= 0.8) return RIGHT;
  if (term.y <= 0.35) return UP;
  if (term.y >= 0.65) return DOWN;
  return UP;
}

/** A tiny binary heap of (priority, value) pairs. */
class MinHeap {
  constructor() { this.items = []; }

  get size() { return this.items.length; }

  push(f, value) {
    const items = this.items;
    items.push({ f, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].f <= items[i].f) break;
      const swap = items[parent];
      items[parent] = items[i];
      items[i] = swap;
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    if (!items.length) return undefined;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < items.length && items[l].f < items[small].f) small = l;
        if (r < items.length && items[r].f < items[small].f) small = r;
        if (small === i) break;
        const swap = items[small];
        items[small] = items[i];
        items[i] = swap;
        i = small;
      }
    }
    return top.value;
  }
}

/**
 * Route a set of cables around obstacles.
 *
 * @param {object} options
 * @param {Array<{id:string, a:{x,y,nx,ny}, b:{x,y,nx,ny}}>} options.bonds
 *   Each bond is one cable. `a`/`b` are the terminal points and `nx`/`ny` the
 *   outward normal of the terminal (the direction the cable must leave).
 * @param {Array<{x,y,w,h}>} options.obstacles Components to avoid.
 * @param {{w:number,h:number}} options.sheet Drawing extent.
 * @param {number} [options.cell] Grid cell size in drawing units.
 * @param {number} [options.margin] Clearance kept around every obstacle.
 * @returns {Map<string, Array<{x:number,y:number}>>} Points per cable id.
 */
export function routeWires({ bonds = [], obstacles = [], sheet = { w: 1800, h: 1100 }, cell = 10, margin = 8 } = {}) {
  const result = new Map();
  if (!bonds.length) return result;

  const cols = Math.max(1, Math.ceil(sheet.w / cell));
  const rows = Math.max(1, Math.ceil(sheet.h / cell));
  const total = cols * rows;
  const blocked = new Uint8Array(total);
  const occupancy = new Uint16Array(total);
  const idx = (cx, cy) => cy * cols + cx;

  for (const o of obstacles) {
    const x0 = Math.max(0, Math.floor((o.x - margin) / cell));
    const y0 = Math.max(0, Math.floor((o.y - margin) / cell));
    const x1 = Math.min(cols - 1, Math.ceil((o.x + o.w + margin) / cell) - 1);
    const y1 = Math.min(rows - 1, Math.ceil((o.y + o.h + margin) / cell) - 1);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) blocked[idx(cx, cy)] = 1;
    }
  }

  // A* scratch, reused across cables and reset with a visit token. A search
  // state is (cell, heading), so the arrays cover four states per cell.
  const states = total * 4;
  const stamp = new Int32Array(states);
  const gScore = new Float64Array(states);
  const came = new Int32Array(states);
  let token = 0;

  const cellOf = (p) => ({
    cx: clamp(Math.floor(p.x / cell), 0, cols - 1),
    cy: clamp(Math.floor(p.y / cell), 0, rows - 1),
  });
  const center = (cx, cy) => ({ x: (cx + 0.5) * cell, y: (cy + 0.5) * cell });

  function nearestFree(cx, cy) {
    const sx = clamp(cx, 0, cols - 1);
    const sy = clamp(cy, 0, rows - 1);
    if (!blocked[idx(sx, sy)]) return { cx: sx, cy: sy };
    const max = Math.max(cols, rows);
    for (let r = 1; r < max; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = sx + dx;
          const y = sy + dy;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          if (!blocked[idx(x, y)]) return { cx: x, cy: y };
        }
      }
    }
    return null;
  }

  /** Step out of the component along the terminal normal until a free cell. */
  function escapeCell(cx, cy, n) {
    for (let step = 0; step < 16; step++) {
      const x = cx + n.x * step;
      const y = cy + n.y * step;
      if (x < 0 || y < 0 || x >= cols || y >= rows) break;
      if (!blocked[idx(x, y)]) return { cx: x, cy: y };
    }
    return nearestFree(cx, cy);
  }

  function search(start, goal) {
    token += 1;
    const t = token;
    const heap = new MinHeap();
    const s = idx(start.cx, start.cy);
    const g = idx(goal.cx, goal.cy);
    const h = (cx, cy) => Math.abs(cx - goal.cx) + Math.abs(cy - goal.cy);

    for (let d = 0; d < 4; d++) {
      const nx = start.cx + DIRS[d][0];
      const ny = start.cy + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nc = idx(nx, ny);
      if (blocked[nc]) continue;
      const st = nc * 4 + d;
      const cost = 1 + occupancy[nc] * OVERLAP_COST;
      stamp[st] = t;
      gScore[st] = cost;
      came[st] = s * 4;
      heap.push(cost + h(nx, ny), st);
    }

    let expanded = 0;
    const limit = total * 8;
    while (heap.size) {
      const st = heap.pop();
      const c = st >> 2;
      if (c === g) {
        const cells = [];
        let cursor = st;
        while (cursor >= 0) {
          const cc = cursor >> 2;
          cells.push({ cx: cc % cols, cy: Math.floor(cc / cols) });
          if (cc === s) break;
          cursor = came[cursor];
        }
        cells.reverse();
        if (cells.length && cells[0].cx === start.cx && cells[0].cy === start.cy) cells.shift();
        return cells;
      }
      if (++expanded > limit) break;
      const dir = st & 3;
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      const base = gScore[st];
      for (let d = 0; d < 4; d++) {
        const nx = cx + DIRS[d][0];
        const ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nc = idx(nx, ny);
        if (blocked[nc]) continue;
        const nst = nc * 4 + d;
        const cost = base + 1 + (d === dir ? 0 : TURN_COST) + occupancy[nc] * OVERLAP_COST;
        if (stamp[nst] === t && gScore[nst] <= cost) continue;
        stamp[nst] = t;
        gScore[nst] = cost;
        came[nst] = st;
        heap.push(cost + h(nx, ny), nst);
      }
    }
    return null;
  }

  const pushPoint = (pts, p) => {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) return;
    pts.push({ x: p.x, y: p.y });
  };

  // Longest cables first: they get first pick of the clear channels.
  const ordered = [...bonds].sort((p, q) => {
    const pa = Math.abs(q.b.x - q.a.x) + Math.abs(q.b.y - q.a.y);
    const pb = Math.abs(p.b.x - p.a.x) + Math.abs(p.b.y - p.a.y);
    return pa - pb;
  });

  for (const bond of ordered) {
    const a = bond.a;
    const b = bond.b;
    const na = { x: Math.sign(a.nx || 0), y: Math.sign(a.ny || 0) };
    const nb = { x: Math.sign(b.nx || 0), y: Math.sign(b.ny || 0) };
    if (!na.x && !na.y) na.y = -1;
    if (!nb.x && !nb.y) nb.y = -1;

    const startA = escapeCell(cellOf(a).cx, cellOf(a).cy, na);
    const startB = escapeCell(cellOf(b).cx, cellOf(b).cy, nb);
    if (!startA || !startB) continue;
    const cells = search(startA, startB);
    if (!cells || !cells.length) continue;

    const first = center(cells[0].cx, cells[0].cy);
    const last = center(cells[cells.length - 1].cx, cells[cells.length - 1].cy);
    const stubA = na.x !== 0 ? { x: first.x, y: a.y } : { x: a.x, y: first.y };
    const stubB = nb.x !== 0 ? { x: last.x, y: b.y } : { x: b.x, y: last.y };

    const pts = [];
    pushPoint(pts, a);
    pushPoint(pts, stubA);
    for (const c of cells) pushPoint(pts, center(c.cx, c.cy));
    pushPoint(pts, stubB);
    pushPoint(pts, b);

    // Drop collinear midpoints so the path is a clean set of runs.
    for (let i = 1; i < pts.length - 1;) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const cross = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
      if (Math.abs(cross) < 0.01) pts.splice(i, 1);
      else i++;
    }

    result.set(bond.id, pts);
    for (const c of cells) {
      const i = idx(c.cx, c.cy);
      if (occupancy[i] < 65000) occupancy[i] += 1;
    }
  }

  return result;
}
