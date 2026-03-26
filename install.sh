#!/bin/bash
# Project Guide Agent — Quick Installer
# Just unzip and run: chmod +x install.sh && ./install.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/Project Guide Agent"

if [ ! -d "$AGENT_DIR" ]; then
    echo "Error: 'Project Guide Agent' directory not found."
    echo "Make sure you're running this from the unzipped project root."
    exit 1
fi

INSTALLER=""

# Backwards compatible: older archives may have the installer at the root,
# but this repo keeps it under `Project Guide Agent/Scripts/`.
if [ -f "$AGENT_DIR/install.sh" ]; then
    INSTALLER="$AGENT_DIR/install.sh"
elif [ -f "$AGENT_DIR/Scripts/install.sh" ]; then
    INSTALLER="$AGENT_DIR/Scripts/install.sh"
fi

if [ -z "$INSTALLER" ]; then
    echo "Error: Installer not found."
    echo "Expected either:"
    echo "  - $AGENT_DIR/install.sh"
    echo "  - $AGENT_DIR/Scripts/install.sh"
    exit 1
fi

chmod +x "$INSTALLER"
exec "$INSTALLER"
