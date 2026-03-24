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

echo ✅ Binary installed to %INSTALL_DIR%\%BINARY_NAME%

:: Register with Claude
echo 🔗 Registering with Claude CLI...
:: Remove if exists
claude mcp remove projectguide-agent >nul 2>&1

claude mcp add projectguide-agent -- "%INSTALL_DIR%\%BINARY_NAME%"

if %ERRORLEVEL% equ 0 (
    echo ✨ Success! You can now use the Project Guide Agent by running 'claude' and saying 'Good morning' or 'invoke projectguide-agent'.
) else (
    echo ⚠️  Note: Registration might have failed.
    echo    Please run: claude mcp add projectguide-agent -- "%INSTALL_DIR%\%BINARY_NAME%"
)

pause
