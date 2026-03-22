# Monitor Suite Architecture

`openclaw-agent-monitor` is the monitor framework for local OpenClaw operations on this machine class.

## Design goal

Provide one **operator-facing framework** with multiple **single-purpose watchdog services** underneath it.

Do **not** collapse everything into one always-on master daemon.

## Layers

### 1. Framework layer

The repo provides shared conventions for:

- paths
- logs
- state files
- event formats
- skills
- operator docs
- install/check helpers
- version-aware operational notes

### 2. Package layer

Each package should do one thing well.

Current packages:

- `packages/shared`
  - shared low-level helpers
  - file/log rotation contract
  - small utilities meant to reduce duplicated operational logic
- `packages/lite-watcher`
  - precision-first
  - read-only by default
  - deterministic monitoring / reporting / drift detection
- `packages/gateway-watchdog`
  - narrow self-recovery
  - only for gateway fake-alive failures
  - strict budgets and suppression windows

### 3. Runtime layer

Each watchdog gets its own LaunchAgent and lifecycle.

Current services:

- `ai.openclaw.lite-watcher`
- `ai.openclaw.gateway-watchdog`

This keeps responsibilities separate and avoids a single point of operational failure.

### 4. Operator layer

Use a common operator surface for:

- status
- health checks
- install / reinstall
- uninstall
- suppression
- docs lookup
- version-aware revalidation after OpenClaw upgrades

## Why not one giant watcher process

A single always-on “do everything” watcher tends to:

- mix read-only monitoring with active recovery
- blur safety boundaries
- accumulate too much hidden authority
- become harder to reason about during incidents

The suite should stay modular instead.

## Shared conventions

### Naming

- package names should be explicit and narrow
- LaunchAgent labels should stay under `ai.openclaw.*`
- logs and state should live under `~/.openclaw/`

### State

Suggested shape for each watchdog:

- `~/.openclaw/state/<name>/state.json`
- `~/.openclaw/state/<name>/events.jsonl`
- optional suppression file

### Logs

Suggested shape for each watchdog:

- main log: `~/.openclaw/logs/<name>.log`
- launchd stdout/stderr files when applicable
- if retention is needed, prefer a shared suite-level rotation helper over ad hoc per-script logic

### Suppression

Action-capable watchdogs should support explicit suppression windows for maintenance.

### Retry budgets

Action-capable watchdogs must define:

- evidence threshold
- cooldown
- max retries per hour/day
- recovery verification step

## Version-aware operations

This framework should keep a distinction between:

- **stable invariants**
  - process-separation rules
  - suppression requirements
  - no-infinite-retry rules
- **version-sensitive quirks**
  - bugs observed on specific OpenClaw versions
  - temporary workarounds
  - revalidation notes after upgrades

Do not hard-code every current workaround as eternal truth.

## Interaction model for OpenClaw agents

OpenClaw should be able to:

- inspect suite health
- inspect specific watchdog health
- install / reinstall a watchdog
- suppress / unsuppress action-capable watchdogs during maintenance
- consult docs/skills before changing runtime behavior

OpenClaw should **not** blindly restart or broaden recovery logic just because a watchdog exists.

## Recommended operating model

- install/reinstall from the suite root when you want predictable local state
- use package-specific scripts only for targeted maintenance
- keep each watchdog single-purpose and low-frequency
- prefer observable files, logs, and LaunchAgent state over hidden coordination
- if a watchdog needs to act, require explicit suppression windows, retry budgets, and recovery verification

## Near-term evolution

Next natural additions:

- more shared helpers only when they clearly remove duplication without adding orchestration complexity
- version-aware operational docs refinement
- a stronger unified operator surface if the current scripts stay clean and low-risk
