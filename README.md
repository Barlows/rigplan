# Electrical Load Schedule & LV Distribution Plan

An interactive load-scheduling workbench for electrical design. Plan transformers,
main LV boards (PDB) and distribution boards (PDP) on a grid-referenced site plan,
drop control panels anywhere on the plan, and the schedule assigns each one to a
board, sizes its feeder and keeps the loading balanced.

No build step, no dependencies, no server. Open `index.html` in a browser.

```
open index.html          # macOS
```

A worked example loads on first open (press **Sample** to reload it). Work is kept
in the browser's local storage, and can be exported/imported as JSON.

---

## Designing over a real site map

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

## Board numbering

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

### The supply hierarchy folds

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

## Circuits fed straight from a main board

Not every load belongs on a distribution board. A washer, a thermal oxidiser, an
air compressor — a large item of plant with its own feeder panel — takes one way
on the **main board** and nothing else hangs off it.

Set **Main board (PDB)** in a circuit's properties and clear the PDP. The circuit
then counts towards that main board's load, not towards any distribution board,
and rolls up to the transformer through it.

Because it is a deliberate placement, such a circuit is **left alone** by
auto-assign and by re-balance: the tool will not drag a machine panel onto a
distribution board to even out a load.

Every board has a **+CP** button that adds a circuit. On a main board it asks
directly for the circuit; on a distribution board it offers the board chooser.

---

## Reading a spreadsheet

**Import CSV** in the toolbar. The dialog shows what it found before anything is
imported, and nothing is guessed.

The file is parsed, then every column is matched against a list of known names
for each field — `Reference` / `Tag` / `Feeder ID` / `Circuit` all mean the same
thing, and so do `Connected Load (kW)`, `Connected KW` and `Load Power`. The
result is a **dropdown per column**, and changing one re-runs the preview
immediately, so a mapping decision is visible before it is committed. A column
the importer cannot place is listed in the dialog in warning colour rather than
dropped, because a silently ignored column is a silently wrong schedule.

A column whose name fits two fields is left unmapped and says which two it could
have been. Picking either silently would put a number in the wrong field, and the
error would not show until the schedule was wrong.

Then it reads the values the way a person would write them:

| In the file | Read as |
|---|---|
| `2 x 95`, `2×95mm²`, `95 x 2` | two runs of 95 mm² |
| `3,963.5` / `3 963,5` / `3,963.5` | 3963.5 — a decimal comma or a thousands separator, whichever the number makes unambiguous |
| `single phase`, `1~`, `1` | one phase |
| `400/230 V` | 400 V, the line-to-line figure |
| `TM 200A`, `200 A LI`, `NSX 250 3P 50kA`, `C63` | a device with its kind, rating, trip unit, poles and breaking capacity |
| `Direct on line`, `VFD`, `soft starter` | a starting method |
| `E12.5 N30` | a grid position |

**Replace project** starts from empty, which is what importing a whole vendor
schedule normally means. **Add to project** puts the circuits into what is
already there, for when one area's schedule arrives separately.

Delimifiers are sniffed rather than assumed, by looking at how many lines agree
on a column count — so a comma inside one description does not turn a
semicolon file into a single-column one, and a title and revision above the
header do not hide the delimiter. The app's own export is recognised as a
four-table file and only the load schedule is read back; the round trip is
tested both ways.

The importer builds the boards a schedule names: a `PDB…` name becomes a main
board, `DB…` a sub-board, anything else a distribution board. That is the only
signal available in a bare column of names, so the result stays editable
afterwards.

Imported circuits are laid out on the plan by the same search the auto-assigner
uses, so they land on the grid, clear of everything else, rather than on top of
the board they are fed from.

## Importing a vendor's load schedule

`tools/roeslein_import.py` converts the Roeslein **AG230-25** spreadsheet into a
project file:

```
python3 tools/roeslein_import.py "All loads L5.xlsx" tools/roeslein-line5.json
```

Then **Import JSON** in the app. It needs nothing but python3 — the spreadsheet
reader is in `tools/xlsx_read.py`.

It reads 97 circuits from the sheet and lands them as two 3,150 kVA
transformers, two main boards, six distribution boards and 97 circuits. The
workbench's own calculation then reproduces the vendor's consumption figure to
within 0.1% — 3,963 kW against their 3,961 kW — which is a useful check that
the mapping is right, because the two numbers are arrived at independently.

| From the sheet | Into the workbench |
|---|---|
| Rated power (kW) | Connected load |
| Load factor × diversity factor | Demand factor |
| Power factor | Power factor |
| Rated / breaker / frame current | Kept in the circuit's notes and in a `_vendor` block |
| Line, machine type, load type | Notes, description, type |

**Decisions taken when this was first imported**, each marked in the script:

1. Two transformers, one per main board, 3,150 kVA each — the sheet lists none.
2. `PDP5001`, `PDP5002` and `PDP5003` are fed from `MSB8`. A handful of rows on
   those boards name `MSB9` in the main-board column, which would give one board
   two parents; those cells were confirmed as typos.
3. The nine `DF-*` feeder panels are collapsed. Each carries exactly one load, so
   the load becomes one way on the main board and the `DF-*` name is kept as the
   circuit's reference.
4. Board ratings are inferred from the sum of outgoing frame sizes, because the
   sheet gives none. **These are estimates and are almost certainly too large** —
   a real distribution board is rated on the diversified load, not on the sum of
   the frames. Each board's notes says so and gives the diversified figure.
   Replace them from the switchgear schedule.
5. Which machines are motors, and what load torque they have, is inferred from
   the machine name — 57 of the 97 circuits. The starting method is **not**:
   the sheet's Starting Method column is empty on all 97 rows, so the 8 circuits
   whose names carry a VSD are marked as driven and the other 49 motors are left
   unstated and reported as unchecked. The importer previously defaulted
   everything to DOL, which put a confirmed-looking 7 × inrush on 89 circuits
   nobody had checked. That is worse than a blank, so it is gone.
6. The supply is **TN-S** and all 97 circuits are **three-phase and neutral** —
   both confirmed, not inferred. `peInCable` is set to false: the protective
   conductor is formed separately, so the fourth core is the neutral and not a
   PEN.
7. Both transformers are **Dyn11**, confirmed. The delta on the LV winding is what
   keeps roughly 1,280 A of neutral conductor out of the incoming feeders.
8. Every circuit is a **control panel feeding drives** — there are no direct-on-line
   motors, so no circuit carries a starting method unless its name says otherwise.
   All 97 are declared `harmonicType: drive`, which gives them a typical 35 %
   distortion for cable sizing and **zero** triplen for the neutral. The 8 air
   compressors and dryers whose machine descriptions name a VSD also carry
   `start: VFD`; the rest are left unstated, because "a panel with drives in it"
   is not a statement about how the drives are started.

The cable columns in that sheet are headed *"Cable & Installation (to be
completed)"*, so every circuit arrives without a feeder cable. The audit reports
80 warnings for that reason and nothing else — which is the correct result, not a
fault in the import.

**Importing a different vendor's sheet** means writing a sibling of that script:
read the columns, map them onto the fields above, write the JSON. Nothing in the
app needs to change to accept it.

---

## Protective devices

Every supply carries a device: each board's incomer, and each final circuit.
Three numbers describe it, and they are three different things:

| | |
|---|---|
| **Ir** — the setting | what the device actually protects at |
| **In** — the frame | the largest the mechanism and contacts are built for |
| **Icu** — the breaking capacity | the largest fault it can switch off |

A 250 A frame set to 200 A is a 200 A device for the supply's purposes; the
250 A frame exists so the 200 A one can be set up to its rating.

**The rule per tier** is a house convention, not physics:

| Tier | Device |
|---|---|
| Main board (PDB) | MCCB |
| Distribution board (PDP) | MCCB |
| Sub-board (DB) | MCB |
| Final circuit | MCB below 160 A, MCCB above |

**Propose protection** in the toolbar sets a device on everything that has
none. It asks first whether to replace devices that are already set, because a
project imported from a switchgear schedule has the real devices on every
circuit and quietly overwriting them would throw away the only data that came
off the schedule. *Only where missing* fills in the gaps and leaves the rest.

A device is sized on the **load with margin**, not on the board's rating: a
4,000 A board carrying 700 A gets a 1,000 A device, because the board is bought
big for the circuits to come. A device never exceeds the board it protects.

### The one case where the convention gives way

A 250 A sub-board is **beyond any MCB** — the largest is 125 A. Following the
"MCBs for DBs" rule literally would put a 125 A device in front of a 250 A
board, so the proposal returns an **MCCB** and says why. If an MCB is wanted
regardless, the alternative is an MCB assembly with a **shunt trip and an
undervoltage release**: a small MCB cuts the load and the assembly opening
isolates it.

### What the audit checks

Four failures, checked separately because they are separate:

- **Breaking capacity below the fault level** — the device would fail to
  interrupt. Reports the next catalogue size to order.
- **Setting below the load** — it will nuisance-trip.
- **Setting above the cable** — the cable overheats before the device trips.
- **Cable cannot survive the fault** — the conductor reaches its temperature
  limit before the device clears. See [cable thermal
  withstand](#cable-thermal-withstand).

Plus **selectivity** between a board and the one feeding it, and a note when a
device cannot be protected by any cable. That last one matters: above about
4,000 A no number of parallel cables is enough, and the audit says **busbar**
rather than sending someone off to add another core.

And the motor checks, each a different fix so they are reported separately:

- **Starting current trips the board above** — the motor is capable of starting
  on its own; the device feeding it disagrees. Soft starting or sequencing.
- **Starting current exceeds its own device** — it trips on every start. Needs a
  curve D MCB or an MCCB with its instantaneous setting above the inrush.
- **Will not accelerate through the dip** — enough torque for the load at nominal
  voltage, not enough once the board is pulled down. See [motor
  starting](#motor-starting).
- **Dip on its board** — advisory, because it affects every other circuit there.
- **No starting method stated**, where a machine is declared and the method was
  inferred from its name. Reported as unchecked rather than assumed.
- **Vector group not stated**, where three-phase and neutral circuits below it
  depend on whether the LV winding has a delta. Names the circuits affected.
- **Protective conductor method not stated**, on a three-phase feeder — 4 cores
  is three phases and a neutral *or* a PEN, and only the installation says which.
- **Neutral bar overloaded**, where single-phase switch-mode load on a board puts
  more into the board's own neutral than its conductors carry. Distinct from the
  incoming neutral, which the vector group settles, and the delta cannot help.

#### Selectivity, from curves

Two devices in series are selective if, for a fault between them, the nearer one
clears first. A fault can be any current, and that is what makes the check hard:
an overload at 1.2 × In is cleared by the thermal elements and a bolt at 40 kA by
the magnetic ones. A pair can be perfectly graded at one and hopelessly ungraded
at the other, and that is the **normal** case — which is why a thermal-magnetic
device below an electronic one is selective on overload and not on short circuit,
and why electronic trip units have a short-time stage at all.

Comparing two ratings, as this used to, can only see one of those two regimes
and so cannot tell a good pair from a bad one. So the check now walks up through
the fault current on logarithmic steps and compares the two **time-current
characteristics** at each step, reporting the current at which the lower device
stops clearing first.

The curves are in `js/data.js` as `[multiple of In, seconds]` points:

| Device | Thermal band | Magnetic pickup |
|---|---|---|
| MCB B / C / D | 1.13 In within an hour, 1.45 In within an hour, 1.61 In within 1800 s (IEC 60898) | 5 / 10 / 20 In within 0.1 s |
| MCCB TM | 0.7 → 1.45 In over 20 s → 1 s | 6–10 In |
| MCCB LI | 0.8 → 1.5 In over 20 s → 0.9 s | 10 In |
| MCCB LS / LSI | as LI, then a 0.1 s plateau | LS has none; LSI at 10 In |

Where a standard gives a range, the **slow** end is used. On the overload side a
fast pickup nuisance-trips; on the short-circuit side it makes the check report
a problem a particular make might not have, which costs a note, where the
opposite error would pass a circuit that trips the whole board.

Two details that matter more than the table:

- **The ladder starts at the higher of the two settings, not the lower.** Below
  the upstream setting the upstream device is barely warm and will take minutes;
  comparing its fifteen-second clearing time against the lower device's thirteen
  finds a "failure" at a current where the upstream was never going to operate at
  all. A 63 A circuit under a 250 A board passes through 190 A on its way up,
  and at 190 A the upstream is at 76%.
- **A pair has to clear first by a factor of 1.25**, not merely first. Plain
  "clears first" would call a pair selective when one device clears at 0.0999 s
  and the other at 0.1000 s, which is a coin toss at the tolerance of every real
  curve.

What the curves buy, on arrangements that all look the same as two numbers:

| Arrangement | Result |
|---|---|
| 63 A MCB C under a 250 A TM | selective throughout |
| 32 A MCB **D** under a 250 A TM | selective throughout — the curve letter is the whole reason |
| 32 A MCB D under a 160 A TM | selective to 0.4 kA, then overlaps |
| 250 A TM under a 400 A TM | selective to 1.7 kA, then overlaps at the upper magnetic |
| 1000 A LI under a 1250 A LI | selective to 3.6 kA — too close |
| 1000 A LI under a 1600 A LI | selective to 7.6 kA |
| 250 A TM under a 1000 A **LI** | selective to 10.5 kA, then overlaps at its instantaneous |
| 250 A TM under a 1000 A **LS** | selective throughout — no instantaneous stage to overlap with |

The last two are the reason an LS trip unit costs more: without the short-time
stage the device is instantaneous at ten times its setting, which at 1000 A is
10 kA, so a fault anywhere above that on a circuit below takes the whole board
out.

The curves are the conventional envelopes, not any manufacturer's, so this is a
finding about the two **settings** rather than a certificate about two
**devices**, and the message says so. Beyond the upstream's instantaneous
threshold, discrimination is decided by let-through energy — which needs the
manufacturer's I²t data and is out of scope here.

#### Repeated findings are folded together

A check that fires on every large motor, or on every circuit whose device is too
slow, produces one finding per item and the list stops being readable. On the
imported project, 37 of 120 rows were the same note about motors and 56 were the
same withstand failure. Findings that carry the same group key are folded into
one row carrying the **count**, the **boards involved** and the **total load
between them**, with the first eight items listed. The real project goes from
120 rows to 26.

**Show every finding** in the audit toolbar undoes the fold. The CSV export and
the print report always carry the full list either way, so this only changes
what is on screen.

Two of a kind is left unfolded — two findings are usually two separate problems,
and folding them hides that. Severities are never merged either: a warning and
an error that happen to share a key are two different problems.

### Cable thermal withstand

The ampacity checks ask whether a cable can carry its load all day. This asks
whether it can carry sixty times its load for the fraction of a second the
protection takes to react, which is a different question and a different answer.

```
I²t = k² S² / t        k = 143 for XLPE, 115 for PVC
```

The finding reports how long the core actually lasts at the calculated fault
level against how long the device takes to clear, and what the fix would be — a
larger core, a lower fault level, or a faster device.

Two things about it are worth knowing:

**Clearing time is the whole check, and it is a band.** An MCB on its magnetic
trip clears in single-digit milliseconds; a thermal-magnetic MCCB in tens of
milliseconds including the arc; a short-time stage around 0.3 s; an LI unit with
no short-time stage on seconds, because the long-time element is all it has.
Each band is set toward the slow end of its published range so the check reports
a problem rather than missing one, and without the manufacturer's curves it is a
band rather than a value — which the finding says.

The 0.5 s that IEC 60898 uses when testing an MCB's magnetic release is **not**
the design figure. It is a bound the device must pass with no manometer fitted,
and using it overstates the clearing time by two orders of magnitude — it fails
every cable on the project including 400 mm².

**Aluminium is reported as unchecked.** A factor of 0.5 is the usual
approximation and it is not accurate enough to size a cable on, so the check
declines rather than being wrong.

Both inputs are indicative — the fault level rests on the assumed transformer
impedance — so check against the manufacturer's data before sizing on it.

### Reactive power and harmonics

Two things a schedule expressed only in kW cannot show.

**Reactive power is derived, not entered.** It falls out of the kW, the kVA and
the power factor already there, by `S² = P² + Q²`. Typing it in would give two
numbers that can disagree with each other and one of them would be used
silently. It appears in the load schedule, the board schedule, the CSV, the
print report and the top bar.

A board whose **aggregate** power factor falls below the limit is flagged, with
the correction that would fix it. The aggregate is not the average of the
circuits' factors — it comes from the sum of kW against the sum of kVA, so a
board of good circuits and one bad one is judged on the arithmetic.

The correction is `Q − Q_target`, where `Q_target = √(S² − P²)` for
`S = P / limit`. Real power stays fixed and the reactive falls, so the
capacitor covers the difference — which is *larger* than it looks. Getting the
sign wrong reports "0 kvar of correction" on a board carrying 120 kvar.

No capacitor is modelled, so the figure is the size of the question rather than
a proposal. The limit is `design.pfLimit`, 0.90 by default.

**Harmonic content is entered per circuit, and only where it is known.** A
`THD %` field raises that circuit's own RMS current by `√(1 + (THD/100)²)`,
which is what actually heats a cable — the fundamental alone understates it.
Above `design.thdWatch` (15%) the audit says so, and reports both the current
rise and the heat, because heating goes as the square of the current and
quoting the current factor as the heat understates it by half.

Nothing is assumed for circuits that say nothing. Assuming harmonic content for
every motor would derate every cable on the project, and most circuits
genuinely have very little.

**kVA below kW is caught.** That is a power factor above 1, which does not
exist, and it is invisible downstream — the current comes out right, the
reactive comes out zero, and only the ratio looks wrong. On the imported
project 78 of 97 circuits carry a kVA figure smaller than their kW, which is a
data-entry problem in that schedule rather than a modelling one; it now shows as
one grouped finding rather than 78 rows.

### Earth fault loop and disconnection time

Automatic disconnection of a faulty circuit has two halves, and the app had
neither. The first is a resistance: the loop from the fault, back through the
protective conductor to the source, has to be low enough that enough current
flows. The second is a time: that current has to make the device operate within a
stated maximum.

The method is the conventional one of IEC 60364-5-54 Annex B, which BS 7671
Regulation 543.1.3 reproduces:

```
Ia = U0 / (R1 + R2)        the current the loop will carry
```

and then the device's **time-current curve is read at that current** and compared
against the maximum disconnection time for its rating and the supply system
(IEC 60364-41 Table 41.4):

| Rating | Final circuit | Other |
|---|---|---|
| ≤ 32 A | 0.1 s | 0.5 s |
| > 32 to 400 A | 0.5 s | 0.5 s |
| > 400 A | 2.0 s | 2.0 s |

The ≤ 32 A figure assumes 30 mA additional protection, which this tool does not
model — so it is stated as an assumption rather than quietly applied.

The second half is why the trip curves are needed here as well as for
selectivity. A device's **rating says nothing about how quickly it clears**: a
63 A MCB and a 63 A MCCB with a long-time delay above 1 In clear a modest fault at
completely different speeds, and the requirement is 0.5 s for both.

Working the other way gives the **permissible loop impedance** — the current at
which the device clears in exactly the allowed time, found by inverting the curve
by bisection, then `U0 ÷ Ia`. Where a loop is too high the finding states the
**protective conductor size that would meet it**, rather than only telling you
that something is wrong.

`R1 + R2` is taken at the conductor's operating temperature rather than 20 °C.
That matters here and nowhere else in the app, because this is the only check
where the resistance *sets* the current rather than merely reducing it. Parallel
runs divide both halves of it.

**Supply arrangement** is on the notes page. On **TN** the loop is the fault, the
protective conductor and the source, so `R1 + R2` alone decides the time. On **TT**
it runs through the earth electrode, so the electrode resistance has to be entered
as well — and a 30 mA RCD is what makes a 0.1 s disconnection achievable at all,
so on TT the app names the missing input and stops rather than applying a TN
formula to a TT system.

The protective conductor defaults to the **BS 7671 Table 54.7** minimum for the
phase size and can be overridden — increasing the PE is the normal way to satisfy
the loop requirement without increasing the phase conductor.

### The neutral conductor

The conductor that carries most of the risk in a modern installation, and the one
a load schedule never mentions.

In a balanced three-phase load the fundamental currents are 120° apart and cancel
in the neutral. **The triplens do not.** A balanced set's vector sum is zero
unless the harmonic order is a multiple of three, so the 3rd, 9th and 15th land
in phase in all three conductors and add:

| Harmonic | 1 | 3 | 5 | 7 | 9 | 15 |
|---|---|---|---|---|---|---|
| Sum across three phases | cancels | **adds ×3** | cancels | cancels | **adds ×3** | **adds ×3** |

So a **three-phase and neutral** circuit puts **three times** its per-phase triplen
current into the neutral — the same contribution as three single-phase circuits of
that current, one on each phase. That is why 3P+N feeders full of drives and
switch-mode supplies are the classic overloaded-neutral case, and it is the reason
the usual reduced-size neutral cannot be used: the reduction assumes a balanced
load, and a balanced load is exactly what is not present.

**A three-pole feeder contributes nothing.** With no neutral conductor there is no
path for zero-sequence current, so the third harmonic circulates in the machine and
never touches a neutral bar. The app distinguishes the two, because the difference
is more than an order of magnitude and a schedule that treats them alike is either
alarming about every motor or silent about every drive. Which applies comes from
`Neutral` in the properties panel, falling back to the core count — four cores
carries a neutral, three is three poles.

**The reference the neutral is judged against is the board's phase current**, not
its largest single circuit. Comparing a summed neutral against one circuit made a
correctly-sized neutral look five times overloaded.

**The transformer's vector group is the cheapest fix available**, and it costs
nothing. A delta on the LV winding blocks zero-sequence current from reaching the
incoming neutral at all — it circulates in the delta instead. So:

| Vector group | Neutral at the board incomer |
|---|---|
| `Dyn11`, `Dyn1`, `Yd11` | nothing — the delta blocks it |
| `Yyn11`, `Yyn0` | three times the board's third harmonic |

#### Total distortion is not the number that matters for a neutral

**A six-pulse drive contributes nothing to a neutral.** It is a balanced
three-phase rectifier, and its characteristic harmonics are 6k ± 1 — the 5th and
7th are the big ones — and none of those are triplen. Its third harmonic cancels
between the phases *before it reaches any conductor*. A panel of drives therefore
heats its feeder and loads its cable, and does nothing at all to the neutral.

The triplen in a control panel comes from somewhere else: **single-phase
switch-mode loads** — control power supplies, PLC racks, instrumentation, LED
drivers, electronic ballasts. Their rectifier sits between phase and neutral, so
their third harmonic is in phase with itself and returns down the neutral.

The app used a flat 60% of THD as the third harmonic, applied to every circuit
that declared any distortion. On this project — every circuit a drive panel —
that reported **PDP7-2's neutral bar carrying 222 A, 159% of a phase conductor**,
a waveform that cannot produce it. The load type now decides:

| Non-linear load | Typical THD | Triplen |
|---|---|---|
| Six-pulse drive | 35% | **0** |
| Drive with input reactor | 15% | **0** |
| Drive with active front end | 5% | 2% |
| Single-phase switch-mode supply | 40% | 35% |
| LED driver | 30% | 25% |
| UPS on a three-phase supply | 20% | 8% |
| Welding machine | 10% | **0** |

Declared as `Non-linear load` on the circuit. An undeclared type asserts nothing,
because an unknown three-phase load is more likely to be balanced — a motor, a
balanced rectifier — than a single-phase supply, and guessing high puts a false
alarm on every board. A measured `3rd harmonic` overrides the table.

**The total still matters, for the cable.** A drive's 35% distortion raises its
own RMS current by `√(1 + 0.35²)` ≈ 6%, and that is what heats the feeder. On
this project that is 6,021 A of fundamental current becoming 6,379 A — **+5.9%
across the site**, which is a real effect on cable sizing even though the neutral
is untouched.

#### What the delta does, and what it does not

Both transformers are **Dyn11**, confirmed. That matters, and it is worth being
precise about what it buys:

| Conductor | With the delta | Without it |
|---|---|---|
| The board's **incoming** neutral | **0 A** | 665 A on PDP7-2 alone; 3,209 A into PDB7 |
| The board's own **neutral bar** and feeder | **unchanged** | unchanged |

A delta on the LV winding blocks zero-sequence current from the transformer
reaching the incoming neutral — it circulates in the delta instead. Across this
project that is **roughly 1,280 A of neutral conductor** avoided, about 640 A per
transformer. The same order, no extra cost, and it belongs on the specification.

**It does nothing for the board's own neutral bar** — but on this site the
neutral bar is carrying nothing either, because every circuit is a drive panel and
a drive has no triplen. Both conductors come out clean, for two different and
independent reasons.

What is left on the neutral is whatever **single-phase** non-linear load exists on
these boards: control supplies, PLC racks, instrumentation, lighting. That is a
real and probably modest number, and it is the one thing worth measuring — it is
what would ever put current in a neutral here. Declare it as
`Non-linear load: switch-mode supply` on the circuits that have it.

The general case still matters, so the app still checks it. Where a board *does*
carry single-phase switch-mode load, the fix is **not** a bigger conductor — it is
stopping the harmonic at the load, or spreading the circuits across more boards so
no single bar carries all of it.

Third harmonic comes from the load type, not from the total — see above. A circuit
with a measured spectrum overrides both.

### Earthing arrangement — TN-S

The supply system is not a label. It decides the conductors, the point the
installation is earthed at, and what the neutral may safely be asked to do.

| | Earthed at | Neutral | 3P+N feeder |
|---|---|---|---|
| **TN-S** | the source, and nowhere else | separate conductor throughout | 5 cores, or 4 + separate PE |
| **TN-C-S** | the source, then continuous metalwork | combined as a PEN, separated after the first RCD | 4 cores |
| **TT** | the installation's own electrode | separate | 5 cores |
| **IT** | nothing | separate | 5 cores; RCD only |

Two consequences worth stating plainly:

**On TN-S the neutral must never be interrupted or re-bonded.** It is a live
conductor for its whole length, and its earth connection exists at exactly one
point. A single-pole isolator in it, or a downstream earth bond, converts the
arrangement into something else — and because the neutral is then also carrying
return current, losing it removes the earth reference from every board beyond it.

**A four-core three-phase feeder is normal on TN-S** and the app does not call it a
fault: it is three phases and a neutral, with the PE formed separately. The core
count cannot tell that from a four-core feeder whose fourth conductor *is* the
earth conductor — which is TN-C-S from that board down whatever it is called
upstream. So the app asks which it is (`PE in this cable`) rather than asserting,
and raises it at info, grouped.

### Power factor correction

Sizing is exact arithmetic — `Qc = P·(tan φ₁ − tan φ₂)`. The engineering is
everything around it, and on a drive-fed site the resonance is the whole thing:

```
f_r = √(S_sc / Q_c)      an undetuned bank, in multiples of 50 Hz
f_r = 1 / √k             a detuned branch, k = the reactor's fraction
```

A capacitor is a reactance and the supply is an inductance; put them together and
they resonate. A six-pulse drive's characteristic harmonics are the **5th and 7th**,
so a bank that resonates between about 4× and 8× sits directly on them.

The second formula is why **7% is the standard figure**: a series reactor-capacitor
branch has an impedance of `j(h·k − 1/h)`, zero when `h² = 1/k`, so 7% puts the
resonance at **3.78× (189 Hz) — below the 5th, where a six-pulse drive produces
nothing** — and it does so *regardless of what the system is doing*. A 5% reactor
gives 4.47×, within 11% of the 5th, which amplifies it. That is why 5% is not used.

On the real project, a 25–50 MVA source and ordinary bank sizes:

| Bank | Resonance | Verdict |
|---|---|---|
| 300 kvar | 9.13× | clear |
| 500 kvar | 7.07× | **on the 7th** |
| 1000 kvar | 5.00× | **on the 5th** |
| 1500 kvar | 4.08× | clear |

A bank is specified by output and detuning (`Bank output`, `Detuning` on the main
board). The audit reports over-correction as an error — a bank larger than the
load's own kvar *exports* reactive power, the power factor leads, and some
supplies treat that as a fault — and a resonance on a harmonic as an error, since
that is what fails capacitors.

The 7% reactor costs about 7% of output and is normally in the bank price rather
than an accessory.

### Revision tracking

A load schedule is a controlled document. The question asked later is not "what
is the current design" but **"what did we issue, and what has changed since"** —
which undo cannot answer. Undo is 25 levels of in-session editing that vanish
when the tab closes.

A revision records the **diff** against the previous one, not a copy:

- the letter and date
- what changed, field by field, with the old and new values
- whether each change **affects the schedule** — which is what decides whether a
  drawing, a cable schedule or an approval already issued is now invalid
- the site's totals at that point, because a schedule is also a capacity
  statement and "it went from 1,932 to 2,410 kVA" is the kind of change that gets
  an engineer called

Nothing is recorded automatically. A revision number is a claim about a
document's status and only the engineer can make that claim, so taking one
prompts for the reason and who it was issued to.

**Keyed on the reference, not the id.** This is the whole basis of a revision
history and getting it wrong is silently catastrophic. Ids are generated per
session — an export/re-import keeps them, but a re-created, merged or
vendor-imported project does not. Diffing on ids reported every object as removed
*and* added: 12 changes instead of 5, all critical, because a removal always is,
and unreadable. The reference is the stable identity, and it is what appears on
the drawing.

Three more things that had to be right:

- **A board's rating is critical, not cosmetic.** An incomer changed from 1000 A
  to 800 A alters the board schedule and every drawing showing it.
- **A cable diff must be legible.** The first version emitted a JSON blob, in
  which the one thing that had changed — the conductor size — was invisible. It
  now reads *"95 mm², 4 core, 40 m, XL-A1"* → *"150 mm², …"*.
- **Key order must not matter.** A cable rebuilt with its keys in another order
  has to read as unchanged, which is why nested values are compared through a
  canonical string with sorted keys.

Revisions are capped at 100 and the oldest are dropped when it is reached —
losing old history is better than losing today's design — and the export omits
the snapshots so the history file is not the size of the project.

### Demand and coincidence

Two ways to get from connected load to the load a supply carries, and they are
**alternatives, not layers**:

| Method | What it assumes |
|---|---|
| **Per-circuit demand factor** | Each circuit has its own duty cycle — a chiller at 0.8, a sump pump at 0.3. The board total is the sum. |
| **Coincidence factor** | The connected load is summed, then the *board* gets one multiplier, because its circuits do not all peak together. |

Stacking them is the common mistake and a serious one: a 0.8 coincidence factor
on top of per-circuit factors of 0.1–0.8 double-counts the same diversity. On
this project that would report **1,545 kVA against 1,932 kVA** — 20% low, and
the numbers would still look plausible.

So the method is a declared setting, not a default in the arithmetic, and the app
reports both figures with the comparison between them. Five coincidence bands
from 0.60 (repetitive plant) to 1.00 (continuous, no diversity), each stating
when it applies.

**The finding this produced:** PDB8's per-circuit factors sum to **0.30** of its
connected load — 1,932 kVA against 6,497 kVA connected, with 32 of 63 circuits
below 0.35 and the lowest at 0.10. That may well be right; these are drive
panels and a board of drives seldom runs flat out. But it is the single
assumption the transformer size rests on, and a factor that low is worth
confirming against measured data rather than taking from a vendor's sheet.

### Voltage profile

Voltage drop is a property of a **path**, not of a circuit. Every metre of cable
between the transformer and the far end carries every ampere flowing through it,
and the drops add:

```
ΔV_total = ΔV_transformer + ΔV_main feeder + ΔV_board feeder + ΔV_circuit
```

A spreadsheet that reports one figure per circuit — the drop across that
circuit's own feeder — is reporting the wrong number, because the drops above it
count too. On this project the circuit feeders contribute 0.1–1.3% and the board
feeders sit on top of that.

**The transformer's contribution is reported but not counted against the limit.**
%Z is the drop at *rated* current, so the drop scales with loading — and the tap
selector is there to cancel it. Including it would put ~4.9% on every circuit and
97 of 97 would fail for the same reason, which destroys the one thing the number
is for. The wiring drop is what the design controls, so that is what the limit is
judged against, and the transformer figure is stated separately as the number
that sets the tap.

On this project, judged that way: **0 circuits over 3%, 3 over 2%**, worst
`Misc. Sump Pumps 901` at 2.78% — of which 7.46 V is its own 1.5 mm² over 23 m.
That is the answer to "is the far end of the site within limits", and it is the
number that decides whether the answer is still yes after another phase is added.

A hop with no stated conductor size or route length contributes **unknown, not
zero**, and the profile is flagged incomplete. An unaccounted hop is a gap in the
data, not a proven pass — eight circuits are currently incomplete.

Busbars and joints are not modelled, so the figures are a small under-estimate.

### Excel export

**Export Excel** on the load schedule writes a real `.xlsx`.

An `.xlsx` is a ZIP archive of XML parts, and ZIP's *stored* method — no
compression — is a valid compression method, so a conforming archive can carry
uncompressed members. That is the whole trick: no dependency, no shelling out to
a converter, and it still opens everywhere. The files are larger than Excel's own
output; for this project, 315 KB against 95 KB of CSV.

Both exports read from one `scheduleRows()` array, so they cannot disagree. A
schedule where the numbers changed depending on which button was pressed would
be worse than useless.

The workbook is laid out as a cover sheet and one sheet per board rather than
one fifty-column table, because a recipient sorts, filters and sums it. The
header row is frozen, columns are sized from their headings, and numbers are
written as numbers so they can be summed.

**What is deliberately absent:** styling beyond a bold header, formulas,
conditional formatting, charts. A schedule is a grid of numbers, and an import
that opens without a repair prompt is worth more than colour-coding.

Two bugs are worth recording, because both produce a file that looks almost
right and then will not open at all:

- **`concat.apply` takes exactly two arguments.** Written as
  `concat.apply([], fields, name)` the third is silently discarded, so every
  central directory entry was 46 bytes — exactly the fixed-field size, with no
  name. The local file headers still read back with matching CRCs, which is why
  it seemed plausible.
- **The central directory is what every reader uses.** An archive whose local
  headers are perfect and whose directory is wrong is unopenable, and the
  symptom points nowhere near the cause.

Verified with an independent reader written from the ZIP spec rather than from
the writer's own helpers, and with `unzip -t` itself.

### Motor starting

Three things go wrong when a motor starts, and only one of them is the peak.

**The peak.** Direct on line draws 6–8 × full load current (IEC 60034-1 locked
rotor). The table uses the slow end of each range, because overshooting a
starting current is safe and undershooting it trips a board.

| Method | Multiple | Torque | Accelerating | Curve needed |
|---|---|---|---|---|
| DOL | 7 × | 2.5 × | ~4 s | D |
| Star-delta | 2.3 × | 0.85 × | ~12 s | C |
| Soft starter | 3 × | 1.6 × | ~15 s | C |
| VFD | 1.4 × | 1.5 × | ~40 s | B |
| Static / SVC | 1.2 × | 1.1 × | ~10 s | B |

**The dip.** The Thevenin impedance looking into a board comes out of the fault
level already calculated, so the two cannot drift apart:

```
ΔU = I_start × Z_th,   Z_th = V / (√3 · I_fault)
```

A 160 kW motor off a 1,000 kVA transformer dips the board 5%. The same motor
off a 250 kVA transformer at 25% dips it 20%. Only the weak supply and the long
feeder matter, which is why nothing is assumed.

**The duration**, which is the one that catches people out. An upstream magnetic
device clears in well under a second; a motor accelerating normally takes
several seconds to draw inrush. So any inrush above the upstream pick-up trips
it. A motor that starts perfectly well on its own can fail when other plant
comes in at the same moment, and the fix is sequencing, not a bigger cable.

**Torque** goes as the square of voltage, so a 10% dip costs 19% of the starting
torque. A motor marginal at nominal voltage can stall on a dip — and a stalled
motor draws more than one accelerating, which deepens the dip. That cascade is
the failure mode, so the check compares available torque against what the load
needs rather than printing a percentage. Load torque is a question for the
vendor (`Load torque` in the properties panel), not something to infer.

Three things are deliberately **not** inferred:

- Whether a circuit is a motor. `DOL` alone does not make one — otherwise a
  lighting circuit with the default method picks up a 7 × inrush. `Machine` is
  set explicitly, or inferred from a non-default starting method, a stated load
  torque, or a panel type that only holds rotating machinery.
- The starting method itself. Blank means not stated, and the audit says so. The
  real project has 49 motors whose sheet column is empty, and they are reported
  as unchecked rather than assumed.
- A machine with no rated load. A stand-by machine usually has no kW, and there
  is no multiple to apply — reported as a gap, not as 0 A.

Starting columns are in the load schedule and the CSV, suppressed where the
method and the source impedance make them irrelevant. A board row carries one
line for its motors: the worst dip and what they draw together.

### Fault levels

The fault level at a board comes from the transformer's **impedance**, not its
rating:

```
Ssc = Sn / uk        a 3,150 kVA transformer at 6% has a short-circuit
Isc = Ssc / (√3·V)   power of 52.5 MVA — about 73 kA at 400 V
```

Reading the rating as though it were the fault power gives 4.4 kA, which is
wrong by a factor of about 17 — the difference between ordering a 6 kA device
and a 100 kA one. `uk` is the transformer's **Impedance** field.

---

## Protection from the switchgear schedule

`tools/add_protection.py` puts the vendor's own devices onto the circuits of a
project file, matched by the sheet row the importer recorded:

```
python3 tools/add_protection.py tools/wxm-line5.json "All loads L5.xlsx"
```

On the Roeslein schedule that is 97 circuits — **56 TM and 41 LI**, from 15 A
up to 800 A in 250 / 400 / 600 / 800 A frames. These are read from the sheet
rather than proposed, because they came off the switchgear schedule.

The sheet's **Interrupt Rating** column is blank on every row, so the breaking
capacity is left empty and filled from the calculated fault level when the
project is opened. A blank column is not a reason to invent a figure.

A project with *some* devices but gaps in them is completed on open — boards
that have no device, and a breaking capacity that is missing. Nothing already
set is touched.

---

## Sub-distribution boards

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

## The workflow

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

### Undo

`↶ Undo` in the toolbar, or **Ctrl+Z** anywhere in the app, with **Ctrl+Shift+Z**
to redo. Twenty-five levels.

The button that most needs this is **↔ Across main boards** in the balance
group, which re-homes circuits right across the installation — before undo
existed there was no way back from it except the saved file. Adding a board,
dragging one, deleting anything (a transformer cascades), auto-assign,
auto-sizing, auto-balancing, proposing protection, splitting an overloaded
board, and every property edit are all undoable.

It is **snapshot** undo rather than command reversal. Reversing an operation
means knowing exactly what each of a dozen places did to which object, and
remembering every one of them forever; a snapshot needs no knowledge of any of
them.

Three details that matter in practice:

- **Typing coalesces per field over 1.5 s**, so one undo reverts a whole edit
  rather than walking back through a word one letter at a time. A dropdown is a
  deliberate choice and always gets its own step.
- **A cancelled or no-op operation leaves the stack alone**, so undo never
  appears to do something and not do it.
- **The site map is kept** in undo snapshots, where an export deliberately drops
  it. Losing the background because you undid a rename would be a poor trade.

---

## How assignment works

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

## What is calculated

- **Load** — design kVA = connected kW ÷ power factor × demand factor. Connected
  and diversified kW are both reported, because a power factor is only meaningful
  against the kW that shares its basis: on the real project 9,525 kW connected
  against 4,172 kVA diversified reads as pf 2.28, and every kvar figure derived
  from that pairing is nonsense. Current from
  kVA at the board voltage: `I = S / (√3 · V)` three-phase, `S / V` single-phase.
  The power factor is **not** in that expression — it has already been applied to
  get to kVA. It was, once, and every three-phase current in the app came out
  1/pf too high: 90 A where 76 A was right at 45 kW and pf 0.85. That fed cable
  sizing, board loading, incomer ratings, volt drop and starting current. The
  arithmetic is now pinned by tests, which is how it should have been all along.
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
- **Motor starting** — starting current by method, the board voltage dip it causes
  (from the fault level), whether it picks up the device above or the motor's own,
  and the torque left against what the load needs. See *Motor starting*.

---

## Layout

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

## Files

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
js/xlsx.js          XLSX writer: CRC-32, a ZIP writer and SpreadsheetML, no deps
tools/xlsx_read.py        minimal spreadsheet reader, standard library only
tools/roeslein_import.py  vendor load schedule → project file
tools/add_protection.py   vendor switchgear schedule → circuit devices
tools/wxm-line5.json      the Roeslein Line 5 & Auxiliaries project, ready to import
test/csv-test.html         102 checks on the CSV parser, the column mapper and
                          the value readers
test/csv-roundtrip-test.html 26 checks on reading the app's own export back,
                          and a vendor file with a title and revision above it
tools/bump.py              set one cache-busting version across every HTML file
test/run.py               headless runner — serves the directory, drives Chrome,
                          reads the results back out of the DOM
test/parser-test.html     35 checks against a synthetic DXF with known geometry
test/numbering-test.html  58 checks on the board numbering scheme
test/db-test.html         46 checks on sub-board sizing and the 63 A rule
test/sld-test.html        36 checks on the single line diagram layout and symbols
test/mainboard-test.html  24 checks on circuits fed straight from a main board
test/protection-test.html 463 checks on fault levels, device proposals, cable
                          thermal withstand, selectivity from trip curves, earth
                          fault looping, the neutral conductor on 3P+N feeders,
                          the earthing arrangement, reactive power, harmonics,
                          motor starting, current from apparent power and the
                          protection audit
test/underlay-test.html   image/DXF/DWG loading and scale handling
test/xlsx-test.html       53 checks on the workbook writer, with an independent
                          reader written from the ZIP spec that walks the
                          archive the way `unzip` does
```

### Running the tests

```
python3 test/run.py                  # every suite
python3 test/run.py numbering db     # only the named ones
python3 test/run.py --list
```

The whole run takes about seven seconds and needs nothing installed — no
`npm install`, no node, no browser window. The test pages are ordinary HTML that
load the app's own scripts, so all that is needed is a headless browser to
render them and something to read the results back out. `test/run.py` uses
whatever Chrome or Chromium it can find; point at a specific binary with
`--chrome /path/to/binary`.

It exits non-zero on any failure and prints the got/want pair for each failing
check, which is what tells you which of two possible mistakes was made. If no
browser is found it exits **2** with a message saying so, because "no tests ran"
must never look like "all tests passed".

Two of the suites — `sld` and `underlay` — render or read rather than counting
pass/fail cases, so they are only checked for having produced output. `sld` counts
them; `underlay` is inspection-only, because what it exercises is rejection paths
rather than results.

**A test page that reads a sibling file fails on a fresh clone and nowhere
else.** This is not hypothetical. The underlay suite fetched `test/fixture.dxf`,
which `.gitignore` was excluding with a blanket `test/*.dxf`. It passed on every
local run for as long as the file happened to be lying on disk — which is also
how it worked when it was first written — and failed the moment it was run
somewhere clean. The file is now inlined in the page as a
`<script type="application/dxf">` block, so the suite needs nothing but itself.

`run.py` checks for that before rendering anything: it lists the files git
tracks and fails if a test page fetches a path that is not among them. The check
is in the runner rather than only in CI so it fires on the machine where the file
was last edited, which is the machine where the mistake was made.

**Pages say what happened to them.** A suite may carry `<pre id="state">`, set to
`running` at the start and `done` or `error` at the end, and a global handler
writes any escape into the page. Without it an empty result is ambiguous: threw,
hung, and never started all leave a placeholder, and the runner can only guess
between them. With it, a failure prints its own stack.

`.github/workflows/tests.yml` runs the same command on every push, plus a parse
check on each script and a grep for client identifiers in the app files.

Open a `test/*.html` page in a browser to see the results while working on the
matching module.

After changing any JavaScript, bump the cache-busting query so a browser does not
run the previous version:

```
python3 tools/bump.py         # next version, applied to index.html and every test page
python3 tools/bump.py --show  # what each file currently says
```

Doing this by hand means editing ten files and forgetting one, and the symptom
is a suite failing for no reason because it is running a copy of the code from
before the change.

## Single line diagram

The **Single line diagram** tab draws the whole supply as a schematic, using IEC
60617 symbols: two overlapping circles for a transformer, a filled square for the
incomer protective device, a rectangle with a line through it for a final-circuit
fuse, three decreasing bars for earth, and a plain rectangle for a board. The
**Legend** button shows the key — an SLD without a symbol key is just shapes.

#### The sheet is bounded, not merely scaled

The diagram is a tree, so its natural shape is wide and short: every circuit
under a board sits on the same line. On the real project six distribution boards
off one main board were laid out in one line, their circuit rows inherited that
width, and the sheet came out **10,158 px** wide — which no printer takes and no
reader holds.

Past `maxRowW` (1,180 px) the layout now **drops to a new sub-row** instead of
continuing to the right. The width stays bounded by construction and the height
grows, which is what a page break is for. The real project is now 1,200 × 3,704.

Four things this exposed, each of which is now a check:

- **A sub-row advances by a band and a half, not a whole band.** A band is the
  gap between one tier and the next, so advancing by exactly one put every
  fourth sub-row's board on the same line as a circuit two sub-rows earlier —
  three symbols at one coordinate.
- **Two boards never share a line.** A board's symbol is centred over the span of
  everything it feeds, and that span can be a whole row of circuits wide, so a
  second board on the same line lands inside the first one's span.
- **A board's y is fixed before its circuits are laid out.** Read afterwards, a
  wrap during placement drops the board below the circuits it feeds.
- **Each item's y is read fresh.** Reading it once per row put the second half
  of a wrapped run exactly on top of the first.

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

## Limits — read before using this for real work

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
- Selectivity is assessed on the conventional time-current envelopes, not on any
  manufacturer's curves, so it judges two *settings* rather than two *devices*.
  Beyond a device's instantaneous threshold, discrimination is decided by
  let-through energy and is not assessed here.
- Selectivity is assessed on the conventional time-current envelopes in
  `js/data.js`, not on any manufacturer's curves. It judges two **settings**
  rather than two **devices**, it does not use energy classes, let-through I²t or
  the actual time bands, and above a device's instantaneous threshold the answer
  it gives is "these overlap" where energy discrimination might still separate
  them. A pass here is not proof of selectivity; a warning is not proof of a
  fault. Check the actual curves before changing a setting.
- Cable thermal withstand under fault, short-circuit capacity, RCD discrimination
  and cost are **not** checked.
- Fault levels are indicative only (see above): they rest on the assumed
  transformer impedance and fault MVA, and ignore busbar and contact impedance.
  Breaking capacities are chosen with 15% on top for that reason. Confirm against
  an actual short-circuit study before ordering.
- The device ranges are the Compact NS and Acti9 families. A manufacturer with
  different ranges can be typed in by hand.
- No diversity is applied between circuits — each panel is loaded at its own demand
  factor. Add demand factors per panel to model diversity.
- Starting currents, inrush, harmonic effects, motor acceleration and generator
  behaviour are flagged as notes but not calculated.
- Cable lengths are straight-line distances plus 20%, not actual routes.
