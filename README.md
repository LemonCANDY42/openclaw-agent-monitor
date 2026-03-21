# openclaw-agent-monitor

Local-first monitoring and operational guardrails for OpenClaw.

## Packages

- `packages/lite-watcher` — precision-first, ultra-light deterministic watcher for channel/config/runtime health

## Current deployment target on this machine

The watcher is deployed from this repo path and runs locally via launchd.

Recommended runtime state/log paths:

- state: `~/.openclaw/state/lite-watcher/`
- logs: `~/.openclaw/logs/openclaw-lite-watcher.log`

## Notes

- Healthy path uses no LLM / no tokens.
- Default watcher mode is read-only and non-invasive.
- Human-facing direct chat sessions should not be auto-resumed by recovery plugins unless explicitly allowlisted.
