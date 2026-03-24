@echo off
setlocal EnableDelayedExpansion

:: Project Guide Agent — Uninstaller (Windows)

set "INSTALL_DIR=%USERPROFILE%\.projectguide-agent"
set "CLAUDE_GLOBAL_MD=%USERPROFILE%\.claude\CLAUDE.md"

echo.
echo Project Guide Agent — Uninstaller
echo ==================================
echo.

set /p "CONFIRM=This will remove the Project Guide Agent. Continue? [y/N] "
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    pause
    exit /b 0
)

:: Remove MCP registration
echo Removing MCP registration...
claude mcp remove projectguide-agent -s user >nul 2>&1
claude mcp remove projectguide-agent -s project >nul 2>&1
claude mcp remove projectguide-agent >nul 2>&1
echo [OK] MCP registration removed.

:: Remove CLAUDE.md block
if exist "%CLAUDE_GLOBAL_MD%" (
    findstr /C:"Project Guide Agent Instructions" "%CLAUDE_GLOBAL_MD%" >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo Removing agent instructions from global CLAUDE.md...
        powershell -Command "(Get-Content '%CLAUDE_GLOBAL_MD%' -Raw) -replace '(?s)# --- Project Guide Agent Instructions ---.*?# --- End Project Guide Agent Instructions ---', '' | Set-Content '%CLAUDE_GLOBAL_MD%'"
        echo [OK] Agent instructions removed.
    )
)

:: Remove from PATH
echo Removing from PATH...
powershell -Command "$p = [Environment]::GetEnvironmentVariable('PATH', 'User'); $p = ($p -split ';' | Where-Object { $_ -notlike '*projectguide-agent*' }) -join ';'; [Environment]::SetEnvironmentVariable('PATH', $p, 'User')"
echo [OK] PATH cleaned.

:: Ask about reports
if exist "%INSTALL_DIR%\daily-reports\*" (
    echo.
    set /p "KEEP_REPORTS=Delete saved daily reports? [y/N] "
    if /i not "!KEEP_REPORTS!"=="y" (
        echo Backing up reports...
        if not exist "%USERPROFILE%\projectguide-reports-backup" mkdir "%USERPROFILE%\projectguide-reports-backup"
        xcopy "%INSTALL_DIR%\daily-reports\*" "%USERPROFILE%\projectguide-reports-backup\" /Y /Q >nul 2>&1
        echo [OK] Reports backed up to %USERPROFILE%\projectguide-reports-backup\
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
