const { http, console, preferences, utils, file } = iina;

const API = "https://api.trakt.tv";
const TOKEN_PATH = "@data/trakt.json";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";
const USER_AGENT = "CineMode/1.3";
const ACTIVATE_URL = "https://trakt.tv/activate/";

let polling = null;
let refreshing = null;
let current = { key: null, action: null, done: false };

// Trakt keys and codes are plain alphanumerics; anything else is a paste error or an injection attempt.
function clean(value) {
  return String(value || "").replace(/[^A-Za-z0-9]/g, "");
}

function clientId() {
  return clean(preferences.get("traktClientId"));
}

function clientSecret() {
  return clean(preferences.get("traktClientSecret"));
}

function hasClient() {
  return !!clientId() && !!clientSecret();
}

function readTokens() {
  try {
    if (!file.exists(TOKEN_PATH)) return null;
    const raw = file.read(TOKEN_PATH);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.log(`trakt tokens read: ${err}`);
    return null;
  }
}

function writeTokens(tokens) {
  try {
    file.write(TOKEN_PATH, JSON.stringify(tokens || {}, null, 2));
  } catch (err) {
    console.log(`trakt tokens write: ${err}`);
    return;
  }
  // Tokens grant access to the Trakt account: keep the file readable by this user only.
  try {
    const real = utils && utils.resolvePath ? utils.resolvePath(TOKEN_PATH) : null;
    if (real && utils.exec) utils.exec("/bin/chmod", ["600", real]).catch(function () {});
  } catch (err) {
    console.log(`trakt tokens chmod: ${err}`);
  }
}

function isConnected() {
  const tokens = readTokens();
  return !!(tokens && tokens.access_token);
}

function enabled() {
  return preferences.get("traktScrobble") !== false && hasClient() && isConnected();
}

function parseBody(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
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

function headersFor(token) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "trakt-api-version": "2",
    "trakt-api-key": clientId(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Trakt answers with meaningful status codes (400 pending, 409 duplicate...), so we always need it.
async function post(path, body, token) {
  const url = API + path;
  const data = JSON.stringify(body || {});
  const headers = headersFor(token);
  try {
    if (http && http.post) {
      const res = await withTimeout(http.post(url, { headers: headers, data: data }), 8000, "trakt http timeout");
      if (res && res.statusCode) {
        return { status: res.statusCode, body: parseBody(res.data != null ? res.data : res.text) };
      }
    }
  } catch (err) {
    console.log(`trakt http ${path}: ${err}; curl`);
  }
  if (!utils || !utils.exec) return { status: 0, body: null };
  const args = ["-sS", "--max-time", "10", "-X", "POST", "-w", "\n%{http_code}"];
  Object.keys(headers).forEach(function (name) {
    args.push("-H", `${name}: ${headers[name]}`);
  });
  args.push("--data-raw", data, url);
  const result = await utils.exec("/usr/bin/curl", args);
  const stdout = String((result && result.stdout) || "");
  const cut = stdout.lastIndexOf("\n");
  const status = Number(stdout.slice(cut + 1)) || 0;
  return { status: status, body: parseBody(stdout.slice(0, cut)) };
}

function saveTokenResponse(body) {
  const now = Math.floor(Date.now() / 1000);
  writeTokens({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: (body.created_at || now) + (body.expires_in || 0),
  });
}

async function refresh(tokens) {
  if (!tokens || !tokens.refresh_token) return null;
  const res = await post("/oauth/token", {
    refresh_token: tokens.refresh_token,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: REDIRECT_URI,
    grant_type: "refresh_token",
  });
  if (res.status !== 200 || !res.body || !res.body.access_token) {
    console.log(`trakt refresh: ${res.status}`);
    return null;
  }
  saveTokenResponse(res.body);
  return readTokens();
}

// Refresh tokens are single-use, so concurrent callers share one refresh.
function refreshOnce(tokens) {
  if (!refreshing) {
    refreshing = refresh(tokens).finally(function () {
      refreshing = null;
    });
  }
  return refreshing;
}

async function accessToken(forceRefresh) {
  let tokens = readTokens();
  if (!tokens || !tokens.access_token) return null;
  const now = Math.floor(Date.now() / 1000);
  if (forceRefresh || (tokens.expires_at && tokens.expires_at - now < 3600)) {
    tokens = (await refreshOnce(tokens)) || (forceRefresh ? null : tokens);
  }
  return tokens && tokens.access_token;
}

function stopPolling() {
  if (polling) clearTimeout(polling.timer);
  polling = null;
}

// Device flow: show a code, the user approves it on trakt.tv, we poll until it's done.
// onUpdate receives { state: "code" | "connected" | "expired" | "denied" | "error", code, url }.
async function connect(onUpdate) {
  stopPolling();
  if (!hasClient()) {
    onUpdate({ state: "missing-client" });
    return;
  }
  const res = await post("/oauth/device/code", { client_id: clientId() });
  const body = res.body;
  if (res.status !== 200 || !body || !body.device_code) {
    console.log(`trakt device code: ${res.status}`);
    onUpdate({ state: "error" });
    return;
  }
  const userCode = clean(body.user_code);
  if (!userCode) {
    onUpdate({ state: "error" });
    return;
  }
  // Built here rather than taken from the response, so we only ever open trakt.tv.
  onUpdate({ state: "code", code: userCode, url: ACTIVATE_URL + userCode });

  const session = {
    timer: null,
    deadline: Date.now() + (body.expires_in || 600) * 1000,
    interval: Math.max(1, body.interval || 5) * 1000,
  };
  polling = session;

  async function poll() {
    if (polling !== session) return;
    if (Date.now() > session.deadline) {
      stopPolling();
      onUpdate({ state: "expired" });
      return;
    }
    let next;
    try {
      next = await post("/oauth/device/token", {
        code: body.device_code,
        client_id: clientId(),
        client_secret: clientSecret(),
      });
    } catch (err) {
      next = { status: 0 };
    }
    if (polling !== session) return;
    if (next.status === 200 && next.body && next.body.access_token) {
      saveTokenResponse(next.body);
      stopPolling();
      onUpdate({ state: "connected" });
      return;
    }
    if (next.status === 410 || next.status === 404) {
      stopPolling();
      onUpdate({ state: "expired" });
      return;
    }
    if (next.status === 418) {
      stopPolling();
      onUpdate({ state: "denied" });
      return;
    }
    if (next.status === 409) {
      stopPolling();
      onUpdate({ state: isConnected() ? "connected" : "error" });
      return;
    }
    if (next.status === 429) session.interval += 1000;
    session.timer = setTimeout(poll, session.interval);
  }
  session.timer = setTimeout(poll, session.interval);
}

async function disconnect() {
  stopPolling();
  const tokens = readTokens();
  writeTokens({});
  current = { key: null, action: null, done: false };
  if (tokens && tokens.access_token && hasClient()) {
    try {
      await post("/oauth/revoke", {
        token: tokens.access_token,
        client_id: clientId(),
        client_secret: clientSecret(),
      });
    } catch (err) {
      console.log(`trakt revoke: ${err}`);
    }
  }
}

function itemKey(meta) {
  if (!meta || !meta.id) return null;
  if (meta.mediaType === "tv") {
    if (meta.season == null || meta.episode == null) return null;
    return `tv:${meta.id}:${meta.season}:${meta.episode}`;
  }
  return `movie:${meta.id}`;
}

function itemBody(meta) {
  if (meta.mediaType === "tv") {
    return {
      show: { ids: { tmdb: Number(meta.id) } },
      episode: { season: Number(meta.season), number: Number(meta.episode) },
    };
  }
  return { movie: { ids: { tmdb: Number(meta.id) } } };
}

// action: "start" | "pause" | "stop". Stop above 80% marks the item as watched on Trakt.
async function scrobble(action, meta, progress) {
  if (!enabled()) return;
  const key = itemKey(meta);
  if (!key || progress == null || isNaN(progress)) return;
  if (current.key !== key) current = { key: key, action: null, done: false };
  if (current.done) return;
  if (action !== "stop" && current.action === action) return;
  if (action !== "start" && progress < 1) return;
  current.action = action;
  if (action === "stop" && progress >= 80) current.done = true;

  const body = Object.assign(itemBody(meta), {
    progress: Math.min(100, Math.max(0, Number(progress.toFixed(2)))),
  });
  try {
    let token = await accessToken(false);
    if (!token) return;
    let res = await post(`/scrobble/${action}`, body, token);
    if (res.status === 401) {
      token = await accessToken(true);
      if (token) res = await post(`/scrobble/${action}`, body, token);
    }
    console.log(`trakt ${action} ${key} ${body.progress}% -> ${res.status}`);
  } catch (err) {
    console.log(`trakt ${action}: ${err}`);
  }
}

module.exports = {
  hasClient,
  isConnected,
  enabled,
  connect,
  disconnect,
  scrobble,
};
