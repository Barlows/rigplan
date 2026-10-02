***REMOVED*** Electrical Load Schedule & LV Distribution Plan

An interactive load-scheduling workbench for electrical design. Plan transformers,
main LV boards (PDB) and distribution boards (PDP) on a grid-referenced site plan,
drop control panels anywhere on the plan, and the schedule assigns each one to a
board, sizes its feeder and keeps the loading balanced.

No build step, no dependencies, no server. Open `index.html` in a browser.

```
open index.html          ***REMOVED*** macOS
```

A worked example loads on first open (press **Sample** to reload it). Work is kept
in the browser's local storage, and can be exported/imported as JSON.

---

***REMOVED******REMOVED*** Designing over a real site map

Press **Load…** in the toolbar, or drop a file straight onto the plan.

**Raster images** — PNG, JPEG, WebP, GIF, BMP, AVIF. A scanned site plan or a
georeferenced screenshot works. There is no unit scale in a photo, so set one with
**Set scale by measuring…**: measure a distance you know (a building length, a grid
bay, a car park bay), type its real length, and the drawing is rescaled to agree.

**DXF** — an ASCII DXF is read directly in the browser. Supported entities:

| | |
|---|---|
| Lines | `LINE`, `LWPOLYLINE` (including bulge arcs), `POLYLINE` + `VERTEX`, `SPLINE` |
| Curves | `ARC`, `CIRCLE`, `ELLIPSE` |
| Fills | `SOLID`, `3DFACE` |
| Annotation | `TEXT`, `MTEXT` (formatting codes stripped) |
| Blocks | `INSERT` with scale, rotation and nested inserts |
| Points | `POINT` |

Anything else — `HATCH`, `DIMENSION`, `MLINE`, splines' full NURBS evaluation — is
counted and listed in the map tab rather than silently dropped. Arcs and ellipses are
tessellated from their sagitta, so a drawing with thousands of curves still pans
smoothly.

The unit scale is read from `$INSUNITS`. A millimetre drawing gets 0.001 m per unit
automatically. If the file has no units, set it manually in the map tab.

**DWG is not supported.** It is a closed binary format with no browser-side decoder.
Export a DXF instead — AutoCAD `SAVEAS` → *AutoCAD DXF*, or use ODA File Converter,
QCAD or LibreDWG — and drop that in. Dropping a DWG tells you this rather than
failing quietly.

**Placing the drawing.** It is fitted to the site, keeping its aspect ratio, with a
4% margin. Then:

- **Scale** — metres per drawing unit. This is the number that makes a grid
  reference mean the same thing in both systems.
- **Offset E / N** — shifts the drawing against the site grid.
- **Fit to site** — re-fits and re-centres.
- **Opacity** — drop it back so the boards stay legible on top.
- **Layers** — every layer is listed with a checkbox. Dimension, hatch, frame and
  annotation layers are hidden on load, so a drawing usually arrives readable.

**Checking the alignment.** The map tab shows the site extent expressed in drawing
units, and the coordinate read-out under the plan shows *both* systems at once —
`E 22.00 N 14.00 · millimetres 560.0, 498.5`. Hover a board and you get its position
in the CAD file as well as on the plan.

The map travels with the project: it is saved locally and included in the JSON
export. A large embedded photo is dropped from the saved copy rather than risking
the electrical design, and you are told when that happens.

---

***REMOVED******REMOVED*** Board numbering

The four board tiers carry a reference derived from their place in the supply
hierarchy. Control panels do not:

```
TX7                        transformer
 └ PDB7                    main LV board on that transformer
    └ PDP7-1               distribution board 1 off it
       └ DB7-1-1           sub-distribution board 1 — a 125 A Acti9, say
          ├ MCC-01         control panel fed from that board
          └ AHU-02         another circuit on the same board
       └ DB7-1-2           sub-distribution board 2 off the same PDP
    └ PDP7-2               distribution board 2 → DB7-2-1, DB7-2-2 …
```

**A control panel is a load, not a board.** It keeps whatever reference the
drawing team already uses — `MCC-01`, `AHU-02`, `PLT-01` — which is the name on the
drawing, the label on the enclosure and the row on the schedule. The schedules
show which board each one is fed from, so the hierarchy is still readable without
inventing a number that means nothing on site. `DB7-1-1` is reserved for the
sub-distribution board.

**The four board references are derived, never typed.** A transformer is numbered
from 1 upwards; set its number explicitly if you need to match an existing
drawing (say `7` for an extension supply), and everything below it follows. Adding
a board, deleting one, moving a circuit, or setting a transformer number all
renumber the affected chain and say what changed.

Two cases the pattern does not cover on its own, handled explicitly:

- **A transformer with more than one main board** continues the sequence —
  `PDB7-1`, `PDB7-2` — and the levels below follow that path, so references stay
  unique and readable (`PDP7-1-1`, `DB7-1-1-1`).
- **A board whose supply chain does not resolve** — no parent, or a parent id
  left behind by a merged file — cannot follow the scheme, so it is marked
  `DB?-3`, `PDP?` and so on rather than given a number that would collide. The
  audit reports those separately as unassigned or orphaned.

**Names and descriptions are untouched.** Those carry the engineering meaning —
"Conveyor line 1 panel", "CV-01 / CV-02 / CV-03 drives". The reference is the part
that appears on drawings, schedules and the print report. Where a board already
has a number on your existing drawing set, keep it in the **Equipment ref** field
and the schedules show both.

**Opening an older project migrates it.** A project saved before the convention
existed is renumbered on load, and the references its boards carried are moved into
the Equipment ref field rather than being overwritten, so nothing is lost.

***REMOVED******REMOVED******REMOVED*** The supply hierarchy folds

The tree on the left opens a level at a time: fold it to see only the
transformers, open one to see its main boards, open a main board for the
distribution boards, open one of those for its loads and sub-boards, and open
the sub-board for the circuits on it.

Every board row carries a fold handle (▸ / ▾). A folded row shows how much is
hidden inside it — `4 bds` under a transformer, `7 items` under a distribution
board, `2 loads` under a sub-board — so a collapsed tree is still a summary of the
design rather than a list of two lines.

Three buttons in the panel header: **⊟** fold everything to the transformers,
**⊞** unfold everything, **⇅** invert what is open and what is folded.
**Shift-click** a transformer's handle to open everything below it at once.

Selecting a board or circuit from the plan, a schedule or the audit opens the path
down to it, so it is never selected somewhere you cannot see. The fold state is
remembered between sessions.

---

***REMOVED******REMOVED*** Sub-distribution boards

A sub-distribution board is a **125 A or 250 A** board — an Acti9, Acti9P or
similar — fed from a distribution board and carrying lighting, small power and the
other small final circuits. In design terms it is just another feeder off the PDP,
handled in the same way as a machine main control panel.

**One per distribution board is the usual starting point**, because you would
generally have use for it later. More than one on the same PDP is entirely normal
where a distribution board covers more than one area, and the tool allows it: `+DB`
is offered on every PDP.

**The 63 A limit is on the largest single piece of equipment fed *from* the board**,
not on the board's own rating. Lighting circuits (16 A), 230 V sockets (32 A), an
inspection system (32 A), 400 V sockets (32 A) and general process sockets all
belong on a DB; anything larger is supplied directly from the distribution board.
The audit reports every circuit over the limit, naming the board it should move to.

Sub-boards have their own incomer, ways, enclosure, feeder cable and description
of what they carry. The audit checks overload, circuits against ways, imbalance,
feeder capacity and the 63 A rule. A sub-board feeder is sized for the board's
**rating**, not for the circuits currently on it — a board at 20% now will be full
eventually, and the cable has to serve it when it is.

**Main panels connect directly to the distribution board.** An MCC, a chiller, a
compressor or a boiler has no place on a sub-board, and the sample keeps them on the
PDP where they belong.

Deleting a sub-board returns its circuits to feeding from the distribution board,
which is where they came from. Auto-balance never separates a circuit from the board
it sits on: it moves the whole sub-board or leaves it alone.

Auto-assignment **always lands a circuit on a distribution board**, never on a
sub-board — a 125 A lighting board is a deliberate placement decision, not
something the tool should pick because a board had 30 A of headroom. Once placed
you can move a circuit onto a sub-board in its properties, and the sub-board list
only offers boards on that circuit's own PDP so the two cannot contradict each
other.

Because the main panels sit on the distribution board directly, a distribution
board's spare ways are counted against the circuits that land on it directly —
not the ones its sub-board carries. A board whose lighting board is well used is
not "full" for auto-assignment purposes, because those circuits cannot be moved to
another board without taking the sub-board with them.

A circuit on a sub-board moves **with** it. Auto-balance never separates a circuit
from the board it sits on: it either moves the whole sub-board or leaves it alone.
Deleting a sub-board returns its circuits to feeding from the PDP, which is where
they came from.

Transformers are numbered 1-based and must be unique; pinning one to a number that
is already taken moves it to the lowest free number rather than producing two
identical references.

---

***REMOVED******REMOVED*** The workflow

1. **Set out the supply.** Pick a place mode in the toolbar — `TX`, `PDB` or `PDP` —
   and click the plan. Or add boards from the left-hand hierarchy with the
   `+TX` / `+PDB` / `+PDP` buttons and the inline `+` buttons on each row. `+DB` on
   a PDP adds a sub-distribution board.
2. **Enter the loads.** Switch to `▣ Panel` and click a grid reference. A dialog asks
   for the reference, description, type and kW. The moment you enter that reference,
   the panel is **assigned to a PDP automatically** — you never have to pick the board.
   Leave the sub-board field on "fed from the PDP" unless you mean to place it on one.
3. **If a board runs out of headroom**, a new PDP is created beside its parent at the
   **next practical grid reference**, and the circuit goes on the new board.
4. **Check it.** The **Audit** tab lists overloaded boards, undersized feeders,
   excessive volt drop, phase imbalance, ways exceeded and transformer loading.
5. **Issue it.** Export CSV for the schedule, or **Print report** for a full
   A3 landscape document (board schedule, load schedule, cable schedule, warnings
   and the basis of design).

---

***REMOVED******REMOVED*** How assignment works

Every board is scored for the load you are placing it on:

| Factor | Effect |
|---|---|
| Utilisation after the load | Heavily weighted — a board is never overloaded to win a placement |
| Run length | Weighted *against load size*: a small circuit stays on the nearest board, a large one chases headroom |
| Spare ways | A board with no ways left is penalised |
| Crossing a transformer | Penalised, so it only happens when clearly better |
| Distance | When every board is full, the closest one anchors the new board |

**Next practical grid reference.** When a new PDP is needed, the tool walks outward
from the best-placed existing board on the snap grid, in the eight practical
directions (N, NE, E, SE, S, SW, W, NW), at the configured offset. It rejects any
cell that is occupied (respecting the clearance), outside the site, or off-grid.
If the site is too crowded for the ring search, it falls back to the nearest free
cell anywhere on the grid. The new board is sized for the load it takes.

**Phase balance.** Single-phase circuits are allocated to the *lightest* phase of the
board they land on, so they spread across L1, L2 and L3 rather than stacking. The
properties panel marks the lightest phase with `◂`, and the **Phase vectors** view
toggle draws the three phase loads as arrows.

**Moving things.** Drag any board or panel. Positions snap to the grid; if you drop
something on an occupied cell it is nudged to the next clear reference instead of
overlapping. Moving a panel re-runs the assignment if the load no longer fits.

**Balancing boards.** `Balance` levels the loading of the distribution boards feeding
from each main board, and never moves a circuit between main boards.
`Balance ↔ TX` allows that too, because moving a circuit between transformers
changes the supply topology and should be a deliberate act.

---

***REMOVED******REMOVED*** What is calculated

- **Load** — design kVA = connected kW ÷ power factor × demand factor. Current from
  kVA at the board voltage; single-phase circuits use the phase-to-neutral voltage.
- **Board loading** — aggregated up through sub-board → PDP → PDB → transformer, with
  utilisation, headroom, spare ways, per-phase kVA and current, and phase deviation.
  A sub-board reports only the circuits sitting on it; everything rolls up through
  its PDP, so the chain stays additive and no load is counted twice.
- **Cable ampacity** — base values per the IEC 60364-5-52 reference methods
  (A1, A2, B1, C, E, F for PVC and XLPE equivalents), derated for ambient
  temperature, grouping/bunching and 4-core construction, with up to four parallel runs.
- **Volt drop** — using an indicative copper resistance at 70 °C plus 0.08 Ω/km
  reactance, over the straight-line route plus 20%.
- **Cable sizing** — `Suggest cable` / `Size all cables` pick the smallest cable that
  carries the load with the design margin applied and stays inside the volt drop
  limit, preferring a single large cable over a bundle of small ones.
- **Fault level** — indicative only: LV fault MVA = factor × transformer rating,
  stepped down by an assumed impedance per distribution stage.
- **Incomer sizing** — `Auto-size` applies the design margin to the running load and
  rounds up to the next standard rating.

---

***REMOVED******REMOVED*** Layout

| | |
|---|---|
| **Top bar** | Live totals: connected kW, design kVA, installed kVA, TX loading, phase imbalance, warning count |
| **Left** | Supply hierarchy — a foldable tree with per-board utilisation bars and inline add buttons |
| **Centre** | The site plan — grid references, drag to move, zoom, phase vectors, cable colouring by status |
| **Right** | Properties of whatever is selected, with live checks |
| **Bottom** | Load schedule · cable and volt drop schedule · board schedule · single line diagram · audit · design criteria · site map |

**Plan controls** — drag to pan, wheel to zoom, double-click to select, `1`–`4` to
switch place mode, `F` to fit, `Esc` to cancel. `Site…` sets the site extent, the
snap step, the new-board offset and the minimum clearance. `…` next to View toggles
grid references, imbalance outlines and drawing text. Drag the top edge of the bottom
panel to trade schedule space for plan area; double-click it to collapse.

---

***REMOVED******REMOVED*** Files

```
index.html          markup
css/styles.css      theme and print styles
js/data.js          reference data (ampacity tables, correction factors,
                    standard sizes), project model, the worked example
js/calc.js          engineering engine: loading, cable sizing, volt drop,
                    audit, auto-assignment, grid-reference placement,
                    underlay coordinate transforms
js/dxf.js           ASCII DXF reader — group-code parser, entity flattening,
                    arc tessellation, block expansion, layer discovery
js/underlay.js      file loading (image / DXF), DWG detection, placement
js/plan.js          canvas plan: underlay, rendering, hit-testing, drag, zoom
js/sld.js           single line diagram: tree layout and IEC 60617 symbols
js/ui.js            shell: properties, schedules, site map, export, import, print
test/parser-test.html     35 checks against a synthetic DXF with known geometry
test/numbering-test.html  58 checks on the board numbering scheme
test/db-test.html         46 checks on sub-board sizing and the 63 A rule
test/sld-test.html        24 checks on the single line diagram layout and symbols
test/underlay-test.html   image/DXF/DWG loading and scale handling
```

Open a `test/*.html` page in a browser after changing the matching module — each
prints a pass/fail list. If you edit the JavaScript while testing over HTTP and the
browser serves a cached copy, bump the `?v=` query string in `index.html`.

***REMOVED******REMOVED*** Single line diagram

The **Single line diagram** tab draws the whole supply as a schematic, using IEC
60617 symbols: two overlapping circles for a transformer, a filled square for the
incomer protective device, a rectangle with a line through it for a final-circuit
fuse, three decreasing bars for earth, and a plain rectangle for a board. The
**Legend** button shows the key — an SLD without a symbol key is just shapes.

The vertical order is the supply order — utility → transformer → main board →
distribution board → sub-board → control panel — and every branch is labelled with
its protective device, rating and feeder size. A board over 100% of its incomer is
outlined in red, over 85% in amber. Click any item to select it.

Layout is one block per transformer, stacked down the sheet, so the drawing's depth
tracks the number of transformers rather than the number of circuits and stays on a
page. Within a block, circuits fan out sideways and wrap when the row gets too wide.
**Fit** scales the whole drawing to the pane; **+**/**−** zoom in on a branch.

It goes into the print report as its own section, scaled to the page width.

Unassigned circuits are not drawn — they have nothing to hang from. They appear in
the audit as "not assigned to a PDP".

The symbols follow IEC 60617 conventions but the **legend is descriptive, not a
normative reference**. Check the drawing conventions against your own copy of the
standard and your practice's house style before issue.

---

***REMOVED******REMOVED*** Limits — read before using this for real work

This builds and checks a schedule. It is **not** a design certification tool.

- Ampacity and correction-factor values are **indicative**. Confirm them against the
  current edition of BS 7671 / IEC 60364-5-52, the manufacturer's data, and the
  rules that apply locally, before issuing anything.
- The DXF reader is a site-plan underlay, not a CAD system. It flattens the entity
  types listed above and ignores everything else (counted and listed). It does not
  resolve external references (XREFs), OCS/extrusion direction, paperspace, or full
  NURBS curve evaluation. **Coordinates are read one-to-one with the file** — the
  site-to-drawing mapping is a single scale and offset, so the drawing's own
  coordinate system is what the grid references are expressed in. If your site plan is
  georeferenced, convert it to local grid first, or check the alignment with the
  dual-unit read-out before you rely on it.
- A raster image has no scale of its own, so the plan is only as accurate as the
  measurement you use to set it.
- Volt drop uses an indicative cable impedance, not a full impedance and temperature
  calculation.
- **No** protection coordination, discrimination/selectivity, cable thermal withstand
  under fault, short-circuit capacity, RCD discrimination, or cost checks.
- Fault levels are indicative only (see above).
- No diversity is applied between circuits — each panel is loaded at its own demand
  factor. Add demand factors per panel to model diversity.
- Starting currents, inrush, harmonic effects, motor acceleration and generator
  behaviour are flagged as notes but not calculated.
- Cable lengths are straight-line distances plus 20%, not actual routes.
