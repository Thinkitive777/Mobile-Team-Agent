#!/bin/bash
# Project Guide Agent — Quick Uninstaller
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/Project Guide Agent"

INSTALLER=""

# Backwards compatible: older archives may have the uninstaller at the root,
# but this repo keeps it under `Project Guide Agent/Scripts/`.
if [ -f "$AGENT_DIR/uninstall.sh" ]; then
    INSTALLER="$AGENT_DIR/uninstall.sh"
elif [ -f "$AGENT_DIR/Scripts/uninstall.sh" ]; then
    INSTALLER="$AGENT_DIR/Scripts/uninstall.sh"
fi

if [ -z "$INSTALLER" ]; then
    # Agent was installed — run uninstall from installed location
    echo "Uninstall script not found in package. Performing manual cleanup..."
    claude mcp remove projectguide-agent -s user 2>/dev/null || true
    claude mcp remove projectguide-agent -s project 2>/dev/null || true
    rm -rf "$HOME/.projectguide-agent"
    # Remove .mcp.json entry if present
    if [ -f "$SCRIPT_DIR/.mcp.json" ]; then
        rm -f "$SCRIPT_DIR/.mcp.json"
    fi
    echo "Done."
    exit 0
fi

chmod +x "$INSTALLER"
exec "$INSTALLER"
