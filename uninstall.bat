@echo off
set "SCRIPT_DIR=%~dp0"
set "AGENT_DIR=%SCRIPT_DIR%Project Guide Agent"

if exist "%AGENT_DIR%\uninstall.bat" (
    call "%AGENT_DIR%\uninstall.bat"
) else (
    echo Performing manual cleanup...
    claude mcp remove projectguide-agent -s user >nul 2>&1
    if exist "%USERPROFILE%\.projectguide-agent" rmdir /S /Q "%USERPROFILE%\.projectguide-agent"
    echo Done. You may need to manually clean %USERPROFILE%\.claude\CLAUDE.md
    pause
)
