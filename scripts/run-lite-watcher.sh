#!/bin/zsh
set -euo pipefail

REPO="$HOME/github/openclaw-agent-monitor"
PKG="$REPO/packages/lite-watcher"
SHARED="$REPO/packages/shared"
STATE_DIR="$HOME/.openclaw/state/lite-watcher"
LOG_DIR="$HOME/.openclaw/logs"
mkdir -p "$STATE_DIR" "$LOG_DIR"

NODE_BIN="$HOME/.nvm/versions/node/v24.14.0/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node)"
fi

"$NODE_BIN" "$SHARED/src/rotate-cli.mjs" \
  --file "$LOG_DIR/openclaw-lite-watcher.log" \
  --max-bytes $((512 * 1024)) \
  --keep 3 >/dev/null 2>&1 || true

exec "$NODE_BIN" "$PKG/src/watcher.mjs" check \
  --state "$STATE_DIR/watcher-state.json" \
  --report "$STATE_DIR/last-report.json" \
  --lock "$STATE_DIR/watcher.lock" \
  >> "$LOG_DIR/openclaw-lite-watcher.log" 2>&1
