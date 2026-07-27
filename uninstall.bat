@echo off
set "SCRIPT_DIR=%~dp0"
set "AGENT_DIR=%SCRIPT_DIR%Mobile Team Agent"

if exist "%AGENT_DIR%\Scripts\uninstall.bat" (
    call "%AGENT_DIR%\Scripts\uninstall.bat"
) else if exist "%AGENT_DIR%\uninstall.bat" (
    call "%AGENT_DIR%\uninstall.bat"
) else (
    echo Performing manual cleanup...
    claude mcp remove mobile-team-agent -s user >nul 2>&1
    if exist "%USERPROFILE%\.mobile-team-agent" rmdir /S /Q "%USERPROFILE%\.mobile-team-agent"
    echo Done. You may need to manually clean %USERPROFILE%\.claude\CLAUDE.md
    pause
)
