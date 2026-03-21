# OpenClaw Watcher v1 Architecture

## 1. Purpose

This watcher is meant to catch **high-confidence operational breakage** in OpenClaw without spending model tokens.

It is optimized for Kenny's stated preferences:

- quiet and careful
- strong bias toward precision
- serialized / non-racy operational behavior
- avoid disruptive actions unless confidence is very high
- preserve remote control availability
- treat past Feishu file-send permission confusion as **resolved unless fresh evidence reappears**

## 2. Non-goals

Watcher v1 is **not**:

- a general workflow engine
- a broad anomaly detector
- a replacement for human judgment
- a config mutator by default
- an auto-resume system
- a chat/LLM summarizer

## 3. Tiered design

### Tier 0 — Cheap baseline (always safe)

Run only deterministic, low-cost reads:

1. `openclaw status --deep --json`
2. redacted projection + fingerprint of `~/.openclaw/openclaw.json`
3. latest OpenClaw log path under `/tmp/openclaw/`
4. session recency from status JSON

If everything looks healthy enough, stop here.

### Tier 1 — Corroboration (only on suspicion)

If a suspicious condition appears, read only bounded local evidence:

- new log delta from the latest log file
- recent success/failure markers for the affected channel
- whether a known-good config fingerprint existed previously
- whether a drain / deferral / in-flight window is active

No browser, no agent, no external writes.

### Tier 2 — Deterministic self-heal planning

Only after Tier 1 confirms the issue, produce a strict self-heal plan.

Default v1 behavior: **plan only, do not execute**.

Candidate actions must satisfy all of these:

- deterministic
- reversible or low-risk
- scoped to the affected subsystem
- not during active in-flight/drain windows
- not blocked by cooldown

### Tier 3 — Remote notification / agent escalation

Escalate only if:

- a hard failure is confirmed, and
- deterministic self-heal is unavailable, suppressed, or already failed, and
- cooldown permits escalation

If one remote-control path survives, use that path for recovery instructions instead of waking an agent immediately.

## 4. Strict operating rules

1. **Single weak signal never pages.**
2. **Health mismatch alone never triggers restart.**
3. **Status-path disagreement is diagnostic, not operational failure, unless corroborated.**
4. **Old permission incidents do not count. Fresh evidence only.**
5. **No restart while drain / in-flight race markers are active.**
6. **No config writes by default.**
7. **No plugin enable/disable by watcher.**
8. **No agent escalation before deterministic checks.**
9. **Cooldown every disruptive recommendation.**
10. **Prefer preserving Telegram as primary recovery path, Feishu as fallback.**
11. **Healthy direct conversations should not be interrupted by recovery logic unless evidence is very strong.**

## 4.1 Unattended-use requirements for the watcher itself

Watcher v1 should be safe to leave running for long periods. That means:

- bounded local reads only
- command timeouts on all OpenClaw CLI probes
- delta-tail rather than full-log scan
- single-instance lock to avoid overlapping runs
- atomic writes for state/report outputs
- graceful success exit when another watcher run is already active
- no dependence on browser or LLM paths for base health checks

## 5. High-confidence signals and thresholds

## Signal A — `feishu_status_path_mismatch`

### Meaning
The status command has inconsistent Feishu readouts across different code paths.

### Required evidence
At least **2 corroborating signals**:

- `status.health.channels.feishu.configured === false`, **and**
- one of:
  - `status.health.channels.feishu.accounts.main.configured === true`
  - `status.health.channels.feishu.accounts.main.probe.ok === true`
  - log shows recent `feishu[main]` success markers (`received message`, `dispatch complete`, `starting`, `bot open_id resolved`)

### Threshold
- fire immediately as **diagnostic info/warn**
- **never** restart on this signal alone

### Default action
- suppress noisy escalation
- record mismatch
- trust stronger evidence: channel success logs + account-level probe

This directly matches the recent Feishu incident where `Channels` looked healthy while `Health` said OFF/not configured.

## Signal B — `feishu_config_drift_disable`

### Meaning
Feishu was effectively disabled or lost required config despite a previously known-good setup.

### Required evidence
- relevant config projection now says `channels.feishu.enabled !== true` **or** main account is missing core shape, **and**
- previous state had a known-good Feishu fingerprint / enabled flag, **and**
- status/log corroborate lack of recent successful Feishu activity

### Threshold
- 1 hard config failure + 1 corroborator

### Default action
- high-confidence incident
- default to **manual restore plan only**
- do not auto-write config in v1

## Signal C — `repeated_delivery_failure_same_channel`

### Meaning
A real delivery path is failing repeatedly, not just once.

### Required evidence
- at least **2 matching fresh error events** within **30 minutes** on the same channel/signature, and
- **0 success markers after the last error** within **15 minutes**

### Example patterns
- `99991672`
- `im:resource`
- `im:resource:upload`
- `dispatch failed`
- `send failed`
- `upload ... failed`

### Threshold
- one failure = observe only
- two fresh failures with no recovery = actionable

### Default action
- propose deterministic self-heal ladder
- do not escalate agent yet if a restart-sized fix is still available and safe

## Signal D — `drain_race_restart_deferral`

### Meaning
A config/restart change collided with live in-flight operations.

### Required evidence
At least **2 related markers** within **10 minutes**:

- `config change requires gateway restart ... deferring until ... complete`
- `abort signal received`
- later `dispatching to agent` / `dispatch complete` for the same channel family

### Threshold
- 2+ markers in sequence within the same event window

### Default action
- hold all restart recommendations for **10 minutes**
- mark as race-risk
- prefer quiet observation and human review

This covers the recent channel-disable / drain / one-more-resume slip-through behavior.

## Signal E — `auto_resume_feishu_risk`

### Meaning
Auto-resume behavior is able to touch Feishu sessions again.

### Required evidence
Any of:

- `auto-resume-lite` is enabled **and** deny prefixes do not include `agent:main:feishu:`
- fresh log evidence shows Feishu auto-resume activity

### Threshold
- one hard policy failure is enough

### Default action
- warn only
- do not let watcher auto-fix plugin state in v1
- block agent escalation from blaming Feishu transport until this is accounted for

## Signal F — `all_remote_paths_lost`

### Meaning
No healthy remote-control path remains.

### Required evidence
- Telegram unhealthy / unavailable, **and**
- Feishu unhealthy / unavailable, **and**
- no fresh success markers for either path

### Threshold
- 2 channels down + no surviving path

### Default action
- highest urgency
- deterministic self-heal first if safe
- then escalate agent / operator

## Signal G — `auto_resume_conversation_noise`

### Meaning
A recovery plugin scheduled auto-resume on a human-facing direct conversation session.

### Required evidence
- fresh log line like `scheduled auto-resume for ...`, **and**
- session key shows a direct conversation family such as:
  - `:telegram:direct:`
  - `:feishu:direct:`

### Threshold
- 1 fresh occurrence is already worth review
- repeated occurrences increase severity

### Default action
- do not let watcher treat this as transport outage
- recommend narrowing auto-resume scope before blaming the channel
- prefer disabling or constraining `non_action`-style recovery on direct chats

## 6. Self-heal ladder (deterministic, precision-first)

Watcher v1 only recommends these steps; it does not execute them by default.

### Ladder 0 — Do nothing if mismatch is only cosmetic

If Feishu shows account-level success/probe truth but top-level health says OFF/not configured:

- classify as status-path mismatch
- no restart
- no config write
- no agent escalation

### Ladder 1 — Re-observe after short debounce

For first-seen failures:

- wait at least **3 minutes**
- require a second corroborating signal

### Ladder 2 — Safe gateway restart recommendation

Only recommend `openclaw gateway restart` when all are true:

- repeated failure threshold met
- config fingerprint still looks sane
- no drain-race markers active
- no active quiet-window violation (for example very recent conversation / in-flight session)
- restart cooldown expired

### Ladder 3 — Manual config restore recommendation

If a previously-good channel was drift-disabled:

- recommend restoring only the relevant known-good config branch
- then restart gateway
- default v1 stance: manual/human or future opt-in automation only

### Ladder 4 — Agent escalation

Only after:

- failure remains after Ladder 2/3 were unavailable or already attempted, and
- escalation cooldown expired, and
- at least one strong corroborating signal still persists

## 7. Cooldowns

Recommended v1 defaults:

- observe debounce: **3 min**
- self-heal recommendation cooldown: **15 min per incident key**
- agent escalation cooldown: **60 min per incident key**
- drain-race restart hold: **10 min**
- quiet window before recommending restart: **2 min since latest active session event**

## 8. State file strategy

Store only local operational state, no secrets.

Suggested file:

- `ops/openclaw-watcher-v1/state/watcher-state.json`

### Keep
- watcher version
- last run timestamp
- last known-good redacted config fingerprint
- per-incident counters / firstSeen / lastSeen
- cooldown timestamps
- log cursor per file
- last report metadata

### Do not keep
- raw tokens/secrets
- full OpenClaw config contents
- full logs
- message bodies beyond what is strictly needed for signatures

## 9. Log-tail strategy

Use a **bounded delta** approach, not full log rescans.

### Strategy
- choose newest `/tmp/openclaw/openclaw-*.log`
- remember byte cursor by path + size/mtime
- on next run, read only appended bytes
- if rotated or truncated, read only the last bounded chunk (for example 256 KB)

### Why
- cheap
- deterministic
- restart-safe
- avoids burning CPU on giant files

### Preferred evidence types
- start/stop markers
- dispatch complete / received message markers
- hard error signatures
- restart deferral / drain markers
- config patch / reload markers

## 10. Escalation policy

### Notify only
Use a surviving channel when:

- one channel is broken but another is still healthy
- the issue is operationally clear
- the human just needs recovery instructions / awareness

### Agent escalation
Use only when:

- both transport evidence and config/runtime evidence align, or
- deterministic self-heal is blocked/failed, or
- all remote paths are lost

### Explicitly avoid escalating on
- one-off tool failures
- old Feishu permission confusion without fresh errors
- status-table mismatches with fresh success logs
- warnings about disabled plugin config being present, by themselves

## 11. Recommended placement

### Workspace now
- `ops/openclaw-watcher-v1/`

### If promoted into a real repo
Preferred path:

- `~/github/openclaw-agent-monitor/packages/lite-watcher/`

Reason:

- aligns with Kenny's preference to operate from `~/github` for code that may evolve
- fits the existing staged candidate repo shape under `community/openclaw-agent-monitor/`
- keeps this watcher as one precise package inside a broader monitor line instead of overloading OpenClaw core too early
