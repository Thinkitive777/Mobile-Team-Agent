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
chmod +x "$INSTALL_DIR/$BINARY_NAME"

echo "✅ Binary installed to $INSTALL_DIR/$BINARY_NAME"

# Register with Claude
echo "🔗 Registering with Claude CLI..."
# Remove if exists to avoid "already exists" error
claude mcp remove projectguide-agent > /dev/null 2>&1

claude mcp add projectguide-agent -- "$INSTALL_DIR/$BINARY_NAME"

if [ $? -eq 0 ]; then
    echo "✨ Success! You can now use the Project Guide Agent by running 'claude' and saying 'Good morning' or 'invoke projectguide-agent'."
else
    echo "⚠️  Note: Registration might have failed. Please try manually:"
    echo "   claude mcp add projectguide-agent -- $INSTALL_DIR/$BINARY_NAME"
fi

# Add to PATH (optional, but helpful for direct use)
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo "💡 Tip: Add $INSTALL_DIR to your PATH to run 'projectguide-agent' directly."
fi
