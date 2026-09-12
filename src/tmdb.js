const { http, console, preferences, utils } = iina;
const anilist = require("./anilist.js");

const IMG = "https://image.tmdb.org/t/p";

function apiKey() {
  return String(preferences.get("tmdbApiKey") || "").trim();
}

function lang() {
  return String(preferences.get("language") || "fr-FR");
}

function qs(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
}

function parseTmdbBody(body) {
  if (body && typeof body === "object") return body;
  if (!body) throw new Error("tmdb empty");
  return JSON.parse(body);
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

async function getJsonHttp(url) {
  const res = await http.get(url, {
    headers: { Accept: "application/json" },
  });
  if (res.statusCode && res.statusCode >= 400) {
    throw new Error(`tmdb ${res.statusCode}`);
  }
  if (res.data !== undefined && res.data !== null && res.data !== "") {
    return parseTmdbBody(res.data);
  }
  if (res.text) return parseTmdbBody(res.text);
  throw new Error("tmdb empty");
}

async function getJsonCurl(path, query) {
  if (!utils || !utils.exec) throw new Error("tmdb curl unavailable");
  const args = [
    "-sS",
    "-L",
    "-G",
    "--max-time", "8",
    "-H", "Accept: application/json",
    "-A", "CineMode/1.1",
  ];
  Object.keys(query).forEach(function (name) {
    args.push("--data-urlencode", name + "=" + String(query[name]));
  });
  args.push("https://api.themoviedb.org/3" + path);
  const result = await utils.exec("/usr/bin/curl", args);
  const stdout = (result && result.stdout) || "";
  if (!stdout) throw new Error("tmdb curl empty");
  const parsed = parseTmdbBody(stdout);
  if (parsed && parsed.status_code && parsed.success === false) {
    throw new Error(`tmdb ${parsed.status_code}`);
  }
  return parsed;
}

async function getJson(path, params, language) {
  const key = apiKey();
  if (!key) throw new Error("missing-tmdb-key");
  const all = Object.assign(
    { api_key: key, language: language || lang() },
    params || {},
  );
  const query = {};
  Object.keys(all).forEach(function (name) {
    if (all[name] === undefined || all[name] === null || all[name] === "") return;
    query[name] = String(all[name]);
  });
  const url = `https://api.themoviedb.org/3${path}?${qs(query)}`;
  try {
    return await withTimeout(getJsonHttp(url), 4000, "tmdb http timeout");
  } catch (err) {
    console.log(`tmdb http ${path}: ${err}; curl`);
    return await getJsonCurl(path, query);
  }
}

function img(path, size) {
  if (!path) return null;
  return `${IMG}/${size || "w780"}${path}`;
}

function pickLogo(images) {
  const logos = (images && images.logos) || [];
  if (!logos.length) return null;
  const wanted = lang().slice(0, 2);
  const ranked = logos.slice().sort((a, b) => {
    const score = (item) => {
      let n = item.vote_average || 0;
      if (item.iso_639_1 === wanted) n += 50;
      if (item.iso_639_1 === "en") n += 20;
      if (item.iso_639_1 == null) n += 10;
      if ((item.file_path || "").endsWith(".png")) n += 5;
      return n;
    };
    return score(b) - score(a);
  });
  return img(ranked[0].file_path, "w500");
}

function mapCast(credits) {
  return ((credits && credits.cast) || []).slice(0, 8).map((person) => ({
    name: person.name,
    character: person.character,
    photo: img(person.profile_path, "w185"),
  }));
}

function fold(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, " ")
    .trim();
}

function filmishName(hit) {
  const text = [
    hit && hit.name,
    hit && hit.title,
    hit && hit.original_name,
    hit && hit.original_title,
  ]
    .filter(Boolean)
    .join(" ");
  return /\b(film|movie|gekijouban|gekijoban|gekijo[- ]ban)\b/i.test(text);
}

function hitNames(hit) {
  const names = [hit.name, hit.title, hit.original_name, hit.original_title];
  (hit._alts || []).forEach(function (title) {
    names.push(title);
  });
  return names.filter(Boolean);
}

function titleScore(query, name, year, wantedYear) {
  const q = fold(query);
  const n = fold(name);
  if (!q || !n) return 0;
  let score = 0;
  if (n === q) score = 100;
  else if (n.indexOf(q) === 0 || q.indexOf(n) === 0) score = 82;
  else {
    const qt = q.split(" ").filter(Boolean);
    const nt = n.split(" ");
    const overlap = qt.filter(function (token) {
      return nt.indexOf(token) >= 0;
    }).length;
    score = (overlap / Math.max(qt.length, 1)) * 70;
    if (overlap >= 2 && overlap === qt.length) score += 15;
  }
  if (wantedYear && year && String(year) === String(wantedYear)) score += 8;
  return score;
}

function mapTvHit(hit) {
  return {
    mediaType: "tv",
    id: hit.id,
    name: hit.name,
    originalName: hit.original_name || "",
    year: (hit.first_air_date || "").slice(0, 4),
    poster: img(hit.poster_path, "w185"),
    overview: hit.overview || "",
    originalLanguage: hit.original_language || "",
    popularity: hit.popularity || 0,
  };
}

function mapMovieHit(hit) {
  return {
    mediaType: "movie",
    id: hit.id,
    name: hit.title,
    originalName: hit.original_title || "",
    year: (hit.release_date || "").slice(0, 4),
    poster: img(hit.poster_path, "w185"),
    overview: hit.overview || "",
    originalLanguage: hit.original_language || "",
    popularity: hit.popularity || 0,
  };
}

function countryFromLang() {
  const map = {
    "fr-FR": "FR",
    "en-US": "US",
    "es-ES": "ES",
    "de-DE": "DE",
    "it-IT": "IT",
    "pt-BR": "BR",
  };
  return map[lang()] || "US";
}

function formatCert(country, value) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (country === "FR" && /^\d+$/.test(v)) return `-${v}`;
  return v;
}

function pickTvCert(contentRatings) {
  const results = (contentRatings && contentRatings.results) || [];
  const order = [countryFromLang(), "US", "GB", "FR"];
  for (let i = 0; i < order.length; i++) {
    const cc = order[i];
    const hit = results.find(function (row) {
      return row.iso_3166_1 === cc && row.rating;
    });
    if (hit) return formatCert(cc, hit.rating);
  }
  const any = results.find(function (row) {
    return row.rating;
  });
  return any ? formatCert(any.iso_3166_1, any.rating) : null;
}

function pickMovieCert(releaseDates) {
  const results = (releaseDates && releaseDates.results) || [];
  const order = [countryFromLang(), "US", "GB", "FR"];
  function fromCountry(cc) {
    const hit = results.find(function (row) {
      return row.iso_3166_1 === cc;
    });
    if (!hit) return null;
    const dates = hit.release_dates || [];
    const theatrical = dates.find(function (row) {
      return row.certification && row.type === 3;
    });
    const any = dates.find(function (row) {
      return row.certification;
    });
    const chosen = theatrical || any;
    return chosen ? formatCert(cc, chosen.certification) : null;
  }
  for (let i = 0; i < order.length; i++) {
    const cert = fromCountry(order[i]);
    if (cert) return cert;
  }
  return null;
}

async function tryEpisode(showId, season, episode) {
  try {
    const data = await getJson(`/tv/${showId}/season/${season}/episode/${episode}`, {
      append_to_response: "credits,images",
    });
    if (data && data.episode_number != null) {
      return {
        season: Number(data.season_number != null ? data.season_number : season),
        episode: Number(data.episode_number),
        data: data,
      };
    }
  } catch (err) {}
  return null;
}

function regularSeasons(seasons) {
  return (seasons || []).filter(function (season) {
    return season.season_number >= 1;
  });
}

async function findByEpisodeNumber(showId, seasons, wantEpisode) {
  const nums = regularSeasons(seasons)
    .map(function (season) {
      return season.season_number;
    })
    .sort(function (a, b) {
      return wantEpisode > 40 ? b - a : a - b;
    });
  for (let i = 0; i < nums.length; i += 5) {
    const batch = nums.slice(i, i + 5);
    const found = await Promise.all(
      batch.map(function (num) {
        return tryEpisode(showId, num, wantEpisode);
      }),
    );
    const hit = found.find(function (row) {
      return row && Number(row.episode) === Number(wantEpisode);
    });
    if (hit) return hit;
  }
  return null;
}

async function locateViaGroups(showId, wantEpisode) {
  const groups = await getJson(`/tv/${showId}/episode_groups`).catch(function () {
    return null;
  });
  const results = (groups && groups.results) || [];
  const abs =
    results.find(function (group) {
      return group.type === 2;
    }) ||
    results.find(function (group) {
      return /absolute/i.test(group.name || "");
    });
  if (!abs || !abs.id) return null;
  const detail = await getJson(`/tv/episode_group/${abs.id}`).catch(function () {
    return null;
  });
  const list = [];
  ((detail && detail.groups) || []).forEach(function (bucket) {
    (bucket.episodes || []).forEach(function (ep) {
      if (ep && ep.season_number >= 1) list.push(ep);
    });
  });
  const byNumber = list.find(function (ep) {
    return Number(ep.episode_number) === Number(wantEpisode);
  });
  if (byNumber) {
    return tryEpisode(showId, byNumber.season_number, byNumber.episode_number);
  }
  if (wantEpisode >= 1 && wantEpisode <= list.length) {
    const hit = list[wantEpisode - 1];
    if (hit && hit.season_number != null && hit.episode_number != null) {
      return tryEpisode(showId, hit.season_number, hit.episode_number);
    }
  }
  return null;
}

async function locateEpisode(showId, seasons, wantSeason, wantEpisode) {
  if (wantEpisode == null) return null;

  if (wantSeason != null) {
    const direct = await tryEpisode(showId, wantSeason, wantEpisode);
    if (direct && Number(direct.episode) === Number(wantEpisode)) return direct;
  }

  const byNumber = await findByEpisodeNumber(showId, seasons, wantEpisode);
  if (byNumber) return byNumber;

  const grouped = await locateViaGroups(showId, wantEpisode);
  if (grouped) return grouped;

  const list = regularSeasons(seasons);
  let offset = 0;
  for (let i = 0; i < list.length; i++) {
    const count = list[i].episode_count || 0;
    if (wantEpisode > offset && wantEpisode <= offset + count) {
      const local = wantEpisode - offset;
      const hit = await tryEpisode(showId, list[i].season_number, local);
      if (hit) return hit;
      break;
    }
    offset += count;
  }
  return null;
}

async function nextEpisodeFor(showId, season, episode) {
  if (!showId || season == null || episode == null) return null;
  try {
    const nxt = await getJson(`/tv/${showId}/season/${season}/episode/${episode + 1}`);
    if (nxt && nxt.episode_number) {
      return {
        season: season,
        episode: nxt.episode_number,
        title: nxt.name || "",
        still: img(nxt.still_path, "w300"),
      };
    }
  } catch (err) {}
  try {
    const nxt = await getJson(`/tv/${showId}/season/${season + 1}/episode/1`);
    if (nxt && nxt.episode_number) {
      return {
        season: season + 1,
        episode: nxt.episode_number,
        title: nxt.name || "",
        still: img(nxt.still_path, "w300"),
      };
    }
  } catch (err) {}
  return null;
}

async function findByImdb(imdbId) {
  if (!imdbId) return null;
  const data = await getJson(`/find/${imdbId}`, { external_source: "imdb_id" });
  const tv = (data.tv_results || [])[0];
  if (tv) return { mediaType: "tv", id: tv.id, result: tv };
  const movie = (data.movie_results || [])[0];
  if (movie) return { mediaType: "movie", id: movie.id, result: movie };
  return null;
}

async function letterboxdRating(tmdbId) {
  if (!preferences.get("letterboxd") || !tmdbId) return null;
  try {
    const res = await http.get(`https://letterboxd.com/tmdb/${tmdbId}`, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      },
      params: {},
    });
    const html = res.text || "";
    const jsonLd = html.match(/"ratingValue"\s*:\s*"?([0-9.]+)"?/);
    if (jsonLd) return { source: "letterboxd", value: parseFloat(jsonLd[1]), scale: 5 };
    const og = html.match(/average rating of ([0-9.]+)/i);
    if (og) return { source: "letterboxd", value: parseFloat(og[1]), scale: 5 };
  } catch (err) {
    console.log(`letterboxd: ${err}`);
  }
  return null;
}

async function searchShows(query, language) {
  const data = await getJson("/search/tv", { query: query, include_adult: true }, language);
  return (data.results || []).slice(0, 12).map(mapTvHit);
}

async function searchMovies(query, language) {
  const data = await getJson("/search/movie", { query: query, include_adult: true }, language);
  return (data.results || []).slice(0, 8).map(mapMovieHit);
}

async function searchAll(query) {
  const text = String(query || "").trim();
  if (!text) return [];
  const movieFirst = /\b(film|movie|gekijouban|gekijoban)\b/i.test(text);
  const langs = searchLangs();
  const tvLists = await Promise.all(
    langs.map(function (language) {
      return searchShows(text, language).catch(function () {
        return [];
      });
    }),
  );
  const movieLists = await Promise.all(
    langs.map(function (language) {
      return searchMovies(text, language).catch(function () {
        return [];
      });
    }),
  );
  const shows = mergeHits(tvLists);
  const movies = mergeHits(movieLists);
  if (movieFirst) return movies.concat(shows);
  return shows.concat(movies);
}

async function getSeasons(showId) {
  const show = await getJson(`/tv/${showId}`);
  return (show.seasons || [])
    .filter(function (season) {
      return season.season_number >= 1;
    })
    .map(function (season) {
      return {
        season: season.season_number,
        name: season.name,
        episodeCount: season.episode_count,
        poster: img(season.poster_path, "w185"),
      };
    });
}

async function getEpisodes(showId, seasonNumber) {
  const season = await getJson(`/tv/${showId}/season/${seasonNumber}`);
  return (season.episodes || []).map(function (episode) {
    return {
      episode: episode.episode_number,
      name: episode.name,
      overview: episode.overview || "",
      still: img(episode.still_path, "w300"),
    };
  });
}

function mergeHits(lists) {
  const seen = {};
  const out = [];
  (lists || []).forEach(function (list) {
    (list || []).forEach(function (hit) {
      if (!hit || !hit.id || seen[hit.id]) return;
      seen[hit.id] = true;
      out.push(hit);
    });
  });
  return out;
}

function searchLangs() {
  const current = lang();
  const list = [current];
  if (current !== "en-US") list.push("en-US");
  if (current !== "ja-JP") list.push("ja-JP");
  return list;
}

function extraHitScore(hit, query, parsed, mediaType) {
  let extra = 0;
  const jaQuery = /[\u3040-\u30ff\u3400-\u9fff]/.test(query || "");
  if (hit.original_language === "ja" && (jaQuery || (parsed && parsed.looksAnime))) extra += 8;
  if (parsed && parsed.episode && mediaType === "tv") extra += 10;
  if (parsed && parsed.episode && mediaType === "tv" && filmishName(hit)) extra -= 28;
  if (parsed && parsed.movieHint && mediaType === "movie") extra += 14;
  if (parsed && parsed.movieHint && mediaType === "tv") extra -= 18;
  if (parsed && parsed.year) {
    const hitYear = (hit.first_air_date || hit.release_date || "").slice(0, 4);
    if (hitYear && String(hitYear) === String(parsed.year)) extra += 6;
  }
  extra += Math.min(6, Math.log10((hit.popularity || 1) + 1) * 2);
  return extra;
}

function pickBest(results, query, year, mediaType, parsed) {
  let best = null;
  let bestScore = 0;
  (results || []).forEach(function (hit) {
    const hitYear = (hit.first_air_date || hit.release_date || "").slice(0, 4);
    let score = 0;
    hitNames(hit).forEach(function (name) {
      score = Math.max(score, titleScore(query, name, hitYear, year));
    });
    score += extraHitScore(hit, query, parsed, mediaType);
    if (score > bestScore) {
      bestScore = score;
      best = hit;
    }
  });
  const minScore = parsed && (parsed.episode || parsed.looksAnime) ? 18 : 22;
  if (!best || bestScore < minScore) return null;
  if (mediaType === "tv") {
    return { mediaType: "tv", id: best.id, result: best, score: bestScore };
  }
  if (mediaType === "movie") {
    return { mediaType: "movie", id: best.id, result: best, score: bestScore };
  }
  if (best.name || best.original_name) {
    return { mediaType: "tv", id: best.id, result: best, score: bestScore };
  }
  return { mediaType: "movie", id: best.id, result: best, score: bestScore };
}

async function altTitlesFor(mediaType, id) {
  const path =
    mediaType === "movie" ? `/movie/${id}/alternative_titles` : `/tv/${id}/alternative_titles`;
  const data = await getJson(path).catch(function () {
    return null;
  });
  const rows = (data && (data.results || data.titles)) || [];
  return rows
    .map(function (row) {
      return row.title;
    })
    .filter(Boolean);
}

async function pickBestWithAlts(results, query, year, mediaType, parsed) {
  let found = pickBest(results, query, year, mediaType, parsed);
  if (found && found.score >= 48) return found;
  const top = (results || []).slice(0, 4);
  for (let i = 0; i < top.length; i++) {
    const alts = await altTitlesFor(mediaType, top[i].id);
    if (!alts.length) continue;
    top[i]._alts = alts;
  }
  return pickBest(results, query, year, mediaType, parsed);
}

function queryVariants(query) {
  const list = [];
  const push = function (value) {
    const text = String(value || "").trim();
    if (text && list.indexOf(text) < 0) list.push(text);
  };
  push(query);
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(query)) return list;
  push(query.replace(/^(the|le|la|les|l|el|los|die|der|das|il|lo)\s+/i, ""));
  const words = query.split(/\s+/);
  if (words.length > 3) push(words.slice(0, 3).join(" "));
  if (words.length > 2) push(words.slice(0, 2).join(" "));
  return list;
}

async function searchTvQuery(query, parsed) {
  const lists = await Promise.all(
    searchLangs().map(function (language) {
      return getJson("/search/tv", { query: query, include_adult: true }, language).catch(function () {
        return { results: [] };
      });
    }),
  );
  const results = mergeHits(
    lists.map(function (data) {
      return data.results;
    }),
  );
  return pickBestWithAlts(results, query, parsed && parsed.year, "tv", parsed);
}

async function searchMovieQuery(query, year, parsed) {
  const lists = await Promise.all(
    searchLangs().map(function (language) {
      return getJson("/search/movie", { query: query, year: year || undefined }, language).catch(
        function () {
          return { results: [] };
        },
      );
    }),
  );
  const results = mergeHits(
    lists.map(function (data) {
      return data.results;
    }),
  );
  return pickBestWithAlts(results, query, year, "movie", parsed);
}

function preferTvFrom(parsed) {
  if (!parsed) return false;
  if (parsed.episode) return true;
  if (parsed.movieHint) return false;
  const duration = Number(parsed.duration) || 0;
  if (duration > 0 && duration < 45 * 60) return true;
  if (duration > 85 * 60) return false;
  if (parsed.mediaType === "tv") return true;
  return false;
}

async function search(parsed, queryOverride) {
  if (parsed && parsed.imdbId) {
    try {
      const found = await findByImdb(parsed.imdbId);
      if (found) {
        if (parsed.episode && found.mediaType === "movie") {
          /* keep looking: IMDb of a film on a TV filename */
        } else {
          return found;
        }
      }
    } catch (err) {
      console.log(`imdb find: ${err}`);
    }
  }

  const query = String(queryOverride || (parsed && parsed.title) || "").trim();
  if (!query || query.length < 2) return null;

  const year = parsed && parsed.year;
  const preferTv = preferTvFrom(parsed);
  const variants = queryVariants(query);

  if (preferTv) {
    for (let i = 0; i < variants.length; i++) {
      const found = await searchTvQuery(variants[i], parsed);
      if (found) return found;
    }
    if (parsed && parsed.episode) return null;
    for (let i = 0; i < variants.length; i++) {
      const found = await searchMovieQuery(variants[i], year, parsed);
      if (found) return found;
    }
    return null;
  }

  for (let i = 0; i < variants.length; i++) {
    const found = await searchMovieQuery(variants[i], year, parsed);
    if (found) return found;
  }
  for (let i = 0; i < variants.length; i++) {
    const found = await searchTvQuery(variants[i], parsed);
    if (found) return found;
  }
  return null;
}

function tmdbStudio(item) {
  if (item && item.networks && item.networks[0] && item.networks[0].name) {
    return item.networks[0].name;
  }
  if (item && item.production_companies && item.production_companies[0] && item.production_companies[0].name) {
    return item.production_companies[0].name;
  }
  return null;
}

function isAnimeMedia(item, parsed) {
  if (parsed && parsed.looksAnime) return true;
  if (item && item.original_language === "ja") return true;
  const genres = (item && item.genres) || [];
  for (let i = 0; i < genres.length; i++) {
    if (genres[i].id === 16 || /anim/i.test(genres[i].name || "")) return true;
  }
  return false;
}

async function withAniList(meta, titles, year, item, parsed) {
  if (!isAnimeMedia(item, parsed)) return meta;
  try {
    const ani = await anilist.lookup(titles, year);
    if (!ani) return meta;
    meta.malId = ani.malId;
    if (ani.studio) meta.studio = ani.studio;
    if (!meta.runtime && ani.duration) meta.runtime = ani.duration;
    if (ani.score && preferences.get("anilistRating") !== false) {
      meta.rating = { source: "anilist", value: ani.score / 10, scale: 10 };
    }
  } catch (err) {
    console.log(`anilist enrich: ${err}`);
  }
  return meta;
}

async function enrichAniList(meta, parsed) {
  if (!meta) return meta;
  const fakeItem = {
    original_language: null,
    genres: (meta.genres || []).map(function (name) {
      return { name: name };
    }),
  };
  return withAniList(
    meta,
    [meta.showTitle, meta.title, parsed && parsed.title],
    meta.year,
    fakeItem,
    parsed,
  );
}

async function hydrateFromFound(found, parsed) {
  if (!found) return null;

  if (found.mediaType === "tv") {
    const show = await getJson(`/tv/${found.id}`, {
      append_to_response: "credits,images,content_ratings,external_ids",
    });
    let seasonNo = parsed && parsed.season != null ? parsed.season : null;
    let episodeNo = parsed && parsed.episode != null ? parsed.episode : null;
    let episode = null;
    if (episodeNo != null) {
      const located = await locateEpisode(found.id, show.seasons, seasonNo, episodeNo);
      if (located) {
        seasonNo = located.season;
        episodeNo = located.episode;
        episode = located.data;
      }
    }
    const nextEpisode = await nextEpisodeFor(found.id, seasonNo, episodeNo);
    const rating = {
      source: "tmdb",
      value: show.vote_average,
      scale: 10,
    };

    const meta = {
      mediaType: "tv",
      id: found.id,
      season: seasonNo,
      episode: episodeNo,
      showTitle: show.name,
      title: show.name,
      episodeTitle: episode && episode.name,
      year: (show.first_air_date || "").slice(0, 4),
      airDate: (episode && episode.air_date) || show.first_air_date || null,
      studio: tmdbStudio(show),
      synopsis: (episode && episode.overview) || show.overview || "",
      poster: img((episode && episode.still_path) || show.poster_path, "w500"),
      backdrop: img(show.backdrop_path, "w1280"),
      logo: pickLogo(show.images),
      cast: mapCast((episode && episode.credits) || show.credits),
      genres: (show.genres || []).map((g) => g.name).slice(0, 3),
      runtime: (episode && episode.runtime) || (show.episode_run_time || [])[0] || null,
      rating: rating,
      certification: pickTvCert(show.content_ratings),
      nextEpisode: nextEpisode,
      imdbId: (show.external_ids && show.external_ids.imdb_id) || null,
      tmdbVote: show.vote_average,
    };
    return withAniList(
      meta,
      [show.name, show.original_name, parsed && parsed.title],
      meta.year,
      show,
      parsed,
    );
  }

  const movie = await getJson(`/movie/${found.id}`, {
    append_to_response: "credits,images,release_dates,external_ids",
  });
  let rating = (await letterboxdRating(found.id)) || {
    source: "tmdb",
    value: movie.vote_average,
    scale: 10,
  };
  if (isAnimeMedia(movie, parsed)) {
    rating = {
      source: "tmdb",
      value: movie.vote_average,
      scale: 10,
    };
  }

  const meta = {
    mediaType: "movie",
    id: found.id,
    season: null,
    episode: null,
    showTitle: movie.title,
    title: movie.title,
    episodeTitle: null,
    year: (movie.release_date || "").slice(0, 4),
    airDate: movie.release_date || null,
    studio: tmdbStudio(movie),
    synopsis: movie.overview || "",
    poster: img(movie.poster_path, "w500"),
    backdrop: img(movie.backdrop_path, "w1280"),
    logo: pickLogo(movie.images),
    cast: mapCast(movie.credits),
    genres: (movie.genres || []).map((g) => g.name).slice(0, 3),
    runtime: movie.runtime || null,
    rating: rating,
    certification: pickMovieCert(movie.release_dates),
    nextEpisode: null,
    imdbId: (movie.external_ids && movie.external_ids.imdb_id) || null,
    tmdbVote: movie.vote_average,
  };
  return withAniList(
    meta,
    [movie.title, movie.original_title, parsed && parsed.title],
    meta.year,
    movie,
    parsed,
  );
}

async function getImdbId(mediaType, tmdbId) {
  if (!tmdbId) return null;
  const path = mediaType === "movie" ? `/movie/${tmdbId}/external_ids` : `/tv/${tmdbId}/external_ids`;
  const data = await getJson(path);
  return (data && data.imdb_id) || null;
}

async function hydrate(parsed, queryOverride, selected) {
  const found = selected || (await search(parsed, queryOverride));
  if (!found) return null;
  return hydrateFromFound(found, parsed);
}

async function hydratePicked(mediaType, id, season, episode) {
  return hydrate(
    {
      mediaType: mediaType,
      title: "",
      season: season == null ? null : season,
      episode: episode == null ? null : episode,
      year: null,
    },
    null,
    { mediaType: mediaType, id: id },
  );
}

module.exports = {
  apiKey,
  hydrate,
  hydratePicked,
  enrichAniList,
  getImdbId,
  searchAll,
  getSeasons,
  getEpisodes,
};
