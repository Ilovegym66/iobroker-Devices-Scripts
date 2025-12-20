/***************************************************************
 * Technitium DNS Server – ioBroker Script-Adapter (v1.1)
 * Kompatibel mit ioBroker JavaScript Adapter 9.0.11
 *
 * Fixes ggü. v1.0:
 *  - kein setObjectNotExists (nutzt nur existsState + createState)
 *  - saubere Fehlermeldungen (keine Stack-Warn-Spam)
 *  - Blocking Toggle (enableBlocking) + Cache Flush + Refresh
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

  // WICHTIG: 127.0.0.1 funktioniert nur, wenn Technitium im gleichen Namespace läuft!
  HOST: '10.1.1.72',   // <-- anpassen!
  PORT: 5380,
  HTTPS: false,
  BASE_PATH: '',       // z.B. '/dns' falls Reverse Proxy; sonst ''

  IGNORE_TLS_ERRORS: false,

  // Auth: empfohlen API_TOKEN (nicht ablaufend)
  API_TOKEN: '',       // <-- eintragen (empfohlen)
  USER: 'admin',       // optional wenn kein API_TOKEN
  PASS: 'admin',
  TOTP: '',

  POLL_MS: 30_000,
  TIMEOUT_MS: 12_000,

  DASHBOARD_STATS_ENABLED: true,
  DASHBOARD_STATS_TYPE: 'LastHour',
  DASHBOARD_STATS_UTC: true
};

/*** =========================
 * Helpers
 * ========================= */
function logI(msg) { console.log(`[TechnitiumDNS] ${msg}`); }
function logW(msg) { console.warn(`[TechnitiumDNS] ${msg}`); }
function logE(msg) { console.error(`[TechnitiumDNS] ${msg}`); }

function existsDP(id) { try { return existsState(id); } catch { return false; } }

function ensureState(id, initial, common) {
  if (!existsDP(id)) {
    // createState signature in ioBroker JS unterstützt i.d.R. (id, initial, common)
    createState(id, initial, common || {});
  }
}

function safeGet(id) {
  try {
    if (!existsDP(id)) return null;
    const s = getState(id);
    return s ? s.val : null;
  } catch { return null; }
}

function setIfChanged(id, val, ack = true) {
  try {
    const s = existsDP(id) ? getState(id) : null;
    const oldVal = s ? s.val : undefined;
    const oldAck = s ? s.ack : undefined;

    // JSON/Object handling
    const isObj = val !== null && typeof val === 'object';
    const newVal = isObj ? JSON.stringify(val) : val;
    const curVal = isObj ? (typeof oldVal === 'string' ? oldVal : JSON.stringify(oldVal)) : oldVal;

    if (!s || curVal !== newVal || oldAck !== ack) {
      setState(id, newVal, ack);
    }
  } catch (e) {
    logW(`setIfChanged(${id}) failed: ${e?.message || e}`);
  }
}

function nowIsoLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/*** =========================
 * HTTP Client (ohne axios)
 * ========================= */
const http = require('http');
const https = require('https');

function basePath() {
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
    const fullPath = `${basePath()}${path}${query}`;

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

    if (isHttps && CFG.IGNORE_TLS_ERRORS) options.rejectUnauthorized = false;

    const req = lib.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (!data) return reject(new Error(`Empty response for ${path}`));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON for ${path}: ${e.message}; data=${data.slice(0,200)}`)); }
      });
    });

    req.on('timeout', () => req.destroy(new Error(`Timeout after ${CFG.TIMEOUT_MS}ms for ${path}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/*** =========================
 * Technitium API
 * ========================= */
let token = (CFG.API_TOKEN && CFG.API_TOKEN.trim()) ? CFG.API_TOKEN.trim() : null;

async function login() {
  if (CFG.API_TOKEN && CFG.API_TOKEN.trim()) {
    token = CFG.API_TOKEN.trim();
    return;
  }
  const params = { user: CFG.USER, pass: CFG.PASS, includeInfo: 'true' };
  if (CFG.TOTP && CFG.TOTP.trim()) params.totp = CFG.TOTP.trim();

  const res = await httpJson('GET', '/api/user/login', params);
  if (res.status !== 'ok' || !res.token) {
    throw new Error(res.errorMessage || `Login failed: status=${res.status}`);
  }
  token = res.token;

  setIfChanged(`${CFG.ROOT}.info.username`, res.username || '', true);
  setIfChanged(`${CFG.ROOT}.info.displayName`, res.displayName || '', true);

  const info = res.info || {};
  setIfChanged(`${CFG.ROOT}.info.serverVersion`, info.version || '', true);
  setIfChanged(`${CFG.ROOT}.info.dnsServerDomain`, info.dnsServerDomain || '', true);
  setIfChanged(`${CFG.ROOT}.info.uptimestamp`, info.uptimestamp || '', true);
}

async function apiGet(path, params, retry = true) {
  if (!token) await login();
  const res = await httpJson('GET', `/api/${path}`, Object.assign({}, params || {}, { token }));

  if (res && res.status === 'invalid-token') {
    // nur bei USER/PASS re-login versuchen
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
function initStates() {
  ensureState(`${CFG.ROOT}.info.connected`, false, { type: 'boolean', role: 'indicator.reachable', read: true, write: false });
  ensureState(`${CFG.ROOT}.info.lastUpdate`, '', { type: 'string', role: 'date', read: true, write: false });
  ensureState(`${CFG.ROOT}.info.lastError`, '', { type: 'string', role: 'text', read: true, write: false });

  ensureState(`${CFG.ROOT}.info.username`, '', { type: 'string', role: 'text', read: true, write: false });
  ensureState(`${CFG.ROOT}.info.displayName`, '', { type: 'string', role: 'text', read: true, write: false });
  ensureState(`${CFG.ROOT}.info.serverVersion`, '', { type: 'string', role: 'text', read: true, write: false });
  ensureState(`${CFG.ROOT}.info.dnsServerDomain`, '', { type: 'string', role: 'text', read: true, write: false });
  ensureState(`${CFG.ROOT}.info.uptimestamp`, '', { type: 'string', role: 'text', read: true, write: false });

  ensureState(`${CFG.ROOT}.settings.enableBlocking`, false, { type: 'boolean', role: 'switch', read: true, write: false });

  ensureState(`${CFG.ROOT}.control.enableBlocking`, false, { type: 'boolean', role: 'switch', read: true, write: true });
  ensureState(`${CFG.ROOT}.control.flushCache`, false, { type: 'boolean', role: 'button', read: true, write: true });
  ensureState(`${CFG.ROOT}.control.refresh`, false, { type: 'boolean', role: 'button', read: true, write: true });

  ensureState(`${CFG.ROOT}.raw.settingsJson`, '', { type: 'string', role: 'json', read: true, write: false });
  ensureState(`${CFG.ROOT}.raw.dashboardStatsJson`, '', { type: 'string', role: 'json', read: true, write: false });
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
    const sRes = await apiGet('settings/get', {});
    const settings = sRes.response || {};

    setIfChanged(`${CFG.ROOT}.info.connected`, true, true);
    setIfChanged(`${CFG.ROOT}.info.lastUpdate`, nowIsoLocal(), true);
    setIfChanged(`${CFG.ROOT}.info.lastError`, '', true);

    if (settings.version) setIfChanged(`${CFG.ROOT}.info.serverVersion`, settings.version, true);
    if (settings.dnsServerDomain) setIfChanged(`${CFG.ROOT}.info.dnsServerDomain`, settings.dnsServerDomain, true);
    if (settings.uptimestamp) setIfChanged(`${CFG.ROOT}.info.uptimestamp`, settings.uptimestamp, true);

    const enableBlocking = !!settings.enableBlocking;
    setIfChanged(`${CFG.ROOT}.settings.enableBlocking`, enableBlocking, true);
    setIfChanged(`${CFG.ROOT}.control.enableBlocking`, enableBlocking, true);

    setIfChanged(`${CFG.ROOT}.raw.settingsJson`, settings, true);

    if (CFG.DASHBOARD_STATS_ENABLED) {
      const dRes = await apiGet('dashboard/stats/get', {
        type: CFG.DASHBOARD_STATS_TYPE,
        utc: CFG.DASHBOARD_STATS_UTC ? 'true' : 'false'
      });
      setIfChanged(`${CFG.ROOT}.raw.dashboardStatsJson`, dRes.response || {}, true);
    }
  } catch (e) {
    setIfChanged(`${CFG.ROOT}.info.connected`, false, true);
    setIfChanged(`${CFG.ROOT}.info.lastUpdate`, nowIsoLocal(), true);
    setIfChanged(`${CFG.ROOT}.info.lastError`, String(e?.message || e), true);
    logW(`Polling failed: ${e?.message || e}`);
  } finally {
    pollBusy = false;
  }
}

/*** =========================
 * Control
 * ========================= */
async function setBlockingEnabled(enable) {
  await apiGet('settings/set', { enableBlocking: enable ? 'true' : 'false' });
  await poll();
}

async function flushCache() {
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
      await poll();
    }
  });

  on({ id: `${CFG.ROOT}.control.flushCache`, change: 'any' }, async (obj) => {
    if (!obj || obj.state.ack) return;
    if (!obj.state.val) return;

    try {
      logI('Flush cache requested');
      await flushCache();
    } catch (e) {
      logE(`Flush cache failed: ${e?.message || e}`);
    } finally {
      setIfChanged(`${CFG.ROOT}.control.flushCache`, false, true);
    }
  });

  on({ id: `${CFG.ROOT}.control.refresh`, change: 'any' }, async (obj) => {
    if (!obj || obj.state.ack) return;
    if (!obj.state.val) return;

    try {
      logI('Manual refresh requested');
      await poll();
    } finally {
      setIfChanged(`${CFG.ROOT}.control.refresh`, false, true);
    }
  });
}

/*** =========================
 * Start
 * ========================= */
(function main() {
  initStates();
  wireControls();

  setTimeout(() => poll().catch(e => logW(`Initial poll failed: ${e?.message || e}`)), 1500);

  pollTimer = setInterval(() => {
    poll().catch(e => logW(`Poll failed: ${e?.message || e}`));
  }, CFG.POLL_MS);

  onStop(() => {
    try { if (pollTimer) clearInterval(pollTimer); } catch { /* ignore */ }
  }, 1000);

  logI(`Started. Endpoint=${CFG.HTTPS ? 'https' : 'http'}://${CFG.HOST}:${CFG.PORT}${basePath()} (poll ${CFG.POLL_MS}ms)`);
})();

