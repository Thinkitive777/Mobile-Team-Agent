#!/bin/bash
# Project Guide Agent — Quick Installer (inner-folder wrapper)
# Lets you run: chmod +x install.sh && ./install.sh from `Project Guide Agent/`.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="$SCRIPT_DIR/Scripts/install.sh"

if [ ! -f "$INSTALLER" ]; then
    echo "Error: Installer not found at:"
    echo "  $INSTALLER"
    exit 1
fi

chmod +x "$INSTALLER"
exec "$INSTALLER"

