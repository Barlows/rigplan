# RigPlan

A wiring-diagram planner for campervans, RVs, boats and off-grid electrical
systems. Draw the system, and every cable, fuse and breaker is sized as you go.

RigPlan is a local-first web app: plain ES modules, no build step, no
dependencies, no account and no server-side storage. Projects live in the
browser's local storage and can be exported as JSON.

```
npm start          # http://127.0.0.1:8137
npm test           # engine regression tests
```

`npm start` runs a small static server (`test/serve.mjs`) with caching disabled.
Any static file server works; there is no compile step.

---

## What it does

### Drawing

- 39-component library: batteries, solar, alternators, MPPTs, DC-DC chargers,
  inverter/chargers, fuse boxes, busbars, switches, shunts, AC panels, RCDs,
  sockets, appliances and grounding.
- Drag-and-drop placement, multi-select, duplicate, delete, undo/redo.
- Terminal-to-terminal cable drawing with polarity awareness. A cable between
  opposite polarities is refused as a short; duplicate runs are flagged.
- Pan, wheel zoom, fit-to-drawing, 10 px grid (Alt to bypass).
- A4/A3-style title block with client, project reference, drawing number,
  revision and date.

### Sizing

- Cable size chosen from the smallest standard size that passes **both**
  ampacity and voltage drop. Every result lists its assumptions.
- Continuous-load factor (×1.25 by default), ambient correction, grouping and
  installation method applied separately.
- Fuse chosen from standard ratings inside a suitable family (blade, MIDI, ANL,
  MEGA, Class-T, MRBF, breaker). If the fuse would exceed the cable's derated
  ampacity, the cable is stepped up automatically; if that is impossible, the
  conflict is reported.
- Manual overrides for cable size, fuse rating and current are respected and
  still validated.
- 12 V, 24 V, 48 V and AC circuits in the same diagram.

### Safety checks

34 rule types run on every change, grouped by severity:

- **Critical** — battery without a primary fuse, unprotected inverter feed,
  undersized cable, fuse above cable ampacity, shore power without an RCD, no
  ground point, reverse-polarity cable, AC and DC on one cable, load exceeding
  the battery's capability.
- **Warning** — missing PV isolator, unprotected MPPT output, large lithium bank
  without high-interrupt protection, voltage drop above target, fuse below the
  continuous load, mixed chemistries or voltages, alternator charging lithium
  directly, parallel PV strings without string fuses, busbar/fuse-box overload.
- **Info** — unconnected terminals, unused ground points, zero-length runs,
  duplicate cables, fuse family mismatches.

Each finding explains the rule and can centre the editor on the offending part.

Where a safe, deterministic repair exists, the finding also has a one-click
action: fit a battery isolator, add a primary fuse, install a shore RCBO, add a
PV isolator, upsize a cable, remove a shorted run, and so on. The repair inserts
real catalogue parts and reconnects the existing circuit, rather than only
silencing the check. Repairs are ordinary edits, so they can be undone and are
included in project exports. Findings that need a design decision (mixed
chemistries, overloaded supplies, missing charging sources) stay manual.

### Documents

- Bill of materials with components, cable lengths and fuse counts.
- Cable schedule and fuse schedule.
- CSV exports for all three.
- SVG (true vector), PNG (2×), PDF via the browser print dialog.
- Full project JSON export/import.
- Named versions with restore (25 per diagram).

### Standards

| Standard | Ampacity | Derating | Default conductor rating |
| --- | --- | --- | --- |
| ABYC E-11 | Table VI-A | Table VI-B ambient + bundling | 105 °C |
| BS 7671 / IEC 60364 | Table 4D1A (Methods A1/B1/C/D) | Tables 4B1 and 4C1 | 90 °C |
| NEC (NFPA 70) | Table 310.16 | Ambient + conductor adjustment | 75 °C |

All three use a 1.25 continuous factor and a 3% default voltage-drop target
(ABYC also offers 10% for non-critical circuits).

### Calculators

`calculators.html` implements ten standalone tools using the same engine:

cable size · fuse size · AWG ↔ mm² · battery bank · energy budget · solar and
MPPT · inverter DC feed · DC-DC charger · shore charging · state of charge.

---

## Project layout

```
app.html                 editor shell
index.html               landing page
calculators.html         calculator page
css/app.css              editor design system
css/site.css             marketing + calculator design system
js/app.js                UI glue: inspector, checks, BOM, project, exports
js/calculators.js        the ten calculators
js/core/engine.js        sizing, current tracing, checks, BOM
js/core/fixes.js         deterministic one-click repairs for check findings
js/core/store.js         document store, undo/redo, persistence, versions
js/ui/editor.js          SVG canvas, drag, wiring, pan/zoom, export
js/ui/symbols.js         original SVG artwork for the 39 components
js/data/catalog.js       component definitions, terminals, defaults, prices
js/data/standards.js     ampacity tables, derating, fuses, wire sizes
js/data/templates.js     campervan, simple and solar starter diagrams
test/engine.test.mjs      engine regression tests
test/fixes.test.mjs       one-click repair regression tests
test/serve.mjs           no-cache static dev server
docs/feature-parity.md   mapping from the reference product to this build
```

---

## How the engine works

1. `computeCurrents()` builds a graph of terminals and cables and traces the
   **supply** and **return** conductors separately, so a load's positive path is
   never mixed with its negative path.
2. Loads contribute their `drawA`; chargers contribute their output current;
   inverters contribute `watts / efficiency / inputV`. PV arrays are analysed
   separately: panels joined `pv+` to `pv−` form a series string, string current
   is the lowest panel Isc, parallel strings add at the combiner, and PV voltage
   drop uses the string Vmp.
3. `sizeRun()` derives the design current, applies the standard's continuous
   factor, derates the published ampacity, computes round-trip voltage drop and
   picks the first passing size.
4. `pickFuse()` selects the next standard rating in a family whose design-current
   window fits.
5. `runChecks()` inspects topology, ratings and coordination; `buildBom()`
   aggregates components, cable metres and fuse counts.

The engine is pure: it takes a diagram object and returns results, which is why
the same code drives the editor and the calculators.

---

## Tests

```
npm test
```

The suite covers:

- published ampacity values per standard and temperature rating
- derating factor stacking
- the continuous-load factor
- a known cable result (12 V, 40 A, 5 m → 25 mm² on ABYC)
- manual overrides still reporting failures
- PV minimum size
- fuse family windows and standard-rating selection
- all three templates evaluating without critical findings
- inverter current calculation
- BOM totals and cable metres
- targeted short-circuit, ground and empty-diagram checks
- table ordering and standard shape consistency

---

## Data and disclaimers

Ampacity values, ambient/grouping factors, voltage-drop limits and fuse rating
ladders are published electrical data from the cited standards. The implementation,
artwork, copy and catalogue structure are original to this project.

RigPlan is a **planning aid**. It does not certify an installation and is not a
substitute for a qualified electrical designer, inspection, or the manufacturer's
instructions. Tables are simplified to a single installation method per standard
and conservative defaults; verify the final design against the current edition of
the applicable standard.

`docs/feature-parity.md` lists exactly which reference-product features are
implemented, approximated or intentionally omitted.
