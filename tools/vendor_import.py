***REMOVED***!/usr/bin/env python3
"""Convert a vendor's load schedule into a project file for the workbench.

Reads the schedule and writes JSON in exactly the shape the app's Import button
expects, so the file can be dropped straight in.

The column numbers below are specific to the sheet this was written against —
a two-row group header, then a table header row, then the loads. Retarget it by
editing the C_* constants and the row numbers; everything else is generic.

Decisions that had to be made by hand on that schedule, each marked with a
comment so the reasoning travels with the code:

  1. Two transformers, one per main board. The sheet listed none, so the rating
     came from the engineer.
  2. Three distribution boards had a few rows whose main-board cell named the
     wrong parent, which would have given one board two. Corrected.
  3. Nine single-load feeder panels were collapsed. Each carries exactly one
     load, so the load is placed straight on the main board as a single way and
     the feeder-panel name is kept as the circuit's reference.
  4. Rated kW is imported as the connected load; the sheet's own load factor and
     diversity factor are combined into the app's demand factor. The app's own
     engine then reproduces the vendor's consumption figure independently —
     worth checking, because agreement to a fraction of a percent is the evidence
     the mapping is right.
  5. Board ratings are inferred from the sum of outgoing frame sizes and marked
     as estimates, because the sheet gives no board ratings at all.

Only the standard library is used — no openpyxl — so this runs anywhere python3
does. xlsx_read.py holds the minimal spreadsheet reader.

    python3 vendor_import.py "schedule.xlsx" project.json
"""

import datetime
import json
import math
import re
import sys
from collections import defaultdict

from xlsx_read import read, letter

***REMOVED*** --------------------------------------------------------------------------
***REMOVED*** Everything below is sheet-specific. Adjust to suit a different schedule.
SRC = sys.argv[1] if len(sys.argv) > 1 else "load-schedule.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "project.json"

***REMOVED*** Project metadata written into the file. Replace with your own.
PROJECT_NAME = "Imported load schedule"
CLIENT = ""
PROJECT_REF = ""

***REMOVED*** --------------------------------------------------------------------------
***REMOVED*** Column numbers in the sheet, from its own header row (row 10).
C_DESC, C_PHASE, C_LINE = 1, 2, 3
C_TYPE, C_MACHINE = 4, 5
C_MV, C_LV, C_DB = 6, 7, 8
C_VOLTS = 11
C_IC, C_IB, C_IN = 12, 13, 14            ***REMOVED*** rated A / breaker A / frame A
C_ILOAD = 17                            ***REMOVED*** nominal load A
C_KW, C_KVA = 18, 19                    ***REMOVED*** rated kW / kVA
C_NOMKW, C_NOMKVA = 20, 21              ***REMOVED*** after the load factor
C_ESTKW = 22                            ***REMOVED*** after load factor x diversity
C_DF, C_LF, C_PF = 23, 24, 25
C_UTIL, C_CHK, C_COMMENT = 30, 31, 38

HEADER_ROW = 10
FIRST, LAST = 11, 107                    ***REMOVED*** row 108 is the sheet's own total row

***REMOVED*** --- assumptions the schedule does not supply. Set these to suit the job. ---
TX_KVA = 1000                  ***REMOVED*** transformer rating, kVA — decision 1
TX_ZPCT = 6                    ***REMOVED*** transformer impedance, percent
MV_KV = 11                     ***REMOVED*** medium voltage feeding the transformers
MV_REF = "MV board"            ***REMOVED*** a name for it in the notes
FEEDER_PREFIX = "DF-"          ***REMOVED*** boards matching this are single-load panels

***REMOVED*** A short tag stamped onto every generated id, so two projects made by this
***REMOVED*** script cannot collide. Change it if you run it more than once.
ID_PREFIX = "imp"

***REMOVED*** Corrections to the sheet, keyed by board. On the schedule this was written
***REMOVED*** against, a few rows on three distribution boards named the wrong main board
***REMOVED*** in the "LV Board" column, which would have given one board two parents. List
***REMOVED*** the corrections here; leave it empty if the sheet is consistent. ***REMOVED*** decision 2
PARENT_FIX = {}
***REMOVED*** e.g. PARENT_FIX = {"DIST-1": "MAIN-A", "DIST-2": "MAIN-A"}

***REMOVED*** Standard incomer sizes for the inferred board ratings.            ***REMOVED*** decision 5
SIZES = [630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300]

***REMOVED*** Circuit type in the app, by the sheet's own load-type / description. The app
***REMOVED*** uses these to pick a default power factor and phase count; every circuit here
***REMOVED*** is 400 V 3-phase at pf 0.95 regardless, so the value barely matters, but the
***REMOVED*** label shows up in the schedule.
TYPE_BY_AREA = {
    "Production Equipment": "plant",
    "Support Equipment": "plant",
    "Spare": "other",
}


def fnum(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def read_rows():
    grid, _ = read(SRC)
    g = lambda r, c: grid.get((r, c), "")
    rows = []
    for r in range(FIRST, LAST + 1):
        if not g(r, C_DESC):
            continue
        rows.append({
            "row": r,
            "desc": g(r, C_DESC).strip(),
            "line": g(r, C_LINE).strip(),
            "area": g(r, C_TYPE).strip(),
            "machine": g(r, C_MACHINE).strip(),
            "mv": g(r, C_MV).strip(),
            "lv": g(r, C_LV).strip(),
            "db": g(r, C_DB).strip(),
            "volts": fnum(g(r, C_VOLTS), 400.0),
            "ic": fnum(g(r, C_IC)),
            "ib": fnum(g(r, C_IB)),
            "frame": fnum(g(r, C_IN)),
            "iload": fnum(g(r, C_ILOAD)),
            "kw": fnum(g(r, C_KW)),
            "nomkw": fnum(g(r, C_NOMKW)),
            "estkw": fnum(g(r, C_ESTKW)),
            "df": fnum(g(r, C_DF), 1.0),
            "lf": fnum(g(r, C_LF), 1.0),
            "pf": fnum(g(r, C_PF), 0.95),
            "vendorUtil": g(r, C_UTIL).strip(),
            "vendorCheck": g(r, C_CHK).strip(),
            "comment": g(r, C_COMMENT).strip(),
        })
    return rows


def infer_rating(sum_frame):
    for c in SIZES:
        if c >= sum_frame:
            return c
    return SIZES[-1]


def uid(prefix, n):
    return "%s_%s_%03d" % (prefix, ID_PREFIX, n)


def main():
    rows = read_rows()
    if not rows:
        raise SystemExit("no rows found in %s" % SRC)

    for r in rows:
        ***REMOVED*** decision 2 — correct the mistyped main board
        r["lv"] = PARENT_FIX.get(r["db"], r["lv"])
        ***REMOVED*** decision 3 — collapse the dedicated feeder panels onto the main board
        if r["db"].startswith(FEEDER_PREFIX):
            r["feederPanel"] = r["db"]
            r["db"] = ""
        else:
            r["feederPanel"] = ""

    mains = sorted({r["lv"] for r in rows})
    boards = sorted({r["db"] for r in rows if r["db"]})
    print("main boards      :", ", ".join(mains))
    print("distribution bds :", ", ".join(boards))
    print("direct-on-main   :", sum(1 for r in rows if r["feederPanel"]))

    ***REMOVED*** ---------------------------------------------------------------- layout
    ***REMOVED*** Nothing here is keyed on a board's name: positions come from how many
    ***REMOVED*** boards and circuits sit under each main board, so the script carries no
    ***REMOVED*** trace of the project it was first run against.
    ***REMOVED***
    ***REMOVED*** Each main board gets a horizontal band. Inside a band, top to bottom:
    ***REMOVED*** the transformer, the main board, then its distribution boards stacked
    ***REMOVED*** down. Each board's circuits form a grid to the right of it, so all the
    ***REMOVED*** grids line up in the same columns and stacked boards never collide.
    ***REMOVED*** Circuits fed straight off the main board get their own column further
    ***REMOVED*** right, clear of every grid.
    ***REMOVED***
    ***REMOVED*** Every spacing below is derived from the pitch of the symbols and the
    ***REMOVED*** number of circuits each board carries, so the layout holds whether the
    ***REMOVED*** project has six boards or sixty.
    per_main = defaultdict(list)
    direct_per_main = defaultdict(int)
    circ_per_board = defaultdict(int)
    for r in rows:
        if r["feederPanel"]:
            direct_per_main[r["lv"]] += 1
        elif r["db"]:
            circ_per_board[r["db"]] += 1
    for b in boards:
        per_main[next(r["lv"] for r in rows if r["db"] == b)].append(b)

    GRID_W, GRID_H = 2.6, 2.4          ***REMOVED*** circuit grid pitch, metres
    COLS = 6                            ***REMOVED*** circuits per row before wrapping
    GRID_WIDE = COLS * GRID_W           ***REMOVED*** how far a grid reaches to the right
    TX_DY, MSB_DY, PDB_DY, CIRC_DY = 0, 5, 11, 16
    tx_x, msb_x, pdp_x = 5, 10, 15

    def grid_rows(n):
        return (n + COLS - 1) // COLS

    ***REMOVED*** Stacked boards must be far enough apart that one board's circuit grid
    ***REMOVED*** cannot reach the board below it: a full-height grid plus clearance.
    max_rows = max([grid_rows(circ_per_board[b]) for b in boards] +
                   [grid_rows(direct_per_main.get(m, 0)) for m in mains] + [1])
    board_step = max(14.0, max_rows * GRID_H + 9)

    band_h = {}
    for m in mains:
        n_boards = len(per_main.get(m, []))
        deepest = CIRC_DY + max(0, n_boards - 1) * board_step
        direct = grid_rows(direct_per_main.get(m, 0)) * GRID_H
        band_h[m] = deepest + max(max_rows * GRID_H, direct) + 6

    SITE_H = int(sum(band_h.get(m, 20) for m in mains) + 12)
    SITE_W = int(pdp_x + 4 + 2 * GRID_WIDE + 8)
    grid_x = pdp_x + 4                    ***REMOVED*** where circuit grids start
    direct_x = grid_x + GRID_WIDE + 6     ***REMOVED*** one clear column further right

    ***REMOVED*** band tops, measured down from the top of the site
    band_top = {}
    y = SITE_H - 6
    for m in mains:
        band_top[m] = y
        y -= band_h[m]

    def main_pos(m):
        return {"x": tx_x, "y": band_top[m] - TX_DY}

    def board_pos(m, bi):
        """distribution board bi of main board m, stacked below it"""
        return {"x": pdp_x, "y": band_top[m] - PDB_DY - bi * board_step}

    board_index = {}
    for m in mains:
        for bi, b in enumerate(per_main.get(m, [])):
            board_index[b] = (m, bi)

    tx_ids, pdb_ids, pdp_ids = {}, {}, {}

    out = {
        "name": PROJECT_NAME,
        "client": CLIENT,
        "ref": PROJECT_REF,
        "designer": "",
        "date": datetime.date.today().isoformat(),
        "site": {"w": SITE_W, "h": SITE_H, "ox": 0, "oy": 0},
        "place": {"snap": 1, "offset": 2, "clearance": 1.5},
        "txs": [], "pdbs": [], "pdps": [], "dbs": [], "panels": [],
        "underlay": None,
    }

    ***REMOVED*** ------------------------------------------------------------ transformers
    for i, m in enumerate(mains, start=1):
        tid = uid("tx", i)
        tx_ids[m] = tid
        line = next((r["line"] for r in rows if r["lv"] == m and r["line"]), "")
        out["txs"].append({
            "id": tid, "tag": "TX-%d" % i, "num": i,
            "name": "Transformer feeding %s" % m,
            "ref": ("Line %s" % line) if line else "",
            "kva": TX_KVA, "kvIn": MV_KV, "kvOut": 0.415,
            "phases": "3", "pf": 0.95, "impZ": TX_ZPCT, "faultKVA": None,
            "at": 0, "pos": main_pos(m), "notes":
                "%s kVA assumed — the schedule lists no transformers. Both are "
                "fed from %s (medium voltage); the MV voltage and the transformer "
                "impedance were not given and are assumed, so fault levels on "
                "this project are indicative." % (TX_KVA, MV_REF),
        })

    ***REMOVED*** ------------------------------------------------------------- main boards
    for i, m in enumerate(mains, start=1):
        pid = uid("pdb", i)
        pdb_ids[m] = pid
        frames = sum(r["frame"] for r in rows if r["lv"] == m)
        out["pdbs"].append({
            "id": pid, "tag": "PDB-%d" % i, "num": 1,
            "name": "Main LV board %s" % m, "ref": m,
            "txId": tx_ids[m], "incomerA": infer_rating(frames),
            "phases": "3", "spareWays": 0,
            "pos": {"x": msb_x, "y": main_pos(m)["y"] - MSB_DY},
            "notes": "Fits %s. Its incomer rating is an estimate taken from the "
                     "sum of the outgoing frame sizes; see the board schedule "
                     "note." % m,
            "cable": {"csa": None, "runs": 1, "cores": 4, "len": 0,
                      "method": "XL-A1", "group": 2, "ambient": 40, "sheathed": True},
        })

    ***REMOVED*** --------------------------------------------------- distribution boards
    for i, b in enumerate(boards, start=1):
        host, bi = board_index[b]
        did = uid("pdp", i)
        pdp_ids[b] = did
        members = [r for r in rows if r["db"] == b]
        frames = sum(r["frame"] for r in members)
        est = sum(r["estkw"] for r in members)
        amps = sum(r["estkw"] / r["pf"] for r in members) * 1000 / (math.sqrt(3) * 400)
        rating = infer_rating(frames)
        out["pdps"].append({
            "id": did, "tag": "PDP-%d" % i, "num": i,
            "name": "Distribution board %s" % b, "ref": b,
            "pdbId": pdb_ids[host], "incomerA": rating, "busbarA": None,
            "phases": "3",
            ***REMOVED*** the sheet lists every way on the board, spares included, so the
            ***REMOVED*** enclosure is full — total ways = rows, spare ways = 0
            "ways": len(members), "spareWays": 0,
            "pos": board_pos(host, bi),
            "notes": "Rating estimated: the outgoing frame sizes sum to %d A, "
                     "so the incomer is set to the next standard size, %d A. "
                     "The diversified load on this board is only %.0f kW "
                     "(about %.0f A), because the sheet applies a load factor "
                     "and a diversity factor to every circuit. A real "
                     "distribution board is rated on the diversified load, not "
                     "on the sum of the frames, so this figure is almost "
                     "certainly too large — replace it with the incomer "
                     "rating from the switchgear schedule. %d ways, all taken "
                     "(the three spares the sheet lists are counted above)."
                     % (frames, rating, est, amps, len(members)),
            "cable": {"csa": None, "runs": 1, "cores": 4, "len": 0,
                      "method": "XL-A1", "group": 2, "ambient": 40, "sheathed": True},
        })

    ***REMOVED*** ------------------------------------------------------------- circuits
    ***REMOVED*** Laid out in a grid to the right of whichever board feeds them.
    slots = defaultdict(int)
    n = 0
    vendor_total_est = 0.0
    app_total_kva = 0.0

    def next_pos(board_key, host_main):
        """The next free cell in the grid belonging to this circuit's board.

        Circuits on a distribution board share one grid column, stacked so that
        a board's circuits read as a block. Circuits fed straight off the main
        board use their own column, clear of every grid."""
        k = slots[board_key]
        slots[board_key] += 1
        col, row = k % COLS, k // COLS
        if board_key in board_index:
            m, bi = board_index[board_key]
            base_x, base_y = grid_x, board_pos(m, bi)["y"] - 4
        else:
            base_x, base_y = direct_x, band_top[host_main] - PDB_DY - 4
        return {"x": base_x + col * GRID_W, "y": base_y - row * GRID_H}

    for r in rows:
        n += 1
        host_main = r["lv"]
        is_spare = r["area"] == "Spare"
        ***REMOVED*** Spare ways repeat on every board ("Spare Breaker 30A 1"), so a bare
        ***REMOVED*** copy would collide. The reference carries the board it sits on, which
        ***REMOVED*** is how a spare way is identified on a real drawing anyway.
        ***REMOVED*** NB: strip only the trailing index — a plain replace(" 1","") also
        ***REMOVED*** matches the " 1" of " 100A".
        if is_spare:
            amp = re.sub(r"\s*\d+$", "", r["desc"]).replace("Spare Breaker", "").strip()
            tag = "SPARE %s (%s)" % (amp, r["db"] or host_main)
        elif r["feederPanel"]:
            tag = r["feederPanel"]                 ***REMOVED*** decision 3: keep the DF name
        else:
            tag = r["desc"]

        demand = round(r["lf"] * r["df"], 4)       ***REMOVED*** decision 4
        kw = round(r["kw"], 3)
        pf = r["pf"] or 0.95
        kva = (kw / pf) * demand

        bits = []
        bits.append("Sheet row %d." % r["row"])
        if r["machine"]:
            bits.append("Machine: %s." % r["machine"])
        if r["feederPanel"]:
            bits.append("Fed from its own feeder panel %s, taken as one way "
                        "on %s; the %s layer was collapsed on import."
                        % (r["feederPanel"], host_main, r["feederPanel"]))
        bits.append("Schedule: rated %.1f A, breaker %g A, frame %g A, "
                    "nominal %.0f A; rated %.1f kW, nominal %.1f kW, "
                    "estimated consumption %.1f kW; load factor %g, "
                    "diversity factor %g, pf %g."
                    % (r["ic"], r["ib"], r["frame"], r["iload"], r["kw"],
                       r["nomkw"], r["estkw"], r["lf"], r["df"], pf))
        bits.append("On import the load factor and diversity factor are "
                    "combined into the demand factor (%.3g), so the "
                    "workbench's own calculation lands on %.1f kW."
                    % (demand, kva * pf))
        if r["vendorCheck"] == "REVIEW":
            ***REMOVED*** the vendor's device-utilisation cell carries full float precision
            vu = r["vendorUtil"]
            try:
                vu = "%.1f%%" % (float(vu) * 100)
            except (TypeError, ValueError):
                vu = vu or "n/a"
            bits.append("Vendor flagged this circuit REVIEW (device "
                        "utilisation %s)." % vu)
        if r["comment"]:
            bits.append(r["comment"])

        on_main = bool(r["feederPanel"])
        out["panels"].append({
            "id": uid("pnl", n), "tag": tag, "name": r["desc"],
            "description": r["machine"] or ("Production" if r["area"].startswith("Production")
                                            else "Support" if r["area"].startswith("Support")
                                            else "Spare way"),
            "type": TYPE_BY_AREA.get(r["area"], "other"),
            "kw": kw, "kva": None, "pf": pf, "demand": demand,
            "phases": "3", "volt": int(r["volts"]) or 400,
            "start": "VFD" if "VSD" in r["machine"].upper() or "VSD" in r["desc"].upper() else "DOL",
            "contingency": 0,
            "pdbId": pdb_ids[host_main] if on_main else None,
            "pdpId": None if on_main else pdp_ids[r["db"]],
            "dbId": None, "autoAssign": False,
            "pos": next_pos(r["db"] or host_main, host_main),
            "notes": " ".join(bits),
            "cable": {"csa": None, "runs": 1, "cores": 4, "len": 0,
                      "method": "XL-A1", "group": 1, "ambient": 40, "sheathed": True},
            ***REMOVED*** kept so the vendor's own figures are not lost
            "_vendor": {"row": r["row"], "mvBoard": r["mv"], "lvBoard": r["lv"],
                        "board": r["db"] or r["feederPanel"], "line": r["line"],
                        "loadType": r["area"], "ratedA": r["ic"],
                        "breakerA": r["ib"], "frameA": r["frame"],
                        "nominalA": r["iload"], "ratedKW": r["kw"],
                        "nominalKW": r["nomkw"], "estimatedKW": r["estkw"],
                        "loadFactor": r["lf"], "diversityFactor": r["df"],
                        "deviceUtilPct": r["vendorUtil"], "deviceCheck": r["vendorCheck"]},
        })
        vendor_total_est += r["estkw"]
        app_total_kva += kva

    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)

    print()
    print("circuits written :", len(out["panels"]))
    print("  of which spares:", sum(1 for p in out["panels"] if p["type"] == "other" and not p["kw"]))
    print("  direct on a MSB:", sum(1 for p in out["panels"] if p["pdbId"]))
    print()
    print("vendor estimated consumption : %8.1f kW" % vendor_total_est)
    print("workbench design kVA (sum)   : %8.1f kVA" % app_total_kva)
    print("  as kW at pf 0.95            : %8.1f kW" % (app_total_kva * 0.95))
    print("difference                   : %8.1f kW (%.1f%%)"
          % (app_total_kva * 0.95 - vendor_total_est,
             (app_total_kva * 0.95 - vendor_total_est) / vendor_total_est * 100))
    print()
    print("written to", OUT)


if __name__ == "__main__":
    main()