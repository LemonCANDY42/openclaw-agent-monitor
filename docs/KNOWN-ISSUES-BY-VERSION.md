# Known Issues by Version

This file tracks **version-sensitive** OpenClaw operational quirks.

Use it for:

- observed regressions
- temporary workarounds
- upgrade revalidation notes

Do **not** put stable cross-version invariants here.

## Entry format

For each issue, capture:

- `observed_on`
- `verified_on`
- `affected_versions`
- `symptom`
- `evidence`
- `current_workaround`
- `recheck_after_upgrade`
- `sunset_condition`

---

## gateway-restart-fake-alive-2026-3-13

- observed_on: `2026-03-21`
- verified_on: `2026-03-22`
- affected_versions: `observed on OpenClaw 2026.3.13`
- symptom:
  - gateway restart/drain can leave the service in a fake-alive state
  - launchd/runtime may still report running
  - RPC probe fails or the gateway never fully returns to healthy service
- evidence:
  - incident investigation around ~2026-03-21 22:35 Asia/Shanghai
  - restart requested during active tasks / embedded run drain window
  - no clean post-restart `listening on ws://127.0.0.1:18789` recovery until doctor/manual intervention later
- current_workaround:
  - use `packages/gateway-watchdog`
  - keep restart/reload behavior conservative during active runs
  - respect planned restart grace windows and suppression windows
- recheck_after_upgrade:
  - after upgrading OpenClaw, intentionally re-evaluate whether this restart/drain fake-alive pattern still reproduces
  - if no longer reproducible, downgrade this workaround from active to historical
- sunset_condition:
  - remove or relax the specific version workaround once the issue is no longer reproducible on newer OpenClaw builds
