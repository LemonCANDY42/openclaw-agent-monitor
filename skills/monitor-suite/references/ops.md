# Monitor Suite Ops Reference

## Repo

- root: `~/github/openclaw-agent-monitor`

## Current services

### lite watcher

- LaunchAgent: `ai.openclaw.lite-watcher`
- package: `packages/lite-watcher`
- health script: `scripts/check-lite-watcher-health.sh`
- state: `~/.openclaw/state/lite-watcher/`
- logs: `~/.openclaw/logs/openclaw-lite-watcher.log`

### gateway watchdog

- LaunchAgent: `ai.openclaw.gateway-watchdog`
- package: `packages/gateway-watchdog`
- health script: `scripts/check-gateway-watchdog-health.sh`
- state: `~/.openclaw/state/gateway-watchdog/`
- logs: `~/.openclaw/logs/gateway-watchdog.log`

## Unified check

Run:

```bash
~/github/openclaw-agent-monitor/scripts/check-monitor-suite-health.sh
```

## Package-specific routing

- choose `lite-watcher` for read-only diagnosis/reporting/drift work
- choose `gateway-watchdog` for the gateway fake-alive recovery case

## Version-aware docs

Use `docs/KNOWN-ISSUES-BY-VERSION.md` when deciding whether a workaround is still current after an OpenClaw upgrade.
