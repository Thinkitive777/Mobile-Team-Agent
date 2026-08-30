#!/usr/bin/env bash
# SessionStart — tells Claude which Context Handoffs exist, in a few lines.
# Prints nothing when there are no handoffs, so it costs nothing on a clean repo.
set -uo pipefail
DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}/docs/handoffs"
[ -d "$DIR" ] || exit 0

FILES=$(ls -t "$DIR"/*.md 2>/dev/null | grep -v '/README.md$' | head -5)
[ -z "$FILES" ] && exit 0

LIST=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  TITLE=$(grep -m1 '^## Task' -A2 "$f" 2>/dev/null | sed -n '2p' | cut -c1-90)
  [ -z "$TITLE" ] && TITLE=$(head -1 "$f" | sed 's/^# *//' | cut -c1-90)
  LIST="${LIST}- docs/handoffs/$(basename "$f") — ${TITLE}"$'\n'
done <<< "$FILES"

cat <<EOF
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$(printf '%s' "Context Handoffs from earlier tasks (read one ONLY if the user's task is related — do not read them all):
${LIST}Use /resume-handoff <file> to load one." | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.stringify(d)))')}}
EOF
exit 0
