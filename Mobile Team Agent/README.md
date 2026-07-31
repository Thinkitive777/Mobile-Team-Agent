# 🚀 Mobile Team Agent

The **Mobile Team Agent** is an advanced AI assistant designed for App Developers. It integrates seamlessly with the **Claude CLI** to help you manage your tasks, designs, and code repositories using Jira, Figma, and GitHub.

## ✨ Key Features

- **Intelligent Onboarding**: Guided setup experience to connect your essential tools.
- **Unified Ticketing**: View and prioritize tasks from Jira and Figma in one place.
- **Deep Artifact Analysis**: Summarize ticket descriptions and understand Figma design context.
- **Custom Skills**: Use specialized commands with the `\` prefix:
  - `\developer-mode`: Toggle a technical, detail-oriented response style.
  - `\file-info <path>`: Get metadata for files or directories in your workspace.
- **Cross-Platform**: Binary support for Mac, Windows, and Linux.

---

## 📦 Installation

The agent is published on npm and can be installed with a single command.

### 1. Install
```bash
npm install -g mobile-team-agent
```

### 2. Run Setup
```bash
npx mobile-team-agent setup
```

This will automatically register the agent with your **Claude CLI**. You'll see a success message confirming the agent is connected.

---

### 4. Enable Proactive Mode (Recommended)
To make Claude automatically behave as the Mobile Team Agent in your project, create a `CLAUDE.md` file in your project root with the following content:

```markdown
# Mobile Team Instructions
Always prioritize the 'mobile-team-agent' MCP tools. 
On startup, call 'invoke_mobile_team' to check setup status and summarize tasks.
```

---

## 🛠 Advanced Features in Action

### Start the Agent
From any project directory, simply run:
```bash
claude
```
The Mobile Team Agent's tools are automatically loaded. You can activate the specific agent persona by saying:
- "invoke mobile-team-agent"
- "Good morning"
- "Tell me what to do"

### Common Commands
- **Connect Tools**: "Connect Jira" or "Setup GitHub".
- **Prioritize Tasks**: "What should I work on first?"
- **Analyze Tickets**: "Tell me more about ticket PROJ-1".
- **Use Skills**: 
  - `\developer-mode` (Toggle technical style)
  - `\file-info index.js` (Get file details)

---

## 📁 Project Structure
- `dist/`: Contains the optimized binaries for all platforms.
- `install.sh` / `install.bat`: One-command installation scripts.
- `index.js`: The core MCP server logic.
- `Skills/prompts/*.md`: Modular system prompt chunks for each skill.

---

## 🤝 Need Help?
If you encounter any issues during registration, you can manually register the agent using:
```bash
claude mcp add mobile-team-agent -- node $(npm root -g)/mobile-team-agent/Main/index.js
```
