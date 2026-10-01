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

Every board carries a reference derived from its place in the supply hierarchy:

```
TX7                        transformer
 └ PDB7                    main LV board on that transformer
    └ PDP7-1               distribution board 1 off it
       └ DB7-1-1           control panel 1 off that board
       └ DB7-1-2           control panel 2 off the same board
    └ PDP7-2               distribution board 2 → DB7-2-1, DB7-2-2 …
```

**The reference is derived, never typed.** A transformer is numbered from 1
upwards; set its number explicitly if you need to match an existing drawing (say
`7` for an extension supply), and everything below it follows. Adding a main board,
deleting one, moving a circuit between boards, or re-assigning a load all renumber
the affected chain and say what changed.

Two cases the pattern does not cover on its own, handled explicitly:

- **A transformer with more than one main board** continues the sequence —
  `PDB7-1`, `PDB7-2` — and the levels below follow that path, so references stay
  unique and readable (`PDP7-1-1`, `DB7-1-1-1`).
- **An item with no supply connection** cannot follow the scheme, so it is marked
  `DB?`, `PDP?` and so on rather than being given a number that would collide.
  The audit reports those separately as unassigned or orphaned.

**Names and descriptions are untouched.** Those carry the engineering meaning —
"Conveyor line 1 panel", "CV-01 / CV-02 / CV-03 drives". The reference is the part
that appears on drawings, schedules and the print report. Where you already have
your own panel or MCC number, keep it in the **Equipment ref** field on the
control panel, and the load schedule shows both.

Transformers are numbered 1-based and must be unique; pinning one to a number that
is already taken moves it to the lowest free number rather than producing two
identical references.

---

***REMOVED******REMOVED*** The workflow

1. **Set out the supply.** Pick a place mode in the toolbar — `TX`, `PDB` or `PDP` —
   and click the plan. Or add boards from the left-hand hierarchy with the
   `+TX` / `+PDB` / `+PDP` buttons and the inline `+` buttons on each row.
2. **Enter the loads.** Switch to `▣ Panel` and click a grid reference. A dialog asks
   for the tag, description, type and kW. The moment you enter that reference, the
   panel is **assigned to a PDP automatically** — you never have to pick the board.
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
- **Board loading** — aggregated up through PDP → PDB → transformer, with utilisation,
  headroom, spare ways, per-phase kVA and current, and phase deviation.
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
| **Left** | Supply hierarchy with per-board utilisation bars and inline add buttons |
| **Centre** | The site plan — grid references, drag to move, zoom, phase vectors, cable colouring by status |
| **Right** | Properties of whatever is selected, with live checks |
| **Bottom** | Load schedule · cable and volt drop schedule · board schedule · audit · design criteria · site map |

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
js/ui.js            shell: properties, schedules, site map, export, import, print
test/parser-test.html     35 checks against a synthetic DXF with known geometry
test/numbering-test.html  36 checks on the board numbering scheme
test/underlay-test.html   image/DXF/DWG loading and scale handling
```

Open a `test/*.html` page in a browser after changing the matching module — each
prints a pass/fail list. If you edit the JavaScript while testing over HTTP and the
browser serves a cached copy, bump the `?v=` query string in `index.html`.

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
