#!/opt/homebrew/bin/node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { rotateFileIfNeeded } from '../../shared/src/rotation.mjs';

const execFileAsync = promisify(execFile);

const HOME = os.homedir();
const OPENCLAW_DIR = path.join(HOME, '.openclaw');
const STATE_DIR = path.join(OPENCLAW_DIR, 'state', 'gateway-watchdog');
const LOG_DIR = path.join(OPENCLAW_DIR, 'logs');
const EVENT_LOG = path.join(STATE_DIR, 'events.jsonl');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const SUPPRESS_FILE = path.join(STATE_DIR, 'suppress.json');
const GATEWAY_LOG = path.join(LOG_DIR, 'gateway.log');
const SERVICE_LABEL = 'ai.openclaw.gateway';
const WATCHDOG_LABEL = 'ai.openclaw.gateway-watchdog';
const GATEWAY_PORT = 18789;
const UID = String(process.getuid?.() ?? '');

const cfg = {
  suspectThreshold: 3,
  plannedRestartGraceMs: 6 * 60 * 1000,
  minRecoveryGapMs: 15 * 60 * 1000,
  maxRecoveriesPerHour: 2,
  maxRecoveriesPerDay: 4,
  postRecoveryVerifyAttempts: 8,
  postRecoveryVerifyDelayMs: 5000,
  launchctlTimeoutMs: 10000,
  commandTimeoutMs: 15000
};

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function nowMs() {
  return Date.now();
}

function iso(ts = nowMs()) {
  return new Date(ts).toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function appendEvent(type, detail = {}) {
  rotateFileIfNeeded(EVENT_LOG);
  const line = JSON.stringify({ ts: iso(), type, ...detail });
  fs.appendFileSync(EVENT_LOG, line + '\n');
  console.log(line);
}

function defaultState() {
  return {
    version: 1,
    lastClassification: null,
    consecutiveSuspectFailures: 0,
    lastHealthyAt: null,
    lastCheckAt: null,
    lastRecoveryAt: null,
    recoveries: []
  };
}

function loadState() {
  return { ...defaultState(), ...readJson(STATE_FILE, {}) };
}

function saveState(state) {
  writeJson(STATE_FILE, state);
}

function loadSuppress() {
  return readJson(SUPPRESS_FILE, { suppressedUntil: null, reason: null, updatedAt: null });
}

function setSuppress(minutes, reason) {
  const suppressedUntil = nowMs() + minutes * 60 * 1000;
  const value = { suppressedUntil, reason, updatedAt: iso() };
  writeJson(SUPPRESS_FILE, value);
  appendEvent('suppress_set', value);
}

function clearSuppress() {
  if (fs.existsSync(SUPPRESS_FILE)) fs.unlinkSync(SUPPRESS_FILE);
  appendEvent('suppress_cleared');
}

async function run(cmd, args, timeoutMs = cfg.commandTimeoutMs) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 4,
      env: process.env
    });
    return { ok: true, code: 0, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      code: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error.message ?? error)
    };
  }
}

async function getLaunchctlInfo() {
  const target = UID ? `gui/${UID}/${SERVICE_LABEL}` : SERVICE_LABEL;
  const res = await run('launchctl', ['print', target], cfg.launchctlTimeoutMs);
  if (!res.ok) {
    const missing = /Could not find service|not found|unknown service/i.test((res.stderr || '') + '\n' + (res.stdout || ''));
    return { loaded: false, running: false, pid: null, raw: res.stdout + res.stderr, missing };
  }
  const raw = res.stdout;
  const state = /state = (\w+)/.exec(raw)?.[1] ?? null;
  const pidMatch = /\bpid = (\d+)/.exec(raw);
  const activeCountMatch = /active count = (\d+)/.exec(raw);
  return {
    loaded: true,
    running: state === 'running',
    state,
    pid: pidMatch ? Number(pidMatch[1]) : null,
    activeCount: activeCountMatch ? Number(activeCountMatch[1]) : null,
    raw
  };
}

async function getGatewayStatus() {
  const res = await run('openclaw', ['gateway', 'status'], cfg.commandTimeoutMs);
  const text = [res.stdout, res.stderr].filter(Boolean).join('\n');
  return {
    ok: res.ok,
    text,
    runtimeRunning: /Runtime:\s+running/i.test(text),
    rpcOk: /RPC probe:\s+ok/i.test(text),
    rpcFailed: /RPC probe:\s+failed/i.test(text),
    listeningLine: /Listening:\s+(.+)/i.exec(text)?.[1] ?? null,
    lastGatewayError: /Last gateway error:\s+(.+)/i.exec(text)?.[1] ?? null
  };
}

async function isPortListening() {
  const res = await run('nc', ['-z', '127.0.0.1', String(GATEWAY_PORT)], 8000);
  return res.ok;
}

function parseIsoPrefix(line) {
  const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))/);
  if (!m) return null;
  const ts = Date.parse(m[1]);
  return Number.isFinite(ts) ? ts : null;
}

function getRecentRestartMarker() {
  if (!fs.existsSync(GATEWAY_LOG)) return null;
  const text = fs.readFileSync(GATEWAY_LOG, 'utf8');
  const lines = text.trim().split(/\r?\n/).slice(-400);
  const patterns = [
    /restart requested/i,
    /received SIGUSR1; restarting/i,
    /draining .* before restart/i,
    /signal SIGTERM received/i,
    /Gateway service restarted/i,
    /Restarted LaunchAgent/i
  ];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!patterns.some((p) => p.test(line))) continue;
    const ts = parseIsoPrefix(line);
    return ts ? { ts, line } : { ts: null, line };
  }
  return null;
}

function pruneRecoveries(state) {
  const now = nowMs();
  state.recoveries = (state.recoveries || []).filter((ts) => now - ts < 24 * 60 * 60 * 1000);
}

function recentRecoveryCounts(state) {
  const now = nowMs();
  const recoveries = state.recoveries || [];
  return {
    hour: recoveries.filter((ts) => now - ts < 60 * 60 * 1000).length,
    day: recoveries.filter((ts) => now - ts < 24 * 60 * 60 * 1000).length
  };
}

function classify({ launchInfo, gatewayStatus, portListening, suppress }) {
  const now = nowMs();
  if (suppress?.suppressedUntil && suppress.suppressedUntil > now) {
    return { kind: 'suppressed', reason: suppress.reason ?? 'manual' };
  }
  if (!launchInfo.loaded) {
    return { kind: 'planned_off', reason: 'gateway service not loaded' };
  }
  if (gatewayStatus.rpcOk) {
    return { kind: 'healthy' };
  }
  const marker = getRecentRestartMarker();
  if (marker?.ts && now - marker.ts < cfg.plannedRestartGraceMs) {
    return { kind: 'planned_restart_grace', reason: marker.line, markerTs: marker.ts };
  }
  if (launchInfo.running && gatewayStatus.runtimeRunning && !portListening) {
    return {
      kind: 'suspect_fake_alive',
      reason: gatewayStatus.lastGatewayError ?? 'runtime running but RPC unhealthy and port not listening'
    };
  }
  return { kind: 'degraded_no_action', reason: 'conditions too weak for automatic recovery' };
}

async function verifyHealthy() {
  for (let i = 0; i < cfg.postRecoveryVerifyAttempts; i += 1) {
    const launchInfo = await getLaunchctlInfo();
    const gatewayStatus = await getGatewayStatus();
    const portListening = await isPortListening();
    if (launchInfo.loaded && gatewayStatus.rpcOk && portListening) {
      return true;
    }
    await sleep(cfg.postRecoveryVerifyDelayMs);
  }
  return false;
}

async function recover(state, classification) {
  pruneRecoveries(state);
  const counts = recentRecoveryCounts(state);
  const now = nowMs();
  if (state.lastRecoveryAt && now - state.lastRecoveryAt < cfg.minRecoveryGapMs) {
    appendEvent('recovery_skipped', { reason: 'cooldown', lastRecoveryAt: iso(state.lastRecoveryAt) });
    return false;
  }
  if (counts.hour >= cfg.maxRecoveriesPerHour || counts.day >= cfg.maxRecoveriesPerDay) {
    appendEvent('recovery_skipped', {
      reason: 'retry_budget_exhausted',
      recentHour: counts.hour,
      recentDay: counts.day
    });
    return false;
  }

  appendEvent('recovery_attempt', { classification });

  const bootout = await run('launchctl', ['bootout', `gui/${UID}/${SERVICE_LABEL}`], cfg.launchctlTimeoutMs);
  appendEvent('recovery_bootout_result', { ok: bootout.ok, code: bootout.code, stderr: (bootout.stderr || '').trim().slice(0, 400) });
  await sleep(2000);

  const start = await run('openclaw', ['gateway', 'start'], cfg.commandTimeoutMs);
  appendEvent('recovery_start_result', { ok: start.ok, code: start.code, stderr: (start.stderr || '').trim().slice(0, 400) });

  const healthy = await verifyHealthy();
  state.lastRecoveryAt = now;
  state.recoveries = [...(state.recoveries || []), now];
  if (healthy) {
    appendEvent('recovery_success');
    return true;
  }
  appendEvent('recovery_failed_verify');
  return false;
}

async function runCheck({ dry = false } = {}) {
  ensureDirs();
  const state = loadState();
  const suppress = loadSuppress();
  const launchInfo = await getLaunchctlInfo();
  const gatewayStatus = await getGatewayStatus();
  const portListening = await isPortListening();
  const classification = classify({ launchInfo, gatewayStatus, portListening, suppress });

  state.lastCheckAt = nowMs();
  if (classification.kind === 'healthy') {
    state.lastHealthyAt = nowMs();
    state.consecutiveSuspectFailures = 0;
  } else if (classification.kind === 'suspect_fake_alive') {
    state.consecutiveSuspectFailures = state.lastClassification === 'suspect_fake_alive'
      ? (state.consecutiveSuspectFailures || 0) + 1
      : 1;
  } else {
    state.consecutiveSuspectFailures = 0;
  }
  state.lastClassification = classification.kind;
  pruneRecoveries(state);
  saveState(state);

  appendEvent('check', {
    classification: classification.kind,
    reason: classification.reason ?? null,
    consecutiveSuspectFailures: state.consecutiveSuspectFailures,
    launchLoaded: launchInfo.loaded,
    launchRunning: launchInfo.running,
    pid: launchInfo.pid,
    rpcOk: gatewayStatus.rpcOk,
    runtimeRunning: gatewayStatus.runtimeRunning,
    portListening
  });

  if (!dry && classification.kind === 'suspect_fake_alive' && state.consecutiveSuspectFailures >= cfg.suspectThreshold) {
    await recover(state, classification);
    saveState(state);
  }

  return { state, classification, launchInfo, gatewayStatus, portListening, suppress };
}

async function printStatus() {
  ensureDirs();
  const state = loadState();
  const suppress = loadSuppress();
  const launchInfo = await getLaunchctlInfo();
  const gatewayStatus = await getGatewayStatus();
  const portListening = await isPortListening();
  const classification = classify({ launchInfo, gatewayStatus, portListening, suppress });
  pruneRecoveries(state);
  const counts = recentRecoveryCounts(state);
  console.log(JSON.stringify({
    label: WATCHDOG_LABEL,
    serviceLabel: SERVICE_LABEL,
    classification,
    state,
    suppress,
    launchInfo: {
      loaded: launchInfo.loaded,
      running: launchInfo.running,
      pid: launchInfo.pid,
      state: launchInfo.state ?? null
    },
    gatewayStatus: {
      rpcOk: gatewayStatus.rpcOk,
      runtimeRunning: gatewayStatus.runtimeRunning,
      lastGatewayError: gatewayStatus.lastGatewayError,
      listeningLine: gatewayStatus.listeningLine
    },
    portListening,
    recoveryBudget: {
      recentHour: counts.hour,
      recentDay: counts.day,
      maxPerHour: cfg.maxRecoveriesPerHour,
      maxPerDay: cfg.maxRecoveriesPerDay,
      minRecoveryGapMs: cfg.minRecoveryGapMs
    }
  }, null, 2));
}

async function main() {
  const [command = 'check', ...args] = process.argv.slice(2);
  if (command === 'check') {
    await runCheck();
    return;
  }
  if (command === 'status') {
    await printStatus();
    return;
  }
  if (command === 'suppress') {
    const minutesArg = args.find((arg) => /^--minutes=/.test(arg)) ?? null;
    const reasonArg = args.find((arg) => /^--reason=/.test(arg)) ?? null;
    const minutesIndex = args.indexOf('--minutes');
    const reasonIndex = args.indexOf('--reason');
    const minutes = Number(minutesArg?.split('=')[1] ?? (minutesIndex >= 0 ? args[minutesIndex + 1] : 15));
    const reason = reasonArg?.split('=')[1] ?? (reasonIndex >= 0 ? args[reasonIndex + 1] : 'manual');
    setSuppress(minutes, reason);
    return;
  }
  if (command === 'unsuppress') {
    clearSuppress();
    return;
  }
  if (command === 'check-dry') {
    await runCheck({ dry: true });
    return;
  }
  console.error(`Unknown command: ${command}`);
  process.exit(2);
}

main().catch((error) => {
  appendEvent('fatal', { error: String(error?.stack ?? error) });
  process.exit(1);
});
