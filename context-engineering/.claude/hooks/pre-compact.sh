#!/usr/bin/env bash
# PreCompact — reminds the developer to save a Context Handoff before compacting.
# Only warns when no handoff file was written in the last 3 hours.
set -uo pipefail
DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}/docs/handoffs"
RECENT=""
[ -d "$DIR" ] && RECENT=$(find "$DIR" -name '*.md' -mmin -180 2>/dev/null | grep -v README | head -1)
if [ -z "$RECENT" ]; then
  echo "No Context Handoff was saved in the last 3 hours. Important context may be lost after /compact. Run /handoff first if this task still matters." >&2
fi
exit 0
