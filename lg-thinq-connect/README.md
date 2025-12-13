# LG ThinQ – ioBroker Script Adapter (ThinQ Connect PAT)

JavaScript-based adapter replacement for LG ThinQ devices using the **ThinQ Connect** API and a Personal Access Token (PAT).

This script is designed for the ioBroker JavaScript engine and creates a clean state structure under `0_userdata.0.Geraete.LGThinQ.*` for refrigerators, washing machines and dryers.

> ⚠️ **Important:** Do **not** commit or share your real ThinQ PAT or API key.  
> The script contains a placeholder `API_KEY` constant which you must fill locally. Keep it **out of Git**.

---

## ✨ Features

- Login via **ThinQ Connect PAT** (no username/password in the script)
- Polling of:
  - `GET /devices`
  - `GET /devices/{id}/state`
- For each device:
  - Creates a sub-tree under `0_userdata.0.Geraete.LGThinQ.Devices.<deviceId>.*`
  - Allows sending raw control payloads via  
    `Devices.<deviceId>.control.rawJson` → `POST /devices/{id}/control`
- Device-type specific mapping for:
  - **Refrigerators** (`DEVICE_REFRIGERATOR`)
  - **Washing machines** (`DEVICE_WASHER`)
  - **Dryers** (`DEVICE_DRYER`)

---

## 🧩 State structure (overview)

Base path:

- `0_userdata.0.Geraete.LGThinQ.*`

Config:

- `Config.mode` – currently only `"pat"` supported
- `Config.pat` – ThinQ Connect Personal Access Token (PAT)
- `Config.countryCode` – e.g. `"DE"`
- `Config.clientId` – auto-generated if empty
- `Config.pollIntervalSec` – polling interval in seconds

Info:

- `Info.started` – `true` if script started successfully
- `Info.lastPollTs` – ISO timestamp of last poll
- `Info.lastError` – last error message, if any

Per device (`Devices.<deviceId>`):

- `alias` – device alias from ThinQ
- `deviceType` – ThinQ device type (e.g. `DEVICE_REFRIGERATOR`)
- `modelName` – model name
- `online` – basic online flag from device info
- `raw` – raw JSON of the device object
- `state.raw` – last state response (JSON string)
- `state.online` – online flag based on latest state
- `state.summary` – short summary (e.g. running/off, door, express)

Control:

- `control.rawJson` – write JSON here to trigger  
  `POST /devices/{id}/control` (is reset to empty on success)

---

## 🧭 Mapping details

### Refrigerators (`DEVICE_REFRIGERATOR`)

Under `Devices.<id>.state.fridge.*`:

- `tempFridgeC` / `tempFreezerC` – target temperatures in °C
- `tempFridgeF` / `tempFreezerF` – target temperatures in °F (if provided)
- `expressMode` / `expressFridge` / `expressModeName`
- `doorMainOpen` / `doorMainState`
- `waterFilterUsedTime`
- `waterFilterState`

### Washing machines (`DEVICE_WASHER`)

Under `Devices.<id>.state.washer.*`:

- `runState` – current state (e.g. `RUNNING`, `POWER_OFF`, …)
- `isOn` – `true` if not in `POWER_OFF`
- `remoteControlEnabled`
- `remainHour`, `remainMinute`, `remainMinutes`
- `totalHour`, `totalMinute`, `totalMinutes`
- `cycleCount`

### Dryers (`DEVICE_DRYER`)

Under `Devices.<id>.state.dryer.*`:

- `runState`
- `isOn`
- `remoteControlEnabled`
- `remainHour`, `remainMinute`, `remainMinutes`
- `totalHour`, `totalMinute`, `totalMinutes`

---

## ⚙️ Configuration

At the top of the script:

```js
const ROOT = '0_userdata.0.Geraete.LGThinQ';
const DEV_ROOT = ROOT + '.Devices';
const API_KEY = 'place your apikey here';
```

- **`ROOT` / `DEV_ROOT`** can be changed if you use a different state layout.
- **`API_KEY`** must be replaced with your own key from the **ThinQ Connect** developer portal.  
  Do **not** commit the real value to GitHub.

Config states in ioBroker (object tree):

```text
0_userdata.0.Geraete.LGThinQ.Config.mode            = "pat"
0_userdata.0.Geraete.LGThinQ.Config.pat             = <your ThinQ PAT>
0_userdata.0.Geraete.LGThinQ.Config.countryCode     = "DE"
0_userdata.0.Geraete.LGThinQ.Config.clientId        = ""   (auto-generated)
0_userdata.0.Geraete.LGThinQ.Config.pollIntervalSec = 60   (default)
```

When you change any `Config.*` state, the script automatically restarts with the new settings.

---

## 🚀 Installation (ioBroker)

1. Create the config states (or let the script create them on first run).
2. Create a new script in the ioBroker JavaScript adapter:
   - Type: common JavaScript
   - Copy the content of `lg-thinq-connect.js` into the editor.
3. Adjust:
   - `API_KEY` constant in the script.
   - `Config.*` states in the object tree (`PAT`, country, interval).
4. Start the script and check the log for messages starting with `[LGThinQ]`.
5. Verify created states under `0_userdata.0.Geraete.LGThinQ.Devices.*`.

---

## 🧪 Testing

- Check that `Info.started` becomes `true`.
- Confirm a list of devices under `Devices.<id>` is created.
- Check `state.*` values are filled for your refrigerator / washer / dryer.
- Send a small test control payload via `control.rawJson`:
  - Example (pseudo):
    ```json
    {
      "command": "SetTemperature",
      "value": { "targetTemperatureC": 4 }
    }
    ```
  - Adjust to a **valid** payload for your device and API version.

> Always be careful when sending control commands – start with harmless operations and verify structure against the official ThinQ Connect documentation.

---

## 🔐 Security notes

- Do **not** share:
  - your PAT,
  - your API key,
  - or full raw JSON with identifiers in public issues.
- If you open GitHub issues, strip or anonymize IDs and tokens.
- Consider limiting the PAT in the ThinQ portal (scopes, expiration) if available.

---

## 📄 License

This script is intended to be used in a repository licensed under the **MIT License**.

If you use it in `iobroker-device-scripts`, the top-level `LICENSE` file applies.  
Otherwise, add your own `LICENSE` file (e.g. MIT) in your repository root.
