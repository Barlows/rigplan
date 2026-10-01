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
| **Bottom** | Load schedule · cable and volt drop schedule · board schedule · audit · design criteria |

**Plan controls** — drag to pan, wheel to zoom, double-click to select, `1`–`4` to
switch place mode, `F` to fit, `Esc` to cancel. `Site…` sets the site extent, the
snap step, the new-board offset and the minimum clearance.

---

***REMOVED******REMOVED*** Files

```
index.html          markup
css/styles.css      theme and print styles
js/data.js          reference data (ampacity tables, correction factors,
                    standard sizes), project model, the worked example
js/calc.js          engineering engine: loading, cable sizing, volt drop,
                    audit, auto-assignment, grid-reference placement
js/plan.js          canvas plan: rendering, hit-testing, drag, zoom
js/ui.js            shell: properties, schedules, export, import, print
```

If you edit the JavaScript while testing over HTTP and the browser serves a cached
copy, bump the `?v=` query string in `index.html`.

---

***REMOVED******REMOVED*** Limits — read before using this for real work

This builds and checks a schedule. It is **not** a design certification tool.

- Ampacity and correction-factor values are **indicative**. Confirm them against the
  current edition of BS 7671 / IEC 60364-5-52, the manufacturer's data, and the
  rules that apply locally, before issuing anything.
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
