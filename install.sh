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

chmod +x "$AGENT_DIR/install.sh"
exec "$AGENT_DIR/install.sh"
