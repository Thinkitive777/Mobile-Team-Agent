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

That's it. The agent is now available in this project via `.mcp.json`.

## Usage

Open a terminal **in this project directory**, run `claude`, then:

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
1. Copies the agent source/binary to `~/.projectguide-agent/` (falls back to Node.js source if binary fails)
2. Verifies the binary responds to MCP protocol before proceeding
3. Creates a **project-level `.mcp.json`** in the project root directory
4. Ensures `CLAUDE.md` with agent instructions is in the project root

The agent is scoped to this project — it activates when you run `claude` from this directory. To use it in another project, copy the `.mcp.json` file there.

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

This removes the binary, the `projectguide-agent` entry from `.mcp.json`, PATH additions, and the installed source. Daily reports can be optionally preserved.

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
├── Main/
│   ├── index.js            # MCP server entry point
│   └── SkillRegistry.js    # Skill loader and registry
├── Skills/
│   ├── Core/BaseSkill.js   # Base class for all skills
│   ├── GitSkill.js         # Git commit analysis
│   ├── JiraReadSkill.js    # Jira read operations
│   ├── JiraWriteSkill.js   # Jira write operations
│   ├── LegacySkill.js      # Backward-compatible tools
│   ├── MemorySkill.js      # Persistent memory (notes, journal, decisions)
│   ├── SetupSkill.js       # Connection management and health checks
│   ├── WorkflowSkill.js    # Standup, day planning, EOD reports
│   └── prompts/            # Modular prompt chunks per skill
├── Services/
│   ├── jira-client.js      # Jira REST API client (retry, rate-limit)
│   ├── memory-manager.js   # Persistent JSON storage for memory
│   ├── offline-queue.js    # Offline action queue for Jira writes
│   └── report-manager.js   # Daily/weekly report persistence
├── Utils/
│   ├── errors.js           # Error classes
│   ├── git-utils.js        # Git diff/log utilities
│   ├── logger.js           # Structured logging
│   └── validators.js       # Zod input validation
├── Constants/
│   └── constants.js        # Configuration constants
├── Scripts/
│   ├── install.sh / .bat   # Platform installers
│   ├── uninstall.sh / .bat # Platform uninstallers
│   └── invoke / invoke.bat # CLI wrapper scripts
├── dist/                   # Pre-built binaries
└── package.json
```

## Version

v3.3.0 — Modular skill architecture, persistent memory (notes/journal/decisions), code-aware daily planning, file-level Git diff analysis, and offline Jira resilience.
