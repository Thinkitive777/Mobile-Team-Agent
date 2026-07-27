# Mobile Team Agent

An intelligent developer assistant that integrates Jira, Git, and daily workflow automation — powered by Claude Code MCP.

## Quick Install

**Prerequisites:**
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- [Node.js 18+](https://nodejs.org/) and `npm`
- `git`

### Mac / Linux
```bash
git clone https://github.com/Shekhar9398/Mobile-Team-Agent.git
cd Mobile-Team-Agent/"Mobile Team Agent"
chmod +x install.sh && ./install.sh
```

### Windows
```
git clone https://github.com/Shekhar9398/Mobile-Team-Agent.git
cd Mobile-Team-Agent\Mobile Team Agent
install.bat
```

That's it. The installer runs `npm install --production` for you, copies the
source to `~/.mobile-team-agent/`, and registers the MCP server globally —
the agent is then available in any `claude` session on your machine.

> The repo is source-only. There are no prebuilt binaries or distribution
> zips checked in — `git clone` stays light and you always get the latest
> code via `git pull`. To upgrade: `git pull && ./install.sh`.

## Usage

Open any terminal, run `claude`, then:

| Say this | What happens |
|----------|-------------|
| `invoke mobile-team-agent` | Activate the agent, check setup status |
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
- **End-of-day reports** — saved to `~/.mobile-team-agent/daily-reports/`
- **Blocker detection** — finds blocked tickets across Jira links, labels, status
- **Graceful degradation** — works with partial data if Jira or Git is unavailable

## How It Works

The installer:
1. Copies the agent source into `~/.mobile-team-agent/src/`
2. Runs `npm install --production` inside that directory
3. Writes a small runner shim to `~/.mobile-team-agent/bin/mobile-team-agent`
4. Registers the MCP server at **user scope** via `claude mcp add -s user` (writes to `~/.claude.json`)
5. Installs agent instructions to `~/.claude/CLAUDE.md`

This means any `claude` session in any directory will have access to the agent.

## Supported Platforms

Anywhere Node.js 18+ runs: macOS (Intel & Apple Silicon), Linux (x64 & arm64),
and Windows. The MCP server is plain Node.js source — no platform-specific
binaries or builds are required.

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

### Working on the agent
```bash
git clone https://github.com/Shekhar9398/Mobile-Team-Agent.git
cd Mobile-Team-Agent/"Mobile Team Agent"
npm install                # full deps including pkg (devDependency)
npm run validate           # syntax-check the core source files
npm start                  # run the MCP server directly with node
```

### Optional — build standalone binaries
Prebuilt binaries are **not** committed. Generate them locally only if you
need them:
```bash
npm run build:all          # produces dist/ for all platforms (gitignored)
```

### Repo hygiene
`node_modules/`, `dist/`, and `*.zip` are gitignored. Never commit them — the
repo is intentionally source-only so `git clone` stays fast.

## Version

v2.1.0 — Production-hardened with validation, retries, rate limiting, blocker detection, carry-forward, weekly summaries, health checks, and structured logging.
