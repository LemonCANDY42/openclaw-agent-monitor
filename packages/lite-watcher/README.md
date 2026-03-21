# OpenClaw Watcher v1 (workspace prototype)

A precision-first, ultra-light watcher prototype for OpenClaw.

## Design goals

- Healthy path uses **no LLM / no tokens**.
- Prefer **precision over recall**.
- Require **corroboration**, not one noisy signal.
- Be **non-invasive** by default.
- Only recommend deterministic self-heal steps before any agent escalation.
- Preserve at least one remote-control path when possible.

## Current scope

This prototype is intentionally read-only by default:

- reads `openclaw status --deep --json`
- reads a redacted projection of `~/.openclaw/openclaw.json`
- tails the latest `/tmp/openclaw/openclaw-*.log`
- writes local watcher state/report files under `state/`
- emits incidents, confidence, and proposed actions
- uses a single-instance lock + atomic JSON writes for safer unattended runs

It does **not** modify OpenClaw config, enable/disable plugins, or restart anything.

## Files

- `docs/ARCHITECTURE.md` — rules, tiers, thresholds, state/log strategy, escalation policy
- `docs/AUTO-RESUME-LITE-EVALUATION.md` — critical judgment on the local `auto-resume-lite` patch
- `src/watcher.mjs` — CLI entrypoint
- `src/collect.mjs` — deterministic collectors
- `src/analyze.mjs` — strict rule engine
- `config/example.config.json` — example paths + thresholds

## Run

```bash
cd /Users/kennymccormick/.openclaw/workspace/ops/openclaw-watcher-v1
node src/watcher.mjs check \
  --state state/watcher-state.json \
  --report state/last-report.json
```

Or:

```bash
npm run check -- --state state/watcher-state.json --report state/last-report.json
```

## Intended workspace location

Prototype now lives at:

- `ops/openclaw-watcher-v1/`

## Recommended future repo location

If this graduates into a real maintained project, prefer:

- `~/github/openclaw-agent-monitor/packages/lite-watcher/`

That fits the existing candidate repo shape already staged in:

- `community/openclaw-agent-monitor/`
