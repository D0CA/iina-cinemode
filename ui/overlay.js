const pauseEl = document.getElementById("pause");
const backdropEl = document.getElementById("backdrop");
const posterEl = document.getElementById("poster");
const logoEl = document.getElementById("logo");
const titleEl = document.getElementById("title");
const metaEl = document.getElementById("meta");
const synopsisEl = document.getElementById("synopsis");
const castEl = document.getElementById("cast");
const resumeBtn = document.getElementById("resume");
const searchBtn = document.getElementById("search");
const hintEl = document.getElementById("hint");
const skipBtn = document.getElementById("skip");
const upNextEl = document.getElementById("upnext");
const progressFill = document.getElementById("progress-fill");
const progressNow = document.getElementById("progress-now");
const progressEnd = document.getElementById("progress-end");
const scrubberEl = document.getElementById("scrubber");

let currentStrings = {};

function t(key) {
  return currentStrings[key] || key;
}

function skipLabel(kind) {
  if (kind === "recap") return t("skipRecap");
  if (kind === "credits") return t("skipCredits");
  return t("skip");
}

function formatClock(seconds) {
  if (seconds == null || isNaN(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderProgress(payload) {
  const duration = payload.duration;
  const position = payload.position;
  if (duration && duration > 0 && position != null) {
    const pct = Math.max(0, Math.min(100, (position / duration) * 100));
    progressFill.style.width = `${pct}%`;
    progressNow.textContent = formatClock(position);
    progressEnd.textContent = formatClock(duration);
  } else {
    progressFill.style.width = "0%";
    progressNow.textContent = "";
    progressEnd.textContent = "";
  }
}

function renderUpNext(meta, enabled) {
  const next = meta && meta.nextEpisode;
  if (!enabled || !next || !next.episode) {
    upNextEl.textContent = "";
    upNextEl.classList.add("hidden");
    return;
  }
  const se =
    "S" +
    String(next.season).padStart(2, "0") +
    "E" +
    String(next.episode).padStart(2, "0");
  const title = next.title ? ` · ${next.title}` : "";
  upNextEl.textContent = t("upNext") + " · " + se + title + " · " + t("upNextOpen");
  upNextEl.setAttribute("data-clickable", "");
  upNextEl.classList.remove("hidden");
}

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatRating(rating) {
  if (!rating || rating.value == null || isNaN(rating.value)) return null;
  if (rating.source === "anilist") return `★ ${rating.value.toFixed(1)} AniList`;
  if (rating.scale === 5) return `★ ${rating.value.toFixed(1)} Letterboxd`;
  return `★ ${rating.value.toFixed(1)} TMDB`;
}

function formatAirDate(iso, lang) {
  if (!iso || String(iso).length < 10) return null;
  const parts = String(iso).slice(0, 10).split("-");
  if (parts.length !== 3) return null;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString(lang || "fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch (err) {
    return parts.reverse().join("/");
  }
}

function setImage(el, url, className) {
  if (!url) {
    el.removeAttribute("src");
    el.classList.remove(className || "show");
    return;
  }
  el.src = url;
  el.classList.add(className || "show");
}

function pill(text, extra) {
  const span = document.createElement("span");
  span.className = extra ? `pill ${extra}` : "pill";
  span.textContent = text;
  span.setAttribute("data-clickable", "");
  return span;
}

function renderMeta(payload) {
  metaEl.innerHTML = "";
  const meta = payload.meta || {};
  if (meta.mediaType === "tv" && meta.season != null && meta.episode != null) {
    metaEl.appendChild(
      pill(`S${String(meta.season).padStart(2, "0")}E${String(meta.episode).padStart(2, "0")}`),
    );
    if (meta.episodeTitle) {
      const ep = document.createElement("span");
      ep.textContent = meta.episodeTitle;
      ep.setAttribute("data-clickable", "");
      metaEl.appendChild(ep);
    }
  } else if (meta.mediaType === "movie") {
    metaEl.appendChild(pill(t("movie")));
  }
  const aired = formatAirDate(meta.airDate, payload.lang);
  if (aired) {
    metaEl.appendChild(pill(aired));
  } else if (meta.year) {
    metaEl.appendChild(pill(meta.year));
  }
  if (meta.studio) metaEl.appendChild(pill(meta.studio));
  if (meta.certification) metaEl.appendChild(pill(meta.certification, "cert"));
  if (meta.runtime) {
    metaEl.appendChild(pill(`${meta.runtime} min`));
  }
  if (payload.duration) {
    const left = payload.remaining != null ? payload.remaining : payload.duration;
    const node = document.createElement("span");
    node.textContent = `${formatTime(left)} ${t("remaining")}`;
    node.setAttribute("data-clickable", "");
    metaEl.appendChild(node);
  }
  const rating = formatRating(meta.rating);
  if (rating) metaEl.appendChild(pill(rating, "rating"));
  (meta.genres || []).forEach((genre) => metaEl.appendChild(pill(genre)));
}

function renderCast(cast) {
  castEl.innerHTML = "";
  (cast || []).slice(0, 6).forEach((person) => {
    const item = document.createElement("div");
    item.className = "cast-item";
    if (person.photo) {
      const img = document.createElement("img");
      img.src = person.photo;
      img.alt = person.name;
      item.appendChild(img);
    } else {
      const fallback = document.createElement("div");
      fallback.className = "cast-fallback";
      item.appendChild(fallback);
    }
    const name = document.createElement("span");
    name.textContent = person.name;
    item.appendChild(name);
    castEl.appendChild(item);
  });
}

function renderPause(payload) {
  if (payload.strings) currentStrings = payload.strings;
  resumeBtn.textContent = t("resume");
  searchBtn.textContent = t("searchCta") || t("menuSearch");
  skipBtn.textContent = skipLabel(payload.skipKind);

  const meta = payload.meta;
  if (payload.backdrop) {
    backdropEl.style.backgroundImage = "url(" + JSON.stringify(payload.backdrop) + ")";
  } else {
    backdropEl.style.backgroundImage = "none";
    backdropEl.style.background = "#0b0b0b";
  }

  setImage(posterEl, payload.poster || (meta && meta.poster), "show");
  setImage(logoEl, meta && meta.logo, "show");

  if (meta && meta.logo) {
    titleEl.classList.add("hidden");
  } else {
    titleEl.classList.remove("hidden");
  }
  titleEl.textContent = (meta && (meta.showTitle || meta.title)) || payload.title || "";

  renderMeta(payload);
  renderProgress(payload);
  const flags = payload.overlay || {};
  const synopsis = (meta && meta.synopsis) || "";
  synopsisEl.textContent = synopsis;
  synopsisEl.classList.toggle("hidden", flags.synopsis === false || !synopsis);
  renderUpNext(meta, flags.upNext !== false);
  if (flags.cast === false) {
    castEl.innerHTML = "";
    castEl.classList.add("hidden");
  } else {
    castEl.classList.remove("hidden");
    renderCast(meta && meta.cast);
  }
  if (scrubberEl) scrubberEl.classList.toggle("hidden", flags.progress === false);

  searchBtn.classList.remove("hidden");
  if (!meta) {
    hintEl.textContent = t("unknown");
    hintEl.classList.remove("hidden");
    searchBtn.textContent = t("searchCta");
  } else {
    hintEl.classList.add("hidden");
    searchBtn.textContent = t("searchWrong");
  }
}

function setPause(visible) {
  if (visible) {
    if (!pauseEl.classList.contains("show")) {
      requestAnimationFrame(function () {
        pauseEl.classList.add("show");
      });
    }
  } else {
    pauseEl.classList.remove("show");
  }
}

function setSkip(visible) {
  skipBtn.classList.toggle("show", !!visible);
}

resumeBtn.addEventListener("click", function (event) {
  event.stopPropagation();
  iina.postMessage("resume");
});

searchBtn.addEventListener("click", function (event) {
  event.stopPropagation();
  iina.postMessage("search-title");
});

upNextEl.addEventListener("click", function (event) {
  event.preventDefault();
  event.stopPropagation();
  iina.postMessage("open-next");
});

document.getElementById("info-hit").addEventListener("click", function (event) {
  if (event.target.closest("button")) return;
  iina.postMessage("resume");
});

skipBtn.addEventListener("click", function () {
  iina.postMessage("skip-intro");
});

logoEl.addEventListener("error", function () {
  logoEl.classList.remove("show");
  titleEl.classList.remove("hidden");
});

posterEl.addEventListener("error", function () {
  posterEl.classList.remove("show");
});

iina.onMessage("state", function (payload) {
  if (payload && payload.strings) currentStrings = payload.strings;
  skipBtn.textContent = skipLabel(payload.skipKind);
  if (payload.pauseVisible) renderPause(payload);
  setPause(!!payload.pauseVisible);
  setSkip(!!payload.skipVisible);
});

iina.postMessage("ready");
