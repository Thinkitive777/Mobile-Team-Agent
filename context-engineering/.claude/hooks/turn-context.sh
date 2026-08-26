#!/usr/bin/env bash
# UserPromptSubmit — saves the user's message for the Git guard and warns on Fable 5.
set -uo pipefail
command -v node >/dev/null 2>&1 || exit 0
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${TMPDIR:-/tmp}/claude-team-guard" node "$DIR/turn-context.js" 2>/dev/null
exit 0
