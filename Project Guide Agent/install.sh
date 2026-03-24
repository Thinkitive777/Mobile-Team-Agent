#!/bin/bash

# Project Guide Agent Installer (Mac/Linux)

INSTALL_DIR="$HOME/.projectguide-agent/bin"
BINARY_NAME="projectguide-agent"

echo "🚀 Installing Project Guide Agent..."

# Create directory
mkdir -p "$INSTALL_DIR"

# Detect OS
OS_TYPE=$(uname -s)
if [ "$OS_TYPE" == "Darwin" ]; then
    SOURCE_BINARY="./dist/project-guide-agent-macos"
elif [ "$OS_TYPE" == "Linux" ]; then
    SOURCE_BINARY="./dist/project-guide-agent-linux"
else
    echo "❌ Unsupported OS: $OS_TYPE"
    exit 1
fi

if [ ! -f "$SOURCE_BINARY" ]; then
    echo "❌ Binary not found at $SOURCE_BINARY. Please run 'npm run build' first or ensure you have unzipped all files."
    exit 1
fi

# Copy binary
cp "$SOURCE_BINARY" "$INSTALL_DIR/$BINARY_NAME"
cp "./invoke" "$INSTALL_DIR/invoke"
chmod +x "$INSTALL_DIR/$BINARY_NAME" "$INSTALL_DIR/invoke"

echo "✅ Binaries installed to $INSTALL_DIR"

# Register with Claude
echo "🔗 Registering MCP server with Claude CLI..."
claude mcp remove projectguide-agent > /dev/null 2>&1
claude mcp add projectguide-agent -- "$INSTALL_DIR/$BINARY_NAME"

if [ $? -eq 0 ]; then
    echo "✨ MCP Registration Successful!"
else
    echo "⚠️  Note: MCP Registration might have failed. Please try manually:"
    echo "   claude mcp add projectguide-agent -- $INSTALL_DIR/$BINARY_NAME"
fi

# Automatic CLAUDE.md setup
if [ -f "../CLAUDE.md" ]; then
    echo "📝 Setting up CLAUDE.md in current directory..."
    cp "../CLAUDE.md" "./CLAUDE.md"
    # Also attempt to copy to parent if it looks like a project root
    if [[ ! -f "../../CLAUDE.md" ]]; then
        cp "../CLAUDE.md" "../../CLAUDE.md" 2>/dev/null
        echo "✅ CLAUDE.md copied to project root."
    fi
fi

echo ""
echo "🎉 Installation Complete!"
echo "🚀 You can now run: invoke projectguide-agent"
echo ""

# Add to PATH (optional, but helpful for direct use)
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo "💡 To use the 'invoke' command anywhere, add this to your .zshrc or .bashrc:"
    echo "   export PATH=\"\$PATH:$INSTALL_DIR\""
fi
