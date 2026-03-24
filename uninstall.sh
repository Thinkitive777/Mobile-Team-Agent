#!/bin/bash
# Project Guide Agent — Quick Uninstaller
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/Project Guide Agent"

if [ -f "$AGENT_DIR/uninstall.sh" ]; then
    chmod +x "$AGENT_DIR/uninstall.sh"
    exec "$AGENT_DIR/uninstall.sh"
else
    # Agent was installed — run uninstall from installed location
    echo "Uninstall script not found in package. Performing manual cleanup..."
    claude mcp remove projectguide-agent -s user 2>/dev/null || true
    rm -rf "$HOME/.projectguide-agent"
    echo "Done. You may need to manually clean ~/.claude/CLAUDE.md"
fi
