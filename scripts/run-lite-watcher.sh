#!/bin/zsh
set -euo pipefail

REPO="$HOME/github/openclaw-agent-monitor"
PKG="$REPO/packages/lite-watcher"
STATE_DIR="$HOME/.openclaw/state/lite-watcher"
LOG_DIR="$HOME/.openclaw/logs"
mkdir -p "$STATE_DIR" "$LOG_DIR"

NODE_BIN="$HOME/.nvm/versions/node/v24.14.0/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node)"
fi

exec "$NODE_BIN" "$PKG/src/watcher.mjs" check \
  --state "$STATE_DIR/watcher-state.json" \
  --report "$STATE_DIR/last-report.json" \
  --lock "$STATE_DIR/watcher.lock" \
  >> "$LOG_DIR/openclaw-lite-watcher.log" 2>&1
