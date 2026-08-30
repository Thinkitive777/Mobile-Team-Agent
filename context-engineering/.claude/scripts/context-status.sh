#!/usr/bin/env bash
# Data source for /context. Prints facts only — no advice, no guessing.
# Context % comes from the status line state file, which gets the real number
# from Claude Code. If the status line has not run yet, it prints "unknown".
set -uo pipefail
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_DIR="${TMPDIR:-/tmp}/claude-team-guard"

CTX="unknown"
# Newest .ctx wins: the status line of the active session refreshes constantly.
# Ignore anything older than 5 minutes — it belongs to a different session.
CTXFILE=$(find "$STATE_DIR" -name "*.ctx" -mmin -5 2>/dev/null | xargs ls -t 2>/dev/null | head -1)
if [ -n "$CTXFILE" ] && command -v node >/dev/null 2>&1; then
  CTX=$(node -e '
    const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const size=j.context_window_size?" of "+Math.round(j.context_window_size/1000)+"k":"";
    process.stdout.write(j.used_percentage+"%"+size);
  ' "$CTXFILE" 2>/dev/null || echo "unknown")
fi

ACTIVE=""
[ -f "$ROOT/.claude/checkpoints/ACTIVE" ] && ACTIVE=$(cat "$ROOT/.claude/checkpoints/ACTIVE" 2>/dev/null)

CP="none"
UNK=0
if [ -n "$ACTIVE" ] && [ -f "$ROOT/.claude/checkpoints/$ACTIVE.md" ]; then
  F="$ROOT/.claude/checkpoints/$ACTIVE.md"
  CP=".claude/checkpoints/$ACTIVE.md (updated $(date -r "$F" '+%H:%M' 2>/dev/null))"
  UNK=$(grep -c '^| *UNKNOWN #[0-9]* *|.*| *open *|' "$F" 2>/dev/null || echo 0)
fi

HO="none"
LAST=$(ls -t "$ROOT"/docs/handoffs/*.md 2>/dev/null | grep -v '/README.md$' | head -1)
[ -n "$LAST" ] && HO="docs/handoffs/$(basename "$LAST")"

cat <<EOF
task_slug: ${ACTIVE:-none}
context_used: $CTX
open_unknowns: $UNK
checkpoint: $CP
latest_handoff: $HO
EOF
