// Original SVG artwork for the component library. Every symbol is drawn from
// primitives in the node's own coordinate space so it scales with the canvas.

const INK = '#1d2b3a';
const MUTED = '#6b7a8c';
const ACCENT = '#0e7c86';
const PAPER = '#ffffff';
const WARM = '#c2413b';

const rect = (x, y, w, h, r = 6, fill = PAPER, stroke = INK, sw = 1.6) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;

const line = (x1, y1, x2, y2, stroke = INK, sw = 1.6, dash = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`;

const circle = (cx, cy, r, fill = PAPER, stroke = INK, sw = 1.6) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;

const esc = (value) => String(value ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

const text = (x, y, value, size = 11, fill = MUTED, anchor = 'middle', weight = 500) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" font-family="IBM Plex Sans, system-ui, sans-serif">${esc(value)}</text>`;

const label = (w, h, value) =>
  `<text x="${w / 2}" y="${h + 17}" font-size="9" fill="${MUTED}" text-anchor="middle" font-weight="600" font-family="IBM Plex Sans, system-ui, sans-serif" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round">${esc(value)}</text>`;

const head = (w, h, rule = true) => (rule ? line(8, 16, w - 8, 16, '#d5dde5', 1) : '');

export function renderSymbol(node, symbolKey) {
  const { w, h } = node;
  const fn = SYMBOLS[symbolKey || node.type];
  const body = fn ? fn(w, h, node) : SYMBOLS.default(w, h, node);
  return `${body}${label(w, h, node.label.length > 26 ? `${node.label.slice(0, 24)}…` : node.label)}`;
}

const SYMBOLS = {
  default: (w, h, node) => rect(10, 10, w - 20, h - 20, 8) + line(10, 26, w - 10, 26, '#d5dde5', 1),

  battery: (w, h, node) => {
    const x = 14; const y = 18; const bw = w - 28; const bh = h - 40;
    return rect(x, y, bw, bh, 4) +
      line(x + bw - 22, y + 8, x + bw - 22, y + bh - 8, INK, 3) +
      line(x + bw - 14, y + 14, x + bw - 14, y + bh - 14, INK, 1.4) +
      text(x + 12, y + 18, '+', 14, WARM, 'start', 700) +
      text(x + 12, y + bh - 8, '−', 14, INK, 'start', 700) +
      text(x + bw / 2 + 4, y + bh / 2 + 4, `${node.props?.voltage ?? 12} V`, 11, INK, 'middle', 600);
  },

  panel: (w, h, node) => {
    const x = 12; const y = 14; const bw = w - 24; const bh = h - 36;
    let grid = '';
    for (let i = 1; i < 4; i++) grid += line(x + (bw / 4) * i, y, x + (bw / 4) * i, y + bh, '#9fb3c8', 0.9);
    for (let i = 1; i < 3; i++) grid += line(x, y + (bh / 3) * i, x + bw, y + (bh / 3) * i, '#9fb3c8', 0.9);
    return rect(x, y, bw, bh, 2) + grid +
      `<circle cx="${x + bw - 14}" cy="${y + 12}" r="6" fill="#f6c453"/>` +
      text(x + bw / 2, y + bh + 14, `${node.props?.watts ?? 200} W`, 10, ACCENT, 'middle', 600);
  },

  alternator: (w, h, node) => circle(w / 2, h / 2 - 4, 22) + circle(w / 2, h / 2 - 4, 9) +
    line(w / 2 - 8, h / 2 - 4, w / 2 + 8, h / 2 - 4, ACCENT, 2) +
    text(w / 2, h - 10, 'ALT', 9, MUTED, 'middle', 700),

  shore: (w, h, node) => {
    const cx = w / 2; const cy = h / 2 - 6;
    return circle(cx, cy, 24) +
      line(cx - 9, cy - 8, cx - 9, cy + 4, INK, 2.4) +
      line(cx + 9, cy - 8, cx + 9, cy + 4, INK, 2.4) +
      `<path d="M ${cx - 14} ${cy + 6} Q ${cx} ${cy + 18} ${cx + 14} ${cy + 6}" fill="none" stroke="${INK}" stroke-width="2"/>` +
      text(cx, h - 10, 'SHORE', 8, MUTED, 'middle', 700);
  },

  generator: (w, h, node) => rect(14, 16, w - 28, h - 38, 6) +
    text(w / 2, h / 2 + 4, 'G', 22, ACCENT, 'middle', 700) +
    text(w / 2, h - 12, `${node.props?.watts ?? 3000} W`, 9, MUTED, 'middle', 600),

  mppt: (w, h, node) => rect(12, 14, w - 24, h - 34, 6) +
    `<circle cx="${w / 2}" cy="${h / 2 - 4}" r="8" fill="#f6c453"/>` +
    `<path d="M ${w / 2 - 16} ${h / 2 + 4} l 32 0 l -6 -7 M ${w / 2 + 16} ${h / 2 + 4} l -32 0 l 6 -7" fill="none" stroke="${ACCENT}" stroke-width="1.8"/>` +
    text(w / 2, 12, 'MPPT', 9, MUTED, 'middle', 700) +
    text(w / 2, h / 2 + 24, `${node.props?.outputA ?? 30} A`, 9, INK, 'middle', 600),

  dcdc: (w, h, node) => rect(12, 14, w - 24, h - 34, 6) +
    text(w / 2, h / 2 - 6, 'DC', 10, MUTED, 'middle', 700) +
    `<path d="M ${w / 2 - 16} ${h / 2} l 32 0 l -6 -5 M ${w / 2 + 16} ${h / 2} l -32 0 l 6 5" fill="none" stroke="${ACCENT}" stroke-width="1.8"/>` +
    text(w / 2, h / 2 + 18, 'DC', 10, MUTED, 'middle', 700) +
    text(w / 2, h - 10, `${node.props?.outputA ?? 30} A`, 9, INK, 'middle', 600),

  charger: (w, h, node) => rect(12, 14, w - 24, h - 34, 6) +
    text(w / 2, h / 2 - 2, 'AC', 11, ACCENT, 'middle', 700) +
    line(w / 2 - 18, h / 2 + 6, w / 2 + 18, h / 2 + 6, INK, 1.6) +
    line(w / 2 - 10, h / 2 + 12, w / 2 + 10, h / 2 + 12, INK, 1.6) +
    text(w / 2, h - 10, `${node.props?.outputA ?? 30} A`, 9, INK, 'middle', 600),

  inverter: (w, h, node) => rect(12, 14, w - 24, h - 34, 6) +
    `<path d="M ${w / 2 - 22} ${h / 2 - 2} q 6 -10 11 0 t 11 0 t 11 0 t 11 0" fill="none" stroke="${ACCENT}" stroke-width="2"/>` +
    text(w / 2, h - 10, `${node.props?.watts ?? 2000} W`, 9, INK, 'middle', 600),

  invertercharger: (w, h, node) => rect(12, 14, w - 24, h - 34, 6) +
    `<path d="M ${w / 2 - 22} ${h / 2 - 6} q 5 -9 10 0 t 10 0 t 10 0 t 10 0" fill="none" stroke="${ACCENT}" stroke-width="2"/>` +
    line(w / 2 - 14, h / 2 + 12, w / 2 + 14, h / 2 + 12, INK, 1.4) +
    text(w * 0.3, h - 24, 'DC IN', 7, MUTED, 'middle', 700) +
    text(w * 0.72, 24, 'AC IN', 7, MUTED, 'middle', 700) +
    text(w * 0.8, h - 24, 'AC OUT', 7, MUTED, 'middle', 700) +
    text(w / 2, h - 10, `${node.props?.watts ?? 3000} VA`, 9, INK, 'middle', 600),

  hybridinverter: (w, h, node) => {
    const sunX = w * 0.36;
    const sunY = h / 2 - 8;
    const rays = [0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
      const rad = (angle * Math.PI) / 180;
      return line(
        sunX + Math.cos(rad) * 10, sunY + Math.sin(rad) * 10,
        sunX + Math.cos(rad) * 14, sunY + Math.sin(rad) * 14,
        '#e0a800', 1.2,
      );
    }).join('');
    return rect(12, 14, w - 24, h - 34, 6) +
      `<circle cx="${sunX}" cy="${sunY}" r="6.5" fill="#f6c453"/>` + rays +
      text(sunX, sunY + 20, 'MPPT', 8, MUTED, 'middle', 700) +
      `<path d="M ${w * 0.58} ${sunY} q 5 -9 10 0 t 10 0 t 10 0" fill="none" stroke="${ACCENT}" stroke-width="2"/>` +
      text(w * 0.64, sunY + 20, 'INV', 8, MUTED, 'middle', 700) +
      text(w * 0.21, 24, 'PV IN', 7, MUTED, 'middle', 700) +
      text(w * 0.635, 24, 'AC IN', 7, MUTED, 'middle', 700) +
      text(w * 0.21, h - 24, 'BAT', 7, MUTED, 'middle', 700) +
      text(w * 0.635, h - 24, 'AC OUT', 7, MUTED, 'middle', 700) +
      text(w - 14, sunY - 6, 'PE', 7, MUTED, 'end', 700) +
      text(w / 2, h - 10, `${node.props?.watts ?? 3000} VA`, 9, INK, 'middle', 600);
  },

  fusebox: (w, h, node) => {
    const rows = 3;
    let fuses = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 16 + c * ((w - 32) / 3);
        const y = 28 + r * ((h - 46) / rows);
        fuses += rect(x, y, (w - 32) / 3 - 6, 10, 2, '#f2f5f8', '#c3ced9', 1);
        fuses += line(x + 4, y + 5, x + (w - 32) / 3 - 10, y + 5, ACCENT, 1.4);
      }
    }
    return rect(10, 12, w - 20, h - 30, 6) + fuses + text(w / 2, 12, 'DC DISTRIBUTION', 8, MUTED, 'middle', 700);
  },

  busbar: (w, h, node) => rect(12, h / 2 - 12, w - 24, 24, 4, '#eef3f6', '#c3ced9', 1.2) +
    [0.2, 0.4, 0.6, 0.8].map((p) => circle(12 + (w - 24) * p, h / 2, 4, PAPER, ACCENT, 1.6)).join('') +
    text(w / 2, h - 6, 'BUSBAR', 8, MUTED, 'middle', 700),

  acpanel: (w, h, node) => {
    let toggles = '';
    for (let i = 0; i < 4; i++) {
      const x = 16 + i * ((w - 32) / 4);
      toggles += rect(x, 30, (w - 32) / 4 - 6, h - 54, 2, '#f2f5f8', '#c3ced9', 1);
      toggles += rect(x + 4, 36, (w - 32) / 4 - 14, 12, 2, ACCENT, ACCENT, 1);
    }
    return rect(10, 12, w - 20, h - 30, 6) + toggles + text(w / 2, 12, 'AC DISTRIBUTION', 8, MUTED, 'middle', 700);
  },

  pvcombiner: (w, h, node) => {
    const busX = 138;
    const negX = 116;
    const plusYs = [0.22, 0.6].map((p) => Math.round(p * h));
    const fuses = plusYs.map((y) => line(0, y, 40, y, INK, 1.4)
      + rect(40, y - 8, 34, 16, 3, '#f2f5f8', '#c3ced9', 1.1)
      + line(46, y, 68, y, ACCENT, 1.8)
      + line(74, y, busX, y, INK, 1.4)).join('');
    const negA = Math.round(0.4 * h);
    const negB = Math.round(0.78 * h);
    const oy = Math.round(0.34 * h);
    const ny = Math.round(0.68 * h);
    const sun = `<circle cx="${w - 26}" cy="24" r="6" fill="#f6c453"/>`;
    const spdTop = h - 44;
    return rect(10, 14, w - 20, h - 30, 6)
      + text(w / 2, 24, 'PV COMBINER', 8, MUTED, 'middle', 700)
      + fuses
      + line(0, negA, negX, negA, INK, 1.4)
      + line(0, negB, negX, negB, INK, 1.4)
      + line(negX, negA, negX, negB, ACCENT, 2)
      + line(busX, plusYs[0], busX, spdTop, ACCENT, 2)
      + sun
      + line(busX, oy, 150, oy, INK, 1.4)
      + circle(152, oy, 3, PAPER, INK, 1.4)
      + line(156, oy - 6, 186, oy + 6, INK, 2.2)
      + circle(188, oy, 3, PAPER, INK, 1.4)
      + line(191, oy, w, oy, INK, 1.4)
      + line(negX, ny, 150, ny, INK, 1.4)
      + circle(152, ny, 3, PAPER, INK, 1.4)
      + line(156, ny - 6, 186, ny + 6, INK, 2.2)
      + circle(188, ny, 3, PAPER, INK, 1.4)
      + line(191, ny, w, ny, INK, 1.4)
      + line(170, oy + 7, 170, ny - 7, MUTED, 1.1, '3 3')
      + text(172, oy - 10, '2P MCB', 7, MUTED, 'middle', 700)
      + rect(busX - 18, spdTop, 36, 20, 3, '#f2f5f8', '#c3ced9', 1.1)
      + text(busX, spdTop + 13, 'SPD', 8, WARM, 'middle', 700)
      + line(busX, spdTop + 20, busX, h - 10, INK, 1.4)
      + line(busX - 12, h - 10, busX + 12, h - 10, INK, 2);
  },

  switch: (w, h, node) => circle(w / 2 - 24, h / 2, 4) + circle(w / 2 + 24, h / 2, 4) +
    line(w / 2 - 22, h / 2 - 1, w / 2 + 18, h / 2 - 15, INK, 2.4) +
    text(w / 2, h - 10, `${node.props?.ratedA ?? 275} A`, 9, MUTED, 'middle', 600),

  shunt: (w, h, node) => rect(20, h / 2 - 14, w - 40, 28, 4) +
    line(28, h / 2, w - 28, h / 2, ACCENT, 2) +
    line(w / 2 - 6, h / 2 - 8, w / 2 + 6, h / 2 + 8, MUTED, 1.4) +
    text(w / 2, h - 6, `${node.props?.ratedA ?? 500} A`, 8, MUTED, 'middle', 600),

  fuse: (w, h, node) => rect(14, h / 2 - 12, w - 28, 24, 12) +
    line(14, h / 2, w - 14, h / 2, INK, 1.6) +
    text(w / 2, h - 6, `${node.props?.ratingA ?? 30} A`, 9, WARM, 'middle', 700),

  breaker: (w, h, node) => rect(14, h / 2 - 14, w - 28, 28, 3) +
    line(w / 2 - 12, h / 2 + 6, w / 2 + 8, h / 2 - 6, INK, 2.2) +
    text(w / 2, h - 4, `${node.props?.ratingA ?? 50} A`, 9, INK, 'middle', 700),

  mccb: (w, h, node) => {
    const yT = Math.round(0.3 * h);
    const yB = Math.round(0.7 * h);
    const pole = (y) => line(0, y, 34, y, INK, 1.4)
      + circle(36, y, 3, PAPER, INK, 1.4)
      + line(40, y - 1, w - 40, y - 11, INK, 2.4)
      + circle(w - 36, y, 3, PAPER, INK, 1.4)
      + line(w - 34, y, w, y, INK, 1.4);
    return rect(12, 14, w - 24, h - 30, 4)
      + pole(yT) + pole(yB)
      + line(w / 2, yT - 10, w / 2, yB - 5, MUTED, 1.1, '4 3')
      + text(w / 2, h - 8, `${node.props?.ratingA ?? 125} A`, 9, INK, 'middle', 700);
  },

  rcd: (w, h, node) => rect(12, 14, w - 24, h - 34, 4) +
    rect(w / 2 - 12, h / 2 - 8, 24, 12, 2, ACCENT, ACCENT, 1) +
    text(w / 2, h / 2 + 18, 'TEST', 7, MUTED, 'middle', 700) +
    text(w / 2, h - 8, `${node.props?.tripMa ?? 30} mA`, 9, MUTED, 'middle', 600),

  fridge: (w, h, node) => rect(22, 12, w - 44, h - 34, 4) +
    line(22, 34, w - 22, 34, INK, 1.4) +
    line(w - 32, 20, w - 32, 28, MUTED, 2) +
    line(w - 32, 40, w - 32, 56, MUTED, 2),

  light: (w, h, node) => circle(w / 2, h / 2 - 6, 16) +
    `<path d="M ${w / 2 - 10} ${h / 2 + 6} l 20 0" stroke="${INK}" stroke-width="1.6"/>` +
    line(w / 2 - 7, h / 2 + 12, w / 2 + 7, h / 2 + 12, INK, 1.6),

  pump: (w, h, node) => circle(w / 2, h / 2 - 4, 18) +
    `<path d="M ${w / 2} ${h / 2 - 4} l 12 -8 M ${w / 2} ${h / 2 - 4} l -12 -8 M ${w / 2} ${h / 2 - 4} l 0 14" stroke="${ACCENT}" stroke-width="1.8"/>`,

  fan: (w, h, node) => circle(w / 2, h / 2 - 4, 18) +
    [0, 120, 240].map((deg) => `<path d="M ${w / 2} ${h / 2 - 4} q 10 -14 18 -2 q -8 6 -18 2" fill="${ACCENT}" opacity="0.85" transform="rotate(${deg} ${w / 2} ${h / 2 - 4})"/>`).join(''),

  heater: (w, h, node) => rect(18, 14, w - 36, h - 36, 4) +
    `<path d="M ${w / 2} ${h / 2 + 10} q -10 -8 0 -18 q 10 10 0 18" fill="${WARM}" opacity="0.8"/>` +
    line(w / 2, h / 2 + 12, w / 2 + 6, h / 2 + 18, MUTED, 1.4),

  hob: (w, h, node) => rect(16, 14, w - 32, h - 34, 4) +
    circle(w / 2 - 14, h / 2, 9) + circle(w / 2 + 14, h / 2, 6) +
    text(w / 2, h - 6, `${node.props?.watts ?? 1800} W`, 8, MUTED, 'middle', 600),

  sockets: (w, h, node) => rect(24, 14, w - 48, h - 34, 4) +
    circle(w / 2 - 8, h / 2 - 2, 3, INK, INK, 1) + circle(w / 2 + 8, h / 2 - 2, 3, INK, INK, 1) +
    line(w / 2, h / 2 + 6, w / 2, h / 2 + 12, INK, 1.6),

  generic: (w, h, node) => rect(16, 14, w - 32, h - 34, 4) +
    circle(w / 2, h / 2 - 2, 12) +
    text(w / 2, h / 2 + 2, '?', 12, MUTED, 'middle', 700),

  ground: (w, h, node) => line(w / 2, 16, w / 2, h / 2, INK, 2) +
    line(w / 2 - 20, h / 2, w / 2 + 20, h / 2, INK, 2) +
    line(w / 2 - 13, h / 2 + 8, w / 2 + 13, h / 2 + 8, INK, 2) +
    line(w / 2 - 6, h / 2 + 16, w / 2 + 6, h / 2 + 16, INK, 2),

  earthbar: (w, h, node) => rect(12, h / 2 - 8, w - 24, 16, 3, '#eef3f6', '#c3ced9', 1.2) +
    [0.14, 0.29, 0.43, 0.57, 0.71, 0.86].map((p) => line(12 + (w - 24) * p, h / 2 - 8, 12 + (w - 24) * p, h / 2 - 18, MUTED, 1.4)).join(''),

  monitor: (w, h, node) => rect(18, 14, w - 36, h - 40, 4) +
    line(w / 2 - 10, h - 22, w / 2 + 10, h - 22, MUTED, 1.6) +
    line(w / 2, h - 22, w / 2, h - 14, MUTED, 1.6) +
    `<path d="M ${w / 2 - 20} ${h / 2 + 2} l 8 -8 l 6 6 l 10 -12 l 8 14" fill="none" stroke="${ACCENT}" stroke-width="1.8"/>`,

  connector: (w, h, node) => circle(18, h / 2, 6) + circle(w - 18, h / 2, 6) +
    line(24, h / 2, w - 24, h / 2, INK, 2.2) +
    line(w / 2 - 6, h / 2 - 6, w / 2 - 6, h / 2 + 6, ACCENT, 1.6) +
    line(w / 2 + 6, h / 2 - 6, w / 2 + 6, h / 2 + 6, ACCENT, 1.6),
};
