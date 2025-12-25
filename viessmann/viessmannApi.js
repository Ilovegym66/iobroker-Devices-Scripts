/***************************************************************
 * Viessmann Cloud API – Direct (ohne Adapter)
 * v27.5-display – Discovery wie v27.4-fix + erweiterte Werte-Mappings
 * - Zusätzliche States: Programm-Solltemp (normal/reduced/eco), Circuit-Name
 * - Belässt: Zeitpläne setzen/resetten + Zirkulations-Boost (dhw.pumps.circulation.schedule)
 ***************************************************************/
'use strict';

const https = require('https');
const { URL } = require('url');
const querystring = require('querystring');
const crypto = require('crypto');

/* ===== Konfiguration ===== */
const CFG = {
  root: '0_userdata.0.Geraete.ViessmannAPI',
  apiBase: 'https://api.viessmann-climatesolutions.com',
  pollMs: 300000,

  accessToken: '',
  installationId: '',
  clientId: '',
  clientSecret: '',
  refreshToken: '',

  preferPrefixes: ['heating.', 'heatpump.', 'ventilation.', 'solar.'],
  pollGatewayWifi: true,
  defaultProbeList: ['0','1','2','3','heating','system','boiler','gateway'],
  defaultBoostMinutes: 30
};

const API_HOST = (()=>{ try{ return new URL(CFG.apiBase).hostname; }catch{ return String(CFG.apiBase).replace(/^https?:\/\//,'').replace(/\/.*$/,''); }})();

/* ===== Logger (ioBroker) ===== */
function logI(m){ log('[ViesAPI] '+m, 'info'); }
function logW(m){ log('[ViesAPI] '+m, 'warn'); }

/* ===== ioBroker Helpers (async) ===== */
async function ensureChannel(id, name){ if(!await getObjectAsync(id)) await setObjectAsync(id, {type:'channel', common:{name}, native:{}}); }
async function ensureState(id, common, def){ if(!(await existsStateAsync(id))){ await setObjectAsync(id,{type:'state',common,native:{}}); if(def!==undefined) await setStateAsync(id,def,true);} }
async function write(id, v){ try{ await setStateAsync(id,v,true);}catch(_){ } }

/* ===== HTTP ===== */
function getJsonOnce(path, token){
  return new Promise((resolve,reject)=>{
    const req = https.request({method:'GET',hostname:API_HOST,path,headers:{Authorization:`Bearer ${token}`,'Accept':'application/json'}}, res=>{
      let data=''; res.setEncoding('utf8'); res.on('data',d=>data+=d); res.on('end',()=>{
        const out={status:res.statusCode,headers:res.headers,body:data,json:null};
        if ((res.headers['content-type']||'').includes('application/json')){ try{ out.json=JSON.parse(data||'{}'); }catch{} }
        resolve(out);
      });
    }); req.on('error',reject); req.end();
  });
}
function postJsonOnce(path, token, payload){
  return new Promise((resolve,reject)=>{
    const body = JSON.stringify(payload||{});
    const req = https.request({method:'POST',hostname:API_HOST,path,headers:{
      Authorization:`Bearer ${token}`,'Accept':'application/json','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)
    }}, res=>{
      let data=''; res.setEncoding('utf8'); res.on('data',d=>data+=d); res.on('end',()=>{
        const out={status:res.statusCode,headers:res.headers,body:data,json:null};
        if((res.headers['content-type']||'').includes('application/json')){ try{ out.json=JSON.parse(data||'{}'); }catch{} }
        resolve(out);
      });
    }); req.on('error',reject); req.write(body); req.end();
  });
}
function postForm(host, path, form){
  return new Promise((resolve,reject)=>{
    const body = querystring.stringify(form||{});
    const req = https.request({method:'POST',hostname:host,path,headers:{
      'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)
    }}, res=>{
      let data=''; res.setEncoding('utf8'); res.on('data',d=>data+=d); res.on('end',()=>{ let json=null; try{ json=JSON.parse(data||'{}'); }catch{} resolve({status:res.statusCode,headers:res.headers,body:data,json}); });
    }); req.on('error',reject); req.write(body); req.end();
  });
}

/* ===== Token Mgmt ===== */
const IDP_HOST_V3='iam.viessmann-climatesolutions.com', IDP_PATH_V3='/idp/v3/token';
const IDP_HOST_V2='iam.viessmann.com',                  IDP_PATH_V2='/idp/v2/token';
const nowMs=()=>Date.now();

async function readAuth(){
  const A=`${CFG.root}.Auth`;
  return {
    accessToken:(await getStateAsync(`${A}.accessToken`))?.val||CFG.accessToken,
    accessExp:Number((await getStateAsync(`${A}.accessTokenExpiresAt`))?.val||0),
    refreshToken:(await getStateAsync(`${A}.refreshToken`))?.val||CFG.refreshToken,
    clientId:(await getStateAsync(`${A}.clientId`))?.val||CFG.clientId,
    clientSecret:(await getStateAsync(`${A}.clientSecret`))?.val||CFG.clientSecret,
    tokenEndpoint:(await getStateAsync(`${A}._tokenEndpoint`))?.val||'',
  };
}
async function storeTokenResponse(tr, endpointStr){
  const A=`${CFG.root}.Auth`;
  const acc=tr.access_token||''; const exp=Number(tr.expires_in||0); const rft=tr.refresh_token||'';
  await write(`${A}.accessToken`, acc);
  await write(`${A}.accessTokenExpiresAt`, exp? (nowMs()+(Math.max(0,exp-30))*1000):0);
  if(rft) await write(`${A}.refreshToken`, rft);
  if(endpointStr) await write(`${A}._tokenEndpoint`, endpointStr);
  await write(`${CFG.root}.Raw.tokenInfo`, JSON.stringify({token_type:tr.token_type,expires_in:tr.expires_in,scope:tr.scope}));
  return acc;
}
async function refreshAccessToken(){
  const A=await readAuth();
  const form={grant_type:'refresh_token',refresh_token:A.refreshToken,client_id:A.clientId};
  if(A.clientSecret) form.client_secret=A.clientSecret;

  let res=await postForm(IDP_HOST_V3,IDP_PATH_V3,form);
  if(!(res.status>=200&&res.status<300)){
    const res2=await postForm(IDP_HOST_V2,IDP_PATH_V2,form);
    if(!(res2.status>=200&&res2.status<300)) throw new Error(`Token-Refresh fehlgeschlagen (${res.status}/${res2.status})`);
    await storeTokenResponse(res2.json||{}, `https://${IDP_HOST_V2}${IDP_PATH_V2}`); logI('Access-Token erneuert (IDP v2).'); return true;
  }
  await storeTokenResponse(res.json||{}, `https://${IDP_HOST_V3}${IDP_PATH_V3}`); logI('Access-Token erneuert (IDP v3).'); return true;
}
async function ensureAccessToken(force=false){
  const A=await readAuth(); const auto=!!(await getStateAsync(`${CFG.root}.Config.autoRefresh`))?.val;
  if(!auto && !force) return A.accessToken;
  const due=(A.accessExp||0)-nowMs()<=60000;
  if(force||!A.accessToken||due) await refreshAccessToken();
  return (await getStateAsync(`${CFG.root}.Auth.accessToken`))?.val||'';
}
async function getWithAuth(path){ let t=await ensureAccessToken(false); let r=await getJsonOnce(path,t); if(r.status===401){ await refreshAccessToken(); t=await ensureAccessToken(false); r=await getJsonOnce(path,t);} return r; }
async function postWithAuth(path,p){ let t=await ensureAccessToken(false); let r=await postJsonOnce(path,t,p); if(r.status===401){ await refreshAccessToken(); t=await ensureAccessToken(false); r=await postJsonOnce(path,t,p);} return r; }

/* ===== PKCE helper (für Login-Helper-Buttons) ===== */
const b64url=b=>b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function createPkce(){ const verifier=b64url(crypto.randomBytes(32)); const challenge=b64url(crypto.createHash('sha256').update(verifier).digest()); return {verifier,challenge}; }

/* ===== State-Struktur ===== */
async function setupStates(){
  const R=CFG.root;

  await ensureChannel(R,'Viessmann API Direct');
  await ensureChannel(`${R}.Auth`,'Auth');
  await ensureState(`${R}.Auth.clientId`,{type:'string',read:true,write:true},CFG.clientId);
  await ensureState(`${R}.Auth.clientSecret`,{type:'string',read:true,write:true},CFG.clientSecret);
  await ensureState(`${R}.Auth.refreshToken`,{type:'string',read:true,write:true},CFG.refreshToken);
  await ensureState(`${R}.Auth.accessToken`,{type:'string',read:true,write:true},CFG.accessToken);
  await ensureState(`${R}.Auth.accessTokenExpiresAt`,{type:'number',read:true,write:true},0);
  await ensureState(`${R}.Auth._tokenEndpoint`,{type:'string',read:true,write:true},'');
  await ensureState(`${R}.Auth.refreshNow`,{type:'boolean',role:'button',read:true,write:true},false);

  await ensureChannel(`${R}.Auth.loginHelper`,'Login-Helper');
  await ensureState(`${R}.Auth.redirectUri`,{type:'string',read:true,write:true},'http://localhost:4280/callback');
  await ensureState(`${R}.Auth.scope`,{type:'string',read:true,write:true},'IoT User offline_access');
  await ensureState(`${R}.Auth.loginHelper.authorizeUrl`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Auth.loginHelper.authorizationCode`,{type:'string',read:true,write:true});
  await ensureState(`${R}.Auth.loginHelper.generateUrl`,{type:'boolean',role:'button',read:true,write:true},false);
  await ensureState(`${R}.Auth.loginHelper.exchangeNow`,{type:'boolean',role:'button',read:true,write:true},false);
  await ensureState(`${R}.Auth.loginHelper._codeVerifier`,{type:'string',read:false,write:true});

  await ensureChannel(`${R}.Config`,'Konfig');
  await ensureState(`${R}.Config.installationId`,{type:'string',read:true,write:true},CFG.installationId);
  await ensureState(`${R}.Config.pollMs`,{type:'number',read:true,write:true},CFG.pollMs);
  await ensureState(`${R}.Config.pollGatewayWifi`,{type:'boolean',read:true,write:true},CFG.pollGatewayWifi);
  await ensureState(`${R}.Config.autoRefresh`,{type:'boolean',read:true,write:true},true);
  await ensureState(`${R}.Config.deviceProbeList`,{type:'string',read:true,write:true},CFG.defaultProbeList.join(','));

  await ensureChannel(`${R}.IDs`,'IDs');
  await ensureState(`${R}.IDs.gatewayId`,{type:'string',read:true,write:true},'');
  await ensureState(`${R}.IDs.deviceId`,{type:'string',read:true,write:true},'');

  await ensureChannel(`${R}.Values`,'Werte');
  await ensureState(`${R}.Values.outsideTemp`,{type:'number',unit:'°C',read:true,write:false});
  await ensureState(`${R}.Values.boilerTemp`,{type:'number',unit:'°C',read:true,write:false});
  await ensureState(`${R}.Values.c0_supplyTemp`,{type:'number',unit:'°C',read:true,write:false});
  await ensureState(`${R}.Values.dhwActual`,{type:'number',unit:'°C',read:true,write:false});
  await ensureState(`${R}.Values.dhwTarget`,{type:'number',unit:'°C',read:true,write:false});
  await ensureState(`${R}.Values.wifiRssi`,{type:'number',unit:'dBm',read:true,write:false});

  await ensureState(`${R}.Values.burnerActive`,{type:'boolean',read:true,write:false});
  await ensureState(`${R}.Values.burnerModulation`,{type:'number',unit:'%',read:true,write:false});
  await ensureState(`${R}.Values.burnerHours`,{type:'number',unit:'h',read:true,write:false});
  await ensureState(`${R}.Values.burnerStarts`,{type:'number',read:true,write:false});

  await ensureState(`${R}.Values.hk0_curveSlope`,{type:'number',read:true,write:false});
  await ensureState(`${R}.Values.hk0_curveShift`,{type:'number',read:true,write:false});
  await ensureState(`${R}.Values.hk0_programActive`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Values.hk0_name`,{type:'string',read:true,write:false},'');

  // NEU: Programmsolltemperaturen (zur Anzeige)
  await ensureState(`${R}.Values.hk0_prog_normal_temp`,{type:'number',unit:'°C',read:true,write:false});
  await ensureState(`${R}.Values.hk0_prog_reduced_temp`,{type:'number',unit:'°C',read:true,write:false});
  await ensureState(`${R}.Values.hk0_prog_eco_temp`,{type:'number',unit:'°C',read:true,write:false});

  await ensureChannel(`${R}.Ctrl`,'Steuerung');
  await ensureState(`${R}.Ctrl.mode`,{type:'string',read:true,write:true}); // dhw/dhwAndHeating/standby
  await ensureState(`${R}.Ctrl.circulationPump.status`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Ctrl.primaryPump.status`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Ctrl.dhwCharging.active`,{type:'boolean',read:true,write:false});

  await ensureChannel(`${R}.Ctrl.heatingSchedule`,'Heizung Zeitplan (HK0)');
  await ensureState(`${R}.Ctrl.heatingSchedule.entries`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Ctrl.heatingSchedule.active`,{type:'boolean',read:true,write:false});
  await ensureState(`${R}.Ctrl.heatingSchedule.scheduleJson`,{type:'string',read:true,write:true});
  await ensureState(`${R}.Ctrl.heatingSchedule.apply`,{type:'boolean',role:'button',read:true,write:true},false);
  await ensureState(`${R}.Ctrl.heatingSchedule.reset`,{type:'boolean',role:'button',read:true,write:true},false);

  await ensureChannel(`${R}.Ctrl.dhwSchedule`,'Warmwasser Zeitplan');
  await ensureState(`${R}.Ctrl.dhwSchedule.entries`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Ctrl.dhwSchedule.active`,{type:'boolean',read:true,write:false});
  await ensureState(`${R}.Ctrl.dhwSchedule.scheduleJson`,{type:'string',read:true,write:true});
  await ensureState(`${R}.Ctrl.dhwSchedule.apply`,{type:'boolean',role:'button',read:true,write:true},false);
  await ensureState(`${R}.Ctrl.dhwSchedule.reset`,{type:'boolean',role:'button',read:true,write:true},false);

  await ensureChannel(`${R}.Ctrl.circSchedule`,'Zirkulation Zeitplan');
  await ensureState(`${R}.Ctrl.circSchedule.entries`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Ctrl.circSchedule.active`,{type:'boolean',read:true,write:false});
  await ensureState(`${R}.Ctrl.circSchedule.scheduleJson`,{type:'string',read:true,write:true});
  await ensureState(`${R}.Ctrl.circSchedule.apply`,{type:'boolean',role:'button',read:true,write:true},false);
  await ensureState(`${R}.Ctrl.circSchedule.reset`,{type:'boolean',role:'button',read:true,write:true},false);
  await ensureState(`${R}.Ctrl.circSchedule.boostMinutes`,{type:'number',read:true,write:true},CFG.defaultBoostMinutes);
  await ensureState(`${R}.Ctrl.circSchedule.boostNow`,{type:'boolean',role:'button',read:true,write:true},false);
  await ensureState(`${R}.Ctrl.circSchedule._restoreAt`,{type:'string',read:true,write:true},'');

  await ensureChannel(`${R}.Stats`,'Statistiken');
  await ensureState(`${R}.Stats.burnerHoursTotal`,{type:'number',unit:'h',read:true,write:false});
  await ensureState(`${R}.Stats.burnerHoursToday`,{type:'number',unit:'h',read:true,write:false});
  await ensureState(`${R}.Stats._midnightBaseHours`,{type:'number',read:true,write:true});
  await ensureState(`${R}.Stats._midnightBaseDate`,{type:'string',read:true,write:true});

  await ensureChannel(`${R}.Raw`,'Roh');
  await ensureState(`${R}.Raw.lastStatus`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Raw.lastTried`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Raw.error`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Raw.featuresJson`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Raw.gatewayFeaturesJson`,{type:'string',read:true,write:false});
  await ensureState(`${R}.Raw.tokenInfo`,{type:'string',read:true,write:false});

  await ensureChannel(`${R}.Raw.discovery`,'Discovery');
  await ensureState(`${R}.Raw.discovery.triedPathsJson`,{type:'string',read:true,write:false},'[]');
  await ensureState(`${R}.Raw.discovery.foundDeviceIds`,{type:'string',read:true,write:false},'');
  await ensureState(`${R}.Raw.discovery.lastPick`,{type:'string',read:true,write:false},'');
  await ensureState(`${R}.Raw.discovery.note`,{type:'string',read:true,write:false},'');
}

/* ===== Commands ===== */
function cmdPath(inst,gw,dev,feature,cmd){
  return `/iot/v2/features/installations/${encodeURIComponent(inst)}/gateways/${encodeURIComponent(gw)}/devices/${encodeURIComponent(dev)}/features/${encodeURIComponent(feature)}/commands/${encodeURIComponent(cmd)}`;
}
async function execCommand(inst,gw,dev,feature,cmd,params){
  const path=cmdPath(inst,gw,dev,feature,cmd);
  await write(`${CFG.root}.Raw.lastTried`, path);
  const res=await postWithAuth(path, params||{});
  await write(`${CFG.root}.Raw.lastStatus`, `POST ${path} → ${res.status}`);
  if(res.status>=200 && res.status<300) return true;
  await write(`${CFG.root}.Raw.error`, String(res.body).slice(0,400));
  logW(`Command failed ${feature}/${cmd}: ${res.status}`);
  return false;
}

/* ===== Mapping ===== */
function makeGetters(list){
  const g=(f)=>list.find(x=>x.feature===f);
  const getNum=(f,prop='value')=>{ const v=g(f)?.properties?.[prop]?.value; const n=Number(v); return Number.isFinite(n)?n:null; };
  const getBool=(f,prop='active')=>{ const v=g(f)?.properties?.[prop]?.value; return typeof v==='boolean'?v:null; };
  const getStr=(f,prop='value')=>{ const v=g(f)?.properties?.[prop]?.value; return v==null?'':String(v); };
  const has=(f)=>!!g(f);
  return {getNum,getBool,getStr,has};
}
async function mapValues(primaryList,gatewayList){
  const R=CFG.root;
  if(Array.isArray(primaryList) && primaryList.length){
    const {getNum,getBool,getStr,has} = makeGetters(primaryList);

    // Grundwerte
    await write(`${R}.Values.outsideTemp`, getNum('heating.sensors.temperature.outside'));
    let boiler = getNum('heating.boiler.sensors.temperature.main'); if(boiler==null) boiler=getNum('heating.boiler.temperature');
    await write(`${R}.Values.boilerTemp`, boiler);
    await write(`${R}.Values.c0_supplyTemp`, getNum('heating.circuits.0.sensors.temperature.supply'));

    const dhwActual =
      getNum('heating.dhw.sensors.temperature.dhwCylinder') ??
      getNum('heating.dhw.sensors.temperature.hotWaterStorage');
    await write(`${R}.Values.dhwActual`, dhwActual);
    await write(`${R}.Values.dhwTarget`, getNum('heating.dhw.temperature.main'));

    await write(`${R}.Values.burnerActive`, getBool('heating.burners.0','active'));
    await write(`${R}.Values.burnerModulation`, getNum('heating.burners.0.modulation','value'));
    const hrs=getNum('heating.burners.0.statistics','hours'); const sts=getNum('heating.burners.0.statistics','starts');
    await write(`${R}.Values.burnerHours`, hrs); await write(`${R}.Values.burnerStarts`, sts);
    await write(`${R}.Stats.burnerHoursTotal`, hrs); await updateBurnerToday(hrs);

    // Heizkurve, Programme, Circuit-Name
    await write(`${R}.Values.hk0_curveSlope`, getNum('heating.circuits.0.heating.curve','slope'));
    await write(`${R}.Values.hk0_curveShift`, getNum('heating.circuits.0.heating.curve','shift'));
    await write(`${R}.Values.hk0_programActive`, getStr('heating.circuits.0.operating.programs.active','value'));
    await write(`${R}.Values.hk0_name`, getStr('heating.circuits.0.name','name'));

    await write(`${R}.Values.hk0_prog_normal_temp`, getNum('heating.circuits.0.operating.programs.normal','temperature'));
    await write(`${R}.Values.hk0_prog_reduced_temp`, getNum('heating.circuits.0.operating.programs.reduced','temperature'));
    await write(`${R}.Values.hk0_prog_eco_temp`, getNum('heating.circuits.0.operating.programs.eco','temperature'));

    // Status / Pumpen
    await write(`${R}.Ctrl.mode`, getStr('heating.circuits.0.operating.modes.active','value'));
    await write(`${R}.Ctrl.circulationPump.status`, getStr('heating.circuits.0.circulation.pump','status')); // on/off
    await write(`${R}.Ctrl.primaryPump.status`, getStr('heating.dhw.pumps.primary','status'));
    await write(`${R}.Ctrl.dhwCharging.active`, getBool('heating.dhw.charging','active'));

    // Zeitpläne lesen
    const heatEntries = primaryList.find(x=>x.feature==='heating.circuits.0.heating.schedule')?.properties?.entries?.value||null;
    const heatActive  = primaryList.find(x=>x.feature==='heating.circuits.0.heating.schedule')?.properties?.active?.value??null;
    await write(`${R}.Ctrl.heatingSchedule.entries`, heatEntries?JSON.stringify(heatEntries):'');
    await write(`${R}.Ctrl.heatingSchedule.active`, !!heatActive);

    const dhwEntries  = primaryList.find(x=>x.feature==='heating.dhw.schedule')?.properties?.entries?.value||null;
    const dhwActive   = primaryList.find(x=>x.feature==='heating.dhw.schedule')?.properties?.active?.value??null;
    await write(`${R}.Ctrl.dhwSchedule.entries`, dhwEntries?JSON.stringify(dhwEntries):'');
    await write(`${R}.Ctrl.dhwSchedule.active`, !!dhwActive);

    const circEntries = primaryList.find(x=>x.feature==='heating.dhw.pumps.circulation.schedule')?.properties?.entries?.value||null;
    const circActive  = primaryList.find(x=>x.feature==='heating.dhw.pumps.circulation.schedule')?.properties?.active?.value??null;
    await write(`${R}.Ctrl.circSchedule.entries`, circEntries?JSON.stringify(circEntries):'');
    await write(`${R}.Ctrl.circSchedule.active`, !!circActive);
  }

  if(Array.isArray(gatewayList) && gatewayList.length){
    const rssi = gatewayList.find(x=>x.feature==='tcu.wifi')?.properties?.strength?.value;
    if(rssi!=null) await write(`${CFG.root}.Values.wifiRssi`, Number(rssi));
  }
}

/* ===== Brennerstunden heute ===== */
function nextLocalMidnightMs(){ const n=new Date(); const d=new Date(n.getFullYear(),n.getMonth(),n.getDate()+1,0,0,0,0); return d.getTime()-n.getTime(); }
let midnightTimer=null;
async function updateBurnerToday(totalHrs){
  const R=CFG.root;
  const base=Number((await getStateAsync(`${R}.Stats._midnightBaseHours`))?.val||0);
  const baseDate=(await getStateAsync(`${R}.Stats._midnightBaseDate`))?.val||'';
  const today=(new Date()).toISOString().slice(0,10);
  if(baseDate!==today || base===0){
    await write(`${R}.Stats._midnightBaseHours`, totalHrs||0);
    await write(`${R}.Stats._midnightBaseDate`, today);
    await write(`${R}.Stats.burnerHoursToday`, 0);
    scheduleMidnightReset(); return;
  }
  const delta=Math.max(0,(totalHrs||0)-base);
  await write(`${R}.Stats.burnerHoursToday`, Number(delta.toFixed(2)));
}
function scheduleMidnightReset(){
  if(midnightTimer){ clearTimeout(midnightTimer); midnightTimer=null; }
  const delay=Math.max(30000,nextLocalMidnightMs()+2000);
  midnightTimer=setTimeout(async ()=>{
    const total=Number((await getStateAsync(`${CFG.root}.Stats.burnerHoursTotal`))?.val||0);
    await write(`${CFG.root}.Stats._midnightBaseHours`, total);
    await write(`${CFG.root}.Stats._midnightBaseDate`, (new Date()).toISOString().slice(0,10));
    await write(`${CFG.root}.Stats.burnerHoursToday`, 0);
    scheduleMidnightReset();
  }, delay);
}

/* ===== Discovery ===== */
const uniq = arr => Array.from(new Set(arr));
function extractDeviceIdsFromAggJson(aggJson){
  try{
    const ids=[]; for(const f of (aggJson?.data||[])){ const u=String(f?.uri||''); const m=u.match(/\/devices\/([^/]+)\/features\//); if(m&&m[1]) ids.push(m[1]); }
    return uniq(ids).filter(x=>x && x!=='gateway');
  }catch{ return []; }
}
async function tryDeviceFeatures(inst,gw,dev,tried){
  const path=`/iot/v2/features/installations/${encodeURIComponent(inst)}/gateways/${encodeURIComponent(gw)}/devices/${encodeURIComponent(dev)}/features`;
  tried.push({t:'GET',path});
  const res=await getWithAuth(path);
  if(res.status>=200 && res.status<300){
    const list=res.json?.data||[];
    if(Array.isArray(list) && list.length) return {list,json:res.json,path,status:res.status};
  }
  return null;
}
function scoreList(list){
  let s=0; for(const f of list){ const n=f?.feature||''; if(!n) continue; if(n.startsWith('heating.')) s+=10; if(CFG.preferPrefixes.some(p=>n.startsWith(p))) s+=3; }
  return s;
}
async function discoverGatewayAndDevice(installationId){
  const R=CFG.root; const tried=[];

  // Aggregat
  const aggPath=`/iot/v2/features/installations/${encodeURIComponent(installationId)}/features`;
  tried.push({t:'GET',path:aggPath});
  const aggRes=await getWithAuth(aggPath);
  await write(`${R}.Raw.lastStatus`, `GET ${aggPath} → ${aggRes.status}`);
  if(aggRes?.status>=200 && aggRes?.status<300) await write(`${R}.Raw.featuresJson`, JSON.stringify(aggRes.json||{}));

  // Gateway-Features
  const storedGw=(await getStateAsync(`${R}.IDs.gatewayId`))?.val||'gateway';
  const gwRes=await tryDeviceFeatures(installationId, storedGw, 'gateway', tried);
  if(gwRes) await write(`${R}.Raw.gatewayFeaturesJson`, JSON.stringify(gwRes.json||{}));
  const gatewayList=gwRes?gwRes.list:[];

  // Kandidaten
  const storedDev=(await getStateAsync(`${R}.IDs.deviceId`))?.val||'';
  const fromUris=extractDeviceIdsFromAggJson(aggRes?.json)||[];
  const probeCsv=(await getStateAsync(`${R}.Config.deviceProbeList`))?.val||CFG.defaultProbeList.join(',');
  const candidates=uniq([storedDev, ...fromUris, ...probeCsv.split(',').map(s=>s.trim()).filter(Boolean)]).filter(Boolean);
  await write(`${R}.Raw.discovery.foundDeviceIds`, candidates.join(','));

  let best=null,bestScore=-Infinity,bestDev=null;
  for(const dev of candidates){
    const ok=await tryDeviceFeatures(installationId, storedGw, dev, tried);
    if(!ok) continue; const sc=scoreList(ok.list);
    if(sc>bestScore){ best=ok; bestScore=sc; bestDev=dev; }
    if(sc>=10) break;
  }
  await write(`${R}.Raw.discovery.triedPathsJson`, JSON.stringify(tried));
  if(best){
    await write(`${R}.IDs.gatewayId`, storedGw);
    await write(`${R}.IDs.deviceId`, bestDev);
    await write(`${R}.Raw.discovery.lastPick`, JSON.stringify({gatewayId:storedGw, deviceId:bestDev, reason:'probed'}));
    logI(`Poll OK – deviceId=${bestDev}, gatewayId=${storedGw}, items=${best.list.length}`);
    return {gatewayId:storedGw, deviceId:bestDev, primaryList:best.list, gatewayList};
  }
  if(gatewayList.length){
    await write(`${R}.Raw.discovery.lastPick`, JSON.stringify({gatewayId:storedGw, deviceId:'gateway', reason:'gateway-only'}));
    logW('Nur Gateway-Features gefunden.'); return {gatewayId:storedGw, deviceId:'gateway', primaryList:[], gatewayList};
  }
  throw new Error('Discovery: keine Device-Features ermittelbar.');
}

/* ===== Poll ===== */
async function pollOnce(){
  await ensureAccessToken(false);
  const inst=(await getStateAsync(`${CFG.root}.Config.installationId`))?.val||CFG.installationId;
  if(!inst) throw new Error('installationId fehlt.');
  const info=await discoverGatewayAndDevice(inst);
  await mapValues(info.primaryList, info.gatewayList);
}

/* ===== Loop ===== */
let pollTimer=null;
function startPolling(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer=null; }
  const ms=Number(getState(`${CFG.root}.Config.pollMs`)?.val||CFG.pollMs);
  pollTimer=setInterval(()=>{ pollOnce().catch(e=>{ write(`${CFG.root}.Raw.error`, String(e)); logW('Poll-Fehler: '+e.message); }); }, ms);
}

/* ===== Bootstrap ===== */
(async ()=>{
  await setupStates();
  if(!CFG.accessToken)    CFG.accessToken   =(await getStateAsync(`${CFG.root}.Auth.accessToken`))?.val||'';
  if(!CFG.installationId) CFG.installationId=(await getStateAsync(`${CFG.root}.Config.installationId`))?.val||'';
  if(!CFG.clientId)       CFG.clientId      =(await getStateAsync(`${CFG.root}.Auth.clientId`))?.val||'';
  if(!CFG.clientSecret)   CFG.clientSecret  =(await getStateAsync(`${CFG.root}.Auth.clientSecret`))?.val||'';
  if(!CFG.refreshToken)   CFG.refreshToken  =(await getStateAsync(`${CFG.root}.Auth.refreshToken`))?.val||'';

  scheduleMidnightReset();
  try{ await pollOnce(); }catch(e){ logW('Erster Poll: '+e.message); }
  startPolling();
})();

onStop(cb=>{ try{ if(pollTimer) clearInterval(pollTimer); if(midnightTimer) clearTimeout(midnightTimer); }catch{} cb(); }, 2000);

/* ===== Actions (Mode/Schedules/Boost) ===== */
function parseJsonSafe(s){ try{ return JSON.parse(String(s||'').trim()||'{}'); }catch{ return null; } }
async function applySchedule(inst,gw,dev,feature,jsonId){
  const payloadStr=(await getStateAsync(jsonId))?.val||''; const obj=parseJsonSafe(payloadStr);
  if(!obj||typeof obj!=='object'){ logW(`Ungültiges JSON in ${jsonId}`); return false; }
  return execCommand(inst,gw,dev,feature,'setSchedule',{ newSchedule: obj });
}
const R=CFG.root;

// Mode
on({id:`${R}.Ctrl.mode`,change:'ne'}, async o=>{
  const val=String(o.state.val||'').trim(); if(!val) return;
  const allowed=['dhw','dhwAndHeating','forcedNormal','forcedReduced','standby'];
  if(!allowed.includes(val)) return logW(`Ungültige Betriebsart: ${val}`);
  const inst=(await getStateAsync(`${R}.Config.installationId`))?.val||CFG.installationId;
  const gw=(await getStateAsync(`${R}.IDs.gatewayId`))?.val; const dev=(await getStateAsync(`${R}.IDs.deviceId`))?.val;
  if(!inst||!gw||!dev) return logW('IDs fehlen für setMode.');
  const ok=await execCommand(inst,gw,dev,'heating.circuits.0.operating.modes.active','setMode',{mode:val});
  if(ok){ logI('Betriebsart gesetzt: '+val); pollOnce().catch(()=>{}); }
});

// Heating schedule
on({id:`${R}.Ctrl.heatingSchedule.apply`,change:'ne'}, async o=>{
  if(!o.state.val) return; const inst=(await getStateAsync(`${R}.Config.installationId`))?.val||CFG.installationId;
  const gw=(await getStateAsync(`${R}.IDs.gatewayId`))?.val; const dev=(await getStateAsync(`${R}.IDs.deviceId`))?.val;
  if(!inst||!gw||!dev) return setState(o.id,false,true);
  const ok=await applySchedule(inst,gw,dev,'heating.circuits.0.heating.schedule',`${R}.Ctrl.heatingSchedule.scheduleJson`);
  if(ok){ logI('Heiz-Zeitplan gesetzt.'); pollOnce().catch(()=>{}); }
  setState(o.id,false,true);
});
on({id:`${R}.Ctrl.heatingSchedule.reset`,change:'ne'}, async o=>{
  if(!o.state.val) return; const inst=(await getStateAsync(`${R}.Config.installationId`))?.val||CFG.installationId;
  const gw=(await getStateAsync(`${R}.IDs.gatewayId`))?.val; const dev=(await getStateAsync(`${R}.IDs.deviceId`))?.val;
  if(!inst||!gw||!dev) return setState(o.id,false,true);
  const ok=await execCommand(inst,gw,dev,'heating.circuits.0.heating.schedule','resetSchedule',{});
  if(ok){ logI('Heiz-Zeitplan zurückgesetzt.'); pollOnce().catch(()=>{}); }
  setState(o.id,false,true);
});

// DHW schedule
on({id:`${R}.Ctrl.dhwSchedule.apply`,change:'ne'}, async o=>{
  if(!o.state.val) return; const inst=(await getStateAsync(`${R}.Config.installationId`))?.val||CFG.installationId;
  const gw=(await getStateAsync(`${R}.IDs.gatewayId`))?.val; const dev=(await getStateAsync(`${R}.IDs.deviceId`))?.val;
  if(!inst||!gw||!dev) return setState(o.id,false,true);
  const ok=await applySchedule(inst,gw,dev,'heating.dhw.schedule',`${R}.Ctrl.dhwSchedule.scheduleJson`);
  if(ok){ logI('WW-Zeitplan gesetzt.'); pollOnce().catch(()=>{}); }
  setState(o.id,false,true);
});
on({id:`${R}.Ctrl.dhwSchedule.reset`,change:'ne'}, async o=>{
  if(!o.state.val) return; const inst=(await getStateAsync(`${R}.Config.installationId`))?.val||CFG.installationId;
  const gw=(await getStateAsync(`${R}.IDs.gatewayId`))?.val; const dev=(await getStateAsync(`${R}.IDs.deviceId`))?.val;
  if(!inst||!gw||!dev) return setState(o.id,false,true);
  const ok=await execCommand(inst,gw,dev,'heating.dhw.schedule','resetSchedule',{});
  if(ok){ logI('WW-Zeitplan zurückgesetzt.'); pollOnce().catch(()=>{}); }
  setState(o.id,false,true);
});

// Circulation schedule + Boost (Achtung: heating.dhw.pumps.circulation.schedule)
on({id:`${R}.Ctrl.circSchedule.apply`,change:'ne'}, async o=>{
  if(!o.state.val) return; const inst=(await getStateAsync(`${R}.Config.installationId`))?.val||CFG.installationId;
  const gw=(await getStateAsync(`${R}.IDs.gatewayId`))?.val; const dev=(await getStateAsync(`${R}.IDs.deviceId`))?.val;
  if(!inst||!gw||!dev) return setState(o.id,false,true);
  const ok=await applySchedule(inst,gw,dev,'heating.dhw.pumps.circulation.schedule',`${R}.Ctrl.circSchedule.scheduleJson`);
  if(ok){ logI('Zirkulations-Zeitplan gesetzt.'); pollOnce().catch(()=>{}); }
  setState(o.id,false,true);
});
on({id:`${R}.Ctrl.circSchedule.reset`,change:'ne'}, async o=>{
  if(!o.state.val) return; const inst=(await getStateAsync(`${R}.Config.installationId`))?.val||CFG.installationId;
  const gw=(await getStateAsync(`${R}.IDs.gatewayId`))?.val; const dev=(await getStateAsync(`${R}.IDs.deviceId`))?.val;
  if(!inst||!gw||!dev) return setState(o.id,false,true);
  const ok=await execCommand(inst,gw,dev,'heating.dhw.pumps.circulation.schedule','resetSchedule',{});
  if(ok){ logI('Zirkulations-Zeitplan zurückgesetzt.'); pollOnce().catch(()=>{}); }
  setState(o.id,false,true);
});
on({id:`${R}.Ctrl.circSchedule.boostNow`,change:'ne'}, async o=>{
  if(!o.state.val) return; const inst=(await getStateAsync(`${R}.Config.installationId`))?.val||CFG.installationId;
  const gw=(await getStateAsync(`${R}.IDs.gatewayId`))?.val; const dev=(await getStateAsync(`${R}.IDs.deviceId`))?.val;
  if(!inst||!gw||!dev) { setState(o.id,false,true); return; }

  const entriesStr=(await getStateAsync(`${R}.Ctrl.circSchedule.entries`))?.val||'';
  let schedule={}; try{ schedule=entriesStr?JSON.parse(entriesStr):{}; }catch{ schedule={}; }

  const now=new Date(); const mins=Number((await getStateAsync(`${R}.Ctrl.circSchedule.boostMinutes`))?.val||CFG.defaultBoostMinutes);
  const end=new Date(now.getTime()+mins*60000);
  const pad=n=>String(n).padStart(2,'0'); const HHMM=d=>`${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dn=['sun','mon','tue','wed','thu','fri','sat'][now.getDay()];
  if(!schedule[dn]) schedule[dn]=[];
  schedule[dn].push({start:HHMM(now),end:HHMM(end),mode:'on',position:0});

  const ok=await execCommand(inst,gw,dev,'heating.dhw.pumps.circulation.schedule','setSchedule',{ newSchedule: schedule });
  if(ok){ logI(`Zirkulations-Boost ${HHMM(now)}–${HHMM(end)} gesetzt.`); await write(`${R}.Ctrl.circSchedule._restoreAt`, end.toISOString()); pollOnce().catch(()=>{}); }
  setState(o.id,false,true);
});

// Token-Buttons
on({id:`${R}.Auth.refreshNow`,change:'ne'}, async o=>{ if(!o.state.val) return; try{ await refreshAccessToken(); }catch(e){ await write(`${R}.Raw.error`, 'Refresh fehlgeschlagen: '+e.message); } setState(o.id,false,true); });
on({id:`${R}.Auth.loginHelper.generateUrl`,change:'ne'}, async o=>{
  if(!o.state.val) return setState(o.id,false,true);
  const base=`${R}.Auth`; const cid=(await getStateAsync(`${base}.clientId`))?.val||CFG.clientId; const redirect=(await getStateAsync(`${base}.redirectUri`))?.val||'http://localhost:4280/callback';
  const scope=(await getStateAsync(`${base}.scope`))?.val||'IoT User offline_access'; if(!cid) return setState(o.id,false,true);
  const {verifier,challenge}=await createPkce(); await setStateAsync(`${base}.loginHelper._codeVerifier`, verifier, true);
  const url='https://iam.viessmann-climatesolutions.com/idp/v3/authorize'
    +`?client_id=${encodeURIComponent(cid)}&response_type=code&redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(scope)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`;
  await setStateAsync(`${base}.loginHelper.authorizeUrl`, url, true);
  logI('Authorize-URL erzeugt.'); setState(o.id,false,true);
});
on({id:`${R}.Auth.loginHelper.exchangeNow`,change:'ne'}, async o=>{
  if(!o.state.val) return setState(o.id,false,true);
  const base=`${R}.Auth`; const cid=(await getStateAsync(`${base}.clientId`))?.val||CFG.clientId; const csec=(await getStateAsync(`${base}.clientSecret`))?.val||CFG.clientSecret;
  const redirect=(await getStateAsync(`${base}.redirectUri`))?.val||'http://localhost:4280/callback';
  const code=(await getStateAsync(`${base}.loginHelper.authorizationCode`))?.val||''; const verifier=(await getStateAsync(`${base}.loginHelper._codeVerifier`))?.val||'';
  if(!cid||!code||!verifier){ setState(o.id,false,true); return; }
  const form={grant_type:'authorization_code',client_id:cid,code,redirect_uri:redirect,code_verifier:verifier}; if(csec) form.client_secret=csec;
  let res=await postForm('iam.viessmann-climatesolutions.com','/idp/v3/token',form);
  if(!(res.status>=200&&res.status<300)){ res=await postForm('iam.viessmann.com','/idp/v2/token',form); if(!(res.status>=200&&res.status<300)) { await write(`${R}.Raw.error`, `Auth-Code-Exchange fehlgeschlagen (${res.status})`); setState(o.id,false,true); return; } await storeTokenResponse(res.json||{},'https://iam.viessmann.com/idp/v2/token'); }
  else { await storeTokenResponse(res.json||{},'https://iam.viessmann-climatesolutions.com/idp/v3/token'); }
  logI('Access- & Refresh-Token gespeichert.'); setState(o.id,false,true);
});