# Operator Quickstart

Use this when you want the fastest safe check of the deployed OpenClaw monitor suite on Kenny's Mac.

## Core paths

- Repo: `~/github/openclaw-agent-monitor`
- Lite watcher package: `~/github/openclaw-agent-monitor/packages/lite-watcher`
- Lite watcher health script: `~/github/openclaw-agent-monitor/scripts/check-lite-watcher-health.sh`
- Lite watcher LaunchAgent label: `ai.openclaw.lite-watcher`
- Lite watcher plist: `~/Library/LaunchAgents/ai.openclaw.lite-watcher.plist`
- Lite watcher state: `~/.openclaw/state/lite-watcher/`
- Lite watcher logs: `~/.openclaw/logs/openclaw-lite-watcher.log`
- Gateway watchdog package: `~/github/openclaw-agent-monitor/packages/gateway-watchdog`
- Gateway watchdog health script: `~/github/openclaw-agent-monitor/scripts/check-gateway-watchdog-health.sh`
- Gateway watchdog LaunchAgent label: `ai.openclaw.gateway-watchdog`
- Gateway watchdog plist: `~/Library/LaunchAgents/ai.openclaw.gateway-watchdog.plist`
- Gateway watchdog state: `~/.openclaw/state/gateway-watchdog/`
- Gateway watchdog logs: `~/.openclaw/logs/gateway-watchdog.log`

## 30-second health check

Run:

```bash
~/github/openclaw-agent-monitor/scripts/check-monitor-suite-health.sh
```

For package-specific checks, use:

```bash
~/github/openclaw-agent-monitor/scripts/check-lite-watcher-health.sh
~/github/openclaw-agent-monitor/scripts/check-gateway-watchdog-health.sh
```

For the lite watcher, what you want to see:

- `launchAgent.plistExists = true`
- `launchAgent.loaded = true`
- `watcher.reportExists = true`
- `watcher.stateExists = true`
- `watcher.reportAgeSeconds` is reasonably fresh
- `autoResumeLite.enabled = false` (current safe default)
- `telegramDenied = true`
- `feishuDenied = true`

For the gateway watchdog, what you want to see:

- classification is normally `healthy` or intentionally `suppressed`
- no rapid repeated recoveries
- retry budget is mostly unused on a healthy machine

## Read the latest watcher result

```bash
cat ~/.openclaw/state/lite-watcher/last-report.json
```

Important fields:

- `signals`
- `incidents`
- `proposedActions`
- `humanSummary`

## Read the current watcher state

```bash
cat ~/.openclaw/state/lite-watcher/watcher-state.json
```

Important fields:

- `cooldowns`
- `lastReportMeta`
- `lastGood`
- `logCursors`

## Check launchd directly

```bash
launchctl print gui/$(id -u)/ai.openclaw.lite-watcher | sed -n '1,120p'
```

A periodic LaunchAgent may show `state = not running` between intervals. That is normal if:

- `last exit code = 0`
- the watcher report keeps updating

## Safe reload of the watcher service only

Use this only if the watcher itself is missing, unloaded, or clearly stale.

```bash
cp "$HOME/github/openclaw-agent-monitor/scripts/ai.openclaw.lite-watcher.plist" "$HOME/Library/LaunchAgents/ai.openclaw.lite-watcher.plist"
launchctl bootout "gui/$(id -u)"/ai.openclaw.lite-watcher >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/ai.openclaw.lite-watcher.plist"
launchctl kickstart -k "gui/$(id -u)"/ai.openclaw.lite-watcher
```

Then re-run the 30-second health check.

## Current interpretation rules

- `feishu_status_path_mismatch` means Feishu summary/root status disagrees with account-level probe state.
- Treat it as a **diagnostic mismatch**, not a confirmed outage, unless stronger evidence appears.
- Do not restart OpenClaw or rewrite config just because this signal exists.
- The watcher is meant to be deterministic and read-only by default.

## Monitor framework notes

- treat this repo as the operator surface for multiple watchdogs, not one giant watcher runtime
- use the suite health script first, then route to a package-specific script or skill
- after OpenClaw upgrades, re-check `docs/KNOWN-ISSUES-BY-VERSION.md` before trusting version-sensitive workarounds

## Current safe posture for `auto-resume-lite`

- keep it scoped away from direct human chat
- current deny prefixes should include:
  - `agent:main:telegram:`
  - `agent:main:feishu:`
- if someone wants to broaden that scope, ask Kenny first
