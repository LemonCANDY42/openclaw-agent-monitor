---
name: monitor-suite
description: Inspect, operate, or extend the OpenClaw monitor framework in `openclaw-agent-monitor`. Use when an agent needs to check monitor health, decide which watchdog/service is relevant, install or verify the lite watcher or gateway watchdog, read monitor-suite architecture and version-aware operational notes, or guide safe suppression/maintenance around OpenClaw monitoring and recovery behavior.
---

# Monitor Suite

Use this skill when working with the OpenClaw monitoring framework at:

- `~/github/openclaw-agent-monitor`

## Core rule

Treat the repo as a **framework with multiple watchdog services**, not as one giant watcher process.

Current dogs:

- `ai.openclaw.lite-watcher`
- `ai.openclaw.gateway-watchdog`

## First checks

Start with the suite-level health entrypoint:

```bash
~/github/openclaw-agent-monitor/scripts/check-monitor-suite-health.sh
```

Then decide whether the task belongs to:

- `lite-watcher` — read-only health / drift / reporting
- `gateway-watchdog` — narrow gateway fake-alive recovery logic

## Operator entrypoints

### Suite health

```bash
~/github/openclaw-agent-monitor/scripts/check-monitor-suite-health.sh
```

### Lite watcher health

```bash
~/github/openclaw-agent-monitor/scripts/check-lite-watcher-health.sh
```

### Gateway watchdog health

```bash
~/github/openclaw-agent-monitor/scripts/check-gateway-watchdog-health.sh
```

## Docs to read when needed

- architecture: `docs/MONITOR-SUITE-ARCHITECTURE.md`
- operator quickstart: `docs/OPERATOR-QUICKSTART.md`
- gateway watchdog specifics: `docs/GATEWAY-WATCHDOG.md`
- version-sensitive quirks: `docs/KNOWN-ISSUES-BY-VERSION.md`

## Safety model

- `lite-watcher` stays read-only by default
- action-capable dogs must support suppression and retry budgets
- do not treat every current workaround as permanent truth
- after OpenClaw upgrades, re-check version-sensitive notes before trusting old assumptions

## When to route to a package-specific skill

Use `skills/lite-watcher-deploy` when the task is specifically about deploying or diagnosing the lite watcher.

Use `skills/gateway-watchdog-deploy` when the task is specifically about deploying, suppressing, or diagnosing the gateway watchdog.
