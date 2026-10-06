#!/usr/bin/env python3
"""
Local Xtream Codes IPTV player.

    python3 iptv.py
    then open http://127.0.0.1:8765 in Chrome

Why a script at all
------------------
An IPTV panel answers your browser's requests, and almost none of them carry an
`Access-Control-Allow-Origin` header. Without that header the browser refuses to
hand the reply to JavaScript -- not because anything is broken, but because it
cannot tell that your page and the panel are safe to talk to each other. No
amount of JavaScript on the page fixes this; the request has to leave from your
machine as a plain HTTP call, which is what this script does.

So: your browser talks to 127.0.0.1, this script talks to your provider. Video
segments are relayed through here too, for the same reason, with HTTP range
requests preserved so seeking still works.

No packages to install. Credentials are held in this process's memory only and
are never written to disk.
"""

import hashlib
import http.server
import json
import re
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ElementTree
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8765
HERE = Path(__file__).resolve().parent
STATIC = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/style.css": "style.css"}

# Credentials live here, in RAM, for as long as the script runs. Shared between
# request threads -- the box is single-user, and assigning is atomic under the
# GIL, so no lock is warranted.
SESSION = {"base": None, "user": None, "password": None}

# Channels under one account, so playback is not cut off by a shared browser.
MAX_CONCURRENT_STREAMS = 4

_epg_lock = threading.Lock()


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def normalise_base(raw):
    """Accept 'host:port', 'host', or a full URL. Return a clean base URL.

    A trailing slash and any /panel style path prefix are both preserved, since
    plenty of panels live behind one.
    """
    text = (raw or "").strip()
    if not text:
        raise ValueError("Server address is required.")
    if not text.startswith(("http://", "https://")):
        text = "http://" + text
    text = text.rstrip("/")

    parts = urllib.parse.urlsplit(text)
    if not parts.hostname:
        raise ValueError("That does not look like a server address.")
    if parts.scheme not in ("http", "https"):
        raise ValueError("Server must be http or https.")
    if not parts.port and parts.scheme == "http":
        # Xtream panels are overwhelmingly plain http on a high port. 80 is a
        # valid guess and beats refusing outright, so only flag it below.
        pass
    return text


def redacted(url):
    """Strip the password out of anything about to be printed."""
    return re.sub(r"((?:password|pass)=)[^&\s]+", r"\1***", url or "", flags=re.I)


def build(base, path, query=None):
    """Assemble a provider URL from an explicit base."""
    url = base + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    return url


def upstream(path, query=None):
    """Build a full provider URL from a path such as '/player_api.php'."""
    if not SESSION["base"]:
        raise ValueError("Not logged in.")
    return build(SESSION["base"], path, query)


def is_playlist(content_type, path):
    ctype = (content_type or "").lower()
    lowered = (path or "").lower()
    return ("mpegurl" in ctype
            or lowered.endswith(".m3u8")
            or lowered.endswith(".m3u")
            or lowered.endswith(".php") and "mpegurl" in ctype)


def to_local_absolute(url):
    """Send an absolute provider/CDN URL back through this script."""
    return "/abs?u=" + urllib.parse.quote(url, safe="")


# Stream kinds an Xtream panel builds its URLs out of.
STREAM_KINDS = ("live", "movie", "series", "hls", "live_stream")


def localise_url(url):
    """Re-point one provider URL at us, keeping the password out of the browser.

    Xtream spells a stream as <base>/<kind>/<user>/<pass>/<file>. The browser
    only ever needs the kind and the filename, because this script already
    knows the credentials -- so it sends /stream/<kind>/<file> instead. That
    keeps the password out of devtools and out of the page.

    The path shape matters for a second reason: a segment written as `43.ts`
    inside a manifest is resolved by the browser against the manifest's own
    URL, so /stream/live/42.ts has to resolve to /stream/live/43.ts. A
    query-string URL could not do that.
    """
    if not url.startswith(("http://", "https://")):
        return url

    base = SESSION["base"]
    if base and url.startswith(base + "/"):
        rest = url[len(base) + 1:]
        parts = rest.split("/")
        if (len(parts) >= 3
                and parts[0] in STREAM_KINDS
                and parts[1] == SESSION["user"]
                and parts[2] == SESSION["password"]):
            return "/stream/" + "/".join([parts[0]] + parts[3:])

    return to_local_absolute(url)


def rewrite_json(node):
    """Walk decoded JSON, re-pointing every absolute URL at us."""
    if isinstance(node, str):
        if node.startswith(("http://", "https://")):
            return localise_url(node)
        return node
    if isinstance(node, list):
        return [rewrite_json(item) for item in node]
    if isinstance(node, dict):
        return {key: rewrite_json(value) for key, value in node.items()}
    return node


def fetch(url, headers=None, timeout=30):
    """Plain GET. Never negotiates compression -- we need to read the bytes."""
    request = urllib.request.Request(url, headers={"Accept-Encoding": "identity", **(headers or {})})
    return urllib.request.urlopen(request, timeout=timeout)


# --------------------------------------------------------------------------
# EPG (program guide). Optional -- a panel without EPG must not break playback.
# --------------------------------------------------------------------------

def epg_cache_path():
    fingerprint = hashlib.sha1(
        f"{SESSION['base']}|{SESSION['user']}".encode("utf-8", "replace")
    ).hexdigest()[:12]
    return Path(tempfile.gettempdir()) / f"iptv-epg-{fingerprint}.xml"


def ensure_epg():
    """Download the guide once and cache it on disk for six hours."""
    path = epg_cache_path()
    if path.exists() and (time.time() - path.stat().st_mtime) < 6 * 3600:
        return path

    url = upstream("/xmltv.php", {"username": SESSION["user"], "password": SESSION["password"]})
    partial = path.with_suffix(".part")
    with fetch(url, timeout=180) as response, open(partial, "wb") as handle:
        while True:
            chunk = response.read(262144)
            if not chunk:
                break
            handle.write(chunk)
    partial.replace(path)
    return path


def parse_epg_time(stamp):
    """'20240115203000 +0000' -> '2024-01-15 20:30' in the panel's own offset."""
    text = (stamp or "").strip()
    match = re.match(r"^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})", text)
    if not match:
        return text
    return f"{match[1]}-{match[2]}-{match[3]} {match[4]}:{match[5]}"


def epg_for_channel(channel_id, limit=200):
    if not channel_id:
        return []
    try:
        path = ensure_epg()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return []          # no guide on this panel; not an error worth shouting about
        raise
    except Exception:
        return []

    wanted = str(channel_id)
    programs = []
    try:
        for _, element in ElementTree.iterparse(str(path), events=("end",)):
            tag = element.tag.split("}")[-1]
            if tag != "programme":
                if tag in ("channel", "icon", "display-name"):
                    element.clear()
                continue
            if element.get("channel") == wanted:
                entry = {
                    "start": parse_epg_time(element.get("start")),
                    "stop": parse_epg_time(element.get("stop")),
                    "title": "",
                    "description": "",
                }
                for child in element:
                    name = child.tag.split("}")[-1]
                    if name == "title" and not entry["title"]:
                        entry["title"] = (child.text or "").strip()
                    elif name == "desc" and not entry["description"]:
                        entry["description"] = (child.text or "").strip()
                programs.append(entry)
                if len(programs) >= limit:
                    break
            element.clear()
    except ElementTree.ParseError:
        return programs      # truncated cache is still worth showing
    return programs


# --------------------------------------------------------------------------
# request handling
# --------------------------------------------------------------------------

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LocalIPTV"

    # -- plumbing ----------------------------------------------------------

    def log_message(self, fmt, *args):
        sys.stderr.write("[iptv] " + redacted(fmt % args) + "\n")

    def is_local(self):
        """Reject anything that is not our own page talking to us.

        Without this, any website you happen to visit could POST to
        127.0.0.1:8765 and drive your account. Cheap to check, so check.

        The port is read from the bound socket rather than the constant, so
        running on an alternative port still works.
        """
        port = self.server.server_address[1]
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}"}
        host = (self.headers.get("Host") or "").strip()
        if host and host not in allowed_hosts:
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}:
            return False
        return True

    def send_payload(self, status, body, content_type, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, payload, status=200):
        self.send_payload(status, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")

    def read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if not length or length > 65536:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return {}

    def require_session(self):
        if not SESSION["base"]:
            self.send_json({"error": "Not logged in."}, 401)
            return False
        return True

    # -- routing -----------------------------------------------------------

    def do_GET(self):
        if not self.is_local():
            self.send_json({"error": "Local requests only."}, 403)
            return
        route = urllib.parse.urlsplit(self.path)
        path, query = route.path, urllib.parse.parse_qs(route.query)

        if path in STATIC:
            return self.serve_static(STATIC[path])
        if path == "/api":
            return self.serve_api(query)
        if path == "/epg":
            return self.serve_epg(query)
        if path.startswith("/stream/"):
            return self.serve_stream(path[len("/stream/"):])
        if path == "/abs":
            return self.serve_absolute(query)
        if path == "/session":
            return self.serve_session()
        self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        if not self.is_local():
            self.send_json({"error": "Local requests only."}, 403)
            return
        path = urllib.parse.urlsplit(self.path).path
        if path == "/login":
            return self.serve_login()
        if path == "/logout":
            SESSION.update({"base": None, "user": None, "password": None,
                            "user_info": None, "max_streams": 1})
            return self.send_json({"ok": True})
        self.send_json({"error": "Not found"}, 404)

    def do_HEAD(self):
        self.do_GET()

    # -- static ------------------------------------------------------------

    def serve_static(self, name):
        file = HERE / name
        if not file.is_file():
            return self.send_json({"error": f"{name} is missing next to iptv.py"}, 404)
        types = {".html": "text/html; charset=utf-8",
                 ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8"}
        kind = types.get(file.suffix, "application/octet-stream")
        self.send_payload(200, file.read_bytes(), kind)

    # -- login -------------------------------------------------------------

    def serve_login(self):
        body = self.read_json_body()
        try:
            base = normalise_base(body.get("server"))
            user = (body.get("username") or "").strip()
            password = body.get("password") or ""
        except ValueError as error:
            return self.send_json({"error": str(error)}, 400)

        if not user or not password:
            return self.send_json({"error": "Username and password are both required."}, 400)

        credentials = {"username": user, "password": password}
        try:
            with fetch(build(base, "/player_api.php", credentials), timeout=20) as response:
                payload = json.loads(response.read(4 * 1024 * 1024) or b"{}")
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                return self.send_json({"error": "The provider rejected that username or password."}, 401)
            return self.send_json({"error": f"Provider returned HTTP {error.code}.", "detail": f"GET {redacted(base)}/player_api.php"}, 502)
        except urllib.error.URLError as error:
            reason = getattr(error, "reason", error)
            if isinstance(reason, socket.timeout):
                return self.send_json({"error": "The provider did not answer in time. Check the address and port."}, 504)
            return self.send_json({"error": f"Could not reach {base} -- {reason}"}, 502)
        except json.JSONDecodeError:
            return self.send_json({"error": "That address answered, but not with an Xtream Codes panel. Check the port."}, 502)

        if not isinstance(payload, dict) or "user_info" not in payload:
            return self.send_json({"error": "Connected, but this is not an Xtream Codes panel."}, 502)

        user_info = payload.get("user_info") or {}
        if str(user_info.get("auth", 1)).lower() in ("0", "false", "no", ""):
            return self.send_json({"error": "The provider rejected that username or password."}, 401)

        status = str(user_info.get("status", "Active")).lower()
        if status not in ("active", "enabled", "trial"):
            return self.send_json({"error": f"This account is {status}. The provider may need to enable it."}, 403)

        try:
            allowed = int(user_info.get("max_connections") or 1)
        except (TypeError, ValueError):
            allowed = 1

        SESSION.update({"base": base, "user": user, "password": password,
                        "user_info": user_info, "max_streams": allowed})
        self.send_json({
            "ok": True,
            "base": base,
            "server_info": rewrite_json(payload.get("server_info") or {}),
            "user_info": rewrite_json(user_info),
            "maxStreams": max(1, min(MAX_CONCURRENT_STREAMS, allowed)),
        })

    # -- session restore ---------------------------------------------------

    def serve_session(self):
        """Let a reloaded page pick up a session that is still live.

        Only a summary goes back. The password stays here.
        """
        if not SESSION["base"]:
            return self.send_json({"loggedIn": False})
        self.send_json({
            "loggedIn": True,
            "base": SESSION["base"],
            "user_info": rewrite_json(SESSION.get("user_info") or {}),
            "maxStreams": max(1, min(MAX_CONCURRENT_STREAMS, int(SESSION.get("max_streams") or 1))),
        })

    # -- api passthrough ---------------------------------------------------

    def serve_api(self, query):
        if not self.require_session():
            return
        action = (query.get("action") or [None])[0]
        params = {"username": SESSION["user"], "password": SESSION["password"]}
        if action:
            params["action"] = action
        for key, values in query.items():
            if key in ("action", "username", "password") or not values:
                continue
            params[key] = values[0]

        try:
            with fetch(upstream("/player_api.php", params), timeout=45) as response:
                raw = response.read(64 * 1024 * 1024)
        except urllib.error.HTTPError as error:
            body = error.read(4096).decode("utf-8", "replace")
            return self.send_json({"error": f"Provider returned HTTP {error.code}.", "detail": body}, 502)
        except urllib.error.URLError as error:
            return self.send_json({"error": f"Provider unreachable -- {getattr(error, 'reason', error)}"}, 502)
        except TimeoutError:
            return self.send_json({"error": "The provider timed out."}, 504)

        try:
            parsed = json.loads(raw or b"null")
        except json.JSONDecodeError:
            return self.send_json({"error": "Provider sent a reply that was not JSON."}, 502)

        self.send_payload(200, json.dumps(rewrite_json(parsed)).encode("utf-8"),
                          "application/json; charset=utf-8")

    # -- epg ---------------------------------------------------------------

    def serve_epg(self, query):
        if not self.require_session():
            return
        channel_id = (query.get("channel_id") or [""])[0]
        if not channel_id:
            return self.send_json({"error": "channel_id is required."}, 400)
        with _epg_lock:            # one guide parse at a time; it is not cheap
            self.send_json({"ok": True, "channel_id": channel_id, "programs": epg_for_channel(channel_id)})

    # -- media -------------------------------------------------------------

    def serve_stream(self, relative):
        """A stream request of the form <kind>/<filename>, credentials filled in here.

        The browser sends /stream/live/42.m3u8 or /stream/live/43.ts; the panel
        wants /<kind>/<user>/<password>/<filename>.
        """
        if not self.require_session():
            return
        parts = [p for p in relative.split("/") if p not in ("", ".")]
        if len(parts) < 2 or parts[0] not in STREAM_KINDS:
            return self.send_json({"error": "Bad stream path."}, 400)
        if any(p == ".." or "\\" in p for p in parts):
            return self.send_json({"error": "Bad stream path."}, 400)
        if not all(re.fullmatch(r"[A-Za-z0-9._~\-%]+", p) for p in parts):
            return self.send_json({"error": "Bad stream path."}, 400)

        kind, filename = parts[0], "/".join(parts[1:])
        path = f"/{kind}/{SESSION['user']}/{SESSION['password']}/{filename}"
        self.relay(upstream(path), path)

    def serve_absolute(self, query):
        if not self.require_session():
            return
        target = (query.get("u") or [""])[0]
        if not target.startswith(("http://", "https://")):
            return self.send_json({"error": "Bad URL."}, 400)
        self.relay(target, target)

    def relay(self, url, label):
        """Forward a request to the provider, optionally rewriting an HLS manifest.

        Range headers are passed through, which is what makes seeking work.
        """
        headers = {"Accept-Encoding": "identity"}
        if self.headers.get("Range"):
            headers["Range"] = self.headers["Range"]

        try:
            response = fetch(url, headers=headers, timeout=45)
        except urllib.error.HTTPError as error:
            detail = error.read(2048)
            self.send_payload(error.code, detail,
                              error.headers.get("Content-Type", "text/plain; charset=utf-8"))
            return
        except urllib.error.URLError as error:
            self.send_json({"error": f"Stream unreachable -- {getattr(error, 'reason', error)}"}, 502)
            return
        except TimeoutError:
            self.send_json({"error": "Stream timed out."}, 504)
            return

        with response:
            content_type = response.headers.get("Content-Type", "")
            passthrough = ("Accept-Ranges", "Content-Range")

            if is_playlist(content_type, label):
                return self.send_manifest(response.read(8 * 1024 * 1024))

            self.send_response(response.status)
            self.send_header("Content-Type", content_type or "application/octet-stream")
            for key in passthrough:
                if response.headers.get(key):
                    self.send_header(key, response.headers[key])
            length = response.headers.get("Content-Length")
            if length:
                self.send_header("Content-Length", length)
            else:
                # No length: the provider is streaming and never will end.
                self.send_header("Connection", "close")
                self.close_connection = True
            self.end_headers()

            if self.command == "HEAD":
                return
            try:
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass    # the viewer seeked away or closed the tab. Expected.

    def send_manifest(self, response_bytes):
        """Re-point every URL in an m3u8 back through this script.

        Relative segment URLs need no rewriting: the browser resolves them
        against this manifest's own URL, which is already ours.
        """
        text = response_bytes.decode("utf-8", "replace")
        rewritten = re.sub(r"https?://[^\s\"']+", lambda m: localise_url(m.group(0)), text)
        self.send_payload(200, rewritten.encode("utf-8"), "application/vnd.apple.mpegurl")


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    port = PORT
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])

    try:
        server = Server((HOST, port), Handler)
    except OSError as error:
        sys.exit(f"Cannot listen on port {port}: {error}\n"
                 f"Another copy may already be running. Try:  python3 iptv.py {port + 1}")

    print(f"\n  Local IPTV player ready")
    print(f"  Open   http://{HOST}:{port}\n")
    print("  Ctrl-C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()