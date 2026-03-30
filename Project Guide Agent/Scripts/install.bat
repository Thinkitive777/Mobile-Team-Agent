@echo off
setlocal EnableDelayedExpansion

:: ============================================================
:: Project Guide Agent — Project-Level Installer (Windows)
::
:: Usage: Right-click > Run as Administrator, or just double-click
::
:: What this does:
::   1. Installs the agent to %USERPROFILE%\.projectguide-agent\
::   2. Creates a project-level .mcp.json in the project root
::   3. MCP is scoped to this project only (not global)
::   4. Agent is available when you run `claude` from this project
:: ============================================================

set "INSTALL_DIR=%USERPROFILE%\.projectguide-agent"
set "BIN_DIR=%INSTALL_DIR%\bin"
set "BINARY_NAME=projectguide-agent.exe"
set "CLAUDE_GLOBAL_DIR=%USERPROFILE%\.claude"
set "SCRIPT_DIR=%~dp0..\"
set "VERSION=3.3.0"

echo.
echo ============================================
echo   Project Guide Agent Installer v%VERSION%
echo ============================================
echo.

:: ----------------------------------------------------------
:: Step 1: Check prerequisites
:: ----------------------------------------------------------
echo [INFO]  Checking prerequisites...

where claude >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [FAIL]  Claude CLI not found. Please install it first:
    echo         npm install -g @anthropic-ai/claude-code
    echo.
    pause
    exit /b 1
)
echo [OK]    Claude CLI found.

:: ----------------------------------------------------------
:: Step 2: Create installation directory
:: ----------------------------------------------------------
echo [INFO]  Installing to %INSTALL_DIR% ...

if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
if not exist "%INSTALL_DIR%\src" mkdir "%INSTALL_DIR%\src"
if not exist "%INSTALL_DIR%\daily-reports" mkdir "%INSTALL_DIR%\daily-reports"

:: ----------------------------------------------------------
:: Step 3: Install — Binary or Node.js source fallback
:: ----------------------------------------------------------
set "INSTALL_MODE="
set "SOURCE_BINARY=%SCRIPT_DIR%dist\project-guide-agent-win.exe"

if exist "%SOURCE_BINARY%" (
    copy "%SOURCE_BINARY%" "%BIN_DIR%\%BINARY_NAME%" /Y >nul
    set "INSTALL_MODE=binary"
    echo [OK]    Binary installed to %BIN_DIR%\%BINARY_NAME%
)

:: Fallback to Node.js source if no binary
if "%INSTALL_MODE%"=="" (
    if exist "%SCRIPT_DIR%Main\index.js" (
        where node >nul 2>&1
        if !ERRORLEVEL! equ 0 (
            echo [INFO]  Installing from source (Node.js mode^)...

            :: Copy source files
            xcopy "%SCRIPT_DIR%Constants" "%INSTALL_DIR%\src\Constants" /E /I /Y >nul
            xcopy "%SCRIPT_DIR%Main" "%INSTALL_DIR%\src\Main" /E /I /Y >nul
            xcopy "%SCRIPT_DIR%Scripts" "%INSTALL_DIR%\src\Scripts" /E /I /Y >nul
            xcopy "%SCRIPT_DIR%Skills" "%INSTALL_DIR%\src\Skills" /E /I /Y >nul
            xcopy "%SCRIPT_DIR%Utils" "%INSTALL_DIR%\src\Utils" /E /I /Y >nul
            xcopy "%SCRIPT_DIR%Services" "%INSTALL_DIR%\src\Services" /E /I /Y >nul
            if exist "%SCRIPT_DIR%package.json" copy "%SCRIPT_DIR%package.json" "%INSTALL_DIR%\src\package.json" /Y >nul

            :: Install dependencies
            echo [INFO]  Installing Node.js dependencies...
            pushd "%INSTALL_DIR%\src"
            npm install --production --silent 2>nul
            popd

            :: Create runner batch script
            (
                echo @echo off
                echo node "%INSTALL_DIR%\src\Main\index.js" %%*
            ) > "%BIN_DIR%\%BINARY_NAME%"

            :: Also create a .cmd version
            (
                echo @echo off
                echo node "%INSTALL_DIR%\src\Main\index.js" %%*
            ) > "%BIN_DIR%\projectguide-agent.cmd"

            set "INSTALL_MODE=source"
            echo [OK]    Source installed to %INSTALL_DIR%\src\ (Node.js mode^)
        ) else (
            echo [FAIL]  No binary found and Node.js is not installed.
            echo         Install Node.js 18+: https://nodejs.org
            pause
            exit /b 1
        )
    ) else (
        echo [FAIL]  No binary or source files found. Archive may be incomplete.
        pause
        exit /b 1
    )
)

:: Copy invoke wrapper
if exist "%SCRIPT_DIR%Scripts\invoke.bat" (
    copy "%SCRIPT_DIR%Scripts\invoke.bat" "%BIN_DIR%\invoke.bat" /Y >nul
)

:: ----------------------------------------------------------
:: Step 4: Create project-level .mcp.json
:: ----------------------------------------------------------
echo [INFO]  Setting up project-level MCP configuration...

:: Remove any old global registration (cleanup from previous installs)
claude mcp remove projectguide-agent -s user >nul 2>&1
claude mcp remove projectguide-agent >nul 2>&1

:: Determine project root
set "PROJECT_ROOT=%SCRIPT_DIR%..\.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"
set "MCP_JSON=%PROJECT_ROOT%\.mcp.json"

:: Build the command path
if "%INSTALL_MODE%"=="binary" (
    set "MCP_COMMAND=%BIN_DIR%\%BINARY_NAME%"
    set "MCP_ARGS_PS=@()"
) else (
    set "MCP_COMMAND=node"
    set "MCP_ARGS_PS=@('%INSTALL_DIR:\=\\%\\src\\Main\\index.js')"
)

:: Write .mcp.json using PowerShell
powershell -Command ^
    "$mcpPath = '%MCP_JSON%'; " ^
    "if (Test-Path $mcpPath) { $config = Get-Content $mcpPath -Raw | ConvertFrom-Json } else { $config = [PSCustomObject]@{} }; " ^
    "if (-not $config.mcpServers) { $config | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([PSCustomObject]@{}) }; " ^
    "$server = [PSCustomObject]@{ type='stdio'; command='%MCP_COMMAND:\=\\%'; args=%MCP_ARGS_PS%; env=[PSCustomObject]@{} }; " ^
    "$config.mcpServers | Add-Member -NotePropertyName 'projectguide-agent' -NotePropertyValue $server -Force; " ^
    "$config | ConvertTo-Json -Depth 10 | Set-Content $mcpPath"

if !ERRORLEVEL! equ 0 (
    echo [OK]    Project-level .mcp.json created at %MCP_JSON%
) else (
    echo [FAIL]  Could not create .mcp.json. Please create it manually at:
    echo         %MCP_JSON%
)

:: ----------------------------------------------------------
:: Step 5: Ensure CLAUDE.md is in the project root
:: ----------------------------------------------------------
echo [INFO]  Checking project CLAUDE.md...

set "CLAUDE_MD_SOURCE="
if exist "%SCRIPT_DIR%..\CLAUDE.md" set "CLAUDE_MD_SOURCE=%SCRIPT_DIR%..\CLAUDE.md"
if exist "%SCRIPT_DIR%CLAUDE.md" set "CLAUDE_MD_SOURCE=%SCRIPT_DIR%CLAUDE.md"

set "PROJECT_CLAUDE_MD=%PROJECT_ROOT%\CLAUDE.md"

if defined CLAUDE_MD_SOURCE (
    if exist "!PROJECT_CLAUDE_MD!" (
        echo [OK]    CLAUDE.md already exists at !PROJECT_CLAUDE_MD!
    ) else (
        copy "!CLAUDE_MD_SOURCE!" "!PROJECT_CLAUDE_MD!" /Y >nul
        echo [OK]    CLAUDE.md installed at !PROJECT_CLAUDE_MD!
    )
) else (
    echo [WARN]  CLAUDE.md not found in package.
)

:: ----------------------------------------------------------
:: Step 6: Copy agent prompt
:: ----------------------------------------------------------
if exist "%SCRIPT_DIR%Skills\prompts\" (
    mkdir "%INSTALL_DIR%\prompts" 2>nul
    copy "%SCRIPT_DIR%Skills\prompts\*.md" "%INSTALL_DIR%\prompts\" /Y >nul
)

:: ----------------------------------------------------------
:: Step 7: Add to PATH
:: ----------------------------------------------------------
echo [INFO]  Checking PATH...

echo %PATH% | findstr /C:"%BIN_DIR%" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    :: Add to user PATH permanently
    powershell -Command "[Environment]::SetEnvironmentVariable('PATH', [Environment]::GetEnvironmentVariable('PATH', 'User') + ';%BIN_DIR%', 'User')"
    echo [OK]    Added %BIN_DIR% to user PATH
    set "PATH_UPDATED=1"
) else (
    echo [OK]    PATH already configured
    set "PATH_UPDATED=0"
)

:: ----------------------------------------------------------
:: Done!
:: ----------------------------------------------------------
echo.
echo ============================================
echo   Installation Complete!
echo ============================================
echo.
echo   Install mode:  %INSTALL_MODE%
echo   Install path:  %INSTALL_DIR%
echo   MCP scope:     project-level (.mcp.json)
echo   MCP config:    %MCP_JSON%
echo.
echo   How to use:
echo     1. cd into this project directory
echo     2. Run: claude
echo     3. Say: "invoke projectguide-agent"
echo     4. Or say: "Good morning" for daily standup
echo.
echo   NOTE: The agent is scoped to this project only.
echo   To use it in another project, copy the .mcp.json file there.
echo.

if "%PATH_UPDATED%"=="1" (
    echo   NOTE: Restart your terminal for PATH changes to take effect.
    echo.
)

echo   First-time setup:
echo     After invoking, configure your integrations:
echo     - "configure jira" - connect your Jira instance
echo     - "configure github" - connect GitHub
echo.
echo   To uninstall: uninstall.bat
echo.

pause
