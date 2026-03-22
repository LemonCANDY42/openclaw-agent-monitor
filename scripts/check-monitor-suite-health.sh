#!/bin/zsh
set -euo pipefail

REPO="$HOME/github/openclaw-agent-monitor"

echo '=== lite-watcher ==='
"$REPO/scripts/check-lite-watcher-health.sh"

echo ''
echo '=== gateway-watchdog ==='
"$REPO/scripts/check-gateway-watchdog-health.sh"
