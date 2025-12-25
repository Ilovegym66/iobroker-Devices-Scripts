# Viessmann IoT v2 — ioBroker Integration (Reader)

This repository contains **three cooperating pieces** to build a robust, local-first monitoring & control setup for Viessmann (Vitodens, etc.) via the **Viessmann IoT v2 API** and ioBroker:

1) **Poller Script** (the “Script”) – reads device & feature data from Viessmann IoT v2 and mirrors them into ioBroker states.
2) **Schedule & Boost Bridge** (the “Bridge”) – writes schedules back to the API (heating / DHW / circulation) and provides a one-click **circulation boost** with automatic restore.
3) **Default‑1 Dashboard** (the “Dashboard”) – modern HTML dashboard (Default‑1 design) that renders from your ioBroker states and includes an **Oilfox** consumption panel with strong “no‑wipe” guards.

> This README uses the ioBroker state roots and IDs as in the example environment. Adjust them to your setup if required.

---

## Architecture at a Glance

```
Viessmann Cloud (IoT v2 API)
        ▲               ▲
        │               │
   (read via Poller)    │  (write via Bridge: setSchedule, setMode, Boost)
        │               │
   ioBroker States  ◄───┴───►  ioBroker States (Ctrl.* for schedules/boost)
        │
        └──► Dashboard (HTML) renders from states
                  + Oilfox aggregation/guard
```

---

## Requirements

- ioBroker **JavaScript adapter** ≥ 9.x
- Node.js (supported by your JavaScript adapter version)
- Viessmann **Developer account**, OAuth2 client and working Access Token flow (your **Poller** handles refresh)
- Valid **Installation ID**, **Gateway ID**, and **Device ID** (discoverable via your Poller or the examples below)
- (Optional) Oilfox device states, if you want the integrated Tank & Consumption cards

---

## State Roots (defaults used here)

- Viessmann root: `0_userdata.0.Geraete.ViessmannAPI`
- Dashboard output: `0_userdata.0.vis.Dashboards.VitodensHTML`
- Debug root: `0_userdata.0.vis.Dashboards.VitodensDebug`
- Oilfox device: `0_userdata.0.Geraete.Oilfox.devices.unknown_0`
- Oilfox stats: `0_userdata.0.Geraete.Oilfox.stats`
- OAuth token state: `0_userdata.0.Geraete.ViessmannAPI.Auth.access_token`

You may change these in the scripts’ `CFG` blocks if your layout differs.

---

## Quick Start (TL;DR)

1. **Poller Script (read)** – ensure your Poller is running and populates typical **V27‑style states** under `…ViessmannAPI.*` such as:
   - `Values.*` (outsideTemp, boilerTemp, c0_supplyTemp, dhwTarget, dhwActual, wifiRssi, burnerActive, burnerModulation, burnerStarts, hk0_curveSlope, hk0_curveShift, hk0_programActive, …)
   - `Stats.*` (burnerHoursTotal, burnerHoursToday, …)
   - `Ctrl.*` (mode, …) – read‑side mirrors are enough; write happens via the Bridge
   - Token refresh → writes a valid **access token** into `…Auth.access_token`

2. **Bridge (write)** – add the **Schedule & Boost Bridge** script and set **`INSTALLATION_ID` / `GATEWAY_ID` / `DEVICE_ID` / `TOKEN_STATE`** in `CFG`.  
   - It creates **Ctrl States** for the three schedules:  
     `…Ctrl.heatingSchedule.*`, `…Ctrl.dhwSchedule.*`, `…Ctrl.circSchedule.*`  
   - It accepts **setJson** to change schedules and provides **circSchedule.boostNow** + **boostMinutes**.
   - It auto-restores the original circulation schedule after the boost.

3. **Dashboard (HTML, Default‑1)** – add the Dashboard script (v3.2+) and verify the **output state** `…VitodensHTML`.  
   - Open in VIS/MinuVis via an *HTML widget* that binds to this state.
   - Oilfox “no‑wipe” guard and 7‑day/12‑month views are included.

Done. You can now see live values and operate schedules/boost from ioBroker.

---

## Detailed Installation

### A) Poller Script (read from Viessmann IoT v2)

- Use your existing IoT v2 Poller. It should:
  - Acquire and refresh the OAuth **Access Token**, stored at `…Auth.access_token`
  - Read features for your **installation / gateway / device** (e.g., device `0` and `gateway`), then map them to V27‑like ioBroker states:
    - `Values.*` (numbers/bools/strings as applicable)
    - `Stats.*` (counters/hours)
    - `Ctrl.*` (read‑side mirrors like schedules JSON, active flags, etc., if you keep them there)  
  - You don’t need to implement write commands in the Poller; the **Bridge** does that.
- If after maintenance you only get the **gateway** device, probe devices `0,1,2,3,heating,system,boiler,gateway`. In many Vitodens setups **`deviceId=0`** exposes the heating features.

> Tip: Keep a small **discovery log** (last tried paths and last found deviceIds) to diagnose changes on Viessmann’s side.

### B) Schedule & Boost Bridge (write to Viessmann)

**Purpose**: Provide state‑driven write access to schedules and a robust “circulation boost”.  
**Script name (suggestion)**: `script.js.common.Viessmann.ScheduleBridge_v27_1`

#### Configuration (in `CFG`)
- `INSTALLATION_ID`, `GATEWAY_ID`, `DEVICE_ID` – your IDs
- `TOKEN_STATE` – where the Poller writes the current Access Token
- Optional: `HTTP_TIMEOUT_MS`, default 15s
- Optional: `BOOST_MIN` default 15 minutes

#### Created / used states
Under `…ViessmannAPI.Ctrl.*` the Bridge manages:

- **Heating schedule (HK0)**
  - `heatingSchedule.entries` (string, JSON; read)
  - `heatingSchedule.active` (bool; read)
  - `heatingSchedule.setJson` (string, JSON; **write** → push to API)
- **DHW schedule**
  - `dhwSchedule.entries`, `dhwSchedule.active`, `dhwSchedule.setJson`
- **Circulation schedule**
  - `circSchedule.entries`, `circSchedule.active`, `circSchedule.setJson`
  - `circSchedule.boostMinutes` (number; default 15)
  - `circSchedule.boostNow` (bool/button; **write true** to start)
  - `circSchedule._backup` (string, JSON; internal backup)
  - `circSchedule._restoreAt` (string, ISO time; when boost ends)

#### Supported API features & commands
- `heating.circuits.0.heating.schedule` → `commands/setSchedule`
- `heating.dhw.schedule` → `commands/setSchedule`
- `heating.dhw.pumps.circulation.schedule` → `commands/setSchedule`
- (Optional extensions you can add later: `operating.modes.active/commands/setMode`, etc.)

#### JSON format for schedules
- **Heating** (allowed modes: `["normal"]`, default mode server-side: `reduced`, maxEntries: 4)
- **DHW / Circulation** (allowed modes: `["on"]`, default: `off`, maxEntries: 4)

```jsonc
{
  "mon": [ { "start": "05:00", "end": "20:30", "mode": "normal" } ],
  "tue": [ { "start": "05:00", "end": "20:30", "mode": "normal" } ],
  "wed": [ { "start": "05:00", "end": "20:30", "mode": "normal" } ],
  "thu": [ { "start": "05:00", "end": "20:30", "mode": "normal" } ],
  "fri": [ { "start": "05:00", "end": "20:30", "mode": "normal" } ],
  "sat": [ { "start": "05:00", "end": "20:30", "mode": "normal" } ],
  "sun": [ { "start": "05:00", "end": "20:30", "mode": "normal" } ]
}
```

> The Bridge normalizes time format (`HH:MM`), sorts by start time, and reindexes `position` per day. It also clamps to `maxEntries` per day if the server enforces limits.

#### Circulation **Boost** workflow
1. Set `…Ctrl.circSchedule.boostMinutes` (1…180)
2. Toggle `…Ctrl.circSchedule.boostNow = true`
3. Bridge backs up the current `circSchedule.entries`, writes a **single ON slot** for the **current weekday** for the boost window, sets `_restoreAt`, and starts a timer.
4. After expiry, Bridge restores the original schedule and clears `_restoreAt`.

Edge cases:
- If the token expires mid‑boost, the restore call will run on the same script instance; make sure your Poller refreshes tokens reliably.
- If the adapter restarts during boost, `_backup` and `_restoreAt` will survive as states; upon restart, simply re‑trigger a restore by writing the backup to `circSchedule.setJson` (or start a new boost).

### C) Dashboard (Default‑1) — v3.2+

**Purpose**: Render a clean, responsive UI from your states, including Oilfox “no‑wipe” aggregation, 7 days breakdown, and last 12 months.  
**Script name (suggestion)**: `script.js.common.Dashboards.ViessmannApi_V3_2`

- Output is written to: `0_userdata.0.vis.Dashboards.VitodensHTML`
- Open in VIS/MinuVis via an **HTML widget** bound to that state.

#### Shows (typical V27‑style mapping)
- KPIs: Outside temp, boiler temp, burner active & modulation, WiFi RSSI
- Curve: slope/shift, HK0 supply temp, WW target/actual
- Statistics: burner starts, hours (total/today)
- **Schedules**: heating, DHW, circulation (+ active badges), and **Boost** status using `…Ctrl.circSchedule._restoreAt`
- **Oilfox**: tank percent, liters, days reach, battery, last/next measurement, **last 7 days**, **last 12 months**

#### Oilfox “No‑Wipe” Guard
- States under `…Oilfox.stats`:
  - `history.dailyJson` (array of `{ date:"YYYY-MM-DD", liters:Number }`)
  - `history.monthlyMapJson` (object `{ "YYYY-MM": liters }`)
  - `history.last12MonthsJson` (array for rendering)
  - `consumption.{today|week|month|year}`
- The Dashboard implements:
  - **Import** one‑time from `last12MonthsJson` → `monthlyMapJson` (if needed)
  - **Guard/Snapshot** to prevent external “wipe to zeros” and to restore previous monthly values
  - **Recalc** that only **increases** the current month (never reduces prior months)
  - Midnight & periodic recalc and rendering debounce to reduce flicker

> If your Oilfox device uses different paths, adjust `CFG.OILFOX_BASE` and `CFG.OILFOX_STATS` in the dashboard script.

---

## Configuration Reference

### Common (used across components)
```js
// Viessmann
CFG.VIES_ROOT   = "0_userdata.0.Geraete.ViessmannAPI";
CFG.DEBUG_ROOT  = "0_userdata.0.vis.Dashboards.VitodensDebug";

// Dashboard
CFG.OUT_HTML    = "0_userdata.0.vis.Dashboards.VitodensHTML";
CFG.UPDATE_MS   = 30000; // re-render/guard cadence

// Oilfox (Dashboard)
CFG.OILFOX_BASE  = "0_userdata.0.Geraete.Oilfox.devices.unknown_0";
CFG.OILFOX_STATS = "0_userdata.0.Geraete.Oilfox.stats";
CFG.KEEP_MANUAL_MONTHS = true;

// Bridge (writing schedules)
INSTALLATION_ID, GATEWAY_ID, DEVICE_ID
TOKEN_STATE = "0_userdata.0.Geraete.ViessmannAPI.Auth.access_token"
BOOST_MIN   = 15
```

---

## Troubleshooting

**“DEVICE_NOT_FOUND (404)” or only gateway device is returned**  
- After Viessmann maintenance or API changes you may temporarily see only `deviceId=gateway`.  
  Probe other device IDs (e.g., `0,1,2,3,heating,system,boiler`) and fetch `/features` for each until heating features appear.  
- Ensure `INSTALLATION_ID` / `GATEWAY_ID` / `DEVICE_ID` are correct.

**Gateway features appear, but heating features do not**  
- Your **installation** may expose heating via `deviceId=0` while gateway telemetry is under `deviceId=gateway`.  
- Verify with:  
  `GET /iot/v2/features/installations/{inst}/gateways/{gw}/devices/0/features`

**JS adapter warns about `existsStateAsync` etc.**  
- These scripts use the **synchronous** `createState/getState` APIs, which remain supported in JS adapter 9.x.  
- Do not mix legacy asynchronous helpers unless you refactor consistently.

**Schedules not applied / rejected**  
- The server enforces max entries per day (often **4**) and specific **modes** (`"normal"` for heating; `"on"` for DHW/circulation).  
- The Bridge normalizes/limits – but ensure your JSON respects time windows (`end > start`, `HH:MM`).

**Boost didn’t restore after reboot**  
- Use `…Ctrl.circSchedule._backup` (JSON) and write it to `…Ctrl.circSchedule.setJson`.  
- Check `…Ctrl.circSchedule._restoreAt` and the Bridge debug state for errors.

**Oilfox months reset to zero**  
- The Dashboard’s guard **restores** from a snapshot or from `last12MonthsJson`.  
- Verify `…ViessmannApi_V3` debug states for guard actions and sums.

---

## Security

- Treat `…Auth.access_token` as a **secret**. Do not commit tokens to Git.
- Consider placing OAuth client credentials in ioBroker secrets or environment variables used by your Poller.

---

## FAQ

**How often does the Dashboard update?**  
Every `CFG.UPDATE_MS` (default **30s**) plus on relevant state changes (debounced). It also performs a **midnight recalc**.

**Can I change operating modes (standby / dhwAndHeating)?**  
Yes – extend the Bridge to call `heating.circuits.0.operating.modes.active/commands/setMode` with the server‑advertised constraints.

**How do I add more cards (e.g., granular sensors)?**  
Add a new card in the Dashboard and read from the corresponding `Values.*` or dedicated feature‑mapped states your Poller exposes.

---

## Versioning & Files

- **Bridge**: `Viessmann.ScheduleBridge_v27_1` (write-only side)
- **Dashboard**: `Dashboards.ViessmannApi_V3_2` (read/visual side with Oilfox guard)
- **Poller**: your existing reader/mapper for Viessmann IoT v2 → ioBroker states

We recommend keeping script filenames with **semantic suffixes** (e.g., `_v27_1`, `_v3_2`) and maintaining a small changelog in your repo.

---

## License

MIT (recommended). Update the license section according to your repository’s policy.

---

## Credits

- Viessmann Climate Solutions – IoT v2 API
- ioBroker community

---

## Appendix: Sample Schedule JSONs

**Heating (HK0)**
```json
{
  "mon": [{"start":"05:00","end":"20:30","mode":"normal"}],
  "tue": [{"start":"05:00","end":"20:30","mode":"normal"}],
  "wed": [{"start":"05:00","end":"20:30","mode":"normal"}],
  "thu": [{"start":"05:00","end":"20:30","mode":"normal"}],
  "fri": [{"start":"05:00","end":"20:30","mode":"normal"}],
  "sat": [{"start":"05:00","end":"20:30","mode":"normal"}],
  "sun": [{"start":"05:00","end":"20:30","mode":"normal"}]
}
```

**DHW**
```json
{
  "mon": [{"start":"05:00","end":"08:00","mode":"on"},
          {"start":"11:30","end":"12:30","mode":"on"},
          {"start":"18:00","end":"20:00","mode":"on"}],
  "tue": [{"start":"05:00","end":"08:00","mode":"on"},
          {"start":"11:30","end":"12:30","mode":"on"},
          {"start":"18:00","end":"20:00","mode":"on"}]
}
```

**Circulation (used for Boost too)**
```json
{
  "mon": [{"start":"05:00","end":"09:00","mode":"on"}],
  "tue": [{"start":"05:00","end":"09:00","mode":"on"}]
}
```

> For Boost, the Bridge writes a single `mode: "on"` window for the **current weekday** from “now” to `now + boostMinutes`, then restores the previous plan.
