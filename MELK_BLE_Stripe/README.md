# MELK OA21 2C – BLE LED Control (Python + ioBroker)

Stable control of a MELK / Livarno OA21 2C BLE LED light using a Raspberry Pi (Debian)
and ioBroker via SSH.

## Key Insight

⚠️ The controller requires **one-time initialization** using:

```bash
white 30
```

Without this initialization, the light may turn off automatically or behave unstable.

---

## Requirements

- Debian / Raspberry Pi OS
- Bluetooth (BlueZ)
- Python 3
- gatttool
- pexpect

---

## Installation

```bash
sudo apt update
sudo apt install -y bluetooth bluez bluez-tools python3 python3-pexpect
sudo systemctl enable bluetooth
sudo systemctl start bluetooth
```

---

## Script Installation

```bash
sudo mkdir -p /opt/melk
sudo nano /opt/melk/melkble_light.py
sudo chmod +x /opt/melk/melkble_light.py
```

Insert **melkble_light.py v2.2**.

---

## Usage

```bash
sudo /opt/melk/melkble_light.py white 30   # initialize (IMPORTANT)
sudo /opt/melk/melkble_light.py on
sudo /opt/melk/melkble_light.py off
sudo /opt/melk/melkble_light.py color 0 0 255
```

---

## Usage Rules

- Always run `white 30` once after power loss
- Use `on` before `color`
- Do not use `white` in daily operation
- No daemon required

---

## ioBroker Integration

Run the script remotely via SSH:

```bash
ssh monitor@BLE_HOST "sudo /opt/melk/melkble_light.py on"
```

### Recommended sudoers entry (BLE host)

```text
monitor ALL=(ALL) NOPASSWD:/opt/melk/melkble_light.py
```

---

## Notes

- `white` is **not true white** – it sets the controller mode
- Color mixing is controller-specific
- BLE instability usually means missing initialization

---

## Status

- Tested
- Stable
- No background services required

---

## License

Private / Personal use
