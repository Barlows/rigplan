// Free calculators. Every result comes from the same sizing engine the editor
// uses, so the numbers on this page and the numbers on the drawing agree.

import {
  STANDARDS, TEMP_RATINGS, FUSE_FAMILIES, FUSE_RATINGS,
  AWG_SIZES, AWG_AREA, METRIC_SIZES, metricArea, formatSize,
} from './data/standards.js';
import { sizeRun, pickFuse } from './core/engine.js?v=20261038';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round = (n, dp = 1) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const esc = (value) => String(value ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------------------
// Shared result rendering
// ---------------------------------------------------------------------------
function render(resultEl, { big, qual = '', badge = '', rows = [], note = '' }) {
  if (!resultEl) return;
  resultEl.innerHTML = `
    <div class="headline">
      <span class="big">${esc(big)}</span>
      ${qual ? `<span class="qual">${esc(qual)}</span>` : ''}
      ${badge}
    </div>
    ${rows.length ? `<div class="rows">${rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>` : ''}
    ${note ? `<p class="note">${note}</p>` : ''}`;
}

function badge(kind, text) {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

/** A minimal diagram envelope: sizeRun only needs the settings block. */
function diagramFor(settings) {
  return { settings };
}

function settingsFrom(standardId, extra = {}) {
  const std = STANDARDS[standardId] || STANDARDS.abyc;
  return {
    standard: std.id,
    tempRating: std.defaultTempRating,
    ambientC: std.defaultAmbientC,
    method: std.defaultMethod,
    groupingCount: 1,
    vdTarget: std.defaultVd,
    units: 'mm2',
    ...extra,
  };
}

const nextRating = (amps, list = FUSE_RATINGS) => list.find((r) => r >= amps - 1e-9) ?? list[list.length - 1];

// ---------------------------------------------------------------------------
// Cable size
// ---------------------------------------------------------------------------
function initCable() {
  const stdSel = $('#cable-standard');
  const tempSel = $('#cable-temp');
  const ambSel = $('#cable-ambient');
  const methodSel = $('#cable-method');
  const vdSel = $('#cable-vd');
  const unitSel = $('#cable-units');
  if (!stdSel) return;

  stdSel.innerHTML = Object.values(STANDARDS).map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
  stdSel.value = 'abyc';

  function rebuildStandard() {
    const std = STANDARDS[stdSel.value] || STANDARDS.abyc;
    tempSel.innerHTML = TEMP_RATINGS.map((t) => `<option value="${t.value}" ${t.value === std.defaultTempRating ? 'selected' : ''}>${t.label}</option>`).join('');
    ambSel.innerHTML = std.ambient.map((a) => `<option value="${a.tempC}" ${a.tempC === std.defaultAmbientC ? 'selected' : ''}>${a.tempC} °C</option>`).join('');
    methodSel.innerHTML = std.methods.map((m) => `<option value="${m.id}" ${m.id === std.defaultMethod ? 'selected' : ''}>${m.label}</option>`).join('');
    vdSel.innerHTML = std.vdTargets.map((v) => `<option value="${v.value}" ${v.value === std.defaultVd ? 'selected' : ''}>${v.label}</option>`).join('');
  }

  function update() {
    const std = STANDARDS[stdSel.value] || STANDARDS.abyc;
    const unit = unitSel.value;
    const voltage = Math.max(1, num($('#cable-voltage').value, 12));
    const current = Math.max(0.1, num($('#cable-current').value, 1));
    const lengthM = Math.max(0, num($('#cable-length').value, 0));
    const continuous = $('#cable-continuous').checked;
    const settings = settingsFrom(std.id, {
      tempRating: num(tempSel.value, std.defaultTempRating),
      ambientC: num(ambSel.value, std.defaultAmbientC),
      method: methodSel.value || std.defaultMethod,
      groupingCount: Math.max(1, num($('#cable-grouping').value, 1)),
      vdTarget: num(vdSel.value, std.defaultVd),
      units: unit,
    });
    const base = { currentA: current, lengthM, voltage, continuous, unit };
    const sized = sizeRun(diagramFor(settings), base);
    const fuse = pickFuse(sized.designA);

    const pass = sized.ampacityPass && sized.vdPass;
    const badgeKind = pass ? 'ok' : sized.ampacityPass ? 'warn' : 'bad';
    const badgeText = pass ? 'passes' : sized.ampacityPass ? 'voltage drop' : 'undersized';
    render($('#cable-result'), {
      big: formatSize(sized.size, sized.unit),
      qual: 'recommended conductor',
      badge: badge(badgeKind, badgeText),
      rows: [
        ['Design current', `${sized.designA} A`],
        ['Derated ampacity', `${sized.ampacity?.toFixed(1) ?? '—'} A`],
        ['Voltage drop', `${sized.voltageDropPct.toFixed(2)}% (${sized.voltageDropV.toFixed(2)} V)`],
        ['Fuse suggestion', fuse ? `${fuse.ratingA} A · ${FUSE_FAMILIES[fuse.family]?.label || fuse.family}` : 'no family fits'],
        ['Limited by', sized.limiting],
      ],
      note: sized.assumptions.slice(1).map(esc).join(' '),
    });

    renderCableTable(settings, base, sized);
  }

  function renderCableTable(settings, base, chosen) {
    const std = STANDARDS[settings.standard];
    const sizes = settings.units === 'AWG' ? AWG_SIZES : METRIC_SIZES;
    const rows = sizes
      .filter((s) => metricArea(s, settings.units) >= std.minDcSize - 1e-9)
      .map((size) => sizeRun(diagramFor(settings), { ...base, overrideSize: size }))
      .filter((r) => r.ampacity != null)
      .slice(0, 12);
    $('#cable-table').innerHTML = `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Size</th><th>Ampacity</th><th>Drop</th><th>Verdict</th></tr></thead>
        <tbody>${rows.map((r) => {
          const ok = r.ampacityPass && r.vdPass;
          const isChosen = String(r.size) === String(chosen.size);
          return `<tr>
            <td class="num">${formatSize(r.size, r.unit)}${isChosen ? ' ◀' : ''}</td>
            <td class="num">${r.ampacity?.toFixed(1)} A</td>
            <td class="num">${r.voltageDropPct.toFixed(2)}%</td>
            <td>${ok ? badge('ok', 'passes') : r.ampacityPass ? badge('warn', 'drop') : badge('bad', 'ampacity')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }

  stdSel.addEventListener('change', () => { rebuildStandard(); update(); });
  ['#cable-voltage', '#cable-current', '#cable-length', '#cable-grouping'].forEach((id) => $(id).addEventListener('input', update));
  [tempSel, ambSel, methodSel, vdSel, unitSel, $('#cable-continuous')].forEach((el) => el.addEventListener('change', update));
  rebuildStandard();
  update();
}

// ---------------------------------------------------------------------------
// Fuse size
// ---------------------------------------------------------------------------
function initFuse() {
  const famSel = $('#fuse-family');
  if (!famSel) return;
  famSel.innerHTML = `<option value="">Auto — smallest suitable</option>` +
    Object.values(FUSE_FAMILIES).filter((f) => f.id !== 'rcbo').map((f) => `<option value="${f.id}">${f.label}</option>`).join('');

  function update() {
    const current = Math.max(0.1, num($('#fuse-current').value, 1));
    const continuous = $('#fuse-continuous').checked;
    const designA = current * (continuous ? 1.25 : 1);
    const family = famSel.value || null;
    const picked = pickFuse(designA, family);
    const ampacity = num($('#fuse-ampacity').value, 0);
    const over = picked && ampacity > 0 && picked.ratingA > ampacity;
    const under = picked && picked.ratingA < designA;

    if (!picked) {
      render($('#fuse-result'), {
        big: 'No fit',
        qual: 'in that family',
        badge: badge('bad', 'review'),
        rows: [['Design current', `${round(designA, 2)} A`], ['Family', family ? FUSE_FAMILIES[family]?.label : 'Auto']],
        note: 'The requested family does not cover this current. Try Auto, MEGA, ANL or a DC breaker.',
      });
      return;
    }

    render($('#fuse-result'), {
      big: `${picked.ratingA} A`,
      qual: FUSE_FAMILIES[picked.family]?.label || picked.family,
      badge: badge(over ? 'bad' : under ? 'warn' : 'ok', over ? 'above cable' : under ? 'below load' : 'coordinated'),
      rows: [
        ['Design current', `${round(designA, 2)} A`],
        ['Cable ampacity', ampacity > 0 ? `${round(ampacity, 1)} A` : 'not entered'],
        ['Headroom', ampacity > 0 ? `${round(ampacity - picked.ratingA, 1)} A` : '—'],
      ],
      note: over
        ? 'The fuse is larger than the cable can carry. Increase the cable or choose a smaller fuse.'
        : under
          ? 'The fuse is below the continuous design current and may nuisance-blow.'
          : `${FUSE_FAMILIES[picked.family]?.note || ''} The next size up is ${nextRating(picked.ratingA + 0.01)} A.`,
    });
  }

  ['#fuse-current', '#fuse-ampacity'].forEach((id) => $(id).addEventListener('input', update));
  [famSel, $('#fuse-continuous')].forEach((el) => el.addEventListener('change', update));
  update();
}

// ---------------------------------------------------------------------------
// AWG <-> mm2
// ---------------------------------------------------------------------------
function initAwg() {
  const valueEl = $('#awg-value');
  if (!valueEl) return;

  const awgToMm2 = (n) => 0.012668 * Math.pow(92, (36 - n) / 19);
  const mm2ToAwg = (a) => 36 - (19 * Math.log(a / 0.012668)) / Math.log(92);
  const nearestAwg = (area) => {
    let best = AWG_SIZES[0];
    let diff = Infinity;
    for (const [gauge, a] of Object.entries(AWG_AREA)) {
      const d = Math.abs(a - area);
      if (d < diff) { diff = d; best = gauge; }
    }
    return best;
  };

  function update() {
    const raw = num(valueEl.value, 0);
    const unit = $('#awg-unit').value;
    let mm2;
    let awg;
    if (unit === 'AWG') {
      mm2 = AWG_AREA[String(raw)] ?? awgToMm2(raw);
      awg = String(raw);
    } else {
      mm2 = raw;
      awg = mm2ToAwg(raw).toFixed(1);
    }
    const nearest = nearestAwg(mm2);
    const nearestArea = AWG_AREA[nearest];
    const metricNearest = METRIC_SIZES.reduce((best, s) => Math.abs(s - mm2) < Math.abs(best - mm2) ? s : best, METRIC_SIZES[0]);

    render($('#awg-result'), {
      big: `${round(mm2, 2)} mm²`,
      qual: `${round(Number(awg), 1)} AWG`,
      badge: badge('ok', 'converted'),
      rows: [
        ['Nearest imperial', `${nearest} AWG (${nearestArea} mm²)`],
        ['Nearest metric', `${metricNearest} mm²`],
        ['Cross-section', `${round(mm2, 2)} mm²`],
      ],
      note: 'Use the next size up when the exact gauge is unavailable. Voltage drop depends on the actual cross-section, not the label.',
    });

    $('#awg-table').innerHTML = `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>AWG</th><th>mm²</th></tr></thead>
        <tbody>${Object.entries(AWG_AREA).map(([g, a]) => `<tr><td class="num">${g}</td><td class="num">${a}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  valueEl.addEventListener('input', update);
  $('#awg-unit').addEventListener('change', update);
  update();
}

// ---------------------------------------------------------------------------
// Battery bank
// ---------------------------------------------------------------------------
function initBank() {
  if (!$('#bank-ah')) return;

  function update() {
    const batteryV = Math.max(1, num($('#bank-battery-v').value, 12.8));
    const ahEach = Math.max(1, num($('#bank-ah').value, 100));
    const count = Math.max(1, Math.round(num($('#bank-count').value, 1)));
    const systemV = Math.max(1, num($('#bank-system-v').value, 12));
    const dod = clamp(num($('#bank-dod').value, 80), 1, 100) / 100;

    const series = Math.max(1, Math.ceil(systemV / batteryV - 0.05));
    const strings = Math.ceil(count / series);
    const used = strings * series;
    const bankV = series * batteryV;
    const totalAh = ahEach * strings;
    const totalWh = totalAh * systemV;
    const usableWh = totalWh * dod;
    const exact = Math.abs(bankV - systemV) / systemV <= 0.2;

    render($('#bank-result'), {
      big: `${round(totalAh, 1)} Ah`,
      qual: `at ${round(systemV, 1)} V`,
      badge: badge(exact ? 'ok' : 'warn', exact ? 'valid layout' : 'voltage mismatch'),
      rows: [
        ['Layout', `${strings} string${strings === 1 ? '' : 's'} × ${series} in series`],
        ['String voltage', `${round(bankV, 1)} V`],
        ['Batteries used', `${used} of ${count}`],
        ['Stored energy', `${round(totalWh / 1000, 2)} kWh`],
        [`Usable at ${Math.round(dod * 100)}% DoD`, `${round(usableWh / 1000, 2)} kWh`],
        ['Usable capacity', `${round(totalAh * dod, 1)} Ah`],
      ],
      note: exact
        ? `${count - used > 0 ? `${count - used} spare battery position(s) unused. ` : ''}Keep every battery in a string the same make, age and temperature.`
        : `A ${series}-battery string gives ${round(bankV, 1)} V, which is too far from the ${round(systemV, 1)} V system. Add or remove a battery in series.`,
    });
  }

  ['#bank-battery-v', '#bank-ah', '#bank-count', '#bank-system-v', '#bank-dod'].forEach((id) => $(id).addEventListener('input', update));
  update();
}

// ---------------------------------------------------------------------------
// Energy budget
// ---------------------------------------------------------------------------
const DEFAULT_LOADS = [
  { name: 'Fridge', w: 45, h: 8 },
  { name: 'Lights', w: 12, h: 5 },
  { name: 'Water pump', w: 60, h: 0.5 },
  { name: 'Laptop', w: 65, h: 4 },
  { name: 'Inverter idle', w: 8, h: 24 },
];

function initBudget() {
  const host = $('#budget-loads');
  if (!host) return;
  let loads = DEFAULT_LOADS.map((l) => ({ ...l }));

  function paintLoads() {
    host.innerHTML = `
      <div class="load-row load-head"><span>Load</span><span>Watts</span><span>Hours/day</span><span></span></div>
      ${loads.map((l, i) => `
        <div class="load-row">
          <input data-load="${i}" data-key="name" value="${esc(l.name)}" aria-label="Load name">
          <input data-load="${i}" data-key="w" type="number" min="0" step="1" value="${l.w}" aria-label="Watts">
          <input data-load="${i}" data-key="h" type="number" min="0" step="0.1" value="${l.h}" aria-label="Hours per day">
          <button type="button" class="del" data-del="${i}" aria-label="Remove ${esc(l.name)}">✕</button>
        </div>`).join('')}`;
    $$('[data-load]', host).forEach((el) => el.addEventListener('input', () => {
      const i = Number(el.dataset.load);
      const key = el.dataset.key;
      loads[i][key] = key === 'name' ? el.value : Math.max(0, num(el.value, 0));
      if (key !== 'name') update();
    }));
    $$('[data-del]', host).forEach((el) => el.addEventListener('click', () => {
      loads.splice(Number(el.dataset.del), 1);
      paintLoads();
      update();
    }));
  }

  function update() {
    const voltage = Math.max(1, num($('#budget-voltage').value, 12));
    const days = Math.max(0.1, num($('#budget-days').value, 2));
    const sun = Math.max(0.1, num($('#budget-sun').value, 4));
    const dod = clamp(num($('#budget-dod').value, 80), 1, 100) / 100;
    const losses = clamp(num($('#budget-losses').value, 25), 0, 60) / 100;

    const wh = loads.reduce((sum, l) => sum + l.w * l.h, 0);
    const peak = loads.reduce((sum, l) => sum + l.w, 0);
    const ah = wh / voltage;
    const bankAh = (wh * days) / (voltage * dod);
    const solarW = wh / (sun * (1 - losses));

    render($('#budget-result'), {
      big: `${round(wh)} Wh/day`,
      qual: `${round(ah, 1)} Ah/day at ${round(voltage, 1)} V`,
      badge: badge(peak > 0 ? 'ok' : 'warn', peak > 0 ? 'estimated' : 'add a load'),
      rows: [
        ['Connected peak', `${round(peak)} W`],
        ['Daily energy', `${round(wh / 1000, 2)} kWh`],
        ['Bank for autonomy', `${round(bankAh)} Ah`],
        ['Usable energy needed', `${round((wh * days) / 1000, 2)} kWh`],
        ['Solar array (approx.)', `${round(solarW)} W`],
        ['Loads counted', `${loads.length}`],
      ],
      note: 'The solar figure assumes the peak-sun hours and losses you entered and ignores winter derating. Size the array for the worst month you plan to travel in.',
    });
  }

  $('#budget-add').addEventListener('click', () => {
    loads.push({ name: 'New load', w: 20, h: 1 });
    paintLoads();
    update();
  });
  ['#budget-voltage', '#budget-days', '#budget-sun', '#budget-dod', '#budget-losses'].forEach((id) => $(id).addEventListener('input', update));
  paintLoads();
  update();
}

// ---------------------------------------------------------------------------
// Solar / MPPT
// ---------------------------------------------------------------------------
function initSolar() {
  if (!$('#solar-pmax')) return;

  function update() {
    const pmax = Math.max(1, num($('#solar-pmax').value, 200));
    const voc = Math.max(0.1, num($('#solar-voc').value, 22.5));
    const isc = Math.max(0.1, num($('#solar-isc').value, 11.8));
    const vmp = Math.max(0.1, num($('#solar-vmp').value, 18));
    const imp = Math.max(0.1, num($('#solar-imp').value, 11.1));
    const efficiency = clamp(num($('#solar-eff').value, 21), 1, 100);
    const count = Math.max(1, Math.round(num($('#solar-count').value, 1)));
    const series = clamp(Math.round(num($('#solar-series').value, 1)), 1, count);
    const systemV = Math.max(1, num($('#solar-system-v').value, 12));
    const maxPv = Math.max(1, num($('#solar-maxpv').value, 100));

    const arrayW = pmax * count;
    const parallel = Math.ceil(count / series);
    const arrayVoc = voc * series;
    const arrayIsc = isc * parallel;
    const arrayVmp = vmp * series;
    const arrayImp = imp * parallel;
    const coldVoc = arrayVoc * 1.25;
    const outputA = (arrayW * 0.95) / systemV;
    const ratings = [10, 15, 20, 30, 40, 50, 60, 70, 80, 100, 120, 150];
    const controller = ratings.find((r) => r >= outputA) ?? 150;
    const areaEach = pmax / (1000 * (efficiency / 100));
    const arrayArea = areaEach * count;

    const specOk = voc >= vmp && isc >= imp;
    const mismatch = Math.abs((vmp * imp) - pmax) / pmax;
    const badgeKind = coldVoc > maxPv ? 'bad' : specOk ? 'ok' : 'warn';
    const badgeText = coldVoc > maxPv ? 'voltage too high' : specOk ? 'controller OK' : 'check nameplate';

    let note = 'MPPT output current is estimated at 95% conversion. The cold Voc check applies a ×1.25 safety factor, and module area is Pmax ÷ (1000 W/m² × efficiency).';
    if (coldVoc > maxPv) {
      note = `Cold-weather open-circuit voltage may exceed the controller's ${maxPv} V limit. Reduce the number in series.`;
    } else if (!specOk) {
      note = 'Check the nameplate: Voc must be at least Vmp, and Isc at least Imp.';
    } else if (mismatch > 0.1) {
      note = `Pmax, Vmp and Imp do not agree: Vmp × Imp = ${round(vmp * imp)} W, but Pmax is ${round(pmax)} W. Array current uses Imp; check the panel label.`;
    }

    render($('#solar-result'), {
      big: `${round(arrayW)} W`,
      qual: `${count} × ${round(pmax)} W · ${series}S${parallel}P`,
      badge: badge(badgeKind, badgeText),
      rows: [
        ['Array Voc', `${round(arrayVoc, 1)} V`],
        ['Array Isc', `${round(arrayIsc, 1)} A`],
        ['Array Vmp', `${round(arrayVmp, 1)} V`],
        ['Array Imp', `${round(arrayImp, 1)} A`],
        ['Cold Voc estimate', `${round(coldVoc, 0)} V`],
        ['Controller output', `${round(outputA, 1)} A at ${round(systemV, 1)} V`],
        ['Suggested MPPT', `${controller} A`],
        ['Panel / array area', `${round(areaEach, 2)} m² each · ${round(arrayArea, 1)} m² total`],
      ],
      note,
    });
  }

  ['#solar-pmax', '#solar-voc', '#solar-isc', '#solar-vmp', '#solar-imp', '#solar-eff',
    '#solar-count', '#solar-series', '#solar-system-v', '#solar-maxpv'].forEach((id) => $(id).addEventListener('input', update));
  update();
}

// ---------------------------------------------------------------------------
// Inverter
// ---------------------------------------------------------------------------
function initInverter() {
  const stdSel = $('#inverter-standard');
  if (!stdSel) return;
  stdSel.innerHTML = Object.values(STANDARDS).map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
  stdSel.value = 'abyc';

  function update() {
    const watts = Math.max(1, num($('#inverter-watts').value, 1));
    const eff = clamp(num($('#inverter-eff').value, 90), 50, 100) / 100;
    const voltage = Math.max(1, num($('#inverter-voltage').value, 12));
    const lengthM = Math.max(0, num($('#inverter-length').value, 0));
    const std = STANDARDS[stdSel.value] || STANDARDS.abyc;
    const settings = settingsFrom(std.id);

    const dcA = watts / eff / voltage;
    const sized = sizeRun(diagramFor(settings), { currentA: dcA, lengthM, voltage, unit: 'mm2' });
    const fuse = pickFuse(sized.designA);
    const acA = watts / 230;

    render($('#inverter-result'), {
      big: `${round(dcA, 1)} A`,
      qual: 'battery-side current',
      badge: badge(sized.vdPass ? 'ok' : 'warn', sized.vdPass ? `${round(sized.voltageDropPct, 1)}% drop` : 'high drop'),
      rows: [
        ['AC output current', `${round(acA, 1)} A at 230 V`],
        ['Recommended cable', formatSize(sized.size, sized.unit)],
        ['Fuse suggestion', fuse ? `${fuse.ratingA} A · ${FUSE_FAMILIES[fuse.family]?.label || fuse.family}` : '—'],
        ['Voltage drop', `${round(sized.voltageDropPct, 2)} %`],
        ['Design current', `${sized.designA} A`],
      ],
      note: 'Inverter peak surge can be twice the continuous rating. Check the time-current curve of the fuse and the short-circuit withstand of the cable before accepting a tight margin.',
    });
  }

  ['#inverter-watts', '#inverter-eff', '#inverter-voltage', '#inverter-length'].forEach((id) => $(id).addEventListener('input', update));
  stdSel.addEventListener('change', update);
  update();
}

// ---------------------------------------------------------------------------
// DC-DC charger
// ---------------------------------------------------------------------------
function initDcdc() {
  if (!$('#dcdc-out-a')) return;

  function update() {
    const outA = Math.max(0.1, num($('#dcdc-out-a').value, 1));
    const outV = Math.max(1, num($('#dcdc-out-v').value, 12.8));
    const inV = Math.max(1, num($('#dcdc-in-v').value, 14.4));
    const eff = clamp(num($('#dcdc-eff').value, 90), 50, 100) / 100;
    const inLen = Math.max(0, num($('#dcdc-in-len').value, 0));
    const outLen = Math.max(0, num($('#dcdc-out-len').value, 0));

    const inA = (outA * outV) / (inV * eff);
    const settings = settingsFrom('abyc');
    const input = sizeRun(diagramFor(settings), { currentA: inA, lengthM: inLen, voltage: inV, unit: 'mm2', vdTarget: 3 });
    const output = sizeRun(diagramFor(settings), { currentA: outA, lengthM: outLen, voltage: outV, unit: 'mm2', vdTarget: 3 });
    const inFuse = pickFuse(input.designA);
    const outFuse = pickFuse(output.designA);

    render($('#dcdc-result'), {
      big: `${round(inA, 1)} A`,
      qual: 'input current',
      badge: badge(input.vdPass && output.vdPass ? 'ok' : 'warn', 'both sides sized'),
      rows: [
        ['Input cable', formatSize(input.size, input.unit)],
        ['Input fuse', inFuse ? `${inFuse.ratingA} A · ${FUSE_FAMILIES[inFuse.family]?.label || inFuse.family}` : '—'],
        ['Output cable', formatSize(output.size, output.unit)],
        ['Output fuse', outFuse ? `${outFuse.ratingA} A · ${FUSE_FAMILIES[outFuse.family]?.label || outFuse.family}` : '—'],
        ['Input drop', `${round(input.voltageDropPct, 1)} %`],
        ['Output drop', `${round(output.voltageDropPct, 1)} %`],
      ],
      note: `Input current rises as input voltage falls, so size the feed for the lowest alternator voltage you expect (often ${round(inV * 0.85, 1)} V on a hot idle), not the nominal figure.`,
    });
  }

  ['#dcdc-out-a', '#dcdc-out-v', '#dcdc-in-v', '#dcdc-eff', '#dcdc-in-len', '#dcdc-out-len'].forEach((id) => $(id).addEventListener('input', update));
  update();
}

// ---------------------------------------------------------------------------
// Shore charging
// ---------------------------------------------------------------------------
function initShore() {
  if (!$('#shore-ah')) return;

  function update() {
    const ah = Math.max(1, num($('#shore-ah').value, 100));
    const chargerA = Math.max(0.1, num($('#shore-charger-a').value, 10));
    const systemV = Math.max(1, num($('#shore-system-v').value, 12.8));
    const eff = clamp(num($('#shore-eff').value, 90), 50, 100) / 100;
    const acV = Math.max(50, num($('#shore-ac-v').value, 230));
    const dod = clamp(num($('#shore-dod').value, 60), 1, 100) / 100;

    const acA = (chargerA * systemV) / (acV * eff);
    const hours = (ah * dod) / chargerA;
    const cRate = (chargerA / ah) * 100;

    render($('#shore-result'), {
      big: `${round(hours, 1)} h`,
      qual: `to replace ${Math.round(dod * 100)}% of ${ah} Ah`,
      badge: badge(cRate <= 30 ? 'ok' : 'warn', `${round(cRate, 0)} A per 100 Ah`),
      rows: [
        ['DC charge current', `${round(chargerA, 1)} A`],
        [`AC current at ${round(acV)} V`, `${round(acA, 1)} A`],
        ['AC power', `${round(acA * acV)} VA`],
        ['Charge rate', `${round(cRate, 0)} A per 100 Ah`],
        ['Energy replaced', `${round(ah * dod * systemV / 1000, 2)} kWh`],
      ],
      note: cRate > 30
        ? 'Above roughly 0.3C many lead-acid banks will heat and gas. Confirm the battery datasheet before using this rate.'
        : 'The last 20% of charge is slower than the first 80%. Add 30–50% to this estimate for a real shore-power session.',
    });
  }

  ['#shore-ah', '#shore-charger-a', '#shore-system-v', '#shore-eff', '#shore-ac-v', '#shore-dod'].forEach((id) => $(id).addEventListener('input', update));
  update();
}

// ---------------------------------------------------------------------------
// State of charge
// ---------------------------------------------------------------------------
const SOC_TABLES = {
  lifepo4: [[13.6, 100], [13.4, 99], [13.3, 90], [13.2, 70], [13.1, 40], [13.0, 30], [12.9, 20], [12.8, 14], [12.5, 9], [12.0, 5], [10.0, 0]],
  agm: [[12.8, 100], [12.6, 90], [12.5, 80], [12.4, 70], [12.3, 60], [12.2, 50], [12.1, 40], [12.0, 30], [11.8, 20], [11.6, 10], [11.3, 0]],
  flooded: [[12.7, 100], [12.5, 90], [12.4, 80], [12.3, 70], [12.2, 60], [12.1, 50], [12.0, 40], [11.9, 30], [11.8, 20], [11.6, 10], [11.4, 0]],
};

function initSoc() {
  if (!$('#soc-chem')) return;

  function update() {
    const chem = $('#soc-chem').value;
    const ah = Math.max(1, num($('#soc-ah').value, 100));
    const voltage = num($('#soc-voltage').value, 12.8);
    const table = SOC_TABLES[chem] || SOC_TABLES.lifepo4;

    let pct = 0;
    if (voltage >= table[0][0]) pct = 100;
    else if (voltage <= table[table.length - 1][0]) pct = 0;
    else {
      for (let i = 0; i < table.length - 1; i += 1) {
        const [vHigh, pHigh] = table[i];
        const [vLow, pLow] = table[i + 1];
        if (voltage <= vHigh && voltage >= vLow) {
          const t = (voltage - vLow) / (vHigh - vLow);
          pct = pLow + t * (pHigh - pLow);
          break;
        }
      }
    }
    pct = clamp(pct, 0, 100);
    const remaining = (ah * pct) / 100;
    const floor = chem === 'lifepo4' ? 0.1 : 0.5;

    render($('#soc-result'), {
      big: `${Math.round(pct)}%`,
      qual: 'estimated state of charge',
      badge: badge(pct >= 50 ? 'ok' : pct >= 25 ? 'warn' : 'bad', pct >= 50 ? 'healthy' : pct >= 25 ? 'low' : 'very low'),
      rows: [
        ['Remaining capacity', `${round(remaining)} Ah of ${ah} Ah`],
        ['Energy remaining', `${round((remaining * 12.8) / 1000, 2)} kWh`],
        ['Usable before floor', `${round(Math.max(0, remaining - ah * floor))} Ah`],
        ['Suggested floor', `${Math.round(floor * 100)}%`],
      ],
      note: 'Voltage-based state of charge is approximate. Loads, temperature and recent charging all shift the reading; a shunt with coulomb counting is far more reliable.',
    });
  }

  ['#soc-chem', '#soc-ah', '#soc-voltage'].forEach((id) => $(id).addEventListener('input', update));
  update();
}

// ---------------------------------------------------------------------------
initCable();
initFuse();
initAwg();
initBank();
initBudget();
initSolar();
initInverter();
initDcdc();
initShore();
initSoc();
