// MELK BLE Stripe ssh control v1.0 
// c by ilovegym66

'use strict';

const CFG = {
  ROOT: '0_userdata.0.Geraete.MelkBLE',

  BLE_HOST: '10.1.1.23', // ip of raspi
  BLE_USER: 'monitor', // username on raspi
  SSH_KEY:  '/home/iobroker/.ssh/id_ed25519', // existing ssh-key

  SSH_OPTS: [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=8',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=2'
  ],

  REMOTE_PY: '/usr/bin/python3',
  REMOTE_SCRIPT: '/opt/melk/melkble_light.py',
  BLE_MAC: 'BE:16:18:01:C2:2C',

  DEBOUNCE_MS: 700,
  COOLDOWN_MS: 400,
  EXEC_TIMEOUT_MS: 30000,

  WHITE_MIN: 1,
  WHITE_MAX: 100,
};

const { exec } = require('child_process');

function ensureState(id, common, val) {
  if (!existsState(id)) createState(id, val, common);
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function parseRgb(input) {
  const s = String(input || '').trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) {
    const hex = s.startsWith('#') ? s.slice(1) : s;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  if (parts.length === 3) {
    return {
      r: clamp(parts[0], 0, 255),
      g: clamp(parts[1], 0, 255),
      b: clamp(parts[2], 0, 255),
    };
  }
  return null;
}

function runRemote(args) {
  return new Promise((resolve, reject) => {
    const sshBase = [
      'ssh',
      '-i', CFG.SSH_KEY,
      ...CFG.SSH_OPTS,
      `${CFG.BLE_USER}@${CFG.BLE_HOST}`,
    ];

    const remoteCmd = `sudo ${CFG.REMOTE_PY} ${CFG.REMOTE_SCRIPT} ${args.join(' ')} --mac ${CFG.BLE_MAC}`;

    const cmd = `${sshBase.map(x => `"${x.replace(/"/g, '\\"')}"`).join(' ')} "${remoteCmd.replace(/"/g, '\\"')}"`;

    exec(cmd, { timeout: CFG.EXEC_TIMEOUT_MS }, (err, stdout, stderr) => {
      const out = (stdout || '').trim();
      const errOut = (stderr || '').trim();
      if (err) return reject({ err, out, errOut, cmd });
      resolve({ out, errOut, cmd });
    });
  });
}

// States
ensureState(`${CFG.ROOT}.power`, { name: 'Power', type: 'boolean', role: 'switch', read: true, write: true }, false);
ensureState(`${CFG.ROOT}.mode`,  { name: 'Mode (rgb/white)', type: 'string', role: 'text', read: true, write: true }, 'rgb');
ensureState(`${CFG.ROOT}.rgb`,   { name: 'RGB (R,G,B oder #RRGGBB)', type: 'string', role: 'text', read: true, write: true }, '0,0,255');
ensureState(`${CFG.ROOT}.white`, { name: 'White Level (1..100)', type: 'number', role: 'level', read: true, write: true }, 50);

ensureState(`${CFG.ROOT}.info.lastCmd`, { name: 'Last Command', type: 'string', role: 'text', read: true, write: false }, '');
ensureState(`${CFG.ROOT}.info.lastErr`, { name: 'Last Error', type: 'string', role: 'text', read: true, write: false }, '');
ensureState(`${CFG.ROOT}.info.busy`,    { name: 'Busy', type: 'boolean', role: 'indicator.working', read: true, write: false }, false);

let timer = null;
let busy = false;
let lastRunTs = 0;

async function applyDesiredState() {
  if (busy) return;
  busy = true;
  setState(`${CFG.ROOT}.info.busy`, true, true);

  try {
    const power = !!getState(`${CFG.ROOT}.power`).val;
    const mode = String(getState(`${CFG.ROOT}.mode`).val || 'rgb').toLowerCase();

    const now = Date.now();
    const wait = Math.max(0, (lastRunTs + CFG.COOLDOWN_MS) - now);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    if (!power) {
      setState(`${CFG.ROOT}.info.lastCmd`, 'off', true);
      await runRemote(['off']);
      lastRunTs = Date.now();
      setState(`${CFG.ROOT}.info.lastErr`, '', true);
      return;
    }

    if (mode === 'white') {
      const lvl = clamp(getState(`${CFG.ROOT}.white`).val, CFG.WHITE_MIN, CFG.WHITE_MAX);
      setState(`${CFG.ROOT}.white`, lvl, true);
      setState(`${CFG.ROOT}.info.lastCmd`, `white ${lvl}`, true);

      await runRemote(['bri', String(lvl)]);
      lastRunTs = Date.now();
      setState(`${CFG.ROOT}.info.lastErr`, '', true);
      return;
    }

    const rgb = parseRgb(getState(`${CFG.ROOT}.rgb`).val);
    if (!rgb) throw new Error('RGB ungültig. Erlaubt: "R,G,B" oder "#RRGGBB"');

    setState(`${CFG.ROOT}.info.lastCmd`, `color ${rgb.r} ${rgb.g} ${rgb.b}`, true);
    await runRemote(['color', String(rgb.r), String(rgb.g), String(rgb.b)]);
    lastRunTs = Date.now();
    setState(`${CFG.ROOT}.info.lastErr`, '', true);

  } catch (e) {
    const msg = e?.errOut ? `${e.err?.message || e.err}\n${e.errOut}\nCMD: ${e.cmd || ''}` : (e?.message || String(e));
    setState(`${CFG.ROOT}.info.lastErr`, msg, true);
    log(`MELK BLE (SSH) Fehler: ${msg}`, 'warn');
  } finally {
    busy = false;
    setState(`${CFG.ROOT}.info.busy`, false, true);
  }
}

function scheduleApply() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    applyDesiredState();
  }, CFG.DEBOUNCE_MS);
}

on({ id: `${CFG.ROOT}.power`, change: 'ne' }, scheduleApply);
on({ id: `${CFG.ROOT}.mode`,  change: 'ne' }, scheduleApply);
on({ id: `${CFG.ROOT}.rgb`,   change: 'ne' }, scheduleApply);
on({ id: `${CFG.ROOT}.white`, change: 'ne' }, scheduleApply);

log('MELK BLE ioBroker Control (SSH, interactive gatttool) gestartet.', 'info');
