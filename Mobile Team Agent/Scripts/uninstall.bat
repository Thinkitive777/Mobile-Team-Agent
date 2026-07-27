@echo off
setlocal EnableDelayedExpansion

:: Mobile Team Agent — Uninstaller (Windows)

set "INSTALL_DIR=%USERPROFILE%\.mobile-team-agent"
set "CLAUDE_GLOBAL_MD=%USERPROFILE%\.claude\CLAUDE.md"

echo.
echo Mobile Team Agent — Uninstaller
echo ==================================
echo.

set /p "CONFIRM=This will remove the Mobile Team Agent. Continue? [y/N] "
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    pause
    exit /b 0
)

:: Remove MCP registration
echo Removing MCP registration...
claude mcp remove mobile-team-agent -s user >nul 2>&1
claude mcp remove mobile-team-agent -s project >nul 2>&1
claude mcp remove mobile-team-agent >nul 2>&1

:: Also clear the pre-rename registration, in case this machine was upgraded.
claude mcp remove projectguide-agent -s user >nul 2>&1
claude mcp remove projectguide-agent -s project >nul 2>&1
claude mcp remove projectguide-agent >nul 2>&1
echo [OK] MCP registration removed.

:: Remove CLAUDE.md block
if exist "%CLAUDE_GLOBAL_MD%" (
    findstr /C:"Mobile Team Agent Instructions" "%CLAUDE_GLOBAL_MD%" >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo Removing agent instructions from global CLAUDE.md...
        powershell -Command "(Get-Content '%CLAUDE_GLOBAL_MD%' -Raw) -replace '(?s)# --- Mobile Team Agent Instructions ---.*?# --- End Mobile Team Agent Instructions ---', '' | Set-Content '%CLAUDE_GLOBAL_MD%'"
        echo [OK] Agent instructions removed.
    )
)

:: Remove from PATH
echo Removing from PATH...
powershell -Command "$p = [Environment]::GetEnvironmentVariable('PATH', 'User'); $p = ($p -split ';' | Where-Object { $_ -notlike '*mobile-team-agent*' }) -join ';'; [Environment]::SetEnvironmentVariable('PATH', $p, 'User')"
echo [OK] PATH cleaned.

:: Ask about reports
if exist "%INSTALL_DIR%\daily-reports\*" (
    echo.
    set /p "KEEP_REPORTS=Delete saved daily reports? [y/N] "
    if /i not "!KEEP_REPORTS!"=="y" (
        echo Backing up reports...
        if not exist "%USERPROFILE%\mobile-team-reports-backup" mkdir "%USERPROFILE%\mobile-team-reports-backup"
        xcopy "%INSTALL_DIR%\daily-reports\*" "%USERPROFILE%\mobile-team-reports-backup\" /Y /Q >nul 2>&1
        echo [OK] Reports backed up to %USERPROFILE%\mobile-team-reports-backup\
    )
)

:: Remove installation directory
echo Removing %INSTALL_DIR%...
if exist "%INSTALL_DIR%" rmdir /S /Q "%INSTALL_DIR%"
echo [OK] Installation directory removed.

echo.
echo Uninstallation complete.
echo Restart your terminal for changes to take effect.
echo.

pause
