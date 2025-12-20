# Technitium DNS Server – ioBroker JavaScript 

This repository contains an ioBroker JavaScript (tested with JavaScript Adapter **9.0.11**) that connects to **Technitium DNS Server** via its HTTP API and exposes core states and controls inside ioBroker.

Primary use case: **enable/disable Technitium DNS Blocking** from ioBroker (Technitium setting `enableBlocking`).

---

## Features

- **Read status** from Technitium DNS Server (polling)
  - Connection/health states
  - Current `enableBlocking` value
  - Basic server info (version/domain/uptime timestamp – if provided by the API)
- **Control from ioBroker**
  - Toggle **Blocking** (`enableBlocking`) on/off (writable state)
  - Flush DNS cache (button state)
  - Manual refresh (button state)
- **Optional**
  - Dashboard statistics JSON (polls Technitium dashboard stats endpoint)

---

## Requirements

- ioBroker with **JavaScript Adapter 9.0.11** (or newer)
- Technitium DNS Server reachable from ioBroker (default Web Console/API port: **5380**)

---

## Installation

1. Open ioBroker Admin → **Scripts** (JavaScript adapter).
2. Create a new script (type: JavaScript) and paste the script content.
3. Adjust the configuration block at the top of the script:

   - `HOST`, `PORT`, `HTTPS`
   - Optional reverse proxy prefix: `BASE_PATH`
   - Choose authentication:
     - **Recommended:** set `API_TOKEN`
     - Alternative: set `USER` / `PASS` (and `TOTP` if 2FA is enabled)

4. Start/enable the script.

---

## Authentication (Recommended: API Token)

Technitium supports API tokens designed for automation. Create a token using Technitium’s API (`/api/user/createToken`) or via the Technitium UI (depending on your setup), then paste it into:

- `CFG.API_TOKEN`

This avoids session expiry and reduces re-login logic.

---

## ioBroker States

All states are created under:

- `0_userdata.0.Geraete.TechnitiumDNS`

Key states:

- `...info.connected`  
  Indicates whether polling was successful.

- `...settings.enableBlocking` (read-only)  
  Current server-side blocking status.

- `...control.enableBlocking` (write)  
  Toggle this to enable/disable blocking on the DNS server.

- `...control.flushCache` (button)  
  Set to `true` to flush the DNS cache (the script resets it back to `false`).

- `...control.refresh` (button)  
  Set to `true` to trigger an immediate poll (the script resets it back to `false`).

- `...raw.settingsJson` / `...raw.dashboardStatsJson`  
  Raw JSON responses (stringified) for troubleshooting/visualizations.

---

## Usage

### Enable/Disable DNS Blocking

- Toggle:
  - `0_userdata.0.Geraete.TechnitiumDNS.control.enableBlocking`

The script writes the new value to Technitium and then polls again to sync all states.

### Flush DNS Cache

- Set:
  - `0_userdata.0.Geraete.TechnitiumDNS.control.flushCache` → `true`

---

## Troubleshooting

- Check:
  - `...info.lastError`
  - `...info.connected`
- Verify network access to the Technitium Web Console/API endpoint (host/port).
- If using HTTPS with a self-signed certificate, set:
  - `IGNORE_TLS_ERRORS: true`

---

## Disclaimer

This is an unofficial community script. Use at your own risk and test changes carefully in your environment.
