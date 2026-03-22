#!/bin/zsh
set -euo pipefail

REPO="$HOME/github/openclaw-agent-monitor"
PKG="$REPO/packages/gateway-watchdog"
SHARED="$REPO/packages/shared"
STATE_DIR="$HOME/.openclaw/state/gateway-watchdog"
LOG_DIR="$HOME/.openclaw/logs"
mkdir -p "$STATE_DIR" "$LOG_DIR"

NODE_BIN="/opt/homebrew/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node)"
fi

"$NODE_BIN" "$SHARED/src/rotate-cli.mjs" \
  --file "$LOG_DIR/gateway-watchdog.log" \
  --max-bytes $((512 * 1024)) \
  --keep 3 >/dev/null 2>&1 || true

exec "$NODE_BIN" "$PKG/src/watchdog.mjs" check \
  >> "$LOG_DIR/gateway-watchdog.log" 2>&1
