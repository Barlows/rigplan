/* ============================================================================
   ui.js — application shell: properties, schedules, audit, import/export
   ==========================================================================*/
'use strict';

(function () {
  var S = null;              // project
  var sel = null;            // {id, kind}
  var tab = 'loads';
  var sort = { col: null, dir: 1 };
  var filter = { q: '', unassigned: false, noCable: false };
  var store = 'eload-sched-v1';
  /* Whether the audit folds repeated findings together. On by default, because
     a list where the same finding appears once per affected circuit cannot be
     read — on the real project 36 of 59 rows were the same note about large
     motors. The full list is always in the CSV and the print report, so this
     only changes what the screen shows. */
  var auditGrouped = true;

  /* ------------------------------------------------------------------ undo --
     Snapshot undo rather than command reversal. Reversing an operation means
     knowing exactly what each of a dozen places did to which object, and every
     one of those places has to be remembered forever. A snapshot needs no
     knowledge of any of them: it is the state before, and restoring it is
     assigning it back.

     The cost is memory — each entry is the whole project as JSON — so the stack
     is kept short and each entry is a string, not an object graph, which keeps
     it compact and makes the restore a single parse. */
  var UNDO_MAX = 25;
  var undoStack = [], redoStack = [];
  var undoPending = null;

  /* Call this immediately before anything mutates the design. Deep-copy through
     JSON so later edits cannot reach back into the snapshot, and label it so
     the toast can say what is being put back.

     Typing in a field is coalesced: every keystroke would otherwise make its own
     undo step, so undo would walk back through a word one letter at a time. The
     first keystroke on a given field takes the snapshot; the rest update its
     label and keep that same snapshot, so one undo removes the whole edit. The
     window is short enough that two separate visits to the same field still get
     their own steps. */
  var UNDO_COALESCE_MS = 1500;
  /* Survives commitUndo(), because every keystroke commits. Without this the
     pending snapshot is cleared between keystrokes and each one becomes its own
     undo step. */
  var lastCoalesce = { key: null, at: 0 };
  function pushUndo(label, coalesceKey) {
    var now = Date.now();
    if (coalesceKey && lastCoalesce.key === coalesceKey && now - lastCoalesce.at < UNDO_COALESCE_MS) {
      /* a continued edit on the same field: keep the snapshot taken when the
         field was first touched, so one undo reverts the whole edit */
      lastCoalesce.at = now;
      if (undoPending) undoPending.label = label || undoPending.label;
      return;
    }
    try {
      undoPending = { label: label || 'change', key: coalesceKey || null, at: now, state: snapshot() };
    } catch (e) { undoPending = null; }
    lastCoalesce = { key: coalesceKey, at: now };
  }
  /* Commit the pending snapshot. Separate from pushUndo because an operation can
     be abandoned after the snapshot was taken — a cancelled modal, a click that
     hit a full board — and committing those would fill the stack with no-ops
     that undo would appear to do but not. */
  function commitUndo() {
    if (!undoPending) return;
    undoStack.push(undoPending);
    while (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
    undoPending = null;
    /* the coalesce window is deliberately not reset here: a continued edit on
       the same field must still fold into the step it started */
    syncUndoUi();
  }
  /* An operation that decided not to happen — a cancelled modal, a click that
     found the board full — must leave the stack alone, or undo would appear to
     do something and not do it. */
  function discardUndo() { undoPending = null; }

  function restore(snap) {
    var p;
    try { p = JSON.parse(snap.state); } catch (e) { return false; }
    S = LS.newProject(p);
    bootstrap(S);
    PLAN.setProject(S);
    /* a restored project may reference items that no longer exist */
    if (sel && !LC.allItems(S).some(function (o) { return o.id === sel.id; })) sel = null;
    syncToolbar();
    commit(true);
    return true;
  }
  function doUndo() {
    if (!undoStack.length) { toast('Nothing to undo', ''); return; }
    var entry = undoStack.pop();
    redoStack.push({ label: entry.label, state: snapshot() });
    if (!restore(entry)) { toast('Could not restore that — the project file may be damaged', 'bad'); return; }
    toast('Undid <b>' + esc(entry.label) + '</b>', '');
    /* the coalesce window closes with the step, so undoing then typing again in
       the same field starts a fresh step rather than folding into the one just
       taken back */
    lastCoalesce = { key: null, at: 0 };
    syncUndoUi();
  }
  function doRedo() {
    if (!redoStack.length) { toast('Nothing to redo', ''); return; }
    var entry = redoStack.pop();
    undoStack.push({ label: entry.label, state: snapshot() });
    if (!restore(entry)) { toast('Could not restore that', 'bad'); return; }
    toast('Redid <b>' + esc(entry.label) + '</b>', '');
    lastCoalesce = { key: null, at: 0 };
    syncUndoUi();
  }
  function syncUndoUi() {
    var u = el('btnUndo'), r = el('btnRedo');
    if (u) { u.disabled = !undoStack.length; u.title = undoStack.length ? 'Undo ' + esc(undoStack[undoStack.length - 1].label) + ' (' + undoStack.length + ' available)' : 'Nothing to undo'; }
    if (r) { r.disabled = !redoStack.length; r.title = redoStack.length ? 'Redo ' + esc(redoStack[redoStack.length - 1].label) : 'Nothing to redo'; }
  }
  /* Which board rows are folded in the supply hierarchy. Declared here rather
     than beside the tree code because bootstrap() reads it during startup,
     before anything else has run. */
  var collapsed = {};

  /* ------------------------------------------------------------- utilities */
  function el(id) { return document.getElementById(id); }
  function num(v, d) { return LS.num(v, d); }
  function esc(s) { return LS.esc(s); }
  function utilCls(u) { return u === null || u === undefined ? '' : u > 100 ? 'num-bad' : u > 85 ? 'num-warn' : 'num-ok'; }
  function utilBadge(u, txt) {
    if (u === null || u === undefined) return '<span class="badge mute">n/a</span>';
    var c = u > 100 ? 'bad' : u > 85 ? 'warn' : 'ok';
    return '<span class="badge ' + c + '">' + (txt || u.toFixed(0) + '%') + '</span>';
  }
  function toast(msg, cls) {
    var t = el('toast');
    t.innerHTML = msg;
    t.className = 'toast show ' + (cls || '');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.className = 'toast ' + (cls || ''); }, 3400);
  }
  function opts(arr, sel, fmt) {
    return arr.map(function (v) {
      var s = fmt ? fmt(v) : String(v);
      return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
  }
  function dataliste(id, arr) { return '<datalist id="' + id + '">' + arr.map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join('') + '</datalist>'; }

  /* ------------------------------------------------------------------ init */
  function init() {
    S = load() || LS.sampleProject();
    bootstrap(S);
    document.querySelectorAll('datalist#dlIncomer, datalist#dlCsa, datalist#dlKva').forEach(function (d) { d.remove(); });
    buildDatalists();
    wire();
    PLAN.init(el('plan'), el('canvasWrap'), S, App);
    syncToolbar();
    renderAll(true);
    var fresh = !load();
    if (fresh) {
      setTimeout(function () { afterLoad(); }, 30);
      return;
    }
    /* A restored project deliberately does not get the auto-assign and cable
       sweep — those would churn a design the engineer has saved. Completing
       the protection schedule is different: it only touches supplies that have
       no device at all, or a device with no breaking capacity, and never
       changes a rating that is already set. So it is safe on every open. */
    var n = fillProtection();
    if (n) { renderAll(true); toast(n + ' protective device(s) filled in from the fault level', 'good'); }
  }
  /* Complete the protection schedule without disturbing any device that is
     already set. Returns how many supplies were touched.

     `allowEmpty` is for a project the engineer has just asked for — the built-in
     sample, or a fresh import. There, having no protection data at all is not a
     half-finished design to be careful with but a blank sheet to fill in, and
     proposing for the whole thing is what "Sample" is for. On a restored
     project it stays off: an empty protection schedule there is usually the
     engineer's deliberate starting point. */
  function fillProtection(allowEmpty) {
    var supplies = [].concat(S.pdbs, S.pdps, S.dbs, S.panels);
    if (!supplies.length) return 0;
    if (!allowEmpty && !supplies.some(function (o) { return o.prot; })) return 0;
    var blank = 0;
    supplies.forEach(function (o) {
      if (!o.prot) blank++;
      else if (!num(o.prot.icu, 0)) blank++;
    });
    if (!blank) return 0;
    LC.protAll(S, { replace: false });
    LC.sizeAll(S);
    save();
    return blank;
  }
  function buildDatalists() {
    var d = document.createElement('div');
    d.innerHTML = dataliste('dlIncomer', LS.SIZES_A) + dataliste('dlCsa', LS.CSA) + dataliste('dlKva', LS.SIZES_KVA);
    document.body.appendChild(d);
  }
  function bootstrap(p) {
    p.design = Object.assign({}, LS.DEFAULTS, p.design || {});
    p.site = Object.assign({ w: 44, h: 30, ox: 0, oy: 0 }, p.site || {});
    p.place = Object.assign({ snap: 1, offset: 2, clearance: 1.5 }, p.place || {});
    if (p.underlay) restoreUnderlay(p);
    [p.txs, p.pdbs, p.pdps, p.dbs, p.panels].forEach(function (a) { if (!Array.isArray(a)) a.length = 0; });
    /* fill in anything an older or hand-edited file left empty */
    LC.allItems(p).forEach(function (o) {
      if (o.__kind === 'tx') return;
      if (!o.cable) o.cable = { csa: null, runs: 1, cores: 4, len: 0, method: 'XL-A1', group: 2, ambient: 40, sheathed: true };
      if (o.cable.runs === undefined || o.cable.runs === null) o.cable.runs = 1;
      if (o.cable.cores === undefined || o.cable.cores === null) o.cable.cores = 4;
      if (o.cable.method === undefined) o.cable.method = 'XL-A1';
      if (!o.pos) o.pos = { x: p.site.w / 2, y: p.site.h / 2 };
    });
    /* Board references follow the hierarchy, so they are rebuilt on every
       load — including for a project saved before the convention existed,
       which is how those references migrate. It only rewrites tags; it
       never moves a load, so running it on load is safe. */
    LC.applyNumbering(p);
    loadTree();
  }
  function load() {
    try { var raw = localStorage.getItem(store); if (!raw) return null; var p = JSON.parse(raw); return p && p.txs ? p : null; }
    catch (e) { return null; }
  }
  /* A saved underlay has lost its live <img> and source text. Put back what
     can be recovered: the geometry is stored, so a DXF redraws immediately;
     an image needs its data URL, and says so plainly if it was dropped. */
  function restoreUnderlay(p) {
    var u = p.underlay;
    if (!u || !u.kind) return;
    if (u.kind === 'dxf' && u.geo && u.geo.entities) return;   // geometry is enough
    if (u.kind === 'image' && u.dataUrl) {
      var img = new Image();
      img.onload = function () { u.img = img; PLAN.draw(); };
      img.src = u.dataUrl;
      u.img = img;
      return;
    }
    if (u.kind === 'image') {
      p.underlay = null;
      setTimeout(function () { toast('The site photo was too large to save with the project — re-drop the image to use it again.', ''); }, 600);
    }
  }
  function save() {
    try {
      localStorage.setItem(store, JSON.stringify(serialise()));
    } catch (e) {
      /* quota is the usual reason: most often a large embedded map image.
         Retry once without the underlay so the electrical design is never
         lost just because the background was too big to persist. */
      try {
        var slim = serialise();
        if (slim.underlay) { slim.underlay = null; localStorage.setItem(store, JSON.stringify(slim)); }
      } catch (e2) { /* give up quietly; the in-memory project is intact */ }
    }
  }
  /* JSON-safe form of the project. The live <img> and the DXF source text
     are dropped — the geometry and placement are what matter, and the
     geometry is re-derivable by re-importing the file. */
  function serialise() {
    var out = JSON.parse(JSON.stringify(Object.assign({}, S, {
      txs: S.txs, pdbs: S.pdbs, pdps: S.pdps, dbs: S.dbs, panels: S.panels
    })));
    var u = out.underlay;
    if (u) {
      delete u.img;
      delete u.srcText;
      if (u.dataUrl && u.dataUrl.length > 400000) delete u.dataUrl;   // keep the export readable
    }
    return out;
  }

  /* A snapshot for undo keeps the site map, where an export deliberately drops
     it — losing the background because you undid a rename would be a poor trade.
     The <img> element is dropped because it is not serialisable, but its dataUrl
     is what rebuilds it, and restoreUnderlay() does that on load. */
  function snapshot() {
    var out = JSON.parse(JSON.stringify(Object.assign({}, S, {
      txs: S.txs, pdbs: S.pdbs, pdps: S.pdps, dbs: S.dbs, panels: S.panels
    })));
    if (out.underlay) { delete out.underlay.img; delete out.underlay.srcText; }
    return JSON.stringify(out);
  }

  /* ------------------------------------------------------------- rendering */
  function renderAll(structural) {
    renderTop(); renderTree(); renderTabs(); renderTab();
    if (structural) renderProps(); else refreshDyn();
    PLAN.draw();
  }
  function commit(structural) {
    commitUndo();
    save();
    renderTop(); renderTree(); renderTabs(); renderTab();
    if (structural) renderProps(); else refreshDyn();
    PLAN.draw();
  }

  /* ------------------------------------------------------------- top stats */
  function renderTop() {
    var t = LC.totals(S);
    var issues = LC.audit(S);
    var bad = issues.filter(function (i) { return i.level === 'bad'; }).length;
    var warn = issues.filter(function (i) { return i.level === 'warn'; }).length;
    el('topStats').innerHTML =
      stat('Connected', t.kw.toFixed(0) + ' <small>kW</small>') +
      stat('Design load', t.kva.toFixed(0) + ' <small>kVA</small>' +
        /* Both bases shown when they differ, because a power factor is only
           meaningful against the kW that shares its demand basis. The real
           project has 9,525 kW connected and 4,172 kVA diversified — comparing
           those two gave a power factor of 2.28 and a meaningless kvar. */
        (t.diversified ? '<br><small style="color:var(--fg-mute)">' + t.kwDiv.toFixed(0) + ' kW diversified</small>' : '')) +
      stat('Reactive', t.kvar.toFixed(0) + ' <small>kvar</small> · ' + t.pf.toFixed(2) + ' pf<small>' +
        (t.diversified ? ' at design load' : '') + '</small>') +
      stat('TX installed', t.txKva.toFixed(0) + ' <small>kVA</small>') +
      stat('TX loading', '<span style="color:' + (t.txUtil > 100 ? '#fca5a5' : t.txUtil > 90 ? '#fcd34d' : '#86efac') + '">' + t.txUtil.toFixed(0) + '%</span>') +
      stat('Phase imbalance', '<span style="color:' + (t.dev > 25 ? '#fca5a5' : t.dev > 15 ? '#fcd34d' : '#86efac') + '">' + t.dev.toFixed(0) + '%</span>') +
      stat('Boards', S.pdps.length + ' <small>PDP</small> · ' + S.dbs.length + ' <small>DB</small>') +
      stat('Panels', S.panels.length + (t.unassigned ? ' <small style="color:#fbbf24">· ' + t.unassigned + ' unassigned</small>' : '')) +
      stat('Warnings', bad ? '<span style="color:#fca5a5">' + bad + ' ✕</span>' : (warn ? '<span style="color:#fcd34d">' + warn + ' !</span>' : '<span style="color:#86efac">none</span>'));
    function stat(k, v) { return '<div class="ts"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
  }

  /* ------------------------------------------------------------------ tree */
  /* The hierarchy folds. `collapsed` holds the ids of the nodes whose children
     are hidden, so a board remembers its state as you move around the design.
     Everything is open by default — a project you have just opened should look
     like a project, not a summary — and the fold state is part of the saved
     project so it survives a reload. */
  var TREE_OPEN = 'eload-tree';

  function treeOpen(mode) {
    /* mode: 'expand' | 'collapse' | 'toggle' | 'invert' */
    var ids = LC.allItems(S).filter(function (o) { return o.__kind !== 'panel'; }).map(function (o) { return o.id; });
    if (mode === 'expand') collapsed = {};
    else if (mode === 'collapse') { collapsed = {}; ids.forEach(function (id) { collapsed[id] = 1; }); }
    else if (mode === 'invert') {
      var next = {};
      ids.forEach(function (id) { if (!collapsed[id]) next[id] = 1; });
      collapsed = next;
    }
    saveTree();
    renderTree();
  }
  function toggleNode(id) {
    if (collapsed[id]) delete collapsed[id];
    else collapsed[id] = 1;
    saveTree();
    renderTree();
  }
  function saveTree() {
    try {
      var open = {};
      LC.allItems(S).filter(function (o) { return o.__kind !== 'panel'; }).forEach(function (o) {
        if (!collapsed[o.id]) open[o.id] = 1;
      });
      localStorage.setItem(TREE_OPEN, JSON.stringify(open));
    } catch (e) { /* private mode, or over quota — the tree still works */ }
  }
  function loadTree() {
    collapsed = {};
    try {
      var raw = localStorage.getItem(TREE_OPEN);
      if (!raw) return;
      var open = JSON.parse(raw) || {};
      var ids = {};
      LC.allItems(S).forEach(function (o) { ids[o.id] = 1; });
      /* anything not recorded as open is collapsed */
      LC.allItems(S).forEach(function (o) {
        if (o.__kind !== 'panel' && !open[o.id]) collapsed[o.id] = 1;
      });
    } catch (e) { collapsed = {}; }
  }
  /* how many descendants a node has, for the summary shown when folded */
  function isOpen(id) { return !collapsed[id]; }

  /* Expand every board in one transformer, and leave it fully open: the point
     of the fold is to drill down a branch without having to open each level. */
  function revealAll(o) {
    var guard = 0;
    /* the transformer itself must open too, or nothing below it shows */
    delete collapsed[o.id];
    var stack = LC.pdbOfTx(S, o.id).slice();
    while (stack.length && guard++ < 500) {
      var b = stack.pop();
      if (collapsed[b.id]) delete collapsed[b.id];
      LC.pdpOfPdb(S, b.id).forEach(function (d) {
        if (collapsed[d.id]) delete collapsed[d.id];
        LC.dbOfPdp(S, d.id).forEach(function (b2) {
          if (collapsed[b2.id]) delete collapsed[b2.id];
        });
      });
    }
    saveTree();
    renderTree();
  }
  /* Fold to just the boards one level below: what you see on site. */
  function foldToDepth(depth) {
    LC.allItems(S).forEach(function (o) {
      var d = depthOf(o);
      if (d > depth) collapsed[o.id] = 1;
      else delete collapsed[o.id];
    });
    saveTree();
    renderTree();
  }
  function depthOf(o) {
    var d = { tx: 0, pdb: 1, pdp: 2, db: 3 }[o.__kind];
    return d === undefined ? 4 : d;
  }

  function renderTree() {
    var h = '';
    if (!S.txs.length && !S.pdbs.length) {
      h = '<div class="tw-empty">No supply yet.<br>Press <b>Sample</b> for a worked example,<br>or add a <b>TX</b> / <b>PDB</b> / <b>PDP</b> above.</div>';
    }
    S.txs.forEach(function (tx) {
      var st = LC.boardStats(S, tx, 'tx');
      var u = st.kva / num(tx.kva, 1) * 100;
      var pdbs = LC.pdbOfTx(S, tx.id);
      h += node('tx', tx, st, u, null, '<button class="tadd" data-add-pdb="' + tx.id + '" title="Add main board">+PDB</button>', pdbs.length);
      if (!pdbs.length) h += '<div class="tkids"><div class="tw-empty" style="text-align:left;padding:2px 4px">no main boards</div></div>';
      if (collapsed[tx.id]) return;
      pdbs.forEach(function (b) {
        var pdps = LC.pdpOfPdb(S, b.id);
        /* circuits fed straight off this main board — one way each, big items
           of plant with their own feeder panel */
        var onBoard = LC.panelsOnPdb(S, b.id);
        h += node('pdb', b, st, st.util, 'E' + num(tx.kva, 0) + ' kVA', '<button class="tadd" data-add-pdp="' + b.id + '" title="Add distribution board">+PDP</button>' +
          '<button class="tadd" data-add-panel="' + b.id + '" data-add-pdb-parent="' + b.id + '" title="Add a circuit fed straight from this main board">+CP</button>',
          pdps.length + onBoard.length);
        if (!pdps.length && !onBoard.length) h += '<div class="tkids"><div class="tw-empty" style="text-align:left;padding:2px 4px">no distribution boards</div></div>';
        if (collapsed[b.id]) return;
        onBoard.forEach(function (pn) {
          var dm = LC.panelDemand(S, pn);
          h += node('panel', pn, null, null, dm.kva.toFixed(1) + ' kVA · ' + dm.kvar.toFixed(1) + ' kvar', '');
        });
        pdps.forEach(function (d) {
          var sd = LC.boardStats(S, d, 'pdp');
          /* sub-distribution boards sit between the PDP and its circuits */
          var subs = LC.dbOfPdp(S, d.id);
          var loose = LC.panelsOf(S, d.id).filter(function (pn) { return !pn.dbId || !LC.get(S, 'db', pn.dbId); });
          /* that label counts circuits, so it must not read "ways" — a board with16
             circuits on16 ways has no spare capacity, which is a different
             statement from having 16 ways' worth of room */
          h += node('pdp', d, sd, sd.util, sd.panels.length + ' circuits' +
            (sd.ways === null ? '' : ' / ' + sd.ways + ' ways'),
            '<button class="tadd" data-add-db="' + d.id + '" title="Add sub-distribution board for lighting and small power">+DB</button>',
            subs.length + loose.length);
          if (!subs.length && !loose.length) h += '<div class="tkids"><div class="tw-empty" style="text-align:left;padding:2px 4px">no sub-boards or control panels</div></div>';
          if (collapsed[d.id]) return;
          subs.forEach(function (b2) {
            var sb = LC.boardStats(S, b2, 'db');
            var onIt = LC.panelsOnDb(S, b2.id);
            h += node('db', b2, sb, sb.util, sb.panels.length + ' of ' + sb.spare + ' ways',
              '<button class="tadd" data-add-panel="' + b2.id + '" data-add-db-parent="' + d.id + '" title="Add control panel">+CP</button>',
              onIt.length);
            if (!onIt.length) h += '<div class="tkids"><div class="tw-empty" style="text-align:left;padding:2px 4px">spare</div></div>';
            if (collapsed[b2.id]) return;
            onIt.forEach(function (pn) {
              var dm = LC.panelDemand(S, pn);
              h += node('panel', pn, null, null, dm.kva.toFixed(1) + ' kVA · ' + dm.kvar.toFixed(1) + ' kvar', '');
            });
          });
          if (loose.length) {
            h += '<div class="tkids"><div class="tw-empty" style="text-align:left;padding:2px 4px">fed directly from ' + esc(d.tag) + '</div></div>';
            loose.forEach(function (pn) {
              var dm = LC.panelDemand(S, pn);
              h += node('panel', pn, null, null, dm.kva.toFixed(1) + ' kVA · ' + dm.kvar.toFixed(1) + ' kvar', '');
            });
          }
        });
      });
    });
    /* orphan boards / unassigned circuits */
    var orph = S.pdps.filter(function (d) { return !d.pdbId || !LC.get(S, 'pdb', d.pdbId); });
    if (orph.length) {
      h += '<div class="tkids" style="margin-left:0">';
      orph.forEach(function (d) {
        var sd = LC.boardStats(S, d, 'pdp');
        var osubs = LC.dbOfPdp(S, d.id);
        h += node('pdp', d, sd, sd.util, 'orphan', '', osubs.length);
        if (collapsed[d.id]) return;
        osubs.forEach(function (b) {
          var sb = LC.boardStats(S, b, 'db');
          var onIt = LC.panelsOnDb(S, b.id);
          h += node('db', b, sb, sb.util, sb.panels.length + ' ways', '', onIt.length);
          if (collapsed[b.id]) return;
          onIt.forEach(function (pn) {
            h += node('panel', pn, null, null, LC.panelDemand(S, pn).kva.toFixed(1) + ' kVA', '');
          });
        });
      });
      h += '</div>';
    }
    var orphDb = S.dbs.filter(function (b) { return !b.pdpId || !LC.get(S, 'pdp', b.pdpId); });
    if (orphDb.length) {
      h += '<div class="tkids" style="margin-left:0">';
      orphDb.forEach(function (b) { var sb = LC.boardStats(S, b, 'db'); h += node('db', b, sb, sb.util, 'orphan', ''); });
      h += '</div>';
    }
    /* only circuits with nowhere to go at all — one already fed off a main
       board is placed, not unassigned */
    var un = S.panels.filter(function (x) { return !x.pdpId && !x.pdbId; });
    if (un.length) {
      h += '<div class="tkids" style="margin-left:0">';
      un.forEach(function (pn) { h += node('panel', pn, null, null, 'unassigned', ''); });
      h += '</div>';
    }
    el('tree').innerHTML = h;
    el('legend').innerHTML =
      lg('#4ade80', 'Transformer') + lg('#60a5fa', 'Main board') + lg('#fbbf24', 'Distribution') +
      lg('#c084fc', 'Sub-distribution') + lg('#94a3b8', 'Control panel') +
      lg('#22c55e', '< 85% loaded') + lg('#f59e0b', '85–100%') + lg('#ef4444', '> 100% / imbalance');
    function lg(c, t) { return '<div class="lg"><i style="background:' + c + '"></i>' + t + '</div>'; }
  }
  function node(kind, o, st, util, right, addBtn, nKids) {
    var sh = LS.SHAPE[kind];
    var s = (sel && sel.id === o.id) ? ' sel' : '';
    var bad = (util !== null && util > 100) ? ' bad' : '';
    var bar = '';
    if (util !== null && util !== undefined && kind !== 'panel') {
      var c = util > 100 ? '#ef4444' : util > 85 ? '#f59e0b' : '#22c55e';
      bar = '<div class="tbar"><i style="width:' + Math.min(100, util) + '%;background:' + c + '"></i></div>';
    }
    /* the fold handle. An empty node has nothing to open, so it gets no handle
       and the row still lines up with the rest of the tree. */
    var fold = '';
    if (kind !== 'panel') {
      var open = isOpen(o.id);
      fold = '<button class="tfold' + (open ? ' open' : '') + '" data-fold="' + o.id + '" data-kind="' + kind + '" tabindex="-1" ' +
        'title="' + (open ? 'Collapse' : 'Expand') + (kind === 'tx' ? ' — shift-click opens everything below' : '') + '" ' +
        'aria-label="' + (open ? 'Collapse' : 'Expand') + ' ' + esc(o.tag) + '">' +
        (open ? '▾' : '▸') + '</button>';
      if (!open) s += ' folded';
    } else {
      fold = '<span class="tfold ph"></span>';
    }
    /* the count shown when folded, so a collapsed row says what is inside it */
    /* What is hidden, shown on the folded row. The wording names what the child
       actually is: folding TX1 should say how many main boards it has, not
       "7 items". */
    /* What is hidden. The reference and the right-hand figures matter more than
       this, so it is the first thing to give up space when the panel is
       narrow — the count is a convenience, the tag is the design. */
    var badge = '';
    if (kind !== 'panel' && nKids && !isOpen(o.id)) {
      var word = (kind === 'tx' || kind === 'pdb') ? 'board' : kind === 'pdp' ? 'item' : 'load';
      badge = '<span class="tnkids" title="' + nKids + ' ' + word + (nKids === 1 ? '' : 's') + ' hidden">' +
        nKids + (kind === 'tx' || kind === 'pdb' ? (nKids === 1 ? ' bd' : ' bds') : ' ' + word + (nKids === 1 ? '' : 's')) + '</span>';
    }
    return '<div class="tnode"><div class="trow' + s + bad + '" data-select="' + o.id + '" data-kind="' + kind + '" title="' + esc(o.name || o.tag) + '">' +
      fold +
      '<span class="tw">' + (kind === 'panel' ? '' : kind === 'tx' ? '◆' : kind === 'pdb' ? '▣' : kind === 'db' ? '▥' : '▤') + '</span>' +
      '<span class="tdot" style="background:' + sh.color + '"></span>' +
      '<span class="tname">' + esc(o.tag) + '</span>' +
      (util !== null && util !== undefined && kind !== 'panel' ? '<span class="tkva" style="color:' + (util > 100 ? '#fca5a5' : util > 85 ? '#fcd34d' : '#8fd8a8') + '">' + util.toFixed(0) + '%</span>' : '') +
      '<span class="tkva">' + (right || '') + '</span>' + badge + addBtn + '</div>' + bar + '</div>';
  }

  /* ------------------------------------------------------------- properties */
  function renderProps() {
    var host = el('props'), title = el('propsTitle'), kind = el('propsKind');
    if (!sel) {
      kind.textContent = '';
      title.textContent = 'Properties';
      host.innerHTML = '<div class="props-empty">' +
        '<b>Nothing selected.</b><br><br>' +
        '• Pick a board on the plan or in the hierarchy.<br>' +
        '• Switch the toolbar to <b>▣ Panel</b> and click a grid reference to enter a control panel — it is assigned to a PDP automatically.<br>' +
        '• If the best board has no headroom, a new PDP is created at the next practical grid reference.<br>' +
        '• Drop a panel on an occupied cell and it is nudged to the next clear reference.</div>';
      return;
    }
    var o = LC.get(S, sel.kind, sel.id) || LC.get(S, 'tx', sel.id) || LC.get(S, 'pdb', sel.id) || LC.get(S, 'pdp', sel.id) || LC.get(S, 'panel', sel.id);
    if (!o) { sel = null; return renderProps(); }
    sel.kind = LC.kindOf(o) === 'tx' && sel.kind !== 'tx' ? sel.kind : (o.__kind || sel.kind);
    o.__kind = sel.kind;
    kind.textContent = { tx: 'Transformer', pdb: 'Main board (PDB)', pdp: 'Distribution board (PDP)', panel: 'Control panel' }[sel.kind];
    title.textContent = o.tag;

    var h = '';
    if (sel.kind === 'tx') h = propsTx(o);
    else if (sel.kind === 'pdb') h = propsPdb(o);
    else if (sel.kind === 'pdp') h = propsPdp(o);
    else if (sel.kind === 'db') h = propsDb(o);
    else h = propsPanel(o);
    host.innerHTML = h;
    refreshDyn();
  }
  function refreshDyn() {
    if (!sel) return;
    var o = itemById(sel.id); if (!o) return;
    var a = el('dynStats'), b = el('dynPhases'), c = el('dynVerdict');
    var kind = o.__kind || LC.kindOf(o);
    if (a) a.innerHTML = statsBlock(o, kind);
    if (b) b.innerHTML = phaseBlock(o, kind);
    if (c) c.innerHTML = verdictBlock(o, kind);
  }
  function itemById(id) { return LC.get(S, 'tx', id) || LC.get(S, 'pdb', id) || LC.get(S, 'pdp', id) || LC.get(S, 'db', id) || LC.get(S, 'panel', id); }

  /* ---- field helpers ---- */
  function fRow(label, inner) { return '<div class="frow"><label>' + label + '</label><div>' + inner + '</div></div>'; }
  /* The device as it appears in a schedule cell: what somebody would write on
     the drawing. A device with no rating yet (a spare way) reads as its frame
     alone, which is the honest thing to show. */
  function protCell(o) {
    if (!o.prot) return '—';
    var d = o.prot;
    if (!num(d.ir, 0)) {
      if (num(d.frame, 0)) return (d.kind === 'mcb' ? 'MCB ' : 'MCCB ') + d.frame + ' A spare';
      return 'spare';
    }
    return LS.protLabel(d);
  }
  function fStack(label, inner) { return '<div class="frow stack"><label>' + label + '</label>' + inner + '</div>'; }
  function txt(kind, id, f, v, ph, extra) {
    return '<input class="inp" data-bind="item" data-kind="' + kind + '" data-id="' + id + '" data-f="' + f + '" value="' + esc(v) + '" placeholder="' + esc(ph || '') + '" ' + (extra || '') + '>';
  }
  function nIn(kind, id, f, v, opt) {
    opt = opt || {};
    return '<span class="unit"><input class="inp" type="number" data-bind="num" data-kind="' + kind + '" data-id="' + id + '" data-f="' + f + '" value="' + (v === '' || v === null || v === undefined ? '' : v) + '" step="' + (opt.step || 1) + '" ' + (opt.min !== undefined ? 'min="' + opt.min + '"' : '') + '>' +
      (opt.unit ? '<span class="u">' + opt.unit + '</span>' : '') + '</span>';
  }
  function selIn(kind, id, f, v, arr, fmt) {
    var vals = arr.slice();
    if (v !== '' && v !== null && v !== undefined && vals.indexOf(v) < 0) vals.push(v);
    return '<select class="sel" data-bind="num" data-kind="' + kind + '" data-id="' + id + '" data-f="' + f + '">' + opts(vals, v, fmt) + '</select>';
  }
  /* A duration in whichever unit reads: these are compared against
     disconnection times, which are all sub-second in the cases that matter. */
  function LC_ms(t) {
    if (t === null || t === undefined || !isFinite(t)) return '—';
    if (t >= 1) return t.toFixed(2) + ' s';
    return (t * 1000).toFixed(0) + ' ms';
  }
  function cbl(kind, id, f, v, opt) {
    opt = opt || {};
    return '<input class="inp" type="number" data-bind="cabnum" data-kind="' + kind + '" data-id="' + id + '" data-f="' + f + '" value="' + (v === '' || v === null || v === undefined ? '' : v) + '" step="' + (opt.step || 0.1) + '" ' + (opt.unit ? 'placeholder="' + opt.unit + '"' : '') + '>';
  }
  function posFields(o, kind) {
    return '<div class="two">' +
      '<span class="unit">' + cbl(kind, o.id, '_x', o.pos.x, { step: 0.5, unit: 'm E' }) + '<span class="u">E</span></span>' +
      '<span class="unit">' + cbl(kind, o.id, '_y', o.pos.y, { step: 0.5, unit: 'm N' }) + '<span class="u">N</span></span>' +
      '</div>';
  }
  /* ------------------------------------------------- protective device fields
     One form for every tier, because the data is the same shape everywhere —
     only the list of sensible answers changes. `kind` is the item kind, which
     is also the binding kind, so the fieldset drops into each properties
     panel unchanged. */
  function protFields(o, kind) {
    if (!o.prot) o.prot = LS.newProt({});
    var d = o.prot;
    var isMcb = d.kind === 'mcb';
    var trips = isMcb ? Object.keys(LS.MCB_CURVES) : Object.keys(LS.TRIP_UNITS);
    var icuList = isMcb ? LS.MCB_ICU_KA : LS.ICU_KA;
    var res = LC.proposeProt(S, o, kind);
    var fKA = res.faultKA;
    var verdict = protVerdict(o, kind, d, fKA);
    return '<div class="fieldset"><h4>Protective device</h4>' +
      fRow('Type', '<select class="sel" data-bind="protsel" data-kind="' + kind + '" data-id="' + o.id + '" data-f="kind">' +
        opts(['mccb', 'mcb'], d.kind, function (v) { return v === 'mccb' ? 'MCCB — moulded case' : 'MCB — miniature'; }) + '</select>') +
      fRow('Setting (Ir)', '<span class="unit">' + nIn(kind, o.id, 'prot_ir', d.ir, { step: 1, min: 0, unit: 'A' }) + '<span class="u">A</span></span>') +
      (isMcb ? '' :
        fRow('Frame (In)', '<span class="unit">' + nIn(kind, o.id, 'prot_frame', d.frame, { step: 25, min: 0, unit: 'A' }) + '<span class="u">A</span></span>')) +
      fRow('Breaking cap.', '<span class="unit">' + selIn(kind, o.id, 'prot_icu', d.icu, icuList, function (v) { return v + ' kA'; }) + '</span>') +
      fRow(isMcb ? 'Curve' : 'Trip unit', '<select class="sel" data-bind="item" data-kind="' + kind + '" data-id="' + o.id + '" data-f="prot_trip">' +
        opts(trips, d.trip, function (v) { return isMcb ? LS.MCB_CURVES[v].name : LS.TRIP_UNITS[v].name; }) + '</select>') +
      fRow('Poles', selIn(kind, o.id, 'prot_poles', d.poles, [2, 3, 4], function (v) { return v + (v === 4 ? ' (3ph + N)' : ''); })) +
      '<div class="two">' +
      '<button class="btn primary" data-act="protpropose" data-id="' + o.id + '" data-kind="' + kind + '">Propose</button>' +
      '<button class="btn" data-act="protclear" data-id="' + o.id + '">Clear</button>' +
      '</div>' +
      (d.notes ? '<div class="hint" style="margin-top:6px">' + esc(d.notes) + '</div>' : '') +
      '<div id="dynProt" style="margin-top:8px">' + verdict + '</div>' +
      (fKA ? '<div class="hint">Calculated fault level here: ' + fKA.toFixed(1) + ' kA. Breaking capacity is chosen to exceed it with margin — this figure is indicative, since it rests on the assumed transformer impedance and fault MVA.</div>' : '') +
      '</div>';
  }
  /* the live check under the form, recomputed on every change */
  function protVerdict(o, kind, d, fKA) {
    if (!d || !num(d.ir, 0)) return '<div class="hint">Nothing set. Press <b>Propose</b> for a starting point, or type the device from the schedule.</div>';
    var st = kind === 'panel' ? LC.panelDemand(S, o) : LC.boardStats(S, o, kind);
    var loadA = kind === 'panel' ? st.amp : st.amp;
    var ir = num(d.ir, 0), out = [];
    var pct = loadA > 0 ? (loadA / ir * 100) : 0;
    out.push('<div class="st"><span class="k">Load</span><span class="v">' + loadA.toFixed(1) + ' A of ' + ir + ' A' +
      (pct ? ' (' + pct.toFixed(0) + '%)' : '') + '</span></div>');
    if (ir && loadA > ir) out.push('<div class="st"><span class="k">Verdict</span><span class="v" style="color:#fca5a5">Set below the load — it will nuisance-trip</span></div>');
    else if (fKA && num(d.icu, 0) && num(d.icu, 0) < fKA) out.push('<div class="st"><span class="k">Verdict</span><span class="v" style="color:#fca5a5">Icu ' + d.icu + ' kA below ' + fKA.toFixed(1) + ' kA — will fail to interrupt</span></div>');
    else out.push('<div class="st"><span class="k">Verdict</span><span class="v" style="color:#86efac">OK</span></div>');
    var cab = o.cable && o.cable.csa ? LC.cableRating(o.cable) : null;
    if (cab && ir > cab.derated) out.push('<div class="st"><span class="k">Cable</span><span class="v" style="color:#fca5a5">' + ir + ' A device on a ' + cab.derated.toFixed(0) + ' A cable</span></div>');
    else if (cab) out.push('<div class="st"><span class="k">Cable</span><span class="v">' + cab.derated.toFixed(0) + ' A</span></div>');
    return out.join('');
  }

  function cableFields(o, kind) {
    var c = o.cable || (o.cable = { csa: null, cores: 4, len: 0, method: 'XL-A1', group: 1, ambient: 30, sheathed: true });
    var methods = Object.keys(LS.METHODS);
    return fRow('Cross-section', '<input class="inp" type="number" list="dlCsa" step="0.5" data-bind="cabnum" data-kind="' + kind + '" data-id="' + o.id + '" data-f="csa" value="' + (c.csa || '') + '" placeholder="mm²">') +
      fRow('Runs', '<span class="unit">' + cbl(kind, o.id, '_runs', c.runs || 1, { step: 1, unit: 'runs' }) + '<span class="u">runs</span></span>') +
      fRow('Protective cond.', '<span class="unit">' + cbl(kind, o.id, '_peCsa', c.peCsa, { step: 0.5, unit: LS.peMinCsa(num(c.csa, 0)) ? String(LS.peMinCsa(num(c.csa, 0))) + ' min' : '' }) + '<span class="u">mm²</span></span>') +
      (function () {
        var e = LC.earthFaultCheck(S, o, kind);
        if (!e) return '';
        if (e.needs) {
          return fRow('Earth fault loop', '<span class="mono" style="color:var(--fg-dim)">needs ' + e.needs + '</span>');
        }
        var good = e.pass;
        return fRow('Earth fault loop',
          '<span class="mono" style="color:' + (good ? 'var(--ok,#4ade80)' : '#f87171') + '">' +
          'R1+R2 ' + e.loop.total.toFixed(2) + ' Ω · ' + e.ia.toFixed(0) + ' A · clears ' +
          (e.tActual === null ? '—' : LC.msOrS(e.tActual)) + ' of ' + LC.msOrS(e.tMax) +
          (e.maxLoop !== null ? ' · max ' + e.maxLoop.toFixed(2) + ' Ω' : '') + '</span>');
      })() +
      fRow('Cores', selIn(kind, o.id, '_cores', c.cores, [1, 2, 3, 4, 5], function (v) { return v + (v === 1 ? ' core' : ' cores'); })) +
      /* Five cores is three phases, a neutral and the PE — which is what TN-S
         wants when they share a cable, and is the only way to tell a 4-core
         feeder carrying a neutral from one whose fourth conductor is a PEN. */
      (kind === 'panel' ? fRow('PE in this cable', selIn('panel', o.id, 'peInCable',
        o.peInCable === true ? 'yes' : (o.peInCable === false ? 'no' : ''),
        ['', 'yes', 'no'], function (v) {
          return v === '' ? 'not stated' : (v === 'yes' ? 'yes — shares the cable' : 'no — formed separately');
        })) : '') +
      fRow('Length', '<span class="unit">' + cbl(kind, o.id, '_len', c.len, { step: 0.5, unit: 'm' }) + '<span class="u">m</span></span>') +
      fStack('Installation', '<select class="sel" data-bind="cab" data-kind="' + kind + '" data-id="' + o.id + '" data-f="method">' +
        methods.map(function (k) { return '<option value="' + k + '"' + (c.method === k ? ' selected' : '') + '>' + esc(k + ' — ' + LS.METHODS[k].name) + '</option>'; }).join('') + '</select>' +
        '<div class="hint">' + esc(c.method ? LS.METHODS[c.method].name : '') + '</div>') +
      fRow('Grouped with', '<span class="unit">' + cbl(kind, o.id, '_group', c.group, { step: 1 }) + '<span class="u">circuits</span></span>') +
      fRow('Ambient / earth', '<span class="unit">' + cbl(kind, o.id, '_ambient', c.ambient, { step: 1, unit: '°C' }) + '<span class="u">°C</span></span>');
  }

  /* ---- stat blocks ---- */
  function statsBlock(o, kind) {
    if (kind === 'panel') {
      var d = LC.panelDemand(S, o);
      var cab = o.cable && o.cable.csa ? LC.cableRating(o.cable) : null;
      var vd = cab ? LC.voltDrop(o.cable, d.amp, d.pf, o.phases, o.volt) : null;
      var chain_ = LC.chain(S, o);
      return '<div class="stats">' +
        st('Load', d.kw.toFixed(1) + ' <small>kW</small>') +
        st('Design kVA', d.kva.toFixed(1)) +
        st('Reactive', d.kvar.toFixed(1) + ' <small>kvar</small>') +
        st('Full-load I', d.amp.toFixed(1) + ' <small>A</small>') +
        st('Phase', o.phases + (o.phases === '1' ? '-ph' : ' N→N')) +
        (cab ? st('Cable rating', cab.derated.toFixed(0) + ' <small>A</small>') : st('Cable rating', '—')) +
        (vd ? st('Volt drop', vd.pct.toFixed(2) + ' <small>%</small>') : st('Volt drop', '—')) +
        st('Fed from', chain_.pdp ? chain_.pdp.tag : chain_.pdb ? chain_.pdb.tag : '—') +
        st('Grid ref', 'E' + LS.r1(o.pos.x).toFixed(1) + ' N' + LS.r1(o.pos.y).toFixed(1)) +
        '</div>';
    }
    var stt = LC.boardStats(S, o, kind);
    var rating = kind === 'tx' ? num(o.kva, 0) + ' kVA' : stt.rating + ' A';
    var u = kind === 'tx' ? (stt.kva / Math.max(1, num(o.kva, 1)) * 100) : stt.util;
    return '<div class="utilbar"><i class="' + (u > 100 ? 'util-bad' : u > 85 ? 'util-warn' : 'util-ok') + '" style="width:' + Math.min(100, u || 0) + '%"></i></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<span class="badge ' + (u > 100 ? 'bad' : u > 85 ? 'warn' : 'ok') + '">' + (u === null ? 'n/a' : u.toFixed(0) + '% of ' + rating) + '</span>' +
      (stt.dev > LS.num(S.design.imbalanceWarn, 15) ? '<span class="badge bad">imbalance ' + stt.dev.toFixed(0) + '%</span>' : '<span class="badge ok">phases balanced</span>') +
      '</div>' +
      '<div class="stats">' +
      st('Connected', stt.kw.toFixed(0) + ' <small>kW</small>') +
      st('Design load', stt.kva.toFixed(0) + ' <small>kVA</small>') +
      st('Reactive', stt.kvar.toFixed(0) + ' <small>kvar</small> · ' + stt.pf.toFixed(2) + ' pf</small>') +
      st('Load current', stt.amp.toFixed(0) + ' <small>A</small>') +
      st('Sum of circuit I', stt.ampSum.toFixed(0) + ' <small>A</small>') +
      st('Circuits', String(stt.panels.length) +
        ((kind === 'pdp' || kind === 'db') && stt.ways !== null
          ? ' on ' + stt.ways + ' ways' + (kind === 'pdp' ? ' (' + (stt.ways - stt.spareUsed) + ' spare)' : '')
          : '')) +
      st('Fault level', stt.faultKA ? stt.faultKA.toFixed(1) + ' <small>kA</small>' : '—') +
      '</div>';
  }
  function st(k, v) { return '<div class="st"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
  function phaseBlock(o, kind) {
    if (kind === 'panel') {
      var d = LC.panelDemand(S, o);
      var pdp = LC.get(S, 'pdp', o.pdpId);
      if (!pdp) return '<div class="hint">Not assigned to a board — single phase loads are placed on the lightest phase of whatever board they land on.</div>';
      return '<div class="hint">Single-phase loads are auto-allocated to the lightest phase of <b>' + esc(pdp.tag) + '</b>. Change the phase in the fields above if you need a specific phase.</div>';
    }
    var s = LC.boardStats(S, o, kind);
    var mx = Math.max(s.phaseKva.L1, s.phaseKva.L2, s.phaseKva.L3, 0.001);
    var mn = Math.min(s.phaseKva.L1, s.phaseKva.L2, s.phaseKva.L3);
    var rows = '';
    ['L1', 'L2', 'L3'].forEach(function (ph) {
      var kva = s.phaseKva[ph], cur = s.phaseAmp[ph];
      var lightest = kva > 0 && kva === mn;
      rows += '<div class="pl" style="color:' + LS.phaseEdge(ph) + '">' + ph + '</div>' +
        '<div class="track"><i class="pbar-' + ph.toLowerCase() + '" style="width:' + ((kva / mx) * 100).toFixed(1) + '%"></i></div>' +
        '<div class="pv">' + kva.toFixed(1) + ' kVA · ' + cur.toFixed(0) + ' A' + (lightest ? ' ◂' : '') + '</div>';
    });
    var tot = s.phaseKva.L1 + s.phaseKva.L2 + s.phaseKva.L3;
    return '<div class="phasebars">' + rows + '</div>' +
      '<div class="hint" style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 5px">' +
        '<span style="display:inline-flex;align-items:center;gap:4px"><i style="width:9px;height:9px;border-radius:2px;background:' + LS.phaseColor('L1') + ';box-shadow:inset 0 0 0 1px ' + LS.phaseEdge('L1') + '"></i>L1 brown</span>' +
        '<span style="display:inline-flex;align-items:center;gap:4px"><i style="width:9px;height:9px;border-radius:2px;background:' + LS.phaseColor('L2') + ';box-shadow:inset 0 0 0 1px ' + LS.phaseEdge('L2') + '"></i>L2 black</span>' +
        '<span style="display:inline-flex;align-items:center;gap:4px"><i style="width:9px;height:9px;border-radius:2px;background:' + LS.phaseColor('L3') + ';box-shadow:inset 0 0 0 1px ' + LS.phaseEdge('L3') + '"></i>L3 grey</span>' +
      '</div>' +
      '<div class="hint">' + (tot > 0 ? 'Deviation from an even split: <b>' + s.dev.toFixed(1) + '%</b> (warn ' + S.design.imbalanceWarn + '%, limit ' + S.design.imbalanceBad + '%). ' : '') +
      'The ◂ marker is the lightest phase — the next single-phase load lands there.</div>';
  }
  function verdictBlock(o, kind) {
    if (kind === 'panel') {
      if (!o.cable || !o.cable.csa) return '<div class="hint">No feeder cable selected.</div>';
      var d = LC.panelDemand(S, o);
      var r = LC.cableRating(o.cable);
      var vd = LC.voltDrop(o.cable, d.amp, d.pf, o.phases, o.volt);
      var limit = num(S.design.vdropLimitLv, 3);
      var ok1 = d.amp <= r.derated, ok2 = vd.pct <= limit;
      var sug = LC.suggestCable(d.amp, vd.len || 10, d.pf, o.phases, o.volt, o.cable.method, S);
      return '<div class="stats">' +
        st('Base capacity', r.base + ' <small>A</small>') +
        st('Derated', r.derated.toFixed(0) + ' <small>A</small>') +
        st('Utilisation', '<span class="' + utilCls(d.amp / r.derated * 100) + '">' + (d.amp / r.derated * 100).toFixed(0) + '%</span>') +
        st('Volt drop', '<span class="' + (ok2 ? 'num-ok' : 'num-bad') + '">' + vd.pct.toFixed(2) + '%</span>') +
        '</div><div class="hint">' + esc(r.note) + '<br>' + (ok1 ? '✓' : '✕') + ' ampacity · ' + (ok2 ? '✓' : '✕') + ' volt drop ≤ ' + limit + '% · suggested core <b>' + sug.csa + ' mm²</b></div>';
    }
    var stt = LC.boardStats(S, o, kind);
    var sug = LC.suggestIncomer(stt.amp || 160, num(S.design.spreadMargin, 1.25));
    var inA = kind === 'tx' ? null : num(o.incomerA, 0);
    var head = inA ? inA - stt.amp : null;
    return '<div class="stats">' +
      st('Ways', stt.panels.length + ' circuits' +
        (stt.ways === null ? '' : ' / ' + stt.ways + ' ways (' + (stt.ways - stt.spareUsed) + ' spare)')) +
      st('Headroom', head !== null ? '<span class="' + utilCls(-head) + '">' + (head >= 0 ? head.toFixed(0) : '−' + Math.abs(head).toFixed(0)) + ' <small>A</small></span>' : '—') +
      st('Suggested A', sug + ' <small>A</small>') +
      st('Next board ≥', Math.ceil((stt.amp * num(S.design.spreadMargin, 1.25)) / 50) * 50 + ' <small>A</small>') +
      '</div>';
  }

  /* ---- properties: TX ---- */
  function propsTx(o) {
    return '<div class="pbtn-row">' +
      btn('addpdb', '＋ Main board (PDB)') + btn('addpdp', '＋ PDP') + btn('delete', 'Delete', 'danger') + '</div>' +
      '<div class="fieldset"><h4>Identity</h4>' +
      fRow('Reference', tagField('tx', o)) +
      fRow('Number', '<span class="unit">' + nIn('tx', o.id, 'num', o.num, { step: 1, min: 1, unit: '' }) + '<span class="u">→ TX' + o.num + '</span></span>') +
      refField('tx', o) +
      fRow('Name', txt('tx', o.id, 'name', o.name)) + '</div>' +
      '<div class="fieldset"><h4>Rating</h4>' +
      fRow('Rating', '<span class="unit">' + nIn('tx', o.id, 'kva', o.kva, { step: 50, unit: 'kVA' }) + '<span class="u">kVA</span></span>') +
      fRow('HV', '<span class="unit">' + nIn('tx', o.id, 'kvIn', o.kvIn, { step: 0.1, unit: 'kV' }) + '<span class="u">kV</span></span>') +
      fRow('LV', '<span class="unit">' + nIn('tx', o.id, 'kvOut', o.kvOut, { step: 0.005, unit: 'kV' }) + '<span class="u">kV</span></span>') +
      fRow('Power factor', nIn('tx', o.id, 'pf', o.pf, { step: 0.01 })) +
      fRow('Impedance', '<span class="unit">' + nIn('tx', o.id, 'impZ', o.impZ, { step: 0.5, unit: '%' }) + '<span class="u">% uk</span></span>') +
      fRow('Vector group', selIn('tx', o.id, 'vecGroup', o.vecGroup || 'Dyn11', LS.VECTOR_GROUPS,
        function (v) { return v + (LS.blocksTriplen(v) ? ' — LV delta, blocks 3rd harmonic' : ' — LV star, 3rd harmonic reaches the neutral'); })) +
      fRow('Neutral bonded', '<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:11.5px"><input type="checkbox" data-bind="item" data-kind="tx" data-id="' + o.id + '" data-f="neutralBonded"' + (o.neutralBonded ? ' checked' : '') + '> bring the star point out and bond it</label>') +
      (function () {
        var blocks = LS.blocksTriplen(o.vecGroup || 'Dyn11');
        return '<div class="hint">' + (blocks
          ? 'The low-voltage winding is a <b>delta</b>, so third-harmonic zero-sequence current cannot leave the transformer. That is what keeps the neutral down in an installation full of switch-mode supplies.'
          : 'The low-voltage winding is a <b>star</b>, so third-harmonic current returns through the neutral and adds across all three phases instead of cancelling. With a star-star group this is a reason to specify a delta winding on this transformer.') + '</div>';
      })() +
      fRow('LV fault MVA', '<span class="unit">' + nIn('tx', o.id, 'faultKVA', o.faultKVA, { step: 50, unit: 'MVA' }) + '<span class="u">MVA</span></span>') +
      '<div class="hint">Leave fault MVA blank to derive it from the rating (Isc = 1.0 × kVA at the LV terminals). Indicative fault level at the board: <b id="faultKA">—</b></div>' +
      '</div>' +
      '<div class="fieldset"><h4>Location (grid reference)</h4>' + posFields(o, 'tx') +
      '<div class="hint" style="margin-top:6px">Drag the transformer on the plan to move it; positions snap to the grid.</div></div>' +
      '<div class="fieldset"><h4>Load &amp; balance</h4><div id="dynStats"></div><div id="dynPhases" style="margin-top:8px"></div><div id="dynVerdict" style="margin-top:8px"></div></div>' +
      '<div class="fieldset"><h4>Notes</h4><textarea class="ta" data-bind="item" data-kind="tx" data-id="' + o.id + '" data-f="notes">' + esc(o.notes) + '</textarea></div>';
  }
  /* ---- properties: PDB ---- */
  function propsPdb(o) {
    var txs = S.txs;
    return '<div class="pbtn-row">' +
      btn('addpdp', '＋ Distribution board') + btn('balance-here', 'Balance this board') + btn('delete', 'Delete', 'danger') + '</div>' +
      '<div class="fieldset"><h4>Identity</h4>' +
      fRow('Reference', tagField('pdb', o)) +
      refField('pdb', o) +
      fRow('Name', txt('pdb', o.id, 'name', o.name)) +
      fRow('Fed from', '<select class="sel" data-bind="item" data-kind="pdb" data-id="' + o.id + '" data-f="txId"><option value="">— not connected —</option>' +
        opts(txs.map(function (t) { return t.id; }), o.txId, function (v) { var t = LC.get(S, 'tx', v); return t ? t.tag + ' · ' + t.kva + ' kVA' : v; }) + '</select>') +
      '</div>' +
      '<div class="fieldset"><h4>Board rating</h4>' +
      fRow('Incomer', '<input class="inp" type="number" list="dlIncomer" data-bind="num" data-kind="pdb" data-id="' + o.id + '" data-f="incomerA" value="' + o.incomerA + '"> <span style="font-size:10px;color:var(--fg-mute)">A</span>') +
      fRow('Busbar', '<input class="inp" type="number" list="dlIncomer" data-bind="num" data-kind="pdb" data-id="' + o.id + '" data-f="busbarA" value="' + (o.busbarA || '') + '" placeholder="= incomer">') +
      fRow('Phases', selIn('pdb', o.id, 'phases', o.phases, LS.PHASES, function (v) { return v + ' phase'; })) +
      '<div class="hint" style="margin-bottom:6px">Incomer should be sized with the design margin of ' + S.design.pdbMargin + '× on the running load.</div>' +
      '</div>' +
      '<div class="fieldset"><h4>Incoming cable (from TX)</h4>' + cableFields(o, 'pdb') + '</div>' +
      protFields(o, 'pdb') +
      '<div class="fieldset"><h4>Location</h4>' + posFields(o, 'pdb') + '</div>' +
      '<div class="fieldset"><h4>Load &amp; balance</h4><div id="dynStats"></div><div id="dynPhases" style="margin-top:8px"></div><div id="dynVerdict" style="margin-top:8px"></div></div>' +
      '<div class="fieldset"><h4>Notes</h4><textarea class="ta" data-bind="item" data-kind="pdb" data-id="' + o.id + '" data-f="notes">' + esc(o.notes) + '</textarea></div>';
  }
  /* ---- properties: PDP ---- */
  function propsPdp(o) {
    var pdbs = S.pdbs;
    return '<div class="pbtn-row">' +
      btn('addpanel', '＋ Control panel') + btn('adddb', '＋ Sub-board') + btn('balance-here', 'Balance this board') +
      btn('autosize', 'Auto-size') + btn('split', 'Split overload') + btn('delete', 'Delete', 'danger') + '</div>' +
      '<div class="fieldset"><h4>Identity</h4>' +
      fRow('Reference', tagField('pdp', o)) +
      refField('pdp', o) +
      fRow('Name', txt('pdp', o.id, 'name', o.name)) +
      fRow('Fed from', '<select class="sel" data-bind="item" data-kind="pdp" data-id="' + o.id + '" data-f="pdbId"><option value="">— not connected —</option>' +
        opts(pdbs.map(function (t) { return t.id; }), o.pdbId, function (v) { var t = LC.get(S, 'pdb', v); return t ? t.tag : v; }) + '</select>') +
      '</div>' +
      '<div class="fieldset"><h4>Board rating</h4>' +
      fRow('Incomer', '<input class="inp" type="number" list="dlIncomer" data-bind="num" data-kind="pdp" data-id="' + o.id + '" data-f="incomerA" value="' + o.incomerA + '"> <span style="font-size:10px;color:var(--fg-mute)">A</span>') +
      fRow('Busbar', '<input class="inp" type="number" list="dlIncomer" data-bind="num" data-kind="pdp" data-id="' + o.id + '" data-f="busbarA" value="' + (o.busbarA || '') + '" placeholder="= incomer">') +
      fRow('Phases', selIn('pdp', o.id, 'phases', o.phases, LS.PHASES, function (v) { return v + ' phase'; })) +
      fRow('Ways', nIn('pdp', o.id, 'ways', o.ways, { step: 1, min: 0 }) +
        ' <span style="font-size:10px;color:var(--fg-mute)">of</span> ' +
        nIn('pdp', o.id, 'spareWays', o.spareWays, { step: 1, min: 0 }) +
        ' <span style="font-size:10px;color:var(--fg-mute)">spare</span>') +
      '<div class="hint" style="margin-bottom:6px">The first figure is the total number of ways the enclosure has; the second is how many are still free. The audit flags the board only when the circuits exceed the total — leave the total blank and it stays quiet rather than guessing.</div>' +
      '</div>' +
      '<div class="fieldset"><h4>Incoming cable (from PDB)</h4>' + cableFields(o, 'pdp') + '</div>' +
      protFields(o, 'pdp') +
      '<div class="fieldset"><h4>Location</h4>' + posFields(o, 'pdp') +
      '<div class="hint" style="margin-top:6px">When a load no longer fits, <b>Split overload</b> creates a sibling board at the next practical grid reference and moves the biggest circuit across.</div></div>' +
      '<div class="fieldset"><h4>Load &amp; balance</h4><div id="dynStats"></div><div id="dynPhases" style="margin-top:8px"></div><div id="dynVerdict" style="margin-top:8px"></div></div>' +
      '<div class="fieldset"><h4>Notes</h4><textarea class="ta" data-bind="item" data-kind="pdp" data-id="' + o.id + '" data-f="notes">' + esc(o.notes) + '</textarea></div>';
  }
  /* ---- properties: sub-distribution board ---- */
  /* The small board at the end of the chain — a 63 A Acti9 for lighting,
     small power and other small final circuits. One per distribution board.
     Its reference is derived (DB7-1-1); the circuits on it keep their own. */
  function propsDb(o) {
    var pdps = S.pdps;
    var stt = LC.boardStats(S, o, 'db');
    return '<div class="pbtn-row">' +
      btn('addpanel', '＋ Control panel') + btn('autosize', 'Auto-size') + btn('delete', 'Delete', 'danger') + '</div>' +
      '<div class="fieldset"><h4>Identity</h4>' +
      fRow('Reference', tagField('db', o)) +
      refField('db', o) +
      fRow('Name', txt('db', o.id, 'name', o.name)) +
      fRow('Carries', '<input class="inp" data-bind="item" data-kind="db" data-id="' + o.id + '" data-f="serves" value="' + esc(o.serves || '') + '" placeholder="lighting, small power">') +
      fRow('Fed from', '<select class="sel" data-bind="item" data-kind="db" data-id="' + o.id + '" data-f="pdpId"><option value="">— not connected —</option>' +
        opts(pdps.map(function (t) { return t.id; }), o.pdpId, function (v) { var t = LC.get(S, 'pdp', v); return t ? t.tag : v; }) + '</select>') +
      '<div class="hint" style="margin-bottom:6px">Changing this moves the board and every circuit on it to the new PDP.</div>' +
      '</div>' +
      '<div class="fieldset"><h4>Board rating</h4>' +
      fRow('Incomer', '<input class="inp" type="number" list="dlIncomer" data-bind="num" data-kind="db" data-id="' + o.id + '" data-f="incomerA" value="' + o.incomerA + '"> <span style="font-size:10px;color:var(--fg-mute)">A</span>') +
      '<div class="hint" style="margin-bottom:6px">A sub-board is normally ' + LS.DB_SIZES_A.join(' A or ') + ' A. ' +
      'The ' + LS.DB_LOAD_MAX_A + ' A limit is on the largest single piece of equipment fed from it, not on the board itself — ' +
      'anything bigger goes straight onto the distribution board.</div>' +
      fRow('Busbar', '<input class="inp" type="number" list="dlIncomer" data-bind="num" data-kind="db" data-id="' + o.id + '" data-f="busbarA" value="' + (o.busbarA || '') + '" placeholder="= incomer">') +
      fRow('Phases', selIn('db', o.id, 'phases', o.phases, LS.PHASES, function (v) { return v + ' phase'; })) +
      fRow('Enclosure', '<input class="inp" data-bind="item" data-kind="db" data-id="' + o.id + '" data-f="enclosure" value="' + esc(o.enclosure || '') + '" placeholder="Acti9, Acti9P, etc.">') +
      fRow('Ways', nIn('db', o.id, 'ways', o.ways, { step: 1, min: 0 })) +
      '<div class="hint" style="margin-bottom:6px">Modules available in the enclosure. The audit flags it when the number of circuits exceeds this.</div>' +
      '</div>' +
      '<div class="fieldset"><h4>Incoming cable (from PDP)</h4>' + cableFields(o, 'db') + '</div>' +
      protFields(o, 'db') +
      '<div class="fieldset"><h4>Location</h4>' + posFields(o, 'db') + '</div>' +
      '<div class="fieldset"><h4>Load &amp; balance</h4><div id="dynStats"></div><div id="dynPhases" style="margin-top:8px"></div><div id="dynVerdict" style="margin-top:8px"></div></div>' +
      '<div class="fieldset"><h4>Notes</h4><textarea class="ta" data-bind="item" data-kind="db" data-id="' + o.id + '" data-f="notes">' + esc(o.notes) + '</textarea></div>';
  }

  /* ---- properties: control panel ---- */
  function propsPanel(o) {
    var types = Object.keys(LS.PANEL_TYPES);
    var pdps = S.pdps;
    /* only sub-boards on this panel's own PDP — a circuit is fed from one
       board, so offering every sub-board on site would be misleading */
    var subs = S.dbs.filter(function (b) { return o.pdpId && b.pdpId === o.pdpId; });
    return '<div class="pbtn-row">' +
      btn('assign', 'Auto-assign') + btn('autocable', 'Suggest cable') + btn('delete', 'Delete', 'danger') + '</div>' +
      '<div class="fieldset"><h4>Identity</h4>' +
      fRow('Reference', '<input class="inp" data-bind="item" data-kind="panel" data-id="' + o.id + '" data-f="tag" value="' + esc(o.tag) + '" placeholder="MCC-01">') +
      '<div class="hint" style="margin-top:-2px;margin-bottom:6px">Your own reference for this circuit. Control panels are not numbered by the scheme — it applies to boards only.</div>' +
      fRow('Name', txt('panel', o.id, 'name', o.name)) +
      fRow('Type', '<select class="sel" data-bind="item" data-kind="panel" data-id="' + o.id + '" data-f="type">' +
        opts(types, o.type, function (v) { return LS.PANEL_TYPES[v].name; }) + '</select>') +
      fRow('Description', '<input class="inp" data-bind="item" data-kind="panel" data-id="' + o.id + '" data-f="description" value="' + esc(o.description) + '" placeholder="what is fed">') +
      '</div>' +
      '<div class="fieldset"><h4>Load</h4>' +
      fRow('Connected', '<span class="unit">' + nIn('panel', o.id, 'kw', o.kw, { step: 0.5, unit: 'kW' }) + '<span class="u">kW</span></span>') +
      fRow('kVA override', '<span class="unit">' + nIn('panel', o.id, 'kva', o.kva, { step: 0.5, unit: 'kVA' }) + '<span class="u">kVA</span></span>') +
      fRow('Power factor', nIn('panel', o.id, 'pf', o.pf, { step: 0.01 })) +
      fRow('Demand factor', nIn('panel', o.id, 'demand', o.demand, { step: 0.05 })) +
      fRow('Phases', selIn('panel', o.id, 'phases', o.phases, LS.PHASES, function (v) { return v + ' phase' + (v === '1' ? ' (L–N)' : ''); })) +
      fRow('Voltage', '<span class="unit">' + selIn('panel', o.id, 'volt', o.volt, LS.VOLT_LV, function (v) { return v + ' V'; }) + '</span>') +
      /* Whether this is a rotating machine. Nothing infers it silently: a
         circuit typed as "Other" containing a motor gets no verdict, and the
         properties panel says so rather than guessing from the description. */
      fRow('Machine', selIn('panel', o.id, 'isMotor', o.isMotor === true ? 'yes' : (o.isMotor === false ? 'no' : ''),
        ['', 'yes', 'no'], function (v) { return v === '' ? 'not stated — inferred' : (v === 'yes' ? 'motor' : 'not a motor'); })) +
      fRow('Starting', selIn('panel', o.id, 'start', o.start,
        [''].concat(Object.keys(LS.START_METHODS)), function (v) {
          return v === '' ? 'not stated — assumed DOL' : (v === 'Static' ? 'Static / SVC' : v);
        })) +
      /* Load torque is what decides whether a reduced-current start can
         accelerate the machine at all, and it is a question for the vendor, not
         something the app can infer. Left blank it asserts nothing; filled in it
         turns the voltage-dip check into a verdict. */
      fRow('Load torque', selIn('panel', o.id, 'loadTorque', o.loadTorque || '',
        ['', 'constant', 'variable', 'constantpower', 'inertia'],
        function (v) { return v ? (LS.LOAD_TORQUES[v] || {}).name || v : 'not stated'; })) +
      fRow('Starting together', '<span class="unit">' +
        nIn('panel', o.id, 'simultaneousStart', o.simultaneousStart === null || o.simultaneousStart === undefined ? '' : o.simultaneousStart,
          { step: 1, min: 1 }) + '<span class="u">at once</span></span>') +
      fRow('Future / conting.', '<span class="unit">' + nIn('panel', o.id, 'contingency', o.contingency, { step: 1, unit: '%' }) + '<span class="u">%</span></span>') +
      /* What the starting method actually costs, spelled out. The table in the
         data file is a range and the schedule needs a single number, so the
         chosen figure is shown next to the consequence rather than the range
         left for the reader to interpret. */
      (function () {
        var r = LC.startingCheck(S, o, 'panel');
        if (!r) {
          return '<div style="font-size:11px;color:var(--fg-mute);margin:2px 0 6px;line-height:1.5">' +
            'Not assessed — this is not declared as a rotating machine, so it is given no starting ' +
            'current. Set <b>Machine</b> above if it is one.</div>';
        }
        var m = r.sc.method, rows = [];
        if (r.noRating || !r.dip) {
          return '<div style="font-size:11px;color:var(--fg-dim);margin:2px 0 6px;line-height:1.5">' +
            (r.noRating ? 'No rated load, so no starting current can be worked out — a stand-by machine ' +
              'is usually entered like this. Its rated current and starting method are worth asking the ' +
              'vendor for.'
             : 'Starting at about ' + r.sc.amps.toFixed(0) + ' A, ' + r.sc.multiple + ' × full load, but ' +
              'there is no fault level at this board to derive the voltage dip from. The peak is known; ' +
              'the dip is not, and the dip is what decides whether other plant on the board notices.') +
            '</div>';
        }
        rows.push('<div style="font-size:11px;color:var(--fg-dim);margin:2px 0 6px;line-height:1.5">' +
          m.name + ' takes about <b style="color:var(--fg)">' + r.sc.amps.toFixed(0) + ' A</b> starting, ' +
          m.multiple + ' × the ' + r.sc.flc.toFixed(0) + ' A full load current, over about ' + m.accel +
          ' s. ' + m.note + '</div>');
        if (r.dip) {
          rows.push('<div style="font-size:11px;color:var(--fg-dim);margin:0 0 6px;line-height:1.5">' +
            'The board pulls down by <b style="color:' + (r.dip.pct > 10 ? 'var(--bad)' : 'var(--fg)') + '">' +
            r.dip.pct.toFixed(1) + '%</b> during the start — ' + r.dip.volts.toFixed(0) + ' V, leaving ' +
            r.dip.motorV.toFixed(0) + ' V at the motor and ' + r.dip.torqueAvail.toFixed(2) +
            ' × full load torque.' +
            (r.tripsUpstream ? ' <b style="color:var(--bad)">Above the ' + (r.up ? r.up.tag : '') +
              ' pick-up, so it trips.</b>' : '') + '</div>');
        }
        return rows.join('');
      })() +
      /* Reactive power is derived, not entered — S² = P² + Q² — so it is shown
         rather than typed. Entering it would give two numbers that can disagree
         with each other, and the one that gets used silently would be the wrong
         one. */
      (function () {
        var d = LC.panelDemand(S, o);
        return fRow('Reactive', '<span class="mono" style="color:var(--fg-dim)">' +
          d.kvar.toFixed(1) + ' kvar &nbsp;·&nbsp; apparent ' + d.kva.toFixed(1) + ' kVA</span>');
      })() +
      /* The load type comes before the THD, because it decides what the THD means.
         A drive and a switch-mode supply can both be 35% distorted and only one
         of them puts anything in the neutral. */
      fRow('Non-linear load', selIn('panel', o.id, 'harmonicType', o.harmonicType || '',
        [''].concat(Object.keys(LS.HARMONIC_SPECTRUMS)), function (v) {
          return v === '' ? 'not stated — clean' : (LS.HARMONIC_SPECTRUMS[v] || {}).name || v;
        })) +
      fRow('Harmonics (THD)', '<span class="unit">' + nIn('panel', o.id, 'thd', o.thd, { step: 1, placeholder: 'not stated' }) +
        '<span class="u">%</span></span>') +
      fRow('3rd harmonic', '<span class="unit">' + nIn('panel', o.id, 'triplen', o.triplen, { step: 1, placeholder: 'from load type' }) +
        '<span class="u">%</span></span>') +
      /* The neutral, which is the conductor most often undersized and the one a
         single-phase declaration would miss entirely. */
      (String(o.phases) === '3' ? fRow('Neutral', selIn('panel', o.id, 'neutral',
        o.neutral === true ? 'yes' : (o.neutral === false ? 'no' : ''),
        ['', 'yes', 'no'], function (v) {
          return v === '' ? 'from core count (' + num(o.cable && o.cable.cores, 4) + ')' : (v === 'yes' ? 'carried back' : 'three-pole');
        })) : '') +
      fRow('Imbalance', '<span class="unit">' + nIn('panel', o.id, 'imbalance', o.imbalance, { step: 1, placeholder: 'assumed 0' }) + '<span class="u">%</span></span>') +
      '<div class="hint">Design kVA = kW ÷ pf, multiplied by the demand factor. Leave kVA blank to derive it. ' +
      '<b>Non-linear load</b> matters as much as the distortion figure, because not all distortion reaches a neutral. A six-pulse ' +
      '<b>drive</b> is a balanced three-phase rectifier: its harmonics are 6k ± 1, so the 5th and 7th, and none of them triplen. Its ' +
      'third harmonic cancels between the phases before it reaches any conductor — so a panel of drives heats its feeder and puts ' +
      'nothing into the neutral. The third harmonic that does reach a neutral comes from <b>single-phase switch-mode</b> loads: ' +
      'control supplies, PLC racks, instrumentation, LED drivers. ' +
      '<b>Harmonics</b> is total distortion as a percentage of the fundamental; it raises this circuit\'s RMS current, which is what heats ' +
      'the cable. <b>3rd harmonic</b> is that part of it which reaches a neutral — leave it blank to take it from the load type, or declare ' +
      'it where a measured spectrum gives it. ' +
      '<b>Neutral</b> says whether this feeder carries one back; a three-pole motor feeder cannot put zero-sequence current into a ' +
      'neutral bar, and one that does can. <b>Imbalance</b> is what an otherwise balanced three-phase load puts in the neutral.</div>' +
      '</div>' +
      '<div class="fieldset"><h4>Assignment</h4>' +
      fRow('Main board (PDB)', '<select class="sel" data-bind="item" data-kind="panel" data-id="' + o.id + '" data-f="pdbId"><option value="">— none —</option>' +
        opts(S.pdbs.map(function (b) { return b.id; }), o.pdbId, function (v) { var t = LC.get(S, 'pdb', v); return t ? t.tag + ' · ' + t.incomerA + ' A' : v; }) + '</select>') +
      fRow('Board (PDP)', '<select class="sel" data-bind="item" data-kind="panel" data-id="' + o.id + '" data-f="pdpId"><option value="">— auto-assign —</option>' +
        opts(pdps.map(function (p2) { return p2.id; }), o.pdpId, function (v) { var t = LC.get(S, 'pdp', v); return t ? t.tag + ' · ' + t.incomerA + ' A' : v; }) + '</select>') +
      fRow('Sub-board', '<select class="sel" data-bind="item" data-kind="panel" data-id="' + o.id + '" data-f="dbId"' + (subs.length ? '' : ' disabled') + '>' +
        '<option value="">— fed from ' + esc(o.pdpId ? (LC.get(S, 'pdp', o.pdpId) || {}).tag || 'the PDP' : 'the PDP') + ' —</option>' +
        opts(subs.map(function (b) { return b.id; }), o.dbId, function (v) { var t = LC.get(S, 'db', v); return t ? t.tag + ' · ' + t.incomerA + ' A' : v; }) +
        '</select>' + (subs.length ? '' : '<div class="hint" style="margin-top:-2px">Add a sub-board on this PDP to offer one here.</div>')) +
      fRow('Auto on entry', '<label style="font-size:11px;color:var(--fg-dim);display:flex;gap:6px;align-items:center;cursor:pointer">' +
        '<input type="checkbox" data-bind="bool" data-kind="panel" data-id="' + o.id + '" data-f="autoAssign"' + (o.autoAssign ? ' checked' : '') + '> re-balance on grid reference entry</label>') +
      '<div class="hint" style="margin-top:6px">Auto-assign always lands a circuit on the PDP. A sub-board is a deliberate placement, so it is left on the board you choose here. Setting a <b>main board</b> and clearing the PDP feeds the circuit straight off that board — one way on the MSB, as a large item of plant with its own feeder panel is wired. Such a circuit is left alone by auto-assign and re-balance.</div>' +
      '</div>' +
      '<div class="fieldset"><h4>Feeder cable</h4>' + cableFields(o, 'panel') + '</div>' +
      protFields(o, 'panel') +
      '<div class="fieldset"><h4>Location (grid reference)</h4>' + posFields(o, 'panel') + '</div>' +
      '<div class="fieldset"><h4>Check</h4><div id="dynStats"></div><div id="dynVerdict" style="margin-top:8px"></div><div id="dynPhases" style="margin-top:8px"></div></div>' +
      '<div class="fieldset"><h4>Notes</h4><textarea class="ta" data-bind="item" data-kind="panel" data-id="' + o.id + '" data-f="notes">' + esc(o.notes) + '</textarea></div>';
  }
  function btn(action, label, cls) {
    return '<button class="btn ' + (cls || '') + '" data-act="' + action + '" data-id="' + (sel ? sel.id : '') + '">' + label + '</button>';
  }

  /* Symbol key for the schematic. An SLD is meaningless without one — the
     symbols are standardised, the abbreviations are not. */
  function sldLegend() {
    modal('Single line diagram — symbols', '<div class="sld-legend">' +
      '<div class="lg-item"><svg viewBox="0 0 40 40" class="lg-sym"><g class="sym"><circle cx="17" cy="20" r="11" class="sym-line"/><circle cx="24" cy="20" r="11" class="sym-line"/></g></svg>' +
      '<b>Transformer</b> — two overlapping circles (IEC 60617), HV winding left, LV right</div>' +
      '<div class="lg-item"><svg viewBox="0 0 40 40" class="lg-sym"><rect x="13" y="13" width="14" height="14" class="sym-fill"/></svg>' +
      '<b>ACB / MCCB</b> — filled square, moulded-case or air circuit-breaker incomer</div>' +
      '<div class="lg-item"><svg viewBox="0 0 40 40" class="lg-sym"><rect x="13" y="15" width="14" height="10" class="sym-line"/><line x1="20" y1="15" x2="20" y2="25" class="sym-line"/></svg>' +
      '<b>MCB</b> — rectangle with a line through it, the final-circuit device</div>' +
      '<div class="lg-item"><svg viewBox="0 0 40 40" class="lg-sym"><line x1="20" y1="10" x2="20" y2="17" class="sym-line"/><line x1="13" y1="17" x2="27" y2="17" class="sym-line"/><line x1="15" y1="21" x2="25" y2="21" class="sym-line"/><line x1="17" y1="25" x2="23" y2="25" class="sym-line"/></svg>' +
      '<b>Earth</b> — three decreasing bars</div>' +
      '<div class="lg-item"><svg viewBox="0 0 40 40" class="lg-sym"><rect x="8" y="14" width="24" height="14" class="sym-box"/></svg>' +
      '<b>Board</b> — plain rectangle, the reference inside</div>' +
      '<div class="lg-item"><svg viewBox="0 0 40 40" class="lg-sym"><path d="M14 12 L20 20 L26 12" class="sym-line"/></svg>' +
      '<b>Incoming supply</b> — arrow from the utility</div>' +
      '</div>' +
      '<div class="hint" style="margin-top:12px"><b>Reading the drawing.</b> Every branch is labelled with its protective device, incomer ' +
      'rating and feeder cable — <code>125 A · 4×16 mm²</code> means a 125 A board fed by four 16 mm² cores. ' +
      'Loads are shown in kW and amps; a red board is over 100% of its incomer and an amber one over 85%. ' +
      'The vertical order is the supply order: utility → transformer → main board → distribution board → sub-board → circuit.</div>',
      [{ label: 'Close' }]);
  }

  /* ------------------------------------------------------------------ tabs */
  function renderTabs() {
    var issues = LC.audit(S);
    var bad = issues.filter(function (i) { return i.level === 'bad'; }).length;
    var warn = issues.filter(function (i) { return i.level === 'warn'; }).length;
    var cnt = bad + warn;
    var tabs = document.querySelectorAll('#tabs .tab');
    Array.prototype.forEach.call(tabs, function (t) {
      var b = t.querySelector('.cnt'); if (b) b.remove();
      if (t.dataset.tab === 'audit') {
        var sp = document.createElement('span');
        sp.className = 'cnt' + (cnt ? '' : ' zero');
        sp.textContent = cnt;
        t.appendChild(sp);
      }
    });
    /* the map tab only exists once something has been loaded */
    var hasMap = !!(S.underlay && S.underlay.kind);
    el('tabMap').hidden = !hasMap;
    el('btnMapOpts').hidden = !hasMap;
    el('btnMapFit').hidden = !hasMap;
    el('btnMapClear').hidden = !hasMap;
    if (!hasMap && tab === 'map') tab = 'loads';
  }
  function renderTab() {
    var host = el('tabContent');
    if (tab === 'loads') host.innerHTML = viewLoads();
    else if (tab === 'cables') host.innerHTML = viewCables();
    else if (tab === 'boards') host.innerHTML = viewBoards();
    else if (tab === 'sld') { host.innerHTML = viewSld(); wireSld(); wireSldSelect(); }
    else if (tab === 'audit') host.innerHTML = viewAudit();
    else if (tab === 'map') { host.innerHTML = viewMap(); wireMapPanel(); }
    else host.innerHTML = viewNotes();
    if (tab === 'loads') wireLoadsTable();
  }

  function th(col, label, cls) {
    var a = sort.col === col ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-sort="' + col + '" class="' + (cls || '') + '">' + label + a + '</th>';
  }
  function matchQuery(pn) {
    if (filter.unassigned && (pn.pdpId || pn.pdbId)) return false;
    if (filter.noCable && pn.cable && pn.cable.csa) return false;
    if (!filter.q) return true;
    var q = filter.q.toLowerCase();
    return (pn.tag + ' ' + pn.name + ' ' + pn.description + ' ' + (pn.type || '')).toLowerCase().indexOf(q) >= 0;
  }
  function sortPanels(list) {
    if (!sort.col) return list;
    var c = sort.col, d = sort.dir;
    return list.sort(function (a, b) {
      var va, vb;
      if (c === 'tag') { va = a.tag; vb = b.tag; return (va < vb ? -1 : va > vb ? 1 : 0) * d; }
      if (c === 'kva') { va = LC.panelDemand(S, a).kva; vb = LC.panelDemand(S, b).kva; return (va - vb) * d; }
      if (c === 'pos') { va = a.pos.x + a.pos.y; vb = b.pos.x + b.pos.y; return (va - vb) * d; }
      return 0;
    });
  }

  function viewLoads() {
    var t = LC.totals(S);
    var all = S.panels.filter(matchQuery);
    var groups = [];
    S.pdps.forEach(function (d) {
      var ps = sortPanels(all.filter(function (p) { return p.pdpId === d.id; }));
      if (ps.length || !filter.q) groups.push({ pdp: d, panels: ps });
    });
    var un = sortPanels(all.filter(function (p) { return !p.pdpId; }));
    var h = '<div class="toolbar-inline">' +
      '<input class="inp" style="width:200px" id="fltQ" placeholder="Filter tag / description" value="' + esc(filter.q) + '">' +
      '<label style="font-size:11px;color:var(--fg-dim);display:flex;gap:4px;align-items:center"><input type="checkbox" id="fltUn"' + (filter.unassigned ? ' checked' : '') + '> unassigned only</label>' +
      '<label style="font-size:11px;color:var(--fg-dim);display:flex;gap:4px;align-items:center"><input type="checkbox" id="fltC"' + (filter.noCable ? ' checked' : '') + '> no cable only</label>' +
      '<span style="margin-left:auto;font-size:11px;color:var(--fg-dim)">' + all.length + ' of ' + S.panels.length + ' circuits · ' + t.kw.toFixed(0) + ' kW / ' + t.kva.toFixed(0) + ' kVA</span>' +
      btn2('csv', 'Export CSV') + btn2('print', 'Print') + '</div>';

    h += '<table class="grid"><thead><tr>' +
      th('tag', 'Ref', 'l') + th('', 'Board', 'l') + th('', 'Description', 'l') + th('', 'kW') + th('kva', 'kVA') +
      th('', 'kvar') + th('', 'pf') + th('', 'Ph') + th('', 'I (A)') + th('', 'Device') + th('', 'Icu') + th('', 'Cable mm²') + th('', 'Rated A') + th('', '%') +
      th('', 'Drop %') + th('', 'Start A', 'start') + th('', 'Dip %', 'start') +
      th('pos', 'Grid ref', 'l') + th('', 'Status') + '</tr></thead><tbody>';

    groups.forEach(function (g) {
      var sd = LC.boardStats(S, g.pdp, 'pdp');
      h += '<tr class="grp clickable" data-select="' + g.pdp.id + '" data-kind="pdp">' +
        '<td class="l" colspan="3">▤ ' + esc(g.pdp.tag) + ' — ' + esc(g.pdp.name) + '</td>' +
        '<td>' + sd.kw.toFixed(0) + '</td><td>' + sd.kva.toFixed(1) + '</td><td>' + sd.kvar.toFixed(0) + '</td><td>' + sd.pf.toFixed(2) + '</td><td>' + g.pdp.phases + '</td>' +
        '<td>' + sd.amp.toFixed(0) + '</td><td colspan="3">incomer ' + g.pdp.incomerA + ' A</td><td colspan="2">E' + LS.r1(g.pdp.pos.x).toFixed(1) + ' N' + LS.r1(g.pdp.pos.y).toFixed(1) + '</td>' +
        '<td>' + utilBadge(sd.util) + '</td><td colspan="2">' + startSummary(g.panels) + '</td></tr>';

      /* sub-distribution boards sit under their PDP, then the circuits that
         feed straight off the PDP itself */
      LC.dbOfPdp(S, g.pdp.id).forEach(function (b) {
        var on = g.panels.filter(function (pn) { return pn.dbId === b.id; });
        var sb = LC.boardStats(S, b, 'db');
        h += '<tr class="grp clickable" data-select="' + b.id + '" data-kind="db">' +
          '<td class="l" colspan="3" style="padding-left:22px">▥ ' + esc(b.tag) + ' — ' + esc(b.name) +
          (b.enclosure ? ' <span style="color:var(--fg-mute)">(' + esc(b.enclosure) + ')</span>' : '') + '</td>' +
          '<td>' + sb.kw.toFixed(1) + '</td><td>' + sb.kva.toFixed(1) + '</td><td>' + sb.kvar.toFixed(0) + '</td><td>' + sb.pf.toFixed(2) + '</td><td>' + b.phases + '</td>' +
          '<td>' + sb.amp.toFixed(1) + '</td><td colspan="3">' + b.incomerA + ' A · ' + sb.panels.length + '/' + b.spare + ' ways</td><td colspan="2">E' + LS.r1(b.pos.x).toFixed(1) + ' N' + LS.r1(b.pos.y).toFixed(1) + '</td>' +
          '<td>' + utilBadge(sb.util) + '</td><td colspan="2">' + startSummary(on) + '</td></tr>';
        on.forEach(function (pn) { h += panelRow(pn, b); });
      });

      var direct = g.panels.filter(function (pn) { return !pn.dbId || !LC.get(S, 'db', pn.dbId); });
      if (direct.length) {
        h += '<tr class="grp"><td class="l" colspan="3" style="padding-left:22px;color:var(--fg-mute)">fed directly from ' + esc(g.pdp.tag) + '</td>' +
          '<td colspan="15"></td></tr>';
        direct.forEach(function (pn) { h += panelRow(pn, g.pdp); });
      }

      h += '<tr class="sub"><td class="l" colspan="3">subtotal · ' + g.panels.length + ' circuits</td><td>' + sd.kw.toFixed(1) + '</td><td>' + sd.kva.toFixed(1) + '</td><td>' + sd.kvar.toFixed(1) + '</td><td>' + sd.pf.toFixed(2) + '</td><td></td>' +
        '<td>' + sd.amp.toFixed(1) + '</td><td colspan="3"></td><td></td><td>' + utilBadge(sd.util) + '</td></tr>';
    });

    if (un.length) {
      h += '<tr class="grp"><td class="l" colspan="15">⚠ Unassigned control panels — no PDP selected</td></tr>';
      un.forEach(function (pn) { h += panelRow(pn, null); });
    }

    /* roll-ups */
    S.txs.forEach(function (tx) {
      var s = LC.boardStats(S, tx, 'tx');
      var u = s.kva / Math.max(1, num(tx.kva, 1)) * 100;
      h += '<tr class="total clickable" data-select="' + tx.id + '" data-kind="tx"><td class="l" colspan="3">◆ ' + esc(tx.tag) + ' — ' + esc(tx.name) + '</td>' +
        '<td>' + s.kw.toFixed(0) + '</td><td>' + s.kva.toFixed(0) + '</td><td>' + s.kvar.toFixed(0) + '</td><td>' + s.pf.toFixed(2) + '</td><td>3</td><td>' + s.amp.toFixed(0) + '</td>' +
        '<td colspan="3">transformer ' + tx.kva + ' kVA · ' + tx.kvIn + '/' + tx.kvOut + ' kV</td><td colspan="2"></td><td>' + utilBadge(u) + '</td></tr>';
    });
    h += '<tr class="total"><td class="l" colspan="3">SITE TOTAL</td><td>' + t.kw.toFixed(0) + '</td><td>' + t.kva.toFixed(0) + '</td><td></td><td></td><td>' + t.amp.toFixed(0) + '</td>' +
      '<td colspan="3">installed ' + t.txKva + ' kVA → ' + t.txUtil.toFixed(0) + '%</td><td colspan="2">imbalance ' + t.dev.toFixed(0) + '%</td><td></td></tr>';
    h += '</tbody></table>';
    if (!S.panels.length) h = '<div class="empty">No control panels yet.<br>Choose <b>▣ Panel</b> in the toolbar and click a grid reference on the plan, or press <b>Sample</b>.</div>';
    return h;
  }
  /* One line per board saying what its motors do at starting, because the
     question is never about one machine — it is whether the worst of them, or
     all of them together, upsets the board. Anything not a motor is ignored:
     a lighting circuit has no starting current and would drag the figure down. */
  function startSummary(pans) {
    /* startingCheck returns null for anything the model does not apply to, which
       is how a lighting circuit drops out here without needing its own filter. */
    var motors = pans.map(function (pn) {
      return LC.startingCheck(S, pn, 'panel');
    }).filter(function (r) { return r && !r.noRating; });
    if (!motors.length) return '';
    var worst = motors.reduce(function (a, b) { return b.dip.pct > a.dip.pct ? b : a; });
    var together = motors.reduce(function (a, r) { return a + r.sc.amps; }, 0);
    var dips = motors.map(function (r) { return r.dip.pct; });
    var bad = motors.some(function (r) { return r.tripsUpstream || r.tripsSelf; });
    return '<span class="mono" style="font-size:10.5px;color:' + (bad ? 'var(--bad)' : 'var(--fg-dim)') + '">' +
      motors.length + (motors.length === 1 ? ' motor, worst dip ' : ' motors, worst dip ') +
      Math.max.apply(null, dips).toFixed(1) + '%, ' + together.toFixed(0) + ' A together</span>';
  }

  function panelRow(pn, pdp) {
    var d = LC.panelDemand(S, pn);
    var cab = pn.cable && pn.cable.csa ? LC.cableRating(pn.cable) : null;
    var vd = cab ? LC.voltDrop(pn.cable, d.amp, d.pf, pn.phases, pn.volt) : null;
    var status = 'ok', sTxt = 'OK';
    /* the immediate supply: the sub-board if it sits on one, otherwise the
       distribution board, otherwise the main board it hangs off directly */
    var board = pdp && pdp.__kind === 'db' ? pdp
              : (LC.get(S, 'pdp', pn.pdpId) || LC.get(S, 'pdb', pn.pdbId));
    var boardKind = board ? board.__kind : null;
    if (!board) { status = 'bad'; sTxt = 'No board'; }
    else if (!cab) { status = 'warn'; sTxt = 'No cable'; }
    else if (d.amp > cab.derated) { status = 'bad'; sTxt = 'Cable small'; }
    else if (vd.pct > num(S.design.vdropLimitLv, 3)) { status = 'warn'; sTxt = 'Drop ' + vd.pct.toFixed(1) + '%'; }
    else if (d.amp > cab.derated * 0.9) { status = 'warn'; sTxt = 'Near limit'; }
    var cu = cab ? (d.amp / cab.derated) * 100 : null;
    return '<tr class="clickable' + (sel && sel.id === pn.id ? ' sel' : '') + (board ? '' : ' unassigned') + '" data-select="' + pn.id + '" data-kind="panel">' +
      '<td class="l"' + (boardKind === 'db' ? ' style="padding-left:34px"' : '') + '><b>' + esc(pn.tag) + '</b></td>' +
      '<td class="l">' + esc(board ? board.tag : '—') + '</td>' +
      '<td class="l"><div class="cellwrap">' + esc(pn.name) + (pn.description ? '<br><span style="color:var(--fg-mute);font-size:10.5px">' + esc(pn.description) + '</span>' : '') + '</div></td>' +
      '<td>' + d.kw.toFixed(1) + '</td>' +
      '<td>' + d.kva.toFixed(1) + '</td>' +
      '<td>' + d.kvar.toFixed(1) + '</td>' +
      '<td>' + d.pf.toFixed(2) + '</td>' +
      '<td>' + pn.phases + '</td>' +
      /* the current shown is the one that actually heats the cable, which is
         the harmonic-raised figure where a circuit declares distortion */
      '<td class="' + (cab && d.ampHarm > cab.derated ? 'num-bad' : '') + '">' + d.ampHarm.toFixed(1) +
        (d.harmFactor > 1.001 ? '<br><span style="font-size:10px;color:var(--fg-mute)">' + d.amp.toFixed(1) + ' A 1st</span>' : '') + '</td>' +
      '<td class="l" style="white-space:nowrap">' + esc(protCell(pn)) + '</td>' +
      '<td>' + (pn.prot && num(pn.prot.icu, 0) ? num(pn.prot.icu) + ' kA' : '—') + '</td>' +
      '<td>' + (cab ? ((cab.runs > 1 ? cab.runs + '×' : '') + cab.csa) : '—') + '</td>' +
      '<td>' + (cab ? cab.derated.toFixed(0) : '—') + '</td>' +
      '<td class="' + utilCls(cu) + '">' + (cu === null ? '—' : cu.toFixed(0) + '%') + '</td>' +
      '<td class="' + (vd && vd.pct > num(S.design.vdropLimitLv, 3) ? 'num-warn' : '') + '">' + (vd ? vd.pct.toFixed(2) : '—') + '</td>' +
      /* Starting current, and what that current does to the board it starts from.
         Only shown when the method is anything other than direct on line or the
         board is stiff enough that the dip does not matter — a column of 7x
         figures that never affects anything is noise on a schedule. */
      (function () {
        var r = LC.startingCheck(S, pn, 'panel');
        if (!r) return '<td>—</td><td>—</td>';
        if (r.noRating) return '<td class="l" style="color:var(--fg-mute);font-size:10.5px">no rating</td><td>—</td>';
        /* No dip means no fault level to derive the impedance from, which is a
           gap in the data rather than a result — so the starting current is still
           worth showing on its own. */
        if (!r.dip) return '<td class="l">' + r.sc.amps.toFixed(0) +
          ' A<br><span style="font-size:10px;color:var(--fg-mute)">' + r.sc.method.multiple + '× · ' +
          r.sc.method.name + '</span></td><td class="l" style="color:var(--fg-mute);font-size:10.5px">no fault level</td>';
        var matters = r.dip.pct > 5 || r.tripsUpstream || r.tripsSelf ||
          (LC.torqueNeeded(pn.loadTorque) !== null && r.dip.torqueAvail < LC.torqueNeeded(pn.loadTorque));
        if (!matters) return '<td class="l" style="color:var(--fg-mute);font-size:10.5px">' +
          r.sc.amps.toFixed(0) + ' A</td><td style="color:var(--fg-mute)">' + r.dip.pct.toFixed(1) + '</td>';
        var bad = r.tripsUpstream || r.tripsSelf ||
          (LC.torqueNeeded(pn.loadTorque) !== null && r.dip.torqueAvail < LC.torqueNeeded(pn.loadTorque));
        return '<td class="' + (r.tripsUpstream || r.tripsSelf ? 'num-bad' : 'l') + '" style="white-space:nowrap">' +
          r.sc.amps.toFixed(0) + ' A<br><span style="font-size:10px;color:var(--fg-mute)">' +
          r.sc.method.multiple + '× · ' + r.sc.method.name + '</span></td>' +
          '<td class="' + (r.dip.pct > 10 ? 'num-warn' : bad ? 'num-bad' : '') + '">' +
          r.dip.pct.toFixed(1) + (r.dip.pct > 10 ? '<br><span style="font-size:10px">' +
            r.dip.motorV.toFixed(0) + ' V</span>' : '') + '</td>';
      })() +
      '<td class="l" style="font-size:10.5px">E' + LS.r1(pn.pos.x).toFixed(1) + ' N' + LS.r1(pn.pos.y).toFixed(1) + '</td>' +
      '<td><span class="badge ' + status + '">' + sTxt + '</span></td></tr>';
  }

  function viewCables() {
    var rows = [];
    S.pdps.forEach(function (d) {
      var pdb = LC.get(S, 'pdb', d.pdbId);
      var sd = LC.boardStats(S, d, 'pdp');
      rows.push({ from: pdb ? pdb.tag : '—', to: d.tag, kind: 'PDP incomer', o: d, c: d.cable, load: sd.amp, pf: 0.9, ph: d.phases, volt: 400, id: d.id, tkind: 'pdp' });
    });
    S.dbs.forEach(function (b) {
      var pdp2 = LC.get(S, 'pdp', b.pdpId);
      var sb = LC.boardStats(S, b, 'db');
      rows.push({ from: pdp2 ? pdp2.tag : '—', to: b.tag, kind: 'Sub-board incomer', o: b, c: b.cable, load: sb.amp, pf: 0.9, ph: b.phases, volt: 400, id: b.id, tkind: 'db' });
    });
    S.pdbs.forEach(function (b) {
      var tx = LC.get(S, 'tx', b.txId);
      var sd = LC.boardStats(S, b, 'pdb');
      rows.push({ from: tx ? tx.tag : '—', to: b.tag, kind: 'PDB incomer', o: b, c: b.cable, load: sd.amp, pf: 0.9, ph: b.phases, volt: 400, id: b.id, tkind: 'pdb' });
    });
    S.panels.forEach(function (pn) {
      /* the feeder comes from the sub-board if it sits on one, else the PDP */
      var up = (pn.dbId && LC.get(S, 'db', pn.dbId)) || LC.get(S, 'pdp', pn.pdpId);
      var d = LC.panelDemand(S, pn);
      rows.push({ from: up ? up.tag : '—', to: pn.tag, kind: up && up.__kind === 'db' ? 'Sub-board to panel' : 'Control panel', o: pn, c: pn.cable, load: d.amp, pf: d.pf, ph: pn.phases, volt: pn.volt, id: pn.id, tkind: 'panel' });
    });
    var h = '<div class="toolbar-inline"><span style="font-size:11px;color:var(--fg-dim)">' + rows.length + ' circuits · volt drop limit ' + S.design.vdropLimitLv + '%</span>' +
      '<span style="margin-left:auto"></span>' + btn2('autocables', 'Size all cables') + btn2('csv', 'Export CSV') + '</div>';
    h += '<table class="grid"><thead><tr><th class="l">From</th><th class="l">To</th><th class="l">Circuit</th><th>Runs</th><th>Core mm²</th><th>Cores</th><th>Length m</th><th class="l">Installation</th><th>Grouped</th><th>Amb °C</th><th>Base A</th><th>Derated A</th><th>Load A</th><th>%</th><th>Drop V</th><th>Drop %</th><th>PE mm²</th><th>R1+R2 Ω</th><th>Loop A</th><th>Max t ms</th><th>Act t ms</th><th>Verdict</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var cab = r.c && r.c.csa ? LC.cableRating(r.c) : null;
      var vd = cab ? LC.voltDrop(r.c, r.load, r.pf, r.ph, r.volt) : null;
      var ef = LC.earthFaultCheck(S, r.o, r.tkind);
      var verdict = '—', vc = 'mute';
      if (cab) {
        if (r.load > cab.derated) { verdict = '✕ undersized'; vc = 'bad'; }
        else if (ef && ef.unachievable) { verdict = '✕ device too slow'; vc = 'bad'; }
        else if (ef && !ef.pass) { verdict = '✕ loop too high'; vc = 'bad'; }
        else if (vd.pct > num(S.design.vdropLimitLv, 3)) { verdict = '✕ drop'; vc = 'bad'; }
        else if (r.load > cab.derated * 0.9) { verdict = '! near limit'; vc = 'warn'; }
        else { verdict = '✓ ok'; vc = 'ok'; }
      } else verdict = '— no cable';
      var cu = cab ? (r.load / cab.derated) * 100 : null;
      h += '<tr class="clickable' + (sel && sel.id === r.id ? ' sel' : '') + '" data-select="' + r.id + '" data-kind="' + r.tkind + '">' +
        '<td class="l">' + esc(r.from) + '</td><td class="l"><b>' + esc(r.to) + '</b></td><td class="l">' + esc(r.kind) + '</td>' +
        '<td>' + (r.c ? (r.c.runs || 1) : '—') + '</td><td>' + (cab ? cab.csa : '—') + '</td><td>' + (r.c ? r.c.cores : '—') + '</td><td>' + (r.c ? num(r.c.len, 0).toFixed(1) : '—') + '</td>' +
        '<td class="l" style="font-size:10.5px">' + esc(cab ? cab.method.name : (r.c ? r.c.method : '—')) + '</td>' +
        '<td>' + (r.c ? r.c.group : '—') + '</td><td>' + (r.c ? r.c.ambient : '—') + '</td>' +
        '<td>' + (cab ? cab.base : '—') + '</td><td class="' + (cab && r.load > cab.derated ? 'num-bad' : '') + '">' + (cab ? cab.derated.toFixed(0) : '—') + '</td>' +
        '<td>' + r.load.toFixed(1) + '</td><td class="' + utilCls(cu) + '">' + (cu === null ? '—' : cu.toFixed(0) + '%') + '</td>' +
        '<td>' + (vd ? vd.volts.toFixed(1) : '—') + '</td>' +
        '<td class="' + (vd && vd.pct > num(S.design.vdropLimitLv, 3) ? 'num-bad' : '') + '">' + (vd ? vd.pct.toFixed(2) : '—') + '</td>' +
        /* The earth fault columns. R1+R2 and the current it will carry are the
           calculation; the required and achieved times are the pass or fail,
           side by side because neither means anything on its own. */
        '<td>' + (ef && !ef.needs ? (ef.loop.peCsa || '—') : '—') + '</td>' +
        '<td>' + (ef && !ef.needs ? ef.loop.total.toFixed(3) : '—') + '</td>' +
        '<td>' + (ef && !ef.needs ? ef.ia.toFixed(0) : '—') + '</td>' +
        '<td>' + (ef && !ef.needs ? (ef.tMax * 1000).toFixed(0) : '—') + '</td>' +
        '<td class="' + (ef && !ef.needs && !ef.pass ? 'num-bad' : '') + '">' +
          (ef && !ef.needs ? (ef.tActual === null ? '—' : (ef.tActual * 1000).toFixed(0)) : '—') + '</td>' +
        '<td><span class="badge ' + vc + '">' + verdict + '</span></td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function viewBoards() {
    var rows = LC.boardList(S);
    var h = '<div class="toolbar-inline"><span style="font-size:11px;color:var(--fg-dim)">' + rows.length + ' boards · design margin ' + S.design.designMargin + '× · imbalance warn ' + S.design.imbalanceWarn + '%</span>' +
      '<span style="margin-left:auto"></span>' + btn2('autosizeall', 'Auto-size incomers') + btn2('balance', 'Auto-balance') + btn2('balance-tx', '↔ Across main boards') + btn2('csv', 'Export CSV') + '</div>';
    h += '<table class="grid"><thead><tr><th class="l">Board</th><th class="l">Equip ref</th><th class="l">Description</th><th class="l">Fed from</th><th>Incomer A</th><th>Busbar A</th><th>Load A</th><th>Utilisation</th><th>Headroom A</th><th>Circuits</th><th>Device</th><th>Ways</th><th>Dev %</th><th>kVA</th><th>Fault kA</th><th class="l">Grid ref</th><th>Status</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var o = r.o, kind = r.kind;
      var rating = kind === 'tx' ? num(o.kva, 0) * 1000 / (Math.sqrt(3) * num(o.kvOut, 0.415) * 1000) : r.st.rating;
      var load = r.st.amp;
      var u = kind === 'tx' ? (r.st.kva / Math.max(1, num(o.kva, 1)) * 100) : r.st.util;
      var head = rating - load;
      var parent = kind === 'pdb' ? (LC.get(S, 'tx', o.txId) || {}).tag
        : kind === 'pdp' ? (LC.get(S, 'pdb', o.pdbId) || {}).tag
        : kind === 'db' ? (LC.get(S, 'pdp', o.pdpId) || {}).tag
        : 'HV network';
      var st2 = u > 100 ? 'bad' : u > 85 ? 'warn' : r.st.dev > num(S.design.imbalanceWarn, 15) ? 'warn' : 'ok';
      var lbl = u > 100 ? 'overloaded' : u > 85 ? 'heavily loaded' : r.st.dev > num(S.design.imbalanceWarn, 15) ? 'unbalanced' : 'ok';
      h += '<tr class="clickable' + (sel && sel.id === o.id ? ' sel' : '') + '" data-select="' + o.id + '" data-kind="' + kind + '">' +
        '<td class="l"><span class="tdot" style="display:inline-block;background:' + LS.SHAPE[kind].color + ';margin-right:5px"></span><b>' + esc(o.tag) + '</b></td>' +
        '<td class="l" style="color:var(--fg-mute)">' + esc(o.ref || '') + '</td>' +
        '<td class="l"><div class="cellwrap">' + esc(o.name || '') + (kind === 'db' && o.enclosure ? '<br><span style="color:var(--fg-mute);font-size:10.5px">' + esc(o.enclosure) + '</span>' : '') + '</div></td>' +
        '<td class="l">' + esc(parent || '—') + '</td>' +
        '<td>' + (kind === 'tx' ? '—' : num(o.incomerA, 0)) + '</td>' +
        '<td>' + (num(o.busbarA, 0) || num(o.incomerA, 0)) + '</td>' +
        '<td>' + load.toFixed(1) + '</td>' +
        '<td class="' + utilCls(u) + '">' + (u === null ? '—' : u.toFixed(0) + '%') + '</td>' +
        '<td class="' + (head < 0 ? 'num-bad' : '') + '">' + (rating ? head.toFixed(0) : '—') + '</td>' +
        /* ways of the enclosure and how many are spare — shown together, because
           "16 circuits" against "0 spare" reads as a problem when the board is
           simply full */
        '<td>' + r.st.panels.length + '</td>' +
        '<td class="l" style="white-space:nowrap">' + esc(protCell(o)) +
          (o.prot && num(o.prot.icu, 0) ? ' <span style="color:var(--fg-mute)">' + num(o.prot.icu) + ' kA</span>' : '') + '</td>' +
        '<td>' + (kind === 'pdp' || kind === 'db'
          ? (r.st.ways === null ? '—' : r.st.ways + ' <span style="color:var(--fg-mute)">(' + r.st.spareUsed + ' used' +
              (kind === 'pdp' ? ', ' + (r.st.ways - r.st.spareUsed) + ' spare' : '') + ')</span>')
          : '—') + '</td>' +
        '<td class="' + (r.st.dev > num(S.design.imbalanceBad, 25) ? 'num-bad' : r.st.dev > num(S.design.imbalanceWarn, 15) ? 'num-warn' : '') + '">' + (r.st.dev || 0).toFixed(0) + '%</td>' +
        '<td>' + r.st.kva.toFixed(0) + '</td>' +
        '<td>' + (r.st.faultKA ? r.st.faultKA.toFixed(2) : '—') + '</td>' +
        '<td class="l" style="font-size:10.5px">E' + LS.r1(o.pos.x).toFixed(1) + ' N' + LS.r1(o.pos.y).toFixed(1) + '</td>' +
        '<td><span class="badge ' + st2 + '">' + lbl + '</span></td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function viewAudit() {
    var raw = LC.audit(S);
    /* Grouped both ways, because the button has to survive the mode it is in:
       counting what *would* be folded is what keeps it on screen after the
       user has already unfolded, rather than the control removing itself and
       leaving no way back. */
    var folded = LC.groupFindings(raw);
    var issues = auditGrouped ? folded : raw;
    var bad = raw.filter(function (i) { return i.level === 'bad'; }).length;
    var warn = raw.filter(function (i) { return i.level === 'warn'; }).length;
    var info = raw.filter(function (i) { return i.level === 'info'; }).length;
    var collapsible = folded.length !== raw.length;
    var hidden = raw.length - folded.length;
    var h = '<div class="toolbar-inline"><span style="font-size:11px;color:var(--fg-dim)">' +
      bad + ' errors · ' + warn + ' warnings · ' + info + ' notes' +
      /* What is collapsed, so the shorter list is not mistaken for all of it */
      (auditGrouped && collapsible ? ' <span style="color:var(--fg-dim2)">(' + hidden + ' of the same kind folded together)</span>' : '') +
      '</span>' +
      '<span style="margin-left:auto"></span>' +
      (collapsible ? '<button class="btn sm" data-global="auditgroup">' + (auditGrouped ? 'Show every finding' : 'Group repeats') + '</button>' : '') +
      btn2('balance', 'Auto-balance') + btn2('autocables', 'Size all cables') + btn2('print', 'Print report') + '</div>';
    if (!raw.length) return h + '<div class="empty">✓ No design warnings.<br>Boards are within capacity, phases balanced, cables and volt drops compliant.</div>';
    h += issues.map(function (i) {
      var lvc = i.level === 'bad' ? 'bad' : i.level === 'warn' ? 'warn' : 'info';
      var lvt = i.level === 'bad' ? 'ERROR' : i.level === 'warn' ? 'WARNING' : 'NOTE';
      /* A grouped row is not itself clickable — there is no one item it
         means. Its members are listed instead, each one selectable. */
      var can = !i.grouped && i.id && i.id !== '-' && LC.get(S, i.scope, i.id);
      var out = '<div class="audit-item' + (can ? ' clickable' : '') + '"' +
        (can ? ' data-select="' + i.id + '" data-kind="' + i.scope + '"' : '') + '>' +
        '<div class="lv"><span class="badge ' + lvc + '">' + lvt + '</span></div>' +
        '<div class="audit-body"><div class="t">' + esc(i.title) + '</div>' +
        (i.detail ? '<div class="d">' + esc(i.detail) + '</div>' : '');
      if (i.grouped) {
        /* Long lists are the reason grouping exists, so a group of ninety gets
           the first eight and a count for the rest rather than all ninety —
           the full list is in the CSV and the print report. */
        var show = LC.MAX_LIST;
        out += '<div class="d" style="margin-top:5px">' +
          i.tags.slice(0, show).map(function (tg) { return esc(tg); }).join(' · ') +
          (i.tags.length > show ? ' <span style="color:var(--fg-dim2)">and ' + (i.tags.length - show) + ' more — see the CSV export</span>' : '') +
          '</div>';
      }
      out += '<div class="code">' + esc(i.scope.toUpperCase()) + ' · design margin ' + S.design.designMargin + '× · drop limit ' + S.design.vdropLimitLv + '%</div></div></div>';
      return out;
    }).join('');
    return h;
  }
  function btn2(a, label) { return '<button class="btn sm" data-global="' + a + '">' + label + '</button>'; }

  function viewNotes() {
    return '<div class="notes-wrap">' +
      '<h5>Project</h5>' +
      '<div class="two" style="max-width:640px">' +
      fRow('Client', txt('meta', '', 'client', S.client, 'e.g. Acme Ltd')) +
      fRow('Project no.', txt('meta', '', 'ref', S.ref)) +
      fRow('Designer', txt('meta', '', 'designer', S.designer)) +
      fRow('Date', txt('meta', '', 'date', S.date)) +
      '</div>' +
      '<h5>Board numbering</h5>' +
      '<div class="convention">' +
        '<div class="cv-row"><span class="cv-t">TX7</span><span class="cv-d">transformer</span></div>' +
        '<div class="cv-row"><span class="cv-t">└ PDB7</span><span class="cv-d">main LV board on that transformer</span></div>' +
        '<div class="cv-row"><span class="cv-t">&nbsp;&nbsp;&nbsp;└ PDP7-1</span><span class="cv-d">distribution board 1 off it</span></div>' +
        '<div class="cv-row"><span class="cv-t">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└ DB7-1-1</span><span class="cv-d">sub-distribution board 1 (e.g. 125 A Acti9)</span></div>' +
        '<div class="cv-row"><span class="cv-t">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├ MCC-01</span><span class="cv-d">control panel fed from that board</span></div>' +
        '<div class="cv-row"><span class="cv-t">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└ AHU-02</span><span class="cv-d">another circuit on the same board</span></div>' +
        '<div class="cv-row"><span class="cv-t">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└ DB7-1-2</span><span class="cv-d">sub-distribution board 2 off the same PDP</span></div>' +
        '<div class="cv-row"><span class="cv-t">&nbsp;&nbsp;&nbsp;└ PDP7-2</span><span class="cv-d">distribution board 2 → DB7-2-1, DB7-2-2 …</span></div>' +
      '</div>' +
      '<div class="hint" style="margin-top:8px">The four board tiers are numbered from the topology, not typed, so they cannot fall out of step with the ' +
      'design. Renumbering happens whenever the hierarchy changes — add a board, delete one, move a circuit, or set a transformer number. ' +
      '<b>Control panels are not numbered</b>: a panel is a load, not a board, so it keeps the reference the drawing team already uses — MCC-01, ' +
      'AHU-02, PLT-01. The schedule shows which board each one is fed from. A transformer with more than one main board continues the sequence ' +
      '(PDB7-1, PDB7-2) and the levels below follow it.</div>' +
      '<h5>Design criteria</h5>' +
      '<div class="two" style="max-width:640px">' +
      fRow('Board design margin', '<span class="unit">' + dnum('designMargin', S.design.designMargin, 1.05) + '<span class="u">×</span></span>') +
      fRow('New board spread', '<span class="unit">' + dnum('spreadMargin', S.design.spreadMargin, 1.1) + '<span class="u">×</span></span>') +
      fRow('Volt drop limit (LV)', '<span class="unit">' + dnum('vdropLimitLv', S.design.vdropLimitLv, 0.5) + '<span class="u">%</span></span>') +
      fRow('Imbalance warn', '<span class="unit">' + dnum('imbalanceWarn', S.design.imbalanceWarn, 1) + '<span class="u">%</span></span>') +
      fRow('Imbalance limit', '<span class="unit">' + dnum('imbalanceBad', S.design.imbalanceBad, 1) + '<span class="u">%</span></span>') +
      fRow('Fault MVA factor', '<span class="unit">' + dnum('faultMVAFactor', S.design.faultMVAFactor, 0.1) + '<span class="u">×kVA</span></span>') +
      fRow('Impedance / stage', '<span class="unit">' + dnum('zpuPerStage', S.design.zpuPerStage, 0.01) + '<span class="u">pu</span></span>') +
      fRow('Power factor limit', '<span class="unit">' + dnum('pfLimit', S.design.pfLimit, 0.05) + '<span class="u">pf</span></span>') +
      fRow('Harmonic watch', '<span class="unit">' + dnum('thdWatch', S.design.thdWatch, 1) + '<span class="u">% THD</span></span>') +
      '</div>' +
      '<h5>Earthing</h5>' +
      '<div class="two" style="max-width:640px">' +
      fRow('Supply system', '<select class="sel" data-bind="design" data-f="supplySystem">' +
        ['TN-S', 'TN-C-S', 'TT', 'IT'].map(function (v) {
          return '<option value="' + v + '"' + (S.design.supplySystem === v ? ' selected' : '') + '>' + v + '</option>';
        }).join('') + '</select>') +
      fRow('Earth electrode R', '<span class="unit">' + dnum('earthElectrodeR', S.design.earthElectrodeR, 0.5) + '<span class="u">Ω</span></span>') +
      '</div>' +
      /* What the chosen arrangement actually means for this installation. The
         arrangements are not three names for one thing and the differences are
         all things that go wrong on site. */
      (function () {
        var arr = LC.supplyArrangement(S);
        return '<div class="fieldset"><h4>' + esc(arr.system) + ' — what this requires</h4>' +
          '<div class="hint" style="margin-bottom:6px">' + esc(arr.note) + '</div>' +
          '<ul>' +
          '<li>Earthed at <b>' + esc(arr.earthedAt) + '</b>.</li>' +
          '<li>A three-phase and neutral feeder needs <b>' + arr.coresFor3PN + ' cores</b> where the ' +
          (arr.coresFor3PN === 5 ? 'protective conductor shares the cable' : 'neutral and protective conductor share a PEN') + '.</li>' +
          (arr.pen ? '<li>Every PEN downstream is also a neutral: it must not be interrupted by a single-pole switch.</li>'
                   : '<li>The neutral is <b>' + (arr.neutralSeparate ? 'a separate conductor' : 'combined as a PEN') + '</b> — ' +
                     (arr.neutralSeparate ? 'it must not be re-bonded to earth, and must not be interrupted.'
                                          : 'separate again only downstream of the first RCD.') + '</li>') +
          '<li>The neutral conductor carries whatever triplen current the board\'s non-linear loads produce. ' +
          'On a balanced three-phase load those add at <b>three times</b> the per-phase value, which is the usual reason a neutral is undersized.</li>' +
          '</ul></div>';
      })() +
      '<div class="hint">The supply system decides how the earth fault loop is formed. ' +
      'On <b>TN</b> the loop is the fault, the protective conductor and the source impedance, so R1+R2 alone decides the disconnection time. ' +
      'On <b>TT</b> the loop runs through the earth electrode, so its resistance has to be entered here as well, and a 30 mA RCD is what makes a ' +
      '0.1 s disconnection achievable at all — this tool does not model RCDs, so on TT it will tell you the electrode resistance is needed and stop there. ' +
      'On <b>IT</b> there is no earthed source point, so a single fault does not raise the voltage on healthy metalwork and an RCD is the only thing that ' +
      'clears it.</div>' +
      '<h5>How the schedule is built</h5><ul>' +
      '<li><b>Load</b> — design kVA = connected kW ÷ power factor × demand factor; current from kVA at the board voltage. Single-phase circuits are calculated at the phase-to-neutral voltage.</li>' +
      '<li><b>Assignment</b> — every control panel is placed by grid reference. Each board is scored on the utilisation it would end up at, how far the feeder would run, and whether a way is left free. Run length is weighted against load size, so a small circuit stays on the nearest board while a large one chases headroom. Crossing a transformer is penalised, so it only happens when it is clearly better.</li>' +
      '<li><b>Overload</b> — if no board has headroom, a new PDP is created beside the best-placed one, on the same main board, at the next practical grid reference. The search walks outward on the snap grid in the eight practical directions, respecting the clearance and the site boundary, then falls back to the nearest free cell anywhere on the grid. The new board is sized for the load it takes.</li>' +
      '<li><b>Phase balance</b> — single-phase circuits are allocated to the lightest phase of the board they land on, so they spread across L1, L2 and L3 rather than stacking. The properties panel marks the lightest phase.</li>' +
      '<li><b>Moving a panel</b> — drop it on an occupied cell and it is nudged to the next clear reference rather than overlapping. Dragging also re-runs the assignment if the load no longer fits.</li>' +
      '<li><b>Cables</b> — indicative ampacity per the IEC 60364-5-52 reference methods, derated for ambient temperature, grouping and 4-core construction, with up to four parallel runs. Volt drop uses an indicative copper impedance at 70 °C over the straight-line route plus 20%.</li>' +
      '<li><b>Earth fault loop</b> — R1 + R2 over the route at conductor operating temperature, giving the loop current as U0 ÷ (R1 + R2). The device\'s time-current curve is then read at that current and compared against the maximum disconnection time for its rating and the supply system (IEC 60364-41 Table 41.4). The protective conductor defaults to the BS 7671 Table 54.7 minimum for the phase size and can be overridden. Where the loop is too high, the finding states the size that would meet it.</li>' +
      '<li><b>Balancing</b> — <b>Auto-balance</b> levels the distribution boards feeding from each main board, and never moves a circuit between main boards. <b>↔ Balance across TX</b> does allow that, because it changes the supply topology.</li>' +
      '</ul>' +
      '<h5>Limits of this tool</h5><ul>' +
      '<li>Ampacity values are indicative — confirm against the current edition of BS 7671 / IEC 60364-5-52, the manufacturer\'s data, and local rules before issue.</li>' +
      '<li>Selectivity and cable thermal withstand are assessed on conventional envelopes (IEC 60898, IEC 60947-2 and the adiabatic relation), not on manufacturer\'s curves or let-through data. Both judge the <b>settings</b> rather than the devices.</li>' +
      '<li>Earth fault loop impedance uses the simplified R1 + R2 method of IEC 60364-5-54 Annex B with an assumed copper resistance, not measured or calculated loop impedance. Joint and contact resistances, and any temperature below operating, are not included.</li>' +
      '<li>No RCD discrimination, short-circuit capacity or cost checks are performed. The &le;32 A disconnection time assumes 30 mA additional protection, which this tool does not model.</li>' +
      '<li>Fault levels are indicative (LV fault MVA = factor × transformer rating, stepped by an assumed impedance per stage).</li>' +
      '<li>No diversity is applied between circuits; each panel is loaded at its own demand factor.</li>' +
      '</ul></div>';
  }
  function dnum(f, v, step) {
    return '<input class="inp" type="number" step="' + step + '" data-bind="design" data-f="' + f + '" value="' + v + '">';
  }

  /* ==================================================== SINGLE LINE DIAGRAM */
  /* The schematic is regenerated from scratch each time the tab is shown —
     it is a few hundred SVG nodes, which is cheaper than keeping it in sync.
     Zoom is held in `sldZoom` so switching tabs does not lose the view. */
  var sldZoom = 1, sldFit = true;
  function viewSld() {
    var r = SLD.render(S);
    sldLast = r;
    var h = '<div class="toolbar-inline">' +
      '<span style="font-size:11px;color:var(--fg-dim)">' + r.nodes.length + ' items · IEC 60617 symbols</span>' +
      '<span style="margin-left:auto"></span>' +
      btn2('sldfit', 'Fit') + btn2('sldout', '−') + btn2('sldin', '+') +
      btn2('sldlegend', 'Legend') + btn2('print', 'Print') + '</div>';
    h += '<div class="sld-wrap"><div class="sld-scale" style="transform:scale(' + sldZoom + ')">' +
      '<svg class="sld" id="sldSvg" viewBox="0 0 ' + r.width + ' ' + r.height + '" width="' + r.width + '" height="' + r.height + '" ' +
      'xmlns="http://www.w3.org/2000/svg">' + r.svg + '</svg>' +
      '</div></div>' +
      '<div class="sld-foot">Click any item to select it. The drawing scrolls; use <b>Fit</b> to see the whole system.</div>';
    return h;
  }
  var sldLast = null;
  function wireSld() {
    var svg = el('sldSvg');
    if (svg && sldFit) fitSld();
  }
  function fitSld() {
    var wrap = document.querySelector('.sld-wrap');
    var svg = el('sldSvg');
    if (!wrap || !svg) return;
    var z = Math.min((wrap.clientWidth - 24) / (sldLast.width || 1), 1.15);
    sldZoom = Math.max(0.15, Math.min(1.15, z));
    var sc = document.querySelector('.sld-scale');
    if (sc) sc.style.transform = 'scale(' + sldZoom + ')';
    /* the scale transform does not change layout size, so set the wrapper's
       height to the scaled height or the scroll area is wrong */
    if (sc) { sc.style.height = ((sldLast.height || 0) * sldZoom) + 'px'; sc.style.width = ((sldLast.width || 0) * sldZoom) + 'px'; }
  }
  function sldZoomBy(f) {
    sldFit = false;
    sldZoom = Math.max(0.12, Math.min(2.4, sldZoom * f));
    var sc = document.querySelector('.sld-scale');
    if (sc) {
      sc.style.transform = 'scale(' + sldZoom + ')';
      sc.style.height = ((sldLast.height || 0) * sldZoom) + 'px';
      sc.style.width = ((sldLast.width || 0) * sldZoom) + 'px';
    }
  }
  /* select an item by clicking it in the drawing */
  function wireSldSelect() {
    var svg = el('sldSvg');
    if (!svg || svg.__wired) return;
    svg.__wired = true;
    svg.addEventListener('click', function (e) {
      var g = e.target.closest ? e.target.closest('[data-select]') : null;
      if (g) select(g.getAttribute('data-select'), g.getAttribute('data-kind'));
    });
  }

  /* ================================================== HIERARCHICAL NUMBERING */
  /* Tags are derived from the topology, so they are never typed by hand.
     Renumbering runs after anything that changes the hierarchy, and the
     toast says what moved. */
  function renumber(quiet) {
    var changed = LC.applyNumbering(S);
    if (changed.length && !quiet) {
      var preview = changed.slice(0, 3).map(function (c) {
        return '<b>' + esc(c.from) + '</b> → ' + esc(c.to);
      }).join(', ');
      toast('Renumbered ' + changed.length + ' item' + (changed.length === 1 ? '' : 's') + ': ' + preview +
        (changed.length > 3 ? '…' : ''), '');
    }
    var dupes = LC.numberingIssues(S);
    if (dupes.length) toast('Duplicate tag: ' + dupes.join(', ') + ' — check the transformer numbers', 'bad');
    return changed;
  }
  /* a read-only view of the tag, with the derivation spelled out */
  function tagField(kind, o) {
    var hint;
    if (kind === 'tx') hint = 'Everything below numbers from this: PDB' + o.num + ', PDP' + o.num + '-1, DB' + o.num + '-1-1…';
    else if (kind === 'pdb') hint = 'Distribution boards become PDP…-1, PDP…-2';
    else if (kind === 'pdp') hint = 'Its sub-board becomes DB…-' + o.num + '-1; control panels keep their own reference';
    else if (kind === 'db') hint = 'The lighting and small-power board on ' + esc((LC.get(S, 'pdp', o.pdpId) || {}).tag || 'its PDP') + '. Control panels keep their own reference.';
    else hint = 'Numbered in sequence from its distribution board';
    return '<div class="tagbox"><div class="tagbox-v">' + esc(o.tag) + '</div>' +
      '<div class="tagbox-h">' + hint + '</div></div>';
  }
  /* the reference you keep for your own drawing set, if it differs */
  function refField(kind, o) {
    return fRow('Equipment ref', '<input class="inp" data-bind="item" data-kind="' + kind + '" data-id="' + o.id +
      '" data-f="ref" value="' + esc(o.ref || '') + '" placeholder="MCC-01, DB-2, CP-A…">') +
      '<div class="hint" style="margin-top:-2px;margin-bottom:6px">Your own board number, where it differs from the derived reference.</div>';
  }

  /* ============================================================= SITE MAP */
  function viewMap() {
    var u = S.underlay;
    if (!u || !u.kind) {
      return '<div class="empty">No site map loaded.<br>' +
        'Press <b>Load drawing…</b> in the toolbar to place a DXF or a site photo behind the boards.</div>';
    }
    var g = u.geo || {};
    var site = LC.underlaySiteInGeo(S, u);
    var inv = LC.underlayInverse(S, u);
    var h = '<div class="toolbar-inline">' +
      '<b style="font-size:12px">' + esc(u.name) + '</b>' +
      '<span class="badge mute">' + (u.kind === 'dxf' ? 'DXF' : 'Image') + '</span>' +
      '<span style="font-size:11px;color:var(--fg-dim)">' +
        (u.kind === 'dxf'
          ? esc(g.width.toFixed(1) + ' × ' + g.height.toFixed(1) + ' ' + g.unitName)
          : u.w + ' × ' + u.h + ' px') +
      '</span>' +
      '<span style="margin-left:auto"></span>' +
      btn2('mapfit', 'Fit to site') + btn2('mapcal', 'Set scale by measuring…') +
      btn2('mapclear', 'Remove map') + '</div>';

    h += '<div class="map-grid">';
    /* --- placement --- */
    h += '<div class="map-card">' +
      '<h5>Placement</h5>' +
      fRow('Visible', '<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:11.5px">' +
        '<input type="checkbox" id="uVis"' + (u.visible !== false ? ' checked' : '') + '> show the map</label>') +
      fRow('Opacity', '<span style="display:flex;align-items:center;gap:8px">' +
        '<input type="range" id="uOpacity" min="0.1" max="1" step="0.05" value="' + (u.opacity === undefined ? 0.85 : u.opacity) + '" style="flex:1">' +
        '<span class="mono" id="uOpacityV" style="width:38px;text-align:right;font-size:11px">' + Math.round((u.opacity === undefined ? 0.85 : u.opacity) * 100) + '%</span></span>') +
      fRow('Scale', '<span class="unit"><input class="inp" type="number" id="uScale" step="0.000001" value="' + u.scale + '"><span class="u">m/unit</span></span>') +
      fRow('Offset E', '<span class="unit"><input class="inp" type="number" id="uOx" step="0.01" value="' + LS.r2(u.ox) + '"><span class="u">m</span></span>') +
      fRow('Offset N', '<span class="unit"><input class="inp" type="number" id="uOy" step="0.01" value="' + LS.r2(u.oy) + '"><span class="u">m</span></span>') +
      '<div class="hint">Scale is metres per drawing unit — ' +
        (g.metresPerUnit ? 'the drawing is in ' + esc(g.unitName) + ', so ' + g.metresPerUnit + ' m per unit is correct.' :
         u.kind === 'image' ? 'for a photo, work out metres per pixel from a known dimension on the image.' :
         'the drawing has no unit scale, so enter it here (mm drawings are 0.001).') +
      '</div></div>';

    /* --- what the site rectangle means in drawing units --- */
    if (site && inv) {
      h += '<div class="map-card"><h5>Site extent in drawing units</h5>' +
        '<div class="kv">' +
        '<dt>East from</dt><dd>' + site.x0.toFixed(2) + '</dd>' +
        '<dt>East to</dt><dd>' + site.x1.toFixed(2) + '</dd>' +
        '<dt>North from</dt><dd>' + site.y0.toFixed(2) + '</dd>' +
        '<dt>North to</dt><dd>' + site.y1.toFixed(2) + '</dd>' +
        '<dt>Site size</dt><dd>' + S.site.w + ' × ' + S.site.h + ' m</dd>' +
        '</div>' +
        '<div class="hint">Where the site boundary falls in the ' + (u.kind === 'dxf' ? 'DXF' : 'image') +
        '. Use these to check a board sits on the right grid reference in both systems — the read-out under the plan also shows drawing coordinates.</div></div>';
    }

    /* --- layers --- */
    if (u.kind === 'dxf' && g.layers && g.layers.length) {
      var off = u.layersOff || (u.layersOff = {});
      h += '<div class="map-card"><h5>Layers</h5>' +
        '<div class="hint" style="margin-bottom:6px">' + g.layers.length + ' layers · ' + g.entities.length + ' entities drawn' +
        (g.stats.truncated ? ' · <span style="color:#fbbf24">truncated</span>' : '') + '</div>' +
        '<div class="layer-list">';
      g.layers.forEach(function (name) {
        h += '<label class="layer-row"><input type="checkbox" data-layer="' + esc(name) + '"' + (off[name] ? '' : ' checked') + '>' +
             '<span>' + esc(name) + '</span></label>';
      });
      h += '</div>' +
        '<div class="hint" style="margin-top:6px">Dimensions, hatches and annotation layers are hidden by default. ' +
        (Object.keys(g.stats.skipped).length
          ? 'Not drawn: ' + Object.keys(g.stats.skipped).map(function (k) { return esc(k) + ' ×' + g.stats.skipped[k]; }).join(', ') + '.'
          : '') + '</div></div>';
    }

    /* --- notes from the parser --- */
    if (u.kind === 'dxf' && g.warnings && g.warnings.length) {
      h += '<div class="map-card"><h5>Notes</h5><ul class="map-warn">' +
        g.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    }
    h += '</div>';
    return h;
  }

  function wireMapPanel() {
    var u = S.underlay;
    if (!u) return;
    function apply() { commit(false); }
    var vis = el('uVis');
    if (vis) vis.onchange = function () { u.visible = vis.checked; commit(false); };
    var op = el('uOpacity'), opv = el('uOpacityV');
    if (op) op.oninput = function () { u.opacity = parseFloat(op.value); if (opv) opv.textContent = Math.round(u.opacity * 100) + '%'; PLAN.draw(); };
    var sc = el('uScale');
    if (sc) sc.onchange = function () { var n = parseFloat(sc.value); if (isFinite(n) && n > 0) { u.scale = n; } apply(); };
    var ox = el('uOx'), oy = el('uOy');
    if (ox) ox.onchange = function () { u.ox = parseFloat(ox.value) || 0; apply(); };
    if (oy) oy.onchange = function () { u.oy = parseFloat(oy.value) || 0; apply(); };
    el('tabContent').querySelectorAll('[data-layer]').forEach(function (cb) {
      cb.onchange = function () {
        if (!u.layersOff) u.layersOff = {};
        u.layersOff[cb.dataset.layer] = !cb.checked;
        PLAN.draw();
      };
    });
  }
  function wireLoadsTable() {
    var q = el('fltQ');
    if (!q) return;
    q.addEventListener('input', function () { filter.q = q.value; var p = q.selectionStart; renderTab(); var n = el('fltQ'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
    el('fltUn').addEventListener('change', function (e) { filter.unassigned = e.target.checked; renderTab(); });
    el('fltC').addEventListener('change', function (e) { filter.noCable = e.target.checked; renderTab(); });
  }

  /* ------------------------------------------------------------- mutations */
  /* Every field edit is undoable. Text inputs coalesce per field so a word is one
     step rather than one per keystroke; a select is a deliberate choice, so it
     always gets its own. */
  function undoLabel(kind, id, f) {
    var o = itemById(id);
    var what = (o && (o.tag || o.name)) || 'item';
    var field = { kw: 'load', kva: 'kVA', pf: 'power factor', demand: 'demand factor',
      volt: 'voltage', phases: 'phases', start: 'starting method', csa: 'core size',
      incomerA: 'incomer', ways: 'ways', spareWays: 'spare ways', num: 'number',
      pdpId: 'supply', pdbId: 'supply', dbId: 'sub-board', ir: 'device rating',
      icu: 'breaking capacity', frame: 'device frame', trip: 'trip unit',
      contingency: 'future load' }[f];
    return (field ? what + ' ' + field : what + ' ' + f);
  }
  function applyField(t) {
    var b = t.dataset.bind, kind = t.dataset.kind, id = t.dataset.id, f = t.dataset.f;
    var v = t.type === 'checkbox' ? t.checked : t.value;
    /* a checkbox or a select fires on change; a text input on every keystroke */
    var discrete = t.type === 'checkbox' || t.tagName === 'SELECT';
    pushUndo(undoLabel(kind, id, f), discrete ? null : kind + ':' + id + ':' + f);
    if (b === 'design') { S.design[f] = num(v); }
    else if (b === 'meta') { S[f] = v; }
    else if (b === 'site') { S.site[f] = num(v); }
    else if (b === 'item') {
      var o = itemById(id); if (!o) return;
      o[f] = t.type === 'number' ? num(v) : v;
      if (kind === 'panel' && f === 'type') { var t2 = LS.PANEL_TYPES[v]; if (t2) { o.pf = t2.pf; o.phases = t2.phases; renderProps(); } }
      if (kind === 'panel' && f === 'pdpId') {
        o.pdpId = v || null;
        if (v) o.autoAssign = false;
        /* the circuit has left that PDP, so it cannot stay on one of its
           sub-boards */
        if (v && o.dbId && (!LC.get(S, 'db', o.dbId) || LC.get(S, 'db', o.dbId).pdpId !== v)) o.dbId = null;
        /* choosing a distribution board takes the circuit off the main board */
        if (v) o.pdbId = null;
      }
      /* A circuit takes its supply from either a distribution board or a main
         board, never both. Naming a main board clears the PDP and its
         sub-board, which is what makes it one way on the MSB. */
      if (kind === 'panel' && f === 'pdbId') {
        o.pdbId = v || null;
        if (v) {
          o.pdpId = null;
          o.dbId = null;
          o.autoAssign = false;
        }
      }
      /* a sub-board's circuits are fed from its PDP, so the two must agree */
      if (kind === 'db' && f === 'pdpId') {
        var moved = S.panels.filter(function (pn) { return pn.dbId === o.id; });
        moved.forEach(function (pn) { pn.pdpId = v || null; });
        if (moved.length) toast(moved.length + ' circuit(s) now fed from ' + esc(v ? (LC.get(S, 'pdp', v) || {}).tag || 'the new PDP' : 'nothing'), '');
      }
      /* moving an item in the tree, or renumbering a transformer, rewrites
         every reference below it */
      if (f === 'pdpId' || f === 'pdbId' || f === 'txId' || f === 'num') {
        renumber();
        renderProps();
        return;
      }
    } else if (b === 'num') {
      var o2 = itemById(id); if (!o2) return;
      o2[f] = (v === '' ? null : num(v));
      if (f === 'num') { renumber(); renderProps(); return; }
    } else if (b === 'cabnum') {
      var o3 = itemById(id); if (!o3) return;
      if (f === '_x') o3.pos.x = num(v); if (f === '_y') o3.pos.y = num(v);
      if (f === '_cores') o3.cable.cores = num(v);
      if (f === '_runs') o3.cable.runs = Math.max(1, num(v, 1));
      if (f === '_len') { o3.cable.len = num(v); if (o3.__kind === 'panel' || o3.__kind === 'pdp') autoLen(o3); }
      /* The field name is prefixed so it cannot collide with a cable property
         of the same name; every one has to be translated explicitly, because the
         fall-through would write a key called "_peCsa" that nothing reads. */
      else if (f === '_peCsa') o3.cable.peCsa = (v === '' ? null : num(v));
      else if (f === '_csa') o3.cable.csa = (v === '' ? null : num(v));
      else o3.cable[f] = (v === '' ? null : num(v));
      if (f === '_x' || f === '_y') onMoved(o3, true);
    } else if (b === 'cab') {
      var o4 = itemById(id); if (!o4) return;
      o4.cable[f] = v;
    } else if (b === 'bool') {
      var o5 = itemById(id); if (!o5) return;
      o5[f] = !!v;
    } else if (b === 'protsel') {
      /* the device type. Switching between MCCB and MCB changes which fields
         make sense, so the form is rebuilt rather than patched. */
      var o6 = itemById(id); if (!o6) return;
      var wasMcb = o6.prot && o6.prot.kind === 'mcb';
      var isMcbNow = v === 'mcb';
      var keepIcu = o6.prot && o6.prot.icu;
      o6.prot = LS.newProt({ kind: isMcbNow ? 'mcb' : 'mccb',
        ir: o6.prot ? o6.prot.ir : null,
        frame: isMcbNow ? null : (o6.prot ? o6.prot.frame : null),
        icu: keepIcu,
        trip: isMcbNow ? 'C' : (wasMcb ? 'TM' : 'TM'),
        poles: o6.prot ? o6.prot.poles : 4,
        notes: o6.prot ? o6.prot.notes : '' });
      commit(true);
      renderProps();
    } else if (String(b).indexOf('prot_') === 0) {
      var o7 = itemById(id); if (!o7) return;
      if (!o7.prot) o7.prot = LS.newProt({});
      var key = f.slice(5);                 // 'prot_ir' -> 'ir'
      if (key === 'icu') o7.prot.icu = (v === '' || v === null) ? null : num(v);
      else o7.prot[key] = (v === '' || v === null) ? null : num(v);
      /* the verdict under the form has to follow the change without a redraw,
         or typing a rating gives no feedback until the field is left */
      var pv = el('dynProt');
      if (pv) pv.innerHTML = protVerdict(o7, kind, o7.prot, LC.faultAt(S, o7, kind));
      commit(false);
    }
  }
  function autoLen(o) { /* keep feeder length in step with the drawn position */
    if (!o || !o.cable || !o.pos) return;
    LC.syncLen(S, o);
  }

  /* Entry of a grid reference: resolve the cell, then re-assign if needed. */
  function onMoved(o, fromField) {
    if (o.__kind !== 'panel') { commit(false); return; }
    /* if the cell is occupied, step to the next practical reference */
    var s = LS.SHAPE.panel;
    var all = LC.allItems(S), hitItem = null;
    for (var i = 0; i < all.length; i++) {
      var a = all[i]; if (a === o || !a.pos) continue;
      var os = LS.SHAPE[a.__kind];
      if (Math.abs(o.pos.x - a.pos.x) < (s.w + os.w) / 2 + num(clearance(), 1.5) / 2 &&
          Math.abs(o.pos.y - a.pos.y) < (s.h + os.h) / 2 + num(clearance(), 1.5) / 2) { hitItem = a; break; }
    }
    if (hitItem) {
      var np = LC.nextPracticalPos(S, { anchor: o.pos, offset: num(offset(), 2), clear: num(clearance(), 1.5), w: s.w, h: s.h, step: num(snap(), 1), exclude: o });
      o.pos = np;
      toast('Occupied cell — moved to the next practical grid reference <b>E' + np.x.toFixed(1) + ' N' + np.y.toFixed(1) + '</b>', '');
    }
    if (o.autoAssign) {
      var before = o.pdpId;
      var log = LC.assignPanel(S, o, { offset: num(offset(), 2), clear: num(clearance(), 1.5) });
      autoLen(o);
      if (log.created) {
        renumber();
        toast(log.created.tag + ' created at <b>E' + log.created.pos.x.toFixed(1) + ' N' + log.created.pos.y.toFixed(1) + '</b> (next practical reference) for ' + esc(o.tag), 'good');
        commit(true);
        sel = { id: log.created.id, kind: 'pdp' };
        renderProps();
        return;
      }
      if (log.moved) renumber();
      if (log.moved) {
        var f = LC.get(S, 'pdp', before);
        toast(o.tag + ' re-assigned → <b>' + esc(LC.get(S, 'pdp', log.to).tag) + '</b>' + (f ? ' (was ' + esc(f.tag) + ')' : ''), '');
      }
    }
    commit(false);
  }

  /* ------------------------------------------------------------- add / del */
  function nextPanelTag() {
    var n = 1, used = {};
    S.panels.forEach(function (p) { used[p.tag] = 1; });
    while (used['CP-' + (n < 10 ? '0' + n : n)]) n++;
    return 'CP-' + (n < 10 ? '0' + n : n);
  }
  function addTx(pos) {
    pushUndo('add transformer');
    var n = S.txs.length + 1;
    var t = LS.newTx({ tag: 'TX-' + n, name: 'Transformer ' + n, kva: 1000, pos: pos, num: nextTxNumber() });
    t.__kind = 'tx'; S.txs.push(t);
    renumber();
    sel = { id: t.id, kind: 'tx' };
    toast('Transformer ' + t.tag + ' added at E' + pos.x.toFixed(1) + ' N' + pos.y.toFixed(1), 'good');
    commit(true);
  }
  /* the next free transformer number, so a new supply does not reuse one */
  function nextTxNumber() {
    var used = {};
    S.txs.forEach(function (t) { if (t.num) used[t.num] = 1; });
    var i = 1; while (used[i]) i++;
    return i;
  }
  function addPdb(pos, txId) {
    if (!S.txs.length) { toast('Add a transformer first', 'bad'); return; }
    pushUndo('add main board');
    var best = txId ? LC.get(S, 'tx', txId) : nearest(S.txs, pos, 'tx');
    var kva = num(best.kva, 1000);
    var b = LS.newPdb({
      tag: 'PDB', name: 'Main LV board', txId: best.id,
      incomerA: LC.suggestIncomer((kva * 1000) / (Math.sqrt(3) * 1000 * num(best.kvOut, 0.415) * 1000) / 0.9 * 0.9, 1.1),
      pos: pos
    });
    b.__kind = 'pdb'; S.pdbs.push(b);
    renumber();
    sel = { id: b.id, kind: 'pdb' };
    toast('Main board ' + b.tag + ' added under ' + best.tag, 'good');
    commit(true);
  }
  function addPdp(pos, pdbId) {
    if (!S.pdbs.length) { toast('Add a main board (PDB) first', 'bad'); return; }
    pushUndo('add distribution board');
    var parent = pdbId ? LC.get(S, 'pdb', pdbId) : nearest(S.pdbs, pos, 'pdb');
    var siblings = LC.pdpOfPdb(S, parent.id);
    var d = LS.newPdp({ tag: 'PDP', name: 'Distribution board ' + (siblings.length + 1), pdbId: parent.id, incomerA: 250, spareWays: 4, pos: pos });
    d.__kind = 'pdp'; S.pdps.push(d);
    renumber();
    sel = { id: d.id, kind: 'pdp' };
    toast(d.tag + ' added under ' + parent.tag + ' at E' + pos.x.toFixed(1) + ' N' + pos.y.toFixed(1), 'good');
    commit(true);
  }
  /* Sub-distribution board — a 125 A or 250 A board fed from a distribution
     board, carrying lighting, small power and the other small final circuits.
     It behaves like a machine main control panel: just another feeder. More
     than one on the same PDP is fine when a board needs a second area. */
  function addDb(pos, pdpId) {
    if (!S.pdps.length) { toast('Add a distribution board (PDP) first', 'bad'); return; }
    pushUndo('add sub-board');
    var parent = pdpId ? LC.get(S, 'pdp', pdpId) : nearest(S.pdps, pos, 'pdp');
    /* leave the parent some headroom, then pick a standard sub-board size */
    var st = LC.boardStats(S, parent, 'pdp');
    var used = LC.dbOfPdp(S, parent.id).reduce(function (a, b) { return a + LC.boardStats(S, b, 'db').amp; }, 0);
    var room = Math.max(63, Math.min(1000, (st.rating || 400) * 0.4 - used * 0.5));
    var inc = LS.DB_SIZES_A.filter(function (a) { return a <= room; }).pop() || LS.DB_SIZES_A[0];
    var n = LC.dbOfPdp(S, parent.id).length + 1;
    var b = LS.newDb({
      tag: 'DB', name: 'Lighting & small power' + (n > 1 ? ' ' + n : ''),
      pdpId: parent.id, incomerA: inc, ways: 36, enclosure: 'Acti9',
      serves: 'lighting, small power', pos: pos
    });
    b.cable = { csa: null, runs: 1, cores: 4, len: LC.dist(parent.pos, pos), method: 'XL-A1', group: 3, ambient: 40, sheathed: true };
    b.__kind = 'db'; S.dbs.push(b);
    /* an empty board has no load to size from, so propose for its rating */
    LC.suggestDbFeeder(S, b);
    renumber();
    sel = { id: b.id, kind: 'db' };
    toast(b.tag + ' (' + b.incomerA + ' A ' + b.enclosure + ') added under ' + parent.tag + ' at E' + pos.x.toFixed(1) + ' N' + pos.y.toFixed(1), 'good');
    commit(true);
  }
  function nearest(list, pos, kind) {
    var best = list[0], bd = Infinity;
    list.forEach(function (o) {
      var d = o.pos ? Math.hypot(o.pos.x - pos.x, o.pos.y - pos.y) : 0;
      if (d < bd) { bd = d; best = o; }
    });
    return best;
  }
  function addPanel(pos, form) {
    var p = LS.newPanel({
      tag: (form && form.tag) || nextPanelTag(),
      name: (form && form.name) || 'Control panel',
      type: (form && form.type) || 'other',
      kw: num(form && form.kw, 10),
      pos: pos
    });
    p.__kind = 'panel';
    if (form && form.csa) p.cable.csa = num(form.csa);
    p.cable.len = Math.max(0.5, LS.r1(Math.hypot((p.pos.x), (p.pos.y)) * 0.4 + 8));
    S.panels.push(p);
    /* the whole point: entering a grid reference assigns the load */
    var log = LC.assignPanel(S, p, { offset: num(offset(), 2), clear: num(clearance(), 1.5) });
    autoLen(p);
    renumber();
    sel = { id: p.id, kind: 'panel' };
    if (log.created) {
      toast('No headroom → created <b>' + log.created.tag + '</b> at E' + log.created.pos.x.toFixed(1) + ' N' + log.created.pos.y.toFixed(1) + ' and assigned ' + esc(p.tag) + ' to it', 'good');
    } else {
      var b = LC.get(S, 'pdp', p.pdpId);
      var stt = b ? LC.boardStats(S, b, 'pdp') : null;
      toast(esc(p.tag) + ' assigned to <b>' + esc(b ? b.tag : '?') + '</b>' + (stt ? ' — board now ' + stt.util.toFixed(0) + '% of ' + stt.rating + ' A' : ''), 'good');
    }
    commit(true);
  }
  function del(id, kind) {
    var o = itemById(id); if (!o) return;
    /* deleting a transformer cascades, so the snapshot is taken once at the top
       and the recursive calls must not each push their own */
    if (!undoPending) pushUndo('delete ' + o.tag);
    var msg = 'Delete ' + o.tag + '?';
    if (kind === 'tx') { var c = LC.pdbOfTx(S, id).length; if (c) msg += ' — ' + c + ' main board(s) and everything below will be removed.'; }
    if (kind === 'pdb') { var c2 = LC.pdpOfPdb(S, id).length; if (c2) msg += ' — ' + c2 + ' distribution board(s) and their panels will be removed.'; }
    if (kind === 'pdp') {
      var cSub = LC.dbOfPdp(S, id).length;
      if (cSub) msg += ' — ' + cSub + ' sub-board(s) and their circuits will be removed.';
      var c3 = LC.panelsOf(S, id).length;
      if (c3) msg += ' — ' + c3 + ' control panel(s) will be unassigned.';
    }
    /* deleting a sub-board must not orphan the circuits on it — they fall
       back to feeding from the PDP, which is what they did before the
       sub-board existed */
    if (kind === 'db') { var c4 = LC.panelsOnDb(S, id).length; if (c4) msg += ' — ' + c4 + ' control panel(s) will be fed from ' + ((LC.get(S, 'pdp', o.pdpId) || {}).tag || 'the PDP') + ' instead.'; }
    if (!confirm(msg)) return;
    if (kind === 'tx') { S.pdbs.filter(function (b) { return b.txId === id; }).forEach(function (b) { del(b.id, 'pdb'); }); S.txs = S.txs.filter(function (x) { return x.id !== id; }); }
    if (kind === 'pdb') {
      S.pdps.filter(function (d) { return d.pdbId === id; }).forEach(function (d) { del(d.id, 'pdp'); });
      S.pdbs = S.pdbs.filter(function (x) { return x.id !== id; });
    }
    if (kind === 'pdp') {
      LC.dbOfPdp(S, id).forEach(function (b) { del(b.id, 'db'); });
      S.panels.forEach(function (p) { if (p.pdpId === id) p.pdpId = null; });
      S.pdps = S.pdps.filter(function (x) { return x.id !== id; });
    }
    if (kind === 'db') {
      /* the circuits stay on their PDP, just no longer on a sub-board */
      S.panels.forEach(function (p) { if (p.dbId === id) p.dbId = null; });
      S.dbs = S.dbs.filter(function (x) { return x.id !== id; });
    }
    if (kind === 'panel') S.panels = S.panels.filter(function (x) { return x.id !== id; });
    /* deleting closes the numbering gap, so the sequence stays contiguous */
    renumber();
    sel = null;
    commit(true);
  }

  /* -------------------------------------------------------- prop actions   */
  /* Propose a device for every supply in the project.

     This overwrites what is there, so anything already set is counted first
     and the engineer is told how much would be lost before it happens. A
     project imported from a vendor's schedule arrives with every circuit's real
     device already on it, and quietly replacing those would throw away the only
     part of the data that came from the switchgear schedule. */
  function proposeAllProt(keepExisting) {
    var counts = { pdb: 0, pdp: 0, db: 0, panel: 0 };
    var existing = 0;
    LC.allItems(S).forEach(function (o) {
      if (!o.__kind || o.__kind === 'tx') return;
      counts[o.__kind] = (counts[o.__kind] || 0) + 1;
      if (o.prot && num(o.prot.ir, 0) > 0) existing++;
    });
    var total = counts.pdb + counts.pdp + counts.db + counts.panel;
    if (!total) { toast('Nothing to protect — add some boards and circuits first', 'bad'); return; }

    function run(replace) {
      pushUndo(replace ? 'propose all protection' : 'fill in missing protection');
      var r = LC.protAll(S, { replace: replace });
      renumber();
      commit(true);
      var mccb = 0, mcb = 0;
      LC.allItems(S).forEach(function (o) {
        if (!o.prot) return;
        if (o.prot.kind === 'mcb') mcb++; else mccb++;
      });
      toast(r.count + ' supply device(s) set — ' + mccb + ' MCCB, ' + mcb + ' MCB · press <b>Audit</b> to check them', 'good');
    }

    if (existing && !keepExisting) {
      modal('Propose protection for every supply?',
        '<div>' + total + ' supplies: ' + counts.pdb + ' main board, ' + counts.pdp + ' distribution, ' +
        counts.db + ' sub-board and ' + counts.panel + ' circuit.</div>' +
        '<div class="hint" style="margin-top:10px"><b>' + existing + ' of them already have a device.</b> ' +
        'Proposing replaces those. If they came from the vendor\'s schedule, keep them and let the proposal fill in only ' +
        'what is missing.</div>',
        [{ label: 'Replace all', cls: 'warn', fn: function () { closeModal(); run(true); } },
         { label: 'Only where missing', cls: 'primary', fn: function () { closeModal(); run(false); } },
         { label: 'Cancel', fn: closeModal }], true);
      return;
    }
    run(!!keepExisting);
  }

  function propAction(act, id) {
    var o = itemById(id); if (!o) return;
    var kind = o.__kind || LC.kindOf(o);
    if (act === 'protpropose') {
      pushUndo('propose device for ' + o.tag);
      var res = LC.applyProt(S, o, kind, true);
      renumber();
      renderProps();
      commit(true);
      toast(esc(o.tag) + ' — ' + esc(res.why || 'device proposed'), res.device ? 'good' : 'bad');
      return;
    }
    if (act === 'protclear') {
      pushUndo('clear device on ' + o.tag);
      o.prot = null;
      renderProps();
      commit(true);
      return;
    }
    if (act === 'delete') return del(id, kind);
    if (act === 'addpdb') return addPdb(LC.nextPracticalPos(S, { anchor: o.pos, offset: num(offset(), 2), clear: num(clearance(), 1.5), w: LS.SHAPE.pdb.w, h: LS.SHAPE.pdb.h, step: num(snap(), 1), exclude: o }), id);
    if (act === 'addpdp') {
      var anchor = kind === 'tx' ? (LC.pdbOfTx(S, id)[0] || o) : o;
      var pdbId = kind === 'tx' ? (LC.pdbOfTx(S, id)[0] ? LC.pdbOfTx(S, id)[0].id : null) : id;
      return addPdp(LC.nextPracticalPos(S, { anchor: anchor.pos, offset: num(offset(), 2), clear: num(clearance(), 1.5), w: LS.SHAPE.pdp.w, h: LS.SHAPE.pdp.h, step: num(snap(), 1), exclude: o }), pdbId);
    }
    if (act === 'addpanel') return addPanelAt(o, kind === 'pdp' ? o.id : (o.pdpId || null));
    if (act === 'adddb') {
      var pdpId = kind === 'pdp' ? id : o.pdpId;
      var host = LC.get(S, 'pdp', pdpId);
      if (!host) { toast('A sub-board is fed from a distribution board (PDP)', 'bad'); return; }
      return addDb(LC.nextPracticalPos(S, { anchor: host.pos, offset: num(offset(), 2), clear: num(clearance(), 1.5), w: LS.SHAPE.db.w, h: LS.SHAPE.db.h, step: num(snap(), 1) }), pdpId);
    }
    if (act === 'assign') {
      pushUndo('assign ' + o.tag);
      var log = LC.assignPanel(S, o, { offset: num(offset(), 2), clear: num(clearance(), 1.5) });
      autoLen(o);
      renumber();
      toast(log.created ? ('No headroom — created ' + log.created.tag + ' at E' + log.created.pos.x.toFixed(1) + ' N' + log.created.pos.y.toFixed(1))
                        : (o.tag + ' assigned to ' + LC.get(S, 'pdp', o.pdpId).tag), log.created ? 'good' : '');
      return commit(true);
    }
    if (act === 'autosize') {
      pushUndo('auto-size ' + o.tag);
      /* size the incomer from what the board actually carries — for a
         sub-board that is only the circuits sitting on it */
      var boardKind = kind === 'pdp' || kind === 'db' ? kind : 'pdp';
      var stt = LC.boardStats(S, o, boardKind);
      var inc = LC.suggestIncomer(stt.amp || 160, num(S.design.designMargin, 1.15));
      o.incomerA = inc; o.busbarA = inc;
      if (o.cable) {
        var up = boardKind === 'db' ? LC.get(S, 'pdp', o.pdpId) : LC.get(S, 'pdb', o.pdbId);
        var sug = LC.suggestCable(stt.amp, LC.dist(up ? up.pos : o.pos, o.pos), 0.9, o.phases, 400, o.cable.method, S);
        o.cable.csa = sug.csa;
      }
      toast(o.tag + ' incomer set to ' + inc + ' A', 'good');
      return commit(true);
    }
    if (act === 'autocable') {
      var d = LC.panelDemand(S, o);
      var c = LC.suggestCable(d.amp, num(o.cable.len, 10) || 10, d.pf, o.phases, o.volt, o.cable.method, S);
      o.cable.csa = c.csa;
      toast(o.tag + ' feeder suggested at ' + c.csa + ' mm²', 'good');
      return commit(true);
    }
    if (act === 'balance-here') {
      var scope = kind === 'pdb' ? id : (LC.get(S, 'pdb', o.pdbId) || {}).id;
      pushUndo('level the boards on this main board');
      var moves = LC.autoBalance(S, { crossPdb: false, pdbId: scope, tolerance: 12 });
      toast(moves.length ? moves.length + ' circuit(s) moved to level the boards: ' + moves.map(function (m) { return m.panel + ' ' + m.from + '→' + m.to; }).join(', ') : 'Boards on this main board are already level', moves.length ? 'good' : '');
      return commit(false);
    }
    if (act === 'split') {
      /* split the board that is overloaded — a sub-board included, in which
         case the relief is a new sub-board beside it */
      var st3 = LC.boardStats(S, o, kind === 'db' ? 'db' : 'pdp');
      if (st3.util <= 100) { toast(o.tag + ' is at ' + st3.util.toFixed(0) + '% — nothing to split', ''); return; }
      pushUndo('split ' + o.tag);
      var loose2 = st3.panels.filter(function (pn) { return !pn.dbId; });
      var worst2 = loose2.slice().sort(function (a, b) { return LC.panelDemand(S, b).amp - LC.panelDemand(S, a).amp; })[0];
      if (!worst2) {
        /* every circuit here is on a sub-board, so move the heaviest one to a
           new sub-board alongside */
        var subs2 = LC.dbOfPdp(S, o.pdpId).sort(function (a, b) { return LC.boardStats(S, b, 'db').amp - LC.boardStats(S, a, 'db').amp; });
        var np = LC.nextPracticalPos(S, { anchor: o.pos, offset: num(offset(), 2), clear: num(clearance(), 1.5), w: LS.SHAPE.db.w, h: LS.SHAPE.db.h, step: num(snap(), 1), exclude: o });
        var nb = addDb(np, o.pdpId);
        var heaviest = subs2[0];
        if (nb && heaviest) {
          LC.panelsOnDb(S, heaviest.id).forEach(function (pn) { pn.dbId = nb.id; pn.pdpId = nb.pdpId; });
          LC.syncLen(S, nb);
          toast('Moved the circuits on ' + heaviest.tag + ' to ' + nb.tag + ' beside it', 'good');
          sel = { id: nb.id, kind: 'db' };
        }
        renumber();
        return commit(true);
      }
      var log2 = LC.assignPanel(S, worst2, { offset: num(offset(), 2), clear: num(clearance(), 1.5), mode: 'pack' });
      renumber();
      commit(true);
      if (log2.created) toast('Created ' + log2.created.tag + ' at E' + log2.created.pos.x.toFixed(1) + ' N' + log2.created.pos.y.toFixed(1) + ' and moved ' + worst2.tag + ' onto it', 'good');
      return;
    }
  }
  function addPanelAt(board, pdpId) {
    var anchor = board || LC.get(S, 'pdp', pdpId);
    if (!anchor) { toast('Add a distribution board (PDP) first', 'bad'); return; }
    pushUndo('add control panel');
    /* The board is not excluded from the clash test: `exclude` means "this item
       is being replaced", and a panel is a new item beside its board, not a
       replacement for it. Excluding it frees the board's own cell and the
       panel lands on top of it. */
    var pos = LC.nextPracticalPos(S, { anchor: anchor.pos, offset: 3, clear: num(clearance(), 1.5), w: LS.SHAPE.panel.w, h: LS.SHAPE.panel.h, step: num(snap(), 1) });
    panelModal(pos, anchor.__kind === 'db' ? anchor.pdpId : anchor.id, anchor.id);
  }
  /* A circuit fed straight off a main board: one way on the MSB for a large
     item of plant with its own feeder panel. It is not a candidate for
     auto-assignment, so the modal is a straight form rather than the usual
     board-chooser. */
  function addPanelOnPdb(pdb) {
    if (!pdb) { toast('Add a main board first', 'bad'); return; }
    pushUndo('add circuit on ' + pdb.tag);
    var pos = LC.nextPracticalPos(S, { anchor: pdb.pos, offset: 3, clear: num(clearance(), 1.5), w: LS.SHAPE.panel.w, h: LS.SHAPE.panel.h, step: num(snap(), 1) });
    var types = Object.keys(LS.PANEL_TYPES);
    modal('Add a circuit fed from ' + pdb.tag + ' at E' + pos.x.toFixed(1) + ' / N' + pos.y.toFixed(1),
      '<div class="two">' +
      fRow('Reference', '<input class="inp" id="mTag" value="' + nextPanelTag() + '">') +
      fRow('Name', '<input class="inp" id="mName" value="Control panel">') +
      fRow('Type', '<select class="sel" id="mType">' + opts(types, 'other', function (v) { return LS.PANEL_TYPES[v].name; }) + '</select>') +
      fRow('Connected kW', '<span class="unit"><input class="inp" type="number" id="mKw" value="15" step="0.5"><span class="u">kW</span></span>') +
      fRow('Phases', '<select class="sel" id="mPh"><option>3</option><option>1</option><option>2</option></select>') +
      fRow('Feeder core', '<span class="unit"><input class="inp" type="number" id="mCsa" list="dlCsa" placeholder="suggest" step="0.5"><span class="u">mm²</span></span>') +
      '</div>' +
      '<div class="hint" style="margin-top:10px">Taking its supply straight from <b>' + esc(pdb.tag) +
      '</b> means this circuit is one way on the main board. That is how a large machine with its own feeder panel is wired, and it keeps it out of the distribution boards — which also means it is never touched by auto-assign or re-balance.</div>',
      [{ label: 'Add', cls: 'primary', fn: function () {
          var p = LS.newPanel({ tag: el('mTag').value, name: el('mName').value, type: el('mType').value,
            kw: num(el('mKw').value), phases: el('mPh').value, pos: pos,
            pdbId: pdb.id, pdpId: null, dbId: null, autoAssign: false });
          p.__kind = 'panel';
          if (el('mCsa').value) p.cable.csa = num(el('mCsa').value);
          S.panels.push(p);
          autoLen(p);
          renumber();
          sel = { id: p.id, kind: 'panel' };
          commit();
          toast('Circuit added on ' + pdb.tag + ' — one way on the main board');
          closeModal();
        } },
       { label: 'Cancel', fn: closeModal }], true);
  }
  function panelModal(pos, pdpId, dbId) {
    var types = Object.keys(LS.PANEL_TYPES);
    var subs = pdpId ? S.dbs.filter(function (b) { return b.pdpId === pdpId; }) : [];
    modal('Add control panel at E' + pos.x.toFixed(1) + ' / N' + pos.y.toFixed(1),
      '<div class="two">' +
      fRow('Reference', '<input class="inp" id="mTag" value="' + nextPanelTag() + '">') +
      fRow('Name', '<input class="inp" id="mName" value="Control panel">') +
      fRow('Type', '<select class="sel" id="mType">' + opts(types, 'other', function (v) { return LS.PANEL_TYPES[v].name; }) + '</select>') +
      fRow('Connected kW', '<span class="unit"><input class="inp" type="number" id="mKw" value="15" step="0.5"><span class="u">kW</span></span>') +
      fRow('Phases', '<select class="sel" id="mPh"><option>3</option><option>1</option><option>2</option></select>') +
      fRow('Feeder core', '<span class="unit"><input class="inp" type="number" id="mCsa" list="dlCsa" placeholder="suggest" step="0.5"><span class="u">mm²</span></span>') +
      fRow('Board', '<select class="sel" id="mBoard"><option value="">auto-assign</option>' +
        S.pdps.map(function (p) { return '<option value="' + p.id + '"' + (pdpId === p.id ? ' selected' : '') + '>' + esc(p.tag) + '</option>'; }).join('') + '</select>') +
      fRow('Sub-board', '<select class="sel" id="mDb"' + (subs.length ? '' : ' disabled') + '><option value="">— fed from the PDP —</option>' +
        subs.map(function (b) { return '<option value="' + b.id + '"' + (dbId === b.id ? ' selected' : '') + '>' + esc(b.tag) + ' · ' + b.incomerA + ' A</option>'; }).join('') + '</select>') +
      '</div>' +
      '<div class="hint" style="margin-top:10px">The board is chosen automatically: nearest transformer → the board with the most headroom, fewest circuits and the shortest run. If nothing has headroom, a new PDP is created at the next practical grid reference. Auto-assign always lands the circuit on the PDP — a sub-board is a deliberate choice.</div>',
      [{ label: 'Add', cls: 'primary', fn: function () {
          var t = el('mType').value;
          var ph = el('mPh').value;
          /* a sub-board belongs to a PDP: if the two disagree, the sub-board wins and
             the circuit follows it */
          var sub = el('mDb') && el('mDb').value ? LC.get(S, 'db', el('mDb').value) : null;
          var chosen = el('mBoard').value || pdpId || null;
          var p = LS.newPanel({ tag: el('mTag').value, name: el('mName').value, type: t, kw: num(el('mKw').value), phases: ph, pos: pos,
            pdpId: sub ? sub.pdpId : chosen, dbId: sub ? sub.id : null, autoAssign: false });
          p.__kind = 'panel';
          if (el('mCsa').value) p.cable.csa = num(el('mCsa').value);
          S.panels.push(p);
          /* a circuit placed on a sub-board by hand is not auto-assigned */
          var log = sub ? { created: null } : LC.assignPanel(S, p, { offset: num(offset(), 2), clear: num(clearance(), 1.5) });
          autoLen(p);
          renumber();
          sel = { id: p.id, kind: 'panel' };
          var b = LC.get(S, 'pdp', p.pdpId);
          toast(log.created ? ('No headroom → new board ' + log.created.tag + ' created at E' + log.created.pos.x.toFixed(1) + ' N' + log.created.pos.y.toFixed(1))
                            : (esc(p.tag) + ' assigned to ' + esc(sub ? sub.tag : (b ? b.tag : '?'))), 'good');
          commit(true);
        } },
       { label: 'Cancel' }]);
  }
  function modal(title, body, buttons) {
    var m = el('modal');
    el('modalH').innerHTML = '<span>' + title + '</span><button class="mini" id="mX">✕</button>';
    el('modalB').innerHTML = body;
    el('modalF').innerHTML = '';
    (buttons || [{ label: 'Close' }]).forEach(function (b, i) {
      var btn2e = document.createElement('button');
      btn2e.className = 'btn ' + (b.cls || '');
      btn2e.textContent = b.label;
      btn2e.onclick = function () { if (b.fn) b.fn(); if (b.keepOpen !== true) closeModal(); };
      el('modalF').appendChild(btn2e);
    });
    el('mX').onclick = closeModal;
    m.hidden = false;
  }
  function closeModal() { el('modal').hidden = true; }
  /* site extent and the rules used when a new board has to be placed */
  function siteModal() {
    modal('Site and board placement',
      '<div class="two" style="max-width:560px">' +
      fRow('Site width', '<span class="unit"><input class="inp" type="number" id="mSiteW" value="' + S.site.w + '" step="1" min="5"><span class="u">m</span></span>') +
      fRow('Site height', '<span class="unit"><input class="inp" type="number" id="mSiteH" value="' + S.site.h + '" step="1" min="5"><span class="u">m</span></span>') +
      fRow('New board offset', '<span class="unit"><input class="inp" type="number" id="mOffset" value="' + offset() + '" step="0.5" min="0.5"><span class="u">m</span></span>') +
      fRow('Min clearance', '<span class="unit"><input class="inp" type="number" id="mClear" value="' + clearance() + '" step="0.25" min="0"><span class="u">m</span></span>') +
      fRow('Grid snap', '<select class="sel" id="mSnap">' + [0.25, 0.5, 1, 2, 5].map(function (v) {
        return '<option value="' + v + '"' + (snap() === v ? ' selected' : '') + '>' + v + ' m</option>'; }).join('') + '</select>') +
      '</div>' +
      '<div class="hint" style="margin-top:10px">The <b>offset</b> is the radial step used when the tool searches for the next practical grid reference for a new board. The search walks outward in the eight practical directions, keeps the <b>clearance</b> from every other footprint, stays inside the site, and lands on a whole snap step. If the site is too crowded for that, it falls back to the nearest free cell anywhere on the grid.</div>',
      [{ label: 'Apply', cls: 'primary', fn: function () {
          S.site.w = Math.max(5, num(el('mSiteW').value, S.site.w));
          S.site.h = Math.max(5, num(el('mSiteH').value, S.site.h));
          S.place.offset = Math.max(0.5, num(el('mOffset').value, 2));
          S.place.clearance = Math.max(0, num(el('mClear').value, 1.5));
          S.place.snap = num(el('mSnap').value, 1);
          el('snap').value = String(S.place.snap);
          save(); PLAN.fit();
        } },
       { label: 'Cancel' }]);
  }

  /* ------------------------------------------------------------- plan glue */
  function snap() { return num(el('snap').value, 1); }
  function offset() { return num(S.place && S.place.offset, 2); }
  function clearance() { return num(S.place && S.place.clearance, 1.5); }
  function syncToolbar() {
    el('snap').value = String(S.place && S.place.snap ? S.place.snap : 1);
    el('projName').value = S.name;
    syncUndoUi();
  }
  /* On open: place anything unassigned, tie feeder lengths to the drawn
     geometry and fill in blank cable sizes. Existing assignments are never
     shuffled — re-balancing is an explicit action (Auto-balance button),
     because moving circuits is a design decision, not a side effect. */
  function afterLoad() {
    var added = 0, made = [];
    S.panels.forEach(function (pn) {
      /* a circuit already fed off a main board is placed on purpose — it is
         one way on the MSB and must not be swept onto a distribution board */
      if (!pn.pdpId && !pn.pdbId) {
        var log = LC.assignPanel(S, pn, { offset: num(offset(), 2), clear: num(clearance(), 1.5) });
        added++;
        if (log.created) made.push(log.created.tag);
      }
    });
    /* A project that came from a switchgear schedule has its devices already
       on the circuits but nothing on the boards. Completing that is the same
       work init() does on a restored project, so it is not repeated here. */
    /* afterLoad only runs on a project the engineer has just asked for — the
       built-in sample, the Sample button, or an explicit import — so filling an
       empty protection schedule outright is right here. */
    var filled = fillProtection(true);
    S.panels.forEach(autoLen);
    S.pdps.forEach(autoLen);
    S.pdbs.forEach(autoLen);
    LC.sizeAll(S);
    renumber(true);
    var bits = [];
    if (added) bits.push(added + ' unassigned panel(s) placed' + (made.length ? ' — new board(s) ' + made.join(', ') + ' created' : ''));
    if (filled) bits.push(filled + ' protective device(s) filled in');
    var msg = bits.length ? bits.join(' · ') : 'Schedule ready';
    toast(msg + ' · press <b>Auto-balance</b> to level the boards', (added || filled) ? 'good' : '');
    commit(true);
  }

  /* ------------------------------------------------------------- exporting */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvRow(a) { return a.map(csvCell).join(','); }
  /* ==================================================== CSV import ========
     Reading someone else's load schedule.

     The hard part of any spreadsheet import is not parsing — CSV is a small
     format and js/csv.js does that — it is working out which column is which.
     Every vendor names them differently and several of them name three
     different things "Rating".

     So nothing is guessed. The file is parsed, every column is matched against
     a list of known aliases, and the result is shown with a dropdown per
     column so the mapping can be corrected before anything is imported. A
     column the importer cannot place is reported rather than dropped, because
     a silently ignored column is a silently wrong schedule.
     */
  var csvMap = null;      // the mapping for the file currently loaded
  var csvParsed = null;

  /* Which fields the importer needs to produce a usable circuit. Missing any
     of these is not fatal — a schedule with no load is still a schedule of
     reserved circuits — but they are what the preview is judged on. */
  var CSV_REQUIRED = ['tag', 'kw'];

  function openCsvFile(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var text = String(r.result);
        csvParsed = CSVC.parse(text);
        csvMap = detectCsvShape(csvParsed, file.name);
        csvDialog(file.name);
      } catch (err) {
        toast('Could not read that file: ' + err.message, 'bad');
      }
    };
    r.onerror = function () { toast('Could not read that file', 'bad'); };
    /* Latin-1 is read as UTF-8 by default and a byte-order mark is stripped by
       the parser, but an accented character in a description would otherwise
       come through as mojibake. Nothing is lost by decoding as UTF-8 first
       and falling back only if it does not decode. */
    r.readAsText(file, 'utf-8');
  }

  /* Find the header row and map it.

     A load schedule exported from a spreadsheet often has the client's name
     and project title in the first rows before the column headings, so the
     header is not always row zero. It is found as the first row that has more
     populated cells than the one after it and is not a title — the test that
     distinguishes a heading from the data beneath it. */
  function detectCsvShape(parsed, fileName) {
    var rows = parsed.rows;
    var headerAt = -1;
    if (CSVC.looksLikeAppExport(rows.map(function (r) { return r.join(parsed.delim); }).join('\n'))) {
      /* the app's own export: skip the two preamble rows and the section label */
      for (var i = 0; i < Math.min(rows.length, 20); i++) {
        if (/^"?LOAD SCHEDULE"?$/i.test(String(rows[i][0] || '').trim())) {
          headerAt = CSVC.headerAfter(rows, i + 1, 8);
          break;
        }
      }
    }
    if (headerAt < 0) {
      /* Not a table from row one. Score each of the first 20 rows on how many
         populated cells it has relative to the rows after it, and take the
         best — a heading row is full where the title rows are not. */
      var best = 0, bestScore = -1;
      for (var h = 0; h < Math.min(rows.length - 1, 20); h++) {
        var r = rows[h];
        if (!r || r.length < 2) continue;
        var here = r.filter(function (c) { return c !== ''; }).length;
        if (here < 2) continue;
        var next = rows[h + 1].filter(function (c) { return c !== ''; }).length;
        /* a header has more populated cells than the row under it */
        var score = here - next * 0.5;
        /* and it is text, not figures. A data row is as wide as its header and
           scores the same on width alone, so the figures have to be what
           separates them — weighted enough to beat any plausible difference in
           filled cells, because picking a data row as the header produces a
           schedule with no columns at all. */
        var numeric = r.filter(function (c) { return c !== '' && CSVC.num(c) !== null; }).length;
        score -= numeric * 1.5;
        if (score > bestScore) { bestScore = score; best = h; }
      }
      headerAt = best;
    }

    var headers = rows[headerAt] || [];
    var mapped = CSVC.mapHeaders(headers);
    return {
      fileName: fileName, rows: rows, headerAt: headerAt, headers: headers,
      map: mapped, delim: parsed.delim,
      /* anything the mapping did not claim, so the dialog can name it */
      unmapped: mapped.filter(function (m) { return !m.field; })
    };
  }

  /* One dropdown per column. Every column is offered every field, so a
     deliberately unmapped column can be set back to "ignore" — that is the
     difference between correcting the importer and being stuck with it. */
  function mappingTable(m) {
    var mapped = m.map;
    /* The current choice has to be marked selected, not merely present as an
       option — a select with no selected option shows the first one, so every
       column would read "ignore" and the dialog would tell the user their
       mapping had been thrown away. */
    function optsFor(field) {
      return ['<option value=""' + (field ? '' : ' selected') + '>— ignore —</option>'].concat(
        LC_CSV_FIELDS.map(function (f) {
          return '<option value="' + f[0] + '"' + (field === f[0] ? ' selected' : '') + '>' + f[0] + '</option>';
        })
      ).join('');
    }
    return '<table class="csvmap"><thead><tr><th>Column in the file</th><th>First values</th><th>Read as</th><th>How</th></tr></thead><tbody>' +
      mapped.map(function (c) {
        var sample = [];
        for (var r = m.headerAt + 1; r < m.rows.length && sample.length < 3; r++) {
          var v = m.rows[r][c.index];
          if (v !== undefined && v !== '' && !CSVC.isSummaryRow(m.rows[r], m.map)) sample.push(v);
        }
        var how = c.field ? (c.how === 'exact' ? 'exact' : c.how === 'alias' ? 'known name' : c.how === 'fuzzy' ? 'close' : '') : '';
        /* A column with no match is shown in the warning colour, because it is
           the one most likely to be a field that is being silently dropped. */
        return '<tr class="' + (c.field ? '' : 'unmapped') + '">' +
          '<td class="mono">' + esc(c.header || '(column ' + (c.index + 1) + ')') + '</td>' +
          '<td class="mono dim">' + esc(sample.join(' · ').slice(0, 60)) + '</td>' +
          '<td><select class="sel" data-mapidx="' + c.index + '">' + optsFor(c.field) + '</select></td>' +
          '<td class="dim">' + how + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* The field list, built once from the importer's own table so the dropdowns
     cannot drift from what it can actually read. */
  var LC_CSV_FIELDS = CSVC.FIELDS;

  /* Read the mapping straight off the current project so a value can be
     computed for every circuit without going through the app's own panel
     factory — the importer sets fields itself. */
  function previewRows(m, limit) {
    var idx = {};
    m.map.forEach(function (c) { if (c.field && idx[c.field] === undefined) idx[c.field] = c.index; });
    var out = [], skipped = 0;
    for (var r = m.headerAt + 1; r < m.rows.length; r++) {
      var row = m.rows[r];
      if (CSVC.isSummaryRow(row, m.map)) { skipped++; continue; }
      var rec = readRow(row, idx);
      if (rec) out.push(rec);
      if (out.length >= (limit || 8)) break;
    }
    return { rows: out, skipped: skipped, total: countImportable(m.rows, m) };
  }

  function countImportable(rows, m) {
    var n = 0;
    for (var r = m.headerAt + 1; r < rows.length; r++) {
      if (!CSVC.isSummaryRow(rows[r], m.map)) n++;
    }
    return n;
  }

  /* One spreadsheet row as an object keyed by field name. This is the only
     place a cell becomes a number, so a wrong mapping shows up here and
     nowhere else. */
  function readRow(row, idx) {
    function g(f) { return idx[f] === undefined ? '' : (row[idx[f]] || ''); }
    var kw = CSVC.num(g('kw'));
    var tag = String(g('tag') || '').trim();
    var desc = String(g('description') || '').trim();
    if (!kw && !desc && !tag) return null;
    return {
      tag: tag, board: String(g('board') || '').trim(),
      description: desc || tag,
      type: String(g('type') || '').trim(),
      kw: kw, kva: CSVC.num(g('kva')), pf: CSVC.num(g('pf')),
      demand: CSVC.num(g('demand')),
      phases: CSVC.phases(g('phases')), volt: CSVC.volt(g('volt')),
      prot: CSVC.device(g('prot')), start: CSVC.start(g('start')),
      neutral: CSVC.neutral(g('neutral')),
      harmonicType: CSVC.harmonicType(g('harmonicType')) || '',
      triplen: CSVC.num(g('triplen')),
      imbalance: CSVC.num(g('imbalance')),
      loadTorque: CSVC.loadTorque(g('loadTorque')),
      simultaneousStart: CSVC.num(g('simultaneousStart')),
      csa: CSVC.num(g('csa')), runs: CSVC.num(g('runs')), cores: CSVC.num(g('cores')),
      /* A cable cell may carry its own run count, which has to win over the
         single-run default or the feeder comes in four times too small. */
      cablePair: CSVC.runsAndCsa(g('csa')),
      len: CSVC.num(g('len')), method: CSVC.method(g('method')),
      ref: String(g('ref') || '').trim(),
      pos: CSVC.pos(g('easting'), g('northing'), g('grid'))
    };
  }

  /* Trailing empty cells. The CSV is read back by position, so a short row shifts
     every value after it — and the round-trip test is the only thing that catches
     that, which is why the subtotals are padded rather than trimmed. */
  function blank(n) { var a = []; for (var i = 0; i < n; i++) a.push(''); return a; }

  function csvDialog(fileName) {
    var m = csvMap;
    var prev = previewRows(m, 8);
    var missing = CSV_REQUIRED.filter(function (f) {
      return !m.map.some(function (c) { return c.field === f; });
    });

    var body =
      '<div class="hint" style="margin-bottom:10px">' +
        'Read <b>' + esc(fileName) + '</b> — ' + m.rows.length + ' rows, ' + m.headers.length + ' columns, ' +
        'delimiter <span class="mono">' + esc(m.delim === '\t' ? 'tab' : m.delim) + '</span>' +
        (CSVC.looksLikeAppExport ? '' : '') + ', header on row ' + (m.headerAt + 1) + '. ' +
        '<b>' + prev.total + '</b> row' + (prev.total === 1 ? '' : 's') + ' look like circuits' +
        (prev.skipped ? ', ' + prev.skipped + ' skipped as headings or totals' : '') + '.' +
      '</div>' +
      (missing.length
        ? '<div class="audit-item" style="margin-bottom:10px"><div class="lv"><span class="badge warn">CHECK</span></div>' +
          '<div class="audit-body"><div class="t">No column mapped to ' + missing.join(' or ') + '</div>' +
          '<div class="d">Without a reference every circuit will be given a placeholder tag, and without a load the schedule will be empty. ' +
          'Pick the right column below if the file has one.</div></div></div>'
        : '') +
      (m.unmapped.length
        ? '<div class="hint" style="margin-bottom:8px"><b>' + m.unmapped.length + ' column' +
          (m.unmapped.length === 1 ? '' : 's') + ' not recognised:</b> ' +
          esc(m.unmapped.map(function (c) { return c.header || '(unnamed)'; }).join(', ')) +
          '. They will be ignored unless mapped below.</div>'
        : '') +
      '<div class="csvscroll">' + mappingTable(m) + '</div>' +
      '<h5 style="margin:12px 0 6px">How the first rows will be read</h5>' +
      '<table class="csvmap"><thead><tr><th>Reference</th><th>Board</th><th>Description</th><th>kW</th><th>kVA</th><th>Ph</th><th>V</th><th>Device</th><th>Cable</th></tr></thead><tbody>' +
      prev.rows.map(function (r) {
        return '<tr><td class="mono">' + esc(r.tag || '—') + '</td>' +
          '<td class="mono">' + esc(r.board || '—') + '</td>' +
          '<td>' + esc(r.description || '—') + '</td>' +
          '<td class="mono">' + (r.kw === null ? '—' : r.kw) + '</td>' +
          '<td class="mono">' + (r.kva === null ? '—' : r.kva) + '</td>' +
          '<td class="mono">' + esc(r.phases || '—') + '</td>' +
          '<td class="mono">' + (r.volt === null ? '—' : r.volt) + '</td>' +
          '<td class="mono">' + esc(r.prot ? (r.prot.kind + ' ' + (r.prot.ir || '') + ' ' + (r.prot.trip || '') + (r.prot.icu || '')).trim() : '—') + '</td>' +
          '<td class="mono">' + (r.csa === null ? '—'
            : (r.cablePair ? r.cablePair.runs + '×' : (r.runs > 1 ? r.runs + '×' : '')) + r.csa + 'mm²') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      (prev.rows.length === 0 ? '<div class="empty">Nothing readable yet — map a column to <b>kW</b> or <b>Description</b> and the preview fills in.</div>' : '');

    modal('Import load schedule — ' + fileName, body, [
      { label: 'Cancel' },
      { label: 'Replace project', cls: '', fn: function () { runCsvImport(true); } },
      { label: 'Add to project', cls: 'primary', fn: function () { runCsvImport(false); } }
    ]);

    /* Every change re-runs the preview, so the effect of a mapping decision is
       visible before it is committed. */
    el('modalB').addEventListener('change', function (e) {
      var i = e.target.dataset.mapidx;
      if (i === undefined) return;
      var c = csvMap.map[+i];
      c.field = e.target.value || null;
      c.how = e.target.value ? 'manual' : null;
      closeModal(); csvDialog(fileName);
    });
  }

  /* Turn the mapped rows into a project.

     `replace` starts from an empty project, which is what importing a whole
     vendor schedule normally means. Otherwise the circuits are added to what
     is already there — useful when a new area's schedule arrives separately. */
  function runCsvImport(replace) {
    var m = csvMap;
    var idx = {};
    m.map.forEach(function (c) { if (c.field && idx[c.field] === undefined) idx[c.field] = c.index; });

    pushUndo('import ' + m.fileName);

    if (replace) {
      S = LS.newProject({ name: m.fileName.replace(/\.(csv|txt)$/i, '') });
      S.dbs = [];
    }
    if (!S.txs.length) {
      /* a schedule with no supply still needs somewhere to hang, or every
         circuit lands as unassigned and the totals read zero */
      S.txs.push(LS.newTx({ tag: 'TX-1', name: 'Supply 1', kva: 1000, num: nextTxNumber(), pos: { x: 4, y: 8 } }));
      S.pdbs.push(LS.newPdb({ tag: 'PDB', name: 'Main LV board', txId: S.txs[0].id, pos: { x: 12, y: 8 } }));
    }

    var made = { boards: 0, boardNames: [], circuits: 0, skipped: 0, unassigned: 0 };
    var boardCache = {};

    for (var r = m.headerAt + 1; r < m.rows.length; r++) {
      var row = m.rows[r];
      if (CSVC.isSummaryRow(row, m.map)) { made.skipped++; continue; }
      var rec = readRow(row, idx);
      if (!rec) { made.skipped++; continue; }
      var board = resolveBoard(rec.board, boardCache);
      if (!board) { made.unassigned++; continue; }
      /* The cache is keyed inside resolveBoard, so a board is created once however
         many rows name it. This line only counts them for the toast. */
      if (board.created) {
        /* count distinct, not rows — resolveBoard marks `created` on every
           row that names a new board, because the cache hit carries the flag */
        if (made.boardNames.indexOf(rec.board) < 0) { made.boardNames.push(rec.board); made.boards++; }
      }

      var pn = LS.newPanel({
        tag: rec.tag || ('C' + (made.circuits + 1)), name: rec.description,
        type: matchPanelType(rec.type, rec.description),
        kw: rec.kw || 0, kva: rec.kva || null, pf: rec.pf || 0.9,
        demand: rec.demand || 1, volt: rec.volt || 400,
        phases: rec.phases || '3', start: rec.start || 'DOL',
        neutral: rec.neutral === undefined ? null : rec.neutral,
        harmonicType: rec.harmonicType || '',
        triplen: rec.triplen === undefined ? null : rec.triplen,
        imbalance: rec.imbalance || null,
        loadTorque: rec.loadTorque || '',
        simultaneousStart: rec.simultaneousStart || null,
        ref: rec.ref || '', pdbId: null, pdpId: null, dbId: null
      });
      pn.__kind = 'panel';
      /* The feeder position comes from the plan, not from a grid reference that
         a spreadsheet column may or may not have; the board's own placement is
         searched for a free cell either way. */
      pn.pos = rec.pos || { x: 0, y: 0 };
      if (rec.csa) {
        var pair = rec.cablePair;
        pn.cable = {
          csa: pair ? pair.csa : rec.csa,
          runs: pair ? pair.runs : (rec.runs || 1),
          cores: rec.cores || (rec.phases === '1' ? 3 : 4),
          len: rec.len || 0, method: rec.method || 'XL-A1',
          group: 1, ambient: num(S.design.ambientC, 40), sheathed: true
        };
      } else {
        /* The factory's placeholder cable carries no size but does carry a run
           count of null, which reads as a cable of an unknown size rather than
           as no cable. A blank column means the size is still to be decided,
           and the audit should say so in those words. */
        pn.cable = { csa: null, runs: 1, cores: rec.cores || 4, len: rec.len || 0,
                     method: rec.method || 'XL-A1', group: 1,
                     ambient: num(S.design.ambientC, 40), sheathed: true };
      }
      if (rec.prot && !rec.prot.unparsed) {
        pn.prot = LS.newProt({
          kind: rec.prot.kind || 'mcb', ir: rec.prot.ir || null,
          frame: rec.prot.frame || rec.prot.ir || null, icu: rec.prot.icu || null,
          trip: rec.prot.trip || (rec.prot.kind === 'mcb' ? 'C' : 'TM'),
          poles: rec.prot.poles || (rec.phases === '1' ? 2 : 4),
          notes: 'From ' + m.fileName + ': ' + rec.prot.raw
        });
      } else {
        pn.prot = null;
      }
      /* A board named PDB… is a main board, DB… a sub-board, anything else a
         distribution board. The prefix is the only signal available in a bare
         column of names, so it is used and the result stays editable.

         A circuit on a sub-board keeps its PDP as well. That is how the app
         models the chain everywhere else — a board and its sub-boards are both
         downstream of the same PDP — and leaving it out here would make every
         imported circuit read as unassigned in the totals and the audit. */
      pn.pdbId = board.kind === 'pdb' ? board.o.id : null;
      pn.pdpId = board.kind === 'pdp' ? board.o.id
        : board.kind === 'db' ? ((LC.get(S, 'pdp', board.o.pdpId) || {}).id || null)
        : null;
      pn.dbId = board.kind === 'db' ? board.o.id : null;
      pn.pos = nextFreePosFor(pn, board.o);
      S.panels.push(pn);
      made.circuits++;
    }

    /* Numbering last, so every board exists before the tags are derived. */
    renumber(true);
    /* A circuit placed by position rather than by the auto-assigner still needs
       its feeder length measured, or the cable schedule reads zero. */
    autoLenForAll();
    sel = null;
    PLAN.setProject(S);
    syncToolbar();
    commit(true);

    var msg = 'Imported ' + made.circuits + ' circuit' + (made.circuits === 1 ? '' : 's');
    if (made.boards) msg += ', ' + made.boards + ' board' + (made.boards === 1 ? '' : 's') + ' created';
    if (made.skipped) msg += ' · ' + made.skipped + ' rows skipped';
    if (made.unassigned) msg += ' · ' + made.unassigned + ' had no board';
    toast(msg, made.circuits ? 'good' : 'bad');
  }

  /* Find the board a row names, creating it if this is the first time it has
     been seen. Matching is by tag first and then by name, because the column
     may hold either depending on who wrote the file. */
  function resolveBoard(name, cache) {
    var key = String(name || '').trim();
    if (!key) return null;
    /* What a name resolves to: { kind, o, created }. The same shape whether the
     board already existed or was just created, because the caller uses
     `kind` and `o` on every row and a cache hit has to be interchangeable
     with a miss. Returning the raw board from one path and a wrapper from the
     other means the second row naming a new board reads `board.o` as
     undefined and places the circuit nowhere. */
    if (cache[key]) return cache[key];
    var found = LC.boardList(S).filter(function (b) {
      return (b.o.tag || '').toLowerCase() === key.toLowerCase() ||
             (b.o.name || '').toLowerCase() === key.toLowerCase();
    })[0];
    if (found) { cache[key] = { kind: found.kind, o: found.o, created: false }; return cache[key]; }

    var kind = /^PDB\b/i.test(key) ? 'pdb' : /^DB\b/i.test(key) ? 'db' : 'pdp';
    var entry;
    if (kind === 'db') {
      var hostpdp = LC.boardList(S).filter(function (b) { return b.kind === 'pdp'; })[0];
      if (!hostpdp) return null;
      var db = LS.newDb({ tag: key, name: key, pdpId: hostpdp.o.id, pos: nextBoardPos() });
      S.dbs.push(db);
      entry = { kind: 'db', o: db, created: true };
    } else {
      var pdb = LC.boardList(S).filter(function (b) { return b.kind === 'pdb'; })[0];
      if (!pdb) return null;
      var b2 = kind === 'pdb'
        ? LS.newPdb({ tag: key, name: key, txId: pdb.o.txId, pos: nextBoardPos() })
        : LS.newPdp({ tag: key, name: key, pdbId: pdb.o.id, pos: nextBoardPos() });
      if (kind === 'pdb') S.pdbs.push(b2); else S.pdps.push(b2);
      entry = { kind: kind, o: b2, created: true };
    }
    cache[key] = entry;
    return entry;
  }

  /* A free cell beside its board, on the snap grid, respecting the clearance
     from every other footprint. nextPracticalPos is the same search the
     auto-assigner uses, so imported circuits land where the app's own would. */
  function nextBoardPos() {
    return LC.nextPracticalPos(S, {
      anchor: (S.pdbs[0] || S.pdps[0] || S.txs[0]).pos,
      offset: num(offset(), 2), clear: num(clearance(), 1.5),
      w: LS.SHAPE.pdp.w, h: LS.SHAPE.pdp.h, step: num(snap(), 1),
      exclude: null
    });
  }
  function nextFreePosFor(pn, board) {
    /* No `exclude`, for the reason given at addPanelAt: the board's own cell is
       occupied, not available for the circuit being placed on it. */
    return LC.nextPracticalPos(S, {
      anchor: board.pos, offset: 3, clear: num(clearance(), 1.5),
      w: LS.SHAPE.panel.w, h: LS.SHAPE.panel.h, step: num(snap(), 1)
    });
  }

  /* A load type that matches what the spreadsheet said, or one that matches
     the description. Anything unrecognised is left as a plain load rather than
     forced into a category that would put the wrong phases or power factor on
     it. */
  function matchPanelType(said, description) {
    if (said) {
      var k = String(said).toLowerCase().trim();
      var t = Object.keys(LS.PANEL_TYPES).filter(function (name) {
        return name.toLowerCase() === k || LS.PANEL_TYPES[name].name.toLowerCase() === k;
      })[0];
      if (t) return t;
    }
    var d = String(description || '').toLowerCase();
    var guess = Object.keys(LS.PANEL_TYPES).filter(function (name) {
      return d.indexOf(LS.PANEL_TYPES[name].name.toLowerCase()) >= 0;
    })[0];
    return guess || null;
  }

  function autoLenForAll() {
    S.panels.forEach(function (pn) { if (!pn.cable) return; autoLen(pn); });
  }

  /* The earth fault columns for a schedule row: PE size, loop impedance, the
     current that loop will carry, and the required and achieved disconnection
     times side by side. The achieved one is the column an inspector reads, and
     it is only meaningful next to the required one. */
  function loopOf(pn, kind) {
    var e = LC.earthFaultCheck(S, pn, kind);
    if (!e || e.needs) return ['', '', '', '', ''];
    return [
      e.loop.peCsa || '',
      e.loop.total.toFixed(3),
      e.ia.toFixed(0),
      e.tMax.toFixed(2),
      e.tActual === null ? '' : e.tActual.toFixed(3)
    ];
  }

  function exportCsv() {
    var L = [];
    L.push(csvRow([S.name])); L.push(csvRow(['Client', S.client, 'Project', S.ref, 'Designer', S.designer, 'Date', S.date]));
    L.push('');
    L.push(csvRow(['LOAD SCHEDULE']));
    L.push(csvRow(['Reference', 'Board', 'Board description', 'Description', 'Type', 'Connected kW', 'Design kVA', 'kvar', 'pf', 'Demand', 'Phases', 'Voltage V', 'Current A', 'Non-linear load', 'THD %', '3rd harmonic %', 'Neutral carried', 'Imbalance %', 'PE in cable', 'Protective device', 'Device frame A', 'Breaking capacity kA', 'Trip unit', 'Feeder runs', 'Feeder mm2', 'Cores', 'Length m', 'Installation', 'Rated A', 'Utilisation %', 'Volt drop %', 'PE mm2', 'R1+R2 ohm', 'Loop A', 'Max t s', 'Actual t s', 'Motor', 'Starting method', 'Starting source', 'Load torque', 'Starting together', 'Full load A', 'Starting A', 'All together A', 'Board at start V', 'Dip %', 'Torque at start', 'Grid ref E', 'Grid ref N', 'Status']));
    var un = [];
    /* One row per circuit, wherever it is fed from. Declared up here because
       the main-board circuits are written before the distribution boards. */
    function row(pn, board) {
      var dm = LC.panelDemand(S, pn);
      var cab = pn.cable && pn.cable.csa ? LC.cableRating(pn.cable) : null;
      var vd = cab ? LC.voltDrop(pn.cable, dm.amp, dm.pf, pn.phases, pn.volt) : null;
      var cu = cab ? (dm.amp / cab.derated) * 100 : '';
      var stt = (dm.amp <= (cab ? cab.derated : 0)) && (vd ? vd.pct <= num(S.design.vdropLimitLv, 3) : true) ? 'OK' : 'CHECK';
      var pr = pn.prot || null;
      /* Six starting columns, or six blanks — never a short row, because the CSV
         parser reads by position and a missing field shifts everything after it. */
      var st6 = ['', '', '', '', '', ''];
      if (LC.isMotorLoad(pn)) {
        var sr = LC.startingCheck(S, pn, 'panel');
        if (sr && !sr.noRating) st6 = [sr.sc.flc.toFixed(0), sr.sc.amps.toFixed(0),
          sr.sc.group > 1 ? sr.sc.combined.toFixed(0) : '',
          sr.dip.motorV.toFixed(0), sr.dip.pct.toFixed(1), sr.dip.torqueAvail.toFixed(2)];
      }
      L.push(csvRow([pn.tag, board.tag, board.name, pn.name, LS.PANEL_TYPES[pn.type] ? LS.PANEL_TYPES[pn.type].name : pn.type,
        dm.kw.toFixed(1), dm.kva.toFixed(1), dm.kvar.toFixed(1), dm.pf, pn.demand, pn.phases, pn.volt, dm.ampHarm.toFixed(1),
        LC.isThreePhaseWithNeutral(pn) || pn.harmonicType ? (LS.HARMONIC_SPECTRUMS[pn.harmonicType] || {}).name || '' : '',
        pn.thd === null || pn.thd === undefined || pn.thd === '' ? '' : pn.thd,
        pn.triplen === null || pn.triplen === undefined || pn.triplen === '' ? '' : pn.triplen,
        LC.isThreePhaseWithNeutral(pn) ? 'yes' : (String(pn.phases) === '3' ? 'no (three-pole)' : 'n/a (single-phase)'),
        pn.imbalance === null || pn.imbalance === undefined || pn.imbalance === '' ? '' : pn.imbalance,
        pn.peInCable === true ? 'yes' : (pn.peInCable === false ? 'no' : 'not stated'),
        pr ? (pr.kind === 'mcb' ? 'MCB' : 'MCCB') : '',
        pr && num(pr.ir, 0) ? num(pr.ir) : '',
        pr && num(pr.frame, 0) ? num(pr.frame) : '',
        pr && num(pr.icu, 0) ? num(pr.icu) : '',
        pr && pr.trip ? pr.trip : '',
        cab ? cab.runs : '', cab ? cab.csa : '', pn.cable.cores, pn.cable.len, cab ? cab.method.name : pn.cable.method,
        cab ? cab.derated.toFixed(0) : '', cu === '' ? '' : cu.toFixed(0), vd ? vd.pct.toFixed(2) : '',
        loopOf(pn, 'panel'),
        /* Starting. Empty for anything the model does not apply to, so the column
           is never a guess — and the source column says whether a stated method
           came off a sheet or out of a machine name. */
        LC.isMotorLoad(pn) ? 'yes' : '',
        LC.isMotorLoad(pn) ? (pn.start || 'not stated') : '',
        LC.isMotorLoad(pn) ? (pn.startInferred ? 'inferred from name' : (pn.start ? 'declared' : '')) : '',
        pn.loadTorque || '',
        pn.simultaneousStart || '',
        st6[0], st6[1], st6[2], st6[3], st6[4], st6[5],
        pn.pos.x, pn.pos.y, stt]));
    }
    /* Circuits fed straight off a main board come first — they are one way on
       the MSB, above the distribution boards in the chain. */
    S.pdbs.forEach(function (b) {
      var here = LC.panelsOnPdb(S, b.id);
      if (!here.length) return;
      L.push(csvRow([b.tag + ' — circuits fed directly from this main board', b.tag, b.name]));
      here.forEach(function (pn) { row(pn, b); });
      var sb = LC.boardStats(S, b, 'pdb');
      L.push(csvRow([b.tag + ' DIRECT SUBTOTAL', b.tag, b.name, '', '', '', sb.kw.toFixed(1), sb.kva.toFixed(1), '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''] + blank(9)));
    });
    S.pdps.forEach(function (d) {
      var list = LC.panelsOf(S, d.id);
      /* sub-boards first, then the circuits fed straight off the PDP */
      LC.dbOfPdp(S, d.id).forEach(function (b) {
        L.push(csvRow([b.tag + ' — sub-distribution board', b.tag, b.name, (b.enclosure || '') + ' ' + b.incomerA + ' A'] + blank(40)));
        LC.panelsOnDb(S, b.id).forEach(function (pn) { row(pn, b); });
        var sb = LC.boardStats(S, b, 'db');
        L.push(csvRow([b.tag + ' SUBTOTAL', b.tag, b.name, '', '', '', '', sb.kw.toFixed(1), sb.kva.toFixed(1), '', '', '', '', sb.amp.toFixed(1), '', '', '', '', '', b.incomerA + ' A incomer', '', '', '', '', sb.util.toFixed(0) + '%'] + blank(14)));
      });
      list.filter(function (pn) { return !pn.dbId || !LC.get(S, 'db', pn.dbId); }).forEach(function (pn) { row(pn, d); });
      var sd = LC.boardStats(S, d, 'pdp');
      L.push(csvRow([d.tag + ' SUBTOTAL', d.tag, d.name, '', '', '', '', sd.kw.toFixed(1), sd.kva.toFixed(1), '', '', '', '', sd.amp.toFixed(1), '', '', '', '', '', d.incomerA + ' A incomer', '', '', '', '', sd.util.toFixed(0) + '%'] + blank(14)));
    });
    S.panels.forEach(function (pn) { if (!pn.pdpId && !pn.pdbId) un.push(pn); });
    if (un.length) {
      L.push(''); L.push(csvRow(['UNASSIGNED CONTROL PANELS']));
      un.forEach(function (pn) { L.push(csvRow([pn.tag, '', '', pn.name, '', pn.kw, LC.panelDemand(S, pn).kva.toFixed(1), '', '', pn.phases, pn.volt, '', '', '', '', '', '', '', '', '', '', pn.pos.x, pn.pos.y, 'NO BOARD'])); });
    }
    L.push('');
    L.push(csvRow(['BOARD SCHEDULE']));
    L.push(csvRow(['Board', 'Equipment ref', 'Description', 'Fed from', 'Rating', 'Incomer A', 'Protective device', 'Breaking capacity kA', 'Busbar A', 'Load A', 'Utilisation %', 'Circuits', 'Ways', 'Spare ways', 'Imbalance %', 'kVA', 'Fault kA', 'Grid ref']));
    LC.boardList(S).forEach(function (r) {
      var o = r.o;
      var u = r.kind === 'tx' ? (r.st.kva / Math.max(1, num(o.kva, 1)) * 100) : r.st.util;
      var parent = r.kind === 'pdb' ? ((LC.get(S, 'tx', o.txId) || {}).tag || '')
        : r.kind === 'pdp' ? ((LC.get(S, 'pdb', o.pdbId) || {}).tag || '')
        : r.kind === 'db' ? ((LC.get(S, 'pdp', o.pdpId) || {}).tag || '') : '';
      L.push(csvRow([o.tag, o.ref || '', o.name || '', parent, r.kind === 'tx' ? o.kva + ' kVA' : (o.incomerA + ' A'), r.kind === 'tx' ? '' : o.incomerA,
        protCell(o), o.prot && num(o.prot.icu, 0) ? num(o.prot.icu) : '', o.busbarA || '',
        r.st.amp.toFixed(1), u.toFixed(1), r.st.panels.length,
        r.kind === 'pdp' || r.kind === 'db' ? (r.st.ways === null ? '' : r.st.ways) : '',
        r.kind === 'pdp' ? o.spareWays : '', r.st.dev.toFixed(1), r.st.kva.toFixed(1),
        r.st.faultKA ? r.st.faultKA.toFixed(2) : '', 'E' + o.pos.x + ' N' + o.pos.y]));
    });
    L.push('');
    L.push(csvRow(['CABLE / VOLT DROP SCHEDULE']));
    L.push(csvRow(['From', 'To', 'Circuit', 'Runs', 'mm2', 'Cores', 'Length m', 'Installation', 'Grouped', 'Ambient C', 'Base A', 'Derated A', 'Load A', 'Utilisation %', 'Drop V', 'Drop %', 'PE mm2', 'R1+R2 ohm', 'Loop A', 'Max t ms', 'Actual t ms', 'Verdict']));
    var feeds = [];
    S.dbs.forEach(function (b) { var pdp2 = LC.get(S, 'pdp', b.pdpId); feeds.push([pdp2 ? pdp2.tag : '', b.tag, 'PDP to sub-board', b, LC.boardStats(S, b, 'db').amp, 0.9, b.phases, 400]); });
    S.pdps.forEach(function (d) { var pdb = LC.get(S, 'pdb', d.pdbId); feeds.push([pdb ? pdb.tag : '', d.tag, 'PDB to PDP', d, LC.boardStats(S, d, 'pdp').amp, 0.9, d.phases, 400]); });
    S.pdbs.forEach(function (b) { var tx = LC.get(S, 'tx', b.txId); feeds.push([tx ? tx.tag : '', b.tag, 'TX to PDB', b, LC.boardStats(S, b, 'pdb').amp, 0.9, b.phases, 400]); });
    S.panels.forEach(function (pn) {
      var up = (pn.dbId && LC.get(S, 'db', pn.dbId)) || LC.get(S, 'pdp', pn.pdpId);
      var d = LC.panelDemand(S, pn);
      feeds.push([up ? up.tag : '', pn.tag, up && up.__kind === 'db' ? 'Sub-board to panel' : 'PDP to panel', pn, d.amp, d.pf, pn.phases, pn.volt]);
    });
    feeds.forEach(function (f) {
      var cab = f[3].cable && f[3].cable.csa ? LC.cableRating(f[3].cable) : null;
      var vd = cab ? LC.voltDrop(f[3].cable, f[4], f[5], f[6], f[7]) : null;
      var efc = LC.earthFaultCheck(S, f[3], f[6] === 400 && f[2].indexOf('to panel') >= 0 ? 'panel' : 'pdp');
      L.push(csvRow([f[0], f[1], f[2], cab ? cab.runs : '', cab ? cab.csa : '', f[3].cable.cores, f[3].cable.len, cab ? cab.method.name : f[3].cable.method, f[3].cable.group, f[3].cable.ambient,
        cab ? cab.base : '', cab ? cab.derated.toFixed(1) : '', f[4].toFixed(1), cab ? ((f[4] / cab.derated) * 100).toFixed(0) : '',
        vd ? vd.volts.toFixed(2) : '', vd ? vd.pct.toFixed(2) : '',
        efc && !efc.needs ? (efc.loop.peCsa || '') : '',
        efc && !efc.needs ? efc.loop.total.toFixed(3) : '',
        efc && !efc.needs ? efc.ia.toFixed(0) : '',
        efc && !efc.needs ? (efc.tMax * 1000).toFixed(0) : '',
        efc && !efc.needs && efc.tActual !== null ? (efc.tActual * 1000).toFixed(0) : '',
        !cab ? 'no cable'
          : efc && efc.unachievable ? 'DEVICE TOO SLOW'
          : efc && !efc.pass ? 'LOOP TOO HIGH'
          : f[4] > cab.derated ? 'UNDERSIZED'
          : vd.pct > num(S.design.vdropLimitLv, 3) ? 'VOLT DROP'
          : 'OK']));
    });
    L.push('');
    L.push(csvRow(['DESIGN WARNINGS']));
    LC.audit(S).forEach(function (i) { L.push(csvRow([i.level.toUpperCase(), i.scope, i.title, i.detail])); });
    download('load-schedule.csv', L.join('\n'), 'text/csv');
  }
  function download(name, content, mime) {
    var b = new Blob([content], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  function exportJson() {
    var data = serialise();
    download((S.name || 'project').replace(/[^\w\-]+/g, '_') + '.json', JSON.stringify(data, null, 2), 'application/json');
    var note = data.underlay ? ' (including the site map geometry)' : '';
    toast('Project exported' + note, 'good');
  }

  /* --------------------------------------------------------------- printing */
  function printReport() {
    var host = document.createElement('div');
    host.id = 'printReport';
    host.className = 'print-only';
    var issues = LC.audit(S);
    var h = '<h1 class="pt">' + esc(S.name) + ' — load schedule</h1>' +
      '<div class="psub">' + esc(S.client) + ' · project ' + esc(S.ref) + ' · ' + esc(S.designer) + ' · ' + esc(S.date) +
      ' · design margin ' + S.design.designMargin + '× · volt drop limit ' + S.design.vdropLimitLv + '% · imbalance limit ' + S.design.imbalanceBad + '%</div>';
    var t = LC.totals(S);
    h += '<p style="font-size:12px">Connected <b>' + t.kw.toFixed(0) + ' kW</b> · design <b>' + t.kva.toFixed(0) + ' kVA</b> · installed ' + t.txKva + ' kVA (' + t.txUtil.toFixed(0) + '%) · ' +
      S.pdps.length + ' distribution boards · ' + S.panels.length + ' circuits · site phase imbalance ' + t.dev.toFixed(0) + '%</p>';
    h += '<h2 style="font-size:13px;margin:12px 0 4px">1 · Single line diagram</h2>' + viewSld();
    h += '<h2 style="font-size:13px;margin:12px 0 4px">2 · Board schedule</h2>' + viewBoards();
    h += '<h2 style="font-size:13px;margin:12px 0 4px">3 · Load schedule</h2>' + viewLoads();
    h += '<h2 style="font-size:13px;margin:12px 0 4px">4 · Cable and volt drop schedule</h2>' + viewCables();
    h += '<h2 style="font-size:13px;margin:12px 0 4px">5 · Design warnings</h2>' + viewAudit();
    h += '<h2 style="font-size:13px;margin:12px 0 4px">6 · Basis and limitations</h2>' + viewNotes();
    host.innerHTML = h;
    document.body.appendChild(host);
    /* form controls do not print their values — swap them for text */
    host.querySelectorAll('input, select, textarea').forEach(function (n) {
      var v = n.tagName === 'SELECT' ? (n.options[n.selectedIndex] || {}).text : n.value;
      var span = document.createElement('span');
      span.textContent = v === undefined || v === null || v === '' ? '—' : v;
      n.parentNode.replaceChild(span, n);
    });
    host.querySelectorAll('.toolbar-inline').forEach(function (n) { n.remove(); });
    host.querySelectorAll('.tabs,.drawer').forEach(function (n) { n.remove(); });
    window.print();
    setTimeout(function () { host.remove(); }, 800);
  }

  /* ------------------------------------------------------------------ wiring */
  function wire() {
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t.dataset || !t.dataset.bind) return;
      applyField(t);
      commit(false);
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.bind) { applyField(t); commit(false); return; }
      if (t.id === 'snap') { S.place.snap = num(t.value, 1); save(); PLAN.draw(); }
      if (t.id === 'projName') { S.name = t.value; save(); renderTabs(); }
    });
    document.getElementById('projName').addEventListener('input', function (e) { S.name = e.target.value; save(); });

    /* selection from tree, tables, audit list */
    document.addEventListener('click', function (e) {
      /* the inline "+…" buttons live inside a selectable row, so they have
         to be matched before the row itself */
      /* the fold handle sits inside the row, so it is matched before the row itself */
      var foldBtn = e.target.closest ? e.target.closest('[data-fold]') : null;
      if (foldBtn) {
        var fid = foldBtn.getAttribute('data-fold');
        /* shift-click on a transformer opens everything below it at once */
        if (e.shiftKey && foldBtn.getAttribute('data-kind') === 'tx') {
          var t = LC.get(S, 'tx', fid);
          if (t) revealAll(t);
          return;
        }
        toggleNode(fid);
        return;
      }
      var addpn = e.target.closest ? e.target.closest('[data-add-panel]') : null;
      if (addpn) {
        /* the button may sit on a main board, a sub-board or a distribution
           board. Each needs its own idea of what "fed from" means. */
        var mainHost = LC.get(S, 'pdb', addpn.dataset.addPanel);
        if (mainHost) { addPanelOnPdb(mainHost); return; }
        var host = LC.get(S, 'db', addpn.dataset.addPanel) || LC.get(S, 'pdp', addpn.dataset.addPanel);
        addPanelAt(host, addpn.dataset.addDbParent || null);
        return;
      }
      var adddb = e.target.closest ? e.target.closest('[data-add-db]') : null;
      if (adddb) {
        var pdpForDb = LC.get(S, 'pdp', adddb.dataset.addDb);
        addDb(LC.nextPracticalPos(S, { anchor: pdpForDb.pos, offset: num(offset(), 2), w: LS.SHAPE.db.w, h: LS.SHAPE.db.h, step: num(snap(), 1), exclude: pdpForDb }), pdpForDb.id);
        return;
      }
      var addp2 = e.target.closest ? e.target.closest('[data-add-pdp]') : null;
      if (addp2) { var b = LC.get(S, 'pdb', addp2.dataset.addPdp); addPdp(LC.nextPracticalPos(S, { anchor: b.pos, offset: num(offset(), 2), w: LS.SHAPE.pdp.w, h: LS.SHAPE.pdp.h, step: num(snap(), 1), exclude: b }), b.id); return; }
      var addp = e.target.closest ? e.target.closest('[data-add-pdb]') : null;
      if (addp) {
        var t = LC.get(S, 'tx', addp.dataset.addPdb);
        addPdb(LC.nextPracticalPos(S, { anchor: t.pos, offset: num(offset(), 2), w: LS.SHAPE.pdb.w, h: LS.SHAPE.pdb.h, step: num(snap(), 1), exclude: t }), t.id);
        return;
      }
      var a = e.target.closest ? e.target.closest('[data-select]') : null;
      if (a) { select(a.dataset.select, a.dataset.kind); return; }
      var tr = e.target.closest ? e.target.closest('[data-tree]') : null;
      if (tr) {
        var mode = tr.getAttribute('data-tree');
        if (mode === 'depth') foldToDepth(num(tr.getAttribute('data-depth'), 1));
        else treeOpen(mode);
        return;
      }
      var ad = e.target.closest ? e.target.closest('[data-add]') : null;
      if (ad) {
        var p = { x: S.site.w / 2, y: S.site.h / 2 };
        if (ad.dataset.add === 'tx') addTx(p);
        if (ad.dataset.add === 'pdb') addPdb(p);
        if (ad.dataset.add === 'pdp') addPdp(p);
        return;
      }
      var pm = e.target.closest ? e.target.closest('[data-mode]') : null;
      if (pm) { setMode(pm.dataset.mode); return; }
      var vt = e.target.closest ? e.target.closest('[data-view]') : null;
      if (vt) { vt.classList.toggle('on'); PLAN.toggleView(vt.dataset.view, vt.classList.contains('on')); PLAN.draw(); return; }
      var tabb = e.target.closest ? e.target.closest('.tab') : null;
      if (tabb) {
        tab = tabb.dataset.tab;
        Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) { t.classList.toggle('on', t === tabb); });
        renderTab(); return;
      }
      var act = e.target.closest ? e.target.closest('[data-act]') : null;
      if (act) { propAction(act.dataset.act, act.dataset.id); return; }
      var gl = e.target.closest ? e.target.closest('[data-global]') : null;
      if (gl) { globalAction(gl.dataset.global); return; }
    });

    el('btnFit').onclick = function () { PLAN.fit(); };
    el('btnSite').onclick = siteModal;
    /* resizable drawer: drag the top edge to trade schedule space for plan */
    (function () {
      var grip = el('drawerGrip'), drawer = el('drawer');
      var dragging = false, startY = 0, startH = 0;
      grip.addEventListener('mousedown', function (e) {
        dragging = true; startY = e.clientY; startH = drawer.offsetHeight;
        e.preventDefault();
        document.body.style.userSelect = 'none';
      });
      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var h = startH - (e.clientY - startY);
        h = Math.max(90, Math.min(window.innerHeight - 220, h));
        drawer.style.height = h + 'px';
        PLAN.relayout();
      });
      window.addEventListener('mouseup', function () {
        if (!dragging) return;
        dragging = false;
        document.body.style.userSelect = '';
        PLAN.relayout();
      });
      grip.addEventListener('dblclick', function () {
        drawer.style.height = (drawer.offsetHeight > 160 ? 90 : 270) + 'px';
        PLAN.relayout();
      });
    })();
    el('btnMoreView').onclick = function () {
      var u = S.underlay;
      modal('Plan display',
        '<div class="two" style="max-width:420px">' +
        fRow('Grid references', '<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:11.5px">' +
          '<input type="checkbox" id="vGridref"' + (PLAN.view('gridref') ? ' checked' : '') + '> show a grid reference on every board</label>') +
        fRow('Imbalance flags', '<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:11.5px">' +
          '<input type="checkbox" id="vImb"' + (PLAN.view('imbalance') ? ' checked' : '') + '> outline boards whose phases are unbalanced</label>') +
        fRow('Drawing text', '<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:11.5px">' +
          '<input type="checkbox" id="vText"' + (PLAN.view('allText') ? ' checked' : '') + '> always show room names from the drawing</label>') +
        '</div>' +
        (u && u.kind === 'dxf'
          ? '<div class="hint" style="margin-top:10px">Drawing text is shown automatically when zoomed in far enough for it to be legible. ' +
            'Tick the box to show it at every zoom level.</div>'
          : ''),
        [{ label: 'Apply', cls: 'primary', fn: function () {
            PLAN.toggleView('gridref', el('vGridref').checked);
            PLAN.toggleView('imbalance', el('vImb').checked);
            PLAN.toggleView('allText', el('vText').checked);
            PLAN.draw();
          } },
         { label: 'Cancel' }]);
    };
    el('btnMap').onclick = function () { el('fileMap').click(); };
    el('btnMapFit').onclick = mapFit;
    el('btnMapClear').onclick = mapClear;
    el('btnMapOpts').onclick = function () { tab = 'map'; syncTabs(); renderTab(); el('tabContent').scrollTop = 0; };
    el('fileMap').onchange = function (e) {
      var f = e.target.files[0];
      loadMapFile(f);
      e.target.value = '';
    };
    /* drop a drawing straight onto the plan */
    var wrapEl = el('canvasWrap');
    ['dragenter', 'dragover'].forEach(function (t) {
      wrapEl.addEventListener(t, function (e) {
        e.preventDefault(); e.stopPropagation();
        wrapEl.classList.add('dropping');
      });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      wrapEl.addEventListener(t, function (e) {
        e.preventDefault(); e.stopPropagation();
        wrapEl.classList.remove('dropping');
      });
    });
    wrapEl.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (!dt) return;
      var f = dt.files && dt.files[0];
      if (f) loadMapFile(f);
    });
    el('btnZoomIn').onclick = function () { PLAN.zoomAt(200, 200, 1.25); };
    el('btnZoomOut').onclick = function () { PLAN.zoomAt(200, 200, 1 / 1.25); };
    el('btnRebalance').onclick = function () { globalAction('balance'); };
    el('btnRebalanceTx').onclick = function () { globalAction('balance-tx'); };
    el('btnUndo').onclick = function () { doUndo(); };
    el('btnRedo').onclick = function () { doRedo(); };
    el('btnAudit').onclick = function () { tab = 'audit'; syncTabs(); renderTab(); toast(LC.audit(S).length + ' design checks evaluated', ''); };
    el('btnProtect').onclick = function () { globalAction('protect'); };
    el('btnCsv').onclick = exportCsv;
    el('btnJson').onclick = exportJson;
    el('btnPrint').onclick = printReport;
    el('btnSample').onclick = function () {
      if (S.txs.length && !confirm('Replace the current project with the worked example?')) return;
      S = LS.sampleProject(); bootstrap(S); localStorage.removeItem(store);
      fillProtection(true);        // the example arrives with its protection set
      PLAN.setProject(S); syncToolbar(); afterLoad();
    };
    el('btnClear').onclick = function () {
      if (!confirm('Clear everything and start a new project?')) return;
      S = LS.newProject({ name: 'New project' }); bootstrap(S); localStorage.removeItem(store);
      PLAN.setProject(S); sel = null; syncToolbar(); commit(true); toast('New project — add a transformer to begin', '');
    };
    el('btnImport').onclick = function () { el('fileJson').click(); };
    el('btnImportCsv').onclick = function () { el('fileCsv').click(); };
    el('fileCsv').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      openCsvFile(f);
      e.target.value = '';
    };
    el('fileJson').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var p = JSON.parse(r.result);
          S = LS.newProject(p); bootstrap(S);
          PLAN.setProject(S); sel = null; syncToolbar(); afterLoad();
          var extra = (S.underlay && S.underlay.kind) ? ' — site map: ' + S.underlay.name : '';
          toast('Imported ' + (p.name || 'project') + extra, 'good');
        } catch (err) { toast('Could not read that file: ' + err.message, 'bad'); }
      };
      r.readAsText(f);
      e.target.value = '';
    };
    document.addEventListener('keydown', function (e) {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      /* Ctrl+Z / Ctrl+Shift+Z. Held for the whole app rather than per-panel so
         it works wherever the focus happens to be. */
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); doRedo(); return; }
      if (e.key === 'Escape') { setMode('none'); closeModal(); sel = null; commit(true); }
      if (e.key === 'f' || e.key === 'F') PLAN.fit();
      if (e.key === '1') setMode('panel');
      if (e.key === '2') setMode('pdp');
      if (e.key === '3') setMode('pdb');
      if (e.key === '4') setMode('tx');
    });
  }
  function setMode(m) {
    PLAN.setPlaceMode(m);
    Array.prototype.forEach.call(document.querySelectorAll('#placeModes .seg-btn'), function (b) { b.classList.toggle('on', b.dataset.mode === m); });
    el('planHint').innerHTML = m === 'none'
      ? 'Drag to pan · wheel to zoom · drag a board to move it (grid snap on) · Esc cancels'
      : 'Click a grid reference to place the ' + ({ panel: 'control panel', pdp: 'PDP', pdb: 'PDB', tx: 'transformer' })[m] + ' · Esc to cancel';
  }
  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) { t.classList.toggle('on', t.dataset.tab === tab); });
  }
  function select(id, kind) {
    sel = id ? { id: id, kind: kind } : null;
    /* picking a board that is hidden behind a folded parent is not useful, so
       open the path down to it */
    if (sel) revealPath(id);
    commit(true);
  }
  /* Open every ancestor of an item so it is actually visible in the tree. */
  function revealPath(id) {
    var changed = false;
    var cur = LC.get(S, 'tx', id) || LC.get(S, 'pdb', id) || LC.get(S, 'pdp', id) || LC.get(S, 'db', id) || LC.get(S, 'panel', id);
    var guard = 0;
    while (cur && guard++ < 8) {
      if (cur.__kind === 'panel') {
        /* a circuit sitting on a sub-board needs its own board opened too */
        var sdb = cur.dbId ? LC.get(S, 'db', cur.dbId) : null;
        if (sdb && collapsed[sdb.id]) { delete collapsed[sdb.id]; changed = true; }
        var pdp = LC.get(S, 'pdp', cur.pdpId);
        if (!pdp) break;
        if (collapsed[pdp.id]) { delete collapsed[pdp.id]; changed = true; }
        cur = pdp;
        continue;
      }
      var up = LC.parentOf(S, cur, cur.__kind);
      if (!up || !up.id) break;
      if (collapsed[up.id]) { delete collapsed[up.id]; changed = true; }
      cur = LC.get(S, up.kind, up.id);
    }
    if (changed) saveTree();
  }
  function globalAction(a) {
    if (a === 'csv') return exportCsv();
    if (a === 'print') return printReport();
    if (a === 'sldfit') { sldFit = true; fitSld(); return; }
    if (a === 'sldin') return sldZoomBy(1.25);
    if (a === 'sldout') return sldZoomBy(1 / 1.25);
    if (a === 'sldlegend') return sldLegend();
    if (a === 'mapfit') return mapFit();
    if (a === 'mapclear') return mapClear();
    if (a === 'mapcal') return mapCalibrate();
    if (a === 'auditgroup') { auditGrouped = !auditGrouped; renderTab(); return; }
    if (a === 'protect') return proposeAllProt();
    if (a === 'protect-keep') return proposeAllProt(true);
    if (a === 'balance' || a === 'balance-tx') {
      var cross = a === 'balance-tx';
      /* this is the button that can re-home circuits right across the
         installation, so it is the one that most needs to be undoable */
      pushUndo(cross ? 're-balance across main boards' : 're-balance boards');
      var mv = LC.autoBalance(S, { crossPdb: cross, allowLongRuns: cross, tolerance: 12 });
      renumber(true);   // circuits moved board, so their references change
      toast(mv.length ? mv.length + ' circuit(s) re-assigned' + (cross ? ' across main boards' : '') + ': ' + mv.map(function (m) { return m.panel + ' ' + m.from + '→' + m.to; }).slice(0, 4).join(', ') + (mv.length > 4 ? '…' : '')
        : (cross ? 'Boards and transformers already balanced within 12%' : 'Boards already balanced within 12% (use ↔ Balance across TX to move circuits between main boards)'), mv.length ? 'good' : '');
      return commit(false);
    }
    if (a === 'autocables') {
      pushUndo('re-size all cables');
      /* lengths follow the drawn geometry, then every core is re-suggested */
      S.panels.forEach(autoLen); S.dbs.forEach(autoLen); S.pdps.forEach(autoLen); S.pdbs.forEach(autoLen);
      S.panels.forEach(function (pn) {
        var d = LC.panelDemand(S, pn);
        var s = LC.suggestCable(d.amp, num(pn.cable.len, 10) || 10, d.pf, pn.phases, pn.volt, pn.cable.method, S);
        pn.cable.csa = s.csa; pn.cable.runs = s.runs;
      });
      /* a board's feeder carries everything downstream of it, including its
         sub-boards, so the two are sized from the same load */
      ['db', 'pdp'].forEach(function (kind) {
        (kind === 'db' ? S.dbs : S.pdps).forEach(function (d) {
          if (!d.cable) return;
          var stt = LC.boardStats(S, d, kind);
          var s2 = LC.suggestCable(stt.amp, num(d.cable.len, 5) || 5, 0.9, d.phases, 400, d.cable.method, S);
          d.cable.csa = s2.csa; d.cable.runs = s2.runs;
        });
      });
      S.pdbs.forEach(function (b) {
        if (!b.cable) return;
        var stt2 = LC.boardStats(S, b, 'pdb');
        var s3 = LC.suggestCable(stt2.amp, num(b.cable.len, 8) || 8, 0.9, b.phases, 400, b.cable.method, S);
        b.cable.csa = s3.csa; b.cable.runs = s3.runs;
      });
      toast('All feeder sizes suggested from load, length and the ' + S.design.vdropLimitLv + '% drop limit', 'good');
      return commit(false);
    }
    if (a === 'autosizeall') {
      pushUndo('re-size all incomers');
      S.pdps.forEach(function (d) {
        var stt = LC.boardStats(S, d, 'pdp');
        var inc = LC.suggestIncomer(stt.amp || 160, num(S.design.designMargin, 1.15));
        d.incomerA = inc; d.busbarA = inc;
        if (d.cable && !d.cable.csa) LC.sizeCablesFor(S, d);
      });
      S.pdbs.forEach(function (b) {
        var stt2 = LC.boardStats(S, b, 'pdb');
        b.incomerA = LC.suggestIncomer(stt2.amp || 250, num(S.design.pdbMargin, 1.1));
        b.busbarA = b.incomerA;
        if (b.cable && !b.cable.csa) LC.sizeCablesForPdb(S, b);
      });
      toast('Incomers re-sized with the design margin applied', 'good');
      return commit(false);
    }
  }

  /* ------------------------------------------------------------ site map */
  function mapFit() {
    var u = S.underlay;
    if (!u) { toast('No site map loaded', 'bad'); return; }
    UNDERLAY.fit(S, u);
    commit(false);
    toast('Drawing fitted to the ' + S.site.w + ' × ' + S.site.h + ' m site', 'good');
  }
  function mapClear() {
    if (!S.underlay) return;
    if (!confirm('Remove “' + S.underlay.name + '” from the plan? The electrical design is not affected.')) return;
    if (S.underlay.dataUrl) { try { URL.revokeObjectURL(S.underlay.dataUrl); } catch (e) {} }
    S.underlay = null;
    tab = 'loads';
    commit(true);
    toast('Site map removed');
  }
  /* Set the drawing scale from a distance the user measures on the plan. */
  function mapCalibrate() {
    var u = S.underlay;
    if (!u) { toast('No site map loaded', 'bad'); return; }
    var g = u.geo || {};
    var duW = g.width || u.w, duH = g.height || u.h;
    modal('Set the drawing scale',
      '<div class="hint" style="margin-bottom:10px">Measure a distance you know on the plan — a building length, a grid bay, ' +
      'a car park bay — then type its real length. The drawing is rescaled so the two agree.</div>' +
      '<div class="two" style="max-width:520px">' +
      fRow('Measured across', '<select class="sel" id="calAxis"><option value="w">the drawing width</option><option value="h">the drawing height</option></select>') +
      fRow('That distance is', '<span class="unit"><input class="inp" type="number" id="calReal" value="10" step="0.01" min="0.01"><span class="u">m</span></span>') +
      fRow('Drawing extent', '<span class="mono" id="calDu" style="font-size:12px">' + duW.toFixed(2) + ' units wide</span>') +
      '</div>' +
      '<div class="hint" style="margin-top:10px">New scale: <b id="calNew">—</b> m per drawing unit' +
      (g.metresPerUnit ? ' (the drawing is in ' + esc(g.unitName) + ', which implies ' + g.metresPerUnit + ')' : '') + '.</div>',
      [{ label: 'Apply', cls: 'primary', fn: function () {
          var real = parseFloat(el('calReal').value);
          if (!isFinite(real) || real <= 0) { toast('Enter a real-world length', 'bad'); return; }
          var du = el('calAxis').value === 'h' ? duH : duW;
          if (!du) { toast('Drawing has no measurable extent', 'bad'); return; }
          u.scale = real / du;
          UNDERLAY.fit(S, u);
          commit(false);
          toast('Scale set to ' + u.scale.toPrecision(4) + ' m per unit', 'good');
        } },
       { label: 'Cancel' }]);
  }
  function loadMapFile(file) {
    if (!file) return;
    toast('Reading ' + file.name + '…');
    UNDERLAY.load(file).then(function (u) {
      var rep = UNDERLAY.attach(S, u);
      tab = 'map';
      commit(true);
      var msg = '<b>' + esc(rep.name) + '</b> — ' + esc(rep.size) +
        (rep.layers !== undefined ? ', ' + rep.layers + ' layers, ' + rep.drawn + ' entities' : '');
      toast(msg + '. ' + (rep.note || ''), 'good');
      if (rep.warnings && rep.warnings.length) {
        setTimeout(function () { toast(rep.warnings[0], ''); }, 3600);
      }
    }).catch(function (err) {
      if (err && err.code === 'DWG_UNSUPPORTED') {
        modal('DWG files cannot be read here', '<p>' + esc(err.message).replace(/\n/g, '</p><p>') + '</p>');
      } else {
        toast('Could not load “' + file.name + '”: ' + (err && err.message ? err.message : 'unknown error'), 'bad');
      }
    });
  }

  /* ------------------------------------------------------ public to plan.js */
  var App = {
    sel: function () { return sel; },
    select: select,
    place: function (mode, x, y) {
      var pos = { x: LS.r2(LS.snapTo(x, snap())), y: LS.r2(LS.snapTo(y, snap())) };
      if (mode === 'panel') return panelModal(pos);
      if (mode === 'tx') return addTx(pos);
      if (mode === 'pdb') return addPdb(pos);
      if (mode === 'pdp') return addPdp(pos);
    },
    moved: function (item, orig, preview) {
      if (preview && preview.bumped) toast('Occupied cell — settled at the next practical reference E' + item.pos.x.toFixed(1) + ' N' + item.pos.y.toFixed(1), '');
      /* `orig` is where the drag started. The current position is already the moved
         one by the time this is called, so the snapshot has the original
         coordinates written back into it — otherwise undo would put the item
         exactly where it already is and appear to do nothing. */
      if (orig) {
        try {
          var snap = serialise();
          /* find this item in the snapshot and put its old position back */
          ['txs', 'pdbs', 'pdps', 'dbs', 'panels'].forEach(function (k) {
            (snap[k] || []).forEach(function (o) {
              if (o.id === item.id) { o.pos = { x: orig.x, y: orig.y }; }
            });
          });
          undoPending = { label: 'move ' + (item.tag || 'item'), key: 'move:' + item.id, at: Date.now(), state: JSON.stringify(snap) };
        } catch (e2) { undoPending = null; }
      }
      if (item.__kind === 'panel') { item.autoAssign = onMoved(item); return; }
      autoLen(item);
      commit(false);
    },
    readout: function (x, y, tag) {
      if (x === null || x === undefined) { el('planReadout').textContent = ''; return; }
      var s = 'E ' + x.toFixed(2) + '  N ' + y.toFixed(2);
      /* when a drawing is loaded, also give the coordinate in drawing units
         so a position read off the plan can be matched in the CAD file */
      var inv = LC.underlayInverse(S);
      if (inv) {
        var gx = inv.siteToGeoX(x), gy = inv.siteToGeoY(y);
        if (isFinite(gx) && isFinite(gy)) {
          s += '   ·   ' + (S.underlay.kind === 'dxf' ? S.underlay.geo.unitName : 'px') +
               ' ' + gx.toFixed(1) + ', ' + gy.toFixed(1);
        }
      }
      if (tag) s += '   ·   ' + tag;
      el('planReadout').textContent = s;
    },
    snap: snap, offset: offset, clearance: clearance,
    quickEdit: function (h) { select(h.id, h.kind); }
  };
  /* The CSV importer's front half, exposed so the round trip can be tested
     without going through a file input and a download dialog. The import
     itself stays behind the UI, because it is a decision the user makes from a
     dialog — but "which row is the header, and what does this column mean" is
     a pure function of the file and is worth testing directly. */
  App.csvProbe = function (text, fileName) {
    var parsed = CSVC.parse(text);
    var shape = detectCsvShape(parsed, fileName || 'probe.csv');
    var prev = previewRows(shape, 200);
    return {
      delim: parsed.delim,
      rows: parsed.rows.length,
      headerAt: shape.headerAt,
      headerRow: shape.headerAt + 1,
      headers: shape.headers,
      map: shape.map,
      unmapped: shape.unmapped.map(function (c) { return c.header; }),
      circuits: prev.total,
      skipped: prev.skipped,
      first: prev.rows.slice(0, 3),
      isAppExport: CSVC.looksLikeAppExport(text)
    };
  };

  window.App = App;
  document.addEventListener('DOMContentLoaded', init);
})();
