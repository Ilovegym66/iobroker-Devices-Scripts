// LG ThinQ Adapter-Ersatz – ThinQ Connect (PAT v8_ultra_safe)
// (c) ilovegym66 https://github.com/Ilovegym66
// Focus: stable 
// Features:
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

const ROOT = '0_userdata.0.Geraete.LGThinQ';
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
    let uuid;
    if (crypto.randomUUID) {
        uuid = crypto.randomUUID();
    } else {
        uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    return 'thinq-open-' + uuid;
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

/* ========= Config-States ========= */

safeCreateState(ROOT + '.Config.mode', 'pat', { type: 'string' });
safeCreateState(ROOT + '.Config.pat', '', { type: 'string' });
safeCreateState(ROOT + '.Config.countryCode', 'DE', { type: 'string' });
safeCreateState(ROOT + '.Config.clientId', '', { type: 'string' });
safeCreateState(ROOT + '.Config.pollIntervalSec', 60, { type: 'number' });

safeCreateState(ROOT + '.Info.started', false, { type: 'boolean', read: true, write: false });
safeCreateState(ROOT + '.Info.lastPollTs', '', { type: 'string', read: true, write: false });
safeCreateState(ROOT + '.Info.lastError', '', { type: 'string', read: true, write: false });

/* ========= ThinQ Request ========= */

function thinqRequest(cfg, method, endpoint, body, extraHeaders) {
    return new Promise(function(resolve, reject) {
        const dataStr = body ? JSON.stringify(body) : null;

        const headers = Object.assign({
            'Authorization': 'Bearer ' + cfg.pat,
            'x-country': cfg.countryCode,
            'x-message-id': generateMessageId(),
            'x-client-id': cfg.clientId,
            'x-api-key': API_KEY,
            'x-service-phase': 'OP',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }, extraHeaders || {});

        const options = {
            host: 'api-' + cfg.region + '.lgthinq.com',
            path: '/' + endpoint,
            method: method || 'GET',
            headers: headers
        };

        const req = https.request(options, function(res) {
            let data = '';
            res.on('data', function(c) { data += c; });
            res.on('end', function() {
                if (!data) data = '{}';
                let json;
                try {
                    json = JSON.parse(data);
                } catch (e) {
                    logError('Antwort kein JSON bei /' + endpoint + ': ' + data);
                    return reject(new Error('Invalid JSON'));
                }

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    if (Object.prototype.hasOwnProperty.call(json, 'response')) {
                        resolve(json.response);
                    } else {
                        resolve(json);
                    }
                } else {
                    const err = json.error || {};
                    const msg = (err.code || '') + ' ' + (err.message || '');
                    logInfo('HTTP ' + res.statusCode + ' /' + endpoint + ': ' + (msg || data));
                    reject(new Error('HTTP ' + res.statusCode + ': ' + (msg || data)));
                }
            });
        });

        req.on('error', function(err) {
        logInfo('Request-Fehler /' + endpoint + ': ' + err.message);
            reject(err);
        });

        if (dataStr) req.write(dataStr);
        req.end();
    });
}

/* ========= Geräte-Basis ========= */

let pollTimer = null;
let knownDevices = [];

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

        safeCreateState(base + '.washer.runState', '', { type: 'string', read: true, write: false });
        safeCreateState(base + '.washer.isOn', false, { type: 'boolean', read: true, write: false });
        safeCreateState(base + '.washer.remoteControlEnabled', false, { type: 'boolean', read: true, write: false });

        safeCreateState(base + '.washer.remainHour', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.washer.remainMinute', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.washer.remainMinutes', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.washer.totalHour', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.washer.totalMinute', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.washer.totalMinutes', 0, { type: 'number', read: true, write: false });

        safeCreateState(base + '.washer.cycleCount', 0, { type: 'number', read: true, write: false });

        const run = s.runState || {};
        const rc  = s.remoteControlEnable || {};
        const t   = s.timer || {};
        const cyc = s.cycle || {};

        const current = String(run.currentState || '').toUpperCase();
        const isOn = !!(current && current !== 'POWER_OFF');

        safeSetState(base + '.washer.runState', current, true);
        safeSetState(base + '.washer.isOn', isOn, true);

        if (typeof rc.remoteControlEnabled === 'boolean')
            safeSetState(base + '.washer.remoteControlEnabled', rc.remoteControlEnabled, true);

        const rh = Number(firstDefined(t.remainHour, 0));
        const rm = Number(firstDefined(t.remainMinute, 0));
        const th = Number(firstDefined(t.totalHour, 0));
        const tm = Number(firstDefined(t.totalMinute, 0));

        safeSetState(base + '.washer.remainHour', rh, true);
        safeSetState(base + '.washer.remainMinute', rm, true);
        safeSetState(base + '.washer.remainMinutes', rh * 60 + rm, true);

        safeSetState(base + '.washer.totalHour', th, true);
        safeSetState(base + '.washer.totalMinute', tm, true);
        safeSetState(base + '.washer.totalMinutes', th * 60 + tm, true);

        if (cyc.cycleCount !== undefined)
            safeSetState(base + '.washer.cycleCount', Number(cyc.cycleCount), true);

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

        safeCreateState(base + '.dryer.runState', '', { type: 'string', read: true, write: false });
        safeCreateState(base + '.dryer.isOn', false, { type: 'boolean', read: true, write: false });
        safeCreateState(base + '.dryer.remoteControlEnabled', false, { type: 'boolean', read: true, write: false });

        safeCreateState(base + '.dryer.remainHour', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.dryer.remainMinute', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.dryer.remainMinutes', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.dryer.totalHour', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.dryer.totalMinute', 0, { type: 'number', read: true, write: false });
        safeCreateState(base + '.dryer.totalMinutes', 0, { type: 'number', read: true, write: false });

        const run = s.runState || {};
        const rc  = s.remoteControlEnable || {};
        const t   = s.timer || {};

        const current = String(run.currentState || '').toUpperCase();
        const isOn = !!(current && current !== 'POWER_OFF');

        safeSetState(base + '.dryer.runState', current, true);
        safeSetState(base + '.dryer.isOn', isOn, true);

        if (typeof rc.remoteControlEnabled === 'boolean')
            safeSetState(base + '.dryer.remoteControlEnabled', rc.remoteControlEnabled, true);

        const rh = Number(firstDefined(t.remainHour, 0));
        const rm = Number(firstDefined(t.remainMinute, 0));
        const th = Number(firstDefined(t.totalHour, 0));
        const tm = Number(firstDefined(t.totalMinute, 0));

        safeSetState(base + '.dryer.remainHour', rh, true);
        safeSetState(base + '.dryer.remainMinute', rm, true);
        safeSetState(base + '.dryer.remainMinutes', rh * 60 + rm, true);

        safeSetState(base + '.dryer.totalHour', th, true);
        safeSetState(base + '.dryer.totalMinute', tm, true);
        safeSetState(base + '.dryer.totalMinutes', th * 60 + tm, true);

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
        knownDevices.push({
            deviceId: d.deviceId,
            deviceType: d.deviceInfo && d.deviceInfo.deviceType || '',
            alias: d.deviceInfo && d.deviceInfo.alias || ''
        });
    });

    logInfo('Gefundene Geräte: ' + knownDevices.length);
    return knownDevices;
}

async function pollDeviceState(cfg, dev) {
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
        logInfo('Status-Fehler für ' + (dev.alias || dev.deviceId) + ': ' + e.message);
        safeSetState(base + '.state.online', false, true);
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

on(
    { id: new RegExp('^' + DEV_ROOT.replace(/\./g, '\\.') + '\\.[^.]+\\.control\\.rawJson$'), change: 'ne' },
    async function(obj) {
        if (!obj || !obj.id || !obj.state || obj.state.ack) return;
        const val = obj.state.val;
        if (!val) return;

        try {
            const parts = obj.id.split('.');
            const idx = parts.indexOf('Devices');
            const deviceId = parts[idx + 1];

            const pat = String(getSafe(ROOT + '.Config.pat', '')).trim();
            if (!pat) {
                logInfo('control.rawJson gesetzt, aber kein PAT konfiguriert.');
                return;
            }
            const countryCode = String(getSafe(ROOT + '.Config.countryCode', 'DE')).toUpperCase();
            let clientId = String(getSafe(ROOT + '.Config.clientId', '')).trim();
            if (!clientId) {
                clientId = generateClientId();
                safeSetState(ROOT + '.Config.clientId', clientId, true);
            }
            const region = getRegionFromCountry(countryCode);
            const cfg = { pat: pat, countryCode: countryCode, clientId: clientId, region: region };

            let payload = val;
            if (typeof payload === 'string') {
                try {
                    payload = JSON.parse(payload);
                } catch (e) {
                    logInfo('control.rawJson ist kein gültiges JSON.');
                    return;
                }
            }

            logInfo('Sende Control an ' + deviceId + ': ' + JSON.stringify(payload));
            await thinqRequest(cfg, 'POST', 'devices/' + encodeURIComponent(deviceId) + '/control', payload, {
                'x-conditional-control': 'true'
            });

            // nach Erfolg wieder leeren
            safeSetState(obj.id, '', true);
        } catch (e) {
            logError('Control-Fehler: ' + e.message);
        }
    }
);

/* ========= Start / Restart ========= */

function clearPoll() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
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
