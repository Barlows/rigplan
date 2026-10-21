import { CATALOG, CATEGORIES, CATALOG_BY_ID } from './data/catalog.js';
import { TEMPLATES, templateCampervan } from './data/templates.js';
import { createStore, emptyProject } from './core/store.js?v=20261022';
import { evaluateDiagram, DEFAULT_SETTINGS, sizeRun, sizeOptions } from './core/engine.js';
import { createEditor } from './ui/editor.js?v=20261021';
import {
  STANDARDS, TEMP_RATINGS, FUSE_FAMILIES, FUSE_RATINGS,
  formatSize, TERMINAL_KINDS, metricArea,
} from './data/standards.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = createStore(templateCampervan());
const svg = $('#canvas');
let evaluation = evaluateDiagram(store.get().doc);
let activeTab = 'inspector';

const editor = createEditor({
  svg,
  store,
  onSelection: () => {
    renderInspector();
    switchTab('inspector');
  },
  onNotice: (msg) => toast(msg),
});

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
function renderLibrary(filter = '') {
  const q = filter.trim().toLowerCase();
  const list = $('#library-list');
  const groups = new Map();
  for (const item of CATALOG) {
    if (q && !`${item.label} ${item.cat} ${item.id}`.toLowerCase().includes(q)) continue;
    if (!groups.has(item.cat)) groups.set(item.cat, []);
    groups.get(item.cat).push(item);
  }
  const total = [...groups.values()].reduce((n, arr) => n + arr.length, 0);
  $('#lib-count').textContent = `${total} parts`;
  list.innerHTML = [...groups.entries()].map(([cat, items]) => `
    <details class="lib-cat" ${q || ['Sources', 'Charging', 'Distribution', 'Loads'].includes(cat) ? 'open' : ''}>
      <summary>${cat} <span>${items.length}</span></summary>
      ${items.map((item) => `
        <button class="lib-item" draggable="true" data-type="${item.id}" data-cat="${cat}" title="${item.label}">
          <span class="dot"></span>
          <span class="name">${item.label}</span>
          <span class="tag">${item.defaults.voltage ? `${item.defaults.voltage}V` : ''}</span>
        </button>`).join('')}
    </details>`).join('');
}

$('#lib-search').addEventListener('input', (e) => renderLibrary(e.target.value));

$('#library-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  editor.addNodeAt(btn.dataset.type);
});

$('#library-list').addEventListener('dragstart', (e) => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  e.dataTransfer.setData('text/rigplan-type', btn.dataset.type);
  e.dataTransfer.effectAllowed = 'copy';
});

svg.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
svg.addEventListener('drop', (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData('text/rigplan-type');
  if (!type) return;
  editor.addNodeAt(type, e.clientX, e.clientY);
});

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------
const UNITS = {
  voltage: 'V', supplyA: 'A', capacityAh: 'Ah', maxChargeA: 'A', watts: 'W', voc: 'V',
  outputA: 'A', chargeA: 'A', inputA: 'A', ratedA: 'A', drawA: 'A', ratingA: 'A',
  maxPvVoc: 'V', maxPvA: 'A', inputV: 'V', acOutA: 'A', tripMa: 'mA', resistanceOhm: 'Ω',
  efficiency: '', powerFactor: '', circuits: '', maxDischargeA: 'A',
};

const ENUMS = {
  chemistry: ['LiFePO4', 'AGM', 'Gel', 'Flooded'],
  technology: ['mono', 'poly'],
  family: Object.keys(FUSE_FAMILIES),
  polarity: ['positive', 'negative'],
  curve: ['B', 'C', 'D'],
};

function humanize(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace('A', 'A');
}

function field(label, input) {
  return `<div class="field"><label>${label}</label>${input}</div>`;
}

function renderInspector() {
  const panel = $('#inspector-panel');
  const { doc } = store.get();
  const sel = editor.getSelection();

  if (!sel) {
    const critical = evaluation.checks.filter((c) => c.severity === 'critical').length;
    const warning = evaluation.checks.filter((c) => c.severity === 'warning').length;
    panel.innerHTML = `
      <div class="section">
        <h3 class="section-title">System overview</h3>
        <div class="metric-grid">
          <div class="metric"><div class="k">Components</div><div class="v">${doc.nodes.length}</div></div>
          <div class="metric"><div class="k">Cable runs</div><div class="v">${doc.wires.length}</div></div>
          <div class="metric ${critical ? 'fail' : 'pass'}"><div class="k">Critical</div><div class="v">${critical}</div></div>
          <div class="metric ${warning ? 'warn' : 'pass'}"><div class="k">To check</div><div class="v">${warning}</div></div>
        </div>
      </div>
      <div class="section">
        <h3 class="section-title">Cable and fuse sizing</h3>
        <p class="hint">Every run is sized automatically from its length and current. Select a cable to see the working, or a component to set its rating.</p>
        <div class="reason">
          <strong style="font-size:12px">${STANDARDS[doc.settings.standard]?.label || 'ABYC E-11'}</strong>
          <ul>
            <li>Ampacity from the published table, derated for ambient, grouping and method.</li>
            <li>Voltage drop limit ${doc.settings.vdTarget}% at ${doc.settings.voltage || 'system'} volts.</li>
            <li>Fuse chosen above the continuous design current and below cable ampacity.</li>
          </ul>
        </div>
      </div>
      <div class="section">
        <h3 class="section-title">Quick add</h3>
        <div class="field-row">
          <button class="btn small" data-quick="battery-lifepo4">+ Battery</button>
          <button class="btn small" data-quick="fuse-box">+ Fuse box</button>
          <button class="btn small" data-quick="mppt">+ MPPT</button>
          <button class="btn small" data-quick="fridge">+ Load</button>
        </div>
      </div>
      <div class="section">
        <h3 class="section-title">Drawing</h3>
        ${field('Title block notes', `<textarea id="q-notes" placeholder="System description for the title block">${escapeAttr(doc.notes)}</textarea>`)}
        <p class="hint">Set the client, drawing number and revision in the Project tab.</p>
      </div>`;
    panel.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => editor.addNodeAt(b.dataset.quick)));
    $('#q-notes')?.addEventListener('change', (e) => store.mutate((d) => { d.notes = e.target.value; }));
    return;
  }

  if (sel.type === 'node') {
    const node = doc.nodes.find((n) => n.id === sel.id);
    if (!node) { editor.clearSelection(); return; }
    const def = CATALOG_BY_ID[node.type];
    const props = Object.entries(def.defaults).map(([key, value]) => {
      const unit = UNITS[key] ?? '';
      if (typeof value === 'boolean') {
        return `<label class="field" style="flex-direction:row;align-items:center;gap:8px;height:32px">
          <input type="checkbox" data-prop="${key}" ${node.props[key] ? 'checked' : ''} style="width:15px;height:15px;flex:0 0 auto">
          <span>${humanize(key)}</span></label>`;
      }
      if (ENUMS[key]) {
        return field(humanize(key), `<select data-prop="${key}">${ENUMS[key].map((v) => `<option value="${v}" ${String(node.props[key]) === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`);
      }
      return field(`${humanize(key)}${unit ? ` <span class="mono" style="opacity:.6">${unit}</span>` : ''}`,
        `<input type="number" step="any" data-prop="${key}" value="${node.props[key] ?? ''}">`);
    }).join('');

    panel.innerHTML = `
      <div class="section">
        <h3 class="section-title">${def.label} <span class="badge neutral">${def.cat}</span></h3>
        ${field('Label', `<input id="node-label" value="${escapeAttr(node.label)}" spellcheck="false">`)}
        <div class="field-row">
          ${field('Brand', `<input data-field="brand" value="${escapeAttr(node.brand)}" placeholder="e.g. Victron">`)}
          ${field('Model', `<input data-field="model" value="${escapeAttr(node.model)}" placeholder="e.g. SmartSolar 100/30">`)}
        </div>
        ${field('Unit price', `<input type="number" step="0.01" data-field="price" value="${node.price ?? 0}">`)}
        <div class="field-row">
          <button class="btn small" id="node-duplicate">Duplicate</button>
          <button class="btn small danger" id="node-delete">Delete</button>
        </div>
      </div>
      <div class="section">
        <h3 class="section-title">Electrical</h3>
        ${props}
      </div>
      <div class="section">
        <h3 class="section-title">Notes</h3>
        <textarea data-field="notes" placeholder="Mounting, part numbers, installation notes…">${escapeAttr(node.notes)}</textarea>
        <p class="hint">Terminals: ${def.terminals.map((t) => `<span class="mono">${t.label}</span> (${TERMINAL_KINDS[t.kind]?.label})`).join(' · ')}</p>
      </div>`;

    $('#node-label').addEventListener('change', (e) => store.mutate((d) => {
      const item = d.nodes.find((n) => n.id === node.id);
      if (item) item.label = e.target.value || def.label;
    }));
    panel.querySelectorAll('[data-field]').forEach((input) => input.addEventListener('change', (e) => {
      const key = e.target.dataset.field;
      store.mutate((d) => {
        const item = d.nodes.find((n) => n.id === node.id);
        if (!item) return;
        item[key] = key === 'price' ? Number(e.target.value) || 0 : e.target.value;
      });
    }));
    panel.querySelectorAll('[data-prop]').forEach((input) => input.addEventListener('change', (e) => {
      const key = e.target.dataset.prop;
      const value = e.target.type === 'checkbox' ? e.target.checked : (e.target.type === 'number' ? Number(e.target.value) : e.target.value);
      store.mutate((d) => {
        const item = d.nodes.find((n) => n.id === node.id);
        if (item) item.props[key] = value;
      });
    }));
    $('#node-duplicate').addEventListener('click', () => editor.duplicateSelection());
    $('#node-delete').addEventListener('click', () => editor.deleteSelection());
    return;
  }

  // --------------------------------------------------------------- wire
  const wire = doc.wires.find((w) => w.id === sel.id);
  if (!wire) { editor.clearSelection(); return; }
  const sized = evaluation.wires.get(wire.id);
  const from = doc.nodes.find((n) => n.id === wire.from.node);
  const to = doc.nodes.find((n) => n.id === wire.to.node);
  if (!sized || !from || !to) return;
  const unit = sized.unit;
  const sizes = sizeOptions(unit).filter((s) => metricArea(s, unit) >= 0.8);
  const fuseFamily = wire.fuse?.family || 'auto';
  const fuseValue = wire.fuse === 'none' ? 'none' : (wire.fuse?.ratingA ? String(wire.fuse.ratingA) : 'auto');
  const kindLabel = TERMINAL_KINDS[sized.kind]?.label || sized.kind;

  panel.innerHTML = `
    <div class="section">
      <h3 class="section-title">Cable run <span class="badge neutral">${kindLabel}</span></h3>
      <p class="hint" style="margin-top:0"><strong style="color:var(--ink)">${escapeHtml(from.label)}</strong> → <strong style="color:var(--ink)">${escapeHtml(to.label)}</strong></p>
      <div class="field-row" style="margin-top:9px">
        ${field('Length (m)', `<input type="number" min="0" step="0.1" id="wire-length" value="${wire.lengthM ?? 0}">`)}
        ${field('Current (A)', `<input type="number" min="0" step="0.1" id="wire-current" value="${wire.currentA ?? ''}" placeholder="${sized.autoCurrentA}">`)}
      </div>
      <p class="hint">Leave current blank to use the calculated load${sized.currentSource && sized.currentSource !== 'default' ? ` (${escapeHtml(sized.currentSource)})` : ''}.</p>
      <div class="field-row">
        ${field('Cable size', `<select id="wire-size">
          <option value="">Auto — ${formatSize(sized.size, unit)}</option>
          ${sizes.map((s) => `<option value="${s}" ${String(wire.size) === String(s) ? 'selected' : ''}>${formatSize(s, unit)}</option>`).join('')}
        </select>`)}
        ${field('Fuse', `<select id="wire-fuse">
          <option value="auto" ${fuseValue === 'auto' ? 'selected' : ''}>Auto${sized.fuse ? ` — ${sized.fuse.ratingA} A` : ''}</option>
          <option value="none" ${fuseValue === 'none' ? 'selected' : ''}>No fuse</option>
          ${FUSE_RATINGS.map((r) => `<option value="${r}" ${fuseValue === String(r) ? 'selected' : ''}>${r} A</option>`).join('')}
        </select>`)}
      </div>
      ${field('Fuse family', `<select id="wire-family">
        <option value="auto" ${fuseFamily === 'auto' ? 'selected' : ''}>Auto</option>
        ${Object.values(FUSE_FAMILIES).map((f) => `<option value="${f.id}" ${fuseFamily === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}
      </select>`)}
    </div>

    <div class="section">
      <h3 class="section-title">Result <span class="badge ${sized.ampacityPass && sized.vdPass && !sized.fuseOverCable ? 'ok' : 'warning'}">${sized.limiting === 'manual' ? 'manual' : sized.limiting}</span></h3>
      <div class="metric-grid">
        <div class="metric ${sized.ampacityPass ? 'pass' : 'fail'}">
          <div class="k">Cable</div><div class="v">${formatSize(sized.size, unit)}</div>
        </div>
        <div class="metric ${sized.fuseOverCable ? 'fail' : 'pass'}">
          <div class="k">Fuse</div><div class="v">${sized.fuse ? `${sized.fuse.ratingA} A` : 'None'}</div>
        </div>
        <div class="metric ${sized.ampacityPass ? 'pass' : 'fail'}">
          <div class="k">Ampacity</div><div class="v">${sized.ampacity?.toFixed(1) ?? '—'} <small>A</small></div>
        </div>
        <div class="metric ${sized.vdPass ? 'pass' : 'warn'}">
          <div class="k">Voltage drop</div><div class="v">${sized.voltageDropPct.toFixed(1)}<small>%</small></div>
        </div>
        <div class="metric"><div class="k">Design current</div><div class="v">${sized.designA} <small>A</small></div></div>
        <div class="metric"><div class="k">Drop at load</div><div class="v">${sized.voltageDropV.toFixed(2)} <small>V</small></div></div>
      </div>
      <div class="reason">
        <strong style="font-size:12px">Why this size</strong>
        <ul>${sized.assumptions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
        ${sized.fuseOverCable ? '<p class="hint" style="color:var(--red);margin-top:7px">The fuse is larger than the derated cable ampacity. Reduce the fuse or increase the cable.</p>' : ''}
        ${sized.fuseUnderLoad ? '<p class="hint" style="color:var(--amber);margin-top:7px">This fuse is below the design current and may nuisance-blow.</p>' : ''}
      </div>
      <div class="field" style="margin-top:12px">
        <button class="btn small danger" id="wire-delete">Delete cable</button>
      </div>
    </div>`;

  $('#wire-length').addEventListener('change', (e) => store.mutate((d) => {
    const item = d.wires.find((w) => w.id === wire.id);
    if (item) item.lengthM = Math.max(0, Number(e.target.value) || 0);
  }));
  $('#wire-current').addEventListener('change', (e) => store.mutate((d) => {
    const item = d.wires.find((w) => w.id === wire.id);
    if (!item) return;
    const v = e.target.value === '' ? null : Number(e.target.value);
    item.currentA = v;
  }));
  $('#wire-size').addEventListener('change', (e) => store.mutate((d) => {
    const item = d.wires.find((w) => w.id === wire.id);
    if (item) item.size = e.target.value === '' ? null : e.target.value;
  }));
  $('#wire-fuse').addEventListener('change', (e) => store.mutate((d) => {
    const item = d.wires.find((w) => w.id === wire.id);
    if (!item) return;
    if (e.target.value === 'auto') item.fuse = null;
    else if (e.target.value === 'none') item.fuse = 'none';
    else item.fuse = { ratingA: Number(e.target.value), family: item.fuse?.family || null };
  }));
  $('#wire-family').addEventListener('change', (e) => store.mutate((d) => {
    const item = d.wires.find((w) => w.id === wire.id);
    if (!item) return;
    if (e.target.value === 'auto') { if (item.fuse && item.fuse !== 'none') item.fuse.family = null; return; }
    const rating = item.fuse && item.fuse !== 'none' ? item.fuse.ratingA : null;
    item.fuse = { ratingA: rating, family: e.target.value };
  }));
  $('#wire-delete').addEventListener('click', () => editor.deleteSelection());
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
function renderChecks() {
  const panel = $('#checks-panel');
  const checks = evaluation.checks;
  const actionable = checks.filter((c) => c.severity !== 'info');
  const pill = $('#check-pill');
  pill.hidden = !actionable.length;
  pill.textContent = actionable.length;

  if (!checks.length) {
    panel.innerHTML = `<div class="empty-state"><div class="glyph">✓</div><p>No issues found.</p><p class="hint">Checks run on every change.</p></div>`;
    return;
  }
  const groups = [
    ['critical', 'Critical'],
    ['warning', 'Worth checking'],
    ['info', 'Notes'],
  ];
  panel.innerHTML = groups.map(([severity, label]) => {
    const rows = checks.filter((c) => c.severity === severity);
    if (!rows.length) return '';
    return `<div class="section" style="padding-bottom:4px"><h3 class="section-title">${label} <span>${rows.length}</span></h3></div>
      ${rows.map((c, i) => `
        <div class="check ${severity}" data-check="${checks.indexOf(c)}">
          <div class="bar"></div>
          <div class="body">
            <div class="t">${escapeHtml(c.title)}</div>
            <div class="d">${escapeHtml(c.detail)}</div>
            <div class="meta"><span class="code">${checkCode(c)}</span>${c.wireIds.length || c.nodeIds.length ? '<span class="code">· click to locate</span>' : ''}</div>
          </div>
        </div>`).join('')}`;
  }).join('');

  panel.querySelectorAll('[data-check]').forEach((el) => el.addEventListener('click', () => {
    const check = checks[Number(el.dataset.check)];
    if (check.wireIds.length) {
      editor.selectWire(check.wireIds[0], true);
    } else if (check.nodeIds.length) {
      editor.selectNode(check.nodeIds[0], true);
    }
    updateStatus();
  }));
}

function checkCode(check) {
  return `RP-${String(evaluation.checks.indexOf(check) + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// BOM
// ---------------------------------------------------------------------------
function renderBom() {
  const panel = $('#bom-panel');
  const bom = evaluation.bom;
  const money = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: store.get().doc.settings.currency || 'GBP' }).format(n || 0);
  panel.innerHTML = `
    <div class="section" style="padding-bottom:0">
      <h3 class="section-title">Bill of materials</h3>
      <p class="hint" style="margin:0 0 10px">${bom.rows.length} lines · ${bom.cableTotalM} m of cable</p>
    </div>
    <table class="bom-table">
      <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th></tr></thead>
      <tbody>
        ${bom.rows.map((r) => `<tr>
          <td><strong>${escapeHtml(r.name)}</strong><br><span class="hint">${escapeHtml(r.detail || r.kind)}</span></td>
          <td class="num">${r.qty} ${r.unit}</td>
          <td class="num">${money(r.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="bom-total"><span>Total</span><span class="v">${money(bom.total)}</span></div>
    <div class="section">
      <button class="btn small block" id="bom-export">Export CSV</button>
    </div>`;
  $('#bom-export')?.addEventListener('click', () => exportCsv('bom'));
}

// ---------------------------------------------------------------------------
// Project panel
// ---------------------------------------------------------------------------
function renderProject() {
  const panel = $('#project-panel');
  const { doc, versions, projects } = store.get();
  const s = { ...DEFAULT_SETTINGS, ...doc.settings };
  const std = STANDARDS[s.standard] || STANDARDS.abyc;
  panel.innerHTML = `
    <div class="section">
      <h3 class="section-title">Title block</h3>
      ${field('Diagram name', `<input data-meta="name" value="${escapeAttr(doc.name)}">`)}
      ${field('Client', `<input data-meta="client" value="${escapeAttr(doc.client)}" placeholder="Client or owner">`)}
      <div class="field-row">
        ${field('Project ref', `<input data-meta="projectRef" value="${escapeAttr(doc.projectRef)}" placeholder="e.g. J-2291">`)}
        ${field('Drawing no.', `<input data-meta="drawingNo" value="${escapeAttr(doc.drawingNo)}">`)}
      </div>
      <div class="field-row">
        ${field('Revision', `<input data-meta="rev" value="${escapeAttr(doc.rev)}">`)}
        ${field('Date', `<input type="date" data-meta="date" value="${escapeAttr(doc.date)}">`)}
      </div>
      ${field('Notes', `<textarea data-meta="notes" placeholder="48 V DC · 230 V AC">${escapeAttr(doc.notes)}</textarea>`)}
    </div>

    <div class="section">
      <h3 class="section-title">Sizing settings</h3>
      ${field('Standard', `<select data-setting="standard">
        ${Object.values(STANDARDS).map((x) => `<option value="${x.id}" ${x.id === s.standard ? 'selected' : ''}>${x.label}</option>`).join('')}
      </select>`)}
      <div class="field-row">
        ${field('Conductor rating', `<select data-setting="tempRating">
          ${TEMP_RATINGS.map((t) => `<option value="${t.value}" ${t.value === s.tempRating ? 'selected' : ''}>${t.value} °C</option>`).join('')}
        </select>`)}
        ${field('Ambient', `<select data-setting="ambientC">
          ${[25, 30, 35, 40, 45, 50, 55, 60, 70, 80].map((t) => `<option value="${t}" ${t === s.ambientC ? 'selected' : ''}>${t} °C</option>`).join('')}
        </select>`)}
      </div>
      <div class="field-row">
        ${field('Voltage drop target', `<select data-setting="vdTarget">
          ${std.vdTargets.map((t) => `<option value="${t.value}" ${t.value === s.vdTarget ? 'selected' : ''}>${t.value}%</option>`).join('')}
        </select>`)}
        ${field('Units', `<select data-setting="units">
          <option value="mm2" ${s.units === 'mm2' ? 'selected' : ''}>mm²</option>
          <option value="AWG" ${s.units === 'AWG' ? 'selected' : ''}>AWG</option>
        </select>`)}
      </div>
      <div class="field-row">
        ${field('Installation method', `<select data-setting="method">
          ${std.methods.map((m) => `<option value="${m.id}" ${m.id === s.method ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>`)}
        ${field('Grouped circuits', `<input type="number" min="1" max="10" data-setting="groupingCount" value="${s.groupingCount}">`)}
      </div>
      <p class="hint">${std.ampacityCitation} · ${std.vdCitation}</p>
    </div>

    <div class="section">
      <h3 class="section-title">Named versions</h3>
      <button class="btn small block" id="save-version">Save a version</button>
      <div style="margin-top:8px">
        ${versions.length ? versions.map((v) => `
          <div class="version">
            <div><div class="t">${escapeHtml(v.label)}</div><div class="d">${new Date(v.at).toLocaleString()}</div></div>
            <div style="display:flex;gap:5px">
              <button class="btn small" data-restore="${v.id}">Restore</button>
              <button class="btn small ghost danger" data-rm-version="${v.id}">×</button>
            </div>
          </div>`).join('') : '<p class="hint">No saved versions yet.</p>'}
      </div>
    </div>

    <div class="section">
      <h3 class="section-title">Your diagrams</h3>
      ${projects.length ? projects.map((p) => `
        <div class="version">
          <div><div class="t">${escapeHtml(p.name)}</div><div class="d">${new Date(p.updatedAt).toLocaleDateString()}</div></div>
          <div style="display:flex;gap:5px">
            <button class="btn small" data-open="${p.id}" ${p.id === doc.id ? 'disabled' : ''}>Open</button>
            <button class="btn small ghost danger" data-rm-project="${p.id}">×</button>
          </div>
        </div>`).join('') : '<p class="hint">This is your first diagram.</p>'}
    </div>

    <div class="section">
      <h3 class="section-title">Start from a template</h3>
      ${TEMPLATES.map((t) => `<button class="btn small block" style="justify-content:flex-start;margin-bottom:6px" data-template="${t.id}">${t.name}</button>`).join('')}
    </div>

    <div class="section">
      <h3 class="section-title">Data</h3>
      <div class="field-row">
        <button class="btn small" id="project-export">Export JSON</button>
        <button class="btn small" id="project-import">Import JSON</button>
      </div>
    </div>`;

  panel.querySelectorAll('[data-meta]').forEach((input) => input.addEventListener('change', (e) => {
    const key = e.target.dataset.meta;
    store.mutate((d) => { d[key] = e.target.value; });
  }));
  panel.querySelectorAll('[data-setting]').forEach((input) => input.addEventListener('change', (e) => {
    const key = e.target.dataset.setting;
    store.mutate((d) => {
      d.settings[key] = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
      if (key === 'standard') {
        const next = STANDARDS[e.target.value];
        d.settings.tempRating = next.defaultTempRating;
        d.settings.ambientC = next.defaultAmbientC;
        d.settings.vdTarget = next.defaultVd;
        d.settings.method = next.defaultMethod;
      }
    });
  }));
  $('#save-version')?.addEventListener('click', () => {
    const label = prompt('Version name', `Rev ${store.get().doc.rev} · ${new Date().toLocaleDateString()}`);
    if (label != null) { store.snapshot(label); toast('Version saved.'); }
  });
  panel.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Restore this version? The current drawing will be replaced (undo still works).')) store.restoreVersion(b.dataset.restore);
  }));
  panel.querySelectorAll('[data-rm-version]').forEach((b) => b.addEventListener('click', () => store.deleteVersion(b.dataset.rmVersion)));
  panel.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => store.loadProject(b.dataset.open)));
  panel.querySelectorAll('[data-rm-project]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Delete this diagram permanently?')) store.deleteProject(b.dataset.rmProject);
  }));
  panel.querySelectorAll('[data-template]').forEach((b) => b.addEventListener('click', () => {
    const tpl = TEMPLATES.find((t) => t.id === b.dataset.template);
    if (!tpl) return;
    if (!confirm(`Start "${tpl.name}"? The current drawing stays saved in Your diagrams.`)) return;
    store.newProject(tpl.build());
    requestAnimationFrame(() => editor.fit());
  }));
  $('#project-export')?.addEventListener('click', () => exportJson());
  $('#project-import')?.addEventListener('click', () => $('#file-input').click());
}

// ---------------------------------------------------------------------------
// Status + refresh
// ---------------------------------------------------------------------------
function updateStatus() {
  const { doc } = store.get();
  const critical = evaluation.checks.filter((c) => c.severity === 'critical').length;
  const warning = evaluation.checks.filter((c) => c.severity === 'warning').length;
  $('#status-standard').textContent = STANDARDS[doc.settings.standard]?.label || '—';
  $('#status-parts').textContent = doc.nodes.length;
  $('#status-cables').textContent = doc.wires.length;
  $('#status-critical').hidden = !critical;
  if (critical) $('#status-critical').innerHTML = `<span class="status-dot"></span><strong>${critical}</strong> critical`;
  $('#status-warning').hidden = !warning;
  if (warning) $('#status-warning').innerHTML = `<span class="status-dot"></span><strong>${warning}</strong> to check`;
  $('#status-ok').hidden = Boolean(critical || warning);
  $('#status-zoom').textContent = `${Math.round(editor.getView().zoom * 100)}%`;
  $('#project-name').value = doc.name;
  $('#save-state').textContent = store.get().dirty ? 'Saving…' : 'Saved';
  $('#save-state').classList.toggle('dirty', store.get().dirty);
}

function refresh() {
  const { doc } = store.get();
  evaluation = evaluateDiagram(doc);
  editor.setSizedWires(evaluation.wires);
  updateStatus();
  renderChecks();
  renderBom();
  renderInspector();
  renderProject();
  $('#btn-undo').disabled = !store.get().canUndo;
  $('#btn-redo').disabled = !store.get().canRedo;
}

store.subscribe(refresh);

// ---------------------------------------------------------------------------
// Tabs, tools, header
// ---------------------------------------------------------------------------
function switchTab(name) {
  activeTab = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
}
$$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

function setTool(tool) {
  editor.setTool(tool);
  $$('#tool-select, #tool-wire, #ct-select, #ct-wire').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
}
$('#tool-select').addEventListener('click', () => setTool('select'));
$('#tool-wire').addEventListener('click', () => setTool('wire'));
$('#ct-select').addEventListener('click', () => setTool('select'));
$('#ct-wire').addEventListener('click', () => setTool('wire'));

$('#btn-undo').addEventListener('click', () => store.undo());
$('#btn-redo').addEventListener('click', () => store.redo());
$('#btn-fit').addEventListener('click', () => { editor.fit(); updateStatus(); });
$('#ct-fit').addEventListener('click', () => { editor.fit(); updateStatus(); });
$('#btn-zoom-in').addEventListener('click', () => { editor.zoomBy(1.2); updateStatus(); });
$('#btn-zoom-out').addEventListener('click', () => { editor.zoomBy(1 / 1.2); updateStatus(); });

$('#project-name').addEventListener('change', (e) => store.renameProject(e.target.value));

$('#btn-export').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#export-menu').classList.toggle('open');
});
document.addEventListener('click', () => $('#export-menu').classList.remove('open'));
$('#export-menu').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-export]');
  if (btn) runExport(btn.dataset.export);
});

$('#btn-new').addEventListener('click', openNewDialog);

// ---------------------------------------------------------------------------
// New diagram dialog
// ---------------------------------------------------------------------------
function openNewDialog() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(18,32,46,.38);z-index:80;display:grid;place-items:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:620px;width:100%;box-shadow:0 30px 80px rgba(10,25,40,.3);overflow:hidden">
      <div style="padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-weight:650;font-size:16px">New diagram</div><div class="hint">Start blank or from a worked example.</div></div>
        <button class="icon-btn" data-close>✕</button>
      </div>
      <div style="padding:16px 20px;display:grid;gap:8px;max-height:60vh;overflow:auto">
        <button class="btn" data-new="blank" style="justify-content:flex-start;height:auto;padding:12px 14px">
          <div style="text-align:left"><div style="font-weight:600">Blank drawing</div><div class="hint">An empty sheet with a title block.</div></div>
        </button>
        ${TEMPLATES.map((t) => `
          <button class="btn" data-new="${t.id}" style="justify-content:flex-start;height:auto;padding:12px 14px">
            <div style="text-align:left"><div style="font-weight:600">${t.name}</div><div class="hint">${t.blurb}</div></div>
          </button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
  overlay.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.new;
    if (id === 'blank') {
      store.newProject(emptyProject({ name: 'Untitled system', settings: { ...DEFAULT_SETTINGS } }));
    } else {
      const tpl = TEMPLATES.find((t) => t.id === id);
      if (tpl) store.newProject(tpl.build());
    }
    close();
    requestAnimationFrame(() => { editor.fit(); updateStatus(); });
    toast('New diagram ready.');
  }));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function runExport(kind) {
  $('#export-menu').classList.remove('open');
  if (kind === 'png') return exportPng();
  if (kind === 'svg') return exportSvg();
  if (kind === 'pdf') return exportPdf();
  if (kind === 'json') return exportJson();
  if (kind === 'import') return $('#file-input').click();
  return exportCsv(kind);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const slug = (value) => (value || 'diagram').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram';

function exportJson() {
  const { doc } = store.get();
  const clean = { ...doc, wires: doc.wires.map(({ _sized, ...w }) => w) };
  download(new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' }), `${slug(doc.name)}.json`);
  toast('Project file exported.');
}

function exportSvg() {
  const doc = store.get().doc;
  const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n${editor.exportSvgString()}`;
  download(new Blob([svgText], { type: 'image/svg+xml' }), `${slug(doc.name)}.svg`);
  toast('SVG drawing exported.');
}

async function exportPng() {
  const doc = store.get().doc;
  const text = editor.exportSvgString();
  const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = 1800 * scale;
    canvas.height = 1100 * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((out) => {
      if (out) download(out, `${slug(doc.name)}.png`);
      URL.revokeObjectURL(url);
      toast('PNG exported at 2× (A0-ready).');
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Could not render the PNG.', true); };
  img.src = url;
}

function exportPdf() {
  const doc = store.get().doc;
  const win = window.open('', '_blank');
  if (!win) { toast('Allow pop-ups to print the PDF.', true); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(doc.name)}</title>
    <style>
      @page { size: A3 landscape; margin: 8mm; }
      html,body { margin:0; padding:0; background:#fff; }
      svg { width:100%; height:auto; display:block; }
    </style></head><body>${editor.exportSvgString()}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 350);
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function exportCsv(kind) {
  const { doc } = store.get();
  const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: doc.settings.currency || 'GBP' }).format;
  let csv = '';
  if (kind === 'bom') {
    csv = toCsv(['Kind', 'Item', 'Detail', 'Qty', 'Unit', 'Unit price', 'Total'],
      evaluation.bom.rows.map((r) => [r.kind, r.name, r.detail, r.qty, r.unit, r.unitPrice, r.total]));
  } else if (kind === 'cables') {
    csv = toCsv(['Run', 'From', 'To', 'Length (m)', 'Cable', 'Current (A)', 'Design (A)', 'Ampacity (A)', 'Drop (%)', 'Fuse (A)', 'Standard'],
      doc.wires.map((w) => {
        const s = evaluation.wires.get(w.id);
        const from = doc.nodes.find((n) => n.id === w.from.node)?.label || '';
        const to = doc.nodes.find((n) => n.id === w.to.node)?.label || '';
        return [w.id, from, to, w.lengthM ?? 0, s ? formatSize(s.size, s.unit) : '', s?.currentA ?? '', s?.designA ?? '', s?.ampacity?.toFixed(1) ?? '', s?.voltageDropPct?.toFixed(1) ?? '', s?.fuse?.ratingA ?? '', s?.standardLabel ?? ''];
      }));
  } else if (kind === 'fuses') {
    csv = toCsv(['Run', 'From', 'To', 'Fuse', 'Rating (A)', 'Cable', 'Cable ampacity (A)', 'Design current (A)'],
      doc.wires.map((w) => {
        const s = evaluation.wires.get(w.id);
        if (!s?.fuse) return null;
        const from = doc.nodes.find((n) => n.id === w.from.node)?.label || '';
        const to = doc.nodes.find((n) => n.id === w.to.node)?.label || '';
        return [w.id, from, to, FUSE_FAMILIES[s.fuse.family]?.label || s.fuse.family, s.fuse.ratingA, formatSize(s.size, s.unit), s.ampacity?.toFixed(1) ?? '', s.designA];
      }).filter(Boolean));
  }
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${slug(doc.name)}-${kind}.csv`);
  toast(`${kind[0].toUpperCase()}${kind.slice(1)} schedule exported.`);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.nodes) || !parsed.name) throw new Error('Not a RigPlan project');
    parsed.id = `d_${Math.random().toString(36).slice(2, 9)}`;
    parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    parsed.wires = (parsed.wires || []).map(({ _sized, ...w }) => w);
    store.newProject(parsed);
    requestAnimationFrame(() => { editor.fit(); updateStatus(); });
    toast('Project imported.');
  } catch (err) {
    toast(`Could not import: ${err.message}`, true);
  } finally {
    e.target.value = '';
  }
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(message, error = false) {
  const host = $('#toasts');
  host.innerHTML = `<div class="toast ${error ? 'error' : ''}">${escapeHtml(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.innerHTML = ''; }, 3200);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, '&apos;'); }

renderLibrary();
refresh();
editor.fit();
updateStatus();
requestAnimationFrame(() => { editor.fit(); updateStatus(); });
if (store.get().recoveredNodes) {
  const count = store.get().recoveredNodes;
  toast(`Recovered ${count} component${count === 1 ? '' : 's'} that had been dragged off the sheet.`);
}

// Exposed for the browser console and the automated smoke test.
window.__rigplan = { store, editor, get evaluation() { return evaluation; } };

// Re-evaluate after view changes that do not touch the document.
window.addEventListener('resize', () => updateStatus());
