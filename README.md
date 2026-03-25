# Project Guide Agent

An intelligent developer assistant that integrates Jira, Git, and daily workflow automation — powered by Claude Code MCP.

## Quick Install

**Prerequisites:** [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) must be installed.

### Mac / Linux
```bash
mkdir projectguide-agent && cd projectguide-agent
unzip ../projectguide-agent-dist.zip
chmod +x install.sh && ./install.sh
```

### Windows
```
1. Unzip projectguide-agent-dist.zip into a folder
2. Double-click install.bat
```

That's it. The agent is now available **globally** — works in any directory on your machine.

## Usage

Open any terminal, run `claude`, then:

| Say this | What happens |
|----------|-------------|
| `invoke projectguide-agent` | Activate the agent, check setup status |
| `Good morning` | Daily standup — Jira tickets + Git commits + plan |
| `End of day` | Generate & save daily report |
| `What's my workload?` | Analyze and categorize all tickets |
| `Weekly summary` | Aggregate the last 7 daily reports |

### First-Time Setup

After invoking, connect your tools:
```
"configure jira"    → connect your Jira instance (URL, email, API token)
"configure github"  → connect your GitHub account
```

## What's Included

- **23 MCP tools** — Jira (read-only), Git analysis, automation, reports
- **Morning standup** — auto-generates prioritized daily plan
- **End-of-day reports** — saved to `~/.projectguide-agent/daily-reports/`
- **Blocker detection** — finds blocked tickets across Jira links, labels, status
- **Graceful degradation** — works with partial data if Jira or Git is unavailable

## How It Works

The installer:
1. Copies the agent binary to `~/.projectguide-agent/` (falls back to Node.js source if binary fails)
2. Verifies the binary responds to MCP protocol before proceeding
3. Registers the MCP server at **user scope** via `claude mcp add -s user` (writes to `~/.claude.json`)
4. Verifies registration succeeded, with a direct `~/.claude.json` fallback if the CLI command fails
5. Installs agent instructions to `~/.claude/CLAUDE.md`

This means any `claude` session in any directory will have access to the agent.

## Supported Platforms

| Platform | Binary | Node.js Fallback |
|----------|--------|-----------------|
| macOS x64 (Intel) | Yes | Yes |
| macOS arm64 (Apple Silicon) | Yes* | Yes |
| Windows x64 | Yes | Yes |
| Linux x64 | Yes | Yes |
| Linux arm64 | Yes* | Yes |

*ARM64 binaries included when built with `npm run build:all`. Falls back to Rosetta 2 (macOS) or Node.js if unavailable.

## Uninstall

### Mac / Linux
```bash
chmod +x uninstall.sh && ./uninstall.sh
```

### Windows
```
Double-click uninstall.bat
```

This removes the binary, MCP registration from `~/.claude.json`, global CLAUDE.md entries, and PATH additions. Daily reports can be optionally preserved.

## For Developers

### Build from source
```bash
cd "Project Guide Agent"
npm install
npm run validate        # Check all source files
npm run build:all       # Build binaries for all platforms
npm run build:dist      # Build + create distribution zip
```

### Project structure
```
Project Guide Agent/
├── index.js              # MCP server (v2.1.0)
├── jira-client.js        # Jira REST API client
├── git-utils.js          # Git integration
├── report-manager.js     # Report storage & generation
├── constants.js          # Configuration
├── errors.js             # Error classes
├── logger.js             # Structured logging
├── validators.js         # Zod input validation
├── install.sh / .bat     # Platform installers
├── uninstall.sh / .bat   # Platform uninstallers
├── invoke / invoke.bat   # CLI wrapper scripts
└── dist/                 # Pre-built binaries
```

## Version

v2.1.0 — Production-hardened with validation, retries, rate limiting, blocker detection, carry-forward, weekly summaries, health checks, and structured logging.
