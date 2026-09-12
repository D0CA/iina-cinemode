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

function uniqueTitles(list) {
  const out = [];
  (list || []).forEach(function (value) {
    const text = String(value || "").trim();
    if (text && text.length >= 2 && out.indexOf(text) < 0) out.push(text);
  });
  return out;
}

function mapStudio(media) {
  const nodes =
    (media && media.studios && media.studios.nodes) || [];
  return (nodes[0] && nodes[0].name) || null;
}

function mapMedia(media) {
  if (!media) return null;
  return {
    anilistId: media.id,
    malId: media.idMal || null,
    score: media.averageScore || null,
    studio: mapStudio(media),
    duration: media.duration || null,
  };
}

async function graphql(query, variables) {
  const body = JSON.stringify({ query: query, variables: variables || {} });
  try {
    if (http && http.post) {
      const res = await withTimeout(
        http.post("https://graphql.anilist.co", {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "CineMode/1.1",
          },
          data: body,
        }),
        5000,
        "anilist http timeout",
      );
      const raw = res && (res.data != null ? res.data : res.text);
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && parsed.data) return parsed.data;
    }
  } catch (err) {
    console.log(`anilist http: ${err}; curl`);
  }
  if (!utils || !utils.exec) return null;
  const result = await utils.exec("/usr/bin/curl", [
    "-sS",
    "-L",
    "--max-time", "8",
    "-H", "Accept: application/json",
    "-H", "Content-Type: application/json",
    "-A", "CineMode/1.1",
    "-d", body,
    "https://graphql.anilist.co",
  ]);
  const stdout = (result && result.stdout) || "";
  if (!stdout) return null;
  const parsed = JSON.parse(stdout);
  return parsed && parsed.data ? parsed.data : null;
}

async function searchTitle(title, year) {
  const data = await graphql(
    "query ($search: String) { Media(search: $search, type: ANIME, sort: SEARCH_MATCH) { id idMal averageScore duration startDate { year } studios(isMain: true) { nodes { name } } title { romaji english native } } }",
    { search: title },
  );
  const media = data && data.Media;
  if (!media) return null;
  if (year && media.startDate && media.startDate.year) {
    const delta = Math.abs(Number(media.startDate.year) - Number(year));
    if (delta > 3) return null;
  }
  return mapMedia(media);
}

async function lookup(titles, year) {
  const list = uniqueTitles(titles);
  for (let i = 0; i < list.length; i++) {
    try {
      const hit = await searchTitle(list[i], year);
      if (hit && (hit.malId || hit.score)) return hit;
    } catch (err) {
      console.log(`anilist lookup: ${err}`);
    }
  }
  return null;
}

module.exports = {
  lookup,
};
