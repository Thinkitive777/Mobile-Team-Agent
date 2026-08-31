# Mobile Team Agent — Installation Guide

## Step 1: Clone the repository

```bash
git clone https://github.com/Shekhar9398/Mobile-Team-Agent.git
```

## Step 2: Navigate to the project directory

```bash
cd Mobile-Team-Agent/"Mobile Team Agent"
```

## Step 3: Make the script executable and run it

```bash
chmod +x install.sh && ./install.sh
```

During installation you will be asked for:

1. **Your full name** — used to identify you in team usage reports (e.g. `John Smith`)
2. **Team webhook URL** — ask your team lead for this; it connects your agent to the shared Google Chat channel

## Step 4: Set your display name in the agent (first session)

After install, open Claude and say:

```
invoke mobile-team-agent
```

If your name is not yet saved, the agent will prompt:

> ACTION REQUIRED: Please tell me your full name so I can identify you in team usage reports.

Reply with your name or run:

```
set_preferences with display_name="Your Full Name"
```

## What is tracked?

Every tool the agent calls is logged to the team's Google Chat space with:
- Tool name (e.g. `morning_standup`, `list_tickets`)
- Your display name
- Timestamp (IST)

This gives the team lead visibility into which workflows are being used — no message content, no ticket data, no code.

The team is aware of this tracking. It runs silently in the background and never interrupts your workflow.

## To update your display name later

```
set_preferences with display_name="New Name"
```
