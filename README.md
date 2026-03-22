# openclaw-agent-monitor

Local-first monitoring and operational guardrails for OpenClaw.

## Packages

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

## Current deployment target on this machine

The monitor suite is deployed from this repo path and runs locally via launchd.

Recommended runtime state/log paths:

- lite watcher state: `~/.openclaw/state/lite-watcher/`
- lite watcher logs: `~/.openclaw/logs/openclaw-lite-watcher.log`
- gateway watchdog state: `~/.openclaw/state/gateway-watchdog/`
- gateway watchdog logs: `~/.openclaw/logs/gateway-watchdog.log`

## Notes

- Healthy path uses no LLM / no tokens.
- `lite-watcher` stays read-only and non-invasive by default.
- `gateway-watchdog` is intentionally narrow and only acts on repeated, high-confidence gateway fake-alive conditions.
- Human-facing direct chat sessions should not be auto-resumed by recovery plugins unless explicitly allowlisted.
