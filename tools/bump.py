#!/usr/bin/env python3
"""Set one cache-busting version across every HTML file that loads the app.

The `?v=` query on a `<script>` is the only thing telling a browser that a
script has changed. Keeping it correct by hand across index.html and nine test
pages means editing nine files and forgetting one — and the symptom is a test
suite failing for no reason, because it is running a copy of the code from
before the change.

    python3 tools/bump.py            # next version, applied everywhere
    python3 tools/bump.py 42         # a specific version
    python3 tools/bump.py --show     # what each file currently says

Every occurrence is rewritten, so a test page that had no query string gains
one. One version number for the whole app, which is also the honest thing: a
developer changing one script invalidates the lot anyway, and a per-file scheme
invites exactly the mistake above.
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SCRIPTS = [
    "js/data.js", "js/csv.js", "js/calc.js", "js/dxf.js", "js/underlay.js",
    "js/plan.js", "js/sld.js", "js/ui.js",
]

PATTERN = re.compile(r"((?:\.\./)?js/[a-z0-9]+\.js)(?:\?v=\d+)?")
STYLE = re.compile(r"(css/styles\.css)(?:\?v=\d+)?")


def html_files():
    out = [os.path.join(ROOT, "index.html")]
    testdir = os.path.join(ROOT, "test")
    if os.path.isdir(testdir):
        for name in sorted(os.listdir(testdir)):
            if name.endswith(".html"):
                out.append(os.path.join(testdir, name))
    return out


def current(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def rewrite(text, version):
    text = PATTERN.sub(lambda m: "%s?v=%d" % (m.group(1), version), text)
    return STYLE.sub(lambda m: "%s?v=%d" % (m.group(1), version), text)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("version", nargs="?", help="the version to set (default: one higher than the highest found)")
    ap.add_argument("--show", action="store_true", help="print what each file says and exit")
    args = ap.parse_args()

    files = html_files()

    if args.show:
        for p in files:
            print("%-34s %s" % (os.path.relpath(p, ROOT),
                                " ".join(sorted(set(re.findall(r"\?v=\d+", current(p)))))))
        return 0

    if args.version:
        version = int(args.version)
    else:
        highest = 0
        for p in files:
            for v in re.findall(r"\?v=(\d+)", current(p)):
                highest = max(highest, int(v))
        version = highest + 1

    changed = []
    for p in files:
        before = current(p)
        after = rewrite(before, version)
        if after != before:
            with open(p, "w", encoding="utf-8") as f:
                f.write(after)
            changed.append(os.path.relpath(p, ROOT))

    print("v=%d applied to %d file(s)" % (version, len(changed)))
    for c in changed:
        print("  %s" % c)
    return 0


if __name__ == "__main__":
    sys.exit(main())