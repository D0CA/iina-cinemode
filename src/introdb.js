const { http, console, utils } = iina;

function qs(params) {
  return Object.keys(params)
    .filter(function (key) {
      return params[key] !== undefined && params[key] !== null && params[key] !== "";
    })
    .map(function (key) {
      return `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`;
    })
    .join("&");
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

function toSeconds(seg, keySec, keyMs, fallback) {
  if (seg[keySec] != null && !isNaN(Number(seg[keySec]))) return Number(seg[keySec]);
  if (seg[keyMs] != null && !isNaN(Number(seg[keyMs]))) return Number(seg[keyMs]) / 1000;
  return fallback;
}

function mapSegments(list, type, duration) {
  return (list || [])
    .map(function (seg) {
      const start = toSeconds(seg, "start_sec", "start_ms", 0);
      const end = toSeconds(seg, "end_sec", "end_ms", duration);
      if (end == null || isNaN(end) || end - start < 4) return null;
      return {
        start: Math.max(0, start),
        end: end,
        type: type,
        source: "introdb",
      };
    })
    .filter(Boolean);
}

async function fetchSegments(meta, duration) {
  if (!meta || !meta.id) return [];
  const params = { tmdb_id: String(meta.id) };
  if (meta.mediaType === "tv") {
    if (meta.season == null || meta.episode == null) return [];
    params.season = String(meta.season);
    params.episode = String(meta.episode);
  }
  if (duration) params.duration_ms = String(Math.round(duration * 1000));

  const url = `https://api.theintrodb.org/v3/media?${qs(params)}`;
  try {
    let data = null;
    try {
      const res = await withTimeout(
        http.get(url, {
          headers: { Accept: "application/json", "User-Agent": "CineMode/1.1" },
        }),
        4000,
        "introdb timeout",
      );
      data = res.data || (res.text ? JSON.parse(res.text) : null);
    } catch (err) {
      console.log(`introdb http: ${err}; curl`);
      if (utils && utils.exec) {
        const result = await utils.exec("/usr/bin/curl", [
          "-sS",
          "-L",
          "--max-time", "6",
          "-H", "Accept: application/json",
          "-A", "CineMode/1.1",
          url,
        ]);
        const stdout = (result && result.stdout) || "";
        data = stdout ? JSON.parse(stdout) : null;
      }
    }
    if (!data) return [];
    const segments = []
      .concat(mapSegments(data.recap, "recap", duration))
      .concat(mapSegments(data.intro, "intro", duration))
      .concat(mapSegments(data.credits, "credits", duration));
    segments.sort(function (a, b) {
      return a.start - b.start;
    });
    console.log(`introdb: ${segments.length} segment(s) for tmdb ${meta.id}`);
    return segments;
  } catch (err) {
    console.log(`introdb: ${err}`);
    return [];
  }
}

module.exports = {
  fetchSegments,
};
