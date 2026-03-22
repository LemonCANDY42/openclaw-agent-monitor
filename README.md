# openclaw-agent-monitor

Local-first monitoring and operational guardrails for OpenClaw.

## Packages

- `packages/shared` — shared helpers and low-level contracts for the monitor suite
- `packages/lite-watcher` — precision-first, ultra-light deterministic watcher for channel/config/runtime health
- `packages/gateway-watchdog` — conservative companion watchdog for the narrow gateway fake-alive failure mode

## Agent skills

- `skills/monitor-suite` — top-level routing skill for checking, operating, and extending the monitor framework
- `skills/lite-watcher-deploy` — agent-facing installation, deployment, verification, and safety guidance for the watcher and its interaction boundary with `auto-resume-lite`
- `skills/gateway-watchdog-deploy` — agent-facing deployment, suppression, verification, and uninstall guidance for the gateway companion watchdog

## Operator quickstart

- `docs/OPERATOR-QUICKSTART.md` — shortest safe path for checking deployment state and runtime health across the current monitor suite
- `docs/MONITOR-SUITE-ARCHITECTURE.md` — framework structure and separation model
- `docs/KNOWN-ISSUES-BY-VERSION.md` — version-sensitive operational quirks and revalidation notes

## Install / reinstall / uninstall

Whole suite:

```bash
~/github/openclaw-agent-monitor/scripts/install-monitor-suite.sh
~/github/openclaw-agent-monitor/scripts/check-monitor-suite-health.sh
~/github/openclaw-agent-monitor/scripts/uninstall-monitor-suite.sh
```

Package-specific:

```bash
~/github/openclaw-agent-monitor/scripts/install-gateway-watchdog.sh
~/github/openclaw-agent-monitor/scripts/check-gateway-watchdog-health.sh
~/github/openclaw-agent-monitor/scripts/check-lite-watcher-health.sh
```

## Current deployment target on this machine

The monitor suite is deployed from this repo path and runs locally via launchd.

Recommended runtime state/log paths:

- lite watcher state: `~/.openclaw/state/lite-watcher/`
- lite watcher logs: `~/.openclaw/logs/openclaw-lite-watcher.log`
- gateway watchdog state: `~/.openclaw/state/gateway-watchdog/`
- gateway watchdog logs: `~/.openclaw/logs/gateway-watchdog.log`

## Recommended management model

- Treat this repo as the single operator surface for monitor installation, checks, and docs.
- Keep watchdogs as separate LaunchAgents; do **not** merge them into one giant always-on process.
- Prefer suite-level checks first, then package-specific diagnosis only when needed.
- Use suppression windows before planned gateway maintenance or risky restart work.
- Re-check `docs/KNOWN-ISSUES-BY-VERSION.md` after OpenClaw upgrades before trusting old workarounds.

## Recommended usage model

- Use the monitor suite for **lightweight background confidence**, not for noisy constant intervention.
- Let `lite-watcher` stay read-only by default.
- Let `gateway-watchdog` stay narrow and budgeted.
- Prefer explicit, observable state/log files over hidden magic.

## Notes

- Healthy path uses no LLM / no tokens.
- `lite-watcher` stays read-only and non-invasive by default.
- `gateway-watchdog` is intentionally narrow and only acts on repeated, high-confidence gateway fake-alive conditions.
- Human-facing direct chat sessions should not be auto-resumed by recovery plugins unless explicitly allowlisted.
