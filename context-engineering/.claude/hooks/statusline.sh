#!/usr/bin/env bash
# statusLine — model, real context usage, project, active task.
set -uo pipefail
command -v node >/dev/null 2>&1 || { echo "claude"; exit 0; }
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${TMPDIR:-/tmp}/claude-team-guard" node "$DIR/statusline.js" 2>/dev/null || echo "claude"
