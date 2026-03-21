import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULTS = {
  openclawConfig: path.join(os.homedir(), '.openclaw', 'openclaw.json'),
  logDir: '/tmp/openclaw',
  maxLogBytes: 256 * 1024,
  commandTimeoutMs: 25_000,
};

export function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

export async function runOpenClaw(args, timeoutMs = DEFAULTS.commandTimeoutMs) {
  try {
    const { stdout, stderr } = await execFileAsync('openclaw', args, {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      env: process.env,
    });
    return {
      ok: true,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
      command: ['openclaw', ...args].join(' '),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? String(error),
      command: ['openclaw', ...args].join(' '),
      error: error.message ?? String(error),
    };
  }
}

export function extractJsonObject(mixedText) {
  const text = String(mixedText ?? '');
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error('No JSON object found in command output');
}

export function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

export function redactRelevantConfig(config) {
  const telegram = config?.channels?.telegram ?? {};
  const feishu = config?.channels?.feishu ?? {};
  const autoResume = config?.plugins?.entries?.['auto-resume-lite'] ?? {};
  const feishuAccounts = feishu?.accounts ?? {};

  const projection = {
    channels: {
      telegram: {
        enabled: telegram?.enabled === true,
        allowFromCount: Array.isArray(telegram?.allowFrom) ? telegram.allowFrom.length : 0,
        hasProxy: typeof telegram?.proxy === 'string' && telegram.proxy.length > 0,
        streaming: telegram?.streaming ?? null,
      },
      feishu: {
        enabled: feishu?.enabled === true,
        domain: feishu?.domain ?? null,
        accounts: Object.keys(feishuAccounts).sort(),
        defaultAllowFromCount: Array.isArray(feishuAccounts?.default?.allowFrom)
          ? feishuAccounts.default.allowFrom.length
          : 0,
        hasMainAppId: typeof feishuAccounts?.main?.appId === 'string' && feishuAccounts.main.appId.length > 0,
        hasMainAppSecret: typeof feishuAccounts?.main?.appSecret === 'string' && feishuAccounts.main.appSecret.length > 0,
      },
    },
    plugins: {
      feishuEnabled: config?.plugins?.entries?.feishu?.enabled === true,
      autoResumeLite: {
        enabled: autoResume?.enabled === true,
        maxAutoResumes: autoResume?.config?.maxAutoResumes ?? null,
        cooldownMs: autoResume?.config?.cooldownMs ?? null,
        denySessionKeyPrefixes: Array.isArray(autoResume?.config?.denySessionKeyPrefixes)
          ? [...autoResume.config.denySessionKeyPrefixes].sort()
          : [],
      },
    },
    gateway: {
      mode: config?.gateway?.mode ?? null,
      bind: config?.gateway?.bind ?? null,
      port: config?.gateway?.port ?? null,
    },
  };

  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(projection))
    .digest('hex');

  return { projection, fingerprint };
}

export function findLatestLog(logDir = DEFAULTS.logDir) {
  const base = expandHome(logDir);
  if (!fs.existsSync(base)) return null;
  const files = fs
    .readdirSync(base)
    .filter((name) => /^openclaw-\d{4}-\d{2}-\d{2}\.log$/.test(name))
    .map((name) => path.join(base, name))
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return files[0]?.filePath ?? null;
}

export function readLogDelta(logPath, previousCursor = null, maxBytes = DEFAULTS.maxLogBytes) {
  if (!logPath || !fs.existsSync(logPath)) {
    return { text: '', cursor: null, bytesRead: 0, rotated: false };
  }

  const stat = fs.statSync(logPath);
  const fileSize = stat.size;
  let start = Math.max(0, fileSize - maxBytes);
  let rotated = false;

  if (
    previousCursor &&
    previousCursor.path === logPath &&
    typeof previousCursor.size === 'number' &&
    fileSize >= previousCursor.size
  ) {
    start = previousCursor.size;
  } else if (previousCursor && previousCursor.path === logPath && fileSize < previousCursor.size) {
    rotated = true;
  }

  const bytesToRead = Math.max(0, fileSize - start);
  const fd = fs.openSync(logPath, 'r');
  const buffer = Buffer.alloc(bytesToRead);
  try {
    if (bytesToRead > 0) fs.readSync(fd, buffer, 0, bytesToRead, start);
  } finally {
    fs.closeSync(fd);
  }

  return {
    text: buffer.toString('utf8'),
    bytesRead: bytesToRead,
    rotated,
    cursor: {
      path: logPath,
      size: fileSize,
      mtimeMs: stat.mtimeMs,
    },
  };
}

export async function collectRuntime({ state, openclawConfig, logDir, maxLogBytes } = {}) {
  const configPath = expandHome(openclawConfig ?? DEFAULTS.openclawConfig);
  const logBase = expandHome(logDir ?? DEFAULTS.logDir);

  const [statusResult, gatewayStatusResult] = await Promise.all([
    runOpenClaw(['status', '--deep', '--json']),
    runOpenClaw(['gateway', 'status']),
  ]);

  let statusJson = null;
  let statusParseError = null;
  if (statusResult.ok || statusResult.stdout) {
    try {
      statusJson = extractJsonObject(statusResult.stdout);
    } catch (error) {
      statusParseError = error.message;
    }
  }

  const configJson = readJsonFile(configPath);
  const configProjection = redactRelevantConfig(configJson);
  const latestLogPath = findLatestLog(logBase);
  const previousCursor = state?.logCursors?.[latestLogPath] ?? null;
  const logDelta = readLogDelta(latestLogPath, previousCursor, maxLogBytes ?? DEFAULTS.maxLogBytes);

  return {
    collectedAt: new Date().toISOString(),
    commands: {
      status: statusResult,
      gatewayStatus: gatewayStatusResult,
    },
    status: {
      json: statusJson,
      parseError: statusParseError,
    },
    config: {
      path: configPath,
      projection: configProjection.projection,
      fingerprint: configProjection.fingerprint,
    },
    logs: {
      latestPath: latestLogPath,
      deltaText: logDelta.text,
      bytesRead: logDelta.bytesRead,
      rotated: logDelta.rotated,
      cursor: logDelta.cursor,
    },
  };
}
