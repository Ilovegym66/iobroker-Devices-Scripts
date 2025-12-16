// LG ThinQ Adapter-Ersatz – ThinQ Connect (PAT v10)
// (c) ilovegym66 https://github.com/Ilovegym66
// Focus: stable 
// Features:
//  - device mapping & control handler extended
//  - Login via ThinQ Connect PAT
//  - /devices + /devices/{id}/state Polling
//  - for every device: Devices.<id>.control.rawJson -> POST /devices/{id}/control
//
// mapping:
//
//  DEVICE_REFRIGERATOR :
//    state.fridge.tempFridgeC/F, tempFreezerC/F
//    state.fridge.expressMode, expressFridge, expressModeName
//    state.fridge.doorMainOpen, doorMainState
//    state.fridge.waterFilterUsedTime, waterFilterState
//
//  DEVICE_WASHER :
//    state.washer.runState, isOn
//    state.washer.remoteControlEnabled
//    state.washer.remainHour/Minute/Minutes
//    state.washer.totalHour/Minute/Minutes
//    state.washer.cycleCount
//
//  DEVICE_DRYER :
//    state.dryer.runState, isOn
//    state.dryer.remoteControlEnabled
//    state.dryer.remainHour/Minute/Minutes
//    state.dryer.totalHour/Minute/Minutes
//
// Config (in objectstree):
//   0_userdata.0.Geraete.LGThinQ.Config.mode = "pat"
//   0_userdata.0.Geraete.LGThinQ.Config.pat  = <PAT>
//   0_userdata.0.Geraete.LGThinQ.Config.countryCode = "DE"
//   0_userdata.0.Geraete.LGThinQ.Config.clientId    = "" (automatic)
//   0_userdata.0.Geraete.LGThinQ.Config.pollIntervalSec = 60

const https = require('https');
const crypto = require('crypto');

const ROOT = '0_userdata.0.Geraete.LGThinQ'; // base states 
const DEV_ROOT = ROOT + '.Devices';
const API_KEY = 'place your apikey here';

/* ========= Helpers ========= */

function logInfo(m)  { log('[LGThinQ] ' + m, 'info'); }
function logWarn(m)  { log('[LGThinQ] ' + m, 'warn'); }
function logError(m) { log('[LGThinQ] ' + m, 'error'); }

function objExists(id) {
    try { return getObject(id) != null; } catch (e) { return false; }
}

function safeCreateState(id, def, common) {
    try {
        if (!objExists(id)) {
            const parts = id.split('.');
            const name = parts[parts.length - 1];
            createState(id, def, Object.assign({
                name: name,
                read: true,
                write: true
            }, common || {}));
        }
    } catch (e) {
        logWarn('createState Fehler bei ' + id + ': ' + e.message);
    }
}

function safeSetState(id, val, ack) {
    try {
        if (!objExists(id)) return; // Nur setzen, wenn es existiert
        setState(id, val, ack);
    } catch (e) {
        logWarn('setState Fehler bei ' + id + ': ' + e.message);
    }
}

function getSafe(id, def) {
    try {
        const s = getState(id);
        return (s && s.val !== undefined) ? s.val : def;
    } catch (e) {
        return def;
    }
}

function generateMessageId() {
    return crypto.randomBytes(16)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function generateClientId() {
    // strikt UUID v4
    if (crypto.randomUUID) return crypto.randomUUID();
    // Fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}


function getRegionFromCountry(country) {
    country = String(country || '').toUpperCase();
    const KIC = ['AU','BD','CN','HK','ID','IN','JP','KH','KR','LA','LK','MM','MY','NP','NZ','PH','SG','TH','TW','VN'];
    const AIC = ['AG','AR','AW','BB','BO','BR','BS','BZ','CA','CL','CO','CR','CU','DM','DO','EC','GD','GT','GY','HN','HT',
                 'JM','KN','LC','MX','NI','PA','PE','PR','PY','SR','SV','TT','US','UY','VC','VE'];
    if (KIC.indexOf(country) !== -1) return 'kic';
    if (AIC.indexOf(country) !== -1) return 'aic';
    return 'eic';
}

function firstDefined() {
    for (let i = 0; i < arguments.length; i++) {
        const v = arguments[i];
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
}
function setHeaderModeActive(mode) {
    HEADER_MODE_ACTIVE = mode;
    try { setState(ROOT + '.Info.headerModeActive', mode, true); } catch(e) {}
}

function getHeaderModeConfigured() {
    const m = String(getSafe(ROOT + '.Config.headerMode', 'auto')).toLowerCase();
    if (m === 'legacy' || m === 'modern') return m;
    return 'auto';
}

// ----- Control States 
function ensureControlStates(deviceId, deviceType) {
    const base = `${DEV_ROOT}.${deviceId}.control`;
    safeCreateState(base, null, { type: 'folder' });

    // frei definierbares JSON → POST /devices/{id}/control
    safeCreateState(`${base}.rawJson`, '', { type:'string', read:true, write:true, name:'Control JSON' });

    // einfache Kommandos
    safeCreateState(`${base}.command`, '', {
        type:'string', read:true, write:true,
        states: { 'start':'start','pause':'pause','resume':'resume','stop':'stop' },
        name:'Einfaches Kommando'
    });

    // Programme
    safeCreateState(`${base}.programKey`, '', { type:'string', read:true, write:true, name:'Programm-Key' });
    safeCreateState(`${base}.sendProgram`, false, { type:'boolean', read:true, write:true, name:'Programm senden' });

    // Ergebnis/Fehler
    safeCreateState(`${base}.result`, '', { type:'string', read:true, write:false });
    safeCreateState(`${base}.lastError`, '', { type:'string', read:true, write:false });

    // Beispiele als Vorlage (du kannst diese Strings in rawJson kopieren und anpassen)
    safeCreateState(`${base}.examples.start`, '{"operation":{"start":true}}', { type:'string', read:true, write:false });
    safeCreateState(`${base}.examples.pause`, '{"operation":{"pause":true}}', { type:'string', read:true, write:false });
    safeCreateState(`${base}.examples.resume`, '{"operation":{"resume":true}}', { type:'string', read:true, write:false });
    safeCreateState(`${base}.examples.stop`, '{"operation":{"stop":true}}', { type:'string', read:true, write:false });
    // Beispiel Programmauswahl – passe "program" / "course" / "key" nach deinem Modell an:
    safeCreateState(`${base}.examples.program`, '{"operation":{"program":"Cotton"}}', { type:'string', read:true, write:false });
}

async function sendControlPayload(cfg, deviceId, payload) {
    // Primär: neuer Control-Weg (dein thinqRequest + x-conditional-control)
    const ep = `devices/${encodeURIComponent(deviceId)}/control`;
    const extra = { 'x-conditional-control':'true' };
    const res = await thinqRequest(cfg, 'POST', ep, payload, extra);
    return res;
}

function parseMaybeJson(v){
    if (v == null) return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(String(v)); } catch { return null; }
}

// Baut einfache Standardpayloads. Wenn sie bei deinem Modell nicht greifen:
// nutze rawJson (frei) oder passe hier die Keys an.
function buildSimpleCommandPayload(deviceType, cmd){
    // bewusst generisch gehalten – manche Backends erwarten booleans, andere Strings
    const op = {};
    if (cmd === 'start')  op.start  = true;
    if (cmd === 'pause')  op.pause  = true;
    if (cmd === 'resume') op.resume = true;
    if (cmd === 'stop')   op.stop   = true;
    return { operation: op };
}

function buildProgramPayload(deviceType, programKey){
    // passe Schlüssel an dein Modell an (z.B. "program", "course", "courseId" etc.)
    return { operation: { program: String(programKey||'').trim() } };
}

function ensureModelInfoStates(deviceId) {
  const base = `${DEV_ROOT}.${deviceId}.model`;
  safeCreateState(base, null, { type:'folder' });
  safeCreateState(`${base}.raw`, '', { type:'string', read:true, write:false });
  safeCreateState(`${base}.programs.json`, '', { type:'string', read:true, write:false });
  safeCreateState(`${base}.programs.list`, '', { type:'string', read:true, write:false });
  safeCreateState(`${base}.lastError`, '', { type:'string', read:true, write:false });

  // Steuerungs-seitig: Mapping und Dropdown-State
  safeCreateState(`${DEV_ROOT}.${deviceId}.control.programMap`, '', { type:'string', read:true, write:false });
  safeCreateState(`${DEV_ROOT}.${deviceId}.control.programKeyEnum`, '', { 
    type:'string', read:true, write:true, name:'Programm (Dropdown)'
  });
}

// common.states (Enum) dynamisch setzen/aktualisieren
function setEnumStates(id, statesObj) {
  try {
    const o = getObject(id) || { type:'state', common:{}, native:{} };
    o.common = Object.assign({}, o.common, { states: statesObj || {} });
    setObject(id, o);
  } catch (e) {
    logWarn(`Enum-States setzen fehlgeschlagen (${id}): ${e.message}`);
  }
}

// ----- Run-State nach Deutsch mappen -----
const RUN_TEXT = {
  'POWER_OFF':'Aus','OFF':'Aus','POWEROFF':'Aus',
  'STANDBY':'Bereit','READY':'Bereit','IDLE':'Bereit','INITIAL':'Bereit',
  'DETECTING':'Erkennung','RUNNING':'Läuft','WASH':'Waschen','RINSE':'Spülen','SPIN':'Schleudern',
  'DRY':'Trocknen','COOLING':'Abkühlen',
  'PAUSE':'Pause','END':'Fertig','FINISH':'Fertig','COMPLETED':'Fertig','DONE':'Fertig',
  'ERROR':'Fehler'
};
function runText(code){
  const c = String(code||'').toUpperCase();
  return RUN_TEXT[c] || c || '—';
}
function clampPct(x){ x = Number(x)||0; if (x<0) return 0; if (x>100) return 100; return Math.round(x); }

/* ========= Config-States ========= */

safeCreateState(ROOT + '.Config.mode', 'pat', { type: 'string' });
safeCreateState(ROOT + '.Config.pat', '', { type: 'string' });
safeCreateState(ROOT + '.Config.countryCode', 'DE', { type: 'string' });
safeCreateState(ROOT + '.Config.clientId', '', { type: 'string' });
safeCreateState(ROOT + '.Config.pollIntervalSec', 60, { type: 'number' });
safeCreateState(ROOT + '.Config.language', 'de-DE', { type: 'string' });
// --- Header-Handling ---
safeCreateState(ROOT + '.Config.headerMode', 'auto', { type: 'string' }); // 'auto' | 'legacy' | 'modern'
safeCreateState(ROOT + '.Info.headerModeActive', 'auto', { type: 'string', read: true, write: false });

safeCreateState(ROOT + '.Info.started', false, { type: 'boolean', read: true, write: false });
safeCreateState(ROOT + '.Info.lastPollTs', '', { type: 'string', read: true, write: false });
safeCreateState(ROOT + '.Info.lastError', '', { type: 'string', read: true, write: false });

/* ========= ThinQ Request ========= */
async function thinqRequest(cfg, method, endpoint, body, extraHeaders) {
    const dataStr = body ? JSON.stringify(body) : null;
    const hostname = 'api-' + cfg.region + '.lgthinq.com';
    const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const lang = String(getSafe(ROOT + '.Config.language', 'de-DE')) || 'de-DE';

    function doReq(hdrs, tag) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname,
                port: 443,
                path,
                method: method || 'GET',
                headers: hdrs
            };
            const req = https.request(options, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    const ok = res.statusCode >= 200 && res.statusCode < 300;
                    let json = null;
                    try { json = data ? JSON.parse(data) : {}; } catch {}
                    if (ok) {
                        resolve((json && json.response !== undefined) ? json.response : (json || {}));
                        return;
                    }
                    const errObj = (json && json.error) ? json.error : {};
                    const code   = String(errObj.code || '');
                    const msg    = String(errObj.message || data || '');
                    const e = new Error(`HTTP ${res.statusCode}: ${msg}`);
                    e.statusCode = res.statusCode; e.apiCode = code; e.body = data;
                    reject(e);
                });
            });
            req.on('error', err => reject(err));
            if (dataStr) req.write(dataStr);
            req.end();
        });
    }

    const msgId = generateMessageId();

    // Modern (H1)
    const H1 = Object.assign({
        'Authorization': 'Bearer ' + cfg.pat,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': lang,

        'x-api-key': API_KEY,
        'x-client-id': cfg.clientId,
        'x-message-id': msgId,
        'x-correlation-id': msgId,

        'x-country-code': cfg.countryCode,
        'x-language-code': lang,

        'x-service-code': 'SVC202',
        'x-service-phase': 'OP',
        'x-origin': 'thinq-connect',

        'User-Agent': 'ioBroker-LGThinQ/9 (NodeJS)',
        'Connection': 'keep-alive'
    }, extraHeaders || {});

    // Legacy (H2)
    const H2 = Object.assign({}, H1, {
        'x-country': cfg.countryCode
    });
    delete H2['x-country-code'];
    delete H2['x-language-code'];
    delete H2['x-service-code'];   // ältere Gateways sind pingelig: weniger ist mehr
    delete H2['x-service-phase'];
    delete H2['x-origin'];
    delete H2['x-correlation-id'];

    // Minimal (H3) – nur im echten Notfall
    const H3 = {
        'Authorization': 'Bearer ' + cfg.pat,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': lang,
        'x-api-key': API_KEY,
        'x-client-id': cfg.clientId,
        'x-message-id': msgId,
        'x-country': cfg.countryCode,
        'User-Agent': 'ioBroker-LGThinQ/9 (NodeJS)'
    };

    const configured = getHeaderModeConfigured();
    let mode = HEADER_MODE_ACTIVE || configured;

    // 1) Wenn explizit konfiguriert → ohne Fallback
    if (configured === 'legacy') {
        return await doReq(H2, 'H2');
    }
    if (configured === 'modern') {
        return await doReq(H1, 'H1');
    }

    // 2) AUTO: erst H1, bei "Missing Headers/Policy" dauerhaft auf H2 umschalten
    try {
        const out = await doReq(H1, 'H1');
        // Erfolg → auf modern bleiben
        if (mode !== 'modern') setHeaderModeActive('modern');
        return out;
    } catch (e1) {
        const policyLike = (e1.statusCode === 400 || e1.statusCode === 401 ||
                            e1.apiCode === '1309' || e1.apiCode === '1200' || e1.apiCode === '1107' ||
                            /missing headers/i.test(String(e1.message||'')));
        if (!policyLike) throw e1;

        if (!FALLBACK_LOGGED) {
            logWarn('[LGThinQ] Gateway verlangt Legacy-Header. Wechsel auf H2 (wird für diese Session beibehalten).');
            FALLBACK_LOGGED = true;
        }
        setHeaderModeActive('legacy');

        try {
            return await doReq(H2, 'H2');
        } catch (e2) {
            const stillMissing = (e2.statusCode === 400 && /missing/i.test(String(e2.message||'')));
            if (!stillMissing) throw e2;
            // Letzter Versuch
            return await doReq(H3, 'H3');
        }
    }
}


/* ========= Geräte-Basis ========= */

let pollTimer = null;
let knownDevices = [];
let HEADER_MODE_ACTIVE = 'auto';      // 'auto' | 'legacy' | 'modern' (Session)
let FALLBACK_LOGGED = false;          // Fallback-Hinweis nur einmal
const backoffUntilByDevice = Object.create(null); // deviceId -> timestamp (ms)

function ensureDeviceBaseStates(dev) {
    const id = dev.deviceId;
    const info = dev.deviceInfo || {};
    const base = DEV_ROOT + '.' + id;

    safeCreateState(base, null, { type: 'folder' });
    safeCreateState(base + '.alias', info.alias || '', { type: 'string', read: true, write: false });
    safeCreateState(base + '.deviceType', info.deviceType || '', { type: 'string', read: true, write: false });
    safeCreateState(base + '.modelName', info.modelName || '', { type: 'string', read: true, write: false });
    safeCreateState(base + '.online', !!info.reportable, { type: 'boolean', read: true, write: false });
    safeCreateState(base + '.raw', JSON.stringify(dev), { type: 'string', read: true, write: false });

    safeCreateState(base + '.state.raw', '', { type: 'string', read: true, write: false });
    safeCreateState(base + '.state.online', true, { type: 'boolean', read: true, write: false });
    safeCreateState(base + '.state.summary', '', { type: 'string', read: true, write: false });

    safeCreateState(base + '.control.rawJson', '', {
        name: 'Payload -> /devices/{id}/control',
        type: 'string',
        read: true,
        write: true
    });
    ensureControlStates(id, info.deviceType || '');

    safeSetState(base + '.alias', info.alias || '', true);
    safeSetState(base + '.deviceType', info.deviceType || '', true);
    safeSetState(base + '.modelName', info.modelName || '', true);
    safeSetState(base + '.online', !!info.reportable, true);
    safeSetState(base + '.raw', JSON.stringify(dev), true);
}

/* ========= Mapping: Kühlschrank ========= */

function mapFridgeState(deviceId, state) {
    const base = DEV_ROOT + '.' + deviceId + '.state';
    try {
        if (!state || typeof state !== 'object') return;

        safeCreateState(base + '.fridge.tempFridgeC', null, { type: 'number', read: true, write: false });
        safeCreateState(base + '.fridge.tempFreezerC', null, { type: 'number', read: true, write: false });
        safeCreateState(base + '.fridge.tempFridgeF', null, { type: 'number', read: true, write: false });
        safeCreateState(base + '.fridge.tempFreezerF', null, { type: 'number', read: true, write: false });

        safeCreateState(base + '.fridge.expressMode', false, { type: 'boolean', read: true, write: false });
        safeCreateState(base + '.fridge.expressFridge', false, { type: 'boolean', read: true, write: false });
        safeCreateState(base + '.fridge.expressModeName', '', { type: 'string', read: true, write: false });

        safeCreateState(base + '.fridge.doorMainOpen', false, { type: 'boolean', read: true, write: false });
        safeCreateState(base + '.fridge.doorMainState', '', { type: 'string', read: true, write: false });

        safeCreateState(base + '.fridge.waterFilterUsedTime', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.fridge.waterFilterState', '', { type: 'string', read: true, write: false });

        let fC = null, frC = null, fF = null, frF = null;

        if (Array.isArray(state.temperature)) {
            state.temperature.forEach(function(t) {
                if (t.locationName === 'FRIDGE'  && t.targetTemperature !== undefined) fC  = t.targetTemperature;
                if (t.locationName === 'FREEZER' && t.targetTemperature !== undefined) frC = t.targetTemperature;
            });
        }
        if (Array.isArray(state.temperatureInUnits)) {
            state.temperatureInUnits.forEach(function(t) {
                if (t.locationName === 'FRIDGE') {
                    if (t.targetTemperatureC !== undefined) fC = t.targetTemperatureC;
                    if (t.targetTemperatureF !== undefined) fF = t.targetTemperatureF;
                }
                if (t.locationName === 'FREEZER') {
                    if (t.targetTemperatureC !== undefined) frC = t.targetTemperatureC;
                    if (t.targetTemperatureF !== undefined) frF = t.targetTemperatureF;
                }
            });
        }

        if (fC  !== null) safeSetState(base + '.fridge.tempFridgeC',  Number(fC),  true);
        if (frC !== null) safeSetState(base + '.fridge.tempFreezerC', Number(frC), true);
        if (fF  !== null) safeSetState(base + '.fridge.tempFridgeF',  Number(fF),  true);
        if (frF !== null) safeSetState(base + '.fridge.tempFreezerF', Number(frF), true);

        const refr = state.refrigeration || {};
        if (typeof refr.expressMode === 'boolean')
            safeSetState(base + '.fridge.expressMode', refr.expressMode, true);
        if (typeof refr.expressFridge === 'boolean')
            safeSetState(base + '.fridge.expressFridge', refr.expressFridge, true);
        if (refr.expressModeName !== undefined)
            safeSetState(base + '.fridge.expressModeName', String(refr.expressModeName), true);

        if (Array.isArray(state.doorStatus) && state.doorStatus.length > 0) {
            const main = state.doorStatus.find(function(d){ return d.locationName === 'MAIN'; }) || state.doorStatus[0];
            if (main && main.doorState !== undefined) {
                const open = String(main.doorState).toUpperCase() !== 'CLOSE';
                safeSetState(base + '.fridge.doorMainOpen', open, true);
                safeSetState(base + '.fridge.doorMainState', String(main.doorState), true);
            }
        }

        if (state.waterFilterInfo) {
            const w = state.waterFilterInfo;
            if (w.usedTime !== undefined)
                safeSetState(base + '.fridge.waterFilterUsedTime', Number(w.usedTime), true);
            if (w.waterFilterState !== undefined)
                safeSetState(base + '.fridge.waterFilterState', String(w.waterFilterState), true);
        }

    } catch (e) {
        logWarn('mapFridgeState Fehler (' + deviceId + '): ' + e.message);
    }
}

/* ========= Mapping: Waschmaschine ========= */

function mapWasherState(deviceId, state) {
  const base = DEV_ROOT + '.' + deviceId + '.state';
  try {
    const s = Array.isArray(state) ? (state[0] || {}) : (state || {});
    if (!s || typeof s !== 'object') return;

    // Basis-Objekte
    safeCreateState(base + '.washer.runState', '',   { type:'string',  read:true, write:false });
    safeCreateState(base + '.washer.stateText','',   { type:'string',  read:true, write:false });
    safeCreateState(base + '.washer.isOn', false,    { type:'boolean', read:true, write:false });
    safeCreateState(base + '.washer.isRunning',false,{ type:'boolean', read:true, write:false });
    safeCreateState(base + '.washer.finished',false, { type:'boolean', read:true, write:false });

    safeCreateState(base + '.washer.remainHour', 0,  { type:'number',  read:true, write:false });
    safeCreateState(base + '.washer.remainMinute',0, { type:'number',  read:true, write:false });
    safeCreateState(base + '.washer.remainMinutes',0,{ type:'number',  read:true, write:false });
    safeCreateState(base + '.washer.remainSec',  0,  { type:'number',  read:true, write:false });
    safeCreateState(base + '.washer.totalHour',  0,  { type:'number',  read:true, write:false });
    safeCreateState(base + '.washer.totalMinute',0,  { type:'number',  read:true, write:false });
    safeCreateState(base + '.washer.totalMinutes',0, { type:'number',  read:true, write:false });
    safeCreateState(base + '.washer.initMinutes', 0, { type:'number',  read:true, write:false });

    safeCreateState(base + '.washer.progressPct',0,  { type:'number',  read:true, write:false });
    safeCreateState(base + '.washer.eta','',         { type:'string',  read:true, write:false });

    // Optional (falls geliefert)
    safeCreateState(base + '.washer.programName','', { type:'string',  read:true, write:false });
    safeCreateState(base + '.washer.temp','',        { type:'string',  read:true, write:false });
    safeCreateState(base + '.washer.spin','',        { type:'string',  read:true, write:false });

    safeCreateState(base + '.washer.remoteControlEnabled', false, { type:'boolean', read:true, write:false });
    safeCreateState(base + '.washer.cycleCount', 0,          { type:'number',  read:true, write:false });

    const run = s.runState || {};
    const rc  = s.remoteControlEnable || {};
    const t   = s.timer || {};
    const cyc = s.cycle || {};

    const current   = String(run.currentState || '').toUpperCase();
    const humanText = runText(current);
    const isOn      = !!(current && current !== 'POWER_OFF');

    const rH = Number(firstDefined(t.remainHour, 0));
    const rM = Number(firstDefined(t.remainMinute, 0));
    const tH = Number(firstDefined(t.totalHour, 0));
    const tM = Number(firstDefined(t.totalMinute, 0));

    const remainMin = rH*60 + rM;
    const totalMin  = tH*60 + tM;
    const remainSec = remainMin * 60;

    // Fortschritt + ETA
    let progress = 0;
    if (totalMin > 0) progress = clampPct(100 * (totalMin - remainMin) / totalMin);
    const etaStr = remainSec>0 ? new Date(Date.now()+remainSec*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';

    const isRunning =
      (current && /RUN|WASH|RINSE|SPIN|DETECT|DRY|COOL/i.test(current)) ||
      (remainMin > 0);
    const finished =
      /END|FINISH|COMPLETED|DONE/i.test(current) ||
      (totalMin>0 && remainMin===0 && !isRunning);

    // Schreiben
    safeSetState(base + '.washer.runState', current, true);
    safeSetState(base + '.washer.stateText', humanText, true);
    safeSetState(base + '.washer.isOn', isOn, true);
    safeSetState(base + '.washer.isRunning', !!isRunning, true);
    safeSetState(base + '.washer.finished', !!finished, true);

    safeSetState(base + '.washer.remainHour', rH, true);
    safeSetState(base + '.washer.remainMinute', rM, true);
    safeSetState(base + '.washer.remainMinutes', remainMin, true);
    safeSetState(base + '.washer.remainSec', remainSec, true);
    safeSetState(base + '.washer.totalHour', tH, true);
    safeSetState(base + '.washer.totalMinute', tM, true);
    safeSetState(base + '.washer.totalMinutes', totalMin, true);
    safeSetState(base + '.washer.initMinutes', totalMin, true);

    safeSetState(base + '.washer.progressPct', progress, true);
    safeSetState(base + '.washer.eta', etaStr, true);

    if (typeof rc.remoteControlEnabled === 'boolean')
      safeSetState(base + '.washer.remoteControlEnabled', rc.remoteControlEnabled, true);
    if (cyc.cycleCount !== undefined)
      safeSetState(base + '.washer.cycleCount', Number(cyc.cycleCount), true);

    // Optionale Felder erkennen (erscheinen häufig erst im Lauf)
    // Programm
    const programName = firstDefined(
      s.program && s.program.name,
      s.program,
      s.course && s.course.name,
      s.course && s.course.courseName,
      s.course
    );
    if (programName !== undefined) safeSetState(base + '.washer.programName', String(programName), true);

    // Temperatur
    const tempVal = firstDefined(
      s.temperature && s.temperature.value,
      s.temp && s.temp.value,
      s.temp,
      (s.options && s.options.temperature)
    );
    if (tempVal !== undefined) safeSetState(base + '.washer.temp', String(tempVal), true);

    // Schleudern
    const spinVal = firstDefined(
      s.spin && s.spin.value,
      s.spin,
      (s.options && s.options.spin)
    );
    if (spinVal !== undefined) safeSetState(base + '.washer.spin', String(spinVal), true);

  } catch (e) {
    logWarn('mapWasherState Fehler (' + deviceId + '): ' + e.message);
  }
}


/* ========= Mapping: Trockner ========= */

function mapDryerState(deviceId, state) {
  const base = DEV_ROOT + '.' + deviceId + '.state';
  try {
    const s = state || {};
    if (!s || typeof s !== 'object') return;

    // Basis-Objekte
    safeCreateState(base + '.dryer.runState', '',   { type:'string',  read:true, write:false });
    safeCreateState(base + '.dryer.stateText','',   { type:'string',  read:true, write:false });
    safeCreateState(base + '.dryer.isOn', false,    { type:'boolean', read:true, write:false });
    safeCreateState(base + '.dryer.isRunning',false,{ type:'boolean', read:true, write:false });
    safeCreateState(base + '.dryer.finished',false, { type:'boolean', read:true, write:false });

    safeCreateState(base + '.dryer.remainHour', 0,  { type:'number',  read:true, write:false });
    safeCreateState(base + '.dryer.remainMinute',0, { type:'number',  read:true, write:false });
    safeCreateState(base + '.dryer.remainMinutes',0,{ type:'number',  read:true, write:false });
    safeCreateState(base + '.dryer.remainSec',  0,  { type:'number',  read:true, write:false });
    safeCreateState(base + '.dryer.totalHour',  0,  { type:'number',  read:true, write:false });
    safeCreateState(base + '.dryer.totalMinute',0,  { type:'number',  read:true, write:false });
    safeCreateState(base + '.dryer.totalMinutes',0, { type:'number',  read:true, write:false });
    safeCreateState(base + '.dryer.initMinutes', 0, { type:'number',  read:true, write:false });

    safeCreateState(base + '.dryer.progressPct',0,  { type:'number',  read:true, write:false });
    safeCreateState(base + '.dryer.eta','',         { type:'string',  read:true, write:false });

    // Optional
    safeCreateState(base + '.dryer.programName','', { type:'string',  read:true, write:false });
    safeCreateState(base + '.dryer.dryLevel','',    { type:'string',  read:true, write:false });

    safeCreateState(base + '.dryer.remoteControlEnabled', false, { type:'boolean', read:true, write:false });

    const run = s.runState || {};
    const rc  = s.remoteControlEnable || {};
    const t   = s.timer || {};

    const current   = String(run.currentState || '').toUpperCase();
    const humanText = runText(current);
    const isOn      = !!(current && current !== 'POWER_OFF');

    const rH = Number(firstDefined(t.remainHour, 0));
    const rM = Number(firstDefined(t.remainMinute, 0));
    const tH = Number(firstDefined(t.totalHour, 0));
    const tM = Number(firstDefined(t.totalMinute, 0));

    const remainMin = rH*60 + rM;
    const totalMin  = tH*60 + tM;
    const remainSec = remainMin * 60;

    let progress = 0;
    if (totalMin > 0) progress = clampPct(100 * (totalMin - remainMin) / totalMin);
    const etaStr = remainSec>0 ? new Date(Date.now()+remainSec*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';

    const isRunning =
      (current && /RUN|DRY|COOL|HEAT|DETECT/i.test(current)) ||
      (remainMin > 0);
    const finished =
      /END|FINISH|COMPLETED|DONE/i.test(current) ||
      (totalMin>0 && remainMin===0 && !isRunning);

    safeSetState(base + '.dryer.runState', current, true);
    safeSetState(base + '.dryer.stateText', humanText, true);
    safeSetState(base + '.dryer.isOn', isOn, true);
    safeSetState(base + '.dryer.isRunning', !!isRunning, true);
    safeSetState(base + '.dryer.finished', !!finished, true);

    safeSetState(base + '.dryer.remainHour', rH, true);
    safeSetState(base + '.dryer.remainMinute', rM, true);
    safeSetState(base + '.dryer.remainMinutes', remainMin, true);
    safeSetState(base + '.dryer.remainSec', remainSec, true);
    safeSetState(base + '.dryer.totalHour', tH, true);
    safeSetState(base + '.dryer.totalMinute', tM, true);
    safeSetState(base + '.dryer.totalMinutes', totalMin, true);
    safeSetState(base + '.dryer.initMinutes', totalMin, true);

    safeSetState(base + '.dryer.progressPct', progress, true);
    safeSetState(base + '.dryer.eta', etaStr, true);

    if (typeof rc.remoteControlEnabled === 'boolean')
      safeSetState(base + '.dryer.remoteControlEnabled', rc.remoteControlEnabled, true);

    // Optionale Felder
    const programName = firstDefined(
      s.program && s.program.name,
      s.program,
      s.course && s.course.name,
      s.course && s.course.courseName,
      s.course
    );
    if (programName !== undefined) safeSetState(base + '.dryer.programName', String(programName), true);

    const dryLevel = firstDefined(s.dryLevel && s.dryLevel.value, s.dryLevel);
    if (dryLevel !== undefined) safeSetState(base + '.dryer.dryLevel', String(dryLevel), true);

  } catch (e) {
    logWarn('mapDryerState Fehler (' + deviceId + '): ' + e.message);
  }
}

/* ========= Summary & Polling ========= */

function buildSummary(deviceType, state) {
    if (!state) return '';
    const t = JSON.stringify(state).toLowerCase();
    const parts = [];
    if (deviceType === 'DEVICE_REFRIGERATOR') {
        if (t.indexOf('door') !== -1) parts.push('Door');
        if (t.indexOf('express') !== -1) parts.push('Express');
    }
    if (deviceType === 'DEVICE_WASHER' || deviceType === 'DEVICE_DRYER') {
        if (t.indexOf('power_off') !== -1) parts.push('Off');
        else if (t.indexOf('detecting') !== -1 || t.indexOf('run') !== -1) parts.push('Running');
    }
    return parts.join(' | ');
}

async function loadDevices(cfg) {
    const devices = await thinqRequest(cfg, 'GET', 'devices', null) || [];
    if (!Array.isArray(devices)) throw new Error('Geräteliste nicht als Array');

    safeCreateState(DEV_ROOT, null, { type: 'folder' });
    knownDevices = [];

    devices.forEach(function(d) {
        if (!d.deviceId) return;
        ensureDeviceBaseStates(d);
        ensureModelInfoStates(d.deviceId, d.deviceInfo && d.deviceInfo.deviceType || '');
        ensureControlStates(d.deviceId, d.deviceInfo && d.deviceInfo.deviceType || '');
        knownDevices.push({
            deviceId: d.deviceId,
            deviceType: d.deviceInfo && d.deviceInfo.deviceType || '',
            alias: d.deviceInfo && d.deviceInfo.alias || ''
        });
    });
    // Optional: parallel mit Promise.all (sauber & schnell)
await Promise.all(knownDevices.map(dev => fetchAndStoreModelInfo(cfg, dev.deviceId)));

    logInfo('Gefundene Geräte: ' + knownDevices.length);
    return knownDevices;
}

async function pollDeviceState(cfg, dev) {
   const nowTs = Date.now();
if (backoffUntilByDevice[dev.deviceId] && nowTs < backoffUntilByDevice[dev.deviceId]) {
    // aktuell im Backoff-Fenster -> überspringen
    return;
}


    const base = DEV_ROOT + '.' + dev.deviceId;
    try {
        const state = await thinqRequest(cfg, 'GET', 'devices/' + encodeURIComponent(dev.deviceId) + '/state', null);
        safeSetState(base + '.state.raw', JSON.stringify(state), true);

        let online = true;
        if (state && typeof state === 'object') {
            if (state.online === false) online = false;
            if (state.deviceState === 'DISCONNECTED') online = false;
        }
        safeSetState(base + '.state.online', online, true);

        if (dev.deviceType === 'DEVICE_REFRIGERATOR') {
            mapFridgeState(dev.deviceId, state);
        } else if (dev.deviceType === 'DEVICE_WASHER') {
            mapWasherState(dev.deviceId, state);
        } else if (dev.deviceType === 'DEVICE_DRYER') {
            mapDryerState(dev.deviceId, state);
        }

        const summary = buildSummary(dev.deviceType, state);
        if (summary) safeSetState(base + '.state.summary', summary, true);

   } catch (e) {
    const msg = String(e && e.message || '');
    const sc  = Number(e && e.statusCode || 0);
    if (sc === 416 || /Not connected device/i.test(msg)) {
        // Gerät schläft / offline → 5 Minuten Ruhe
        backoffUntilByDevice[dev.deviceId] = Date.now() + 5*60*1000;
        safeSetState(base + '.state.online', false, true);
        // nicht jede Minute ins Log spammen
        logInfo(`Status-Info für ${dev.alias || dev.deviceId}: offline (Backoff 5min)`);
    } else {
        logWarn(`Status-Fehler für ${dev.alias || dev.deviceId}: ${msg}`);
        safeSetState(base + '.state.online', false, true);
    }
}

}
async function pollAllDevices(cfg) {
    if (!knownDevices.length) return;
    for (let i = 0; i < knownDevices.length; i++) {
        await pollDeviceState(cfg, knownDevices[i]);
    }
    safeSetState(ROOT + '.Info.lastPollTs', new Date().toISOString(), true);
}

/* ========= Control Handler ========= */

// RAW JSON → direkte Kontrolle
on({ id: new RegExp('^' + DEV_ROOT.replace(/\./g,'\\.') + '\\.[^.]+\\.control\\.rawJson$'), change:'ne' }, async (obj) => {
    try {
        if (!obj || !obj.id || !obj.state || obj.state.ack) return;
        const val = obj.state.val;
        const parts = obj.id.split('.');
        const idx = parts.indexOf('Devices');
        const deviceId = parts[idx+1];
        const base = DEV_ROOT + '.' + deviceId + '.control';

        let payload = parseMaybeJson(val);
        if (!payload) { logInfo('control.rawJson ist kein gültiges JSON.'); return; }

        const pat = String(getSafe(ROOT + '.Config.pat','')).trim();
        if (!pat) { logWarn('Kein PAT konfiguriert.'); return; }
        const countryCode = String(getSafe(ROOT + '.Config.countryCode','DE')).toUpperCase();
        let clientId = String(getSafe(ROOT + '.Config.clientId','')).trim();
        if (!clientId) { clientId = generateClientId(); safeSetState(ROOT + '.Config.clientId', clientId, true); }
        const region = getRegionFromCountry(countryCode);
        const cfg = { pat, countryCode, clientId, region };

        // optionaler Hinweis: remoteControlEnabled prüfen (wenn vorhanden)
        const rceId = `${DEV_ROOT}.${deviceId}.state.washer.remoteControlEnabled`;
        const rceId2= `${DEV_ROOT}.${deviceId}.state.dryer.remoteControlEnabled`;
        const rce = !!(getSafe(rceId, null) ?? getSafe(rceId2, null));
        if (rce === false) logWarn(`[LGThinQ] RemoteControl am Gerät evtl. nicht aktiv – Start kann abgelehnt werden.`);

        const res = await sendControlPayload(cfg, deviceId, payload);
        safeSetState(`${base}.result`, JSON.stringify(res), true);
        setState(obj.id, '', true); // nach Erfolg leeren
    } catch(e){
        const parts = (obj && obj.id) ? obj.id.split('.') : [];
        const idx = parts.indexOf('Devices');
        const deviceId = idx>0 ? parts[idx+1] : 'unknown';
        const base = DEV_ROOT + '.' + deviceId + '.control';
        logError(`Control-Fehler (rawJson): ${e.message}`);
        safeSetState(`${base}.lastError`, e.message, true);
    }
});

// Einfache Kommandos (start/pause/resume/stop)
on({ id: new RegExp('^' + DEV_ROOT.replace(/\./g,'\\.') + '\\.[^.]+\\.control\\.command$'), change:'ne' }, async (obj) => {
    if (!obj || !obj.id || !obj.state || obj.state.ack) return;
    const cmd = String(obj.state.val||'').toLowerCase();
    if (!cmd) return;

    const parts = obj.id.split('.'); const idx = parts.indexOf('Devices'); const deviceId = parts[idx+1];
    const devType = String(getSafe(`${DEV_ROOT}.${deviceId}.deviceType`, ''));
    const base = `${DEV_ROOT}.${deviceId}.control`;

    try {
        const pat = String(getSafe(ROOT + '.Config.pat','')).trim();
        if (!pat) { logWarn('Kein PAT konfiguriert.'); return; }
        const countryCode = String(getSafe(ROOT + '.Config.countryCode','DE')).toUpperCase();
        let clientId = String(getSafe(ROOT + '.Config.clientId','')).trim();
        if (!clientId) { clientId = generateClientId(); safeSetState(ROOT + '.Config.clientId', clientId, true); }
        const region = getRegionFromCountry(countryCode);
        const cfg = { pat, countryCode, clientId, region };

        const payload = buildSimpleCommandPayload(devType, cmd);
        const res = await sendControlPayload(cfg, deviceId, payload);
        safeSetState(`${base}.result`, JSON.stringify(res), true);
        setState(obj.id, '', true);
    } catch(e){
        logError(`Control-Fehler (command=${cmd}): ${e.message}`);
        safeSetState(`${base}.lastError`, e.message, true);
    }
});

// Programmauswahl (programKey schreiben, dann sendProgram → true)
on({ id: new RegExp('^' + DEV_ROOT.replace(/\./g,'\\.') + '\\.[^.]+\\.control\\.sendProgram$'), change:'ne' }, async (obj) => {
    if (!obj || !obj.id || !obj.state || obj.state.ack) return;
    const val = !!obj.state.val; if (!val) return;
    const parts = obj.id.split('.'); const idx = parts.indexOf('Devices'); const deviceId = parts[idx+1];
    const devType = String(getSafe(`${DEV_ROOT}.${deviceId}.deviceType`, ''));
    const base = `${DEV_ROOT}.${deviceId}.control`;

    try {
        const programKey = String(getSafe(`${base}.programKey`, '')).trim();
        if (!programKey) { logWarn('programKey ist leer.'); setState(obj.id, false, true); return; }

        const pat = String(getSafe(ROOT + '.Config.pat','')).trim();
        const countryCode = String(getSafe(ROOT + '.Config.countryCode','DE')).toUpperCase();
        let clientId = String(getSafe(ROOT + '.Config.clientId','')).trim();
        if (!clientId) { clientId = generateClientId(); safeSetState(ROOT + '.Config.clientId', clientId, true); }
        const region = getRegionFromCountry(countryCode);
        const cfg = { pat, countryCode, clientId, region };

        const payload = buildProgramPayload(devType, programKey);
        const res = await sendControlPayload(cfg, deviceId, payload);
        safeSetState(`${base}.result`, JSON.stringify(res), true);
    } catch(e){
        logError(`Control-Fehler (program): ${e.message}`);
        safeSetState(`${base}.lastError`, e.message, true);
    } finally {
        setState(obj.id, false, true); // Button zurück
    }
});

on({ id: new RegExp('^' + DEV_ROOT.replace(/\./g,'\\.') + '\\.[^.]+\\.control\\.programKeyEnum$'), change:'ne' }, async (obj) => {
  if (!obj || !obj.id || !obj.state || obj.state.ack) return;
  const key = String(obj.state.val || '').trim();
  const parts = obj.id.split('.'); const idx = parts.indexOf('Devices'); const deviceId = parts[idx+1];
  const devType = String(getSafe(`${DEV_ROOT}.${deviceId}.deviceType`, ''));
  const base = `${DEV_ROOT}.${deviceId}.control`;

  try {
    if (!key) return;
    // cfg aufbauen
    const pat = String(getSafe(ROOT + '.Config.pat','')).trim();
    if (!pat) { logWarn('Kein PAT konfiguriert.'); return; }
    const countryCode = String(getSafe(ROOT + '.Config.countryCode','DE')).toUpperCase();
    let clientId = String(getSafe(ROOT + '.Config.clientId','')).trim();
    if (!clientId) { clientId = generateClientId(); safeSetState(ROOT + '.Config.clientId', clientId, true); }
    const region = getRegionFromCountry(countryCode);
    const cfg = { pat, countryCode, clientId, region };

    // Payload aus Auswahl
    const payload = buildProgramPayload(devType, key);
    const res = await sendControlPayload(cfg, deviceId, payload);
    safeSetState(`${base}.result`, JSON.stringify(res), true);

    // Komfort: auch .programKey (string) spiegeln
    setState(`${base}.programKey`, key, true);
  } catch (e) {
    logError(`Control-Fehler (programKeyEnum): ${e.message}`);
    safeSetState(`${base}.lastError`, e.message, true);
  }
});

/* ========= Start / Restart ========= */

function clearPoll() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
// Heuristik: Programme finden (modellübergreifend robust)
function extractProgramsFromModel(model) {
  const maps = [];

  function collectFromArray(arr, propHint) {
    const map = {};
    for (const it of arr) {
      if (it == null) continue;
      // Schlüssel (id) – häufige Varianten
      const key = 
        it.value ?? it.key ?? it.id ?? it.courseId ?? it.course ?? it.code ??
        (typeof it === 'string' ? it : undefined);
      if (key == null) continue;

      // Anzeigename – häufige Varianten / Sprachcontainer
      let name =
        (it.label && (it.label['de'] || it.label['de-DE'] || it.label['en'] || it.label['en-US'])) ??
        it.label ?? it.title ?? it.name ?? it.display ?? it.text ?? key;

      if (typeof name === 'object') {
        name = name['de'] || name['de-DE'] || name['en'] || name['en-US'] || JSON.stringify(name);
      }
      map[String(key)] = String(name);
    }
    if (Object.keys(map).length) maps.push({ source: propHint || 'array', map });
  }

  function walk(node, path = '') {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      collectFromArray(node, path);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      const kl = k.toLowerCase();
      // Verdächtige Felder: course/courses/program/programs
      if (Array.isArray(v) && /(course|program)/.test(kl)) collectFromArray(v, p);
      // Rekursiv
      walk(v, p);
    }
  }

  walk(model);

  // Beste Map wählen: priorisiere Treffer mit „course/program“ im Pfad
  maps.sort((a, b) => {
    const ap = /course|program/i.test(a.source) ? 0 : 1;
    const bp = /course|program/i.test(b.source) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return Object.keys(b.map).length - Object.keys(a.map).length;
  });
  return maps.length ? maps[0].map : {};
}
async function fetchAndStoreModelInfo(cfg, deviceId) {
  ensureModelInfoStates(deviceId);
  const base = `${DEV_ROOT}.${deviceId}.model`;
  try {
    // mehrere mögliche Endpunkte – zuerst der „neue“
    let model = null;
    try {
      model = await thinqRequest(cfg, 'GET', `devices/${encodeURIComponent(deviceId)}/model-info`, null);
    } catch (e1) {
      // Fallback – einige Backends verwenden "model" statt "model-info"
      try {
        model = await thinqRequest(cfg, 'GET', `devices/${encodeURIComponent(deviceId)}/model`, null);
      } catch (e2) {
        throw e1; // ursprünglichen Fehler propagieren
      }
    }

    safeSetState(`${base}.raw`, JSON.stringify(model), true);

    // Programme extrahieren
    const progMap = extractProgramsFromModel(model);
    const list = Object.entries(progMap).map(([k, v]) => `• ${v} (${k})`).join('\n');
    safeSetState(`${base}.programs.json`, JSON.stringify(progMap), true);
    safeSetState(`${base}.programs.list`, list || '—', true);

    // Mapping für Steuerung schreiben + Dropdown aufbauen
    safeSetState(`${DEV_ROOT}.${deviceId}.control.programMap`, JSON.stringify(progMap), true);
    setEnumStates(`${DEV_ROOT}.${deviceId}.control.programKeyEnum`, progMap);

    if (!Object.keys(progMap).length) {
      logWarn(`[LGThinQ] Keine Programme im Model-Info gefunden (${deviceId}).`);
    } else {
      logInfo(`[LGThinQ] Programme geladen (${deviceId}): ${Object.keys(progMap).length}`);
    }
  } catch (e) {
    logWarn(`[LGThinQ] Model-Info Fehler (${deviceId}): ${e.message}`);
    safeSetState(`${base}.lastError`, e.message, true);
  }
}

async function start() {
    clearPoll();
    safeSetState(ROOT + '.Info.started', false, true);
    safeSetState(ROOT + '.Info.lastError', '', true);

    const mode = String(getSafe(ROOT + '.Config.mode', 'pat')).toLowerCase();
    const pat = String(getSafe(ROOT + '.Config.pat', '')).trim();
    const countryCode = String(getSafe(ROOT + '.Config.countryCode', 'DE')).toUpperCase();
    let clientId = String(getSafe(ROOT + '.Config.clientId', '')).trim();
    const pollSec = parseInt(getSafe(ROOT + '.Config.pollIntervalSec', 60), 10) || 60;
setHeaderModeActive(getHeaderModeConfigured());
FALLBACK_LOGGED = false;

    if (mode !== 'pat') {
        logWarn('Nur PAT-Modus unterstützt. Bitte ' + ROOT + '.Config.mode = "pat".');
        return;
    }
    if (!pat) {
        logWarn('Bitte ThinQ Connect PAT in ' + ROOT + '.Config.pat eintragen.');
        return;
    }
    if (!clientId) {
        clientId = generateClientId();
        safeSetState(ROOT + '.Config.clientId', clientId, true);
    }

    const region = getRegionFromCountry(countryCode);
    const cfg = { pat: pat, countryCode: countryCode, clientId: clientId, region: region };

    logInfo('Starte mit PAT, Country=' + countryCode + ', Region=' + region + ', ClientId=' + clientId);

    try {
        await loadDevices(cfg);
        await pollAllDevices(cfg);

        if (pollSec > 0) {
            pollTimer = setInterval(function() {
                pollAllDevices(cfg).catch(function(err) {
                    logInfo('Poll-Fehler: ' + err.message);
                    safeSetState(ROOT + '.Info.lastError', err.message, true);
                });
            }, pollSec * 1000);
        }

        safeSetState(ROOT + '.Info.started', true, true);
        logInfo('Start erfolgreich. Geräte & Status unter ' + DEV_ROOT);
    } catch (e) {
        logError('Start fehlgeschlagen: ' + e.message);
        safeSetState(ROOT + '.Info.lastError', e.message, true);
    }
}

on({ id: ROOT + '.Config.*', change: 'any' }, function () {
    logInfo('Config geändert, starte neu ...');
    start();
});

logInfo('LG ThinQ Adapter-Ersatz (ThinQ Connect PAT v8_ultra_safe) geladen.');
start();
