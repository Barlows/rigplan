// Autorouter regression tests. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { routeWires, terminalNormal } from '../js/ui/router.js?v=20261044';

const bond = (id, a, b) => ({ id, a, b });
const pt = (x, y, nx, ny) => ({ x, y, nx, ny });

const sheet = { w: 1800, h: 1100 };

function inside(p, r, pad = 0) {
  return p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad;
}

test('a routed cable starts and ends on its terminals and stays axis aligned', () => {
  const routes = routeWires({
    bonds: [bond('w1', pt(100, 100, 1, 0), pt(400, 300, -1, 0))],
    obstacles: [],
    sheet,
  });
  const pts = routes.get('w1');
  assert.ok(pts && pts.length >= 3, 'route should have intermediate points');
  assert.deepEqual([pts[0].x, pts[0].y], [100, 100]);
  assert.deepEqual([pts.at(-1).x, pts.at(-1).y], [400, 300]);
  for (let i = 1; i < pts.length; i++) {
    const aligned = Math.abs(pts[i].x - pts[i - 1].x) < 0.5 || Math.abs(pts[i].y - pts[i - 1].y) < 0.5;
    assert.ok(aligned, `segment ${i} is not orthogonal`);
  }
});

test('a routed cable goes around a component instead of behind it', () => {
  const obstacle = { x: 400, y: 100, w: 200, h: 200 };
  const routes = routeWires({
    bonds: [bond('w1', pt(200, 200, 1, 0), pt(800, 200, -1, 0))],
    obstacles: [obstacle],
    sheet,
  });
  const pts = routes.get('w1');
  assert.ok(pts);
  assert.ok(pts.some((p) => inside(p, obstacle, 0)) === false, 'no point sits inside the component');
  for (const p of pts) assert.ok(!inside(p, obstacle, 0), `point ${p.x},${p.y} crosses the component`);
});

test('parallel cables take separate lanes rather than overlapping', () => {
  const nodes = [
    { x: 200, y: 200, w: 160, h: 90 },
    { x: 700, y: 200, w: 160, h: 90 },
  ];
  const routes = routeWires({
    bonds: [
      bond('a', pt(210, 230, -1, 0), pt(790, 230, 1, 0)),
      bond('b', pt(210, 260, -1, 0), pt(790, 260, 1, 0)),
    ],
    obstacles: nodes,
    sheet,
  });
  const a = routes.get('a');
  const b = routes.get('b');
  assert.ok(a && b);
  assert.notDeepEqual(a, b, 'the two cables should not share an identical path');
});

test('terminal normals point away from the component edge', () => {
  assert.deepEqual(terminalNormal({ x: 0, y: 0.5 }), { x: -1, y: 0 });
  assert.deepEqual(terminalNormal({ x: 1, y: 0.5 }), { x: 1, y: 0 });
  assert.deepEqual(terminalNormal({ x: 0.5, y: 0 }), { x: 0, y: -1 });
  assert.deepEqual(terminalNormal({ x: 0.5, y: 1 }), { x: 0, y: 1 });
});
