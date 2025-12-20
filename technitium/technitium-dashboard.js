/**************************************************************
 * Technitium DNS Dashboard – VIS HTML
 * Output: 0_userdata.0.vis.Dashboards.technitiumHTML
 *
 * Reads:
 *  - 0_userdata.0.Geraete.TechnitiumDNS.raw.dashboardStatsJson
 *  - 0_userdata.0.Geraete.TechnitiumDNS.settings.enableBlocking
 *  - 0_userdata.0.Geraete.TechnitiumDNS.info.connected / lastUpdate
 **************************************************************/
'use strict';

const CFG = {
  TECH_ROOT: '0_userdata.0.Geraete.TechnitiumDNS',
  IN_STATS_JSON: '0_userdata.0.Geraete.TechnitiumDNS.raw.dashboardStatsJson',
  OUT_HTML: '0_userdata.0.vis.Dashboards.technitiumHTML',

  UPDATE_MS: 30_000,

  // Theme (optional): wenn du Default-1 CSS/Frame nutzt, hier deine Pfade eintragen.
  // Wenn leer -> Script rendert standalone CSS.
  THEME_CSS_STATE: '',   // z.B. '0_userdata.0.vis.Templates.Default1.css'
  THEME_FRAME_STATE: ''  // z.B. '0_userdata.0.vis.Templates.Default1.frameHtml'
};

function existsDP(id){ try{ return existsState(id); } catch { return false; } }
function gv(id, def=null){
  try{
    if(!existsDP(id)) return def;
    const s = getState(id);
    return s ? s.val : def;
  }catch{ return def; }
}
function ensureStateIfMissing(id, initial, common){
  try{
    if(!existsDP(id)) createState(id, initial, common || {});
  }catch(e){
    // ignore
  }
}
function nowIso(){
  const d=new Date(); const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function esc(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}
function num(n, digits=0){
  const x = Number(n);
  if (!isFinite(x)) return '0';
  return x.toLocaleString('de-DE', { maximumFractionDigits: digits });
}
function parseJson(str){
  try{
    if (!str) return null;
    if (typeof str === 'object') return str; // falls jemand mal objekt direkt schreibt
    return JSON.parse(String(str));
  }catch{ return null; }
}
function pickDataset(chartData, label){
  const ds = (chartData && chartData.datasets) ? chartData.datasets : [];
  return ds.find(d => d && d.label === label) || null;
}
function toLocalTimeLabel(isoZ){
  // input wie 2025-12-20T12:26:00.0000000Z
  try{
    const d = new Date(isoZ);
    if (isNaN(d.getTime())) return '';
    const p=n=>String(n).padStart(2,'0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }catch{ return ''; }
}

function buildHtml(statsObj, meta){
  const themeCss = CFG.THEME_CSS_STATE ? gv(CFG.THEME_CSS_STATE,'') : '';
  const frame = CFG.THEME_FRAME_STATE ? gv(CFG.THEME_FRAME_STATE,'') : '';

  const connected = !!meta.connected;
  const blocking = !!meta.blocking;
  const lastUpdate = meta.lastUpdate || '';

  const s = (statsObj && statsObj.stats) ? statsObj.stats : {};
  const total = s.totalQueries || 0;

  const kpis = [
    { k:'Total Queries', v:num(s.totalQueries||0), sub:'All responses' },
    { k:'No Error', v:num(s.totalNoError||0), sub:'RCODE: NOERROR' },
    { k:'NXDOMAIN', v:num(s.totalNxDomain||0), sub:'RCODE: NXDOMAIN' },
    { k:'Server Failure', v:num(s.totalServerFailure||0), sub:'RCODE: SERVFAIL' },
    { k:'Refused', v:num(s.totalRefused||0), sub:'RCODE: REFUSED' },
    { k:'Blocked', v:num(s.totalBlocked||0), sub:'Blocking engine' },
    { k:'Dropped', v:num(s.totalDropped||0), sub:'Dropped queries' },
    { k:'Cached', v:num(s.totalCached||0), sub:'Served from cache' },
    { k:'Clients', v:num(s.totalClients||0), sub:'Unique clients' },
    { k:'Zones', v:num(s.zones||0), sub:'Configured zones' },
    { k:'Cache Entries', v:num(s.cachedEntries||0), sub:'Current entries' }
  ];

  // Donut: queryResponseChartData
  const qResp = statsObj ? statsObj.queryResponseChartData : null;
  const donutLabels = (qResp && qResp.labels) ? qResp.labels : [];
  const donutData = (qResp && qResp.datasets && qResp.datasets[0] && qResp.datasets[0].data) ? qResp.datasets[0].data : [];

  // Line: mainChartData (reduziert)
  const main = statsObj ? statsObj.mainChartData : null;
  const labelsIso = (main && main.labels) ? main.labels : [];
  const labels = labelsIso.map(toLocalTimeLabel);

  const dsTotal = pickDataset(main,'Total');
  const dsNoErr = pickDataset(main,'No Error');
  const dsNX = pickDataset(main,'NX Domain');
  const dsBlocked = pickDataset(main,'Blocked');
  const dsClients = pickDataset(main,'Clients');

  // wir nehmen nur diese 5; falls null -> leere arrays
  const series = {
    Total: dsTotal ? dsTotal.data : [],
    'No Error': dsNoErr ? dsNoErr.data : [],
    NXDOMAIN: dsNX ? dsNX.data : [],
    Blocked: dsBlocked ? dsBlocked.data : [],
    Clients: dsClients ? dsClients.data : []
  };

  // Simple status badge
  const statusText = connected ? 'Connected' : 'Offline';
  const blockText = blocking ? 'Blocking: ON' : 'Blocking: OFF';

  const baseCss = `
    :root{
      --bg:#0f1115; --card:#151924; --card2:#111522;
      --text:#e8eaf0; --muted:#9aa3b2; --accent:#6699ff;
      --good:#5cb85c; --warn:#f0ad4e; --bad:#d9534f;
      --radius:16px;
    }
    *{box-sizing:border-box}
    body{margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif; color:var(--text); background:var(--bg);}
    .wrap{padding:16px}
    .header{
      display:flex; gap:12px; align-items:center; justify-content:space-between;
      padding:14px 16px; border-radius:var(--radius);
      background:linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
      border:1px solid rgba(255,255,255,0.08);
    }
    .title{font-size:18px; font-weight:700; letter-spacing:0.2px}
    .sub{font-size:12px; color:var(--muted)}
    .badges{display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end}
    .badge{
      padding:6px 10px; border-radius:999px; font-size:12px; font-weight:600;
      border:1px solid rgba(255,255,255,0.10);
      background:rgba(255,255,255,0.04);
    }
    .badge.good{border-color:rgba(92,184,92,0.4); background:rgba(92,184,92,0.12)}
    .badge.bad{border-color:rgba(217,83,79,0.4); background:rgba(217,83,79,0.12)}
    .badge.accent{border-color:rgba(102,153,255,0.45); background:rgba(102,153,255,0.12)}

    .grid{
      display:grid; gap:12px; margin-top:12px;
      grid-template-columns: repeat(12, 1fr);
    }
    .card{
      border-radius:var(--radius);
      background:rgba(255,255,255,0.04);
      border:1px solid rgba(255,255,255,0.08);
      padding:12px;
      overflow:hidden;
    }
    .kpi{grid-column: span 3;}
    @media (max-width: 1100px){ .kpi{grid-column: span 4;} }
    @media (max-width: 720px){ .kpi{grid-column: span 6;} }
    @media (max-width: 420px){ .kpi{grid-column: span 12;} }

    .k{font-size:12px; color:var(--muted); margin-bottom:6px}
    .v{font-size:22px; font-weight:800}
    .s{font-size:11px; color:var(--muted); margin-top:2px}

    .chartWide{grid-column: span 8; min-height:320px}
    .chartSide{grid-column: span 4; min-height:320px}
    @media (max-width: 1100px){ .chartWide{grid-column: span 12;} .chartSide{grid-column: span 12;} }

    .cardTitle{display:flex; align-items:center; justify-content:space-between; margin-bottom:8px}
    .cardTitle h3{margin:0; font-size:13px; letter-spacing:0.2px; color:var(--text)}
    .hint{font-size:11px; color:var(--muted)}

    canvas{width:100% !important; height:260px !important;}
    .footer{margin-top:12px; font-size:11px; color:var(--muted)}
    .mono{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;}
  `;

  // Build KPI HTML
  const kpiHtml = kpis.map(x => `
    <div class="card kpi">
      <div class="k">${esc(x.k)}</div>
      <div class="v">${esc(x.v)}</div>
      <div class="s">${esc(x.sub)}</div>
    </div>
  `).join('');

  // Inline JS data for charts
  const dataJs = {
    labels,
    series,
    donutLabels,
    donutData
  };

  const htmlCore = `
  <div class="wrap">
    <div class="header">
      <div>
        <div class="title">Technitium DNS</div>
        <div class="sub">Updated: <span class="mono">${esc(lastUpdate || nowIso())}</span></div>
      </div>
      <div class="badges">
        <div class="badge ${connected ? 'good' : 'bad'}">${esc(statusText)}</div>
        <div class="badge accent">${esc(blockText)}</div>
        <div class="badge">${esc('Total: ' + num(total))}</div>
      </div>
    </div>

    <div class="grid">
      ${kpiHtml}

      <div class="card chartWide">
        <div class="cardTitle">
          <h3>Queries over time</h3>
          <div class="hint">Total / No Error / NXDOMAIN / Blocked / Clients</div>
        </div>
        <canvas id="tt_line"></canvas>
      </div>

      <div class="card chartSide">
        <div class="cardTitle">
          <h3>Response breakdown</h3>
          <div class="hint">Authoritative / Recursive / Cached / Blocked / Dropped</div>
        </div>
        <canvas id="tt_donut"></canvas>
      </div>
    </div>

    <div class="footer">
      Rendered by ioBroker script • States: <span class="mono">${esc(CFG.TECH_ROOT)}</span>
    </div>
  </div>

  <script>
    (function(){
      // Load Chart.js once
      function loadScriptOnce(src, cb){
        var existing = document.querySelector('script[data-tt-chartjs="1"]');
        if(existing){ cb(); return; }
        var s=document.createElement('script');
        s.src=src; s.async=true; s.dataset.ttChartjs="1";
        s.onload=cb;
        s.onerror=function(){ console.log('Chart.js failed to load'); cb(true); };
        document.head.appendChild(s);
      }

      var DATA = ${JSON.stringify(dataJs)};

      function buildCharts(){
        if (!window.Chart || !document.getElementById('tt_line')) return;

        // Line chart
        var ctxL = document.getElementById('tt_line').getContext('2d');
        var line = new Chart(ctxL, {
          type: 'line',
          data: {
            labels: DATA.labels,
            datasets: [
              { label:'Total', data: DATA.series['Total'] || [], tension:0.25, borderWidth:2, pointRadius:0, fill:false },
              { label:'No Error', data: DATA.series['No Error'] || [], tension:0.25, borderWidth:2, pointRadius:0, fill:false },
              { label:'NXDOMAIN', data: DATA.series['NXDOMAIN'] || [], tension:0.25, borderWidth:2, pointRadius:0, fill:false },
              { label:'Blocked', data: DATA.series['Blocked'] || [], tension:0.25, borderWidth:2, pointRadius:0, fill:false },
              { label:'Clients', data: DATA.series['Clients'] || [], tension:0.25, borderWidth:2, pointRadius:0, fill:false }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
            scales: {
              x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
              y: { beginAtZero: true }
            }
          }
        });

        // Donut chart
        var ctxD = document.getElementById('tt_donut').getContext('2d');
        var donut = new Chart(ctxD, {
          type: 'doughnut',
          data: {
            labels: DATA.donutLabels || [],
            datasets: [{ data: DATA.donutData || [] }]
          },
          options: {
            responsive:true,
            maintainAspectRatio:false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }
          }
        });
      }

      loadScriptOnce('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js', function(){
        try { buildCharts(); } catch(e){ console.log(e); }
      });
    })();
  </script>
  `;

  // Wenn du ein Frame-Template nutzt, kannst du es hier „einbetten“:
  // - frame sollte idealerweise Platzhalter wie {content} enthalten
  if (frame && String(frame).includes('{content}')) {
    return String(frame).replace('{content}', `<style>${themeCss || baseCss}</style>${htmlCore}`);
  }

  // Default: standalone
  const cssFinal = themeCss && themeCss.trim() ? themeCss : baseCss;
  return `<style>${cssFinal}</style>\n${htmlCore}`;
}

function updateDashboard() {
  ensureStateIfMissing(CFG.OUT_HTML, '', { type:'string', role:'html', read:true, write:false });

  const raw = gv(CFG.IN_STATS_JSON, '');
  const statsObj = parseJson(raw);

  const meta = {
    connected: gv(`${CFG.TECH_ROOT}.info.connected`, false),
    lastUpdate: gv(`${CFG.TECH_ROOT}.info.lastUpdate`, ''),
    blocking: gv(`${CFG.TECH_ROOT}.settings.enableBlocking`, false)
  };

  const html = buildHtml(statsObj || {}, meta);
  setState(CFG.OUT_HTML, html, true);
}

/*** Start ***/
updateDashboard();
const t = setInterval(updateDashboard, CFG.UPDATE_MS);
onStop(() => { try { clearInterval(t); } catch {} }, 1000);

// Optional: schneller rebuild wenn neue Stats kommen
on({ id: CFG.IN_STATS_JSON, change: 'ne' }, () => updateDashboard());
on({ id: `${CFG.TECH_ROOT}.settings.enableBlocking`, change: 'ne' }, () => updateDashboard());
on({ id: `${CFG.TECH_ROOT}.info.connected`, change: 'ne' }, () => updateDashboard());
on({ id: `${CFG.TECH_ROOT}.info.lastUpdate`, change: 'ne' }, () => updateDashboard());
