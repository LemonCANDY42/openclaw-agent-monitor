# openclaw-monitor-shared

Shared low-level helpers for the OpenClaw monitor suite.

Current scope is intentionally small:

- file/log rotation helper
- tiny CLI for preflight rotation from shell entrypoints

This package should stay boring and minimal.
Add helpers here only when they clearly remove duplicated operational logic without introducing a new orchestration layer.
