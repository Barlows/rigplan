// Document store: undo/redo, local persistence, named versions.

import { DEFAULT_SETTINGS } from './engine.js?v=20261045';

const KEY = 'rigplan.library.v1';
const MAX_UNDO = 60;
const SHEET_W = 1800;
const SHEET_H = 1100;
const SHEET_MARGIN = 120;

/** Pull back nodes whose whole body sits far outside the drawing sheet.
 *  Older builds could compound drag deltas and save a component at x=50000;
 *  without this the drawing opens zoomed out around a single stray part.
 */
export function recoverOffSheet(diagram) {
  let count = 0;
  for (const node of diagram?.nodes || []) {
    const w = Number(node.w) || 0;
    const h = Number(node.h) || 0;
    const x = Number(node.x);
    const y = Number(node.y);
    const invalid = !Number.isFinite(x) || !Number.isFinite(y);
    const outside = !invalid && (
      x + w < -SHEET_MARGIN || x > SHEET_W + SHEET_MARGIN
      || y + h < -SHEET_MARGIN || y > SHEET_H + SHEET_MARGIN
    );
    if (!invalid && !outside) continue;
    const safeX = Number.isFinite(x) ? x : 40;
    const safeY = Number.isFinite(y) ? y : 40;
    node.x = Math.round(Math.min(Math.max(safeX, 40), Math.max(40, SHEET_W - w - 40)));
    node.y = Math.round(Math.min(Math.max(safeY, 40), Math.max(40, SHEET_H - h - 40)));
    count++;
  }
  return count;
}

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export function emptyProject(overrides = {}) {
  return {
    id: `d_${Math.random().toString(36).slice(2, 9)}`,
    name: 'Untitled system',
    client: '',
    projectRef: '',
    drawingNo: 'RP-001',
    rev: 'A',
    date: new Date().toISOString().slice(0, 10),
    notes: '',
    settings: { ...DEFAULT_SETTINGS },
    nodes: [],
    wires: [],
    ...overrides,
  };
}

function loadLibrary() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.projects?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLibrary(lib) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}

export function createStore(initialDoc) {
  const library = loadLibrary() || { activeId: null, projects: [], versions: {} };
  const saved = library.projects.find((p) => p.id === library.activeId)?.diagram;
  const recoveredNodes = saved ? recoverOffSheet(saved) : 0;
  let doc = saved || initialDoc || emptyProject();
  let undo = [];
  let redo = [];
  const listeners = new Set();
  let saveTimer = null;
  let dirty = false;

  function persist() {
    const idx = library.projects.findIndex((p) => p.id === doc.id);
    const row = { id: doc.id, name: doc.name, updatedAt: new Date().toISOString(), diagram: clone(doc) };
    if (idx >= 0) library.projects[idx] = row; else library.projects.unshift(row);
    library.activeId = doc.id;
    saveLibrary(library);
    dirty = false;
  }

  function scheduleSave() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { persist(); emit(); }, 500);
  }

  function emit() {
    for (const fn of listeners) fn(state());
  }

  function state() {
    return { doc, canUndo: undo.length > 0, canRedo: redo.length > 0, dirty, recoveredNodes,
      versions: library.versions[doc.id] || [], projects: library.projects.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })) };
  }

  function commit(mutator, { history = true } = {}) {
    if (history) {
      undo.push(clone(doc));
      if (undo.length > MAX_UNDO) undo.shift();
      redo = [];
    }
    mutator(doc);
    doc.date = doc.date || new Date().toISOString().slice(0, 10);
    emit();
    scheduleSave();
  }

  return {
    get: state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    setDoc(next, { history = true } = {}) {
      commit((d) => { Object.assign(d, clone(next)); }, { history });
    },

    mutate(fn, opts) { commit(fn, opts); },

    undo() {
      if (!undo.length) return;
      redo.push(clone(doc));
      doc = undo.pop();
      emit(); scheduleSave();
    },
    redo() {
      if (!redo.length) return;
      undo.push(clone(doc));
      doc = redo.pop();
      emit(); scheduleSave();
    },

    newProject(templateDoc) {
      persist();
      doc = clone(templateDoc || emptyProject());
      undo = []; redo = [];
      emit(); scheduleSave();
    },

    loadProject(id) {
      const row = library.projects.find((p) => p.id === id);
      if (!row) return;
      persist();
      doc = clone(row.diagram);
      undo = []; redo = [];
      library.activeId = id;
      emit(); scheduleSave();
    },

    deleteProject(id) {
      const idx = library.projects.findIndex((p) => p.id === id);
      if (idx < 0) return;
      library.projects.splice(idx, 1);
      if (doc.id === id) {
        doc = library.projects[0] ? clone(library.projects[0].diagram) : emptyProject();
        library.activeId = doc.id;
      }
      saveLibrary(library);
      emit();
    },

    renameProject(name) {
      commit((d) => { d.name = name || 'Untitled system'; });
    },

    snapshot(label = '') {
      const list = library.versions[doc.id] || [];
      list.unshift({ id: `v_${Date.now()}`, label: label || `Version ${list.length + 1}`, at: new Date().toISOString(), diagram: clone(doc) });
      library.versions[doc.id] = list.slice(0, 25);
      persist();
      emit();
    },

    restoreVersion(versionId) {
      const version = (library.versions[doc.id] || []).find((v) => v.id === versionId);
      if (!version) return;
      commit((d) => { Object.assign(d, clone(version.diagram)); });
    },

    deleteVersion(versionId) {
      library.versions[doc.id] = (library.versions[doc.id] || []).filter((v) => v.id !== versionId);
      persist(); emit();
    },

    persistNow() { persist(); emit(); },

    resetAll() {
      persist();
      doc = emptyProject();
      undo = []; redo = [];
      emit(); scheduleSave();
    },
  };
}
