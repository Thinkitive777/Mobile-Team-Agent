@echo off
:: Project Guide Agent — Quick Installer
:: Just unzip and double-click install.bat

set "SCRIPT_DIR=%~dp0"
set "AGENT_DIR=%SCRIPT_DIR%Project Guide Agent"

if not exist "%AGENT_DIR%" (
    echo Error: 'Project Guide Agent' directory not found.
    echo Make sure you're running this from the unzipped project root.
    pause
    exit /b 1
)

call "%AGENT_DIR%\install.bat"
