---
name: lite-watcher-deploy
description: Install, deploy, verify, update, or audit the OpenClaw lite watcher on Kenny's Mac. Use when an agent needs to work with the watcher repo at `~/github/openclaw-agent-monitor`, manage the `ai.openclaw.lite-watcher` LaunchAgent, inspect watcher state/report files under `~/.openclaw/state/lite-watcher/`, or check how the watcher interacts with `auto-resume-lite`. Also use when documenting or validating the safe deployment posture: watcher stays deterministic/read-only by default, and `auto-resume-lite` must stay scoped away from direct human chat unless Kenny explicitly confirms otherwise.
---

# Lite Watcher Deploy

Keep the watcher precise, quiet, and reversible.

## Quick facts

Use these paths and commands:

- Repo root: `~/github/openclaw-agent-monitor`
- Watcher package: `~/github/openclaw-agent-monitor/packages/lite-watcher`
- Run script: `~/github/openclaw-agent-monitor/scripts/run-lite-watcher.sh`
- Health check: `~/github/openclaw-agent-monitor/scripts/check-lite-watcher-health.sh`
- LaunchAgent plist source: `~/github/openclaw-agent-monitor/scripts/ai.openclaw.lite-watcher.plist`
- Installed plist: `~/Library/LaunchAgents/ai.openclaw.lite-watcher.plist`
- Runtime state: `~/.openclaw/state/lite-watcher/`
- Runtime logs: `~/.openclaw/logs/openclaw-lite-watcher.log`
- Launchd logs: `~/.openclaw/logs/openclaw-lite-watcher.launchd.out.log`, `~/.openclaw/logs/openclaw-lite-watcher.launchd.err.log`

## Operating principles

- Prefer precision over recall.
- Prefer read-only checks over automatic repair.
- Treat single weak signals as non-actionable.
- Do not restart OpenClaw or rewrite config just because one status path looks odd.
- Preserve at least one remote-control path when judging recovery actions.
- Keep `auto-resume-lite` away from direct human chat unless Kenny explicitly confirms broader scope.

Current safe `auto-resume-lite` posture on this machine:

- plugin may remain disabled by default
- keep deny prefixes for direct chat families:
  - `agent:main:telegram:`
  - `agent:main:feishu:`

If asked to broaden that scope, ask Kenny to confirm first.

## Workflow

### 1. Verify the repo and code

Run from `~/github/openclaw-agent-monitor`.

Minimum checks:

```bash
cd ~/github/openclaw-agent-monitor/packages/lite-watcher
node --check src/*.mjs
npm run check -- --state "$HOME/.openclaw/state/lite-watcher/watcher-state.json" --report "$HOME/.openclaw/state/lite-watcher/last-report.json"
```

Expect the watcher to emit a JSON report. Do not treat a diagnostic mismatch alone as an outage.

### 2. Verify deployment state

Run:

```bash
~/github/openclaw-agent-monitor/scripts/check-lite-watcher-health.sh
```

Use this as the default truth source for deployment status. It checks:

- whether the LaunchAgent plist exists
- whether launchd knows the watcher service
- whether the watcher report/state files exist and are fresh
- current incidents / proposed actions from the latest watcher report
- whether `auto-resume-lite` is enabled
- whether Telegram/Feishu deny prefixes are present

### 3. Deploy or reload the LaunchAgent

Only when deployment is explicitly requested or clearly broken.

```bash
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.openclaw/logs" "$HOME/.openclaw/state/lite-watcher"
cp "$HOME/github/openclaw-agent-monitor/scripts/ai.openclaw.lite-watcher.plist" "$HOME/Library/LaunchAgents/ai.openclaw.lite-watcher.plist"
launchctl bootout "gui/$(id -u)"/ai.openclaw.lite-watcher >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/ai.openclaw.lite-watcher.plist"
launchctl kickstart -k "gui/$(id -u)"/ai.openclaw.lite-watcher
launchctl print "gui/$(id -u)"/ai.openclaw.lite-watcher | sed -n '1,120p'
```

A healthy result may show `state = not running` between intervals; that is normal for a periodic LaunchAgent if `last exit code = 0` and the report keeps updating.

### 4. Judge watcher output conservatively

Current watcher v1 high-confidence areas include:

- Feishu status-path mismatch
- Feishu config drift disable
- repeated same-channel delivery failures with no later recovery marker
- restart deferral / drain-race overlap
- `auto-resume-lite` risk against protected chat families
- all remote paths lost

Do not escalate on:

- one-off tool failures
- old permission incidents without fresh evidence
- status mismatch alone when stronger evidence shows the channel is alive

### 5. Handle `auto-resume-lite` carefully

Treat the watcher and `auto-resume-lite` as separate systems:

- watcher = deterministic monitor
- `auto-resume-lite` = recovery plugin

Do not enable `auto-resume-lite` broadly on direct chat surfaces.

If you must inspect current policy, check `~/.openclaw/openclaw.json` or the health script output for:

- `enabled`
- `denySessionKeyPrefixes`

Recommended direct-chat deny guards:

```json
[
  "agent:main:telegram:",
  "agent:main:feishu:"
]
```

If those are missing and the plugin is enabled, treat it as a policy risk, not a harmless default.

## Safe response patterns

Use these patterns in agent work:

- If watcher is healthy: report briefly and avoid extra action.
- If watcher is stale but LaunchAgent is loaded: inspect logs and report facts before changing anything.
- If LaunchAgent is unloaded or plist missing: re-install/reload only that watcher service, then verify again.
- If watcher reports incidents with low or mixed confidence: summarize facts and defer disruptive repair.
- If someone asks to broaden `auto-resume-lite` to direct chat: ask Kenny for explicit confirmation first.
