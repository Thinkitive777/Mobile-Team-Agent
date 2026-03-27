#!/bin/bash
# Project Guide Agent — Quick Uninstaller (inner-folder wrapper)
# Lets you run: chmod +x uninstall.sh && ./uninstall.sh from `Project Guide Agent/`.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="$SCRIPT_DIR/Scripts/uninstall.sh"

if [ ! -f "$INSTALLER" ]; then
    echo "Error: Uninstaller not found at:"
    echo "  $INSTALLER"
    exit 1
fi

chmod +x "$INSTALLER"
exec "$INSTALLER"

