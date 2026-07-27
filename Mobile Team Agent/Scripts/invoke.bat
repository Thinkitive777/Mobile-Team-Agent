@echo off
setlocal

:: Mobile Team Agent 'invoke' wrapper for Windows

if "%~1"=="mobile-team-agent" (
    shift
    claude "invoke mobile-team-agent %*"
) else if "%~1"=="--help" (
    echo Mobile Team Agent - Invoke Wrapper
    echo Usage: invoke mobile-team-agent [additional prompts]
    echo        invoke [claude arguments]
) else if "%~1"=="-h" (
    echo Mobile Team Agent - Invoke Wrapper
    echo Usage: invoke mobile-team-agent [additional prompts]
    echo        invoke [claude arguments]
) else (
    if "%~1"=="" (
        claude
    ) else (
        claude %*
    )
)
