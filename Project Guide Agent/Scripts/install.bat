@echo off
setlocal EnableDelayedExpansion

:: ============================================================
:: Project Guide Agent — Global Installer (Windows)
::
:: Usage: Right-click > Run as Administrator, or just double-click
::
:: What this does:
::   1. Installs the agent to %USERPROFILE%\.projectguide-agent\
::   2. Registers the MCP server GLOBALLY with Claude CLI
::   3. Installs CLAUDE.md to %USERPROFILE%\.claude\ for global recognition
::   4. Any folder on this machine will recognize the agent
:: ============================================================

set "INSTALL_DIR=%USERPROFILE%\.projectguide-agent"
set "BIN_DIR=%INSTALL_DIR%\bin"
set "BINARY_NAME=projectguide-agent.exe"
set "CLAUDE_GLOBAL_DIR=%USERPROFILE%\.claude"
set "SCRIPT_DIR=%~dp0..\"
set "VERSION=2.1.0"

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
:: Step 4: Register MCP server GLOBALLY with Claude CLI
:: ----------------------------------------------------------
echo [INFO]  Registering MCP server globally...

:: Remove any existing registration
claude mcp remove projectguide-agent -s user >nul 2>&1
claude mcp remove projectguide-agent -s project >nul 2>&1
claude mcp remove projectguide-agent >nul 2>&1

:: Register at USER scope — available in ALL directories
if "%INSTALL_MODE%"=="binary" (
    claude mcp add projectguide-agent -s user -- "%BIN_DIR%\%BINARY_NAME%"
) else (
    claude mcp add projectguide-agent -s user -- node "%INSTALL_DIR%\src\Main\index.js"
)

:: Verify registration in ~/.claude.json
set "MCP_REGISTERED=0"
set "CLAUDE_JSON=%USERPROFILE%\.claude.json"
findstr /C:"projectguide-agent" "%CLAUDE_JSON%" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    set "MCP_REGISTERED=1"
    echo [OK]    MCP server registered globally (user scope^)
)

:: Fallback: write config directly if CLI registration failed
if "!MCP_REGISTERED!"=="0" (
    echo [WARN]  CLI registration not detected. Writing config directly...
    if "%INSTALL_MODE%"=="binary" (
        set "MCP_CMD=%BIN_DIR%\%BINARY_NAME%"
    ) else (
        set "MCP_CMD=node"
    )
    powershell -Command ^
        "$jsonPath = '%CLAUDE_JSON%'; " ^
        "if (Test-Path $jsonPath) { $config = Get-Content $jsonPath -Raw | ConvertFrom-Json } else { $config = [PSCustomObject]@{} }; " ^
        "if (-not $config.mcpServers) { $config | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([PSCustomObject]@{}) }; " ^
        "if ('%INSTALL_MODE%' -eq 'binary') { " ^
        "  $server = [PSCustomObject]@{ type='stdio'; command='%BIN_DIR:\=\\%\\%BINARY_NAME%'; args=@(); env=[PSCustomObject]@{} } " ^
        "} else { " ^
        "  $server = [PSCustomObject]@{ type='stdio'; command='node'; args=@('%INSTALL_DIR:\=\\%\\src\\Main\\index.js'); env=[PSCustomObject]@{} } " ^
        "}; " ^
        "$config.mcpServers | Add-Member -NotePropertyName 'projectguide-agent' -NotePropertyValue $server -Force; " ^
        "$config | ConvertTo-Json -Depth 10 | Set-Content $jsonPath"
    if !ERRORLEVEL! equ 0 (
        echo [OK]    MCP config written directly to %CLAUDE_JSON%
    ) else (
        echo [FAIL]  Could not register MCP server. Please run manually:
        echo         claude mcp add projectguide-agent -s user -- "%BIN_DIR%\%BINARY_NAME%"
    )
)

:: ----------------------------------------------------------
:: Step 5: Install CLAUDE.md globally
:: ----------------------------------------------------------
echo [INFO]  Setting up global agent instructions...

if not exist "%CLAUDE_GLOBAL_DIR%" mkdir "%CLAUDE_GLOBAL_DIR%"

set "CLAUDE_MD_SOURCE="
if exist "%SCRIPT_DIR%..\CLAUDE.md" set "CLAUDE_MD_SOURCE=%SCRIPT_DIR%..\CLAUDE.md"
if exist "%SCRIPT_DIR%CLAUDE.md" set "CLAUDE_MD_SOURCE=%SCRIPT_DIR%CLAUDE.md"

if defined CLAUDE_MD_SOURCE (
    set "GLOBAL_CLAUDE_MD=%CLAUDE_GLOBAL_DIR%\CLAUDE.md"

    :: Simple approach: write marker + content
    :: Check if marker already exists
    findstr /C:"Project Guide Agent Instructions" "!GLOBAL_CLAUDE_MD!" >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo [INFO]  Agent instructions already in global CLAUDE.md. Updating...
        :: Create temp file without our block, then re-append
        powershell -Command "(Get-Content '!GLOBAL_CLAUDE_MD!' -Raw) -replace '(?s)# --- Project Guide Agent Instructions ---.*?# --- End Project Guide Agent Instructions ---', '' | Set-Content '!GLOBAL_CLAUDE_MD!.tmp'"
        if exist "!GLOBAL_CLAUDE_MD!.tmp" (
            move /Y "!GLOBAL_CLAUDE_MD!.tmp" "!GLOBAL_CLAUDE_MD!" >nul
        )
    )

    :: Append our block
    echo. >> "!GLOBAL_CLAUDE_MD!"
    echo # --- Project Guide Agent Instructions --- >> "!GLOBAL_CLAUDE_MD!"
    type "!CLAUDE_MD_SOURCE!" >> "!GLOBAL_CLAUDE_MD!"
    echo. >> "!GLOBAL_CLAUDE_MD!"
    echo # --- End Project Guide Agent Instructions --- >> "!GLOBAL_CLAUDE_MD!"

    echo [OK]    Global CLAUDE.md installed at !GLOBAL_CLAUDE_MD!
) else (
    echo [WARN]  CLAUDE.md not found in package.
)

:: ----------------------------------------------------------
:: Step 6: Copy agent prompt
:: ----------------------------------------------------------
if exist "%SCRIPT_DIR%Skills\agent_prompt.md" (
    copy "%SCRIPT_DIR%Skills\agent_prompt.md" "%INSTALL_DIR%\agent_prompt.md" /Y >nul
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
echo   MCP scope:     user (global - works in any directory)
echo.
echo   How to use:
echo     1. Open any terminal directory
echo     2. Run: claude
echo     3. Say: "invoke projectguide-agent"
echo     4. Or say: "Good morning" for daily standup
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
