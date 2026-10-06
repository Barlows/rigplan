#!/usr/bin/env python3
"""
Self-test for the IPTV player.

    python3 selftest.py

Stands up a fake IPTV panel on this machine and drives the real iptv.py against
it, so you can check the player works -- sign-in, playlists, video relaying,
seeking, the guide -- without touching your subscription or needing a provider.

What this cannot prove: that a *real* picture appears. The fake panel serves
synthetic segment bytes that no decoder can turn into video. So a full pass here
means the machinery is sound; it does not promise your provider is reachable or
that Chrome can decode your channels. For that, see README.md.
"""

import json
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
USER, PASSWORD = "demo", "s3cr3t"

PASSED, FAILED = [], []


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


# --------------------------------------------------------------- fake panel

class Panel(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    @property
    def base(self):
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def send(self, body, ctype="application/json", status=200, extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(parts.query)

        if parts.path == "/player_api.php":
            if (query.get("username", [""])[0] != USER
                    or query.get("password", [""])[0] != PASSWORD):
                return self.send({"error": "bad credentials"}, status=401)

            action = query.get("action", [""])[0]
            if not action:
                return self.send({
                    "user_info": {"username": USER, "auth": 1, "status": "Active",
                                  "exp": "0", "max_connections": "2"},
                    "server_info": {"url": "127.0.0.1", "port": str(self.server.server_address[1]),
                                    "server_protocol": "http", "timezone": "UTC"},
                })
            if action == "get_series_info":
                return self.send({
                    "info": {"name": "A Show"},
                    "episodes": {"Season 1": [
                        {"id": 31, "episode_num": 1, "title": "Pilot",
                         "direct_source": f"{self.base}/series/{USER}/{PASSWORD}/31.m3u8"},
                        {"id": 32, "episode_num": 2, "title": "Second"},
                    ]},
                })
            return self.send({
                "get_live_categories": [{"category_id": "1", "category_name": "News"},
                                        {"category_id": "2", "category_name": "Sport"}],
                "get_live_streams": [
                    {"num": 1, "name": "Alpha HD", "stream_id": 1, "stream_type": "live",
                     "stream_icon": "", "epg_channel_id": "alpha.tv", "category_id": "1",
                     "direct_source": f"{self.base}/live/{USER}/{PASSWORD}/1.m3u8"},
                    {"num": 2, "name": "Beta 8K", "stream_id": 2, "stream_type": "live",
                     "stream_icon": "", "epg_channel_id": "", "category_id": "2"},
                ],
                "get_vod_categories": [{"category_id": "9", "category_name": "Films"}],
                "get_vod_streams": [{"num": 9, "name": "A Film", "stream_id": 9,
                                     "container_extension": "mkv", "year": "2021"}],
                "get_series_categories": [{"category_id": "5", "category_name": "Shows"}],
                "get_series": [{"num": 3, "title": "A Show", "series_id": 3,
                                "total_episodes": 2}],
            }.get(action, []))

        if parts.path == "/xmltv.php":
            return self.send(
                '<?xml version="1.0" encoding="UTF-8"?><tv>'
                '<channel id="alpha.tv"><display-name>Alpha HD</display-name></channel>'
                '<programme start="20240115200000 +0000" stop="20240115210000 +0000" channel="alpha.tv">'
                '<title>Evening News</title></programme>'
                '<programme start="20240115210000 +0000" stop="20240115220000 +0000" channel="alpha.tv">'
                '<title>Late News</title></programme>'
                '<programme start="20240115220000 +0000" stop="20240115230000 +0000" channel="other.tv">'
                '<title>Belongs To Another Channel</title></programme></tv>',
                "application/xml")

        if parts.path.endswith(".m3u8"):
            name = parts.path.rsplit("/", 1)[-1].replace(".m3u8", "")
            body = (
                "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n"
                '#EXT-X-STREAM-INF:BANDWIDTH=12000000,CODECS="hvc1.2.4.L123.B0"\n'
                f"#EXTINF:4.0,\n{name}.ts\n"
                f"#EXTINF:4.0,\n{self.base}/live/{USER}/{PASSWORD}/2.ts\n"
                "#EXTINF:4.0,\nhttp://cdn.example.com/live/3.ts\n"
                "#EXT-X-ENDLIST\n"
            )
            return self.send(body, "application/vnd.apple.mpegurl")

        if parts.path.endswith(".ts"):
            data = bytes(range(256)) * 40          # synthetic; not real video
            span = self.headers.get("Range")
            if span and span.startswith("bytes="):
                start_s, _, end_s = span.split("=", 1)[1].partition("-")
                start = int(start_s or 0)
                end = int(end_s) if end_s else len(data) - 1
                return self.send(data[start:end + 1], "video/mp2t", status=206, extra={
                    "Content-Range": f"bytes {start}-{end}/{len(data)}",
                    "Accept-Ranges": "bytes"})
            return self.send(data, "video/mp2t", extra={"Accept-Ranges": "bytes"})

        self.send({"error": "not found"}, status=404)


# ------------------------------------------------------------------ helpers

def check(label, passed, detail=""):
    (PASSED if passed else FAILED).append(label)
    print(("  ok   " if passed else "  FAIL ") + label
          + (f"    {detail}" if detail and not passed else ""))


def get(url, headers=None, expect_json=True):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read()
            parsed = json.loads(body) if expect_json and body[:1] in (b"{", b"[") else body
            return response.status, parsed, response
    except urllib.error.HTTPError as error:
        body = error.read()
        try:
            return error.code, json.loads(body), error
        except json.JSONDecodeError:
            return error.code, body, error


def post(url, payload):
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


# --------------------------------------------------------------------- main

panel_port, helper_port = free_port(), free_port()
panel = ThreadingHTTPServer(("127.0.0.1", panel_port), Panel)
panel.daemon_threads = True
threading.Thread(target=panel.serve_forever, daemon=True).start()

helper = subprocess.Popen([sys.executable, str(HERE / "iptv.py"), str(helper_port)],
                          cwd=str(HERE), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
BASE = f"http://127.0.0.1:{helper_port}"
PANEL_BASE = f"http://127.0.0.1:{panel_port}"

for _ in range(50):                      # give the helper a moment to bind
    try:
        get(BASE + "/")
        break
    except OSError:
        time.sleep(0.1)

try:
    print("\nguards")
    status, _, _ = get(f"{BASE}/api?action=get_live_categories")
    check("a signed-out api call is refused", status == 401, f"got {status}")
    status, _, _ = get(f"{BASE}/")
    check("the page is served", status == 200, f"got {status}")
    status, _, _ = get(f"{BASE}/api?action=get_live_categories",
                       headers={"Origin": "http://evil.example"})
    check("a request from another website is refused", status == 403, f"got {status}")

    print("\nsign-in")
    status, body = post(f"{BASE}/login",
                        {"server": f"127.0.0.1:{panel_port}", "username": USER, "password": "wrong"})
    check("a wrong password is rejected", status == 401, f"got {status} {body}")
    status, body = post(f"{BASE}/login",
                        {"server": PANEL_BASE, "username": USER, "password": PASSWORD})
    check("correct credentials sign in", status == 200 and body.get("ok"), f"got {status} {body}")
    check("the username comes back", body.get("user_info", {}).get("username") == USER)
    check("the password does NOT come back to the page", PASSWORD not in json.dumps(body))
    check("the connection limit is read", body.get("maxStreams") == 2, str(body.get("maxStreams")))

    print("\nafter a reload")
    status, session, _ = get(f"{BASE}/session")
    check("a live session can be picked back up", status == 200 and session.get("loggedIn"),
          f"{status} {session}")
    check("the restored session carries no password", PASSWORD not in json.dumps(session))
    status, _, _ = get(f"{BASE}/status")
    check("the old reload-loop endpoint is gone", status == 404, f"got {status}")

    print("\nplaylists")
    status, categories, _ = get(f"{BASE}/api?action=get_live_categories")
    check("live categories load", len(categories) == 2, str(categories))
    status, streams, _ = get(f"{BASE}/api?action=get_live_streams")
    check("live channels load", len(streams) == 2, str(streams))
    check("a stream url is rewritten to hide the password",
          streams[0]["direct_source"] == "/stream/live/1.m3u8", streams[0]["direct_source"])
    status, movies, _ = get(f"{BASE}/api?action=get_vod_streams")
    check("films load with their file type", movies[0]["container_extension"] == "mkv")
    status, series, _ = get(f"{BASE}/api?action=get_series_info&series_id=3")
    check("episodes load for a series",
          series["episodes"]["Season 1"][0]["direct_source"] == "/stream/series/31.m3u8",
          series["episodes"]["Season 1"][0]["direct_source"])

    print("\nvideo")
    status, manifest, _ = get(f"{BASE}/stream/live/1.m3u8", expect_json=False)
    manifest = manifest.decode()
    check("the playlist is served", status == 200 and manifest.startswith("#EXTM3U"), manifest[:60])
    # A relative segment is left alone on purpose: the browser resolves it
    # against the playlist's own url. Assert the resolution actually works.
    resolved = urllib.parse.urljoin(f"{BASE}/stream/live/1.m3u8", "1.ts")
    check("a relative segment stays relative in the text", "\n1.ts\n" in manifest, manifest)
    check("it resolves to our own address", resolved == f"{BASE}/stream/live/1.ts", resolved)
    status, body, _ = get(resolved, expect_json=False)
    check("the resolved segment is served", status == 200 and len(body) == 10240,
          f"{status} {len(body) if isinstance(body, bytes) else body}")
    check("an absolute panel segment is rewritten", "/stream/live/2.ts" in manifest, manifest)
    check("a third-party segment is routed through us",
          "/abs?u=http%3A%2F%2Fcdn.example.com" in manifest, manifest)
    check("the codec tag survives rewriting", 'CODECS="hvc1.2.4.L123.B0"' in manifest)
    check("the playlist never contains the password", PASSWORD not in manifest)

    status, body, response = get(f"{BASE}/stream/live/1.ts", expect_json=False)
    check("a segment is served", status == 200 and len(body) == 10240, f"{status}")
    check("Accept-Ranges is passed through", response.headers.get("Accept-Ranges") == "bytes")
    status, part, response = get(f"{BASE}/stream/live/1.ts",
                                headers={"Range": "bytes=10-19"}, expect_json=False)
    check("a range request is honoured, so seeking works", status == 206 and len(part) == 10,
          f"{status} {len(part)}")
    check("Content-Range is passed through", "bytes 10-19" in (response.headers.get("Content-Range") or ""))
    status, _, _ = get(f"{BASE}/stream/live/../../../etc/passwd")
    check("a path-traversal attempt is refused", status in (400, 404), f"got {status}")

    print("\nguide")
    status, guide, _ = get(f"{BASE}/epg?channel_id=alpha.tv")
    titles = [program["title"] for program in guide["programs"]]
    check("only the channel you asked for comes back",
          titles == ["Evening News", "Late News"], str(titles))
    check("times are formatted", guide["programs"][0]["start"] == "2024-01-15 20:00",
          guide["programs"][0]["start"])

    print("\nsign-out")
    status, _ = post(f"{BASE}/logout", {})
    check("sign-out succeeds", status == 200)
    status, _, _ = get(f"{BASE}/api?action=get_live_categories")
    check("the session is really gone", status == 401, f"got {status}")
    status, session, _ = get(f"{BASE}/session")
    check("it reports signed out afterwards", session.get("loggedIn") is False, str(session))

finally:
    helper.terminate()
    try:
        helper.wait(timeout=5)
    except subprocess.TimeoutExpired:
        helper.kill()
    panel.shutdown()

print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
if FAILED:
    print("failed: " + "; ".join(FAILED))
print("\nA clean run means the player is sound. It does not mean a real")
print("picture will appear: the fake panel has no real video in it, and it")
print("cannot tell you whether your provider is reachable. Test that by")
print("signing in for real -- see README.md.\n")
sys.exit(1 if FAILED else 0)