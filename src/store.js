const { file, console } = iina;

const INTROS_PATH = "@data/intros.json";
const CACHE_PATH = "@data/meta-cache.json";

function readJson(path, fallback) {
  try {
    if (!file.exists(path)) return fallback;
    const raw = file.read(path);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.log(`store.read ${path}: ${err}`);
    return fallback;
  }
}

function writeJson(path, value) {
  try {
    file.write(path, JSON.stringify(value, null, 2));
  } catch (err) {
    console.log(`store.write ${path}: ${err}`);
  }
}

function cacheKey(filename) {
  return String(filename || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getMetaCache(filename) {
  const db = readJson(CACHE_PATH, {});
  return db[cacheKey(filename)] || null;
}

function setMetaCache(filename, meta) {
  const db = readJson(CACHE_PATH, {});
  db[cacheKey(filename)] = Object.assign({ cachedAt: Date.now() }, meta);
  const keys = Object.keys(db);
  if (keys.length > 80) {
    keys.sort(function (a, b) {
      return (db[a].cachedAt || 0) - (db[b].cachedAt || 0);
    });
    keys.slice(0, keys.length - 80).forEach(function (key) {
      delete db[key];
    });
  }
  writeJson(CACHE_PATH, db);
}

function clearMetaCache(filename) {
  if (!filename) {
    writeJson(CACHE_PATH, {});
    return;
  }
  const db = readJson(CACHE_PATH, {});
  delete db[cacheKey(filename)];
  writeJson(CACHE_PATH, db);
}

function introKeys(meta) {
  if (!meta || !meta.id) return [];
  const keys = [];
  if (meta.mediaType === "tv" && meta.season && meta.episode) {
    keys.push(`tv:${meta.id}:s${meta.season}:e${meta.episode}`);
  }
  if (meta.mediaType === "tv" && meta.season) {
    keys.push(`tv:${meta.id}:s${meta.season}`);
  }
  if (meta.mediaType === "tv") keys.push(`tv:${meta.id}`);
  if (meta.mediaType === "movie") keys.push(`movie:${meta.id}`);
  return keys;
}

function getIntro(meta) {
  const db = readJson(INTROS_PATH, {});
  for (const key of introKeys(meta)) {
    if (db[key]) return Object.assign({ key: key }, db[key]);
  }
  return null;
}

function saveIntro(meta, range, scope) {
  const db = readJson(INTROS_PATH, {});
  let key = introKeys(meta)[0];
  if (scope === "season" && meta.mediaType === "tv" && meta.season) {
    key = `tv:${meta.id}:s${meta.season}`;
  } else if (scope === "show" && meta.mediaType === "tv") {
    key = `tv:${meta.id}`;
  }
  if (!key) return null;
  db[key] = {
    start: range.start,
    end: range.end,
    source: range.source || "user",
    updatedAt: Date.now(),
  };
  writeJson(INTROS_PATH, db);
  return Object.assign({ key: key }, db[key]);
}

module.exports = {
  getMetaCache,
  setMetaCache,
  clearMetaCache,
  getIntro,
  saveIntro,
  introKeys,
};
