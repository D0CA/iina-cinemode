const form = document.getElementById("search-form");
const queryEl = document.getElementById("query");
const submitEl = document.getElementById("submit");
const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");
const headingEl = document.getElementById("heading");
const crumbEl = document.getElementById("crumb");
const backEl = document.getElementById("back");
const fileHintEl = document.getElementById("file-hint");

let strings = {
  searchStepShow: "1. Série ou film",
  searchStepSeason: "2. Saison",
  searchStepEpisode: "3. Épisode",
  searchPlaceholder: "Nom de la série",
  searchSubmit: "Rechercher",
  searchEmpty: "Aucun résultat",
  searchBack: "Retour",
  searchShow: "Série",
  searchSeasonN: "Saison {n}",
  searchEpisodeCount: "{n} épisodes",
  searchLoading: "Recherche…",
  searchLoadingSeasons: "Chargement des saisons…",
  searchLoadingEpisodes: "Chargement des épisodes…",
  searchApplying: "Application de S{s}E{e}…",
  searchApplyFail: "IINA n'a pas reçu le choix. Réessaie.",
  searchFileEpisode: "Fichier : S{s}E{e}",
  searchFileAbsolute: "Fichier : E{e}",
  searchCurrent: "en lecture",
  searchHint: "Clique un résultat pour continuer",
  movie: "Film",
  noTmdb: "Aucun résultat TMDB",
};
let step = "show";
let pickedShow = null;
let pickedSeason = null;
let fileSeason = null;
let fileEpisode = null;
let apiKey = "";
let tmdbLang = "fr-FR";
let searchGen = 0;
let ready = false;
let pingTimer = null;
let waitTimer = null;
let rows = [];
let activeIndex = -1;
let picking = false;
let lastEpisodes = [];
let applyTimer = null;
let applyTries = 0;

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
  return data;
}

function t(key, vars) {
  let text = strings[key] || key;
  if (vars) {
    Object.keys(vars).forEach(function (name) {
      text = text.replace("{" + name + "}", vars[name]);
    });
  }
  return text;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function send(name, data) {
  if (data == null) {
    iina.postMessage(name);
    return;
  }
  iina.postMessage(name, data);
}

function setStatus(text, show) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("hidden", !show || !text);
}

function updateFileHint() {
  if (!fileHintEl) return;
  if (fileSeason != null && fileEpisode != null) {
    fileHintEl.textContent = t("searchFileEpisode", {
      s: pad2(fileSeason),
      e: pad2(fileEpisode),
    });
    fileHintEl.classList.remove("hidden");
  } else if (fileEpisode != null) {
    fileHintEl.textContent = t("searchFileAbsolute", { e: pad2(fileEpisode) });
    fileHintEl.classList.remove("hidden");
  } else {
    fileHintEl.textContent = "";
    fileHintEl.classList.add("hidden");
  }
}

function setStep(next) {
  step = next;
  const searching = next === "show";
  form.classList.toggle("hidden", !searching);
  backEl.classList.toggle("hidden", searching);
  if (next === "show") {
    headingEl.textContent = t("searchStepShow");
    crumbEl.textContent = t("searchHint");
    pickedShow = null;
    pickedSeason = null;
  } else if (next === "season") {
    headingEl.textContent = t("searchStepSeason");
    crumbEl.textContent = pickedShow ? pickedShow.name : "";
  } else {
    headingEl.textContent = t("searchStepEpisode");
    const seasonLabel = pickedSeason
      ? t("searchSeasonN", { n: pickedSeason.season })
      : "";
    crumbEl.textContent = [pickedShow && pickedShow.name, seasonLabel]
      .filter(Boolean)
      .join(" · ");
  }
}

function clearWait() {
  if (waitTimer) {
    clearTimeout(waitTimer);
    waitTimer = null;
  }
}

function clearApply() {
  if (applyTimer) {
    clearTimeout(applyTimer);
    applyTimer = null;
  }
  applyTries = 0;
}

function waitForAnswer() {
  clearWait();
  waitTimer = setTimeout(function () {
    waitTimer = null;
    const text = statusEl.textContent || "";
    if (
      text.indexOf(t("searchLoading")) === 0 ||
      text === t("searchLoadingSeasons") ||
      text === t("searchLoadingEpisodes") ||
      text === "searchLoading"
    ) {
      setStatus(t("noTmdb"), true);
    }
  }, 22000);
}

function highlight(index) {
  if (!rows.length) {
    activeIndex = -1;
    return;
  }
  if (index < 0) index = 0;
  if (index >= rows.length) index = rows.length - 1;
  activeIndex = index;
  rows.forEach(function (btn, i) {
    btn.classList.toggle("active", i === activeIndex);
  });
  const current = rows[activeIndex];
  if (current && current.scrollIntoView) {
    current.scrollIntoView({ block: "nearest" });
  }
}

function thumb(url, wide) {
  if (!url) {
    const div = document.createElement("div");
    div.className = wide ? "thumb wide" : "thumb";
    return div;
  }
  const img = document.createElement("img");
  img.className = wide ? "thumb wide" : "thumb";
  img.src = url;
  img.alt = "";
  img.draggable = false;
  return img;
}

function row(opts) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "row" + (opts.current ? " current" : "");
  btn.setAttribute("data-action", opts.action);
  Object.keys(opts.data || {}).forEach(function (key) {
    const value = opts.data[key];
    if (value == null || value === "") return;
    btn.setAttribute("data-" + key, String(value));
  });
  btn.appendChild(thumb(opts.image, opts.wide));
  const copy = document.createElement("div");
  copy.className = "copy";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = opts.name;
  copy.appendChild(name);
  if (opts.meta) {
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = opts.meta;
    copy.appendChild(meta);
  }
  btn.appendChild(copy);
  if (opts.badge) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = opts.badge;
    btn.appendChild(badge);
  }
  return btn;
}

function paintList(builder) {
  listEl.innerHTML = "";
  builder();
  rows = Array.prototype.slice.call(listEl.querySelectorAll(".row"));
  const current = rows.findIndex(function (btn) {
    return btn.classList.contains("current");
  });
  highlight(current >= 0 ? current : 0);
}

function renderShows(items) {
  if (!items || !items.length) {
    listEl.innerHTML = "";
    rows = [];
    setStatus(t("searchEmpty"), true);
    return;
  }
  setStatus("", false);
  paintList(function () {
    items.forEach(function (item) {
      const id = item.tmdbId != null ? item.tmdbId : item.id;
      if (!id) return;
      const year = item.year ? String(item.year) : "";
      listEl.appendChild(
        row({
          action: "show",
          data: {
            tmdbid: id,
            mediatype: item.mediaType || "tv",
            name: item.name || "",
          },
          name: item.name,
          meta: [year, item.originalName, item.overview]
            .filter(Boolean)
            .filter(function (part, i, arr) {
              return arr.indexOf(part) === i && part !== item.name;
            })
            .join(" · ")
            .slice(0, 140),
          image: item.poster,
          badge: item.mediaType === "movie" ? t("movie") : t("searchShow"),
        }),
      );
    });
  });
}

function renderSeasons(items) {
  if (!items || !items.length) {
    listEl.innerHTML = "";
    rows = [];
    setStatus(t("searchEmpty"), true);
    return;
  }
  setStatus("", false);
  paintList(function () {
    items.forEach(function (item) {
      listEl.appendChild(
        row({
          action: "season",
          current: fileSeason != null && Number(item.season) === Number(fileSeason),
          data: { season: item.season },
          name: item.name || t("searchSeasonN", { n: item.season }),
          meta: item.episodeCount
            ? t("searchEpisodeCount", { n: item.episodeCount })
            : "",
          image: item.poster,
          badge:
            fileSeason != null && Number(item.season) === Number(fileSeason)
              ? t("searchCurrent")
              : "",
        }),
      );
    });
  });
}

function renderEpisodes(items) {
  lastEpisodes = items || [];
  if (!items || !items.length) {
    listEl.innerHTML = "";
    rows = [];
    setStatus(t("searchEmpty"), true);
    return;
  }
  setStatus("", false);
  const seasonNum = pickedSeason && pickedSeason.season;
  paintList(function () {
    items.forEach(function (item) {
      const current =
        seasonNum != null &&
        fileSeason != null &&
        fileEpisode != null &&
        Number(seasonNum) === Number(fileSeason) &&
        Number(item.episode) === Number(fileEpisode);
      const num = pad2(item.episode);
      listEl.appendChild(
        row({
          action: "episode",
          current: current,
          data: {
            sn: seasonNum,
            en: item.episode,
          },
          name: "E" + num + " · " + (item.name || ""),
          meta: item.overview ? item.overview.slice(0, 140) : "",
          image: item.still,
          wide: true,
          badge: current ? t("searchCurrent") : "",
        }),
      );
    });
  });
}

function imgPath(path, size) {
  return path ? "https://image.tmdb.org/t/p/" + (size || "w185") + path : null;
}

async function tmdbGet(path, extra, language) {
  if (!apiKey) throw new Error("missing-tmdb-key");
  const query = Object.assign(
    {
      api_key: apiKey,
      language: language || tmdbLang,
    },
    extra || {},
  );
  const qs = Object.keys(query)
    .filter(function (name) {
      return query[name] !== undefined && query[name] !== null && query[name] !== "";
    })
    .map(function (name) {
      return encodeURIComponent(name) + "=" + encodeURIComponent(query[name]);
    })
    .join("&");
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(function () {
    if (ctrl) ctrl.abort();
  }, 15000);
  try {
    const res = await fetch("https://api.themoviedb.org/3" + path + "?" + qs, {
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) throw new Error("tmdb " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function mapSeasons(show) {
  return (show.seasons || [])
    .filter(function (season) {
      return season.season_number >= 1;
    })
    .map(function (season) {
      return {
        season: season.season_number,
        name: season.name,
        episodeCount: season.episode_count,
        poster: imgPath(season.poster_path, "w185"),
      };
    });
}

function mapEpisodes(season) {
  return (season.episodes || []).map(function (episode) {
    return {
      episode: episode.episode_number,
      name: episode.name,
      overview: episode.overview || "",
      still: imgPath(episode.still_path, "w300"),
    };
  });
}

async function loadSeasons(id) {
  return mapSeasons(await tmdbGet("/tv/" + id));
}

async function loadEpisodes(id, seasonNumber) {
  return mapEpisodes(await tmdbGet("/tv/" + id + "/season/" + seasonNumber));
}

function showSeasons(items) {
  picking = false;
  clearWait();
  setStep("season");
  renderSeasons(items);
}

function showEpisodes(season, items) {
  picking = false;
  pickedSeason = { season: Number(season) };
  clearWait();
  setStep("episode");
  renderEpisodes(items);
}

function openShow(tmdbId, name) {
  pickedShow = { id: tmdbId, tmdbId: tmdbId, mediaType: "tv", name: name };
  picking = true;
  searchGen += 1;
  setStatus(t("searchLoadingSeasons"), true);
  waitForAnswer();
  if (!apiKey) {
    waitForAnswer();
    send("pick-show", { tmdbId: tmdbId, id: tmdbId, mediaType: "tv", name: name });
    iina.postMessage("pick-show", "tv:" + tmdbId);
    return;
  }
  loadSeasons(tmdbId)
    .then(function (seasons) {
      if (fileSeason != null) {
        return loadEpisodes(tmdbId, fileSeason)
          .then(function (episodes) {
            if (episodes && episodes.length) {
              showEpisodes(fileSeason, episodes);
              return;
            }
            showSeasons(seasons);
          })
          .catch(function () {
            showSeasons(seasons);
          });
      }
      showSeasons(seasons);
    })
    .catch(function (err) {
      console.log(err);
      waitForAnswer();
      send("pick-show", { tmdbId: tmdbId, id: tmdbId, mediaType: "tv", name: name });
      iina.postMessage("pick-show", "tv:" + tmdbId);
    });
}

function openSeason(season) {
  const id = pickedShow && (pickedShow.id || pickedShow.tmdbId);
  if (!id) return;
  pickedSeason = { season: season };
  picking = true;
  setStatus(t("searchLoadingEpisodes"), true);
  waitForAnswer();
  if (!apiKey) {
    waitForAnswer();
    send("pick-season", { tmdbId: id, id: id, season: season });
    iina.postMessage("pick-season", id + ":" + season);
    return;
  }
  loadEpisodes(id, season)
    .then(function (items) {
      showEpisodes(season, items);
    })
    .catch(function () {
      waitForAnswer();
      send("pick-season", { tmdbId: id, id: id, season: season });
      iina.postMessage("pick-season", id + ":" + season);
    });
}

function listedEpisode(episode) {
  const wanted = Number(episode);
  for (let i = 0; i < lastEpisodes.length; i++) {
    if (Number(lastEpisodes[i].episode) === wanted) return lastEpisodes[i];
  }
  return null;
}

function slimTvMeta(id, season, episode) {
  const item = listedEpisode(episode);
  return {
    mediaType: "tv",
    tmdbId: Number(id),
    id: Number(id),
    season: Number(season),
    episode: Number(episode),
    showTitle: (pickedShow && pickedShow.name) || "",
    episodeTitle: (item && item.name) || "",
    synopsis: item && item.overview ? String(item.overview).slice(0, 280) : "",
    poster: (item && item.still) || null,
  };
}

function sendEpisodePick(ids, meta) {
  send("apply-pick", meta);
  send("pick-episode", ids);
}

function openEpisode(episode, seasonFromRow) {
  const season = seasonFromRow != null ? seasonFromRow : pickedSeason && pickedSeason.season;
  const id = pickedShow && (pickedShow.id || pickedShow.tmdbId);
  if (id == null || season == null || episode == null || isNaN(Number(episode))) return;
  clearWait();
  clearApply();
  picking = true;
  const ids = {
    tmdbId: Number(id),
    id: Number(id),
    season: Number(season),
    episode: Number(episode),
    pick: Number(id) + ":" + Number(season) + ":" + Number(episode),
  };
  const meta = slimTvMeta(ids.tmdbId, ids.season, ids.episode);
  setStatus(t("searchApplying", { s: pad2(ids.season), e: pad2(ids.episode) }), true);
  function pulse() {
    sendEpisodePick(ids, meta);
    applyTries += 1;
    if (applyTries >= 6) {
      applyTimer = setTimeout(function () {
        applyTimer = null;
        picking = false;
        setStatus(t("searchApplyFail"), true);
      }, 900);
      return;
    }
    applyTimer = setTimeout(pulse, 600);
  }
  pulse();
}

function pickActive() {
  if (activeIndex < 0 || !rows[activeIndex]) return;
  activateRow(rows[activeIndex]);
}

function activateRow(btn) {
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  if (action === "show") {
    const tmdbId = Number(btn.getAttribute("data-tmdbid"));
    const mediaType = btn.getAttribute("data-mediatype") || "tv";
    const name = btn.getAttribute("data-name") || "";
    if (!tmdbId) return;
    if (mediaType === "movie") {
      pickedShow = { id: tmdbId, tmdbId: tmdbId, mediaType: "movie", name: name };
      picking = true;
      searchGen += 1;
      setStatus(t("searchLoading"), true);
      waitForAnswer();
      send("pick-show", { tmdbId: tmdbId, id: tmdbId, mediaType: "movie", name: name });
      iina.postMessage("pick-show", "movie:" + tmdbId);
      return;
    }
    openShow(tmdbId, name);
    return;
  }
  if (action === "season") {
    openSeason(Number(btn.getAttribute("data-season")));
    return;
  }
  if (action === "episode") {
    const season = Number(btn.getAttribute("data-sn"));
    const episode = Number(btn.getAttribute("data-en"));
    openEpisode(episode, isNaN(season) ? null : season);
  }
}

function mapTv(hit) {
  return {
    mediaType: "tv",
    id: hit.id,
    tmdbId: hit.id,
    name: hit.name,
    originalName: hit.original_name || "",
    year: (hit.first_air_date || "").slice(0, 4),
    poster: hit.poster_path ? "https://image.tmdb.org/t/p/w185" + hit.poster_path : null,
    overview: hit.overview || "",
  };
}

function mapMovie(hit) {
  return {
    mediaType: "movie",
    id: hit.id,
    tmdbId: hit.id,
    name: hit.title,
    originalName: hit.original_title || "",
    year: (hit.release_date || "").slice(0, 4),
    poster: hit.poster_path ? "https://image.tmdb.org/t/p/w185" + hit.poster_path : null,
    overview: hit.overview || "",
  };
}

async function searchLocal(query) {
  if (!apiKey) return null;
  const langs = [tmdbLang];
  if (tmdbLang !== "en-US") langs.push("en-US");
  if (tmdbLang !== "ja-JP") langs.push("ja-JP");
  const movieFirst = /\b(film|movie|gekijouban|gekijoban)\b/i.test(query);
  const tvLists = await Promise.all(
    langs.map(function (language) {
      return tmdbGet("/search/tv", { query: query, include_adult: true }, language).catch(function () {
        return { results: [] };
      });
    }),
  );
  const movieLists = await Promise.all(
    langs.map(function (language) {
      return tmdbGet("/search/movie", { query: query, include_adult: true }, language).catch(function () {
        return { results: [] };
      });
    }),
  );
  const seenTv = {};
  const shows = [];
  tvLists.forEach(function (data) {
    (data.results || []).forEach(function (hit) {
      if (seenTv[hit.id]) return;
      seenTv[hit.id] = true;
      shows.push(mapTv(hit));
    });
  });
  const seenMovie = {};
  const films = [];
  movieLists.forEach(function (data) {
    (data.results || []).forEach(function (hit) {
      if (seenMovie[hit.id]) return;
      seenMovie[hit.id] = true;
      films.push(mapMovie(hit));
    });
  });
  if (movieFirst) return films.concat(shows).slice(0, 20);
  return shows.concat(films).slice(0, 20);
}

form.addEventListener("submit", function (event) {
  event.preventDefault();
  const query = queryEl.value.trim();
  if (!query) return;
  clearApply();
  picking = false;
  const gen = ++searchGen;
  setStatus(t("searchLoading"), true);
  listEl.innerHTML = "";
  rows = [];
  send("search-query", { query: query });
  iina.postMessage("search-query", query);
  waitForAnswer();
  if (!apiKey) return;
  searchLocal(query)
    .then(function (items) {
      if (gen !== searchGen || picking) return;
      if (items && items.length) {
        clearWait();
        setStep("show");
        renderShows(items);
      }
    })
    .catch(function () {});
});

listEl.addEventListener("click", function (event) {
  const btn = event.target.closest("[data-action]");
  if (!btn || !listEl.contains(btn)) return;
  event.preventDefault();
  event.stopPropagation();
  activateRow(btn);
});

backEl.addEventListener("click", function () {
  clearApply();
  picking = false;
  if (step === "episode") {
    const id = pickedShow && (pickedShow.id || pickedShow.tmdbId);
    if (!id) {
      setStep("show");
      return;
    }
    setStatus(t("searchLoadingSeasons"), true);
    if (apiKey) {
      loadSeasons(id)
        .then(showSeasons)
        .catch(function () {
          waitForAnswer();
          send("back-seasons", { tmdbId: id, id: id });
        });
      return;
    }
    waitForAnswer();
    send("back-seasons", { tmdbId: id, id: id });
    return;
  }
    setStep("show");
    listEl.innerHTML = "";
    rows = [];
    picking = false;
  setStatus("", false);
  queryEl.focus();
});

document.addEventListener("keydown", function (event) {
  if (!rows.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlight(activeIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    highlight(activeIndex - 1);
  } else if (event.key === "Enter" && document.activeElement !== queryEl) {
    event.preventDefault();
    pickActive();
  }
});

iina.onMessage("init", function (raw) {
  const payload = unwrap(raw) || {};
  ready = true;
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (payload && payload.strings) {
    Object.keys(payload.strings).forEach(function (key) {
      strings[key] = payload.strings[key];
    });
  }
  if (payload && payload.apiKey) apiKey = payload.apiKey;
  if (payload && payload.language) tmdbLang = payload.language;
  fileSeason = payload && payload.season != null ? Number(payload.season) : null;
  fileEpisode = payload && payload.episode != null ? Number(payload.episode) : null;
  if (isNaN(fileSeason)) fileSeason = null;
  if (isNaN(fileEpisode)) fileEpisode = null;
  queryEl.placeholder = t("searchPlaceholder");
  submitEl.textContent = t("searchSubmit");
  backEl.textContent = t("searchBack");
  headingEl.textContent = t("searchStepShow");
  crumbEl.textContent = t("searchHint");
  updateFileHint();
  if (payload && payload.prefill && !queryEl.value) queryEl.value = payload.prefill;
  queryEl.focus();
});

iina.onMessage("results", function (raw) {
  if (picking) return;
  clearWait();
  setStep("show");
  const payload = unwrap(raw);
  const items = Array.isArray(payload) ? payload : payload && payload.items;
  renderShows(items);
});

iina.onMessage("seasons", function (raw) {
  picking = false;
  clearWait();
  const payload = unwrap(raw) || {};
  if (payload.show) pickedShow = payload.show;
  setStep("season");
  renderSeasons(payload.items);
});

iina.onMessage("episodes", function (raw) {
  picking = false;
  clearWait();
  const payload = unwrap(raw) || {};
  if (payload.show) pickedShow = payload.show;
  if (payload.season != null) {
    pickedSeason = { season: Number(payload.season) };
  }
  setStep("episode");
  renderEpisodes(payload.items);
});

iina.onMessage("error", function (raw) {
  if (applyTimer) return;
  clearWait();
  if ((step === "season" || step === "episode") && !picking) return;
  picking = false;
  const payload = unwrap(raw) || {};
  setStatus(payload.message || t("searchEmpty"), true);
});

iina.onMessage("loading", function (raw) {
  if (step === "season" || step === "episode") return;
  const payload = unwrap(raw) || {};
  setStatus(payload.message || t("searchLoading"), true);
});

function ping() {
  if (ready) return;
  send("search-ready");
}

ping();
pingTimer = setInterval(ping, 300);
setTimeout(function () {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}, 8000);

setStep("show");
updateFileHint();
