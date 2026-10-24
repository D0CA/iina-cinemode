const { core, event, overlay, menu, console, preferences, mpv, standaloneWindow, utils } = iina;
const identify = require("./identify.js");
const tmdb = require("./tmdb.js");
const intro = require("./intro.js");
const introdb = require("./introdb.js");
const aniskip = require("./aniskip.js");
const store = require("./store.js");
const i18n = require("./i18n.js");
const trakt = require("./trakt.js");

let overlayReady = false;
let overlayLoaded = false;
let overlayBound = false;
let currentParsed = null;
let currentMeta = null;
let currentSegments = [];
let markStart = null;
let warnedMissingKey = false;
let lastSkipVisible = false;
let loadTimer = null;
let syncTimer = null;
let hideTimer = null;
let pauseDelayTimer = null;
let pauseReady = false;
let pauseDismissed = false;
let heldPausePos = null;
let eatSwipeUntil = 0;
let eatSwipeTimer = null;
let autoSkippedFor = null;
let tracksApplied = false;
let searchShow = null;
let lastSearchQuery = "";
let lastSearchAt = 0;
let searchSeq = 0;
let lastPickEpisode = "";
let lastPickEpisodeAt = 0;
let traktProgress = null;

function lang() {
  return i18n.code();
}

function osd(message) {
  try {
    core.osd(message);
  } catch (err) {
    console.log(message);
  }
}

function readTimePos() {
  let pos = core.status.position;
  if (typeof pos !== "number" || isNaN(pos)) {
    try {
      pos = mpv.get("time-pos");
    } catch (err) {
      pos = null;
    }
  }
  if (typeof pos !== "number" || isNaN(pos)) return null;
  return pos;
}

function freezePausePos() {
  const pos = readTimePos();
  if (pos != null) heldPausePos = pos;
}

function eatingSwipe() {
  return !!eatSwipeUntil && Date.now() < eatSwipeUntil;
}

function finishEatSwipe() {
  eatSwipeTimer = null;
  eatSwipeUntil = 0;
  if (core.status.paused && heldPausePos != null) {
    const pos = readTimePos();
    if (pos != null && Math.abs(pos - heldPausePos) > 0.2) {
      restoreHeldPos();
    }
  }
  requestSync(true);
}

function beginEatSwipe() {
  eatSwipeUntil = Date.now() + 1600;
  if (eatSwipeTimer) clearTimeout(eatSwipeTimer);
  eatSwipeTimer = setTimeout(finishEatSwipe, 1600);
}

function extendEatSwipe() {
  if (!core.status.paused) return;
  eatSwipeUntil = Date.now() + 450;
  if (eatSwipeTimer) clearTimeout(eatSwipeTimer);
  eatSwipeTimer = setTimeout(finishEatSwipe, 450);
}

function restoreHeldPos() {
  if (heldPausePos == null || isNaN(heldPausePos)) return;
  try {
    mpv.set("time-pos", heldPausePos);
  } catch (err) {
    try {
      core.seekTo(heldPausePos);
    } catch (err2) {}
  }
}

function cacheNameFor(parsed) {
  return `${lang()}::${(parsed && parsed.release) || core.status.title || ""}`;
}

function prettyTitle(meta) {
  if (!meta) return null;
  if (meta.mediaType === "tv" && meta.season != null && meta.episode != null) {
    const se =
      "S" +
      String(meta.season).padStart(2, "0") +
      "E" +
      String(meta.episode).padStart(2, "0");
    if (meta.episodeTitle) return `${meta.showTitle} · ${se} · ${meta.episodeTitle}`;
    return `${meta.showTitle} · ${se}`;
  }
  if (meta.year) return `${meta.title} (${meta.year})`;
  return meta.title || null;
}

function applyWindowTitle(meta) {
  const title = prettyTitle(meta);
  if (!title) return;
  try {
    mpv.set("force-media-title", title);
  } catch (err) {}
  try {
    mpv.set("media-title", title);
  } catch (err) {}
}

function pauseDelayMs() {
  const value = Number(preferences.get("pauseDelay"));
  const seconds = isNaN(value) ? 2 : value;
  return Math.max(0, seconds) * 1000;
}

function langMatches(trackLang, want) {
  const a = String(trackLang || "").toLowerCase();
  if (!a || !want) return false;
  const aliases = {
    fr: ["fr", "fra", "fre", "french", "vff", "vf", "truefrench"],
    en: ["en", "eng", "english"],
    es: ["es", "spa", "spanish", "castellano"],
    de: ["de", "ger", "deu", "german"],
    it: ["it", "ita", "italian"],
    pt: ["pt", "por", "pob", "portuguese", "brazilian"],
  };
  const codes = aliases[want] || [want];
  const tokens = a.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  return codes.some(function (code) {
    if (a === code || a.indexOf(code + "-") === 0 || a.indexOf(code + "_") === 0) return true;
    return tokens.indexOf(code) >= 0;
  });
}

function preferLanguageTracks() {
  if (tracksApplied) return;
  if (preferences.get("matchLanguageTracks") === false) return;
  const want = lang().slice(0, 2).toLowerCase();
  try {
    const audioTracks = core.audio.tracks || [];
    const audioMatch = audioTracks.find(function (track) {
      return langMatches(track.lang, want) || langMatches(track.title, want);
    });
    if (audioMatch) core.audio.id = audioMatch.id;

    const currentAudio = core.audio.currentTrack;
    const audioIsWanted = currentAudio && langMatches(currentAudio.lang || currentAudio.title, want);
    const subTracks = core.subtitle.tracks || [];
    if (audioIsWanted) {
      const forced = subTracks.find(function (track) {
        return track.isForced && langMatches(track.lang, want);
      });
      if (forced) core.subtitle.id = forced.id;
      tracksApplied = true;
      return;
    }
    const subMatch = subTracks.find(function (track) {
      return langMatches(track.lang, want) || langMatches(track.title, want);
    });
    if (subMatch) core.subtitle.id = subMatch.id;
    if (audioTracks.length || subTracks.length) tracksApplied = true;
  } catch (err) {
    console.log(`tracks: ${err}`);
  }
}

function playbackSnapshot() {
  const duration = core.status.duration;
  const position = core.status.position;
  const active = intro.findActive(currentSegments, position || 0);
  return {
    title: (currentMeta && (currentMeta.showTitle || currentMeta.title)) || core.status.title,
    lang: lang(),
    strings: i18n.bundle(),
    paused: core.status.paused,
    duration: duration,
    position: position,
    remaining: duration != null && position != null ? Math.max(0, duration - position) : null,
    meta: currentMeta,
    poster: currentMeta && currentMeta.poster,
    backdrop: currentMeta && currentMeta.backdrop,
    pauseVisible:
      !!preferences.get("pauseOverlay") &&
      !!core.status.paused &&
      pauseReady &&
      !pauseDismissed,
    skipVisible: !!preferences.get("skipIntro") && !core.status.paused && !!active,
    skipKind: active && active.type,
    eatWheel: !!core.status.paused && eatingSwipe(),
    overlay: {
      cast: preferences.get("overlayCast") !== false,
      synopsis: preferences.get("overlaySynopsis") !== false,
      progress: preferences.get("overlayProgress") !== false,
      upNext: preferences.get("overlayUpNext") !== false,
    },
  };
}

function syncOverlay() {
  if (!overlayReady) return;
  const state = playbackSnapshot();
  const visible = state.pauseVisible || state.skipVisible || state.eatWheel;
  lastSkipVisible = state.skipVisible;
  if (visible) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    overlay.show();
    overlay.postMessage("state", state);
    overlay.setClickable(true);
  } else {
    overlay.setClickable(false);
    overlay.postMessage("state", state);
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      const next = playbackSnapshot();
      if (!next.pauseVisible && !next.skipVisible && !next.eatWheel) {
        overlay.hide();
      }
    }, state.paused && pauseDismissed ? 120 : 900);
  }
}

function requestSync(force) {
  if (force) {
    syncOverlay();
    return;
  }
  if (syncTimer) return;
  syncTimer = setTimeout(function () {
    syncTimer = null;
    syncOverlay();
  }, 250);
}

function bindOverlayMessages() {
  if (overlayBound) return;
  overlayBound = true;
  overlay.onMessage("ready", function () {
    overlayReady = true;
    console.log("overlay ready");
    syncOverlay();
  });
  overlay.onMessage("resume", function () {
    core.resume();
  });
  overlay.onMessage("skip-intro", function () {
    skipCurrentIntro();
  });
  overlay.onMessage("search-title", function () {
    openSearch();
  });
  overlay.onMessage("open-next", function () {
    openNextInStremio();
  });
  overlay.onMessage("dismiss-pause", function (payload) {
    if (!core.status.paused) return;
    pauseDismissed = true;
    if (!payload || payload.reason !== "click") {
      beginEatSwipe();
    }
    requestSync(true);
  });
  overlay.onMessage("swipe-eat", function () {
    if (!core.status.paused || !pauseDismissed) return;
    extendEatSwipe();
  });
  overlay.onMessage("swipe-eat-done", function () {
    if (!pauseDismissed) return;
    eatSwipeUntil = 0;
    if (eatSwipeTimer) clearTimeout(eatSwipeTimer);
    finishEatSwipe();
  });
}

function ensureOverlay() {
  if (overlayLoaded) return;
  overlayLoaded = true;
  overlay.loadFile("ui/overlay.html");
}

function skipCurrentIntro() {
  const active = intro.findActive(currentSegments, core.status.position || 0, 0.2);
  if (!active) {
    osd(i18n.t("skipNone"));
    return;
  }
  autoSkippedFor = `${active.type}:${active.end}`;
  core.seekTo(active.end + 0.15);
  const keys = { recap: "skippedRecap", intro: "skippedIntro", credits: "skippedCredits" };
  osd(i18n.t(keys[active.type] || "skippedIntro"));
  requestSync(true);
}

function stremioEpisodeRef(meta) {
  const next = meta && meta.nextEpisode;
  let imdb = meta && meta.imdbId;
  if (!next || next.season == null || next.episode == null) return null;
  if (!imdb) return null;
  imdb = String(imdb).trim();
  if (!/^tt\d+/i.test(imdb)) return null;
  const id = imdb.toLowerCase();
  return {
    id: id,
    path: `${id}:${next.season}:${next.episode}`,
  };
}

function stremioNextUrl(meta) {
  const ref = stremioEpisodeRef(meta);
  if (!ref) return null;
  return `stremio:///detail/series/${ref.id}/${ref.path}`;
}

function stremioWebUrl(meta) {
  const ref = stremioEpisodeRef(meta);
  if (!ref) return null;
  return `https://web.stremio.com/#/detail/series/${ref.id}/${ref.path}`;
}

async function execOpen(args) {
  const result = await utils.exec("/usr/bin/open", args);
  const status = result && result.status;
  console.log(`open ${args.join(" ")} status=${status} stderr=${(result && result.stderr) || ""}`);
  return status === 0 || status == null;
}

async function openExternal(url) {
  try {
    if (await execOpen(["-u", url])) return true;
  } catch (err) {
    console.log(`open -u: ${err}`);
  }
  try {
    if (await execOpen([url])) return true;
  } catch (err) {
    console.log(`open url: ${err}`);
  }
  return false;
}

function upNextEnabled() {
  return preferences.get("overlayUpNext") !== false;
}

async function openNextInStremio() {
  if (!upNextEnabled()) return;
  if (!currentMeta || !currentMeta.nextEpisode) {
    osd(i18n.t("stremioNoNext"));
    return;
  }
  if (!currentMeta.imdbId && currentMeta.id) {
    try {
      currentMeta.imdbId = await tmdb.getImdbId("tv", currentMeta.id);
      if (currentMeta.imdbId && currentParsed) {
        store.setMetaCache(cacheNameFor(currentParsed), currentMeta);
      }
    } catch (err) {
      console.log(`imdb: ${err}`);
    }
  }
  const appUrl = stremioNextUrl(currentMeta);
  const webUrl = stremioWebUrl(currentMeta);
  if (!appUrl || !webUrl) {
    osd(i18n.t("stremioNoId"));
    return;
  }
  try {
    let opened = false;
    try {
      opened = await execOpen(["-a", "Stremio", appUrl]);
    } catch (err) {
      console.log(`open Stremio app: ${err}`);
    }
    if (!opened) opened = await openExternal(appUrl);
    // Stremio v5 on macOS often launches but drops stremio:// navigation.
    const webOpened = await openExternal(webUrl);
    if (!opened && !webOpened) {
      osd(i18n.t("stremioOpenFail"));
      return;
    }
    osd(i18n.t("stremioOpened"));
  } catch (err) {
    console.log(`stremio open: ${err}`);
    osd(i18n.t("stremioOpenFail"));
  }
}

function playbackProgress() {
  const duration = Number(core.status.duration);
  const position = readTimePos();
  if (!duration || position == null) return null;
  return Math.min(100, (position / duration) * 100);
}

function traktSync() {
  if (!currentMeta) return;
  const progress = playbackProgress();
  if (progress == null) return;
  traktProgress = progress;
  trakt.scrobble(core.status.paused ? "pause" : "start", currentMeta, progress);
}

function traktStopCurrent() {
  if (!currentMeta || traktProgress == null) return;
  trakt.scrobble("stop", currentMeta, traktProgress);
}

function connectTrakt() {
  trakt
    .connect(function (update) {
      if (update.state === "missing-client") osd(i18n.t("traktMissingClient"));
      else if (update.state === "code") {
        const code = String(update.code || "").replace(/[^A-Za-z0-9]/g, "");
        utils.exec("/bin/sh", ["-c", `printf %s ${code} | /usr/bin/pbcopy`]).catch(function () {});
        openExternal(update.url);
        osd(i18n.t("traktCode", { code: update.code }));
      } else if (update.state === "connected") {
        osd(i18n.t("traktConnected"));
        traktSync();
      } else if (update.state === "expired") osd(i18n.t("traktExpired"));
      else if (update.state === "denied") osd(i18n.t("traktDenied"));
      else osd(i18n.t("traktError"));
    })
    .catch(function (err) {
      console.log(`trakt connect: ${err}`);
      osd(i18n.t("traktError"));
    });
}

function chapterList() {
  let chapters = [];
  try {
    chapters = core.getChapters() || [];
  } catch (err) {
    chapters = [];
  }
  if (!chapters.length) {
    try {
      chapters = mpv.getNative("chapter-list") || [];
    } catch (err) {
      chapters = [];
    }
  }
  return chapters;
}

async function resolveSkipSegments() {
  if (!preferences.get("skipIntro")) {
    currentSegments = [];
    return;
  }
  if (!currentMeta || !currentMeta.id) {
    currentSegments = [];
    return;
  }

  const saved = store.getIntro(currentMeta);
  if (saved && saved.source === "user") {
    currentSegments = [Object.assign({ type: "intro" }, saved)];
    return;
  }

  if (preferences.get("useIntroDB") !== false) {
    const remote = await introdb.fetchSegments(currentMeta, core.status.duration);
    if (remote.length) {
      currentSegments = remote;
      return;
    }
  }

  if (preferences.get("useAniSkip") !== false && currentMeta.malId) {
    const remote = await aniskip.fetchSegments(currentMeta, core.status.duration);
    if (remote.length) {
      currentSegments = remote;
      return;
    }
  }

  const detected = intro.fromChapters(chapterList(), core.status.duration, false);
  if (detected && detected.length) {
    currentSegments = detected;
    return;
  }
  currentSegments = [];
}

async function applyMeta(meta) {
  currentMeta = meta || null;
  if (meta) {
    if (!currentParsed) currentParsed = identify.identifyPlayback(core, mpv);
    currentParsed = Object.assign({}, currentParsed, {
      mediaType: meta.mediaType || currentParsed.mediaType,
      title: meta.showTitle || meta.title || currentParsed.title,
      season: meta.season != null ? meta.season : currentParsed.season,
      episode: meta.episode != null ? meta.episode : currentParsed.episode,
    });
    store.setMetaCache(cacheNameFor(currentParsed), meta);
    applyWindowTitle(meta);
    osd(`CineMode · ${prettyTitle(meta)}`);
    traktSync();
  }
  syncOverlay();
  resolveSkipSegments()
    .then(function () {
      syncOverlay();
    })
    .catch(function (err) {
      console.log(`skip resolve: ${err}`);
    });
}

async function loadMetadata(force) {
  currentParsed = await identify.identifyPlaybackAsync(core, mpv);
  console.log(
    `identify title="${currentParsed.title}" s=${currentParsed.season} e=${currentParsed.episode} release="${currentParsed.release}"`,
  );
  const cacheName = cacheNameFor(currentParsed);
  if (!force) {
    const cached = store.getMetaCache(cacheName);
    if (cached && cached.id && cached.airDate !== undefined) {
      currentMeta = cached;
      applyWindowTitle(cached);
      traktSync();
      await resolveSkipSegments();
      syncOverlay();
      if (!cached.malId) {
        tmdb
          .enrichAniList(cached, currentParsed)
          .then(function (meta) {
            if (meta && meta.malId) applyMeta(meta);
          })
          .catch(function (err) {
            console.log(`anilist cache enrich: ${err}`);
          });
      }
      return;
    }
  }

  if (!tmdb.apiKey()) {
    currentMeta = null;
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      osd(i18n.t("missingKey"));
    }
    await resolveSkipSegments();
    syncOverlay();
    return;
  }

  if (!currentParsed.title || currentParsed.title.length < 2) {
    if (!currentParsed.imdbId) {
      currentMeta = null;
      await resolveSkipSegments();
      syncOverlay();
      return;
    }
  }

  try {
    currentParsed.duration = Number(core.status.duration) || 0;
    const meta = await tmdb.hydrate(currentParsed);
    if (meta) {
      await applyMeta(meta);
      return;
    }
    console.log(`no TMDB match for ${cacheName} / ${currentParsed.title}`);
    currentMeta = null;
  } catch (err) {
    console.log(`metadata: ${err}`);
    currentMeta = null;
  }
  await resolveSkipSegments();
  syncOverlay();
}

function maybeAutoSkip() {
  if (!preferences.get("autoSkip") || !preferences.get("skipIntro")) return;
  if (core.status.paused) return;
  const position = core.status.position || 0;
  const active = intro.findActive(currentSegments, position, 1.2);
  if (!active || active.type === "credits") return;
  if (autoSkippedFor === `${active.type}:${active.end}`) return;
  skipCurrentIntro();
}

function onFileLoaded() {
  traktStopCurrent();
  traktProgress = null;
  currentMeta = null;
  currentSegments = [];
  markStart = null;
  autoSkippedFor = null;
  tracksApplied = false;
  pauseReady = false;
  try {
    mpv.set("force-media-title", "");
  } catch (err) {}
  if (pauseDelayTimer) {
    clearTimeout(pauseDelayTimer);
    pauseDelayTimer = null;
  }
  if (loadTimer) clearTimeout(loadTimer);
  loadTimer = setTimeout(function () {
    loadMetadata(false);
    setTimeout(preferLanguageTracks, 800);
  }, 250);
}

function markIntroBoundary(which) {
  const position = core.status.position || 0;
  if (which === "start") {
    markStart = position;
    osd(i18n.t("markStart", { n: Math.round(position) }));
    return;
  }
  if (markStart == null) {
    osd(i18n.t("markStartFirst"));
    return;
  }
  if (!currentMeta || !currentMeta.id) {
    osd(i18n.t("identifyFirst"));
    return;
  }
  const range = {
    start: Math.min(markStart, position),
    end: Math.max(markStart, position),
    source: "user",
  };
  if (range.end - range.start < 5) {
    osd(i18n.t("introTooShort"));
    return;
  }
  currentSegments = [Object.assign({ type: "intro" }, store.saveIntro(currentMeta, range, "season") || range)];
  markStart = null;
  osd(i18n.t("introSaved"));
  syncOverlay();
}

function unwrap(data) {
  if (data == null) return null;
  if (typeof data === "string") {
    const text = data.trim();
    if (!text) return "";
    if (text.charAt(0) === "{" || text.charAt(0) === "[") {
      try {
        return JSON.parse(text);
      } catch (err) {}
    }
    return data;
  }
  if (typeof data === "object") {
    const owned =
      data.tmdbId != null ||
      data.id != null ||
      data.pick != null ||
      data.query != null ||
      data.items != null ||
      data.showTitle != null ||
      data.mediaType != null ||
      data.season != null;
    if (!owned) {
      if (data.data != null) return unwrap(data.data);
      if (data.payload != null) return unwrap(data.payload);
    }
  }
  return data;
}

function asPositiveInt(value) {
  const n = Number(value);
  if (!isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function parseCompact(raw, parts) {
  if (typeof raw !== "string") return null;
  const bits = raw.split(":");
  if (bits.length < parts) return null;
  return bits;
}

function pickShowOf(raw) {
  const value = unwrap(raw);
  if (typeof value === "string") {
    const bits = parseCompact(value, 2);
    if (!bits) return null;
    const mediaType = bits[0] === "movie" ? "movie" : "tv";
    const id = asPositiveInt(bits[1]);
    if (!id) return null;
    return { id: id, tmdbId: id, mediaType: mediaType, name: "" };
  }
  if (!value || typeof value !== "object") return null;
  const id = asPositiveInt(value.tmdbId != null ? value.tmdbId : value.id);
  if (!id) return null;
  return {
    id: id,
    tmdbId: id,
    mediaType: value.mediaType === "movie" ? "movie" : "tv",
    name: value.name || "",
  };
}

function pickSeasonOf(raw) {
  const value = unwrap(raw);
  if (typeof value === "string") {
    const bits = parseCompact(value, 2);
    if (!bits) return null;
    const id = asPositiveInt(bits[0]);
    const season = asPositiveInt(bits[1]);
    if (!id || season == null) return null;
    return { id: id, season: season };
  }
  if (!value || typeof value !== "object") return null;
  const id = asPositiveInt(value.tmdbId != null ? value.tmdbId : value.id);
  const season = asPositiveInt(value.season);
  if (!id || season == null) return null;
  return { id: id, season: season };
}

function pickFromCompact(text) {
  const bits = parseCompact(text, 3);
  if (!bits) return null;
  const id = asPositiveInt(bits[0]);
  const season = asPositiveInt(bits[1]);
  const episode = asPositiveInt(bits[2]);
  if (!id || season == null || episode == null) return null;
  return { id: id, season: season, episode: episode };
}

function pickEpisodeOf(raw) {
  const value = unwrap(raw);
  if (typeof value === "string") return pickFromCompact(value);
  if (!value || typeof value !== "object") return null;
  if (typeof value.pick === "string") {
    const packed = pickFromCompact(value.pick);
    if (packed) return packed;
  }
  const id = asPositiveInt(value.tmdbId != null ? value.tmdbId : value.id);
  const season = asPositiveInt(value.season);
  const episode = asPositiveInt(value.episode);
  if (!id || season == null || episode == null) return null;
  return { id: id, season: season, episode: episode };
}

function metaFromSearchPick(data) {
  const id = asPositiveInt(data.tmdbId != null ? data.tmdbId : data.id);
  if (!id) return null;
  return {
    mediaType: data.mediaType === "movie" ? "movie" : "tv",
    id: id,
    season: data.season == null ? null : asPositiveInt(data.season),
    episode: data.episode == null ? null : asPositiveInt(data.episode),
    showTitle: data.showTitle || data.name || "",
    title: data.showTitle || data.name || data.title || "",
    episodeTitle: data.episodeTitle || "",
    year: data.year || "",
    synopsis: data.synopsis || "",
    poster: data.poster || null,
    backdrop: data.backdrop || null,
    logo: data.logo || null,
    cast: data.cast || [],
    genres: data.genres || [],
    rating: data.rating || null,
    nextEpisode: data.nextEpisode || null,
    imdbId: data.imdbId || null,
  };
}

function finishSearchPick(meta) {
  if (!meta || !meta.id) return false;
  try {
    standaloneWindow.close();
  } catch (err) {}
  applyMeta(meta);
  if (meta.mediaType === "tv" && meta.season != null && meta.episode != null) {
    tmdb
      .hydratePicked("tv", meta.id, meta.season, meta.episode)
      .then(function (full) {
        if (full) applyMeta(full);
      })
      .catch(function (err) {
        console.log(`enrich pick: ${err}`);
      });
  }
  return true;
}

function searchQueryOf(data) {
  const value = unwrap(data);
  if (typeof value === "string") return value.trim();
  if (value && typeof value.query === "string") return value.query.trim();
  if (value && value.data && typeof value.data.query === "string") return value.data.query.trim();
  return "";
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error(label || "timeout"));
      }, ms);
    }),
  ]);
}

function searchPost(name, data) {
  try {
    standaloneWindow.postMessage(name, data);
  } catch (err) {
    console.log(`search post ${name}: ${err}`);
  }
}

function sendSearchInit() {
  searchPost("init", {
    strings: i18n.bundle(),
    prefill: (currentParsed && currentParsed.title) || "",
    apiKey: tmdb.apiKey(),
    language: lang(),
    season: currentParsed && currentParsed.season,
    episode: currentParsed && currentParsed.episode,
  });
}

function ensureSearchBound() {
  // IINA loadFile() wipes standaloneWindow.onMessage listeners.
  standaloneWindow.onMessage("search-ready", function () {
    sendSearchInit();
  });

  standaloneWindow.onMessage("search-query", function (data) {
    const query = searchQueryOf(data);
    console.log(`search-query: "${query}" type=${typeof data}`);
    if (!query) return;
    const now = Date.now();
    if (query === lastSearchQuery && now - lastSearchAt < 800) return;
    lastSearchQuery = query;
    lastSearchAt = now;
    const seq = ++searchSeq;
    searchPost("loading", { message: i18n.t("searchLoading") });
    withTimeout(tmdb.searchAll(query), 20000, "search timeout")
      .then(function (items) {
        if (seq !== searchSeq) return;
        searchPost("results", { items: items || [] });
      })
      .catch(function (err) {
        if (seq !== searchSeq) return;
        console.log(`search: ${err}`);
        searchPost("error", { message: i18n.t("noTmdb") });
      });
  });

  standaloneWindow.onMessage("pick-show", function (raw) {
    const item = pickShowOf(raw);
    console.log(`pick-show: ${JSON.stringify(item)}`);
    if (!item || !item.id) {
      console.log("pick-show ignored");
      return;
    }
    searchSeq += 1;
    searchShow = item;
    if (item.mediaType === "movie") {
      try {
        standaloneWindow.close();
      } catch (err) {}
      withTimeout(tmdb.hydratePicked("movie", item.id), 20000, "movie timeout")
        .then(applyMeta)
        .catch(function (err) {
          console.log(`pick movie: ${err}`);
          osd(i18n.t("noTmdb"));
        });
      return;
    }
    const knownSeason = currentParsed && currentParsed.season;
    searchPost("loading", { message: i18n.t("searchLoadingSeasons") });
    if (knownSeason) {
      tmdb
        .getEpisodes(item.id, knownSeason)
        .then(function (items) {
          searchPost("episodes", {
            show: item,
            season: knownSeason,
            items: items || [],
          });
        })
        .catch(function (err) {
          console.log(`pick show jump: ${err}`);
          return tmdb.getSeasons(item.id).then(function (items) {
            searchPost("seasons", { show: item, items: items || [] });
          });
        })
        .catch(function (err) {
          console.log(`seasons: ${err}`);
          searchPost("error", { message: i18n.t("noTmdb") });
        });
      return;
    }
    withTimeout(tmdb.getSeasons(item.id), 20000, "seasons timeout")
      .then(function (items) {
        searchPost("seasons", { show: item, items: items || [] });
      })
      .catch(function (err) {
        console.log(`seasons: ${err}`);
        searchPost("error", { message: i18n.t("noTmdb") });
      });
  });

  standaloneWindow.onMessage("pick-season", function (raw) {
    const data = pickSeasonOf(raw) || {};
    const id = data.id;
    const season = data.season;
    console.log(`pick-season: id=${id} season=${season}`);
    if (!id || season == null) {
      searchPost("error", { message: i18n.t("noTmdb") });
      return;
    }
    searchPost("loading", { message: i18n.t("searchLoadingEpisodes") });
    withTimeout(tmdb.getEpisodes(id, season), 20000, "episodes timeout")
      .then(function (items) {
        searchPost("episodes", {
          show: searchShow,
          season: season,
          items: items || [],
        });
      })
      .catch(function (err) {
        console.log(`episodes: ${err}`);
        searchPost("error", { message: i18n.t("noTmdb") });
      });
  });

  standaloneWindow.onMessage("back-seasons", function (raw) {
    const data = unwrap(raw) || {};
    const id = asPositiveInt(data.tmdbId != null ? data.tmdbId : data.id) || (searchShow && searchShow.id);
    if (!id) return;
    searchPost("loading", { message: i18n.t("searchLoadingSeasons") });
    tmdb
      .getSeasons(id)
      .then(function (items) {
        searchPost("seasons", { show: searchShow, items: items || [] });
      })
      .catch(function (err) {
        searchPost("error", { message: i18n.t("noTmdb") });
      });
  });

  standaloneWindow.onMessage("apply-pick", function (raw) {
    const data = unwrap(raw);
    console.log(`apply-pick type=${typeof data}`);
    let meta = data && typeof data === "object" ? metaFromSearchPick(data) : null;
    if (!meta || !meta.id) {
      const picked = pickEpisodeOf(raw);
      if (!picked) return;
      meta = {
        mediaType: "tv",
        id: picked.id,
        season: picked.season,
        episode: picked.episode,
        showTitle: (searchShow && searchShow.name) || "",
        title: (searchShow && searchShow.name) || "",
      };
    }
    const key = meta.id + ":" + meta.season + ":" + meta.episode;
    lastPickEpisode = key;
    lastPickEpisodeAt = Date.now();
    finishSearchPick(meta);
  });

  standaloneWindow.onMessage("pick-episode", function (raw) {
    const data = pickEpisodeOf(raw);
    console.log(`pick-episode: ${JSON.stringify(data)} type=${typeof raw}`);
    if (!data || !data.id || data.season == null || data.episode == null) {
      console.log("pick-episode ignored");
      return;
    }
    const key = data.id + ":" + data.season + ":" + data.episode;
    if (key === lastPickEpisode) {
      try {
        standaloneWindow.close();
      } catch (err) {}
      return;
    }
    lastPickEpisode = key;
    lastPickEpisodeAt = Date.now();
    finishSearchPick({
      mediaType: "tv",
      id: data.id,
      season: data.season,
      episode: data.episode,
      showTitle: (searchShow && searchShow.name) || "",
      title: (searchShow && searchShow.name) || "",
    });
  });
}

function openSearch() {
  try {
    standaloneWindow.loadFile("ui/search.html");
    ensureSearchBound();
    standaloneWindow.setProperty({
      title: i18n.t("searchWindowTitle"),
      resizable: true,
    });
    standaloneWindow.setFrame(560, 740);
    if (typeof standaloneWindow.open === "function") standaloneWindow.open();
    else standaloneWindow.show();
    setTimeout(sendSearchInit, 200);
    setTimeout(sendSearchInit, 800);
  } catch (err) {
    console.log(`search window: ${err}`);
    osd(i18n.t("searchWindowFail"));
  }
}

function setupMenu() {
  menu.addItem(
    menu.item(i18n.t("menuSkip"), function () {
      skipCurrentIntro();
    }, { keyBinding: "S" }),
  );
  menu.addItem(
    menu.item(i18n.t("menuMarkStart"), function () {
      markIntroBoundary("start");
    }),
  );
  menu.addItem(
    menu.item(i18n.t("menuMarkEnd"), function () {
      markIntroBoundary("end");
    }),
  );
  menu.addItem(menu.separator());
  menu.addItem(
    menu.item(i18n.t("menuSearch"), function () {
      openSearch();
    }),
  );
  if (upNextEnabled()) {
    menu.addItem(
      menu.item(i18n.t("menuNextStremio"), function () {
        openNextInStremio();
      }),
    );
  }
  menu.addItem(
    menu.item(i18n.t("menuIdentify"), function () {
      if (currentParsed) store.clearMetaCache(cacheNameFor(currentParsed));
      loadMetadata(true);
    }),
  );
  menu.addItem(menu.separator());
  menu.addItem(
    menu.item(i18n.t("menuTraktConnect"), function () {
      connectTrakt();
    }),
  );
  menu.addItem(
    menu.item(i18n.t("menuTraktDisconnect"), function () {
      trakt.disconnect().then(function () {
        osd(i18n.t("traktDisconnected"));
      });
    }),
  );
}

event.on("iina.window-loaded", function () {
  ensureOverlay();
});

event.on("iina.plugin-overlay-loaded", function () {
  bindOverlayMessages();
  overlayReady = true;
  console.log("plugin overlay loaded");
  syncOverlay();
});

event.on("iina.file-loaded", onFileLoaded);

event.on("iina.window-will-close", traktStopCurrent);

event.on("mpv.pause.changed", function () {
  if (pauseDelayTimer) {
    clearTimeout(pauseDelayTimer);
    pauseDelayTimer = null;
  }
  if (core.status.paused) {
    pauseDismissed = false;
    eatSwipeUntil = 0;
    if (eatSwipeTimer) {
      clearTimeout(eatSwipeTimer);
      eatSwipeTimer = null;
    }
    freezePausePos();
    pauseReady = false;
    pauseDelayTimer = setTimeout(function () {
      pauseDelayTimer = null;
      if (core.status.paused && !pauseDismissed) {
        pauseReady = true;
        freezePausePos();
        requestSync(true);
      }
    }, pauseDelayMs());
  } else {
    pauseReady = false;
    pauseDismissed = false;
    heldPausePos = null;
    eatSwipeUntil = 0;
    if (eatSwipeTimer) {
      clearTimeout(eatSwipeTimer);
      eatSwipeTimer = null;
    }
  }
  traktSync();
  requestSync(true);
});

event.on("mpv.time-pos.changed", function () {
  maybeAutoSkip();
  const progress = playbackProgress();
  if (progress != null && currentMeta) {
    traktProgress = progress;
    if (progress >= 90) trakt.scrobble("stop", currentMeta, progress);
  }
  const position = core.status.position || 0;
  const skipVisible =
    !!preferences.get("skipIntro") &&
    !core.status.paused &&
    !!intro.findActive(currentSegments, position);
  if (core.status.paused) {
    if (eatingSwipe()) return;
    if (
      pauseReady &&
      !pauseDismissed &&
      preferences.get("dismissOnSeek") !== false &&
      heldPausePos != null &&
      Math.abs(position - heldPausePos) > 0.25
    ) {
      pauseDismissed = true;
      beginEatSwipe();
      requestSync(true);
      return;
    }
    requestSync();
    return;
  }
  if (skipVisible !== lastSkipVisible) {
    requestSync(true);
  }
});

event.on("mpv.track-list.changed", function () {
  preferLanguageTracks();
});

event.on("mpv.chapter-list.changed", function () {
  resolveSkipSegments().then(function () {
    syncOverlay();
  });
});

setupMenu();
ensureSearchBound();
console.log("CineMode loaded");
