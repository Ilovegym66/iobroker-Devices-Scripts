/***************************************************************
 * Technitium DNS Server – ioBroker Script-Adapter (v1.0)
 * Für ioBroker JavaScript Adapter >= 9.0.11
 *
 * Features:
 *  - Polling: /api/settings/get (Basis-Status + enableBlocking)
 *  - Steuerung: enableBlocking (DNS-Blocking) via /api/settings/set
 *  - Cache Flush: /api/cache/flush
 *  - Optional: Dashboard-Stats JSON via /api/dashboard/stats/get
 *  - Robust: Auto-ReAuth bei invalid-token (wenn User/Pass genutzt wird)
 *
 * Wichtiger Hinweis zur API:
 *  - Technitium API nutzt "token" als Query/Form-Parameter.
 *  - Ein "Set"-Call überschreibt nur die Werte der übergebenen Parameter.
 *    (D.h. enableBlocking alleine setzen ist ok.) :contentReference[oaicite:2]{index=2}
 ***************************************************************/
'use strict';

/*** =========================
 * Konfiguration
 * ========================= */
const CFG = {
  ROOT: '0_userdata.0.Geraete.TechnitiumDNS',

  // Technitium Web/API Endpoint
  HOST: '127.0.0.1',
  PORT: 5380,           // Standard Web Console Port
  HTTPS: false,         // true, wenn du die API über TLS erreichst
  BASE_PATH: '',        // z.B. '/dns' bei Reverse-Proxy; sonst leer
  IGNORE_TLS_ERRORS: false, // bei Self-Signed TLS ggf. true

  // Auth:
  // Empfehlung: API_TOKEN nutzen (nicht ablaufend). Alternativ USER/PASS.
  API_TOKEN: '',        // via /api/user/createToken (oder über UI) :contentReference[oaicite:3]{index=3}
  USER: 'admin',
  PASS: 'admin',
  TOTP: '',             // optional, falls 2FA aktiv (6-stellig)

  // Polling
  POLL_MS: 30_000,
  TIMEOUT_MS: 12_000,

  // Dashboard Stats optional
  DASHBOARD_STATS_ENABLED: true,
  DASHBOARD_STATS_TYPE: 'LastHour', // LastHour|LastDay|LastWeek|LastMonth|LastYear|Custom :contentReference[oaicite:4]{index=4}
  DASHBOARD_STATS_UTC: true
};

/*** =========================
 * ioBroker Helpers (robust)
 * ========================= */
function logI(msg) { console.log(`[TechnitiumDNS] ${msg}`); }
function logW(msg) { console.warn(`[TechnitiumDNS] ${msg}`); }
function logE(msg) { console.error(`[TechnitiumDNS] ${msg}`); }

function safeGetState(id) {
  try { return getState(id); } catch { return null; }
}

function setStateIfChanged(id, val, ack = true) {
  const s = safeGetState(id);
  const sval = s ? s.val : undefined;
  const sack = s ? s.ack : undefined;

  // primitive compare; for objects stringify
  const isObj = val !== null && typeof val === 'object';
  const newVal = isObj ? JSON.stringify(val) : val;
  const oldVal = isObj ? (typeof sval === 'string' ? sval : JSON.stringify(sval)) : sval;

  if (!s || oldVal !== newVal || sack !== ack) {
    setState(id, newVal, ack);
  }
}

function ensureObject(id, obj) {
  try { setObjectNotExists(id, obj); } catch (e) { /* ignore */ }
}

function ensureState(id, common, initialValue) {
  ensureObject(id, {
    type: 'state',
    common: Object.assign({
      name: id,
      read: true,
      write: false,
      role: 'state',
      type: 'mixed'
    }, common || {}),
    native: {}
  });

  const s = safeGetState(id);
  if ((s === null || s === undefined) && initialValue !== undefined) {
    try { setState(id, initialValue, true); } catch { /* ignore */ }
  }
}

function nowIsoLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/*** =========================
 * HTTP Client (ohne externe Module)
 * ========================= */
const http = require('http');
const https = require('https');

function buildBasePath() {
  if (!CFG.BASE_PATH) return '';
  return CFG.BASE_PATH.startsWith('/') ? CFG.BASE_PATH : `/${CFG.BASE_PATH}`;
}

function toQuery(params) {
  const esc = encodeURIComponent;
  return Object.keys(params || {})
    .filter(k => params[k] !== undefined && params[k] !== null)
    .map(k => `${esc(k)}=${esc(String(params[k]))}`)
    .join('&');
}

function httpJson(method, path, params, bodyForm) {
  return new Promise((resolve, reject) => {
    const isHttps = !!CFG.HTTPS;
    const lib = isHttps ? https : http;

    const query = params && Object.keys(params).length ? `?${toQuery(params)}` : '';
    const fullPath = `${buildBasePath()}${path}${query}`;

    const headers = {};
    let body = null;

    if (method === 'POST' && bodyForm) {
      body = toQuery(bodyForm);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const options = {
      hostname: CFG.HOST,
      port: CFG.PORT,
      path: fullPath,
      method,
      headers,
      timeout: CFG.TIMEOUT_MS
    };

    if (isHttps && CFG.IGNORE_TLS_ERRORS) {
      options.rejectUnauthorized = false;
    }

    const req = lib.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (!data) return reject(new Error(`Empty response for ${path}`));
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`Invalid JSON response for ${path}: ${e.message}; data=${data.slice(0, 300)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${CFG.TIMEOUT_MS}ms for ${path}`));
    });

    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

/*** =========================
 * Technitium API Wrapper
 * ========================= */
let token = (CFG.API_TOKEN && CFG.API_TOKEN.trim()) ? CFG.API_TOKEN.trim() : null;
let lastLoginAt = 0;

async function login() {
  if (CFG.API_TOKEN && CFG.API_TOKEN.trim()) {
    token = CFG.API_TOKEN.trim();
    return;
  }

  // /api/user/login?user=...&pass=...&includeInfo=true :contentReference[oaicite:5]{index=5}
  const params = {
    user: CFG.USER,
    pass: CFG.PASS,
    includeInfo: 'true'
  };
  if (CFG.TOTP && CFG.TOTP.trim()) params.totp = CFG.TOTP.trim();

  const res = await httpJson('GET', '/api/user/login', params);
  if (res.status !== 'ok' || !res.token) {
    throw new Error(res.errorMessage || `Login failed: status=${res.status}`);
  }
  token = res.token;
  lastLoginAt = Date.now();

  // optional: user info schreiben
  setStateIfChanged(`${CFG.ROOT}.info.username`, res.username || '', true);
  setStateIfChanged(`${CFG.ROOT}.info.displayName`, res.displayName || '', true);
  if (res.info && typeof res.info === 'object') {
    setStateIfChanged(`${CFG.ROOT}.info.serverVersion`, res.info.version || '', true);
    setStateIfChanged(`${CFG.ROOT}.info.dnsServerDomain`, res.info.dnsServerDomain || '', true);
    setStateIfChanged(`${CFG.ROOT}.info.uptimestamp`, res.info.uptimestamp || '', true);
  }
}

async function apiGet(path, params, retry = true) {
  if (!token) await login();
  const res = await httpJson('GET', `/api/${path}`, Object.assign({}, params || {}, { token }));

  // invalid-token ist ein offizieller Status :contentReference[oaicite:6]{index=6}
  if (res && res.status === 'invalid-token') {
    if (!CFG.API_TOKEN && retry) {
      token = null;
      await login();
      return apiGet(path, params, false);
    }
    throw new Error('API returned invalid-token');
  }

  if (!res || res.status !== 'ok') {
    throw new Error(res?.errorMessage || `API error: ${res?.status || 'unknown'}`);
  }
  return res;
}

/*** =========================
 * States anlegen
 * ========================= */
function initObjects() {
  ensureObject(CFG.ROOT, { type: 'device', common: { name: 'Technitium DNS Server' }, native: {} });
  ensureObject(`${CFG.ROOT}.info`, { type: 'channel', common: { name: 'Info' }, native: {} });
  ensureObject(`${CFG.ROOT}.settings`, { type: 'channel', common: { name: 'Settings (read)' }, native: {} });
  ensureObject(`${CFG.ROOT}.control`, { type: 'channel', common: { name: 'Control (write)' }, native: {} });
  ensureObject(`${CFG.ROOT}.raw`, { type: 'channel', common: { name: 'Raw JSON' }, native: {} });

  ensureState(`${CFG.ROOT}.info.connected`, { type: 'boolean', role: 'indicator.reachable', read: true, write: false }, false);
  ensureState(`${CFG.ROOT}.info.lastUpdate`, { type: 'string', role: 'date', read: true, write: false }, '');
  ensureState(`${CFG.ROOT}.info.lastError`, { type: 'string', role: 'text', read: true, write: false }, '');

  ensureState(`${CFG.ROOT}.info.username`, { type: 'string', role: 'text', read: true, write: false }, '');
  ensureState(`${CFG.ROOT}.info.displayName`, { type: 'string', role: 'text', read: true, write: false }, '');
  ensureState(`${CFG.ROOT}.info.serverVersion`, { type: 'string', role: 'text', read: true, write: false }, '');
  ensureState(`${CFG.ROOT}.info.dnsServerDomain`, { type: 'string', role: 'text', read: true, write: false }, '');
  ensureState(`${CFG.ROOT}.info.uptimestamp`, { type: 'string', role: 'text', read: true, write: false }, '');

  // Read: aktueller Serverzustand
  ensureState(`${CFG.ROOT}.settings.enableBlocking`, { type: 'boolean', role: 'switch', read: true, write: false }, false);

  // Write: Steuerung
  ensureState(`${CFG.ROOT}.control.enableBlocking`, { type: 'boolean', role: 'switch', read: true, write: true }, false);
  ensureState(`${CFG.ROOT}.control.flushCache`, { type: 'boolean', role: 'button', read: true, write: true }, false);
  ensureState(`${CFG.ROOT}.control.refresh`, { type: 'boolean', role: 'button', read: true, write: true }, false);

  // Optional: Dashboard Stats
  ensureState(`${CFG.ROOT}.raw.settingsJson`, { type: 'string', role: 'json', read: true, write: false }, '');
  ensureState(`${CFG.ROOT}.raw.dashboardStatsJson`, { type: 'string', role: 'json', read: true, write: false }, '');
}

/*** =========================
 * Polling
 * ========================= */
let pollTimer = null;
let pollBusy = false;

async function poll() {
  if (pollBusy) return;
  pollBusy = true;

  try {
    // 1) Settings holen: /api/settings/get :contentReference[oaicite:7]{index=7}
    const sRes = await apiGet('settings/get', {});
    const settings = sRes.response || {};

    setStateIfChanged(`${CFG.ROOT}.info.connected`, true, true);
    setStateIfChanged(`${CFG.ROOT}.info.lastUpdate`, nowIsoLocal(), true);
    setStateIfChanged(`${CFG.ROOT}.info.lastError`, '', true);

    if (settings.version) setStateIfChanged(`${CFG.ROOT}.info.serverVersion`, settings.version, true);
    if (settings.dnsServerDomain) setStateIfChanged(`${CFG.ROOT}.info.dnsServerDomain`, settings.dnsServerDomain, true);
    if (settings.uptimestamp) setStateIfChanged(`${CFG.ROOT}.info.uptimestamp`, settings.uptimestamp, true);

    const enableBlocking = !!settings.enableBlocking;
    setStateIfChanged(`${CFG.ROOT}.settings.enableBlocking`, enableBlocking, true);

    // Control-State (GUI-Schalter) auf Serverzustand zurücksyncen (ack=true)
    setStateIfChanged(`${CFG.ROOT}.control.enableBlocking`, enableBlocking, true);

    setStateIfChanged(`${CFG.ROOT}.raw.settingsJson`, settings, true);

    // 2) Optional Dashboard Stats: /api/dashboard/stats/get :contentReference[oaicite:8]{index=8}
    if (CFG.DASHBOARD_STATS_ENABLED) {
      const dRes = await apiGet('dashboard/stats/get', {
        type: CFG.DASHBOARD_STATS_TYPE,
        utc: CFG.DASHBOARD_STATS_UTC ? 'true' : 'false'
      });
      setStateIfChanged(`${CFG.ROOT}.raw.dashboardStatsJson`, dRes.response || {}, true);
    }
  } catch (e) {
    setStateIfChanged(`${CFG.ROOT}.info.connected`, false, true);
    setStateIfChanged(`${CFG.ROOT}.info.lastUpdate`, nowIsoLocal(), true);
    setStateIfChanged(`${CFG.ROOT}.info.lastError`, String(e?.message || e), true);
    logW(`Polling failed: ${e?.message || e}`);
  } finally {
    pollBusy = false;
  }
}

/*** =========================
 * Control Handler
 * ========================= */
async function setBlockingEnabled(enable) {
  // /api/settings/set?token=x&enableBlocking=true|false :contentReference[oaicite:9]{index=9}
  await apiGet('settings/set', { enableBlocking: enable ? 'true' : 'false' });

  // Nach erfolgreichem Set direkt neu poll'en (Serverzustand sauber übernehmen)
  await poll();
}

async function flushCache() {
  // /api/cache/flush?token=x :contentReference[oaicite:10]{index=10}
  await apiGet('cache/flush', {});
}

function wireControls() {
  on({ id: `${CFG.ROOT}.control.enableBlocking`, change: 'any' }, async (obj) => {
    if (!obj || obj.state.ack) return;
    const v = !!obj.state.val;

    try {
      logI(`Set enableBlocking -> ${v}`);
      await setBlockingEnabled(v);
    } catch (e) {
      logE(`Set enableBlocking failed: ${e?.message || e}`);
      // Revert: GUI-Schalter zurück auf Serverzustand (per poll)
      await poll();
    }
  });

  on({ id: `${CFG.ROOT}.control.flushCache`, change: 'any' }, async (obj) => {
    if (!obj || obj.state.ack) return;
    const pressed = !!obj.state.val;
    if (!pressed) return;

    try {
      logI('Flush cache requested');
      await flushCache();
    } catch (e) {
      logE(`Flush cache failed: ${e?.message || e}`);
    } finally {
      // Button zurücksetzen
      setStateIfChanged(`${CFG.ROOT}.control.flushCache`, false, true);
    }
  });

  on({ id: `${CFG.ROOT}.control.refresh`, change: 'any' }, async (obj) => {
    if (!obj || obj.state.ack) return;
    const pressed = !!obj.state.val;
    if (!pressed) return;

    try {
      logI('Manual refresh requested');
      await poll();
    } finally {
      setStateIfChanged(`${CFG.ROOT}.control.refresh`, false, true);
    }
  });
}

/*** =========================
 * Start
 * ========================= */
(function main() {
  initObjects();
  wireControls();

  // initial poll + interval
  setTimeout(() => poll().catch(e => logW(`Initial poll failed: ${e?.message || e}`)), 1500);

  pollTimer = setInterval(() => {
    poll().catch(e => logW(`Poll failed: ${e?.message || e}`));
  }, CFG.POLL_MS);

  onStop(() => {
    try { if (pollTimer) clearInterval(pollTimer); } catch { /* ignore */ }
  }, 1000);

  logI(`Started. Endpoint=${CFG.HTTPS ? 'https' : 'http'}://${CFG.HOST}:${CFG.PORT}${buildBasePath()} (poll ${CFG.POLL_MS}ms)`);
})();
