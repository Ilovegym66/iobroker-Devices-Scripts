/*********************************************************
 * Viessmann IoT v2 – Schedule & Boost Bridge (v27.1)
 * - Setzt/liest Zeitpläne für:
 *   • heating.circuits.0.heating.schedule
 *   • heating.dhw.schedule
 *   • heating.dhw.pumps.circulation.schedule
 * - Boost: fügt temporären ON-Slot für Zirkulation ein und stellt zurück
 * - Keine Endlos-Polls, nur Start-Sync + Reactions (ack:false)
 *********************************************************/
'use strict';

/*** === KONFIG === ***/
const CFG = {
  ROOT: '0_userdata.0.Geraete.ViessmannAPI',
  CTRL: '0_userdata.0.Geraete.ViessmannAPI.Ctrl',
  DEBUG: '0_userdata.0.vis.Dashboards.VitodensDebug',

  // IDs aus deinem Log:
  INSTALLATION_ID: '',
  GATEWAY_ID:      '',
  DEVICE_ID:       '0',

  // Wo liegt dein OAuth2 Access-Token?
  TOKEN_STATE: '0_userdata.0.Geraete.ViessmannAPI.Auth.access_token',

  // Default Boostdauer
  BOOST_MIN: 15,

  // Optional: TLS Timeout
  HTTP_TIMEOUT_MS: 15000
};

/*** === HELPERS === ***/
function objExists(id){ try{ return !!getObject(id); }catch(_){ return false; } }
function sGet(id){ try{ return getState(id); }catch(_){ return null; } }
function str(id, def=''){ const s=sGet(id); return (s && s.val!=null) ? String(s.val) : def; }
function bool(id, def=false){ const s=sGet(id); if(!s) return def; if(typeof s.val==='boolean') return s.val; return String(s.val)==='true' || Number(s.val)===1; }
function num(id, def=null){ const s=sGet(id); if(!s || s.val==null) return def; const v = Number(s.val); return isFinite(v)?v:def; }
function mkState(id, common, def){ if(!objExists(id)) try{ createState(id, def, Object.assign({read:true,write:true}, common||{}), ()=>{});}catch(_){ } }
function setOK(id, val){ try{ setState(id, val, true); }catch(_){ } }
function nowIso(){ return new Date().toISOString(); }
const WEEK = ['mon','tue','wed','thu','fri','sat','sun'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b, Number(v)||0));

/*** === HTTP (https core) === ***/
const https = require('https');
function httpJson(method, path, body){
  return new Promise((resolve, reject)=>{
    const token = str(CFG.TOKEN_STATE,'').trim();
    if(!token) return reject(new Error('Kein Access-Token in '+CFG.TOKEN_STATE));

    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      method,
      hostname: 'api.viessmann-climatesolutions.com',
      path,
      headers: {
        'Authorization': 'Bearer '+token,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: CFG.HTTP_TIMEOUT_MS
    };
    if(data) opts.headers['Content-Length'] = String(data.length);

    const req = https.request(opts, (res)=>{
      const chunks=[];
      res.on('data', d=>chunks.push(d));
      res.on('end', ()=>{
        const txt = Buffer.concat(chunks).toString('utf8');
        const ok  = res.statusCode>=200 && res.statusCode<300;
        if(!ok) return reject(new Error(`HTTP ${res.statusCode}: ${txt}`));
        try{ resolve(txt?JSON.parse(txt):{}); }catch(e){ resolve({}); }
      });
    });
    req.on('error', reject);
    if(data) req.write(data);
    req.end();
  });
}

function featurePath(feature){  // GET single feature
  const p = `/iot/v2/features/installations/${CFG.INSTALLATION_ID}`+
            `/gateways/${CFG.GATEWAY_ID}/devices/${CFG.DEVICE_ID}`+
            `/features/${encodeURIComponent(feature)}`;
  return p;
}
function commandPath(feature, cmd){ // POST command
  const p = `${featurePath(feature)}/commands/${encodeURIComponent(cmd)}`;
  return p;
}

/*** === STATE SETUP === ***/
function initStates(){
  // Heizung (HK0)
  mkState(`${CFG.CTRL}.heatingSchedule.entries`, {type:'string', role:'json'}, '{}');
  mkState(`${CFG.CTRL}.heatingSchedule.active`,  {type:'boolean', role:'switch'}, false);
  mkState(`${CFG.CTRL}.heatingSchedule.setJson`, {type:'string', role:'json'}, '');

  // DHW
  mkState(`${CFG.CTRL}.dhwSchedule.entries`, {type:'string', role:'json'}, '{}');
  mkState(`${CFG.CTRL}.dhwSchedule.active`,  {type:'boolean', role:'switch'}, false);
  mkState(`${CFG.CTRL}.dhwSchedule.setJson`, {type:'string', role:'json'}, '');

  // Zirkulation
  mkState(`${CFG.CTRL}.circSchedule.entries`, {type:'string', role:'json'}, '{}');
  mkState(`${CFG.CTRL}.circSchedule.active`,  {type:'boolean', role:'switch'}, false);
  mkState(`${CFG.CTRL}.circSchedule.setJson`, {type:'string', role:'json'}, '');
  mkState(`${CFG.CTRL}.circSchedule.boostMinutes`, {type:'number', role:'level.duration'}, CFG.BOOST_MIN);
  mkState(`${CFG.CTRL}.circSchedule.boostNow`,     {type:'boolean', role:'button'}, false);
  mkState(`${CFG.CTRL}.circSchedule._backup`,      {type:'string', role:'json'}, '');
  mkState(`${CFG.CTRL}.circSchedule._restoreAt`,   {type:'string', role:'text'}, '');

  mkState(`${CFG.DEBUG}.ViessBridge.lastError`, {type:'string', role:'text'}, '');
  mkState(`${CFG.DEBUG}.ViessBridge.lastInfo`,  {type:'string', role:'text'}, '');
}

/*** === SCHEDULE VALIDATION/UTIL === ***/
function parseSched(text){ try{ const j=JSON.parse(String(text||'{}')); return (j && typeof j==='object')?j:null; }catch(_){ return null; } }
function normalizeSchedule(s, allowedModes){
  const out = {};
  for(const d of WEEK){
    const arr = Array.isArray(s?.[d]) ? s[d] : [];
    const cleaned = arr
      .map(e=>({
        start: String(e.start||'').slice(0,5),
        end:   String(e.end||'').slice(0,5),
        mode:  allowedModes && allowedModes.length ? (allowedModes.includes(e.mode)?e.mode:allowedModes[0]) : (e.mode||undefined),
        position: Number(e.position||0)
      }))
      .filter(e => /^\d{2}:\d{2}$/.test(e.start) && /^\d{2}:\d{2}$/.test(e.end) && e.end>e.start);
    cleaned.sort((a,b)=> String(a.start).localeCompare(String(b.start)));
    out[d] = cleaned.map((e,i)=>Object.assign({}, e, {position:i}));
  }
  return out;
}
function trimToMaxEntries(s, maxEntries){
  if(!maxEntries || maxEntries<=0) return s;
  const out = {};
  for(const d of WEEK){
    const a = Array.isArray(s?.[d]) ? s[d] : [];
    out[d] = a.slice(0, maxEntries).map((e,i)=>Object.assign({}, e, {position:i}));
  }
  return out;
}

/*** === READ CURRENT FEATURE → MIRROR TO STATES === ***/
async function mirrorFeatureToStates(kind){
  try{
    let feature;
    if(kind==='heating') feature = 'heating.circuits.0.heating.schedule';
    else if(kind==='dhw') feature = 'heating.dhw.schedule';
    else if(kind==='circ') feature = 'heating.dhw.pumps.circulation.schedule';
    else return;

    const res = await httpJson('GET', featurePath(feature));
    const entries = res?.properties?.entries?.value || {};
    const active  = !!(res?.properties?.active?.value);
    if(kind==='heating'){
      setOK(`${CFG.CTRL}.heatingSchedule.entries`, JSON.stringify(entries));
      setOK(`${CFG.CTRL}.heatingSchedule.active`, active);
    }else if(kind==='dhw'){
      setOK(`${CFG.CTRL}.dhwSchedule.entries`, JSON.stringify(entries));
      setOK(`${CFG.CTRL}.dhwSchedule.active`, active);
    }else{
      setOK(`${CFG.CTRL}.circSchedule.entries`, JSON.stringify(entries));
      setOK(`${CFG.CTRL}.circSchedule.active`, active);
    }
    setOK(`${CFG.DEBUG}.ViessBridge.lastInfo`, `${nowIso()} mirror ok: ${kind}`);
  }catch(e){
    setOK(`${CFG.DEBUG}.ViessBridge.lastError`, `${nowIso()} mirror ${kind} failed: ${e && e.message || e}`);
  }
}

/*** === POST NEW SCHEDULE === ***/
async function postSchedule(kind, scheduleObj){
  let feature, allowedModes, defaultMode, maxEntries;
  if(kind==='heating'){
    feature = 'heating.circuits.0.heating.schedule';
    allowedModes = ['normal']; defaultMode='reduced'; maxEntries=4;
  }else if(kind==='dhw'){
    feature = 'heating.dhw.schedule';
    allowedModes = ['on']; defaultMode='off'; maxEntries=4;
  }else if(kind==='circ'){
    feature = 'heating.dhw.pumps.circulation.schedule';
    allowedModes = ['on']; defaultMode='off'; maxEntries=4;
  }else{
    throw new Error('unknown kind');
  }

  const norm = normalizeSchedule(scheduleObj, allowedModes);
  const trimmed = trimToMaxEntries(norm, maxEntries);
  const body = { newSchedule: trimmed };
  const path = commandPath(feature, 'setSchedule');

  await httpJson('POST', path, body);
  // Spiegeln/Quittieren
  if(kind==='heating'){
    setOK(`${CFG.CTRL}.heatingSchedule.entries`, JSON.stringify(trimmed));
    setOK(`${CFG.CTRL}.heatingSchedule.active`, true);
  }else if(kind==='dhw'){
    setOK(`${CFG.CTRL}.dhwSchedule.entries`, JSON.stringify(trimmed));
    setOK(`${CFG.CTRL}.dhwSchedule.active`, true);
  }else{
    setOK(`${CFG.CTRL}.circSchedule.entries`, JSON.stringify(trimmed));
    setOK(`${CFG.CTRL}.circSchedule.active`, true);
  }
}

/*** === BOOST LOGIK (Zirkulation) === ***/
async function startBoost(){
  const minutes = clamp(num(`${CFG.CTRL}.circSchedule.boostMinutes`, CFG.BOOST_MIN), 1, 180);
  const now = new Date();
  const end = new Date(now.getTime() + minutes*60000);
  const hhmm = (d)=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  // Backup vorhandenen Plan
  const cur = parseSched(str(`${CFG.CTRL}.circSchedule.entries`, '{}')) || {};
  setOK(`${CFG.CTRL}.circSchedule._backup`, JSON.stringify(cur));

  // Boost-Slot nur für den heutigen Wochentag
  const dayKey = WEEK[now.getDay()===0 ? 6 : now.getDay()-1]; // JS: Sun=0
  const boosted = {};
  for(const d of WEEK) boosted[d] = (d===dayKey) ? [{start: hhmm(now), end: hhmm(end), mode:'on', position:0}] : [];

  await postSchedule('circ', boosted);
  setOK(`${CFG.CTRL}.circSchedule._restoreAt`, end.toISOString());
  setOK(`${CFG.DEBUG}.ViessBridge.lastInfo`, `${nowIso()} boost started ${minutes}min`);

  // Timer zur Wiederherstellung
  setTimeout(async ()=>{
    try{
      const backup = parseSched(str(`${CFG.CTRL}.circSchedule._backup`, '')) || {};
      await postSchedule('circ', backup);
      setOK(`${CFG.CTRL}.circSchedule._restoreAt`, '');
      setOK(`${CFG.DEBUG}.ViessBridge.lastInfo`, `${nowIso()} boost restored`);
    }catch(e){
      setOK(`${CFG.DEBUG}.ViessBridge.lastError`, `${nowIso()} restore failed: ${e && e.message || e}`);
    }
  }, Math.max(1000, minutes*60000));
}

/*** === WATCHERS === ***/
function setupWatchers(){
  // Heizung setzen
  on({id: `${CFG.CTRL}.heatingSchedule.setJson`, change: 'ne', ack:false}, async (obj)=>{
    try{
      const j = parseSched(obj.state.val);
      if(!j) throw new Error('heatingSchedule.setJson: ungültiges JSON');
      await postSchedule('heating', j);
      setOK(`${CFG.DEBUG}.ViessBridge.lastInfo`, `${nowIso()} heating schedule set`);
      setOK(`${CFG.CTRL}.heatingSchedule.setJson`, '', true);
    }catch(e){
      setOK(`${CFG.DEBUG}.ViessBridge.lastError`, `${nowIso()} heating set failed: ${e && e.message || e}`);
    }
  });

  // DHW setzen
  on({id: `${CFG.CTRL}.dhwSchedule.setJson`, change: 'ne', ack:false}, async (obj)=>{
    try{
      const j = parseSched(obj.state.val);
      if(!j) throw new Error('dhwSchedule.setJson: ungültiges JSON');
      await postSchedule('dhw', j);
      setOK(`${CFG.DEBUG}.ViessBridge.lastInfo`, `${nowIso()} dhw schedule set`);
      setOK(`${CFG.CTRL}.dhwSchedule.setJson`, '', true);
    }catch(e){
      setOK(`${CFG.DEBUG}.ViessBridge.lastError`, `${nowIso()} dhw set failed: ${e && e.message || e}`);
    }
  });

  // Zirkulation setzen
  on({id: `${CFG.CTRL}.circSchedule.setJson`, change: 'ne', ack:false}, async (obj)=>{
    try{
      const j = parseSched(obj.state.val);
      if(!j) throw new Error('circSchedule.setJson: ungültiges JSON');
      await postSchedule('circ', j);
      setOK(`${CFG.DEBUG}.ViessBridge.lastInfo`, `${nowIso()} circ schedule set`);
      setOK(`${CFG.CTRL}.circSchedule.setJson`, '', true);
    }catch(e){
      setOK(`${CFG.DEBUG}.ViessBridge.lastError`, `${nowIso()} circ set failed: ${e && e.message || e}`);
    }
  });

  // Boost Start
  on({id: `${CFG.CTRL}.circSchedule.boostNow`, change: 'ne', ack:false}, async (obj)=>{
    if(!obj || obj.state.val!==true) return;
    try{
      await startBoost();
    }catch(e){
      setOK(`${CFG.DEBUG}.ViessBridge.lastError`, `${nowIso()} boost failed: ${e && e.message || e}`);
    }finally{
      setOK(`${CFG.CTRL}.circSchedule.boostNow`, false, true); // Button zurück
    }
  });
}

/*** === STARTUP === ***/
(async ()=>{
  initStates();
  // Einmaliger Start-Sync (falls Token vorhanden)
  try{
    await mirrorFeatureToStates('heating');
    await mirrorFeatureToStates('dhw');
    await mirrorFeatureToStates('circ');
  }catch(_){}
  setupWatchers();
})();