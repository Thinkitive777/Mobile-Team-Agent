@echo off
:: Project Guide Agent — Quick Uninstaller (Windows)

set "SCRIPT_DIR=%~dp0"
set "AGENT_DIR=%SCRIPT_DIR%Project Guide Agent"

set "INSTALLER="

if exist "%AGENT_DIR%\uninstall.bat" (
    set "INSTALLER=%AGENT_DIR%\uninstall.bat"
) else if exist "%AGENT_DIR%\Scripts\uninstall.bat" (
    set "INSTALLER=%AGENT_DIR%\Scripts\uninstall.bat"
)

if "%INSTALLER%"=="" (
    echo Uninstall script not found. Performing manual cleanup...
    claude mcp remove projectguide-agent -s user 2>/dev/null
    claude mcp remove projectguide-agent -s project 2>/dev/null
    if exist "%USERPROFILE%\.projectguide-agent" rmdir /S /Q "%USERPROFILE%\.projectguide-agent"
    if exist "%SCRIPT_DIR%.mcp.json" del "%SCRIPT_DIR%.mcp.json"
    echo Done.
    pause
    exit /b 0
)

call "%INSTALLER%"
