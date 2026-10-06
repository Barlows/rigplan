# IPTV Player

A web player for an Xtream Codes subscription. Put in your server address,
username and password, and the channels, films and series load and play in
ordinary Chrome. No extensions, no plugins, no app to install.

```
python3 iptv.py
```

Then open <http://127.0.0.1:8765>.

Needs Python 3 and Chrome. Nothing to install, no packages, no internet access
beyond your own provider. Use a different port with `python3 iptv.py 9000`.

---

## Why there is a script in the middle

Worth understanding, because it looks like an avoidable extra step.

Your provider's server answers your browser's requests, and almost none of them
include an `Access-Control-Allow-Origin` header. Without that header Chrome
refuses to hand the reply to the page — it cannot tell that your page and the
provider are safe to talk to each other, so it assumes they are not. The usual
symptom is a console error about CORS and a player that stays empty.

No JavaScript on the page can fix this. The request has to leave your machine
as an ordinary HTTP call instead of a browser fetch, which is what `iptv.py`
does. Your browser talks to `127.0.0.1`; the script talks to your provider.
Video segments are relayed through it for the same reason, with HTTP range
requests passed through so seeking still works.

Opening `index.html` straight off the disk will not work, because the same
restriction applies — and more strictly, since a `file://` page has no usable
origin at all. Serving it from `localhost` is the fix, and `iptv.py` does that.

`localhost` also counts as a secure context, so plain `http://` stream URLs from
your provider are not blocked as mixed content. Hosting the page on a LAN
address over `http://` would reintroduce exactly that problem.

## Getting in

| Field | What goes in it |
|---|---|
| Server address | The full address **including** `http://` and the port, e.g. `http://123.45.67.89:25461`. `host:port` on its own is fine too. |
| Username / password | What your provider gave you. |

If the address is rejected, that is usually the port, or an `https://` in front
of a panel that is really plain `http://`.

Works with Xtream Codes panels — the `player_api.php` interface that
IPTV apps, including the ones on a Strong box, use. If your provider instead
gives you a portal URL to paste into a TV box, that is a Stalker/Ministra
panel and this will not connect to it.

## Playing

Click a channel. Playback starts straight away, with no dialogue.

Live TV, films and series are all there. Series go category → show → season →
episode. Right-click anything to save it to **Saved**; the list survives a
restart. Search covers live, films and series at once.

The programme guide appears under the player when your provider publishes one.
It is fetched once and cached on disk for six hours, so a large guide does not
stall playback. A provider with no guide data is not an error.

## Testing it

### 1. Check the player works, without a provider

```
python3 selftest.py
```

This starts a fake IPTV panel on your machine and drives the real player
against it: sign-in, password rejection, categories, films, series, playlist
rewriting, range requests for seeking, the guide, sign-out. Expect
`34 passed, 0 failed`. Nothing is sent anywhere and no subscription is used.

**What it cannot tell you: that a picture appears.** The fake panel has
synthetic segment bytes that no decoder can turn into video. A clean run means
the machinery is sound — not that your provider is reachable, and not that
Chrome can decode your channels. Those need step 2.

If it reports failures, the player is broken and the exact check names the part.

### 2. Check your provider, before opening the browser

Worth doing in a terminal, because it separates "my provider is wrong" from
"my player is broken" in about ten seconds. Substitute your own details.

**Is the address right?**

```
curl -s 'http://YOUR-SERVER:PORT/player_api.php?username=USER&password=PASS' | head -c 300
```

You want to see `"user_info"`. If you see an empty reply, a 404, or an HTML
page, the address or port is wrong — that is the single most common problem,
and it is not the player's fault. Try `https://` if `http://` fails, and a
different port if you have one.

**Is the account alive?**

```
curl -s 'http://YOUR-SERVER:PORT/player_api.php?username=USER&password=PASS&action=get_live_categories'
```

A JSON array means you are in. `[]` means signed in but no channels — the
subscription has not been activated, or is out of connections.

**Is a stream actually decodable?** This is the one worth knowing *before* you
start blaming the player for a black screen:

```
curl -s 'http://YOUR-SERVER:PORT/live/USER/PASS/STREAM_ID.m3u8' | grep -i CODECS
```

`avc1` or `mp4a` — Chrome will play it. `hvc1` or `hev1` — **Chrome on macOS
will show black**, no matter what. That is the HEVC limit above, and no amount
of fixing the player will change it.

### 3. Play it

```
python3 iptv.py
```

Open <http://127.0.0.1:8765>, sign in, click a channel. Playback should start
immediately with no dialogue.

Leave the terminal open — closing it stops the player.

## If a channel stays black

Almost always **HEVC / H.265**, and most likely on the 8K channels, which are
nearly all encoded in it. Chrome on macOS usually has no decoder for it, and
nothing in a web page can add one. You will get a message saying so.

The audio generally still plays. If a channel is black but audible, that is
what is happening — the Strong box itself decodes HEVC without trouble, which
is exactly why it exists.

The player works out the codec from the stream before giving up, and only warns
when the browser genuinely cannot decode it, so the message means something.

## If nothing happens at all

- **"Could not reach…"** — wrong address or port, or the provider is down.
  Test the address with `curl -i 'http://your-server:port/player_api.php'`.
- **"not with an Xtream Codes panel"** — something answered, but it was not an
  IPTV panel. Almost always the wrong port.
- **A channel list but nothing plays** — usually the provider's connection
  limit, reached because the Strong box is streaming at the same time.
  The account line in the sidebar says how many you are allowed.
- **Nothing loads and the address bar shows the page** — the script is not
  running. It has to stay open while you watch.

## What stays on your machine

Your password is held in the running script's memory and is never written to
disk, never put in the URL, and never sent to the page — the page asks for
`/stream/live/123.m3u8`, and the script fills in the credentials. It goes
nowhere except your provider.

Only the provider can use the account, not other pages you visit: the script
refuses requests that are not from its own page, and binds to `127.0.0.1` so it
is not reachable from the network.

Saved channels are kept in your browser's local storage.

## Files

| | |
|---|---|
| `iptv.py` | The helper: serves the page, relays the API and the video |
| `index.html` | The page |
| `app.js` | Player, lists, guide, search |
| `style.css` | How it looks |
| `selftest.py` | Checks the player against a fake provider — see Testing |

`hls.js` is loaded from a CDN only when the browser's own HLS support fails,
which on a current Chrome should not happen. It is a library fetched by the
page, not a browser extension.

## Other browsers

Chrome 142 and later play HLS natively and this is the tested target. Safari
works too. Firefox and older Chrome fall back to `hls.js` and should be fine,
but they are not what this was built against.