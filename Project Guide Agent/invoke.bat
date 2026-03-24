@echo off
setlocal

:: Project Guide Agent 'invoke' wrapper for Windows

if "%~1"=="projectguide-agent" (
    shift
    claude "invoke projectguide-agent %*"
) else if "%~1"=="--help" (
    echo Project Guide Agent - Invoke Wrapper
    echo Usage: invoke projectguide-agent [additional prompts]
    echo        invoke [claude arguments]
) else if "%~1"=="-h" (
    echo Project Guide Agent - Invoke Wrapper
    echo Usage: invoke projectguide-agent [additional prompts]
    echo        invoke [claude arguments]
) else (
    if "%~1"=="" (
        claude
    ) else (
        claude %*
    )
)
