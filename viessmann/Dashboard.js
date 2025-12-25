/***************************************************************
 * ViessmannAPI Dashboard (Default-1) – v3.4
 * Quelle: 0_userdata.0.Geraete.ViessmannAPI (V27.5-display)
 * Ausgabe: 0_userdata.0.vis.Dashboards.VitodensHTML
 ***************************************************************/
'use strict';

const CFG = {
  ROOT: '0_userdata.0.Geraete.ViessmannAPI',
  OUT:  '0_userdata.0.vis.Dashboards.VitodensHTML',
  TITLE: 'Heizung – Live',
  UPDATE_MS: 30000
};

function sGet(id){ try{ return getState(id); }catch(_){ return null; } }
function num(id,def=null){ const s=sGet(id); if(!s||s.val==null) return def;
  if(typeof s.val==='number') return isFinite(s.val)?s.val:def;
  const v=Number(String(s.val).replace(',', '.').replace(/[^0-9+\-eE.]/g,'')); return isFinite(v)?v:def; }
function str(id,def=''){ const s=sGet(id); return (s&&s.val!=null)?String(s.val):def; }
function bool(id,def=false){ const s=sGet(id); if(!s) return def; if(typeof s.val==='boolean') return s.val; const v=num(id,null); return v==null?def:(v!==0); }
function mkState(id, common, def){ try{ if(!getObject(id)) createState(id, def==null?'':def, Object.assign({read:true,write:true},common||{})); }catch{} }
function setOK(id,val){ try{ setState(id,val,true);}catch{} }
const clamp=(v,a,b)=>Math.max(a,Math.min(b, Number(v)||0));
const fmt=(n,d=1,u='')=>(n==null||Number.isNaN(n))?'–':(u?`${Number(n).toFixed(d)} ${u}`:Number(n).toFixed(d));
const fmtInt=n=>n==null?'–':String(Math.round(Number(n)));
const nowTs=()=> new Date().toLocaleString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});

const CSS = `
:root{--bg:#0f141a;--card:#171c25;--text:#e9eef5;--muted:#9aa4b2;--border:#263041;--good:#27ae60;--bad:#ff6b6b;--info:#6ecbff;--rad:14px;--gap:16px;--shadow:0 10px 22px rgba(0,0,0,.28)}
*{box-sizing:border-box} body{margin:0;color:var(--text);font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial;overflow-x:hidden}
.vito-wrap{padding:22px}
.vito-header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;background:var(--card);border:1px solid var(--border);border-radius:var(--rad);box-shadow:var(--shadow);padding:14px}
.vito-title{font-weight:800;font-size:24px}
.vito-upd{font-size:13px;color:var(--muted)!important;white-space:nowrap}
.vito-kpi{display:flex;flex-wrap:wrap;gap:var(--gap);margin-top:var(--gap)}
@media(min-width:1200px){ .vito-kpi{flex-wrap:nowrap} }
.vito-kpiItem{flex:1 1 220px;min-width:180px;background:var(--card);border:1px solid var(--border);border-radius:var(--rad);box-shadow:var(--shadow);padding:14px;display:flex;flex-direction:column;gap:6px}
.kpiLabel{font-size:12px;color:var(--muted)}
.kpiValue{font-size:28px;font-weight:800;margin-top:2px}
.vito-section{display:flex;flex-wrap:wrap;gap:var(--gap);margin-top:var(--gap)}
.vito-card{flex:1 1 calc(33.33% - var(--gap));min-width:300px;background:var(--card);border:1px solid var(--border);border-radius:var(--rad);box-shadow:var(--shadow);padding:16px}
@media(max-width:980px){.vito-card{flex:1 1 calc(50% - var(--gap))}}
@media(max-width:620px){.vito-wrap{padding:16px}.vito-card{flex:1 1 100%}}
.h{font-weight:800;margin:0 0 12px 0;font-size:18px;display:flex;align-items:center;gap:10px}
.kv{display:flex;justify-content:space-between;align-items:center;margin:10px 0}
.k{color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:10px;padding:8px 14px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,.08)}
.dot{width:12px;height:12px;border-radius:999px}
.dot.on{background:var(--good)} .dot.off{background:#7b8796}
.bar{height:12px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.08);border:1px solid var(--border)}
.bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2bd4a2,#7ae1ff)}
.small{font-size:12px;color:var(--muted)}
`;

const I = { flame:'🔥', pump:'🔄', thermo:'🌡️', stats:'📈', cal:'🗓️', wifi:'📶', mode:'🎛️' };
const badge = (on,label)=>`<span class="badge"><span class="dot ${on?'on':'off'}"></span><span>${label}</span></span>`;
const bar = (v)=>`<div class="bar"><i style="width:${clamp(v,0,100)}%"></i></div>`;

function parseSchedule(jsonStr){ try{ const j=jsonStr?JSON.parse(jsonStr):null; return j&&typeof j==='object'?j:null; }catch{ return null; } }
const WEEK=['mon','tue','wed','thu','fri','sat','sun'], WEEK_DE={mon:'Mo',tue:'Di',wed:'Mi',thu:'Do',fri:'Fr',sat:'Sa',sun:'So'};
function scheduleToHtml(schedule,labelMode){
  if(!schedule) return '<div class="small">–</div>';
  const rows=[]; for(const d of WEEK){
    const arr=Array.isArray(schedule[d])?schedule[d]:[]; if(!arr.length){ rows.push(`<div class="kv"><span class="k">${WEEK_DE[d]}</span><b>–</b></div>`); continue; }
    const items=arr.slice().sort((a,b)=>String(a.start).localeCompare(String(b.start))).map(e=>`${e.start}–${e.end}${e.mode?` (${e.mode})`:''}`).join(', ');
    rows.push(`<div class="kv"><span class="k">${WEEK_DE[d]}</span><b>${items}</b></div>`);
  } return rows.join('');
}

function buildHtml(){
  const V = (p)=>`${CFG.ROOT}.Values.${p}`, C=(p)=>`${CFG.ROOT}.Ctrl.${p}`;

  const AT = num(V('outsideTemp')), Boiler=num(V('boilerTemp')), VL0=num(V('c0_supplyTemp'));
  const DHW_Ist=num(V('dhwActual')), DHW_Soll=num(V('dhwTarget'));
  const WiFi=num(V('wifiRssi'));

  const BurnerAct=bool(V('burnerActive')), Mod=num(V('burnerModulation'));
  const HrsTot=num(`${CFG.ROOT}.Stats.burnerHoursTotal`), HrsDay=num(`${CFG.ROOT}.Stats.burnerHoursToday`);
  const Starts=num(V('burnerStarts'));

  const HKName=str(V('hk0_name')), HKProg=str(V('hk0_programActive'),'–');
  const CurveSlope=num(V('hk0_curveSlope')), CurveShift=num(V('hk0_curveShift'));

  const ProgN=num(V('hk0_prog_normal_temp')), ProgR=num(V('hk0_prog_reduced_temp')), ProgE=num(V('hk0_prog_eco_temp'));

  const Mode=str(C('mode')); const Circ=str(C('circulationPump.status')); const Prim=str(C('primaryPump.status')); const DhwCh=bool(C('dhwCharging.active'));

  const heatSched=parseSchedule(str(C('heatingSchedule.entries'))), heatActive=bool(C('heatingSchedule.active'));
  const dhwSched =parseSchedule(str(C('dhwSchedule.entries'))),   dhwActive =bool(C('dhwSchedule.active'));
  const circSched=parseSchedule(str(C('circSchedule.entries'))),  circActive=bool(C('circSchedule.active'));
  const boostUntil=str(C('circSchedule._restoreAt'),''); const boostOn=!!boostUntil;

  return `
<style>${CSS}</style>
<div class="vito-wrap">
  <div class="vito-header">
    <div class="vito-title">🏠 ${CFG.TITLE}${HKName?` · ${HKName}`:''}</div>
    <div class="vito-upd">Letzte Aktualisierung: ${nowTs()}</div>
  </div>

  <div class="vito-kpi">
    <div class="vito-kpiItem"><div class="kpiLabel">Außen</div><div class="kpiValue">${fmt(AT,1,'°C')}</div></div>
    <div class="vito-kpiItem"><div class="kpiLabel">Kessel</div><div class="kpiValue">${fmt(Boiler,1,'°C')}</div></div>
    <div class="vito-kpiItem"><div class="kpiLabel">Vorlauf HK0</div><div class="kpiValue">${fmt(VL0,1,'°C')}</div></div>
    <div class="vito-kpiItem"><div class="kpiLabel">WW (Ist/Soll)</div><div class="kpiValue">${fmt(DHW_Ist,1,'°C')} / ${fmt(DHW_Soll,0,'°C')}</div></div>
    <div class="vito-kpiItem"><div class="kpiLabel">Brenner</div><div class="kpiValue">${badge(BurnerAct, BurnerAct?'aktiv':'aus')}</div></div>
    <div class="vito-kpiItem"><div class="kpiLabel">Modulation</div><div class="kpiValue">${fmt(clamp(Mod,0,100),1,'%')}</div>${bar(clamp(Mod||0,0,100))}</div>
    <div class="vito-kpiItem"><div class="kpiLabel">WiFi RSSI</div><div class="kpiValue">${WiFi!=null?`${WiFi} dBm`:'–'}</div></div>
  </div>

  <div class="vito-section">
    <div class="vito-card">
      <div class="h">${I.mode} Betriebsart & Heizkurve</div>
      <div class="kv"><span class="k">Betriebsart</span><b>${Mode||'–'}</b></div>
      <div class="kv"><span class="k">Programm aktiv</span><b>${HKProg}</b></div>
      <div class="kv"><span class="k">Heizkurve</span><b>Steigung ${fmt(CurveSlope,1,'')} / Niveau ${fmt(CurveShift,0,'')}</b></div>
      <div class="kv"><span class="k">Programm (normal)</span><b>${fmt(ProgN,0,'°C')}</b></div>
      <div class="kv"><span class="k">Programm (reduced)</span><b>${fmt(ProgR,0,'°C')}</b></div>
      <div class="kv"><span class="k">Programm (eco)</span><b>${fmt(ProgE,0,'°C')}</b></div>
    </div>

    <div class="vito-card">
      <div class="h">${I.pump} Pumpen & Ladung</div>
      <div class="kv"><span class="k">Zirkulationspumpe</span><b>${badge(Circ==='on','on')}</b></div>
      <div class="kv"><span class="k">Ladepumpe (primary)</span><b>${badge(Prim==='on','on')}</b></div>
      <div class="kv"><span class="k">WW-Ladung aktiv</span><b>${badge(DhwCh,'aktiv')}</b></div>
      <div class="kv"><span class="k">Zirkulation – Boost</span><b>${boostOn?`<span class="badge"><span class="dot on"></span>bis ${new Date(boostUntil).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</span>`:'<span class="badge"><span class="dot off"></span>aus</span>'}</b></div>
    </div>

    <div class="vito-card">
      <div class="h">${I.stats} Statistik</div>
      <div class="kv"><span class="k">Brennerstunden (heute)</span><b>${fmt(HrsDay,2,'h')}</b></div>
      <div class="kv"><span class="k">Brennerstunden (gesamt)</span><b>${fmt(HrsTot,0,'h')}</b></div>
      <div class="kv"><span class="k">Brennerstarts</span><b>${fmtInt(Starts)}</b></div>
      <div class="kv"><span class="k">Gerendert</span><b>${nowTs()}</b></div>
    </div>
  </div>

  <div class="vito-section">
    <div class="vito-card">
      <div class="h">${I.cal} Heizung – Zeitplan (HK0)</div>
      <div class="kv"><span class="k">aktiv?</span><b>${badge(!!heatActive, heatActive?'ja':'nein')}</b></div>
      ${scheduleToHtml(heatSched,'normal')}
    </div>
    <div class="vito-card">
      <div class="h">${I.cal} Warmwasser – Zeitplan</div>
      <div class="kv"><span class="k">aktiv?</span><b>${badge(!!dhwActive, dhwActive?'ja':'nein')}</b></div>
      ${scheduleToHtml(dhwSched,'on')}
    </div>
    <div class="vito-card">
      <div class="h">${I.cal} Zirkulation – Zeitplan</div>
      <div class="kv"><span class="k">aktiv?</span><b>${badge(!!circActive, circActive?'ja':'nein')}</b></div>
      ${scheduleToHtml(circSched,'on')}
      <div class="small">${boostOn?`Boost aktiv bis ${new Date(boostUntil).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}.`:'Kein aktiver Boost.'}</div>
    </div>
  </div>
</div>`;
}

function render(){
  try{
    mkState(CFG.OUT,{type:'string',role:'html',read:true,write:true},'');
    const html=buildHtml(); const prev=(sGet(CFG.OUT)?.val)||'';
    if(html!==prev) setOK(CFG.OUT, html);
  }catch(err){
    mkState(`${CFG.ROOT}.Raw.dashboardError`,{type:'string',read:true,write:true},'');
    setOK(`${CFG.ROOT}.Raw.dashboardError`, `${new Date().toISOString()} ${err && err.stack || err}`);
  }
}

let t=null; function queue(){ if(t) return; t=setTimeout(()=>{ t=null; render(); },400); }

// Initial + Watch
render();
const watchIds=[
  'Values.outsideTemp','Values.boilerTemp','Values.c0_supplyTemp','Values.dhwActual','Values.dhwTarget',
  'Values.burnerActive','Values.burnerModulation','Values.burnerStarts',
  'Values.hk0_curveSlope','Values.hk0_curveShift','Values.hk0_programActive','Values.hk0_name',
  'Values.hk0_prog_normal_temp','Values.hk0_prog_reduced_temp','Values.hk0_prog_eco_temp',
  'Values.wifiRssi',
  'Stats.burnerHoursTotal','Stats.burnerHoursToday',
  'Ctrl.mode','Ctrl.circulationPump.status','Ctrl.primaryPump.status','Ctrl.dhwCharging.active',
  'Ctrl.heatingSchedule.entries','Ctrl.heatingSchedule.active',
  'Ctrl.dhwSchedule.entries','Ctrl.dhwSchedule.active',
  'Ctrl.circSchedule.entries','Ctrl.circSchedule.active','Ctrl.circSchedule._restoreAt'
].map(p=>`${CFG.ROOT}.${p}`);
on(watchIds.map(id=>({id,change:'ne'})), ()=>queue());
if(CFG.UPDATE_MS>=5000) setInterval(queue, CFG.UPDATE_MS);