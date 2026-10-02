***REMOVED***!/usr/bin/env python3
"""Put the vendor's own protective devices onto the circuits of a project file.

The switchgear schedule in 'schedule.xlsx' gives, for every circuit, the
breaker rating (Ir), the frame it sits in (In) and the trip unit family (TM for
the small ones, LI from 200 A up). That data is better than anything the
workbench would propose — it came off the switchgear schedule — so it is written
onto each circuit rather than being calculated.

The breaking capacity is deliberately left empty. The sheet has an
"Interrupt Rating (kA) @400VAC" column but it is blank on every row, and a
blank column is not a reason to invent a figure: the app fills it in from the
calculated fault level when protection is proposed, which is the one place the
number can be traced back to something.

Matching is by the sheet row number the importer recorded on each circuit
(`_vendor.row`), not by name, so a circuit whose description has been edited in
the app still finds its device.

Usage:
    python3 tools/add_protection.py tools/wxm-line5.json [sheet.xlsx]
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_read import read                                  ***REMOVED*** noqa: E402

C_IB, C_IN, C_TRIP = 13, 14, 15            ***REMOVED*** breaker rating, frame, trip unit
HEADER_ROW = 10
***REMOVED*** the trip-unit families that identify an MCCB — see TRIP_UNITS in js/data.js
TRIP_FAMILIES = {"TM", "LI", "LS", "LSI", "eLSI"}


def read_devices(path):
    """sheet row -> (Ir, In, trip unit)"""
    grid, _ = read(path)
    out = {}
    for (r, c), v in grid.items():
        if r <= HEADER_ROW:
            continue
        if c == C_IB:
            try:
                ib = float(v)
            except (TypeError, ValueError):
                continue
            out[r] = (ib, float(grid.get((r, C_IN)) or 0), str(grid.get((r, C_TRIP)) or '').strip())
    return out


def main():
    proj_path = sys.argv[1]
    sheet = sys.argv[2] if len(sys.argv) > 2 else "/Users/sean/Downloads/schedule.xlsx"

    devices = read_devices(sheet)
    if not devices:
        raise SystemExit("no device data found in %s" % sheet)

    with open(proj_path) as f:
        proj = json.load(f)

    matched = missing = skipped = 0
    by_trip = {}
    for pn in proj.get("panels", []):
        v = pn.get("_vendor") or {}
        row = v.get("row")
        if row is None:
            skipped += 1
            continue
        d = devices.get(int(row))
        if not d:
            missing += 1
            continue
        ib, frame, trip = d
        if ib <= 0:
            ***REMOVED*** a spare way: a frame exists, but nothing is protected by it yet
            pn["prot"] = {"kind": "mccb" if (trip or "TM") in TRIP_FAMILIES else "mcb",
                          "frame": frame or None, "ir": None, "icu": None,
                          "trip": trip or None, "poles": 4, "aux": "",
                          "notes": "Spare way — a device is fitted but nothing is "
                                   "connected. Frame %g A, no rating set yet." % frame}
            by_trip["spare"] = by_trip.get("spare", 0) + 1
            continue
        ***REMOVED*** TM and LI are MCCB trip-unit families; an MCB has a curve letter
        ***REMOVED*** instead (B, C, D). So a device that arrived with a trip-unit family
        ***REMOVED*** is an MCCB whatever its rating — a 30 A TM device on this schedule is
        ***REMOVED*** a Compact NS100, not an Acti9 MCB.
        kind = "mccb" if (trip or "TM") in TRIP_FAMILIES else "mcb"
        pn["prot"] = {
            "kind": kind,
            "ir": ib,                                  ***REMOVED*** the rating it protects at
            "frame": frame or None,                    ***REMOVED*** the frame it sits in
            "icu": None,                               ***REMOVED*** sheet column is blank
            "trip": trip or None,
            "poles": 2 if str(pn.get("phases")) == "1" else 4,
            "aux": "",
            "notes": "From the switchgear schedule (sheet row %d): %g A in a %g A frame, %s trip unit."
                     % (int(row), ib, frame, trip or "trip unit not stated"),
        }
        by_trip[trip or "?"] = by_trip.get(trip or "?", 0) + 1
        matched += 1

    with open(proj_path, "w") as f:
        json.dump(proj, f, indent=1)

    print("circuits given a device :", matched)
    print("  spare ways, no rating :", by_trip.get("spare", 0))
    print("  by trip unit          :", ", ".join(
        "%s %d" % (k, v) for k, v in sorted(by_trip.items()) if k != "spare"))
    if skipped:
        print("no sheet row recorded  :", skipped, "(added by hand in the app — leave alone)")
    if missing:
        print("row not in the sheet   :", missing)
    print()
    print("breaking capacity left blank on every circuit: the sheet's interrupt-rating")
    print("column is empty, so it is filled from the calculated fault level instead.")
    print("written to", proj_path)


if __name__ == "__main__":
    main()