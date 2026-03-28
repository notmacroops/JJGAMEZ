(function () {
  try {
    if (localStorage.getItem("mathArcadeTheme") === "dark") {
      document.documentElement.classList.add("theme-dark");
    }
  } catch {
    /* ignore */
  }
})();

const COVERS_BASE = "https://cdn.jsdelivr.net/gh/gn-math/covers@main";
const ZONES_URL = "https://cdn.jsdelivr.net/gh/gn-math/assets@latest/zones.json";
const TAG_ZONES_URL = "https://cdn.jsdelivr.net/gh/sealiee11/gnmathstuff@main/zones.json";
const FALLBACK_HTML_BASE = "https://cdn.jsdelivr.net/gh/gn-math/html@main";
const HTML_SHA_URL = "https://raw.githubusercontent.com/gn-math/xml/refs/heads/main/sha.txt";
const JSDELIVR_STATS_BASE =
  "https://data.jsdelivr.com/v1/stats/packages/gh/gn-math/html@main/files";

const LS_FAV = "mathArcadeFavorites_v1";
const LS_SORT = "mathArcadeSort";
const LS_PROFILE = "mathArcadeProfile_v1";
const LS_RECENT = "mathArcadeRecent_v1";
const LS_COUNTS = "mathArcadePlayCounts_v1";
const LS_SETTINGS = "mathArcadeSettings_v1";
const LS_GLOBAL_CACHE = "mathArcadeGlobalStatsCache_v1";

const CAT_ALL = "all";
const CAT_FAV = "__favorites__";
const CAT_RECENT = "__recent__";

let htmlBase = FALLBACK_HTML_BASE;
let allGames = [];
let activeCategory = CAT_ALL;
let sortMode = localStorage.getItem(LS_SORT) || "original";

let playerBlobUrl = null;
let playerOpen = false;
let settingsOpen = false;

/** @type {Record<string, number>} */
let globalStatsMap = {};
let globalStatsLoaded = false;

function defaultSettings() {
  return {
    showGlobalOnCards: true,
    showHotStrip: true,
    showConcurrentEst: false,
  };
}

function getSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(s) {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
}

function getProfile() {
  try {
    const raw = localStorage.getItem(LS_PROFILE);
    if (!raw) return { displayName: "" };
    const o = JSON.parse(raw);
    return { displayName: typeof o.displayName === "string" ? o.displayName.slice(0, 32) : "" };
  } catch {
    return { displayName: "" };
  }
}

function setProfile(p) {
  localStorage.setItem(LS_PROFILE, JSON.stringify({ displayName: p.displayName || "" }));
  syncProfileGreeting();
}

function getRecentIds() {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.map(Number).filter((n) => !Number.isNaN(n)) : [];
  } catch {
    return [];
  }
}

function setRecentIds(ids) {
  localStorage.setItem(LS_RECENT, JSON.stringify(ids.slice(0, 20)));
}

function getPlayCounts() {
  try {
    const raw = localStorage.getItem(LS_COUNTS);
    const o = raw ? JSON.parse(raw) : {};
    return typeof o === "object" && o ? o : {};
  } catch {
    return {};
  }
}

function setPlayCounts(o) {
  localStorage.setItem(LS_COUNTS, JSON.stringify(o));
}

function getPlayCount(id) {
  const n = Number(getPlayCounts()[String(id)]);
  return Number.isFinite(n) ? n : 0;
}

function recordPlay(id) {
  const counts = { ...getPlayCounts() };
  const k = String(id);
  counts[k] = (counts[k] || 0) + 1;
  setPlayCounts(counts);
  const recent = getRecentIds().filter((x) => x !== id);
  recent.unshift(id);
  setRecentIds(recent);
  renderRecentStrip();
}

function syncProfileGreeting() {
  const el = document.getElementById("profile-greeting");
  if (!el) return;
  const name = getProfile().displayName.trim();
  if (name) {
    el.textContent = `Hi, ${name}`;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

function revokePlayerBlob() {
  if (playerBlobUrl) {
    URL.revokeObjectURL(playerBlobUrl);
    playerBlobUrl = null;
  }
}

function resolveUrl(url) {
  if (!url || typeof url !== "string") return "";
  return url.replace("{COVER_URL}", COVERS_BASE).replace("{HTML_URL}", htmlBase);
}

async function loadHtmlBase() {
  try {
    const r = await fetch(HTML_SHA_URL + "?t=" + Date.now(), { cache: "no-store" });
    const hash = (await r.text()).trim();
    if (hash && /^[a-f0-9]{7,40}$/i.test(hash)) {
      htmlBase = `https://cdn.jsdelivr.net/gh/gn-math/html@${hash}`;
    }
  } catch {
    htmlBase = FALLBACK_HTML_BASE;
  }
}

function getFavorites() {
  try {
    const raw = localStorage.getItem(LS_FAV);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.map(Number).filter((n) => !Number.isNaN(n)) : [];
  } catch {
    return [];
  }
}

function setFavorites(ids) {
  localStorage.setItem(LS_FAV, JSON.stringify(ids));
}

function toggleFavorite(id) {
  const ids = getFavorites();
  const i = ids.indexOf(id);
  if (i >= 0) ids.splice(i, 1);
  else ids.push(id);
  setFavorites(ids);
  renderGrid();
  renderCategories(collectCategories(allGames));
}

function isFavorite(id) {
  return getFavorites().includes(id);
}

function isPlayableGame(g) {
  if (g.id < 0) return false;
  const u = g.url || "";
  return u.includes("{HTML_URL}") || /\.html/i.test(u);
}

function isExternalOnly(g) {
  const u = g.url || "";
  if (g.id < 0) return true;
  if (u.startsWith("http") && !u.includes("{HTML_URL}") && !u.includes(".html")) {
    return true;
  }
  return false;
}

function gameTags(g) {
  const out = [];
  if (g.tags && Array.isArray(g.tags)) out.push(...g.tags);
  if (g.special && Array.isArray(g.special)) out.push(...g.special);
  return out;
}

function collectCategories(games) {
  const set = new Set();
  for (const g of games) {
    gameTags(g).forEach((t) => set.add(String(t)));
  }
  const tags = Array.from(set).sort((a, b) => a.localeCompare(b));
  return [CAT_ALL, CAT_FAV, CAT_RECENT, ...tags];
}

function categoryLabel(c) {
  if (c === CAT_ALL) return "All games";
  if (c === CAT_FAV) return "★ Favorites";
  if (c === CAT_RECENT) return "🕐 Recently played";
  return c;
}

function filterGamesRaw() {
  const q = (document.getElementById("search")?.value || "").trim().toLowerCase();
  return allGames.filter((g) => {
    if (g.id < 0) return false;
    if (activeCategory === CAT_FAV) {
      if (!isFavorite(g.id)) return false;
    } else if (activeCategory === CAT_RECENT) {
      if (!getRecentIds().includes(g.id)) return false;
    } else if (activeCategory !== CAT_ALL) {
      const tags = gameTags(g);
      if (!tags.includes(activeCategory)) return false;
    }
    if (!q) return true;
    return (g.name || "").toLowerCase().includes(q);
  });
}

function orderByRecent(list) {
  const recent = getRecentIds();
  const idx = new Map(recent.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (idx.get(a.id) ?? 9999) - (idx.get(b.id) ?? 9999));
}

function applySort(list) {
  if (activeCategory === CAT_RECENT) {
    if (sortMode === "az") {
      return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));
    }
    if (sortMode === "za") {
      return [...list].sort((a, b) => (b.name || "").localeCompare(a.name || "", undefined, { sensitivity: "base" }));
    }
    if (sortMode === "toplocal") {
      return [...list].sort(
        (a, b) =>
          getPlayCount(b.id) - getPlayCount(a.id) || (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
      );
    }
    if (sortMode === "globalhot") {
      return [...list].sort((a, b) => {
        const ga = globalStatsMap[String(a.id)] ?? 0;
        const gb = globalStatsMap[String(b.id)] ?? 0;
        return gb - ga || (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
      });
    }
    return orderByRecent(list);
  }

  if (sortMode === "az") {
    return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));
  }
  if (sortMode === "za") {
    return [...list].sort((a, b) => (b.name || "").localeCompare(a.name || "", undefined, { sensitivity: "base" }));
  }
  if (sortMode === "toplocal") {
    return [...list].sort(
      (a, b) =>
        getPlayCount(b.id) - getPlayCount(a.id) || (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
    );
  }
  if (sortMode === "globalhot") {
    return [...list].sort((a, b) => {
      const ga = globalStatsMap[String(a.id)] ?? 0;
      const gb = globalStatsMap[String(b.id)] ?? 0;
      return gb - ga || (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
    });
  }
  return [...list].sort((a, b) => (a._order ?? 0) - (b._order ?? 0));
}

function filterGames() {
  return applySort(filterGamesRaw());
}

function playableList() {
  return filterGames().filter((g) => isPlayableGame(g) && !isExternalOnly(g));
}

function randomGame() {
  const list = playableList();
  if (list.length === 0) return;
  const g = list[Math.floor(Math.random() * list.length)];
  openPlayer(g.id);
}

function setSortMode(mode) {
  sortMode = mode;
  localStorage.setItem(LS_SORT, mode);
  const sel = document.getElementById("sort");
  if (sel) sel.value = mode;
  renderGrid();
}

function formatHits(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "m";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(Math.round(n));
}

/** Very rough “sessions” guess from total day requests — not real users. */
function roughActiveEstimate(dayHits) {
  if (!dayHits || dayHits < 1) return 0;
  return Math.max(1, Math.min(9_999, Math.round(Math.sqrt(dayHits / 8))));
}

function cardStatLine(g) {
  const s = getSettings();
  const parts = [];
  const local = getPlayCount(g.id);
  if (local > 0) parts.push(`You: ${local}×`);
  const gh = globalStatsLoaded ? globalStatsMap[String(g.id)] : null;
  if (gh != null && gh > 0) {
    if (s.showGlobalOnCards) parts.push(`Global today: ${formatHits(gh)}`);
    if (s.showConcurrentEst) parts.push(`~${roughActiveEstimate(gh)} active (est.)`);
  }
  if (parts.length === 0) return "";
  return `<p class="card-stats">${escapeHtml(parts.join(" · "))}</p>`;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

function renderCategories(cats) {
  const el = document.getElementById("categories");
  if (!el) return;
  el.innerHTML = cats
    .map(
      (c) =>
        `<button type="button" class="cat-btn${c === activeCategory ? " active" : ""}" data-cat="${escapeAttr(
          c
        )}">${escapeHtml(categoryLabel(c))}</button>`
    )
    .join("");
  el.querySelectorAll(".cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.getAttribute("data-cat") || CAT_ALL;
      document.querySelectorAll(".cat-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderGrid();
      updateCount();
    });
  });
}

function updateCount() {
  const el = document.getElementById("game-count");
  if (el) el.textContent = String(filterGames().length);
}

function renderGrid() {
  const grid = document.getElementById("grid");
  const list = filterGames();
  if (!grid) return;

  if (list.length === 0) {
    grid.innerHTML = '<p class="status">No games match your search.</p>';
    updateCount();
    return;
  }

  grid.innerHTML = list
    .map((g) => {
      const cover = resolveUrl(g.cover);
      const author = g.author ? escapeHtml(g.author) : "";
      const playable = isPlayableGame(g) && !isExternalOnly(g);
      const ext = isExternalOnly(g) && g.url && g.url.startsWith("http");
      const fav = isFavorite(g.id);
      const stats = cardStatLine(g);

      let actions = "";
      if (ext) {
        actions = `<a class="btn btn-link" href="${escapeAttr(g.url)}" target="_blank" rel="noopener">Open link</a>`;
      } else if (playable) {
        actions = `
          <button type="button" class="btn btn-play" data-action="play" data-id="${g.id}">Play</button>
          <button type="button" class="btn btn-dl" data-action="download" data-id="${g.id}">Download</button>
        `;
      } else {
        actions = `<span class="btn btn-link" style="cursor:default;opacity:0.7">—</span>`;
      }

      return `
        <article class="card">
          <div class="card-thumb-wrap">
            <div class="card-thumb-skeleton" aria-hidden="true"></div>
            <button type="button" class="star-btn${fav ? " on" : ""}" data-star="${g.id}" title="Favorite">★</button>
            <img class="card-thumb" src="${escapeAttr(cover)}" alt="" loading="lazy" width="200" height="200" decoding="async" />
          </div>
          <div class="card-body">
            <h2 class="card-title">${escapeHtml(g.name || "Untitled")}</h2>
            ${stats}
            ${author ? `<p class="card-meta">${author}</p>` : '<p class="card-meta">&nbsp;</p>'}
            <div class="card-actions">${actions}</div>
          </div>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll(".card-thumb").forEach((img) => {
    const wrap = img.closest(".card-thumb-wrap");
    const sk = wrap?.querySelector(".card-thumb-skeleton");
    const hideSk = () => {
      if (sk) sk.hidden = true;
    };
    if (img.complete && img.naturalWidth) {
      img.classList.add("loaded");
      hideSk();
    } else {
      img.addEventListener(
        "load",
        function () {
          this.classList.add("loaded");
          hideSk();
        },
        { once: true }
      );
      img.addEventListener(
        "error",
        function () {
          this.style.opacity = "0.35";
          hideSk();
        },
        { once: true }
      );
    }
  });

  grid.querySelectorAll("[data-star]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(Number(btn.getAttribute("data-star")));
    });
  });

  grid.querySelectorAll('[data-action="play"]').forEach((btn) => {
    btn.addEventListener("click", () => openPlayer(Number(btn.getAttribute("data-id"))));
  });
  grid.querySelectorAll('[data-action="download"]').forEach((btn) => {
    btn.addEventListener("click", () => downloadGame(Number(btn.getAttribute("data-id"))));
  });

  updateCount();
}

function renderRecentStrip() {
  const section = document.getElementById("section-recent");
  const strip = document.getElementById("recent-strip");
  if (!section || !strip) return;
  const ids = getRecentIds().slice(0, 12);
  const games = ids.map((id) => findGame(id)).filter(Boolean);
  if (games.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  strip.innerHTML = games
    .map((g) => {
      const cover = resolveUrl(g.cover);
      return `
      <button type="button" class="strip-card" data-open="${g.id}" title="${escapeAttr(g.name || "")}">
        <img src="${escapeAttr(cover)}" alt="" loading="lazy" width="120" height="120" />
        <span class="strip-card-title">${escapeHtml(g.name || "")}</span>
      </button>`;
    })
    .join("");
  strip.querySelectorAll(".strip-card").forEach((btn) => {
    btn.addEventListener("click", () => openPlayer(Number(btn.getAttribute("data-open"))));
  });
}

function renderHotStrip() {
  const section = document.getElementById("section-hot");
  const strip = document.getElementById("hot-strip");
  if (!section || !strip) return;
  const s = getSettings();
  if (!s.showHotStrip || !globalStatsLoaded || allGames.length === 0) {
    section.hidden = true;
    return;
  }
  const ranked = allGames
    .filter((g) => g.id >= 0 && isPlayableGame(g) && !isExternalOnly(g))
    .map((g) => ({ g, h: globalStatsMap[String(g.id)] ?? 0 }))
    .filter((x) => x.h > 0)
    .sort((a, b) => b.h - a.h)
    .slice(0, 10);
  if (ranked.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  strip.innerHTML = ranked
    .map(({ g, h }) => {
      const cover = resolveUrl(g.cover);
      const est = getSettings().showConcurrentEst ? roughActiveEstimate(h) : null;
      return `
      <button type="button" class="strip-card strip-card-hot" data-open="${g.id}" title="${escapeAttr(g.name || "")}">
        <img src="${escapeAttr(cover)}" alt="" loading="lazy" width="120" height="120" />
        <span class="strip-badge">${formatHits(h)} today</span>
        ${est != null ? `<span class="strip-est" title="Rough estimate from CDN volume">~${est} active</span>` : ""}
        <span class="strip-card-title">${escapeHtml(g.name || "")}</span>
      </button>`;
    })
    .join("");
  strip.querySelectorAll(".strip-card").forEach((btn) => {
    btn.addEventListener("click", () => openPlayer(Number(btn.getAttribute("data-open"))));
  });
}

function findGame(id) {
  return allGames.find((g) => g.id === id);
}

function urlWithGameId(id) {
  const u = new URL(window.location.href);
  u.searchParams.set("id", String(id));
  return u;
}

function urlWithoutGameId() {
  const u = new URL(window.location.href);
  u.searchParams.delete("id");
  return u;
}

async function fetchGameHtml(g) {
  let u = resolveUrl(g.url);
  let r = await fetch(u + (u.includes("?") ? "&" : "?") + "t=" + Date.now());
  let text = await r.text();
  if (text.trim().startsWith("Couldn't find the requested file")) {
    u = g.url.replace("{COVER_URL}", COVERS_BASE).replace("{HTML_URL}", FALLBACK_HTML_BASE);
    r = await fetch(u + "?t=" + Date.now());
    text = await r.text();
  }
  return text;
}

function setPlayerLoading(on) {
  const el = document.getElementById("player-loading");
  if (el) el.hidden = !on;
}

function updatePlayerStats(id) {
  const el = document.getElementById("player-stats");
  if (!el) return;
  const gid = typeof id === "number" ? id : Number(id);
  const g = Number.isFinite(gid) ? findGame(gid) : null;
  if (!g) {
    el.textContent = "";
    return;
  }
  const parts = [];
  const local = getPlayCount(gid);
  if (local > 0) parts.push(`Your plays: ${local}`);
  const s = getSettings();
  const gh = globalStatsMap[String(gid)];
  if (globalStatsLoaded && gh != null && gh > 0) {
    if (s.showGlobalOnCards) parts.push(`Global today: ${formatHits(gh)}`);
    if (s.showConcurrentEst) parts.push(`~${roughActiveEstimate(gh)} active (est.)`);
  }
  el.textContent = parts.join(" · ");
}

function loadCachedGlobalStats() {
  try {
    const raw = localStorage.getItem(LS_GLOBAL_CACHE);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.ts !== "number" || typeof data.map !== "object") return null;
    if (Date.now() - data.ts > 60 * 60 * 1000) return null;
    return data.map;
  } catch {
    return null;
  }
}

function saveCachedGlobalStats(map) {
  try {
    localStorage.setItem(LS_GLOBAL_CACHE, JSON.stringify({ ts: Date.now(), map }));
  } catch {
    /* ignore */
  }
}

async function fetchGlobalStatsFromApi() {
  const combinedMap = Object.create(null);
  let page = 1;
  let empty = 0;
  const PAGE_BATCH = 5;
  while (empty < 2) {
    const pages = Array.from({ length: PAGE_BATCH }, (_, i) => page + i);
    const responses = await Promise.all(
      pages.map((p) =>
        fetch(`${JSDELIVR_STATS_BASE}?period=day&page=${p}&limit=100`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [])
      )
    );
    let found = false;
    for (const data of responses) {
      if (!Array.isArray(data) || data.length === 0) continue;
      found = true;
      for (const item of data) {
        if (!item?.name) continue;
        const match = item.name.match(/^\/(\d+)([.-])/);
        if (!match) continue;
        const gid = match[1];
        combinedMap[gid] = (combinedMap[gid] || 0) + (item.hits?.total ?? 0);
      }
    }
    if (!found) empty++;
    else empty = 0;
    page += PAGE_BATCH;
  }
  return combinedMap;
}

async function initGlobalStats() {
  const cached = loadCachedGlobalStats();
  if (cached) {
    globalStatsMap = cached;
    globalStatsLoaded = true;
    renderGrid();
    renderHotStrip();
    return;
  }
  try {
    globalStatsMap = await fetchGlobalStatsFromApi();
    globalStatsLoaded = true;
    saveCachedGlobalStats(globalStatsMap);
  } catch (e) {
    console.warn("Global stats", e);
    globalStatsMap = {};
    globalStatsLoaded = false;
  }
  renderGrid();
  renderHotStrip();
}

async function openPlayer(id, opts = {}) {
  const replace = opts.replace === true;
  const g = findGame(id);
  if (!g || !isPlayableGame(g) || isExternalOnly(g)) return;

  const overlay = document.getElementById("player");
  const frame = document.getElementById("player-frame");
  const title = document.getElementById("player-title");
  const openTab = document.getElementById("player-open-tab");
  const dl = document.getElementById("player-download");

  title.textContent = "Loading…";
  updatePlayerStats(id);
  frame.src = "about:blank";
  revokePlayerBlob();
  setPlayerLoading(true);
  openTab.href = "#";
  openTab.onclick = (e) => {
    e.preventDefault();
    if (playerBlobUrl) window.open(playerBlobUrl, "_blank", "noopener,noreferrer");
  };
  dl.onclick = () => downloadGame(id);
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
  playerOpen = true;

  const histUrl = urlWithGameId(id);
  if (replace) history.replaceState({ gameId: id }, "", histUrl);
  else history.pushState({ gameId: id }, "", histUrl);

  try {
    const text = await fetchGameHtml(g);
    const blob = new Blob([text], { type: "text/html;charset=utf-8" });
    playerBlobUrl = URL.createObjectURL(blob);
    frame.onload = () => setPlayerLoading(false);
    frame.src = playerBlobUrl;
    title.textContent = g.name || "Game";
    recordPlay(id);
    updatePlayerStats(id);
    setTimeout(() => setPlayerLoading(false), 4000);
  } catch (e) {
    console.error(e);
    setPlayerLoading(false);
    alert('Could not load game. Try "New tab" after it finishes loading.');
    closePlayer();
  }
}

function closePlayer(skipHistory) {
  const overlay = document.getElementById("player");
  const frame = document.getElementById("player-frame");
  revokePlayerBlob();
  frame.onload = null;
  frame.src = "about:blank";
  setPlayerLoading(false);
  overlay.classList.remove("open");
  document.body.style.overflow = "";
  playerOpen = false;
  const ps = document.getElementById("player-stats");
  if (ps) ps.textContent = "";
  if (!skipHistory) {
    try {
      history.replaceState({}, "", urlWithoutGameId());
    } catch {
      /* ignore */
    }
  }
}

async function downloadGame(id) {
  const g = findGame(id);
  if (!g || !isPlayableGame(g)) return;
  const btn =
    document.querySelector(`[data-action="download"][data-id="${id}"]`) ||
    document.getElementById("player-download");
  const prev = btn?.textContent;
  if (btn) btn.textContent = "…";
  try {
    const text = await fetchGameHtml(g);
    const blob = new Blob([text], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const safe = (g.name || "game").replace(/[<>:"/\\|?*]/g, "_");
    a.download = safe + ".html";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error(e);
    alert("Download failed. Try opening the game in a new tab and save the page from your browser.");
  } finally {
    if (btn && prev) btn.textContent = prev;
  }
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = !root.classList.contains("theme-dark");
  root.classList.toggle("theme-dark", dark);
  localStorage.setItem("mathArcadeTheme", dark ? "dark" : "light");
  const btn = document.getElementById("btn-theme");
  if (btn) btn.textContent = dark ? "Light" : "Dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0d1f17" : "#1a9b5c");
}

function syncThemeButton() {
  const dark = document.documentElement.classList.contains("theme-dark");
  const btn = document.getElementById("btn-theme");
  if (btn) btn.textContent = dark ? "Light" : "Dark";
}

function openSettings() {
  const m = document.getElementById("modal-settings");
  if (!m) return;
  const s = getSettings();
  const inp = document.getElementById("input-display-name");
  if (inp) inp.value = getProfile().displayName;
  const c1 = document.getElementById("set-show-global-cards");
  const c2 = document.getElementById("set-show-hot-strip");
  const c3 = document.getElementById("set-show-concurrent");
  if (c1) c1.checked = s.showGlobalOnCards;
  if (c2) c2.checked = s.showHotStrip;
  if (c3) c3.checked = s.showConcurrentEst;
  m.hidden = false;
  settingsOpen = true;
  document.body.style.overflow = "hidden";
}

function closeSettings() {
  const m = document.getElementById("modal-settings");
  if (!m) return;
  m.hidden = true;
  settingsOpen = false;
  document.body.style.overflow = playerOpen ? "hidden" : "";
}

function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
}

function onKeydown(e) {
  if (e.key === "Escape") {
    if (settingsOpen) {
      e.preventDefault();
      closeSettings();
      return;
    }
    if (playerOpen) {
      e.preventDefault();
      closePlayer();
    }
    return;
  }

  const t = e.target;
  const tag = t && t.tagName;
  const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable;

  if (inField) return;

  if (playerOpen && (e.key === "f" || e.key === "F")) {
    e.preventDefault();
    const wrap = document.querySelector(".player-frame-wrap");
    if (wrap?.requestFullscreen) wrap.requestFullscreen();
    return;
  }
  if (!playerOpen && !settingsOpen && (e.key === "r" || e.key === "R")) {
    e.preventDefault();
    randomGame();
  }
}

function onPopState() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    if (playerOpen) closePlayer(true);
    return;
  }
  const g = findGame(Number(id));
  if (g && isPlayableGame(g) && !isExternalOnly(g)) openPlayer(g.id, { replace: true });
}

async function init() {
  const status = document.getElementById("status");
  syncThemeButton();
  syncProfileGreeting();

  document.getElementById("sort")?.addEventListener("change", (e) => {
    setSortMode(e.target.value);
  });
  const sortEl = document.getElementById("sort");
  if (sortEl) sortEl.value = sortMode;

  document.getElementById("btn-random")?.addEventListener("click", () => randomGame());
  document.getElementById("btn-theme")?.addEventListener("click", () => toggleTheme());
  document.getElementById("btn-settings")?.addEventListener("click", () => openSettings());
  document.getElementById("modal-settings-close")?.addEventListener("click", () => closeSettings());
  document.getElementById("modal-settings")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-settings") closeSettings();
  });

  document.getElementById("btn-save-profile")?.addEventListener("click", () => {
    const inp = document.getElementById("input-display-name");
    const name = (inp?.value || "").trim().slice(0, 32);
    setProfile({ displayName: name });
  });
  document.getElementById("btn-clear-profile")?.addEventListener("click", () => {
    setProfile({ displayName: "" });
    const inp = document.getElementById("input-display-name");
    if (inp) inp.value = "";
  });

  function bindSettingsCheckbox(id, key) {
    document.getElementById(id)?.addEventListener("change", (e) => {
      const s = getSettings();
      s[key] = e.target.checked;
      saveSettings(s);
      renderGrid();
      renderHotStrip();
    });
  }
  bindSettingsCheckbox("set-show-global-cards", "showGlobalOnCards");
  bindSettingsCheckbox("set-show-hot-strip", "showHotStrip");
  bindSettingsCheckbox("set-show-concurrent", "showConcurrentEst");

  document.getElementById("btn-clear-recent")?.addEventListener("click", () => {
    localStorage.removeItem(LS_RECENT);
    renderRecentStrip();
    renderGrid();
    renderCategories(collectCategories(allGames));
  });
  document.getElementById("btn-clear-counts")?.addEventListener("click", () => {
    localStorage.removeItem(LS_COUNTS);
    renderGrid();
    renderRecentStrip();
    const pid = new URLSearchParams(window.location.search).get("id");
    if (playerOpen && pid) updatePlayerStats(Number(pid));
  });
  document.getElementById("btn-clear-fav")?.addEventListener("click", () => {
    localStorage.removeItem(LS_FAV);
    renderGrid();
    renderCategories(collectCategories(allGames));
  });

  window.addEventListener("keydown", onKeydown);
  window.addEventListener("popstate", onPopState);

  try {
    await loadHtmlBase();
    const res = await fetch(ZONES_URL + "?t=" + Date.now());
    if (!res.ok) throw new Error("Could not load game list");
    allGames = await res.json();
    if (!Array.isArray(allGames)) throw new Error("Invalid game list");

    allGames.forEach((g, i) => {
      g._order = i;
    });

    try {
      const tagRes = await fetch(TAG_ZONES_URL + "?t=" + Date.now());
      if (tagRes.ok) {
        const tagList = await tagRes.json();
        if (Array.isArray(tagList)) {
          const byId = new Map(tagList.map((x) => [x.id, x]));
          allGames = allGames.map((g) => {
            const extra = byId.get(g.id);
            if (!extra || !extra.tags) return g;
            return { ...g, tags: extra.tags };
          });
        }
      }
    } catch {
      /* optional tags */
    }

    status.classList.add("hidden");
    renderCategories(collectCategories(allGames));
    renderGrid();
    renderRecentStrip();

    document.getElementById("search")?.addEventListener("input", () => {
      renderGrid();
    });

    document.getElementById("player-close")?.addEventListener("click", () => closePlayer());
    document.getElementById("player-fs")?.addEventListener("click", () => {
      const wrap = document.querySelector(".player-frame-wrap");
      if (wrap?.requestFullscreen) wrap.requestFullscreen();
    });

    const deepId = new URLSearchParams(window.location.search).get("id");
    if (deepId) {
      const g0 = findGame(Number(deepId));
      if (g0 && isPlayableGame(g0) && !isExternalOnly(g0)) {
        openPlayer(g0.id, { replace: true });
      }
    }

    initGlobalStats();

    registerSw();
  } catch (e) {
    console.error(e);
    status.textContent = "Could not load games. Check your connection and refresh.";
    status.classList.add("error");
  }
}

init();
