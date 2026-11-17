# AGENTS.md — electrical load schedule workbench

Read this before changing anything. It is the handover from the session that
built the app, and it records the reasoning behind decisions that look arbitrary
until you know why they were made.

---

## 1. Which project you are in

**This repository is a monorepo.** The root is the electrical load schedule
workbench. Other directories are separate, unrelated projects:

| Path | What it is | Touch it? |
|---|---|---|
| `/` (index.html, js/, css/, test/, deploy/, docs/) | **The electrical load schedule app** | yes — this is the subject |
| `rigplan/` | RigPlan — campervan/RV wiring diagrams | no |
| `iptv-player/` | IPTV player | no |
| `nbtevo-carplay-advanced/`, `nbtevo-mac/` | Android Auto installers | no |
| `CV-2026.*` | A CV | no |
| `WXM_Electrical_Design_Docs/` | Source documents from the client's schedule | read-only reference |

If the task is about the electrical app, work only at the root. `rigplan/` in
particular has uncommitted work belonging to somebody else — do not commit,
revert or "tidy" it.

---

## 2. What the app is

A zero-dependency static workbench for electrical load schedules and LV
distribution: transformers → main boards (PDB) → distribution boards (PDP) →
sub-boards (DB) → final circuits. It is used for real client work, not a demo.

**Hard constraints, all of which have been violated once and cost time:**

- **No build step, no npm, no bundler.** Classic `<script>` tags, global objects,
  works from `file://`. `fetch` is used only for the optional `?project=` loader.
- **Client project files.** `tools/wxm-line5.json` is now **committed
  deliberately** (see §7). Everything else in `tools/*.json` stays out.
- **Private repository.** It contains real client installation data.
- Numbers must be right. A wrong figure in a load schedule gets built.

### Entry points

```
index.html          the app; nine tabs
launch.html         redirects to index.html?project=tools/wxm-line5.json
js/data.js          reference data: cables, sizes, trip curves, NSX range, defaults
js/calc.js          the engineering engine — everything numerical lives here
js/ui.js            shell, tabs, forms, exports, print report
js/csv.js           RFC 4180 CSV import/export and the column mapper
js/xlsx.js          XLSX writer (ZIP with stored entries, no compression)
js/dxf.js           DXF/DWG underlay parsing
js/sld.js           single-line diagram
js/plan.js          canvas plan view
js/underlay.js      site map overlay
test/*.html         ten browser test suites
test/run.py         headless runner
deploy/             Proxmox container, nginx, systemd, update script
docs/transformer-specification.md   the transformer enquiry document
tools/bump.py       rewrites the ?v= cache-buster in every HTML file
tools/import_schedule.py   vendor spreadsheet → project file
```

---

## 3. How to work on it

```bash
python3 test/run.py              # all ten suites, ~1042 checks, about 10 s
python3 test/run.py protection   # one suite
python3 tools/bump.py            # ALWAYS after editing any js/ or css/
```

### The `?v=` discipline — do not skip this

Every HTML page loads its scripts as `js/calc.js?v=<number>`. `tools/bump.py` rewrites
that number **in index.html and in every test page**. The build has no other
versioning.

If you edit JS and do not bump:

- the browser serves the old script from cache and you debug code that is not
  running;
- the test runner does the same, so tests pass against the wrong file.

When debugging in a browser, always use a fresh cache-buster on the *page* URL
(`?cb=<random>`), not a fixed one. A plain `?x=1` has been served stale.

### Before committing

```bash
python3 -c "import sys;sys.path.insert(0,'test');import run;print(run.script_syntax_errors());print(run.untracked_reads())"
python3 test/run.py
```

Both checks must be clean: `[]` and `[]`, and all suites green.

---

## 4. The project being engineered

`tools/wxm-line5.json` — a can-line installation, 97 circuits, all of them
control panels feeding drives.

| | |
|---|---|
| Transformers | 2 × 3,150 kVA, 11/0.415 kV, Dyn11, TN-S |
| Main boards | PDB7, PDB8 (4,400 A busbar) |
| Distribution boards | 6 PDP, 0 sub-boards |
| Circuits | 97, all `harmonicType: "drive"`, all `start: "VFD"` |
| Connected | 9,525 kW / 10,037 kVA |
| Design (per-circuit demand) | 4,172 kVA |
| Worst coincidence band | 6,015 kVA against 6,300 kVA installed |
| Power factor | 0.950 |

Numbers worth knowing: fault level ~73 kA at 415 V on the 6% transformer
impedance; busbar Icw requirement 92 kA for 1 s; transformer taps set to +5% on
both, which brings all 97 circuits inside the voltage limit.

### Decisions already made — do not re-open without new information

- **Transformer rating 3,150 kVA is settled.** It holds across both demand
  methods (4,172–6,015 kVA against 6,300 kVA installed).
- **Transformer impedance is SPECIFIED, not assumed:** 6.0% ±10% to IEC 60076,
  both units within 5% of each other. The band is derived from the switchgear —
  the NSX incomers are 100 kA, so anything below ~5.6% cannot be switched by
  them. See `docs/transformer-specification.md`.
- **The 11 kV is confirmed** (MVSB1 main switchboard).
- **Tap +5% on both**, on-load ±3 × 2.5%, commissioned against measured voltage.
- **Busbar Icw specified at 100 kA for 1 s**, matched to the incomer rather than
  to the calculated 92 kA — busbar and device should fail together.
- **Devices selected from the Schneider NSX range.** The `nsxSelect()` /
  `nsxSchedule()` functions give frame, Micrologic type, settings and Icu, part
  by part. **Micrologic 2.2 is long-time only and must never be selected** — it
  will not clear a short circuit.
- **Power factor: detune if fitted.** Every circuit is a drive, so an undetuned
  bank would resonate with the 5th and 7th harmonics. 267 kvar available.
- **Loop-margin findings are advisory.** The rule tests proximity to the
  permitted loop impedance, not time-used, which saturates at the device floor.

### Open items, and who owns them

| Item | Owner | Notes |
|---|---|---|
| Measured transformer %Z | client, with the equipment | test certificate |
| PDB8 demand factor 0.30 | client, measured data | order holds either way |
| 8 circuit selectivity pairs + PDP8-1 | **commercial decision** | needs electronic trip units; improves final-circuit discrimination only |
| DF-HPAC909 rated current | commissioning | declared stand-by, no running load |
| 267 kvar bank | client | detuned, if wanted |

**The two warnings left visible are deliberate.** A cleared-by-default warning
is worse than a visible one. Do not suppress findings to make a list green.

---

## 5. The audit: what it should look like

After loading the project and pressing **Grade**:

```
0 errors
9 rows:  0 errors, 12 warnings, 4 info
```

That is the correct state. If you see more errors, something has regressed.

**Grade is an action, not something that happens on load.** `selectivityPlan()`
computes and returns settings; it does not apply them. The print report's
coordination column is empty until Grade is pressed.

### The finding philosophy

This was the single most valuable thing learned:

- **A finding must be something a person would change.** "Device matched to its
  cable with under 5% headroom" reported the requirement being met — removed.
- **False positives are worse than silence.** They train the reader to ignore
  the list, and then the real finding is missed.
- **Do not widen a threshold to make a case pass.** If a value is marginal, say
  so; if the rule is wrong, change the rule and explain why.
- **An absent input is not the same as nothing to say.** State the *requirement*
  even when the certificate is missing ("92 kA for 1 s required").
- **Provenance is not state.** A declared value is declared, however it was
  first arrived at.
- **Grouped findings** collapse repeats (threshold 3); severities never merge.

---

## 6. Bug classes that have actually bitten — read this before editing

These are not hypothetical. Each one cost real time and several are invisible
until you check the right thing.

### Silent no-op edits

- **Substring asserts lie.** `'stageSettings, SHORT_TIME_DELAYS' in s` was true
  because `tripStages, SHORT_TIME_DELAYS` contains it. Assert on an exact unique
  anchor, or on a count.
- **Write-then-re-write from a stale string reverts the first edit.** If you do
  two `str.replace` passes, assign back to `s` each time; never re-open the file
  with the original in-memory copy.
- **`str.replace` with no match is a no-op that still "succeeds".** Always
  `assert s.count(old) == 1` before replacing.
- **Matching a record by `name` when the name differs from the tag does
  nothing.** `DF-HPAC909` is the *tag*; its name is "High Pressure Air
  Compressor 909". An earlier edit silently wrote to nothing. Match on `tag`.
- **`io.open(path, 'w')` as a "check" truncates the file.** This destroyed
  `js/calc.js` once.

### Unit and basis errors

- **kVA vs VA in an impedance base.** `Z_base = V²/S` with S in kVA is 1000× too
  big, so every cable looked 1000× more conductive and no feeder ever limited
  its own fault. 48 errors came from this one line. Check units by dimensional
  analysis, not by eye.
- **Diversified vs connected current.** `panelDemand().amp` is demand-scaled.
  A machine's starting current and overload class must use `ampConn` — the
  motor draws full current when it runs regardless of diversity.
- **Two different questions, one number.** The *device* is tested at its own
  terminals; the *conductor* at its own far end. See `deviceFaultKA()`.
  The same feeder was reported as 61.3 kA on one line and 8.8 kA on the next.

### Model gaps that hid whole analyses

- **`isMotor: false` written where the meaning was "not identified".** That one
  field switched off the entire motor-starting analysis for all 97 circuits and
  nothing said so. Absence of evidence must be `null`, not `false`.
- **A check gated on a panel type list that did not include `plant`.** All 97
  circuits are `plant`/`other` — the analysis was dormant.
- **A constant where a setting belongs.** The short-time *pickup* was hard-coded
  at 2× Ir. It is adjustable 1.1–10× on real units, and that one constant is why
  pairs were reported as "impossible to grade".

### Security

- **`?project=` is same-origin and relative only.** Percent-encoded traversal
  (`%252e%252e`) passes a `..` check and is normalised by the browser — `%` is
  refused outright. Eleven cases are tested; keep them passing.
- **`printReport()` has no try/catch.** A throw inside any view leaves the report
  silently empty. If you add a view, verify it renders.

---

## 7. Deployment

`deploy/` builds a Proxmox container that serves the app and pulls every push.

| File | What it does |
|---|---|
| `deploy/deploy-to-proxmox.sh` | creates the container, installs, configures, first update |
| `deploy/update.sh` | fetch → stage → verify → atomic symlink swap |
| `deploy/nginx.conf` | serves the app; **no-store for HTML**, immutable for `?v=` assets |
| `deploy/elschedule-update.{service,timer}` | pull every minute |
| `deploy/README.md` | **read this** — setup, rollback, and the trade-offs |

**The cache header is load-bearing.** `?v=` only works if `index.html` is never
cached. nginx sends `no-store` for HTML and a year-immutable for the versioned
assets. Get this wrong and every deploy reports success while the browser runs
old code.

`update.sh` refuses to deploy code that does not parse, keeps three releases,
and swaps a symlink — so a bad push leaves the previous version serving.

**The project file is committed.** `tools/wxm-line5.json` is in the repository
and therefore in its history. That was a deliberate decision: the repo is
private and the site is dedicated to one project. Removing the file later does
**not** remove it from history — only a new repository does. If access ever
widens, revisit this.

`launch.html` is the landing page and opens the WXM project. nginx serves
exactly one file from `/tools/` — `wxm-line5.json` — and refuses `/test/`.

---

## 8. What was not verified

Be honest about these rather than assuming they work.

- **The Proxmox script has never run on a real Proxmox host.** There was none
  available. The script parses and its file list matches the repo; the `pct`
  calls are untested.
- **Print pagination is unverified.** The report builds nine sections and
  renders, but whether the SLD and load schedule break sensibly across A4 pages,
  or whether table headers repeat, has not been seen.
- **The NSX commercial references are assembled, not looked up.** Frame,
  Micrologic, settings and Icu are each correct and quoted separately; check them
  against a current Schneider catalogue before ordering.
- **`?project=` has been exercised against the real file**, but not behind nginx.

---

## 9. Style

The code is commented at length, deliberately. Comments explain *why* a decision
was made and what breaks if it is reversed — not what the line does. Several
comments name the bug they prevent. Keep that.

When you find a bug, prefer changing the rule that produced it and writing down
the reason, over patching the symptom. And when a test pins the old behaviour,
fix the test — a test written on a bug keeps the bug alive.
