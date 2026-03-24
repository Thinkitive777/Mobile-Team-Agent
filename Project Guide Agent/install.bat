@echo off
setlocal

echo 🚀 Installing Project Guide Agent for Windows...

set INSTALL_DIR=%USERPROFILE%\.projectguide-agent\bin
set BINARY_NAME=projectguide-agent.exe
set SOURCE_BINARY=.\dist\project-guide-agent-win.exe

:: Create directory
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

if not exist "%SOURCE_BINARY%" (
    echo ❌ Binary not found at %SOURCE_BINARY%.
    exit /b 1
)

:: Copy binary
copy "%SOURCE_BINARY%" "%INSTALL_DIR%\%BINARY_NAME%" /Y
copy ".\invoke.bat" "%INSTALL_DIR%\invoke.bat" /Y

echo ✅ Binaries installed to %INSTALL_DIR%

:: Register with Claude
echo 🔗 Registering MCP server with Claude CLI...
claude mcp remove projectguide-agent >nul 2>&1
claude mcp add projectguide-agent -- "%INSTALL_DIR%\%BINARY_NAME%"

if %ERRORLEVEL% equ 0 (
    echo ✨ MCP Registration Successful!
) else (
    echo ⚠️  Note: Registration might have failed.
    echo    Please run: claude mcp add projectguide-agent -- "%INSTALL_DIR%\%BINARY_NAME%"
)

:: Automatic CLAUDE.md setup
if exist "..\CLAUDE.md" (
    echo 📝 Setting up CLAUDE.md...
    copy "..\CLAUDE.md" ".\CLAUDE.md" /Y
    if not exist "..\..\CLAUDE.md" (
        copy "..\CLAUDE.md" "..\..\CLAUDE.md" /Y
        echo ✅ CLAUDE.md copied to project root.
    )
)

echo.
echo 🎉 Installation Complete!
echo 🚀 You can now run: invoke projectguide-agent
echo.
echo 💡 Tip: Add %INSTALL_DIR% to your PATH to use 'invoke' anywhere.

pause
