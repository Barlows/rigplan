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
    ("csv", "csv-test.html"),
    ("csvrt", "csv-roundtrip-test.html"),
    ("sld", "sld-test.html"),
    ("underlay", "underlay-test.html"),
]

# Suites that read a file and print what they saw as text rather than as
# pass/fail cases. They are still run — a crash in them would otherwise go
# unnoticed — but they report their output instead of a tally.
INSPECTION = {"underlay"}

# Suites that fetch something. Chrome's virtual clock runs ahead of real time,
# so the budget can expire while a request is still in flight and the DOM gets
# captured before the page has written anything. More budget is the fix; the
# retry below is for the rest.
BUDGET = {"underlay": 20000}

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


# A page that says how it went. Suites opt in by carrying <pre id="state"> and
# setting it to "running" at the start and "done" or "error" at the end.
HAS_STATE = 'id="state"'


def state_of(dom):
    m = re.search(r'id="state"[^>]*>(.*?)</pre>', dom, re.S)
    return strip_tags(m.group(1)) if m else None


def failure_text(dom):
    m = re.search(r'id="o"[^>]*>(.*?)</pre>', dom, re.S)
    return strip_tags(m.group(1)) if m else ""


def strip_tags(html):
    # Script and style content is text between tags, not markup, so it survives
    # a tag strip and ends up read as if it were the page's own words. The
    # failing-check names were then followed by the whole test program.
    html = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
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
    """The failing case names and, where the page reports them, the values.

    A count of failures alone is not enough to act on; the got/want pair is
    what tells you which of two possible mistakes was made.

    Two page formats are handled: the `.case` blocks the other suites use, and
    the plain "✕ name — detail" lines the diagram suite prints. Both exist
    because both were written for reading by eye in a browser, and a runner that
    only understood one of them would report "nothing failed" on the other.
    """
    out = []
    for block in re.findall(r'<div class="case fail">(.*?)</div>\s*(?:</div>|<div class="case)', dom, re.S):
        name = re.search(r'<div class="name">(.*?)</div>', block, re.S)
        detail = re.search(r'<div class="detail">(.*?)</div>', block, re.S)
        out.append((strip_tags(name.group(1)) if name else "?",
                    strip_tags(detail.group(1)) if detail else ""))
    if out:
        return out
    text = strip_tags(dom)
    # Split on the tick marks and keep the pieces that follow a cross. Splitting
    # on the marks rather than matching around them means a name containing
    # punctuation, a digit run or a stray cross cannot truncate the list.
    pieces = re.split(r"[✓✔✕✗]", text)
    if len(pieces) < 3:
        return out
    marks = re.findall(r"[✓✔✕✗]", text)
    for i, piece in enumerate(pieces[1:]):
        if marks[i] not in "✕✗":
            continue
        piece = piece.strip()
        if not piece:
            continue
        name, _, detail = piece.partition(" — ")
        # drop anything after the tally, which follows the last check
        name = re.split(r"\d+\s*/\s*\d+\s*checks passed", name)[0].strip()
        out.append((name, detail.strip()))
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
    checked = []          # suites that were supposed to produce a tally

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
        budget = BUDGET.get(name, 8000)
        try:
            dom = dump_dom(chrome, url, budget)
        except subprocess.TimeoutExpired:
            print("  %-12s TIMED OUT after 90 s" % name)
            failed_suites.append(name)
            continue

        # An empty result from a page that fetches is a timing artefact, not a
        # failure: the virtual clock expired mid-request. One retry distinguishes
        # the two, and a genuine empty page is still empty the second time.
        if len(strip_tags(dom)) < 60 and name in BUDGET:
            dom = dump_dom(chrome, url, budget * 2)
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

        # A suite that carries a #state marker is telling us what happened to
        # it. Without one, an empty result is ambiguous — threw, hung, or never
        # started all leave a placeholder — and guessing between them costs more
        # than writing the marker once.
        body = strip_tags(dom)
        if HAS_STATE in dom:
            state = state_of(dom)
            if state == "error":
                print("  %-12s FAILED — the page caught its own failure:" % name)
                for line in failure_text(dom).splitlines()[:12]:
                    print("      %s" % line)
                failed_suites.append(name)
                continue
            if state != "done":
                # Still on the placeholder. Either it hung, or the budget expired
                # before it finished. Both are worth one retry with more time.
                if len(strip_tags(dump_dom(chrome, url, budget * 3))) < 60:
                    print("  %-12s NEVER FINISHED — state is still %r" % (name, state))
                    failed_suites.append(name)
                    continue
                dom = dump_dom(chrome, url, budget * 3)
                body = strip_tags(dom)
        elif len(body) < 60:
            print("  %-12s RENDERED NOTHING (%d chars) and has no #state marker, so\n"
                  "               there is no way to tell a throw from a hang — see below" % (name, len(body)))
            failed_suites.append(name)
            continue
        elif "running…" in body:
            print("  %-12s DID NOT FINISH — the page threw before writing its results" % name)
            failed_suites.append(name)
            continue

        fails = failures_of(dom)

        checked.append(name)
        m = re.search(r"(\d+)\s*/\s*(\d+)\s*checks passed", body)
        if not m:
            print("  %-12s UNREADABLE — no tally found in the page" % name)
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

    return total_ok, total, failed_suites, checked


def untracked_reads():
    """Test pages that fetch a file the repository does not contain.

    This is not hypothetical. The underlay suite fetched test/fixture.dxf, which
    .gitignore excluded with a blanket `test/*.dxf`. It passed on every local
    run for months, because the file was lying on disk, and failed immediately on
    a fresh clone. Nothing about the test itself had changed.

    A test page reading a sibling file has two extra ways to fail that have
    nothing to do with what it is testing, and only one of them is visible from
    the working tree. This catches the other.
    """
    problems = []
    tracked = set()
    try:
        out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, timeout=20)
        tracked = set(line for line in out.stdout.decode("utf-8", "replace").splitlines() if line)
    except (OSError, subprocess.SubprocessError):
        return problems          # not a git checkout; nothing to check against

    for name in sorted(os.listdir(os.path.join(ROOT, "test"))):
        if not name.endswith(".html"):
            continue
        path = os.path.join("test", name)
        with open(os.path.join(ROOT, path), encoding="utf-8") as f:
            text = f.read()
        for m in re.finditer(r"""fetch\(\s*['"]([^'"]+)['"]""", text):
            ref = m.group(1)
            if ref.startswith(("http://", "https://", "/", "data:")):
                continue
            target = os.path.normpath(os.path.join("test", ref.split("?")[0]))
            if target in tracked:
                continue
            problems.append("%s fetches %s, which is not in the repository" % (path, target))
    return problems


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

    # Checked before anything is rendered, and independently of it: a page that
    # reads a file the repository does not contain fails on a fresh clone and
    # nowhere else, so the failure only ever appears on someone else's machine.
    reads = untracked_reads()
    if reads:
        print("a test page reads a file that is not in the repository:")
        for e in reads:
            print("  %s" % e)
        print("inline the data in the page instead — see test/underlay-test.html")
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
        ok, total, failed, checked = run(chrome, port, args.names)
    finally:
        httpd.shutdown()

    print("")
    if total:
        print("%d / %d checks passed" % (ok, total))
    if failed:
        print("FAILED suites: %s" % ", ".join(failed))
        return 1
    # Every requested suite was an inspection suite. That is a deliberate choice,
    # not a run that silently checked nothing, so it is not a failure — but it is
    # worth saying so, because "no failures" and "nothing was verified" are
    # different claims and the difference matters when a pipeline goes green.
    if not checked:
        print("no counted suites requested — only inspection suites ran, so nothing was verified")
        return 0
    if not total:
        print("no checks ran — that is not a pass")
        return 2
    print("all suites green")
    return 0


if __name__ == "__main__":
    sys.exit(main())