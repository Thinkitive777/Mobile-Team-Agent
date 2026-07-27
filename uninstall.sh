#!/bin/bash
# Mobile Team Agent — Quick Uninstaller
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/Mobile Team Agent"

INSTALLER=""

# Backwards compatible: older archives may have the uninstaller at the root,
# but this repo keeps it under `Mobile Team Agent/Scripts/`.
if [ -f "$AGENT_DIR/uninstall.sh" ]; then
    INSTALLER="$AGENT_DIR/uninstall.sh"
elif [ -f "$AGENT_DIR/Scripts/uninstall.sh" ]; then
    INSTALLER="$AGENT_DIR/Scripts/uninstall.sh"
fi

if [ -z "$INSTALLER" ]; then
    # Agent was installed — run uninstall from installed location
    echo "Uninstall script not found in package. Performing manual cleanup..."
    claude mcp remove mobile-team-agent -s user 2>/dev/null || true
    rm -rf "$HOME/.mobile-team-agent"
    echo "Done. You may need to manually clean ~/.claude/CLAUDE.md"
    exit 0
fi

chmod +x "$INSTALLER"
exec "$INSTALLER"
