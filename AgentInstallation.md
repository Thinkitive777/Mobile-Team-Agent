# Mobile Team Agent — Installation Guide

## Fresh Install

```bash
npm install -g mobile-team-agent
```

The installer runs automatically and will ask for your full name.

---

## Update (existing users)

```bash
npm install -g mobile-team-agent
npx mobile-team-agent setup
```

> `npm update` does **not** trigger setup — always use `npm install -g` followed by `setup` when updating.

---

## What setup does

1. Registers the agent with Claude CLI globally
2. Installs agent instructions to `~/.claude/`
3. Asks for your **full name** — shown in team usage reports
4. Writes the team Google Chat webhook to `~/.mobile-team-agent/config.json`

---

## What is tracked?

Every tool the agent calls is logged to the team's Google Chat space with:
- Tool name (e.g. `morning_standup`, `list_tickets`)
- Your display name
- Timestamp (IST)

Runs silently in the background — never interrupts your workflow. The team is aware of this tracking.

---

## Update your name later

In Claude, say:
```
set_preferences with display_name="New Name"
```

Or re-run setup:
```bash
npx mobile-team-agent setup
```
