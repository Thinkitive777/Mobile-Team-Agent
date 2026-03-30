#!/bin/bash

# ============================================================
# Project Guide Agent — Global Installer (Mac / Linux)
#
# Usage: chmod +x install.sh && ./install.sh
#
# What this does:
#   1. Installs the agent binary to ~/.projectguide-agent/
#   2. Registers the MCP server GLOBALLY with Claude CLI
#   3. Installs CLAUDE.md to ~/.claude/ for global recognition
#   4. Any folder on this machine will recognize the agent
# ============================================================

# Don't use set -e — we handle errors explicitly to avoid silent failures
# that leave the install half-done without MCP registration

INSTALL_DIR="$HOME/.projectguide-agent"
BIN_DIR="$INSTALL_DIR/bin"
BINARY_NAME="projectguide-agent"
CLAUDE_GLOBAL_DIR="$HOME/.claude"
CLAUDE_JSON="$HOME/.claude.json"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="2.1.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_banner() {
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${CYAN}  Project Guide Agent Installer v${VERSION}${NC}"
    echo -e "${CYAN}============================================${NC}"
    echo ""
}

info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $1"; }

print_banner

# ----------------------------------------------------------
# Step 1: Detect OS and Architecture
# ----------------------------------------------------------
info "Detecting system..."

OS_TYPE=$(uname -s)
ARCH_TYPE=$(uname -m)

case "$OS_TYPE" in
    Darwin)
        OS_LABEL="macOS"
        SOURCE_BINARY="$SCRIPT_DIR/dist/project-guide-agent-macos"
        ;;
    Linux)
        OS_LABEL="Linux"
        SOURCE_BINARY="$SCRIPT_DIR/dist/project-guide-agent-linux"
        ;;
    *)
        fail "Unsupported OS: $OS_TYPE. Use install.bat for Windows."
        exit 1
        ;;
esac

case "$ARCH_TYPE" in
    x86_64|amd64)
        ARCH_LABEL="x64"
        ;;
    arm64|aarch64)
        ARCH_LABEL="arm64"
        # arm64 binary has a different name if available
        if [ -f "${SOURCE_BINARY}-arm64" ]; then
            SOURCE_BINARY="${SOURCE_BINARY}-arm64"
        else
            warn "No native ARM64 binary found. x64 binary will run via Rosetta 2 (macOS) or emulation."
        fi
        ;;
    *)
        ARCH_LABEL="$ARCH_TYPE"
        warn "Unknown architecture: $ARCH_TYPE. Attempting x64 binary."
        ;;
esac

success "Detected: $OS_LABEL ($ARCH_LABEL)"

# ----------------------------------------------------------
# Step 2: Check prerequisites
# ----------------------------------------------------------
info "Checking prerequisites..."

# Check if Claude CLI is installed
if ! command -v claude &> /dev/null; then
    fail "Claude CLI not found. Please install it first:"
    echo "    npm install -g @anthropic-ai/claude-code"
    echo ""
    echo "  Or visit: https://docs.anthropic.com/en/docs/claude-code"
    exit 1
fi
success "Claude CLI found: $(which claude)"

# ----------------------------------------------------------
# Step 3: Create installation directory
# ----------------------------------------------------------
info "Installing to $INSTALL_DIR ..."
mkdir -p "$BIN_DIR"
mkdir -p "$INSTALL_DIR/src"
mkdir -p "$INSTALL_DIR/daily-reports"

# ----------------------------------------------------------
# Step 4: Install source files (always) and optional binary
# ----------------------------------------------------------
# MCP registration always uses Node.js source (not binary) to
# guarantee the server stays in sync with the latest code.
# Binary is still installed for optional CLI/PATH usage.
INSTALL_MODE=""

# 4a. Always install source if available (required for MCP)
if [ -f "$SCRIPT_DIR/Main/index.js" ]; then
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_VERSION" -ge 18 ] 2>/dev/null; then
            info "Installing source files..."

            # Copy source files
            cp -R "$SCRIPT_DIR/Constants" "$INSTALL_DIR/src/"
            cp -R "$SCRIPT_DIR/Main" "$INSTALL_DIR/src/"
            cp -R "$SCRIPT_DIR/Scripts" "$INSTALL_DIR/src/"
            cp -R "$SCRIPT_DIR/Skills" "$INSTALL_DIR/src/"
            cp -R "$SCRIPT_DIR/Utils" "$INSTALL_DIR/src/"
            cp -R "$SCRIPT_DIR/Services" "$INSTALL_DIR/src/"
            if [ -f "$SCRIPT_DIR/package.json" ]; then
                cp "$SCRIPT_DIR/package.json" "$INSTALL_DIR/src/"
            fi

            # Copy .env.example
            if [ -f "$SCRIPT_DIR/.env.example" ]; then
                cp "$SCRIPT_DIR/.env.example" "$INSTALL_DIR/src/.env.example"
            fi

            # Install dependencies
            info "Installing Node.js dependencies..."
            cd "$INSTALL_DIR/src"
            npm install --production --silent 2>/dev/null
            cd "$SCRIPT_DIR"

            # Create a runner script that uses Node.js source
            cat > "$BIN_DIR/$BINARY_NAME" << 'RUNNER'
#!/bin/bash
AGENT_DIR="$HOME/.projectguide-agent/src"
exec node "$AGENT_DIR/Main/index.js" "$@"
RUNNER
            chmod +x "$BIN_DIR/$BINARY_NAME"
            INSTALL_MODE="source"
            success "Source installed to $INSTALL_DIR/src/ (Node.js mode)"
        else
            fail "Node.js 18+ required but found v$NODE_VERSION"
        fi
    fi
fi

# 4b. Fallback to binary if source install failed (no Node.js 18+)
if [ -z "$INSTALL_MODE" ] && [ -f "$SOURCE_BINARY" ]; then
    info "Node.js 18+ not available. Trying pre-built binary..."
    cp "$SOURCE_BINARY" "$BIN_DIR/$BINARY_NAME"
    chmod +x "$BIN_DIR/$BINARY_NAME"

    # Verify the binary actually responds to MCP protocol
    BINARY_OK=false
    VERIFY_OUTPUT=$(echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"1.0"}},"id":1}' | {
        if command -v timeout &> /dev/null; then
            timeout 10 "$BIN_DIR/$BINARY_NAME" 2>/dev/null
        else
            "$BIN_DIR/$BINARY_NAME" 2>/dev/null &
            VPID=$!
            sleep 5
            kill $VPID 2>/dev/null
            wait $VPID 2>/dev/null
        fi
    } 2>/dev/null)

    if echo "$VERIFY_OUTPUT" | grep -q "protocolVersion" 2>/dev/null; then
        BINARY_OK=true
    fi

    if [ "$BINARY_OK" = true ]; then
        INSTALL_MODE="binary"
        success "Binary installed and verified at $BIN_DIR/$BINARY_NAME"
    else
        warn "Binary does not respond to MCP protocol."
        rm -f "$BIN_DIR/$BINARY_NAME"
    fi
fi

if [ -z "$INSTALL_MODE" ]; then
    fail "No binary or source files found, or prerequisites not met."
    echo ""
    echo "  Options:"
    echo "    1. Install Node.js 18+: https://nodejs.org"
    echo "    2. Build binaries: cd 'Project Guide Agent' && npm run build"
    exit 1
fi

# Copy invoke wrapper
if [ -f "$SCRIPT_DIR/Scripts/invoke" ]; then
    cp "$SCRIPT_DIR/Scripts/invoke" "$BIN_DIR/invoke"
    chmod +x "$BIN_DIR/invoke"
fi

# ----------------------------------------------------------
# Step 5: Register MCP server GLOBALLY with Claude CLI
# ----------------------------------------------------------
info "Registering MCP server globally..."

# Remove any existing registration (all scopes)
claude mcp remove projectguide-agent -s user > /dev/null 2>&1 || true
claude mcp remove projectguide-agent -s project > /dev/null 2>&1 || true
claude mcp remove projectguide-agent > /dev/null 2>&1 || true

# Register at USER scope — this makes it available in ALL directories
# The config is written to ~/.claude.json under mcpServers
# For source installs, register with 'node' directly to avoid stale binary issues
if [ "$INSTALL_MODE" = "source" ]; then
    MCP_CMD="node"
    MCP_ARGS="$INSTALL_DIR/src/Main/index.js"
    if claude mcp add projectguide-agent -s user -- $MCP_CMD "$MCP_ARGS" 2>&1; then
        success "MCP server registered globally (user scope, node source)"
    else
        warn "claude mcp add command failed. Attempting direct config write..."
    fi
else
    MCP_CMD="$BIN_DIR/$BINARY_NAME"
    MCP_ARGS=""
    if claude mcp add projectguide-agent -s user -- "$MCP_CMD" 2>&1; then
        success "MCP server registered globally (user scope, binary)"
    else
        warn "claude mcp add command failed. Attempting direct config write..."
    fi
fi

# Verify registration by checking ~/.claude.json
MCP_REGISTERED=false
if [ -f "$CLAUDE_JSON" ]; then
    if grep -q "projectguide-agent" "$CLAUDE_JSON" 2>/dev/null; then
        MCP_REGISTERED=true
    fi
fi

# Fallback: write directly to ~/.claude.json if CLI registration failed
if [ "$MCP_REGISTERED" = false ]; then
    warn "MCP registration not found in $CLAUDE_JSON. Writing config directly..."
    # Determine command and args for direct config write
    if [ "$INSTALL_MODE" = "source" ]; then
        DIRECT_CMD="node"
        DIRECT_ARGS="[\"$INSTALL_DIR/src/Main/index.js\"]"
    else
        DIRECT_CMD="$BIN_DIR/$BINARY_NAME"
        DIRECT_ARGS="[]"
    fi

    if [ -f "$CLAUDE_JSON" ]; then
        # File exists — inject mcpServers entry using python/node
        if command -v python3 &> /dev/null; then
            python3 -c "
import json, sys
try:
    with open('$CLAUDE_JSON', 'r') as f:
        config = json.load(f)
except:
    config = {}
if 'mcpServers' not in config:
    config['mcpServers'] = {}
config['mcpServers']['projectguide-agent'] = {
    'type': 'stdio',
    'command': '$DIRECT_CMD',
    'args': json.loads('$DIRECT_ARGS'),
    'env': {}
}
with open('$CLAUDE_JSON', 'w') as f:
    json.dump(config, f, indent=2)
print('OK')
" && MCP_REGISTERED=true
        elif command -v node &> /dev/null; then
            node -e "
const fs = require('fs');
let config = {};
try { config = JSON.parse(fs.readFileSync('$CLAUDE_JSON', 'utf8')); } catch {}
if (!config.mcpServers) config.mcpServers = {};
config.mcpServers['projectguide-agent'] = {
    type: 'stdio',
    command: '$DIRECT_CMD',
    args: JSON.parse('$DIRECT_ARGS'),
    env: {}
};
fs.writeFileSync('$CLAUDE_JSON', JSON.stringify(config, null, 2));
console.log('OK');
" && MCP_REGISTERED=true
        fi
    else
        # No claude.json exists — create minimal one
        if [ "$INSTALL_MODE" = "source" ]; then
            cat > "$CLAUDE_JSON" << MCPEOF
{
  "mcpServers": {
    "projectguide-agent": {
      "type": "stdio",
      "command": "node",
      "args": ["$INSTALL_DIR/src/Main/index.js"],
      "env": {}
    }
  }
}
MCPEOF
        else
            cat > "$CLAUDE_JSON" << MCPEOF
{
  "mcpServers": {
    "projectguide-agent": {
      "type": "stdio",
      "command": "$BIN_DIR/$BINARY_NAME",
      "args": [],
      "env": {}
    }
  }
}
MCPEOF
        fi
        MCP_REGISTERED=true
    fi

    if [ "$MCP_REGISTERED" = true ]; then
        success "MCP config written directly to $CLAUDE_JSON"
    else
        fail "Could not register MCP server automatically."
        echo ""
        echo "  Please register manually by running:"
        if [ "$INSTALL_MODE" = "source" ]; then
            echo "    claude mcp add projectguide-agent -s user -- node $INSTALL_DIR/src/Main/index.js"
        else
            echo "    claude mcp add projectguide-agent -s user -- $BIN_DIR/$BINARY_NAME"
        fi
        echo ""
    fi
fi

# ----------------------------------------------------------
# Step 6: Install CLAUDE.md globally
# ----------------------------------------------------------
info "Setting up global agent instructions..."

mkdir -p "$CLAUDE_GLOBAL_DIR"

CLAUDE_MD_SOURCE=""
if [ -f "$SCRIPT_DIR/../CLAUDE.md" ]; then
    CLAUDE_MD_SOURCE="$SCRIPT_DIR/../CLAUDE.md"
elif [ -f "$SCRIPT_DIR/CLAUDE.md" ]; then
    CLAUDE_MD_SOURCE="$SCRIPT_DIR/CLAUDE.md"
fi

if [ -n "$CLAUDE_MD_SOURCE" ]; then
    GLOBAL_CLAUDE_MD="$CLAUDE_GLOBAL_DIR/CLAUDE.md"
    MARKER="# --- Project Guide Agent Instructions ---"
    MARKER_END="# --- End Project Guide Agent Instructions ---"

    if [ -f "$GLOBAL_CLAUDE_MD" ]; then
        # Check if our instructions are already there
        if grep -q "$MARKER" "$GLOBAL_CLAUDE_MD" 2>/dev/null; then
            # Replace existing block
            # Remove old block and append new one
            sed "/$MARKER/,/$MARKER_END/d" "$GLOBAL_CLAUDE_MD" > "$GLOBAL_CLAUDE_MD.tmp"
            mv "$GLOBAL_CLAUDE_MD.tmp" "$GLOBAL_CLAUDE_MD"
            info "Updating existing agent instructions in global CLAUDE.md..."
        else
            info "Appending agent instructions to existing global CLAUDE.md..."
        fi
        # Append our block
        echo "" >> "$GLOBAL_CLAUDE_MD"
        echo "$MARKER" >> "$GLOBAL_CLAUDE_MD"
        cat "$CLAUDE_MD_SOURCE" >> "$GLOBAL_CLAUDE_MD"
        echo "" >> "$GLOBAL_CLAUDE_MD"
        echo "$MARKER_END" >> "$GLOBAL_CLAUDE_MD"
    else
        # Create new file with our instructions
        echo "$MARKER" > "$GLOBAL_CLAUDE_MD"
        cat "$CLAUDE_MD_SOURCE" >> "$GLOBAL_CLAUDE_MD"
        echo "" >> "$GLOBAL_CLAUDE_MD"
        echo "$MARKER_END" >> "$GLOBAL_CLAUDE_MD"
    fi
    success "Global CLAUDE.md installed at $GLOBAL_CLAUDE_MD"
else
    warn "CLAUDE.md not found in package. Agent will work but without auto-trigger instructions."
fi

# ----------------------------------------------------------
# Step 7: Copy modular prompt chunks
# ----------------------------------------------------------
if [ -d "$SCRIPT_DIR/Skills/prompts" ]; then
    mkdir -p "$INSTALL_DIR/prompts"
    # Install all skill prompt chunks (core + specialized).
    cp "$SCRIPT_DIR/Skills/prompts/"*.md "$INSTALL_DIR/prompts/" 2>/dev/null || true
fi

# ----------------------------------------------------------
# Step 8: PATH setup
# ----------------------------------------------------------
PATH_ADDED=false
SHELL_RC=""

if [ -n "$ZSH_VERSION" ] || [ -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
    SHELL_RC="$HOME/.bash_profile"
fi

if [ -n "$SHELL_RC" ]; then
    if ! grep -q "projectguide-agent/bin" "$SHELL_RC" 2>/dev/null; then
        echo "" >> "$SHELL_RC"
        echo "# Project Guide Agent" >> "$SHELL_RC"
        echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$SHELL_RC"
        PATH_ADDED=true
        success "Added $BIN_DIR to PATH in $SHELL_RC"
    else
        success "PATH already configured in $SHELL_RC"
        PATH_ADDED=true
    fi
fi

# ----------------------------------------------------------
# Done!
# ----------------------------------------------------------
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Installation Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  Install mode:  ${CYAN}$INSTALL_MODE${NC}"
echo -e "  Install path:  ${CYAN}$INSTALL_DIR${NC}"
echo -e "  MCP scope:     ${CYAN}user (global — works in any directory)${NC}"
echo ""
echo -e "  ${CYAN}How to use:${NC}"
echo "    1. Open any terminal directory"
echo "    2. Run: claude"
echo "    3. Say: \"invoke projectguide-agent\""
echo "    4. Or say: \"Good morning\" for daily standup"
echo ""

if [ "$PATH_ADDED" = true ]; then
    echo -e "  ${YELLOW}Restart your terminal or run:${NC}"
    echo "    source $SHELL_RC"
    echo ""
fi

echo -e "  ${CYAN}First-time setup:${NC}"
echo "    After invoking, configure your integrations:"
echo "    - \"configure jira\" — connect your Jira instance"
echo "    - \"configure github\" — connect GitHub"
echo ""
echo -e "  ${CYAN}To uninstall:${NC}"
echo "    ./uninstall.sh"
echo ""
