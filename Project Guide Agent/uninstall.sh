#!/bin/bash
set -e

# Project Guide Agent — Uninstaller (Mac / Linux)

INSTALL_DIR="$HOME/.projectguide-agent"
CLAUDE_GLOBAL_MD="$HOME/.claude/CLAUDE.md"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "Project Guide Agent — Uninstaller"
echo "=================================="
echo ""

# Confirm
read -p "This will remove the Project Guide Agent. Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Remove MCP registration
echo -e "${YELLOW}Removing MCP registration...${NC}"
claude mcp remove projectguide-agent -s user > /dev/null 2>&1 || true
claude mcp remove projectguide-agent -s project > /dev/null 2>&1 || true
claude mcp remove projectguide-agent > /dev/null 2>&1 || true
echo -e "${GREEN}MCP registration removed.${NC}"

# Remove CLAUDE.md block
if [ -f "$CLAUDE_GLOBAL_MD" ]; then
    if grep -q "# --- Project Guide Agent Instructions ---" "$CLAUDE_GLOBAL_MD" 2>/dev/null; then
        echo -e "${YELLOW}Removing agent instructions from global CLAUDE.md...${NC}"
        sed '/# --- Project Guide Agent Instructions ---/,/# --- End Project Guide Agent Instructions ---/d' "$CLAUDE_GLOBAL_MD" > "$CLAUDE_GLOBAL_MD.tmp"
        mv "$CLAUDE_GLOBAL_MD.tmp" "$CLAUDE_GLOBAL_MD"
        # Remove file if empty (only whitespace left)
        if [ ! -s "$CLAUDE_GLOBAL_MD" ] || [ -z "$(tr -d '[:space:]' < "$CLAUDE_GLOBAL_MD")" ]; then
            rm "$CLAUDE_GLOBAL_MD"
            echo -e "${GREEN}Empty global CLAUDE.md removed.${NC}"
        else
            echo -e "${GREEN}Agent instructions removed from global CLAUDE.md.${NC}"
        fi
    fi
fi

# Remove PATH entry from shell rc
for RC_FILE in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
    if [ -f "$RC_FILE" ] && grep -q "projectguide-agent/bin" "$RC_FILE" 2>/dev/null; then
        echo -e "${YELLOW}Removing PATH entry from $RC_FILE...${NC}"
        sed '/# Project Guide Agent/d;/projectguide-agent\/bin/d' "$RC_FILE" > "$RC_FILE.tmp"
        mv "$RC_FILE.tmp" "$RC_FILE"
        echo -e "${GREEN}PATH entry removed.${NC}"
    fi
done

# Ask about daily reports
if [ -d "$INSTALL_DIR/daily-reports" ] && [ "$(ls -A "$INSTALL_DIR/daily-reports" 2>/dev/null)" ]; then
    echo ""
    read -p "Delete saved daily reports? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping reports at $INSTALL_DIR/daily-reports/"
        # Move reports out before deleting
        mkdir -p "$HOME/projectguide-reports-backup"
        cp -r "$INSTALL_DIR/daily-reports/"* "$HOME/projectguide-reports-backup/" 2>/dev/null || true
        echo "Reports backed up to $HOME/projectguide-reports-backup/"
    fi
fi

# Remove installation directory
echo -e "${YELLOW}Removing $INSTALL_DIR...${NC}"
rm -rf "$INSTALL_DIR"
echo -e "${GREEN}Installation directory removed.${NC}"

echo ""
echo -e "${GREEN}Uninstallation complete.${NC}"
echo "Restart your terminal for PATH changes to take effect."
echo ""
