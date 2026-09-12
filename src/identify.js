const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|webm|mpg|mpeg)$/i;

const STOP_JUNK = [
  "2160p", "1080p", "720p", "480p", "4k", "uhd",
  "hdr10plus", "hdr10", "hdr", "dv", "dovi", "dolby", "vision",
  "webrip", "web-dl", "webdl", "web", "bluray", "blu-ray", "bdrip", "brrip",
  "dvdrip", "hdtv", "pdtv", "remux", "hybrid",
  "x264", "x265", "h264", "h265", "hevc", "avc", "av1", "xvid",
  "10bit", "8bit", "aac", "ac3", "eac3", "dts-hd", "dts", "ddp5.1", "ddp",
  "dd5.1", "truehd", "atmos",
  "amzn", "dsnp", "atvp", "atv+", "atv", "hulu", "hmax", "nf", "pmtp",
];

const SKIP_JUNK = [
  "proper", "repack", "internal", "extended", "unrated", "limited", "multi",
  "vostfr", "vff", "vfi", "truefrench", "subforced", "forced",
  "complete", "sample", "nfo", "readnfo",
  "www", "http", "https", "org", "com", "net", "info",
  "uindex", "eztv", "rarbg", "yts", "yify", "tgx", "ettv", "torrent",
  "cpasbien", "darkside", "megusta", "kickass", "piratebay", "1337x",
  "nyaa", "animetosho", "subsplease", "erai", "erai-raws", "erairaws",
  "horriblesubs", "asw", "judas", "ember",
];

function looksLikeUrl(value) {
  return /^(https?:\/\/|magnet:)/i.test(value || "");
}

function looksLikeHash(value) {
  const text = String(value || "");
  if (/[sS]\d{1,2}[eE]\d{1,4}/.test(text)) return false;
  return /^[a-zA-Z0-9_-]{8,}$/.test(text) && !/[. ]/.test(text);
}

function plausibleEpisode(n) {
  if (!isFinite(n) || n < 1 || n > 1999) return false;
  if (n === 264 || n === 265 || n === 480 || n === 720 || n === 1080 || n === 1440 || n === 2160) {
    return false;
  }
  if (n >= 1900 && n <= 2035) return false;
  return true;
}

function looksLikeOurTitle(value) {
  return / · S\d{2}E\d{2}/.test(value || "");
}

function decode(value) {
  let text = String(value || "").replace(/\+/g, " ");
  try {
    text = decodeURIComponent(text);
  } catch (err) {}
  return text;
}

function basenameFromPath(raw) {
  if (!raw) return "";
  return decode(String(raw)).split(/[\\/]/).pop() || "";
}

function namesFromValue(raw) {
  const out = [];
  if (!raw) return out;
  const value = decode(raw);
  if (looksLikeUrl(value)) {
    try {
      const url = new URL(value);
      ["filename", "name", "title", "file", "n", "fn", "cdn_filename", "original_filename"].forEach(function (key) {
        const got = url.searchParams.get(key);
        if (got) out.push(decode(got));
      });
      url.pathname.split("/").filter(Boolean).forEach(function (part) {
        out.push(decode(part));
      });
    } catch (err) {
      out.push(value);
    }
  } else {
    out.push(value);
  }
  return out;
}

function collectCandidates(core, mpv) {
  const seen = [];
  const push = (value) => {
    namesFromValue(value).forEach(function (text) {
      const cleaned = String(text || "").trim();
      if (!cleaned || seen.indexOf(cleaned) >= 0) return;
      if (looksLikeOurTitle(cleaned)) return;
      seen.push(cleaned);
    });
  };

  try { push(mpv.getString("filename")); } catch (err) {}
  try { push(mpv.getString("filename/no-ext")); } catch (err) {}
  try { push(mpv.getString("media-title")); } catch (err) {}
  try { push(mpv.getString("path")); } catch (err) {}
  try { push(mpv.getString("stream-open-filename")); } catch (err) {}
  try { push(mpv.getString("playlist-path")); } catch (err) {}
  push(core.status.title);
  push(core.status.url);
  return seen;
}

function pickReleaseName(candidates) {
  const names = candidates
    .map(basenameFromPath)
    .map((name) => name.replace(VIDEO_EXT, ""))
    .filter(Boolean);

  const scored = names.map((name) => {
    let score = 0;
    if (looksLikeUrl(name)) score -= 50;
    if (looksLikeHash(name)) score -= 25;
    if (/[sS]\d{1,2}\s*[eE]\d{1,4}/.test(name)) score += 40;
    if (/\bSaison|\bSeason/i.test(name) && /\bEpisode|\bÉpisode|\bEp\b/i.test(name)) score += 35;
    if (/\d{1,2}x\d{1,4}/.test(name)) score += 20;
    if (/\s[-–]\s+\d{1,4}\b/.test(name)) score += 14;
    if (/(?:19|20)\d{2}/.test(name)) score += 6;
    if (/[.\-_ ]/.test(name)) score += 6;
    if (VIDEO_EXT.test(name) || /\.(mkv|mp4)/i.test(name)) score += 8;
    if (name.length > 12) score += 3;
    return { name: name, score: score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].name : "";
}

function tokenize(name) {
  return name
    .replace(/[\[\](){}]/g, " ")
    .replace(/\((?:US|UK|FR|CA|AU|DE|ES|IT)\)/gi, " ")
    .replace(/[._,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHardJunk(token) {
  const lower = token.toLowerCase();
  if (STOP_JUNK.indexOf(lower) >= 0) return true;
  if (/^\d{3,4}p$/.test(lower)) return true;
  if (/^(web|nf|amzn|max|atm)$/i.test(lower)) return true;
  return false;
}

function isSoftJunk(token) {
  const lower = token.toLowerCase();
  if (SKIP_JUNK.indexOf(lower) >= 0) return true;
  if (/^www\./i.test(lower)) return true;
  if (/^(us|uk|ca|au)$/i.test(lower)) return true;
  return false;
}

function extractSeasonEpisode(working) {
  let season = null;
  let episode = null;
  let before = working;
  let after = "";

  const patterns = [
    /\bS(\d{1,2})\s*[.xX_-]?\s*E(\d{1,4})(?:-?E?\d{1,4})?\b/i,
    /\bS(\d{1,2})EP(\d{1,4})\b/i,
    /\b(?:season|saison)\s*(\d{1,2})\s*(?:[-.]+\s*)?(?:episode|épisode|ep)\s*(\d{1,4})\b/i,
    /\b(\d{1,2})(?:ere|ème|eme|er|ère)?\s+(?:season|saison)\s+(?:episode|épisode|ep)\s*(\d{1,4})\b/i,
    /\b(\d{1,2})x(\d{1,4})\b/i,
  ];

  for (let i = 0; i < patterns.length; i++) {
    const match = working.match(patterns[i]);
    if (match && match.index != null) {
      const s = parseInt(match[1], 10);
      const e = parseInt(match[2], 10);
      if (!plausibleEpisode(e)) continue;
      season = s;
      episode = e;
      before = working.slice(0, match.index).trim();
      after = working.slice(match.index + match[0].length).trim();
      break;
    }
  }

  if (season == null) {
    const loose = working.match(/\bS(\d{1,2})\b/i);
    const epOnly = working.match(/\b(?:e|ep|episode|épisode)\s*(\d{1,4})\b/i);
    if (loose && epOnly && loose.index != null && plausibleEpisode(parseInt(epOnly[1], 10))) {
      season = parseInt(loose[1], 10);
      episode = parseInt(epOnly[1], 10);
      const cut = Math.min(loose.index, epOnly.index);
      before = working.slice(0, cut).trim();
      after = "";
    } else if (epOnly && epOnly.index != null && plausibleEpisode(parseInt(epOnly[1], 10))) {
      episode = parseInt(epOnly[1], 10);
      before = working.slice(0, epOnly.index).trim();
      after = working.slice(epOnly.index + epOnly[0].length).trim();
    }
  }

  if (episode == null) {
    const dash = working.match(/\s[-–]\s+(\d{1,4})(?:\b|$)/);
    if (dash && dash.index != null && plausibleEpisode(parseInt(dash[1], 10))) {
      episode = parseInt(dash[1], 10);
      before = working.slice(0, dash.index).trim();
      after = working.slice(dash.index + dash[0].length).trim();
    }
  }

  return { season: season, episode: episode, before: before, after: after };
}

function looksLikeMovieTitle(text) {
  const value = text || "";
  if (/劇場版|映画/.test(value)) return true;
  return /\b(gekijouban|gekijoban|gekijo[- ]ban|the movie|movie|film)\b/i.test(value);
}

function hasCjk(text) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text || "");
}

function looksLikeAnime(text) {
  if (hasCjk(text)) return true;
  return /\b(subsplease|erai|erai-raws|horriblesubs|nyaa|animetosho|asw|judas|ember)\b/i.test(
    text || "",
  );
}

function titleFromTokens(working) {
  const tokens = working.split(" ").filter(Boolean);
  const titleTokens = [];
  for (const token of tokens) {
    if (isHardJunk(token)) break;
    if (isSoftJunk(token) || /^[-]+$/.test(token)) continue;
    titleTokens.push(token);
  }
  let title = titleTokens.join(" ").replace(/\s+-\s*$/, "").trim();
  const cjk = title.match(/[\u3040-\u30ff\u3400-\u9fff].*/);
  if (cjk) title = cjk[0].trim();
  return title;
}

function parseReleaseName(name) {
  const original = name || "";
  let working = tokenize(original.replace(VIDEO_EXT, ""));
  const extracted = extractSeasonEpisode(working);
  const season = extracted.season;
  const episode = extracted.episode;
  let titleSource = extracted.before;
  if (!titleSource || titleSource.length < 2) {
    titleSource = [extracted.before, extracted.after].filter(Boolean).join(" ");
  }

  let year = null;
  const yearMatch = titleSource.match(/\b((?:19|20)\d{2})\b/) || working.match(/\b((?:19|20)\d{2})\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    titleSource = titleSource.replace(yearMatch[0], " ");
  }

  titleSource = titleSource.replace(/\bwww\s+\S+\s+(org|com|net|info)\b/gi, " ");
  titleSource = titleSource.replace(/\b(season|saison)\s*\d+\b/gi, " ");
  titleSource = titleSource.replace(/\b(episode|épisode|ep)\s*\d+\b/gi, " ");

  const title = titleFromTokens(titleSource);
  const imdbId = extractImdbId(original);
  const movieHint = looksLikeMovieTitle(original) && !episode;
  const anime = looksLikeAnime(original) || hasCjk(title);
  if (looksLikeHash(title) && !season && !episode) {
    return {
      raw: original,
      title: "",
      season: season,
      episode: episode,
      year: year,
      mediaType: "movie",
      movieHint: false,
      looksAnime: false,
      imdbId: imdbId,
    };
  }

  return {
    raw: original,
    title: title,
    season: season,
    episode: episode,
    year: year,
    mediaType: episode ? "tv" : movieHint ? "movie" : "movie",
    movieHint: movieHint,
    looksAnime: anime,
    imdbId: imdbId,
  };
}

function extractImdbId(text) {
  const match = String(text || "").match(/\b(tt\d{7,8})\b/i);
  return match ? match[1].toLowerCase() : null;
}

function parseContentDisposition(headers) {
  const folded = String(headers || "").replace(/\r\n[ \t]+/g, " ");
  const lines = folded.split(/\r?\n/);
  let filename = "";
  lines.forEach(function (line) {
    const disp = line.match(/^content-disposition:\s*(.+)$/i);
    if (disp) {
      const star = disp[1].match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
      const plain =
        disp[1].match(/filename\s*=\s*"([^"]+)"/i) ||
        disp[1].match(/filename\s*=\s*([^;]+)/i);
      const raw = star ? star[1] : plain && plain[1];
      if (raw) filename = decode(raw.replace(/['"]/g, "").trim());
    }
    const alt = line.match(/^x-file-?name:\s*(.+)$/i);
    if (alt && !filename) filename = decode(alt[1].trim());
    const loc = line.match(/^location:\s*(.+)$/i);
    if (loc) {
      const fromUrl = basenameFromPath(loc[1].trim());
      if (fromUrl && VIDEO_EXT.test(fromUrl)) filename = fromUrl;
    }
  });
  return filename;
}

function playbackUrl(core, mpv) {
  const values = [];
  try { values.push(mpv.getString("path")); } catch (err) {}
  try { values.push(mpv.getString("stream-open-filename")); } catch (err) {}
  values.push(core.status.url);
  values.push(core.status.title);
  return values.find(looksLikeUrl) || "";
}

function needsRemoteProbe(parsed) {
  if (!parsed) return true;
  if (parsed.imdbId) return false;
  if (parsed.episode && parsed.title && parsed.title.length >= 2) return false;
  if (parsed.title && parsed.title.length >= 4 && !looksLikeHash(parsed.release)) return false;
  return true;
}

async function probeRemoteName(url) {
  if (!looksLikeUrl(url) || !iina.utils || !iina.utils.exec) return "";
  try {
    const result = await iina.utils.exec("/usr/bin/curl", [
      "-sD", "-",
      "-o", "/dev/null",
      "-r", "0-0",
      "-L",
      "--max-time", "5",
      "-A", "CineMode/1.1",
      url,
    ]);
    const headers = (result && result.stdout) || "";
    const name = parseContentDisposition(headers);
    if (name) iina.console.log(`identify: content-disposition "${name}"`);
    return name;
  } catch (err) {
    iina.console.log(`identify probe: ${err}`);
    return "";
  }
}

async function identifyPlaybackAsync(core, mpv) {
  const parsed = identifyPlayback(core, mpv);
  if (!needsRemoteProbe(parsed)) return parsed;
  const url = playbackUrl(core, mpv);
  const remote = await probeRemoteName(url);
  if (!remote) return parsed;
  const names = parsed.candidates.slice();
  if (names.indexOf(remote) < 0) names.push(remote);
  const release = pickReleaseName(names) || remote.replace(VIDEO_EXT, "");
  const next = parseReleaseName(release);
  next.candidates = names;
  next.release = release;
  return next;
}

function identifyPlayback(core, mpv) {
  const candidates = collectCandidates(core, mpv);
  const release = pickReleaseName(candidates);
  const parsed = parseReleaseName(release);
  parsed.candidates = candidates;
  parsed.release = release;
  if (!parsed.imdbId) {
    parsed.imdbId = candidates.map(extractImdbId).find(Boolean) || null;
  }
  return parsed;
}

module.exports = {
  identifyPlayback,
  identifyPlaybackAsync,
  parseReleaseName,
  basenameFromPath,
  parseContentDisposition,
};
