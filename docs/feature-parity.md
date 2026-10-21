# Feature parity — Wireframe → RigPlan

This document maps the features visible on usewireframe.com (marketing pages,
calculators, pricing table and public app bundles) to RigPlan. It is written so
a reader can see exactly what was replicated, what was rebuilt differently, and
what is deliberately out of scope.

Status key:

- **Built** — present and usable in RigPlan.
- **Partial** — the capability exists but with a smaller data set or a simpler
  implementation.
- **Not built** — no implementation; see the reason.

RigPlan is an independent implementation. It reproduces behaviour and uses
published electrical data, not Wireframe's proprietary source, artwork, brand or
component database.

---

## 1. Diagram editor

| Wireframe capability | RigPlan | Notes |
| --- | --- | --- |
| Drag-and-drop diagram builder | **Built** | `js/ui/editor.js`; drag from library or click to place. |
| Snap-to-grid and free positioning | **Built** | 10 px grid; hold Alt to bypass snapping. |
| Terminal-to-terminal cable drawing | **Built** | Polarity-aware; refuses a cable from a terminal to itself and flags shorts. |
| Move components; cables follow | **Built** | Cables are recalculated from terminal positions each render. |
| Pan, zoom, fit to drawing | **Built** | Wheel zoom, space-drag/middle-drag pan, `F` to fit. |
| Multi-select, duplicate, delete | **Built** | Shift-click, ⌘/Ctrl-D, Delete/Backspace. |
| Undo / redo | **Built** | 60-step history in `js/core/store.js`. |
| Inspector for components and cables | **Built** | Label, brand, model, price, electrical properties, notes. |
| Per-cable length, current override, cable size override, fuse override | **Built** | Manual choices are still validated. |
| Live cable and fuse sizing as you draw | **Built** | `evaluateDiagram()` runs on every store change. |
| Automatic safety checks with explanations | **Built** | 34 distinct findings; each has a rule, severity and jump-to item. |
| One-click automatic repairs | **Built** | Deterministic fixes insert parts and rewire the circuit; unsupported design decisions stay manual. |
| Templates / worked examples | **Partial** | 3 original templates vs 41 on Wireframe; same idea, different catalogue. |
| Branded component catalogue | **Partial** | 39 generic, fully modelled components. No Victron/Renogy/Blue Sea part numbers or logos. |
| Search the library | **Built** | Filters by name, category and tag. |
| Quick-add shortcuts | **Built** | Battery, fuse box, MPPT, load. |
| Title block (client, drawing no., revision, date) | **Built** | Editable in the Project tab and printed on the sheet. |
| Notes / annotation | **Partial** | Per-component notes and drawing notes; no free-text callout tool. |
| Custom company logo / white-label | **Not built** | Trade-tier feature. |
| A0 / large-format sheet sizes | **Partial** | Fixed 1800 × 1100 landscape sheet; print/PDF scales to paper. |

## 2. Sizing and standards

| Wireframe capability | RigPlan | Notes |
| --- | --- | --- |
| ABYC E-11 cable sizing | **Built** | Table VI-A ampacity, Table VI-B ambient, bundling factors, 105 °C default. |
| BS 7671 / IEC 60364 sizing | **Built** | Table 4D1A with methods A1/B1/C/D, 4B1 ambient, 4C1 grouping. |
| NEC (NFPA 70) sizing | **Built** | Table 310.16 columns, ambient correction, conductor adjustment. |
| Continuous-load factor | **Built** | ×1.25 by default, per standard; can be disabled per run. |
| Voltage-drop targets | **Built** | 3% / 5% / 10% presets, standard-specific defaults, editable. |
| 12 / 24 / 48 V systems | **Built** | Voltage is per component and per run. |
| AC circuits (shore, inverter output, sockets) | **Built** | AC L/N/PE conductors with separate colours and checks. |
| PV minimum cable size | **Built** | 2.5 mm² minimum enforced for PV conductors. |
| Series / parallel PV arrays | **Built** | Panels joined pv+ to pv− form a series string; parallel branches add at a combiner; cable current uses string Isc and voltage drop uses string Vmp. |
| Fuse family selection | **Built** | Blade, MIDI, ANL, MEGA, Class-T, MRBF, DC breaker, RCBO. |
| Fuse/cable coordination (fuse ≤ derated ampacity) | **Built** | The cable is automatically stepped up, or the conflict is reported. |
| Real product fuse ratings | **Built** | Standard rating ladder from 1 A to 600 A. |
| Real brand component parameters | **Partial** | Generic defaults with editable properties; no scraped brand database. |

## 3. Safety checks

RigPlan implements 34 rule types, including all the examples Wireframe names in
its marketing:

- battery without a primary fuse
- inverter DC feed without protection
- MPPT output without protection
- undersized cable for its current
- solar array without an isolator
- no ground point
- inverter without a DC isolator
- lithium battery without a BMS
- shore power without an RCD/RCBO
- fuse larger than the cable's derated ampacity
- fuse below the continuous load
- AC and DC on the same cable
- reverse-polarity cable (short)
- mixed battery chemistries or voltages
- parallel PV strings without string fuses
- busbar / fuse-box rating below connected current
- duplicate cables on the same terminals
- unconnected components and terminals
- load exceeding battery capability
- no charging source

Each finding carries a severity (critical / warning / info), a plain-language
explanation and references to the nodes or cables involved, so clicking it
centres the editor on the problem.

## 4. Outputs and documents

| Wireframe capability | RigPlan | Notes |
| --- | --- | --- |
| PDF drawing export | **Built** | Opens a print-ready sheet; "Save as PDF" in the browser. |
| PNG export | **Built** | 2× raster export. |
| SVG export | **Built** | Real vector output, not a screenshot. |
| DXF export | **Not built** | No CAD interchange layer. |
| Bill of materials | **Built** | Components, cables and fuses with quantities and prices. |
| Bill of materials CSV | **Built** | Download from the BOM tab or Export menu. |
| Cable schedule CSV | **Built** | Run, endpoints, length, size, drop, fuse. |
| Fuse schedule CSV | **Built** | Rating, family, protected run. |
| Price book / trade pricing | **Not built** | Uses the unit price typed into each component. |
| Project file (JSON) import/export | **Built** | Full round-trip, useful as a backup. |
| Named versions with restore | **Built** | Up to 25 versions per diagram, stored locally. |
| Client-ready title block | **Built** | Client, project reference, drawing number, revision, date. |

## 5. Accounts, collaboration and commerce

These are core to Wireframe's paid business but are intentionally absent from a
local-first build:

| Wireframe capability | RigPlan | Reason |
| --- | --- | --- |
| User accounts and sign-in | **Not built** | No server; projects live in local storage. |
| Cloud saves / multi-device sync | **Not built** | JSON export/import is the transfer path. |
| Subscription billing (Free / Personal / Trade) | **Not built** | RigPlan is free and has no payment surface. |
| Team seats and shared library | **Not built** | Single-user local app. |
| Client sharing links | **Not built** | Export the PDF/SVG/JSON instead. |
| Affiliate programme | **Not built** | No commerce layer. |
| Admin analytics / usage dashboards | **Not built** | No backend. |
| 30-day money-back guarantee | **Not applicable** | No purchase. |

## 6. Calculators

Wireframe publishes ten calculators. RigPlan implements the same ten on
`calculators.html`, driven by the same engine as the editor:

| Wireframe calculator | RigPlan |
| --- | --- |
| Solar & MPPT Calculator | Solar array & MPPT (array Vmp/Imp, cold Voc, controller rating) |
| Inverter Size Calculator | Inverter DC feed (battery current, cable, fuse) |
| Battery Bank Calculator | Series/parallel layout, stored and usable energy |
| DC-DC Charger Calculator | Input current, both cable runs, both fuses |
| Shore Power Charging Calculator | DC/AC current, charge rate, recharge time |
| Energy Budget Calculator | Editable load table, Wh/day, bank size, array size |
| Wire Size Calculator | Full standard/derating/voltage-drop engine with size table |
| Fuse Size Calculator | Family-aware next-rating selection with cable coordination |
| AWG to mm² Converter | Bidirectional conversion plus reference chart |
| Battery State of Charge Chart | LiFePO4 / AGM / flooded lookup with interpolation |

## 7. Guides and content

Wireframe publishes long-form wiring guides (simple 12 V, inverter, complete
system, Victron, Renogy, 24 V, induction hob, air fryer, fuse box, shore power,
MultiPlus, Orion DC-DC, and more). RigPlan does not reproduce those articles.
The templates and calculators cover the same planning tasks; the guides remain a
content gap rather than a software gap.

---

## Summary

**Replicated:** the editor workflow, automatic cable and fuse sizing, 34 safety
checks, BOM/cable/fuse schedules, SVG/PNG/PDF/JSON export, standards switching,
named versions, templates, and all ten calculators.

**Different by design:** local-first storage, no accounts, no billing, no teams,
no branded part database, no DXF, no hosted sharing.

**Not replicated:** cloud collaboration, commercial licensing workflows, the
marketing site's review content, and the 700+ branded component catalogue.
