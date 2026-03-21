#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { collectRuntime } from './collect.mjs';
import { analyzeSnapshot } from './analyze.mjs';

const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    command: 'check',
    statePath: null,
    reportPath: null,
    lockPath: null,
  };

  if (args[0] && !args[0].startsWith('--')) out.command = args.shift();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--state') out.statePath = args[++i];
    else if (arg === '--report') out.reportPath = args[++i];
    else if (arg === '--lock') out.lockPath = args[++i];
  }
  return out;
}

function loadState(statePath) {
  if (!statePath) return {};
  try {
    if (!fs.existsSync(statePath)) return {};
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    return {
      loadError: error.message,
      cooldowns: {},
      logCursors: {},
    };
  }
}

function ensureParent(filePath) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function deriveLockPath(args) {
  if (args.lockPath) return args.lockPath;
  if (args.statePath) return path.join(path.dirname(args.statePath), 'watcher.lock');
  if (args.reportPath) return path.join(path.dirname(args.reportPath), 'watcher.lock');
  return null;
}

function writeJsonAtomic(filePath, value) {
  ensureParent(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function acquireLock(lockPath) {
  if (!lockPath) return () => {};
  ensureParent(lockPath);
  const payload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify(payload, null, 2));
    fs.closeSync(fd);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;

    try {
      const stat = fs.statSync(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > DEFAULT_LOCK_TTL_MS) {
        fs.unlinkSync(lockPath);
        return acquireLock(lockPath);
      }
    } catch {
      return acquireLock(lockPath);
    }

    const lockError = new Error(`Watcher lock already held: ${lockPath}`);
    lockError.code = 'WATCHER_LOCKED';
    throw lockError;
  }

  return () => {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore cleanup failure
    }
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command !== 'check') {
    console.error(`Unsupported command: ${args.command}`);
    process.exit(2);
  }

  const releaseLock = acquireLock(deriveLockPath(args));
  try {
    const state = loadState(args.statePath);
    const snapshot = await collectRuntime({ state });
    const analysis = analyzeSnapshot(snapshot, state);

    const report = {
      checkedAt: analysis.checkedAt,
      snapshot: snapshot.collectedAt,
      facts: analysis.facts,
      signals: analysis.signals,
      incidents: analysis.incidents,
      proposedActions: analysis.proposedActions,
      snapshotSummary: analysis.snapshotSummary,
      humanSummary: analysis.humanSummary,
    };

    if (args.statePath) writeJsonAtomic(args.statePath, analysis.nextState);
    if (args.reportPath) writeJsonAtomic(args.reportPath, report);

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  if (error?.code === 'WATCHER_LOCKED') {
    console.error(error.message);
    process.exit(0);
  }
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exit(1);
});
