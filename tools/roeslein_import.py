***REMOVED***!/usr/bin/env python3
"""Convert 'schedule.xlsx' into a project file for the load-schedule workbench.

Reads the vendor's schedule and writes JSON in exactly the shape the app's
Import button expects, so the file can be dropped straight in.

Decisions taken with the engineer (2026-10-02), each marked with a NOTE below
so the reasoning travels with the code:

  1. Two transformers, one per main board, 3,150 kVA each.
  2. DIST-1 / DIST-2 / DIST-3 are fed from MAIN-A. The sheet has a handful of
     rows on those boards whose "LV Board" cell says MAIN-B, which would give one
     distribution board two parents. Those cells are typos and are corrected.
  3. The nine DF-* feeder panels are collapsed. Each carries exactly one load,
     so the load is placed straight on the main board as a single way and the
     DF-* name is kept as the circuit's reference.
  4. Rated kW is imported as the connected load; the sheet's own load factor and
     diversity factor are combined into the app's demand factor. The app's own
     engine then reproduces the vendor's consumption figure independently.
  5. Board ratings are inferred from the sum of outgoing frame sizes and marked
     as estimates, because the sheet gives no board ratings at all.

Only the standard library is used — no openpyxl — so this runs anywhere python3
does. xlsx_read.py holds the minimal spreadsheet reader.
"""

import json
import re
import math
import sys
from collections import defaultdict

from xlsx_read import read, letter

SRC = sys.argv[1] if len(sys.argv) > 1 else "/Users/sean/Downloads/schedule.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "client-line5.json"

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

TX_KVA = 3150                            ***REMOVED*** decision 1
MV_REF = "MV board"

***REMOVED*** Boards whose "LV Board" cell is a typo. The engineer confirmed the correct
***REMOVED*** parent.                                                           ***REMOVED*** decision 2
LV_FIX = {"DIST-1": "MAIN-A", "DIST-2": "MAIN-A", "DIST-3": "MAIN-A", "DIST-4": "MAIN-A"}

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
    return "%s_client_%03d" % (prefix, n)


def main():
    rows = read_rows()
    if not rows:
        raise SystemExit("no rows found in %s" % SRC)

    for r in rows:
        ***REMOVED*** decision 2 — correct the mistyped main board
        r["lv"] = LV_FIX.get(r["db"], r["lv"])
        ***REMOVED*** decision 3 — collapse the dedicated feeder panels onto the main board
        if r["db"].startswith("DF-"):
            r["feederPanel"] = r["db"]
            r["db"] = ""
        else:
            r["feederPanel"] = ""

    mains = sorted({r["lv"] for r in rows})
    boards = sorted({r["db"] for r in rows if r["db"]})
    print("main boards      :", ", ".join(mains))
    print("distribution bds :", ", ".join(boards))
    print("direct-on-MSB    :", sum(1 for r in rows if r["feederPanel"]))

    ***REMOVED*** ---------------------------------------------------------------- layout
    ***REMOVED*** A site big enough that 97 circuits do not pile up on one another.
    SITE_W, SITE_H = 78, 74
    main_y = {"MAIN-A": 56, "MAIN-B": 24}
    tx_x, msb_x, pdp_x = 5, 10, 15
    pdp_y = {"MAIN-A": {"DIST-1": 62, "DIST-2": 56, "DIST-3": 50, "DIST-4": 44},
             "MAIN-B": {"DIST-5": 30, "DIST-6": 24}}
    fallback_y = {"MAIN-A": 38, "MAIN-B": 18}

    tx_ids, pdb_ids, pdp_ids = {}, {}, {}

    out = {
        "name": "Client Line 5 & 9 — production and support",
        "client": "Client AG",
        "ref": "project ref",
        "designer": "",
        "date": "2026-10-02",
        "site": {"w": SITE_W, "h": SITE_H, "ox": 0, "oy": 0},
        "place": {"snap": 1, "offset": 2, "clearance": 1.5},
        "txs": [], "pdbs": [], "pdps": [], "dbs": [], "panels": [],
        "underlay": None,
    }

    ***REMOVED*** ------------------------------------------------------------ transformers
    for i, m in enumerate(mains, start=1):
        tid = uid("tx", i)
        tx_ids[m] = tid
        out["txs"].append({
            "id": tid, "tag": "TX-%d" % i, "num": i,
            "name": "Transformer feeding %s" % m,
            "ref": "Line %s" % rows[[r["lv"] for r in rows].index(m)]["line"],
            "kva": TX_KVA, "kvIn": 11, "kvOut": 0.415,
            "phases": "3", "pf": 0.95, "impZ": 6, "faultKVA": None,
            "at": 0, "pos": {"x": tx_x, "y": main_y[m]}, "notes":
                "3,150 kVA assumed — the schedule lists no transformers. "
                "Both transformers are fed from %s (medium voltage); the MV "
                "voltage and transformer impedance were not given and are "
                "assumed, so fault levels on this project are indicative." % MV_REF,
        })

    ***REMOVED*** ------------------------------------------------------------- main boards
    for i, m in enumerate(mains, start=1):
        pid = uid("pdb", i)
        pdb_ids[m] = pid
        out["pdbs"].append({
            "id": pid, "tag": "PDB-%d" % i, "num": 1,
            "name": "Main LV board %s" % m, "ref": m,
            "txId": tx_ids[m], "incomerA": 6300, "phases": "3", "spareWays": 0,
            "pos": {"x": msb_x, "y": main_y[m]},
            "notes": "Fits %s. Its own rating is an estimate (see the board "
                     "schedule note); %s is the designation used on the vendor "
                     "drawing." % (m, m),
            "cable": {"csa": None, "runs": 1, "cores": 4, "len": 0,
                      "method": "XL-A1", "group": 2, "ambient": 40, "sheathed": True},
        })

    ***REMOVED*** --------------------------------------------------- distribution boards
    for i, b in enumerate(boards, start=1):
        host = next(r["lv"] for r in rows if r["db"] == b)
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
            "pos": {"x": pdp_x, "y": pdp_y.get(host, {}).get(b, fallback_y[host])},
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
        k = slots[board_key]
        slots[board_key] += 1
        col, row = k % 6, k // 6
        base_x = pdp_x + 5 if board_key in pdp_ids else msb_x + 5
        base_y = (pdp_y.get(host_main, {}).get(board_key, fallback_y[host_main])
                  if board_key in pdp_ids else fallback_y[host_main] - 6)
        return {"x": base_x + col * 2.6, "y": base_y - 4 - row * 2.4}

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
        bits.append("Client: rated %.1f A, breaker %g A, frame %g A, "
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