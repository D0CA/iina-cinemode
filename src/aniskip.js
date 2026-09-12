const { http, console, utils } = iina;

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

function skipUrl(malId, episode, duration) {
  const types = ["op", "ed", "recap", "mixed-op", "mixed-ed"]
    .map(function (type) {
      return "types=" + encodeURIComponent(type);
    })
    .join("&");
  let url =
    "https://api.aniskip.com/v2/skip-times/" +
    encodeURIComponent(String(malId)) +
    "/" +
    encodeURIComponent(String(episode)) +
    "?" +
    types;
  if (duration && duration > 30) {
    url += "&episodeLength=" + encodeURIComponent(String(Math.round(duration)));
  }
  return url;
}

function mapType(skipType) {
  if (skipType === "ed" || skipType === "mixed-ed") return "credits";
  if (skipType === "recap") return "recap";
  if (skipType === "op" || skipType === "mixed-op") return "intro";
  return null;
}

function mapResults(data, duration) {
  const rows = (data && data.results) || [];
  return rows
    .map(function (row) {
      const type = mapType(row.skipType);
      const interval = row.interval || {};
      const start = Number(interval.startTime);
      const end = Number(interval.endTime);
      if (!type || isNaN(start) || isNaN(end) || end - start < 4) return null;
      if (duration && end > duration + 8) return null;
      return {
        start: Math.max(0, start),
        end: end,
        type: type,
        source: "aniskip",
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return a.start - b.start;
    });
}

async function getJson(url) {
  try {
    const res = await withTimeout(
      http.get(url, {
        headers: { Accept: "application/json", "User-Agent": "CineMode/1.1" },
      }),
      4000,
      "aniskip timeout",
    );
    const raw = res && (res.data != null && res.data !== "" ? res.data : res.text);
    if (raw && typeof raw === "object") return raw;
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.log(`aniskip http: ${err}; curl`);
  }
  if (!utils || !utils.exec) return null;
  const result = await utils.exec("/usr/bin/curl", [
    "-sS",
    "-L",
    "--max-time", "6",
    "-H", "Accept: application/json",
    "-A", "CineMode/1.1",
    url,
  ]);
  const stdout = (result && result.stdout) || "";
  if (!stdout) return null;
  return JSON.parse(stdout);
}

async function fetchSegments(meta, duration) {
  if (!meta || !meta.malId) return [];
  const episode =
    meta.episode != null ? meta.episode : meta.mediaType === "movie" ? 1 : null;
  if (episode == null) return [];
  const url = skipUrl(meta.malId, episode, duration);
  try {
    const data = await getJson(url);
    if (!data || data.found === false) return [];
    const segments = mapResults(data, duration);
    console.log(`aniskip: ${segments.length} segment(s) mal ${meta.malId} e${episode}`);
    return segments;
  } catch (err) {
    console.log(`aniskip: ${err}`);
    return [];
  }
}

module.exports = {
  fetchSegments,
};
