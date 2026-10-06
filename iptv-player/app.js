/*
 * IPTV Player - browser side.
 *
 * The page never sees your password. iptv.py holds it in memory and builds the
 * real stream URLs; this file only ever asks for /stream/<kind>/<file>, which
 * carries no credentials. Everything here is same-origin, so nothing is
 * blocked by cross-origin rules.
 */

const $ = (selector) => document.querySelector(selector);

const state = {
  source: "live",
  categoryId: null,
  categoryName: "",
  seriesId: null,
  hls: null,
  nativeTried: false,
  watchdog: null,
  probeDone: false,
  playing: null,
};

/* ----------------------------------------------------------------- utils */

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

async function api(params) {
  const response = await fetch("/api?" + new URLSearchParams(params));
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The helper script gave an unexpected reply.");
  }
  if (!response.ok || (data && data.error)) {
    throw new Error((data && data.error) || `Request failed (HTTP ${response.status})`);
  }
  return data;
}

function setStatus(text) {
  $("#status").textContent = text || "";
}

function showNotice(text, kind) {
  const notice = $("#notice");
  notice.className = "notice" + (kind ? " " + kind : "");
  notice.innerHTML =
    `<button class="close" aria-label="Dismiss">✕</button>` + escapeHtml(text);
  notice.hidden = false;
  notice.querySelector(".close").onclick = () => { notice.hidden = true; };
}

function hideNotice() { $("#notice").hidden = true; }

/* --------------------------------------------------------------- storage */

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

const favourites = {
  all() { return store.get("iptv.favourites", []); },
  save(list) { store.set("iptv.favourites", list); },
  has(key) { return this.all().some((item) => item.key === key); },
  toggle(item) {
    const list = this.all();
    const index = list.findIndex((entry) => entry.key === item.key);
    if (index >= 0) list.splice(index, 1); else list.push(item);
    this.save(list);
    return index < 0;
  },
};

/* ---------------------------------------------------------------- player */

const video = $("#video");

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload = resolve;
    tag.onerror = () => reject(new Error("Could not load hls.js"));
    document.head.appendChild(tag);
  });
}

let hlsLoading = null;
function ensureHlsJs() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoading) {
    // Only fetched when the browser's own HLS support fails, so the usual path
    // needs no network dependency at all. This is a library, not an extension.
    hlsLoading = loadScript("https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js")
      .then(() => window.Hls)
      .catch((error) => { hlsLoading = null; throw error; });
  }
  return hlsLoading;
}

let currentUrl = null;

function teardown() {
  clearTimeout(state.watchdog);
  state.watchdog = null;
  currentUrl = null;
  if (state.hls) {
    try { state.hls.destroy(); } catch { /* already gone */ }
    state.hls = null;
  }
  video.removeAttribute("src");
  try { video.load(); } catch { /* nothing to load */ }
}

function busy(on) { $("#video-spinner").hidden = !on; }

/* Try the browser's own HLS first. Chrome 142+ has it; so does Safari. Only if
 * that fails or stalls do we reach for hls.js, which transcodes the manifest
 * into a Media Source stream the browser can definitely handle. */
function attachHlsJs(url) {
  return ensureHlsJs().then((Hls) => {
    if (!Hls || !Hls.isSupported()) {
      showNotice(
        "This browser cannot play HLS streams. Open the page in Google Chrome, " +
        "or in Safari, and try again."
      );
      return;
    }
    teardown();
    currentUrl = url;
    const hls = new Hls({
      lowLatencyMode: true,
      backBufferLength: 90,
      maxBufferLength: 30,
      enableWorker: true,
    });
    state.hls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      busy(false);
      video.play().catch(() => { /* needs a gesture; the click has been consumed */ });
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (!data.fatal) return;
      busy(false);
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          // One retry; a second failure means the stream itself is not coming.
          if (!hls.somethingRecovered) {
            hls.somethingRecovered = true;
            hls.startLoad();
            showNotice("Reconnecting to the stream…", "info");
          } else {
            showNotice("The stream stopped arriving. It may be offline or your connection limit has been reached.");
          }
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          break;
        default:
          showNotice("Playback failed: " + (data.details || data.type));
          teardown();
      }
    });
  }).catch((error) => {
    busy(false);
    showNotice(error.message);
  });
}

function play(url, meta) {
  teardown();
  hideNotice();
  state.nativeTried = false;
  state.probeDone = false;
  state.playing = meta;
  currentUrl = url;
  busy(true);

  const native = !!video.canPlayType("application/vnd.apple.mpegurl");
  if (native) {
    video.src = url;
    state.nativeTried = true;
    video.play().catch(() => { /* handled by the error listener */ });
  } else {
    attachHlsJs(url);
  }

  // If native playback has not produced any data shortly, treat it as a
  // failure and switch over rather than showing a black rectangle forever.
  state.watchdog = setTimeout(() => {
    if (video.readyState < 3) attachHlsJs(url);
  }, 7000);

  probeCodecs(url);
  showNowPlaying(meta);
}

/*
 * Registered once, not once per channel. Adding these inside play() would
 * stack another copy every time you changed channel, so the tenth channel
 * would run ten recovery paths for the same error.
 */
video.addEventListener("canplay", () => busy(false), { once: true });
video.addEventListener("playing", () => {
  busy(false);
  clearTimeout(state.watchdog);
});
video.addEventListener("error", () => {
  // Only the native attempt gets a second chance; hls.js runs its own recovery.
  if (!currentUrl || state.hls || !state.nativeTried) return;
  state.nativeTried = false;
  attachHlsJs(currentUrl);
});

/*
 * 8K channels are usually HEVC (H.265), and Chrome on macOS often has no
 * decoder for it. There is no way to fix that from here - but a clear
 * explanation beats a black rectangle, so check before the viewer wonders
 * whether the app is broken.
 */
function probeCodecs(url) {
  if (state.probeDone) return;
  state.probeDone = true;

  fetch(url, { headers: { Range: "bytes=0-16383" } })
    .then((response) => response.text())
    .then((text) => {
      const found = [...text.matchAll(/CODECS="([^"]+)"/gi)].map((m) => m[1]);
      if (!found.length) return;
      const codecs = [...new Set(found)];
      const playable = codecs.some((codec) => {
        const type = 'video/mp4; codecs="' + codec + '"';
        return (window.MediaSource && MediaSource.isTypeSupported(type)) ||
               !!document.createElement("video").canPlayType(type);
      });
      if (playable) return;

      const hevc = codecs.some((codec) => /^hvc1|^hev1/i.test(codec));
      showNotice(
        (hevc ? "This channel is HEVC / H.265 video." : "This channel is " + codecs.join(", ") + " video.") +
        " Chrome cannot decode it on this computer, so the picture will stay black." +
        (hevc ? " The audio usually still plays. Safari on macOS, or the Strong box itself, decodes it fine." : "")
      );
    })
    .catch(() => { /* probe is a nicety; never let it break playback */ });
}

function stopPlayback() {
  teardown();
  busy(false);
  state.playing = null;
  $("#now-playing").hidden = true;
  $("#np-guide-list").innerHTML = "";
}

/* ------------------------------------------------------- now playing / epg */

function showNowPlaying(meta) {
  $("#now-playing").hidden = false;
  $("#np-title").textContent = meta.name;
  $("#np-subtitle").textContent = meta.subtitle || "";

  const guide = $("#np-guide");
  const list = $("#np-guide-list");
  if (!meta.epgId) {
    guide.hidden = true;
    list.innerHTML = "";        // do not leave the last channel's guide showing
    return;
  }
  guide.hidden = false;
  guide.open = false;
  list.textContent = "Loading…";

  fetch("/epg?channel_id=" + encodeURIComponent(meta.epgId))
    .then((response) => response.json())
    .then((data) => {
      const programs = (data && data.programs) || [];
      if (!programs.length) {
        list.textContent = "This provider has no guide data for this channel.";
        return;
      }
      list.innerHTML = programs.map((program) => `
        <div class="guide-row">
          <time>${escapeHtml(program.start)}</time>
          <span>${escapeHtml(program.title || "Untitled")}</span>
        </div>`).join("");
    })
    .catch(() => { list.textContent = "The guide could not be loaded."; });
}

/* ------------------------------------------------------------- rendering */

function tile(item, onClick, extraSub) {
  const button = document.createElement("button");
  button.className = "tile" + (state.playing && state.playing.key === item.key ? " is-playing" : "");

  const initials = String(item.name || "?").trim().slice(0, 2).toUpperCase();
  const art = item.icon
    ? `<img src="${escapeHtml(item.icon)}" alt="" loading="lazy"
             onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'initials',textContent:'${initials}'}))">`
    : `<span class="initials">${escapeHtml(initials)}</span>`;

  const saved = favourites.has(item.key);
  button.innerHTML = `
    <span class="tile-art">${art}</span>
    <span class="tile-meta">
      <span class="tile-name">${escapeHtml(item.name)}</span>
      ${extraSub ? `<span class="tile-sub">${escapeHtml(extraSub)}</span>` : ""}
    </span>`;
  button.onclick = onClick;
  return button;
}

function renderList(items, emptyMessage) {
  const listing = $("#listing");
  listing.innerHTML = "";
  if (!items.length) {
    listing.innerHTML = `<p class="empty">${escapeHtml(emptyMessage || "Nothing here.")}</p>`;
    return;
  }
  const grid = document.createElement("div");
  grid.className = "grid";
  items.forEach((item) => grid.appendChild(item));
  listing.appendChild(grid);
}

/* ------------------------------------------------------------ data model */

function normalise(raw, kind) {
  const id = raw.stream_id != null ? raw.stream_id : raw.series_id != null ? raw.series_id : raw.num;
  const key = `${kind}:${raw.num != null ? raw.num : id}`;
  const name = raw.name || raw.title || "Untitled";
  const subtitle = [];
  if (kind === "live" && raw.stream_type === "live") subtitle.push("Live");
  if (kind === "movie" && raw.container_extension) subtitle.push(raw.container_extension.toUpperCase());
  if (raw.year) subtitle.push(raw.year);
  if (kind === "series") subtitle.push(raw.total_episodes ? `${raw.total_episodes} episodes` : "Series");

  return {
    kind,
    key,
    name,
    id,
    icon: raw.stream_icon || raw.cover || raw.movie_image || "",
    subtitle: subtitle.join(" · "),
    extra: raw.stream_type === "movie" ? (raw.movie_genre || "") : "",
    epgId: raw.epg_channel_id || "",
    container: raw.container_extension || "mp4",
    raw,
  };
}

/* Prefer the provider's own URL when it gave one - it has already been
 * rewritten to point back through the helper. Otherwise compose it here. */
function streamUrl(item) {
  const direct = item.raw.direct_source;
  if (typeof direct === "string" && /^\/(stream|abs)/.test(direct)) return direct;

  if (item.kind === "movie") return `/stream/movie/${item.id}.${item.container}`;
  if (item.kind === "series") return `/stream/series/${item.id}.m3u8`;
  return `/stream/live/${item.id}.m3u8`;
}

function playItem(item, meta) {
  play(streamUrl(item), {
    key: item.key,
    name: item.name,
    subtitle: [item.subtitle, meta && meta.subtitle].filter(Boolean).join(" · "),
    epgId: meta && meta.epgId !== undefined ? meta.epgId : item.epgId,
  });
}

/* --------------------------------------------------------- source loading */

const CATEGORY_ACTION = {
  live: "get_live_categories",
  movie: "get_vod_categories",
  series: "get_series_categories",
};

const STREAM_ACTION = {
  live: "get_live_streams",
  movie: "get_vod_streams",
  series: "get_series",
};

async function loadCategories() {
  const host = $("#categories");
  host.innerHTML = `<p class="status">Loading…</p>`;
  try {
    const categories = await api({ action: CATEGORY_ACTION[state.source] });
    host.innerHTML = "";

    const all = document.createElement("button");
    all.className = "category" + (state.categoryId === null ? " is-active" : "");
    all.textContent = "All";
    all.onclick = () => selectCategory(null, "All");
    host.appendChild(all);

    categories.forEach((category) => {
      const button = document.createElement("button");
      button.className = "category" + (String(state.categoryId) === String(category.category_id) ? " is-active" : "");
      button.textContent = category.category_name;
      button.title = category.category_name;
      button.onclick = () => selectCategory(category.category_id, category.category_name);
      host.appendChild(button);
    });
  } catch (error) {
    host.innerHTML = "";
    showNotice(error.message);
  }
}

function selectCategory(id, name) {
  state.categoryId = id;
  state.categoryName = name || "";
  state.seriesId = null;
  $("#category-title").textContent = state.source === "live" ? "Categories" : "Browse";
  loadCategories();
  loadStreams();
}

async function loadStreams() {
  if (state.source === "favourites") return renderFavourites();
  if (state.source === "series") return renderSeries();

  const params = { action: STREAM_ACTION[state.source] };
  if (state.categoryId !== null) params.category_id = state.categoryId;

  setStatus("Loading…");
  try {
    const raw = await api(params);
    const items = (raw || []).map((entry) => normalise(entry, state.source));

    $("#listing").innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "grid";

    items.forEach((item) => {
      const tileEl = tile(item, () => playItem(item), item.kind === "movie" ? item.extra : "");
      tileEl.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const added = favourites.toggle({ key: item.key, kind: item.kind, id: item.id, name: item.name, icon: item.icon });
        showNotice(added ? `Saved “${item.name}”.` : `Removed “${item.name}”.`, "info");
      });
      grid.appendChild(tileEl);
    });

    renderList([grid], "No channels in this category.");
    setStatus(`${items.length} ${state.source === "live" ? "channel" : "film"}${items.length === 1 ? "" : "s"}`);
  } catch (error) {
    setStatus("");
    showNotice(error.message);
  }
}

/* Series need three hops: category, then show, then season, then episode. */
async function renderSeries() {
  const params = { action: "get_series" };
  if (state.categoryId !== null) params.category_id = state.categoryId;

  setStatus("Loading…");
  try {
    const shows = (await api(params)) || [];
    renderList(
      shows.map((raw) => tile(normalise(raw, "series"), () => openSeries(raw), raw.total_episodes ? `${raw.total_episodes} eps` : "")),
      "No series in this category."
    );
    setStatus(`${shows.length} title${shows.length === 1 ? "" : "s"}`);
  } catch (error) {
    setStatus("");
    showNotice(error.message);
  }
}

async function openSeries(show) {
  setStatus("Loading episodes…");
  try {
    const info = await api({ action: "get_series_info", series_id: show.series_id });
    const seasons = Object.keys(info.episodes || {});
    if (!seasons.length) {
      setStatus("");
      showNotice("That series has no episodes listed.");
      return;
    }

    const listing = $("#listing");
    listing.innerHTML = "";
    const pills = document.createElement("div");
    pills.className = "season-pills";

    const showSeason = (seasonName) => {
      listing.querySelectorAll(".season-pill").forEach((pill) => pill.classList.remove("is-active"));
      [...pills.children].find((pill) => pill.textContent === seasonName)?.classList.add("is-active");

      const episodes = info.episodes[seasonName] || [];
      const grid = document.createElement("div");
      grid.className = "grid";
      episodes.forEach((episode) => {
        const item = normalise({ ...episode, name: `${episode.episode_num}. ${episode.title || "Episode"}` }, "series");
        grid.appendChild(tile(item, () =>
          playItem(item, { subtitle: `${show.title} · Series ${seasonName.replace(/\D/g, "")} · Episode ${episode.episode_num}`, epgId: "" }),
          episode.title ? `Episode ${episode.episode_num}` : ""
        ));
      });
      listing.innerHTML = "";
      listing.appendChild(grid);
      setStatus(`${episodes.length} episode${episodes.length === 1 ? "" : "s"}`);
    };

    seasons.forEach((season) => {
      const pill = document.createElement("button");
      pill.className = "season-pill";
      pill.textContent = season;
      pill.onclick = () => showSeason(season);
      pills.appendChild(pill);
    });

    listing.appendChild(pills);
    showSeason(seasons[0]);
    $("#category-title").textContent = show.title;
  } catch (error) {
    setStatus("");
    showNotice(error.message);
  }
}

function renderFavourites() {
  const saved = favourites.all();
  renderList(
    saved.map((entry) => {
      const item = { ...entry, raw: {} };
      const tileEl = tile(item, () => {
        // Re-resolve through the API so the container extension is correct.
        fetchSource(entry).catch((error) => showNotice(error.message));
      }, "");
      return tileEl;
    }),
    "Nothing saved yet. Right-click any channel, film or series to save it here."
  );
  setStatus(`${saved.length} saved`);
}

/* Favourites store only an id, so re-ask the panel for the current details. */
async function fetchSource(entry) {
  const all = (await api({ action: STREAM_ACTION[entry.kind] })) || [];
  const found = all.find((raw) =>
    String(raw.stream_id != null ? raw.stream_id : raw.series_id) === String(entry.id));
  if (!found) throw new Error("That saved item is no longer on the provider.");
  const item = normalise(found, entry.kind);
  playItem(item, { epgId: item.epgId });
}

/* ---------------------------------------------------------------- search */

const runSearch = debounce(async () => {
  const query = $("#search").value.trim();
  if (!query) {
    if (state.source === "favourites") return renderFavourites();
    return loadStreams();
  }

  setStatus("Searching…");
  const results = [];
  for (const [kind, action] of [["live", "get_live_streams"], ["movie", "get_vod_streams"], ["series", "get_series"]]) {
    try {
      const found = (await api({ action, search: query })) || [];
      found.forEach((raw) => results.push(normalise(raw, kind)));
    } catch { /* one failing kind should not sink the search */ }
  }

  renderList(
    results.map((item) => tile(item, () => {
      if (item.kind === "series") openSeries(item.raw); else playItem(item);
    }, item.subtitle)),
    `No match for “${query}”.`
  );
  setStatus(`${results.length} result${results.length === 1 ? "" : "s"}`);
}, 350);

/* ------------------------------------------------------------------ boot */

async function enterApp(session) {
  $("#login").hidden = true;
  $("#app").hidden = false;

  const info = session.user_info || {};
  const expiry = info.expires && info.expires !== "0" ? new Date(Number(info.expires) * 1000).toLocaleDateString() : "no expiry";
  const account = document.createElement("div");
  account.className = "sidebar-heading";
  account.style.cssText = "margin-top:16px;line-height:1.6;text-transform:none;letter-spacing:0;font-weight:400";
  account.innerHTML =
    `${escapeHtml(info.username || "Signed in")}<br>` +
    `Active until ${escapeHtml(expiry)}<br>` +
    `Up to ${escapeHtml(String(session.maxStreams || 1))} stream${Number(session.maxStreams) === 1 ? "" : "s"} at once`;
  $("#sidebar").appendChild(account);

  await loadCategories();
  await loadStreams();
}

function signOut() {
  fetch("/logout", { method: "POST" });
  stopPlayback();
  location.reload();
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#login-button");
  const error = $("#login-error");
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Connecting…";

  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server: $("#server").value,
        username: $("#username").value,
        password: $("#password").value,
      }),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Could not sign in.");
    $("#password").value = "";   // do not leave it sitting in the DOM
    await enterApp(data);
  } catch (problem) {
    error.textContent = problem.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Connect";
  }
});

document.querySelectorAll(".source").forEach((button) => {
  button.onclick = async () => {
    document.querySelectorAll(".source").forEach((other) => other.classList.remove("is-active"));
    button.classList.add("is-active");
    state.source = button.dataset.source;
    state.categoryId = null;
    state.seriesId = null;
    $("#category-title").textContent = state.source === "live" ? "Categories" : "Browse";
    await loadCategories();
    await loadStreams();
    document.body.classList.remove("sidebar-open");
  };
});

$("#search").addEventListener("input", runSearch);
$("#logout").onclick = signOut;
$("#np-close").onclick = stopPlayback;
$("#menu-toggle").onclick = () => document.body.classList.toggle("sidebar-open");

// Pick a live session back up after a reload. This must *restore* the app,
// never reload the page -- a reload would find the same live session and
// reload again, for ever.
fetch("/session")
  .then((response) => response.json())
  .then((data) => { if (data.loggedIn) return enterApp(data); })
  .catch(() => { /* helper not running; the login form is the fallback */ });