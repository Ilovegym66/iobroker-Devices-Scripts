Synology DSM + Surveillance for ioBroker (API-first, JS9-ready)
============================================================================

Overview
--------
A single JavaScript that replaces multiple adapters by talking directly to Synology DSM 7 APIs and Surveillance Station. It discovers your NAS, exposes rich system metrics as ioBroker states, renders HTML dashboards, and adds a snapshot workflow for cameras (including Discord/Synology Chat routing and optional auto-deletion). Optimized for the ioBroker JavaScript adapter >= 9.0.11.

Highlights
----------
- API-first, no external adapters
  - Auth via SYNO.API.Auth (DSM 7, token + SID)
  - Automatic API map discovery (SYNO.API.Info) and versioning
  - Robust re-login on 119 Unauthorized, keep-alive HTTP(S)

- Deep DSM telemetry
  - System info: model, DSM version, uptime, NTP, firmware
  - Live utilization: CPU (user/system/wait/total), load (1/5/15), RAM size/used
  - Network: interface inventory with IPv4/IPv6, link speed, aggregated Rx/Tx rates (kB/s) incl. OVS/bond members
  - Storage: pools, volumes (total/used/free), disks (model, health, temp, size, utilization)
  - Docker: container list with status, image, ports, CPU% and RAM MB
  - VMM: guests with power state, vCPU/RAM, live CPU% and used RAM
  - Sessions: active connections summary

- Surveillance Station integration
  - Camera list and per-camera states: enabled, connected, recording, recStatus, id
  - Snapshot URLs (API + VIS-friendly HTTP mapping)
  - Per-camera control state:
      "snap" / "snapshot" -> capture and route image
      "say <text>"        -> send text to your notification channel
  - Snapshot pipeline:
      Fetch via Camera.GetSnapshot (dedicated session for reliability)
      Save under 0_userdata.0/screenshots/*.jpg
      Route to Discord (sendFile) and/or Synology Chat (optional)
      Public URL for VIS via ioBroker Web adapter
      Optional auto-delete after N seconds
  - Optional Data-URI snapshots per camera (.snapshotDataUri) and a persistent "live.jpg" per camera for simple dashboards

- Dashboards out-of-the-box
  - Main HTML dashboard with system, network, storage, Docker, VMM, and camera summary
  - Surveillance HTML dashboard with snapshot thumbnails
  - Minimal "SurvMini.html" (grid of chosen cameras), written to 0_userdata.0/<path> for embedding (e.g., MinuVis/iFrame)
  - Auto-refresh of thumbnails via cache-buster ?ts=...

- Alerts (Discord)
  - System temperature high
  - Disk health issues / hot disks
  - Cameras offline
  - Cooldown to avoid spam

- Efficient & JS9-friendly
  - Change-only writes to reduce state churn
  - Safe timing and write limits
  - Works with ioBroker JS adapter >= 9.0.11 (no deprecated APIs)

State Layout (excerpt)
----------------------
0_userdata.0.Geraete.Synology
  Info.*
  Utilization.cpu.*, Utilization.memory.*, Load.*
  Network.Interfaces.<if>.(up|mac|ipv4|ipv6|speed|rx_kBps|tx_kBps)
  Storage.Pools.*, Storage.Volumes.*, Storage.Disks.*
  Docker.Containers.<name>.(status|cpu|memMB|image|ports)
  VMM.VMs.<name>.(power|cpu.vcpu|cpu.usage|ramMB.total|ramMB.used|diskGB.total)
  Sessions.(count|listJson)

  Surveillance.Cameras.<cameraKey>.
    id, title, enabled, connected, recording, recStatus
    snapshotUrl, snapshotUrlVis, snapshotDataUri, snapshotFileUrl
    control  (write: "snap", "snapshot", or "say <text>")

Dashboards
----------
- 0_userdata.0.vis.Dashboards.Synology (HTML)
- <img width="800" height="230" alt="Screenshot 2025-12-15 at 15 11 24" src="https://github.com/user-attachments/assets/c55e2759-e69f-456c-9029-8fe3031ef604" />

- 0_userdata.0.vis.Dashboards.Surveillance (HTML)
- <img width="800" height="157" alt="Screenshot 2025-12-15 at 15 12 37" src="https://github.com/user-attachments/assets/bf66ef9f-411e-4550-8b24-6a7e4014cc08" />

- Optional file output: 0_userdata.0/<your-path>/SurvMini.html

Requirements
------------
- Synology DSM 7.x (Surveillance Station installed for camera features)
- ioBroker JavaScript adapter >= 9.0.11
- ioBroker Web adapter (to serve files under /files/0_userdata.0/...)
- Optional: Discord adapter (or “router” states) and/or Synology Chat
- If using OTP: an ioBroker state for the code (supported)

Configuration (key points)
--------------------------
- NAS: HOST, PORT, HTTPS
- Credentials: USER, PASS, optional OTP
- Files/URLs:
  - IOB_FILES_BASE (public URL base of ioBroker Web)
  - IOB_FILES_ADAPTER (usually 0_userdata.0)
  - IOB_FILES_DIRS (e.g., /screenshots)
  - VIS_HTTP (host/port mapping for snapshot preview in browsers/MinuVis)
- Surveillance:
  - Enable flags for modules (UTILIZATION/NETWORK/STORAGE/DOCKER/VMM/SURVEILLANCE/DASHBOARD)
  - SURV_DATAURI (for data-URIs and per-camera live files)
  - SURV_MINI_HTML (small HTML wall of cameras; list of keys to show)
- Routing:
  - DISCORD_SEND_TEXT, DISCORD_SEND_FILE
  - SYNOCHAT_ENABLED, SYNOCHAT_SEND_FILE (optional)
- Timing:
  - POLL_MS, LONG_POLL_MS, START_DELAY_MS
  - SNAP_DELETE_MS (auto-delete delay; 0 to keep files)

Usage
-----
1) Paste the script into the ioBroker JavaScript instance.
2) Configure CFG (host/port, credentials, Web adapter base URL, Discord/SynoChat routing, optional OTP).
3) Start the script. It will:
   - Log in, discover APIs, and populate states under 0_userdata.0.Geraete.Synology.
   - Render HTML dashboards (states and/or files).
   - Enumerate cameras and publish snapshot URLs.
4) Trigger a snapshot:
   - Write "snap" to ...Surveillance.Cameras.<cameraKey>.control, or
   - Use the debug command state (if included), or
   - Send "say <text>" to push a text message to your notification channel.
5) Embed the HTML states/files in your VIS/MinuVis.

Notes & Tips
------------
- If you see ERR_INVALID_PROTOCOL, align your VIS_HTTP mapping with how you serve files (HTTP vs HTTPS) and your Surveillance Station port.
- Duplicate postings usually indicate multiple routers enabled; keep only Discord or Synology Chat (or use the provided single-send routine).
- Camera booleans (enabled, connected, recording) are derived from Surveillance Station’s fields and normalized; exact semantics may vary by camera/firmware.

License
-------
MIT. Use at your own risk. This script interacts with private APIs; endpoints and fields may change across DSM/Surveillance versions.
