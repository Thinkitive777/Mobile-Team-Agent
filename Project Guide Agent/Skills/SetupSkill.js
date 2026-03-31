/// MARK: - Setup Skill
/// Handles agent activation, connection configuration, health checks,
/// project switching, and user preference management.

const BaseSkill = require("./Core/BaseSkill");
const { validate, serviceSchema, jiraUrlSchema, emailSchema } = require("../Utils/validators");
const CONST = require("../Constants/constants");
const ReportManager = require("../Services/report-manager");
const GitUtils = require("../Utils/git-utils");
const fs = require("fs");

class SetupSkill extends BaseSkill {
  constructor() {
    super();
    this.name = "SetupSkill";
  }

  getTools() {
    return [
      {
        name: "invoke_projectguide",
        description: "Activate the Project Guide Agent. Shows setup status and next steps.",
        inputSchema: {
          type: "object",
          properties: { reason: { type: "string" } },
        },
      },
      {
        name: "get_setup_status",
        description: "Check connection status for all integrations and suggest setup steps.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "configure_service",
        description: "Configure Jira or GitHub. Jira requires url, email, token. Optionally provide project_name to store credentials per project. GitHub requires token.",
        inputSchema: {
          type: "object",
          properties: {
            service: { type: "string", enum: ["jira", "github"] },
            url: { type: "string", description: "Jira instance URL (Jira only)" },
            email: { type: "string", description: "Jira email (Jira only)" },
            token: { type: "string", description: "API token" },
            project_name: { type: "string", description: "Project name to scope these Jira credentials (e.g. 'MyProject'). Enables per-project isolation." },
            user: { type: "string", description: "GitHub username" },
            repo: { type: "string", description: "GitHub repo (owner/repo)" },
          },
          required: ["service", "token"],
        },
      },
      {
        name: "switch_jira_project",
        description: "Switch the active Jira project. Loads the credentials stored for that project. Lists available configured projects if no project_name given.",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Project name to switch to" },
          },
        },
      },
      {
        name: "jira_connection_test",
        description: "Validate Jira credentials and return current user info.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "health_check",
        description: "Check health of all integrations: Jira connectivity, Git availability, report storage.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "set_preferences",
        description: "Save user preferences (project, sprint, assignee, greeting name) for persistent memory across sessions.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Default project key" },
            sprint: { type: "string", description: "Default sprint name" },
            board_id: { type: "number", description: "Default board ID" },
            assignee: { type: "string", description: "Default assignee" },
            greeting_name: { type: "string", description: "User's name for greetings" },
          },
        },
      }
    ];
  }

  async handleTool(name, args, context) {
    const { config, preferences, saveConfig, savePreferences, getJiraClient, maskToken, isTokenMasked, getRepoPath } = context;

    switch (name) {
      case "invoke_projectguide": {
        const activeProject = config.jira.active_project;
        const activeCreds = activeProject && config.jira.projects && config.jira.projects[activeProject]
          ? config.jira.projects[activeProject]
          : { url: config.jira.url, email: config.jira.email, token: config.jira.token };
        const jiraCredOk = !!(activeCreds.url && activeCreds.email && activeCreds.token && !isTokenMasked(activeCreds.token));
        const jiraOk = (config.jira.connected && jiraCredOk) || !!process.env.JIRA_URL;
        const githubOk = config.github.connected || !!process.env.GITHUB_TOKEN;
        const missing = [];
        if (!jiraOk) missing.push("Jira");
        if (!githubOk) missing.push("GitHub");

        let out = `Project Guide Agent v${CONST.VERSION} ACTIVATED.\n\n`;
        if (!jiraOk && config.jira.connected && !jiraCredOk) {
          out += `WARNING: Jira was previously configured but credentials appear corrupted or incomplete.\n`;
          out += `Please run 'configure_service' with service='jira' to re-enter your credentials.\n\n`;
        } else if (missing.length > 0) {
          out += `Setup required: ${missing.join(", ")}.\n`;
          out += `Use 'configure_service' or set environment variables.\n`;
        } else {
          const projectList = config.jira.projects ? Object.keys(config.jira.projects) : [];
          out += "All services connected. Use 'morning_standup' or 'analyze_workload' to begin.\n";
          if (activeProject) out += `Active Jira project: ${activeProject}\n`;
          if (projectList.length > 1) out += `Configured projects: ${projectList.join(', ')} — use 'switch_jira_project' to switch.\n`;
        }
        return this.textResponse(out);
      }

      case "get_setup_status": {
        const activeProject = config.jira.active_project;
        const activeCreds = activeProject && config.jira.projects && config.jira.projects[activeProject]
          ? config.jira.projects[activeProject]
          : { url: config.jira.url, email: config.jira.email, token: config.jira.token };
        const jiraToken = process.env.JIRA_TOKEN || activeCreds.token;
        const jiraEmail = process.env.JIRA_EMAIL || activeCreds.email;
        const jiraUrl = process.env.JIRA_URL || activeCreds.url;
        const jiraCredOk = !!(jiraUrl && jiraEmail && jiraToken && !isTokenMasked(jiraToken));
        const jiraConnected = (config.jira.connected && jiraCredOk) || !!process.env.JIRA_URL;
        const githubConnected = config.github.connected || !!process.env.GITHUB_TOKEN;
        const configuredProjects = config.jira.projects ? Object.keys(config.jira.projects) : [];

        let out = `Project Guide Agent v${CONST.VERSION} — Setup Status\n\n`;

        out += `--- Connections ---\n`;
        if (jiraConnected) {
          out += `Jira: Connected\n`;
          out += `  Active project: ${activeProject || '(default)'}\n`;
          out += `  URL: ${jiraUrl}\n`;
          out += `  Email: ${jiraEmail}\n`;
          out += `  Token: ${maskToken(jiraToken)}\n`;
          if (configuredProjects.length > 1) {
            out += `  All configured projects: ${configuredProjects.join(', ')}\n`;
          }
        } else if (config.jira.connected && !jiraCredOk) {
          out += `Jira: CORRUPTED — credentials incomplete or token is masked\n`;
          out += `  Action: run 'configure_service' with service='jira' to re-enter credentials\n`;
          if (jiraUrl) out += `  URL (saved): ${jiraUrl}\n`;
          if (jiraEmail) out += `  Email (saved): ${jiraEmail}\n`;
          if (!jiraEmail) out += `  Email: MISSING\n`;
          if (!jiraToken || isTokenMasked(jiraToken)) out += `  Token: MISSING or MASKED\n`;
        } else {
          out += `Jira: Not configured\n`;
          out += `  Run 'configure_service' with service='jira' to connect.\n`;
        }
        out += `GitHub: ${githubConnected ? 'Connected' : 'Not configured'}\n`;
        if (githubConnected) {
          out += `  User: ${config.github.user || process.env.GITHUB_USER || 'via token'}\n`;
        }
        out += `\n`;

        out += `--- Preferences (persistent) ---\n`;
        out += `Project: ${preferences.last_project || 'not set'}\n`;
        out += `Sprint: ${preferences.last_sprint || 'not set'}\n`;
        out += `Greeting Name: ${preferences.greeting_name || 'not set'}\n`;
        out += `\n`;

        const reportCount = ReportManager.listReports().length;
        const desktopProjects = ReportManager.listProjectNames();
        out += `--- Reports ---\n`;
        out += `Saved: ${reportCount} daily report(s)\n`;
        out += `Directory: ${ReportManager.REPORTS_DIR}\n`;
        if (desktopProjects.length > 0) {
          out += `Desktop project reports: ${desktopProjects.join(', ')}\n`;
          out += `Desktop directory: ${ReportManager.DESKTOP_UPDATES_DIR}\n`;
        }
        out += `\n`;

        const missing = [];
        if (!jiraConnected) missing.push("Jira (use 'configure_service' with service='jira')");
        if (!githubConnected) missing.push("GitHub (use 'configure_service' with service='github')");

        if (missing.length > 0) {
          out += `--- Setup Needed ---\n`;
          for (const m of missing) out += `  - ${m}\n`;
        } else {
          out += `All services connected!\n`;
          if (!preferences.last_project) {
            out += `Next: Use 'list_projects' to select your project.\n`;
          } else if (!preferences.last_sprint) {
            out += `Next: Use 'list_sprints' to select your sprint.\n`;
          } else {
            out += `Ready to go! Say "Good morning" or use 'smart_ticket_query' to get started.\n`;
          }
        }

        return this.textResponse(out);
      }

      case "configure_service": {
        const { service, url, email, token, project_name, user, repo } = args;

        const svcCheck = validate(serviceSchema, service);
        if (!svcCheck.success) return this.errorResponse(svcCheck.error);

        if (service === "jira") {
          const urlCheck = validate(jiraUrlSchema, url);
          if (!urlCheck.success) return this.errorResponse(`Jira URL: ${urlCheck.error}`);
          const emailCheck = validate(emailSchema, email);
          if (!emailCheck.success) return this.errorResponse(`Email: ${emailCheck.error}`);
          if (!token) return this.errorResponse("Jira API token is required.");
          if (isTokenMasked(token)) {
            return this.errorResponse(
              "The provided token looks like a masked placeholder (e.g. '********' or 'tok_****'). " +
              "Please provide your real API token from: https://id.atlassian.com/manage-profile/security/api-tokens"
            );
          }
          if (token.length < 20) {
            return this.errorResponse(
              "The provided token looks too short to be a valid Atlassian API token. " +
              "Generate a fresh token at: https://id.atlassian.com/manage-profile/security/api-tokens"
            );
          }

          // Normalize URL — strip trailing slash
          const normalizedUrl = url.replace(/\/$/, '');

          // Ensure projects map exists
          if (!config.jira.projects) config.jira.projects = {};

          // Determine project key: use provided project_name or fall back to '__default__'
          const projectKey = project_name ? project_name.trim() : (config.jira.active_project || '__default__');

          // Store credentials under the project key
          config.jira.projects[projectKey] = { url: normalizedUrl, email, token };

          // Update flat fields to reflect the active project (backward compat)
          config.jira.active_project = projectKey;
          config.jira.url = normalizedUrl;
          config.jira.email = email;
          config.jira.token = token;
          config.jira.connected = true;
        } else if (service === "github") {
          if (!token) return this.errorResponse("GitHub token is required.");
          config.github = { connected: true, token, user: user || null, repo: repo || null };
        }

        saveConfig();

        let out = `${service} configured successfully.\n`;
        if (service === "jira") {
          const projectKey = config.jira.active_project;
          if (projectKey && projectKey !== '__default__') {
            out += `Credentials stored for project: ${projectKey}\n`;
          }
          const allProjects = Object.keys(config.jira.projects || {});
          if (allProjects.length > 1) {
            out += `All configured projects: ${allProjects.join(', ')}\n`;
          }
          try {
            const client = getJiraClient();
            const result = await client.testConnection();
            out += `Connection verified! Logged in as: ${result.user} (${result.email})\n\n`;
            out += `Next steps:\n`;
            out += `- Use 'list_projects' to select your project\n`;
            out += `- Use 'morning_standup' to start your day\n`;
            out += `- Or just say "Good morning!" to get your daily plan\n`;
          } catch (testErr) {
            out += `Warning: Connection test failed — ${testErr.message}\n`;
            out += `Credentials saved but may be incorrect. Use 'jira_connection_test' to debug.\n`;
          }
        }
        return this.textResponse(out);
      }

      case "switch_jira_project": {
        const { project_name } = args;
        const configuredProjects = config.jira.projects ? Object.keys(config.jira.projects) : [];

        if (!project_name) {
          if (configuredProjects.length === 0) {
            return this.textResponse("No Jira projects configured yet. Use 'configure_service' with project_name to add one.");
          }
          let out = `Configured Jira projects:\n`;
          for (const p of configuredProjects) {
            const creds = config.jira.projects[p];
            const active = p === config.jira.active_project ? ' (active)' : '';
            out += `  - ${p}${active}: ${creds.url} / ${creds.email}\n`;
          }
          out += `\nUse switch_jira_project with project_name to switch.`;
          return this.textResponse(out);
        }

        const key = project_name.trim();
        if (!config.jira.projects || !config.jira.projects[key]) {
          const available = configuredProjects.length > 0 ? `Available: ${configuredProjects.join(', ')}` : 'No projects configured yet.';
          return this.errorResponse(
            `No Jira credentials found for project '${key}'. ${available}\n` +
            `Use 'configure_service' with service='jira' and project_name='${key}' to add credentials.`
          );
        }

        const creds = config.jira.projects[key];
        config.jira.active_project = key;
        config.jira.url = creds.url;
        config.jira.email = creds.email;
        config.jira.token = creds.token;
        config.jira.connected = true;
        saveConfig();

        let out = `Switched to Jira project: ${key}\n`;
        out += `  URL: ${creds.url}\n  Email: ${creds.email}\n`;
        try {
          const client = getJiraClient();
          const result = await client.testConnection();
          out += `Connection verified! Logged in as: ${result.user} (${result.email})\n`;
        } catch (testErr) {
          out += `Warning: Connection test failed — ${testErr.message}\n`;
        }
        return this.textResponse(out);
      }

      case "jira_connection_test": {
        const client = getJiraClient();
        const result = await client.testConnection();
        return this.textResponse(
          `Jira connection successful.\nUser: ${result.user}\nEmail: ${result.email}\nAccount: ${result.accountId}`
        );
      }

      case "health_check": {
        const results = {
          version: CONST.VERSION,
          timestamp: new Date().toISOString(),
          jira: { status: "unchecked" },
          git: { status: "unchecked" },
          reports: { status: "unchecked" },
        };

        try {
          const client = getJiraClient();
          const user = await client.testConnection();
          results.jira = { status: "ok", user: user.user };
        } catch (err) {
          results.jira = { status: "error", message: err.message };
        }

        try {
          const commits = await GitUtils.getRecentCommits("1 hour ago", getRepoPath());
          results.git = { status: "ok", recentCommits: commits.length };
        } catch (err) {
          results.git = { status: "error", message: err.message };
        }

        try {
          ReportManager.ensureDir();
          fs.accessSync(ReportManager.REPORTS_DIR, fs.constants.W_OK);
          const reps = ReportManager.listReports();
          results.reports = { status: "ok", count: reps.length, dir: ReportManager.REPORTS_DIR };
        } catch (err) {
          results.reports = { status: "error", message: err.message };
        }

        const allOk = Object.values(results)
          .filter(v => typeof v === 'object' && v.status)
          .every(v => v.status === 'ok');

        let out = `Health Check — ${allOk ? 'ALL OK' : 'ISSUES DETECTED'}\n\n`;
        out += JSON.stringify(results, null, 2);
        return this.textResponse(out);
      }

      case "set_preferences": {
        const changes = [];
        if (args.project) { preferences.last_project = args.project; changes.push(`project: ${args.project}`); }
        if (args.sprint) { preferences.last_sprint = args.sprint; changes.push(`sprint: ${args.sprint}`); }
        if (args.board_id) { preferences.last_board_id = args.board_id; changes.push(`board: ${args.board_id}`); }
        if (args.assignee) { preferences.last_assignee = args.assignee; changes.push(`assignee: ${args.assignee}`); }
        if (args.greeting_name) { preferences.greeting_name = args.greeting_name; changes.push(`greeting name: ${args.greeting_name}`); }

        if (changes.length === 0) {
          let out = `Current Preferences:\n`;
          out += `  Project: ${preferences.last_project || 'not set'}\n`;
          out += `  Sprint: ${preferences.last_sprint || 'not set'}\n`;
          out += `  Board ID: ${preferences.last_board_id || 'not set'}\n`;
          out += `  Assignee: ${preferences.last_assignee || 'not set'}\n`;
          out += `  Greeting Name: ${preferences.greeting_name || 'not set'}\n`;
          return this.textResponse(out);
        }

        savePreferences();
        return this.textResponse(`Preferences updated: ${changes.join(', ')}.\nThese will be remembered across sessions.`);
      }

      default:
        return null;
    }
  }

  getPrompt() {
    return (
      this.loadPromptChunk("setup.md") ||
      `### Setup & Configuration Tools
Use \`get_setup_status\` or \`health_check\` to verify system states before making assumptions. Always encourage the user to use \`set_preferences\` to avoid repetitive prompts for Project Keys or Sprints.`
    );
  }
}

module.exports = SetupSkill;
