@echo off
:: Mobile Team Agent — Quick Installer
:: Just unzip and double-click install.bat

set "SCRIPT_DIR=%~dp0"
set "AGENT_DIR=%SCRIPT_DIR%Mobile Team Agent"

if not exist "%AGENT_DIR%" (
    echo Error: 'Mobile Team Agent' directory not found.
    echo Make sure you're running this from the unzipped project root.
    pause
    exit /b 1
)

if exist "%AGENT_DIR%\Scripts\install.bat" (
    call "%AGENT_DIR%\Scripts\install.bat"
) else if exist "%AGENT_DIR%\install.bat" (
    call "%AGENT_DIR%\install.bat"
) else (
    echo Error: Installer not found.
    echo Expected either:
    echo   %AGENT_DIR%\install.bat
    echo   %AGENT_DIR%\Scripts\install.bat
    pause
    exit /b 1
)
