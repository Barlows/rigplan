#!/usr/bin/env python3
"""Run every browser test suite headlessly, with nothing installed.

The tests are ordinary HTML pages that load the app's own scripts and render
their results into the page. Nothing about them needs a browser window, so they
can be driven by Chrome's headless mode and read back out of the DOM. That
keeps the project free of a package manager: there is no npm install, no
node_modules, no lockfile to drift out of step with the code.

Usage:
    python3 test/run.py                  # every suite
    python3 test/run.py numbering db     # only the named suites
    python3 test/run.py --list
    python3 test/run.py --chrome "/path/to/Chrome"

Exit status is 0 only if every check passed. If no Chrome can be found the run
reports that and exits 2, because "no tests ran" must never look like "all
tests passed".
"""

import argparse
import functools
import http.server
import os
import re
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Suite name -> file. Named rather than globbed because the order is the order
# the checks build on: parser and data first, then the design rules that sit on
# them, then the things that render.
SUITES = [
    ("parser", "parser-test.html"),
    ("numbering", "numbering-test.html"),
    ("db", "db-test.html"),
    ("mainboard", "mainboard-test.html"),
    ("protection", "protection-test.html"),
    ("sld", "sld-test.html"),
    ("underlay", "underlay-test.html"),
]

# Suites that render a diagram or read a file and print their findings as text
# rather than as pass/fail cases. They are still run — a crash in them would
# otherwise go unnoticed — but they report what they saw instead of a tally.
INSPECTION = {"sld", "underlay"}

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
]


def find_chrome(explicit=None):
    if explicit:
        return explicit if os.path.exists(explicit) else None
    which = shutil.which("chrome") or shutil.which("chromium") or shutil.which("google-chrome")
    if which:
        return which
    for path in CHROME_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Quiet(http.server.SimpleHTTPRequestHandler):
    """A server that says nothing.

    The default handler logs every request to stderr, which buries the test
    output. It also serves the wrong directory unless told otherwise.
    """

    def log_message(self, *args):
        pass


def serve(port):
    handler = functools.partial(Quiet, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def dump_dom(chrome, url, budget=8000):
    """Render a page headlessly and return its final DOM."""
    cmd = [
        chrome,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--virtual-time-budget=%d" % budget,
        "--dump-dom",
        url,
    ]
    out = subprocess.run(cmd, capture_output=True, timeout=90)
    return out.stdout.decode("utf-8", "replace")


def strip_tags(html):
    html = re.sub(r"<[^>]+>", " ", html)
    for a, b in (("&times;", "x"), ("&mdash;", "-"), ("&nbsp;", " "), ("&amp;", "&"),
                 ("&lt;", "<"), ("&gt;", ">"), ("&#39;", "'"), ("&rsquo;", "'"),
                 ("&hellip;", "..."), ("&ge;", ">="), ("&le;", "<=")):
        html = html.replace(a, b)
    return re.sub(r"\s+", " ", html).strip()


def summary_of(dom):
    m = re.search(r'id="summary"[^>]*>(.*?)</div>', dom, re.S)
    return strip_tags(m.group(1)) if m else None


def failures_of(dom):
    """The failing case names and the values they got.

    A count of failures alone is not enough to act on; the got/want pair is
    what tells you which of two possible mistakes was made.
    """
    out = []
    for block in re.findall(r'<div class="case fail">(.*?)</div>\s*(?:</div>|<div class="case)', dom, re.S):
        name = re.search(r'<div class="name">(.*?)</div>', block, re.S)
        detail = re.search(r'<div class="detail">(.*?)</div>', block, re.S)
        out.append((strip_tags(name.group(1)) if name else "?",
                    strip_tags(detail.group(1)) if detail else ""))
    return out


def script_syntax_errors():
    """Every app script has to parse before anything is worth testing.

    A syntax error in one file kills every suite that loads it, and the symptom
    is a blank page. Saying so directly is a much better failure message than
    forty-four failing checks in six suites.
    """
    errors = []
    for name in sorted(os.listdir(os.path.join(ROOT, "js"))):
        if not name.endswith(".js"):
            continue
        path = os.path.join(ROOT, "js", name)
        with open(path, encoding="utf-8") as f:
            src = f.read()
        # Cheap but effective: unbalanced braces/parens inside a file that is
        # all one expression per function will almost always show up. Not a
        # substitute for a real parser, which is what the browser run is.
        for opener, closer in (("{", "}"), ("(", ")"), ("[", "]")):
            if src.count(opener) != src.count(closer):
                errors.append("%s: %d %s vs %d %s" % (name, src.count(opener), opener,
                                                       src.count(closer), closer))
    return errors


def run(chrome, port, names):
    total_ok = total = 0
    failed_suites = []

    for name, filename in SUITES:
        if names and name not in names:
            continue
        path = os.path.join(HERE, filename)
        if not os.path.exists(path):
            print("  %-12s MISSING %s" % (name, filename))
            failed_suites.append(name)
            continue

        url = "http://127.0.0.1:%d/test/%s" % (port, filename)
        started = time.time()
        try:
            dom = dump_dom(chrome, url)
        except subprocess.TimeoutExpired:
            print("  %-12s TIMED OUT after 90 s" % name)
            failed_suites.append(name)
            continue
        took = time.time() - started

        if name in INSPECTION:
            # These report what they observed rather than a tally, so there is
            # no summary to read. What matters is that the page produced output
            # at all: a throw leaves the body empty, and that is exactly the
            # failure worth catching here.
            body = strip_tags(dom)
            if len(body) < 60:
                print("  %-12s RENDERED NOTHING (%d chars) — the page threw" % (name, len(body)))
                failed_suites.append(name)
            else:
                print("  %-12s inspected, %d chars of output  (%.1fs)" % (name, len(body), took))
            continue

        summary = summary_of(dom)
        if summary is None or "running…" in summary:
            print("  %-12s DID NOT FINISH — the page threw before writing its results" % name)
            failed_suites.append(name)
            continue

        fails = failures_of(dom)

        m = re.match(r"(\d+)\s*/\s*(\d+)\s*checks passed", summary or "")
        if not m:
            print("  %-12s UNREADABLE SUMMARY %r" % (name, summary))
            failed_suites.append(name)
            continue

        ok, of = int(m.group(1)), int(m.group(2))
        total_ok += ok
        total += of
        if ok == of:
            print("  %-12s %d / %d  (%.1fs)" % (name, ok, of, took))
        else:
            failed_suites.append(name)
            print("  %-12s %d / %d  FAILED  (%.1fs)" % (name, ok, of, took))
            for fname, detail in fails[:12]:
                print("      %s" % fname)
                if detail:
                    print("        %s" % detail)
            if len(fails) > 12:
                print("      ... and %d more" % (len(fails) - 12))

    return total_ok, total, failed_suites


def main():
    ap = argparse.ArgumentParser(description="Run the browser test suites headlessly.")
    ap.add_argument("names", nargs="*", help="suite names to run (default: all)")
    ap.add_argument("--list", action="store_true", help="list the suites and exit")
    ap.add_argument("--chrome", help="path to the Chrome or Chromium binary")
    args = ap.parse_args()

    if args.list:
        for name, filename in SUITES:
            kind = "inspection" if name in INSPECTION else "checks"
            print("%-12s %-24s %s" % (name, filename, kind))
        return 0

    unknown = [n for n in args.names if n not in [s[0] for s in SUITES]]
    if unknown:
        print("unknown suite(s): %s" % ", ".join(unknown))
        print("known: %s" % ", ".join(s[0] for s in SUITES))
        return 2

    syntax = script_syntax_errors()
    if syntax:
        print("app scripts do not parse:")
        for e in syntax:
            print("  %s" % e)
        return 1

    chrome = find_chrome(args.chrome)
    if not chrome:
        print("no Chrome or Chromium found.")
        print("Install one, or point at it with --chrome /path/to/binary.")
        print("NOTHING WAS TESTED — this is not a pass.")
        return 2

    port = free_port()
    httpd = serve(port)
    try:
        print("running %d suite(s) against %s on port %d\n" %
              (len([s for s in SUITES if not args.names or s[0] in args.names]), chrome, port))
        ok, total, failed = run(chrome, port, args.names)
    finally:
        httpd.shutdown()

    print("")
    if total:
        print("%d / %d checks passed" % (ok, total))
    if failed:
        print("FAILED suites: %s" % ", ".join(failed))
        return 1
    if not total:
        print("no checks ran — that is not a pass")
        return 2
    print("all suites green")
    return 0


if __name__ == "__main__":
    sys.exit(main())