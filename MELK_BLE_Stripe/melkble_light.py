#!/usr/bin/env python3
# melkble_light.py v2.2 (final, tolerant interactive)
# - Interactive gatttool is required on your system (non-interactive returns ENOSYS/38 or timeouts)
# - Do NOT rely on "Characteristic value was written successfully" (often missing)
# - Success = prompt returns and no explicit Error/Command Failed/Disconnected
#
# Usage:
#   sudo python3 /opt/melk/melkble_light.py on
#   sudo python3 /opt/melk/melkble_light.py off
#   sudo python3 /opt/melk/melkble_light.py color 0 0 255
#   sudo python3 /opt/melk/melkble_light.py white 30

import argparse
import time
import pexpect
import sys

MAC_DEFAULT = "BE:16:18:01:C2:2C"
HCI = "hci0"
HANDLE = "0x0009"

PAYLOAD_ON  = "7e00040100000000ef"
PAYLOAD_OFF = "7e00040000000000ef"

def payload_color(r: int, g: int, b: int) -> str:
    for v in (r, g, b):
        if not (0 <= v <= 255):
            raise ValueError("RGB muss 0..255 sein")
    return f"7e000503{r:02x}{g:02x}{b:02x}00ef"

def payload_white(level: int) -> str:
    if not (1 <= level <= 100):
        raise ValueError("Level muss 1..100 sein")
    return f"7e000503{level:02x}000000ef"

PROMPT = r"\[LE\]>"
ERR_PATTERNS = [
    r"Command Failed: Disconnected",
    r"Error:.*",
    r"Disconnected",
    r"connect to .*:.*\(\d+\)",
    r"Request attribute has encountered an unlikely error",
]

class Gatt:
    def __init__(self, mac: str, timeout: int):
        self.mac = mac
        self.timeout = timeout
        self.child = None

    def start(self):
        cmd = f"gatttool -i {HCI} -b {self.mac} -I"
        # Note: do not enable logfile; keep quiet
        self.child = pexpect.spawn(cmd, encoding="utf-8", timeout=self.timeout)
        self.child.expect(PROMPT, timeout=self.timeout)

    def stop(self):
        if self.child is None:
            return
        try:
            self.child.sendline("quit")
        except Exception:
            pass
        try:
            self.child.close(force=True)
        except Exception:
            pass
        self.child = None

    def _wait_prompt_or_error(self) -> bool:
        """Return True if prompt came back without explicit error; False if explicit error."""
        assert self.child is not None
        patterns = [PROMPT] + ERR_PATTERNS
        idx = self.child.expect(patterns, timeout=self.timeout)
        return idx == 0

    def connect(self, tries: int = 10, pause: float = 0.5) -> bool:
        assert self.child is not None
        for _ in range(tries):
            self.child.sendline("connect")
            # Look for Connection successful or errors, then prompt
            try:
                idx = self.child.expect(
                    [r"Connection successful"] + ERR_PATTERNS + [PROMPT],
                    timeout=self.timeout
                )
            except pexpect.TIMEOUT:
                time.sleep(pause)
                continue

            # If connection successful found
            if idx == 0:
                # consume until prompt
                try:
                    self.child.expect(PROMPT, timeout=self.timeout)
                except Exception:
                    pass
                return True

            # If we landed on prompt directly (already connected sometimes)
            if idx == (len([r"Connection successful"] + ERR_PATTERNS)):
                return True

            # otherwise error; go back to prompt then retry
            try:
                self.child.expect(PROMPT, timeout=self.timeout)
            except Exception:
                pass
            time.sleep(pause)

        return False

    def write(self, payload_hex: str) -> bool:
        """
        Interactive syntax that works reliably:
          char-write-req 0x0009 <payload>
        Success = prompt returns and no explicit error found.
        """
        assert self.child is not None
        self.child.sendline(f"char-write-req {HANDLE} {payload_hex}")

        # We may or may not get "Characteristic value was written successfully".
        # Therefore: wait for either explicit error OR prompt.
        ok = self._wait_prompt_or_error()
        if ok:
            return True

        # Ensure prompt for next commands
        try:
            self.child.expect(PROMPT, timeout=1)
        except Exception:
            pass
        return False

def run(mac: str, payloads: list[str], connect_tries: int, write_tries: int, timeout: int):
    g = Gatt(mac, timeout=timeout)
    try:
        g.start()
        if not g.connect(tries=connect_tries):
            raise SystemExit("Konnte nicht verbinden (nach Retries).")

        for p in payloads:
            success = False
            for _ in range(write_tries):
                if g.write(p):
                    success = True
                    break
                # if write failed, try reconnect and retry
                time.sleep(0.3)
                g.connect(tries=connect_tries)
            if not success:
                raise SystemExit(f"Write fehlgeschlagen für Payload: {p}")

    finally:
        g.stop()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["on", "off", "color", "white"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--mac", default=MAC_DEFAULT)
    ap.add_argument("--connect-tries", type=int, default=12)
    ap.add_argument("--write-tries", type=int, default=6)
    ap.add_argument("--timeout", type=int, default=10)
    ns = ap.parse_args()

    if ns.cmd == "on":
        run(ns.mac, [PAYLOAD_ON], ns.connect_tries, ns.write_tries, ns.timeout)
        print("OK ✓")
        return

    if ns.cmd == "off":
        run(ns.mac, [PAYLOAD_OFF], ns.connect_tries, ns.write_tries, ns.timeout)
        print("OK ✓")
        return

    if ns.cmd == "color":
        if len(ns.args) != 3:
            raise SystemExit("color braucht: R G B")
        r, g, b = map(int, ns.args)
        run(ns.mac, [PAYLOAD_ON, payload_color(r, g, b)], ns.connect_tries, ns.write_tries, ns.timeout)
        print("OK ✓")
        return

    if ns.cmd == "white":
        if len(ns.args) != 1:
            raise SystemExit("white braucht: Level 1..100")
        lvl = int(ns.args[0])
        run(ns.mac, [PAYLOAD_ON, payload_white(lvl)], ns.connect_tries, ns.write_tries, ns.timeout)
        print("OK ✓")
        return

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
