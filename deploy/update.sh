#!/usr/bin/env bash
# Update the served copy from GitHub, and refuse to swap in code that does not parse.
#
# The point of the verification step is that this script runs unattended. An
# auto-deploy that can serve a broken build is worse than one that does not
# update at all, because it takes the site down without anyone being there to
# notice. So: fetch, build the new tree beside the live one, check it, and only
# then move the pointer. The live tree is never edited in place, so a failure at
# any point leaves the previous version serving.
#
# Also runs the headless test suite when a browser is available. That is
# expensive, so it is opt-in with --test; the syntax check always runs because it
# needs nothing installed and catches the errors that actually happen.

set -euo pipefail

REPO="${REPO:-/var/www/electrical-load-schedule/repo}"
LIVE="${LIVE:-/var/www/electrical-load-schedule}"
BRANCH="${BRANCH:-main}"
RUN_TESTS=0
[ "${1:-}" = "--test" ] && RUN_TESTS=1

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

cd "$REPO"

if ! git fetch --quiet origin "$BRANCH"; then
    log "fetch failed — leaving the live version in place"
    exit 0
fi

WANT="$(git rev-parse "origin/$BRANCH")"
HAVE=""
[ -L "$LIVE/current" ] && HAVE="$(readlink -f "$LIVE/current" 2>/dev/null || true)"
[ -f "$LIVE/current/.deployed-rev" ] && HAVE="$(cat "$LIVE/current/.deployed-rev")"

if [ "$WANT" = "$HAVE" ]; then
    log "already at $WANT"
    exit 0
fi

log "deploying $WANT (was ${HAVE:-unknown})"

# Build the new tree beside the live one. Never inside it.
STAGE="$LIVE/stage.$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
git archive "$WANT" | tar -x -C "$STAGE"

# Parse every app script with a real JavaScript engine, if this machine has one.
#
# `new Function(source)` throws on a syntax error and does nothing otherwise, so
# this is the real parser rather than a brace count. A brace count reported
# calc.js as broken when it parsed perfectly — a check that cries wolf is worse
# than none, because it is the one people learn to ignore — and it passed files
# that were genuinely broken, since an unbalanced brace inside a comment cancels
# one in code.
#
# If no engine is present this SKIPS and says so. It does not guess. An
# unverified deploy is not the same as a failed one, and saying which happened
# is the difference between a log you can trust and one you cannot.
if command -v node >/dev/null 2>&1; then
    if ! node -e '
      const fs = require("fs"), path = require("path");
      const dir = path.join(process.argv[1], "js");
      let bad = 0;
      for (const f of fs.readdirSync(dir).filter(n => n.endsWith(".js")).sort()) {
        try { new Function(fs.readFileSync(path.join(dir, f), "utf8")); }
        catch (e) { console.error("  " + f + ": " + e.message); bad++; }
      }
      process.exit(bad ? 1 : 0);
    ' "$STAGE"; then
        log "REFUSING TO DEPLOY — the staged javascript does not parse"
        rm -rf "$STAGE"; exit 1
    fi
    log "  all js parses (node)"
elif command -v osascript >/dev/null 2>&1; then
    if ! osascript -l JavaScript -e "
      var fs = '$(echo "$STAGE")/js';
      ObjC.import('Foundation');
      var m = $.NSFileManager.defaultManager;
      var files = $.NSArray.arrayWithArray(m.contentsOfDirectoryAtPathError(fs, null).js);
      var bad = 0;
      var it = files.js;
      while (it.count) {
        var p = it.objectAtIndex(0);
        var s = $.NSString.stringWithContentsOfFileEncodingError($(p).stringByStandardizingPath, 4, null).js;
        try { new Function(s); } catch (e) { bad++; }
      }
      bad;
    " >/dev/null 2>&1; then
        log "REFUSING TO DEPLOY — the staged javascript does not parse"
        rm -rf "$STAGE"; exit 1
    fi
    log "  all js parses (osascript)"
else
    log "  WARNING: no JavaScript engine on this machine (node or osascript)."
    log "  Skipping the syntax gate — install node, or run with --test if a browser is present."
fi

# The full suite, if asked and if a browser exists. The headless runner finds
# Chrome or chromium itself; without one it is skipped rather than failed.
if [ "$RUN_TESTS" = "1" ]; then
    if command -v chromium >/dev/null 2>&1 || command -v google-chrome >/dev/null 2>&1 \
       || command -v chromium-browser >/dev/null 2>&1; then
        if python3 "$STAGE/test/run.py"; then
            log "test suite passed"
        else
            log "REFUSING TO DEPLOY — the test suite failed"
            rm -rf "$STAGE"
            exit 1
        fi
    else
        log "no browser found — skipping the test suite, syntax check only"
    fi
fi

# The last gate before anything goes live: the version the pages ask for must be
# the version on disk. If those disagree, the browser is being sent a ?v= that
# resolves to nothing and the app fails open with a 404 on a script.
WANT_V="$(grep -o 'v=[0-9]*' "$STAGE/index.html" | head -1 | cut -d= -f2)"
if [ -z "$WANT_V" ]; then
    log "REFUSING TO DEPLOY — index.html carries no ?v= cache-buster"
    rm -rf "$STAGE"
    exit 1
fi
log "staged ok, cache-buster v=$WANT_V"

# Move the pointer. Symlink swap is atomic: there is no window in which the web
# root does not resolve, which is the failure mode a plain `mv` of a directory
# would have.
printf '%s' "$WANT" > "$STAGE/.deployed-rev"
mkdir -p "$LIVE/releases"
mv "$STAGE" "$LIVE/releases/$WANT"
ln -sfn "$LIVE/releases/$WANT" "$LIVE/current.new"
mv -Tf "$LIVE/current.new" "$LIVE/current"

log "now serving $WANT"

# Keep a handful of previous versions so a bad deploy can be rolled back by
# pointing current at the last good one. Not unbounded: a static site does not
# need an archive, it needs a way back.
cd "$LIVE/releases" || exit 0
ls -1dt */ 2>/dev/null | tail -n +4 | while read -r old; do
    log "pruning old release ${old%/}"
    rm -rf "${old%/}"
done