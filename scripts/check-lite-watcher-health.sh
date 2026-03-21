#!/bin/zsh
set -euo pipefail

LABEL="ai.openclaw.lite-watcher"
STATE_DIR="$HOME/.openclaw/state/lite-watcher"
REPORT="$STATE_DIR/last-report.json"
STATE="$STATE_DIR/watcher-state.json"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl print "gui/$(id -u)/$LABEL" >/tmp/lite-watcher-launchctl.txt 2>/tmp/lite-watcher-launchctl.err || true
python3 - <<'PY'
import json, os, pathlib, re, subprocess, time
label = 'ai.openclaw.lite-watcher'
state_dir = pathlib.Path.home()/'.openclaw'/'state'/'lite-watcher'
report = state_dir/'last-report.json'
state = state_dir/'watcher-state.json'
plist = pathlib.Path.home()/'Library'/'LaunchAgents'/f'{label}.plist'
launch_out = pathlib.Path('/tmp/lite-watcher-launchctl.txt').read_text() if pathlib.Path('/tmp/lite-watcher-launchctl.txt').exists() else ''
launch_err = pathlib.Path('/tmp/lite-watcher-launchctl.err').read_text() if pathlib.Path('/tmp/lite-watcher-launchctl.err').exists() else ''

def load_json(p):
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception as e:
            return {'_load_error': str(e)}
    return None

report_json = load_json(report)
state_json = load_json(state)
now = time.time()
checked_at = None
report_age_s = None
if isinstance(report_json, dict):
    checked_at = report_json.get('checkedAt')
    if checked_at:
        try:
            import datetime as dt
            ts = dt.datetime.fromisoformat(checked_at.replace('Z', '+00:00')).timestamp()
            report_age_s = int(now - ts)
        except Exception:
            pass

auto_resume_enabled = None
deny_prefixes = []
try:
    cfg = json.loads((pathlib.Path.home()/'.openclaw'/'openclaw.json').read_text())
    ar = (((cfg.get('plugins') or {}).get('entries') or {}).get('auto-resume-lite') or {})
    auto_resume_enabled = ar.get('enabled')
    deny_prefixes = (((ar.get('config') or {}).get('denySessionKeyPrefixes')) or [])
except Exception:
    pass

result = {
    'label': label,
    'launchAgent': {
        'plistExists': plist.exists(),
        'loaded': ('state = running' in launch_out) or ('state = waiting' in launch_out) or ('last exit code = 0' in launch_out) or ('pid =' in launch_out),
        'rawHint': launch_out[:800] if launch_out else launch_err[:400],
    },
    'watcher': {
        'reportExists': report.exists(),
        'stateExists': state.exists(),
        'checkedAt': checked_at,
        'reportAgeSeconds': report_age_s,
        'humanSummary': report_json.get('humanSummary') if isinstance(report_json, dict) else None,
        'incidents': report_json.get('incidents') if isinstance(report_json, dict) else None,
        'proposedActions': report_json.get('proposedActions') if isinstance(report_json, dict) else None,
    },
    'autoResumeLite': {
        'enabled': auto_resume_enabled,
        'denySessionKeyPrefixes': deny_prefixes,
        'telegramDenied': 'agent:main:telegram:' in deny_prefixes,
        'feishuDenied': 'agent:main:feishu:' in deny_prefixes,
    }
}
print(json.dumps(result, ensure_ascii=False, indent=2))
PY
