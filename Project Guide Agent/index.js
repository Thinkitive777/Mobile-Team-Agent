const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const fs = require("fs");
const path = require("path");
const os = require("os");
require("dotenv").config();

// Internal modules
const CONST = require("./constants");
const Logger = require("./logger");
const { AppError, ConfigError, ValidationError } = require("./errors");
const { validate, ticketKeySchema, dateSchema, serviceSchema, jiraUrlSchema, emailSchema } = require("./validators");
const JiraClient = require("./jira-client");
const GitUtils = require("./git-utils");
const ReportManager = require("./report-manager");

// ── Config ──────────────────────────────────────────────────────────────

if (!fs.existsSync(CONST.CONFIG_DIR)) {
  fs.mkdirSync(CONST.CONFIG_DIR, { recursive: true, mode: 0o700 });
}

let config = {
  jira: { connected: false, url: null, email: null, token: null },
  github: { connected: false, token: null, user: null, repo: null },
  developer_mode: false,
};

if (fs.existsSync(CONST.CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONST.CONFIG_FILE, "utf-8"));
  } catch (e) {
    Logger.error("Config file corrupted, using defaults", { error: e.message });
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONST.CONFIG_FILE, JSON.stringify(config, null, 2), {
      mode: CONST.CONFIG_FILE_PERMISSIONS,
    });
  } catch (err) {
    Logger.error("Failed to save config", { error: err.message });
    throw new ConfigError("Failed to save configuration: " + err.message);
  }
}

// ── Preferences (persisted across sessions) ──────────────────────────

let preferences = {
  last_project: null,
  last_sprint: null,
  last_board_id: null,
  last_assignee: null,
  greeting_name: null,
};

if (fs.existsSync(CONST.PREFERENCES_FILE)) {
  try {
    preferences = { ...preferences, ...JSON.parse(fs.readFileSync(CONST.PREFERENCES_FILE, "utf-8")) };
  } catch (e) {
    Logger.error("Preferences file corrupted, using defaults", { error: e.message });
  }
}

function savePreferences() {
  try {
    fs.writeFileSync(CONST.PREFERENCES_FILE, JSON.stringify(preferences, null, 2), {
      mode: CONST.CONFIG_FILE_PERMISSIONS,
    });
  } catch (err) {
    Logger.error("Failed to save preferences", { error: err.message });
  }
}

function maskToken(token) {
  if (!token || token === "********" || token.length <= 4) return "tok_****";
  return `tok_****${token.slice(-4)}`;
}

function getJiraClient() {
  const url = process.env.JIRA_URL || config.jira.url;
  const email = process.env.JIRA_EMAIL || config.jira.email;
  const token = process.env.JIRA_TOKEN || config.jira.token;

  if (!url || !email || !token) {
    throw new ConfigError(
      "Jira not configured. Set JIRA_URL, JIRA_EMAIL, JIRA_TOKEN as env vars or use configure_service."
    );
  }
  return new JiraClient(url, email, token);
}

function getRepoPath() {
  return process.env.REPO_PATH || process.cwd();
}

// Helper to build error response
function errorResponse(msg) {
  return { content: [{ type: "text", text: msg }], isError: true };
}
function textResponse(msg) {
  return { content: [{ type: "text", text: msg }] };
}

// Helper to detect if a ticket is blocked via issue links
function isTicketBlocked(ticket) {
  const nameBlocked = (ticket.summary + ' ' + ticket.status).toLowerCase().includes('blocked');
  const labelBlocked = (ticket.labels || []).some(l => l.toLowerCase() === 'blocked');
  const linkBlocked = (ticket.issueLinks || []).some(link =>
    link.description?.toLowerCase().includes('is blocked by') &&
    link.linkedStatus !== 'Done'
  );
  return nameBlocked || labelBlocked || linkBlocked;
}

// ── MCP Server ──────────────────────────────────────────────────────────

const server = new Server(
  { name: "projectguide-agent", version: CONST.VERSION },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Setup ──
    {
      name: "get_setup_status",
      description: "Check connection status for all integrations and suggest setup steps.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "configure_service",
      description: "Configure Jira or GitHub. Jira requires url, email, token. GitHub requires token.",
      inputSchema: {
        type: "object",
        properties: {
          service: { type: "string", enum: ["jira", "github"] },
          url: { type: "string", description: "Jira instance URL (Jira only)" },
          email: { type: "string", description: "Jira email (Jira only)" },
          token: { type: "string", description: "API token" },
          user: { type: "string", description: "GitHub username" },
          repo: { type: "string", description: "GitHub repo (owner/repo)" },
        },
        required: ["service", "token"],
      },
    },

    // ── Jira ──
    {
      name: "jira_connection_test",
      description: "Validate Jira credentials and return current user info.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "fetch_jira_tickets",
      description: "Search Jira tickets with JQL filters: assignee, status, sprint, updated date range.",
      inputSchema: {
        type: "object",
        properties: {
          assignee: { type: "string", description: "Filter by assignee (or 'currentUser')" },
          status: { type: "string", description: "Comma-separated statuses (e.g. 'To Do,In Progress')" },
          sprint: { type: "string", description: "Sprint name" },
          updated_since: { type: "string", description: "Updated since (e.g. '-7d')" },
          jql: { type: "string", description: "Raw JQL query (overrides other filters)" },
        },
      },
    },
    {
      name: "get_ticket_details",
      description: "Full Jira ticket details: description, comments, subtasks, linked issues, status history.",
      inputSchema: {
        type: "object",
        properties: {
          ticket_key: { type: "string", description: "Jira ticket key (e.g. PROJ-123)" },
        },
        required: ["ticket_key"],
      },
    },
    {
      name: "analyze_workload",
      description: "Categorize all assigned tickets: Done, In Progress, Not Started, Blocked, Overdue. Includes smart blocker detection via issue links.",
      inputSchema: { type: "object", properties: {} },
    },

    // ── Git ──
    {
      name: "get_recent_commits",
      description: "Fetch recent git commits with automatic Jira ticket linking.",
      inputSchema: {
        type: "object",
        properties: {
          since: { type: "string", description: "Time period (default: '48 hours ago')" },
        },
      },
    },

    // ── Automation ──
    {
      name: "morning_standup",
      description: "Generate morning standup: pending tickets, recent commits, prioritized daily plan. Works even if Jira is unavailable (falls back to Git data).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "end_of_day_report",
      description: "Generate, save, and display end-of-day report. Includes carry-forward from yesterday.",
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", description: "Report date (default: today, YYYY-MM-DD)" },
        },
      },
    },

    // ── Reports ──
    {
      name: "get_daily_report",
      description: "Retrieve a previously saved daily report by date.",
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["date"],
      },
    },
    {
      name: "list_daily_reports",
      description: "List all saved daily reports with optional date range.",
      inputSchema: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "Start (YYYY-MM-DD)" },
          end_date: { type: "string", description: "End (YYYY-MM-DD)" },
        },
      },
    },
    {
      name: "weekly_summary",
      description: "Generate a weekly summary aggregating daily reports (last 7 days or ending at a specified date).",
      inputSchema: {
        type: "object",
        properties: {
          end_date: { type: "string", description: "Week ending date (default: today)" },
        },
      },
    },

    // ── Operations ──
    {
      name: "health_check",
      description: "Check health of all integrations: Jira connectivity, Git availability, report storage.",
      inputSchema: { type: "object", properties: {} },
    },

    // ── Smart Workflow ──
    {
      name: "list_projects",
      description: "List all Jira projects accessible to the user. Remembers last selected project.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_sprints",
      description: "List active/future sprints for a project. Auto-detects board from project key. Remembers last selected sprint.",
      inputSchema: {
        type: "object",
        properties: {
          project_key: { type: "string", description: "Jira project key (e.g. PROJ). Uses last project if omitted." },
        },
      },
    },
    {
      name: "smart_ticket_query",
      description: "Interactive ticket search with categorized output (Bugs/Stories/Tasks/Subtasks). Groups by type, shows priority/status/due date, and suggests which tickets to start based on priority and deadlines.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project key (uses last project if omitted)" },
          sprint: { type: "string", description: "Sprint name (uses last sprint if omitted)" },
          assignee: { type: "string", description: "Assignee (default: currentUser)" },
          status: { type: "string", description: "Comma-separated statuses" },
          priority: { type: "string", description: "Filter by priority (e.g. 'High,Highest')" },
        },
      },
    },
    {
      name: "get_ticket_suggestions",
      description: "Analyze assigned tickets and provide intelligent suggestions on what to work on next. Considers priority, deadlines, dependencies, blockers, and current progress.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project key (uses last project if omitted)" },
        },
      },
    },
    {
      name: "select_ticket",
      description: "Select a ticket to work on. Returns full details with description, comments, and a generated implementation plan. Ask for confirmation before proceeding.",
      inputSchema: {
        type: "object",
        properties: {
          ticket_key: { type: "string", description: "Jira ticket key (e.g. PROJ-123)" },
        },
        required: ["ticket_key"],
      },
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
    },

    // ── Legacy ──
    {
      name: "run_skill",
      description: "Execute a skill: developer-mode, file-info.",
      inputSchema: {
        type: "object",
        properties: {
          skill: { type: "string" },
          args: { type: "string" },
        },
        required: ["skill"],
      },
    },
    {
      name: "invoke_projectguide",
      description: "Activate the Project Guide Agent. Shows setup status and next steps.",
      inputSchema: {
        type: "object",
        properties: { reason: { type: "string" } },
      },
    },
  ],
}));

// ── Tool handlers ───────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  Logger.info("Tool called", { tool: name });

  try {
    switch (name) {

      // ── invoke_projectguide ───────────────────────────────────────────
      case "invoke_projectguide": {
        const jiraOk = config.jira.connected || !!process.env.JIRA_URL;
        const githubOk = config.github.connected || !!process.env.GITHUB_TOKEN;
        const missing = [];
        if (!jiraOk) missing.push("Jira");
        if (!githubOk) missing.push("GitHub");

        let out = `Project Guide Agent v${CONST.VERSION} ACTIVATED.\n\n`;
        if (missing.length > 0) {
          out += `Setup required: ${missing.join(", ")}.\n`;
          out += `Use 'configure_service' or set environment variables.\n`;
        } else {
          out += "All services connected. Use 'morning_standup' or 'analyze_workload' to begin.\n";
        }
        return textResponse(out);
      }

      // ── get_setup_status ──────────────────────────────────────────────
      case "get_setup_status": {
        const jiraConnected = config.jira.connected || !!process.env.JIRA_URL;
        const githubConnected = config.github.connected || !!process.env.GITHUB_TOKEN;

        let out = `Project Guide Agent v${CONST.VERSION} — Setup Status\n\n`;

        // Connection status
        out += `--- Connections ---\n`;
        out += `Jira: ${jiraConnected ? 'Connected' : 'Not configured'}\n`;
        if (jiraConnected) {
          out += `  URL: ${config.jira.url || process.env.JIRA_URL}\n`;
          out += `  Email: ${config.jira.email || process.env.JIRA_EMAIL}\n`;
          out += `  Token: ${maskToken(config.jira.token || process.env.JIRA_TOKEN)}\n`;
        }
        out += `GitHub: ${githubConnected ? 'Connected' : 'Not configured'}\n`;
        if (githubConnected) {
          out += `  User: ${config.github.user || process.env.GITHUB_USER || 'via token'}\n`;
        }
        out += `\n`;

        // Preferences
        out += `--- Preferences (persistent) ---\n`;
        out += `Project: ${preferences.last_project || 'not set'}\n`;
        out += `Sprint: ${preferences.last_sprint || 'not set'}\n`;
        out += `Greeting Name: ${preferences.greeting_name || 'not set'}\n`;
        out += `\n`;

        // Reports
        const reportCount = ReportManager.listReports().length;
        out += `--- Reports ---\n`;
        out += `Saved: ${reportCount} daily report(s)\n`;
        out += `Directory: ${ReportManager.REPORTS_DIR}\n\n`;

        // Next steps — only show what's NOT configured
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

        return textResponse(out);
      }

      // ── configure_service ─────────────────────────────────────────────
      case "configure_service": {
        const { service, url, email, token, user, repo } = args;

        const svcCheck = validate(serviceSchema, service);
        if (!svcCheck.success) return errorResponse(svcCheck.error);

        if (service === "jira") {
          const urlCheck = validate(jiraUrlSchema, url);
          if (!urlCheck.success) return errorResponse(`Jira URL: ${urlCheck.error}`);
          const emailCheck = validate(emailSchema, email);
          if (!emailCheck.success) return errorResponse(`Email: ${emailCheck.error}`);
          if (!token) return errorResponse("Jira API token is required.");

          config.jira = { connected: true, url, email, token };
        } else if (service === "github") {
          if (!token) return errorResponse("GitHub token is required.");
          config.github = { connected: true, token, user: user || null, repo: repo || null };
        }

        saveConfig();
        Logger.info("Service configured", { service });

        // Auto-test connection after saving
        let out = `${service} configured successfully.\n`;
        if (service === "jira") {
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
        return textResponse(out);
      }

      // ── jira_connection_test ──────────────────────────────────────────
      case "jira_connection_test": {
        const client = getJiraClient();
        const result = await client.testConnection();
        return textResponse(
          `Jira connection successful.\nUser: ${result.user}\nEmail: ${result.email}\nAccount: ${result.accountId}`
        );
      }

      // ── fetch_jira_tickets ────────────────────────────────────────────
      case "fetch_jira_tickets": {
        const client = getJiraClient();
        let jqlString;

        if (args.jql) {
          // Raw JQL passthrough
          jqlString = args.jql;
        } else {
          const clauses = [];
          if (args.assignee) {
            clauses.push(
              args.assignee === "currentUser"
                ? "assignee = currentUser()"
                : `assignee = "${args.assignee}"`
            );
          }
          if (args.status) {
            const statuses = args.status.split(",").map(s => `"${s.trim()}"`).join(",");
            clauses.push(`status in (${statuses})`);
          }
          if (args.sprint) {
            clauses.push(`sprint = "${args.sprint}"`);
          }
          if (args.updated_since) {
            clauses.push(`updated >= ${args.updated_since}`);
          }
          jqlString = clauses.length > 0
            ? clauses.join(" AND ") + " ORDER BY updated DESC"
            : "assignee = currentUser() ORDER BY updated DESC";
        }

        const result = await client.searchTickets(jqlString, [
          ...CONST.JIRA_DEFAULT_FIELDS, 'issuetype'
        ]);
        const tickets = result.tickets;

        let out = `Found ${tickets.length} ticket(s)`;
        if (result.total > tickets.length) {
          out += ` (showing ${tickets.length} of ${result.total})`;
        }
        out += `\n\n`;

        // Categorize by issue type
        const categories = {};
        for (const t of tickets) {
          const type = t.issueType || 'Other';
          if (!categories[type]) categories[type] = [];
          categories[type].push(t);
        }

        const typeOrder = ['Bug', 'Story', 'Task', 'Sub-task', 'Epic'];
        const sortedTypes = Object.keys(categories).sort((a, b) => {
          const ai = typeOrder.indexOf(a);
          const bi = typeOrder.indexOf(b);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });

        for (const type of sortedTypes) {
          const items = categories[type];
          out += `--- ${type}s (${items.length}) ---\n`;
          for (const t of items) {
            out += `  [${t.priority}] ${t.key}: ${t.summary}\n`;
            out += `     Status: ${t.status} | Assignee: ${t.assignee}`;
            if (t.dueDate) out += ` | Due: ${t.dueDate}`;
            if (t.labels.length > 0) out += ` | Labels: ${t.labels.join(", ")}`;
            out += `\n`;
          }
          out += `\n`;
        }

        return textResponse(out);
      }

      // ── get_ticket_details ────────────────────────────────────────────
      case "get_ticket_details": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return errorResponse(keyCheck.error);

        const client = getJiraClient();
        const t = await client.getTicket(args.ticket_key);

        let out = `${t.key}: ${t.summary}\n\n`;
        out += `Status: ${t.status} | Priority: ${t.priority} | Assignee: ${t.assignee}\n`;
        if (t.dueDate) out += `Due: ${t.dueDate}\n`;
        if (t.labels.length > 0) out += `Labels: ${t.labels.join(", ")}\n`;
        out += `\nDescription:\n${t.description}\n`;

        if (t.subtasks.length > 0) {
          out += `\nSubtasks (${t.subtasks.length}):\n`;
          for (const st of t.subtasks) {
            out += `  - ${st.key}: ${st.summary} [${st.status}]\n`;
          }
        }

        if (t.issueLinks.length > 0) {
          out += `\nLinked Issues:\n`;
          for (const link of t.issueLinks) {
            out += `  - ${link.description}: ${link.linkedKey} [${link.linkedStatus}]\n`;
          }
        }

        if (t.comments.length > 0) {
          out += `\nComments (latest ${Math.min(t.comments.length, CONST.COMMENT_PREVIEW_COUNT)}):\n`;
          for (const c of t.comments.slice(-CONST.COMMENT_PREVIEW_COUNT)) {
            const preview = (c.body || '').substring(0, CONST.COMMENT_PREVIEW_LENGTH);
            const ellipsis = c.body && c.body.length > CONST.COMMENT_PREVIEW_LENGTH ? '...' : '';
            out += `  ${c.author}: ${preview}${ellipsis}\n`;
          }
        }

        if (t.changelog.length > 0) {
          out += `\nRecent Status Changes:\n`;
          for (const h of t.changelog) {
            const statusChanges = h.items.filter(i => i.field === 'status');
            for (const s of statusChanges) {
              out += `  ${h.created.substring(0, 10)}: ${s.from} -> ${s.to} (by ${h.author})\n`;
            }
          }
        }

        return textResponse(out);
      }

      // ── analyze_workload ──────────────────────────────────────────────
      case "analyze_workload": {
        const client = getJiraClient();
        const result = await client.searchTickets(
          "assignee = currentUser() ORDER BY priority DESC, duedate ASC"
        );
        const tickets = result.tickets;
        const now = new Date();

        const cat = { done: [], inProgress: [], notStarted: [], blocked: [], overdue: [] };

        for (const t of tickets) {
          const dueDate = t.dueDate ? new Date(t.dueDate) : null;
          const overdue = dueDate && dueDate < now && t.statusCategory !== "Done";

          if (t.statusCategory === "Done" || t.status === "Done") {
            cat.done.push(t);
          } else if (isTicketBlocked(t)) {
            cat.blocked.push(t);
          } else if (overdue) {
            cat.overdue.push(t);
          } else if (t.status === "In Progress") {
            cat.inProgress.push(t);
          } else {
            cat.notStarted.push(t);
          }
        }

        const fmt = (arr) => arr.length > 0
          ? arr.map(t => `${t.key}: ${t.summary}`).join(", ")
          : "None";

        let out = `Workload Analysis (${tickets.length} total`;
        if (result.total > tickets.length) out += `, ${result.total} in Jira`;
        out += `)\n\n`;

        out += `Done (${cat.done.length}): ${fmt(cat.done)}\n`;
        out += `In Progress (${cat.inProgress.length}): ${fmt(cat.inProgress)}\n`;
        out += `Not Started (${cat.notStarted.length}): ${fmt(cat.notStarted)}\n`;
        out += `Blocked (${cat.blocked.length}): ${fmt(cat.blocked)}\n`;
        out += `Overdue (${cat.overdue.length}): ${fmt(cat.overdue)}\n`;

        // Insights
        out += `\n--- Insights ---\n`;
        if (cat.overdue.length > 0) {
          out += `OVERDUE: ${cat.overdue.map(t => `${t.key} (due ${t.dueDate})`).join(", ")}\n`;
        }
        if (cat.blocked.length > 0) {
          for (const t of cat.blocked) {
            const blockers = (t.issueLinks || [])
              .filter(l => l.description?.toLowerCase().includes("is blocked by"))
              .map(l => l.linkedKey);
            out += `BLOCKED: ${t.key} — blocked by: ${blockers.join(", ") || "flagged/labeled"}\n`;
          }
        }
        if (cat.inProgress.length > 0) {
          out += `\nRecommended focus: ${cat.inProgress[0].key} (${cat.inProgress[0].summary})\n`;
        } else if (cat.overdue.length > 0) {
          out += `\nRecommended focus: ${cat.overdue[0].key} (OVERDUE)\n`;
        } else if (cat.notStarted.length > 0) {
          out += `\nRecommended next: ${cat.notStarted[0].key} (${cat.notStarted[0].summary})\n`;
        }

        return textResponse(out);
      }

      // ── get_recent_commits ────────────────────────────────────────────
      case "get_recent_commits": {
        const since = args.since || CONST.GIT_DEFAULT_SINCE;
        const commits = await GitUtils.getRecentCommits(since, getRepoPath());

        if (commits.length === 0) {
          return textResponse(`No commits found since ${since}.`);
        }

        let out = `Recent Commits (${since}) — ${commits.length} total\n\n`;
        for (const c of commits) {
          out += `${c.hash}: ${c.message}\n`;
          if (c.ticketIds.length > 0) out += `   Tickets: ${c.ticketIds.join(", ")}\n`;
          out += `   ${c.author} @ ${c.datetime}\n\n`;
        }

        return textResponse(out);
      }

      // ── morning_standup ───────────────────────────────────────────────
      case "morning_standup": {
        let tickets = [];
        let jiraError = null;
        let totalTickets = 0;

        // Jira: graceful degradation
        try {
          const client = getJiraClient();
          const result = await client.searchTickets(
            "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, duedate ASC"
          );
          tickets = result.tickets;
          totalTickets = result.total;
        } catch (err) {
          jiraError = err.message;
          Logger.warn("Jira unavailable for standup", { error: err.message });
        }

        // Git: graceful degradation
        let commits = [];
        try {
          commits = await GitUtils.getRecentCommits(CONST.STANDUP_COMMIT_WINDOW, getRepoPath());
        } catch (err) {
          Logger.warn("Git unavailable for standup", { error: err.message });
        }

        // Carry-forward from yesterday
        const carryForward = ReportManager.getYesterdayCarryForward();

        const now = new Date();
        let out = `Morning Standup — ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n\n`;

        if (jiraError) {
          out += `[Jira unavailable: ${jiraError}]\n\n`;
        }

        // Workload summary
        if (tickets.length > 0) {
          const highPriority = tickets.filter(t => t.priority === "Highest" || t.priority === "High");
          const inProgress = tickets.filter(t => t.status === "In Progress");
          const overdue = tickets.filter(t => {
            const due = t.dueDate ? new Date(t.dueDate) : null;
            return due && due < now;
          });

          out += `Workload: ${tickets.length} pending`;
          if (totalTickets > tickets.length) out += ` (${totalTickets} total)`;
          out += `\n\n`;

          if (overdue.length > 0) {
            out += `OVERDUE (${overdue.length}):\n`;
            for (const t of overdue) {
              out += `  - ${t.key}: ${t.summary} (due ${t.dueDate})\n`;
            }
            out += `\n`;
          }

          if (highPriority.length > 0) {
            out += `High Priority (${highPriority.length}):\n`;
            for (const t of highPriority) {
              out += `  - ${t.key}: ${t.summary}`;
              if (t.dueDate) out += ` (due ${t.dueDate})`;
              out += `\n`;
            }
            out += `\n`;
          }

          if (inProgress.length > 0) {
            out += `Currently Working On (${inProgress.length}):\n`;
            for (const t of inProgress) {
              // Check if commits exist for this ticket
              const related = commits.filter(c => c.ticketIds.includes(t.key));
              out += `  - ${t.key}: ${t.summary}`;
              if (related.length > 0) out += ` (${related.length} recent commit(s))`;
              out += `\n`;
            }
            out += `\n`;
          }

          // Suggested plan
          out += `--- Suggested Plan ---\n`;
          let step = 1;
          if (inProgress.length > 0) {
            out += `${step++}. Continue: ${inProgress[0].key} — ${inProgress[0].summary}\n`;
            // Recommend high-priority if it's NOT already in progress
            const inProgressKeys = new Set(inProgress.map(t => t.key));
            const nextHigh = highPriority.find(t => !inProgressKeys.has(t.key));
            if (nextHigh) {
              out += `${step++}. Prioritize: ${nextHigh.key} — ${nextHigh.summary}\n`;
            }
          } else if (overdue.length > 0) {
            out += `${step++}. Urgent: ${overdue[0].key} — ${overdue[0].summary} (OVERDUE)\n`;
          } else if (highPriority.length > 0) {
            out += `${step++}. Start: ${highPriority[0].key} — ${highPriority[0].summary}\n`;
          }
          out += `\n`;
        }

        // Recent commits
        if (commits.length > 0) {
          out += `Recent Activity (${commits.length} commit(s) in ${CONST.STANDUP_COMMIT_WINDOW}):\n`;
          for (const c of commits.slice(0, CONST.COMMITS_PREVIEW_LIMIT)) {
            const ticketTag = c.ticketIds.length > 0 ? ` [${c.ticketIds.join(", ")}]` : '';
            out += `  - ${c.hash}: ${c.message}${ticketTag}\n`;
          }
          if (commits.length > CONST.COMMITS_PREVIEW_LIMIT) {
            out += `  ... and ${commits.length - CONST.COMMITS_PREVIEW_LIMIT} more\n`;
          }
          out += `\n`;
        }

        // Carry-forward
        if (carryForward.length > 0) {
          out += `Carried from yesterday:\n`;
          for (const item of carryForward) {
            out += `  - ${item}\n`;
          }
          out += `\n`;
        }

        // Daily planning prompt
        const greeting = preferences.greeting_name ? `${preferences.greeting_name}, w` : 'W';
        out += `--- ${greeting}hat would you like to work on today? ---\n`;
        if (tickets.length > 0) {
          const inProgress = tickets.filter(t => t.status === "In Progress");
          const topPicks = inProgress.length > 0 ? inProgress : tickets.slice(0, 3);
          out += `Quick picks:\n`;
          topPicks.forEach((t, i) => {
            out += `  ${i + 1}. ${t.key}: ${t.summary} [${t.priority}]\n`;
          });
          out += `\nSay a ticket key (e.g. "${topPicks[0].key}") to get a full implementation plan.\n`;
          out += `Or use 'smart_ticket_query' to search by sprint, status, or priority.\n`;
        } else if (!jiraError) {
          out += `No pending tickets found. Use 'list_projects' to explore your Jira projects.\n`;
        }

        return textResponse(out);
      }

      // ── end_of_day_report ─────────────────────────────────────────────
      case "end_of_day_report": {
        if (args.date) {
          const dateCheck = validate(dateSchema, args.date);
          if (!dateCheck.success) return errorResponse(dateCheck.error);
        }
        const reportDate = args.date || ReportManager.formatDate();

        // Git: today's commits
        let commits = [];
        try {
          commits = await GitUtils.getTodayCommits(getRepoPath());
        } catch (err) {
          Logger.warn("Git unavailable for EOD", { error: err.message });
        }

        // Jira: today's ticket activity (graceful)
        let completed = [];
        let inProgress = [];
        let jiraError = null;
        try {
          const client = getJiraClient();
          const result = await client.searchTickets(
            `assignee = currentUser() AND updated >= "${reportDate}" ORDER BY updated DESC`
          );
          completed = result.tickets.filter(t => t.statusCategory === "Done" || t.status === "Done");
          inProgress = result.tickets.filter(t => t.status === "In Progress");
        } catch (err) {
          jiraError = err.message;
          Logger.warn("Jira unavailable for EOD", { error: err.message });
        }

        // Carry-forward: yesterday's in-progress minus today's completed
        const carryForward = ReportManager.getYesterdayCarryForward()
          .filter(item => !completed.some(t => item.includes(t.key)));

        // Also add today's in-progress as carry-forward
        for (const t of inProgress) {
          const entry = `${t.key}: ${t.summary}`;
          if (!carryForward.includes(entry)) carryForward.push(entry);
        }

        // Notes
        let notes = '';
        if (commits.length > 0) notes += `${commits.length} commit(s) made today. `;
        if (completed.length > 0) notes += `${completed.length} ticket(s) completed. `;
        if (jiraError) notes += `[Jira was unavailable: ${jiraError}]`;
        if (!notes) notes = 'Quiet day.';

        const report = ReportManager.generateDailyReport(reportDate, {
          completed: completed.map(t => `${t.key}: ${t.summary}`),
          inProgress: inProgress.map(t => `${t.key}: ${t.summary}`),
          commits,
          carryForward,
          blockers: [],
          notes,
        });

        const reportPath = ReportManager.saveReport(reportDate, report);

        let out = `End-of-Day Report — ${reportDate}\n\n`;
        out += `Saved to: ${reportPath}\n\n`;
        out += `Summary:\n`;
        out += `- ${commits.length} commit(s)\n`;
        out += `- ${completed.length} ticket(s) completed\n`;
        out += `- ${inProgress.length} ticket(s) in progress\n`;
        out += `- ${carryForward.length} item(s) carry forward\n`;
        if (jiraError) out += `\n[Jira was unavailable — report based on Git data only]\n`;

        return textResponse(out);
      }

      // ── get_daily_report ──────────────────────────────────────────────
      case "get_daily_report": {
        const dateCheck = validate(dateSchema, args.date);
        if (!dateCheck.success) return errorResponse(dateCheck.error);

        const content = ReportManager.getReport(args.date);
        if (!content) {
          return errorResponse(`No report found for ${args.date}. Use 'list_daily_reports' to see available dates.`);
        }
        return textResponse(content);
      }

      // ── list_daily_reports ────────────────────────────────────────────
      case "list_daily_reports": {
        if (args.start_date) {
          const c = validate(dateSchema, args.start_date);
          if (!c.success) return errorResponse(`start_date: ${c.error}`);
        }
        if (args.end_date) {
          const c = validate(dateSchema, args.end_date);
          if (!c.success) return errorResponse(`end_date: ${c.error}`);
        }

        const reports = ReportManager.listReports(args.start_date, args.end_date);
        if (reports.length === 0) return textResponse("No daily reports found.");

        let out = `Daily Reports (${reports.length})\n\n`;
        for (const r of reports) {
          const content = ReportManager.getReport(r.date);
          if (content) {
            const sections = ReportManager._extractSections(content);
            out += `${r.date}: ${sections.completed.length} completed, ${sections.commitCount} commits\n`;
          } else {
            out += `${r.date}: (file missing)\n`;
          }
        }
        return textResponse(out);
      }

      // ── weekly_summary ────────────────────────────────────────────────
      case "weekly_summary": {
        if (args.end_date) {
          const c = validate(dateSchema, args.end_date);
          if (!c.success) return errorResponse(c.error);
        }
        const endDate = args.end_date ? new Date(args.end_date) : new Date();
        const summary = ReportManager.generateWeeklySummary(endDate);
        return textResponse(summary);
      }

      // ── health_check ──────────────────────────────────────────────────
      case "health_check": {
        const results = {
          version: CONST.VERSION,
          timestamp: new Date().toISOString(),
          jira: { status: "unchecked" },
          git: { status: "unchecked" },
          reports: { status: "unchecked" },
        };

        // Jira
        try {
          const client = getJiraClient();
          const user = await client.testConnection();
          results.jira = { status: "ok", user: user.user };
        } catch (err) {
          results.jira = { status: "error", message: err.message };
        }

        // Git
        try {
          const commits = await GitUtils.getRecentCommits("1 hour ago", getRepoPath());
          results.git = { status: "ok", recentCommits: commits.length };
        } catch (err) {
          results.git = { status: "error", message: err.message };
        }

        // Reports directory
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
        return textResponse(out);
      }

      // ── list_projects ─────────────────────────────────────────────────
      case "list_projects": {
        const client = getJiraClient();
        const projects = await client.getProjects();

        if (projects.length === 0) {
          return textResponse("No Jira projects found. Check your permissions.");
        }

        let out = `Available Projects (${projects.length})\n\n`;
        for (const p of projects) {
          const isCurrent = preferences.last_project === p.key ? ' (current)' : '';
          out += `  ${p.key}: ${p.name}${isCurrent}\n`;
        }

        if (preferences.last_project) {
          out += `\nLast used project: ${preferences.last_project}\n`;
        }
        out += `\nTo select a project, use 'set_preferences' with project key.\n`;
        out += `Then use 'list_sprints' to see active sprints.\n`;

        return textResponse(out);
      }

      // ── list_sprints ────────────────────────────────────────────────────
      case "list_sprints": {
        const projectKey = args.project_key || preferences.last_project;
        if (!projectKey) {
          return errorResponse("No project specified. Use 'list_projects' first or pass project_key.");
        }

        const client = getJiraClient();

        // Find board for this project
        let boards;
        try {
          boards = await client.getBoards(projectKey);
        } catch (err) {
          return errorResponse(`Could not fetch boards for ${projectKey}: ${err.message}`);
        }

        if (boards.length === 0) {
          return errorResponse(`No boards found for project ${projectKey}. This project may not use Scrum/Kanban.`);
        }

        const board = boards[0]; // Use first board
        let sprints;
        try {
          sprints = await client.getSprints(board.id);
        } catch (err) {
          return errorResponse(`Could not fetch sprints for board "${board.name}": ${err.message}`);
        }

        if (sprints.length === 0) {
          return textResponse(`No active or future sprints found for ${projectKey} (board: ${board.name}).`);
        }

        let out = `Sprints for ${projectKey} (board: ${board.name})\n\n`;
        for (const s of sprints) {
          const isCurrent = preferences.last_sprint === s.name ? ' (current)' : '';
          const active = s.state === 'active' ? ' [ACTIVE]' : '';
          out += `  ${s.name}${active}${isCurrent}\n`;
          if (s.startDate && s.endDate) {
            out += `    ${s.startDate.substring(0, 10)} to ${s.endDate.substring(0, 10)}\n`;
          }
          if (s.goal) out += `    Goal: ${s.goal}\n`;
        }

        // Auto-save board ID for future use
        preferences.last_board_id = board.id;
        if (!preferences.last_project || preferences.last_project !== projectKey) {
          preferences.last_project = projectKey;
        }
        savePreferences();

        out += `\nTo select a sprint, use 'set_preferences' with sprint name.\n`;
        out += `Then use 'smart_ticket_query' to view tickets in that sprint.\n`;

        return textResponse(out);
      }

      // ── smart_ticket_query ──────────────────────────────────────────────
      case "smart_ticket_query": {
        const client = getJiraClient();
        const project = args.project || preferences.last_project;
        const sprint = args.sprint || preferences.last_sprint;
        const assignee = args.assignee || 'currentUser';

        const clauses = [];
        if (project) clauses.push(`project = "${project}"`);
        if (sprint) clauses.push(`sprint = "${sprint}"`);
        if (assignee === 'currentUser') {
          clauses.push('assignee = currentUser()');
        } else if (assignee) {
          clauses.push(`assignee = "${assignee}"`);
        }
        if (args.status) {
          const statuses = args.status.split(",").map(s => `"${s.trim()}"`).join(",");
          clauses.push(`status in (${statuses})`);
        }
        if (args.priority) {
          const priorities = args.priority.split(",").map(p => `"${p.trim()}"`).join(",");
          clauses.push(`priority in (${priorities})`);
        }

        if (clauses.length === 0) {
          clauses.push('assignee = currentUser()');
        }

        const jql = clauses.join(' AND ') + ' ORDER BY priority DESC, duedate ASC';
        const result = await client.searchTickets(jql, [
          ...CONST.JIRA_DEFAULT_FIELDS, 'issuetype'
        ]);
        const tickets = result.tickets;

        if (tickets.length === 0) {
          let out = `No tickets found matching your query.\n`;
          out += `Filters used: ${clauses.join(', ')}\n\n`;
          out += `Try adjusting your filters or use 'fetch_jira_tickets' with raw JQL.`;
          return textResponse(out);
        }

        // Categorize by issue type
        const categories = { Bug: [], Story: [], Task: [], 'Sub-task': [], Epic: [], Other: [] };
        const now = new Date();

        for (const t of tickets) {
          const type = t.issueType || 'Other';
          const cat = categories[type] || categories['Other'];
          cat.push(t);
        }

        let out = `Tickets Found: ${tickets.length}`;
        if (result.total > tickets.length) out += ` (${result.total} total)`;
        out += `\n`;
        if (project) out += `Project: ${project}`;
        if (sprint) out += ` | Sprint: ${sprint}`;
        out += `\n\n`;

        for (const [type, items] of Object.entries(categories)) {
          if (items.length === 0) continue;
          out += `--- ${type}s (${items.length}) ---\n`;
          for (const t of items) {
            const dueDate = t.dueDate ? new Date(t.dueDate) : null;
            const overdue = dueDate && dueDate < now && t.statusCategory !== 'Done';
            const overdueTag = overdue ? ' OVERDUE' : '';

            out += `  [${t.priority}] ${t.key}: ${t.summary}\n`;
            out += `     Status: ${t.status}${overdueTag}`;
            if (t.dueDate) out += ` | Due: ${t.dueDate}`;
            out += `\n`;
          }
          out += `\n`;
        }

        // Suggestions
        const nonDone = tickets.filter(t => t.statusCategory !== 'Done');
        const overdue = nonDone.filter(t => t.dueDate && new Date(t.dueDate) < now);
        const highPri = nonDone.filter(t => t.priority === 'Highest' || t.priority === 'High');
        const inProgress = nonDone.filter(t => t.status === 'In Progress');

        out += `--- Recommendations ---\n`;
        if (inProgress.length > 0) {
          out += `Continue working on: ${inProgress[0].key} (${inProgress[0].summary})\n`;
        }
        if (overdue.length > 0) {
          out += `Urgent — overdue: ${overdue.map(t => t.key).join(', ')}\n`;
        }
        if (highPri.length > 0 && (!inProgress.length || !highPri.some(t => t.key === inProgress[0]?.key))) {
          out += `High priority: ${highPri.slice(0, 3).map(t => `${t.key} (${t.summary})`).join(', ')}\n`;
        }
        out += `\nSay a ticket key to get full details and an implementation plan.\n`;

        return textResponse(out);
      }

      // ── get_ticket_suggestions ──────────────────────────────────────────
      case "get_ticket_suggestions": {
        const client = getJiraClient();
        const project = args.project || preferences.last_project;

        const clauses = ['assignee = currentUser()', 'statusCategory != Done'];
        if (project) clauses.push(`project = "${project}"`);

        const jql = clauses.join(' AND ') + ' ORDER BY priority DESC, duedate ASC';
        const result = await client.searchTickets(jql, [
          ...CONST.JIRA_DEFAULT_FIELDS, 'issuetype'
        ]);
        const tickets = result.tickets;

        if (tickets.length === 0) {
          return textResponse("No open tickets assigned to you. You're all caught up!");
        }

        const now = new Date();
        const scored = tickets.map(t => {
          let score = 0;

          // Priority scoring
          if (t.priority === 'Highest') score += 50;
          else if (t.priority === 'High') score += 35;
          else if (t.priority === 'Medium') score += 20;
          else if (t.priority === 'Low') score += 10;
          else if (t.priority === 'Lowest') score += 5;

          // Overdue scoring
          if (t.dueDate) {
            const due = new Date(t.dueDate);
            const daysUntilDue = (due - now) / (1000 * 60 * 60 * 24);
            if (daysUntilDue < 0) score += 40; // overdue
            else if (daysUntilDue <= 1) score += 30; // due today/tomorrow
            else if (daysUntilDue <= 3) score += 20; // due this week
            else if (daysUntilDue <= 7) score += 10;
          }

          // In-progress gets a boost (continuity)
          if (t.status === 'In Progress') score += 25;

          // Bug boost (bugs should be fixed quickly)
          if (t.issueType === 'Bug') score += 15;

          // Blocked penalty
          if (isTicketBlocked(t)) score -= 30;

          return { ...t, score };
        });

        scored.sort((a, b) => b.score - a.score);

        let out = `Ticket Suggestions (${scored.length} open tickets)\n\n`;

        // Top 3 recommendations
        out += `--- Top Recommendations ---\n`;
        const top = scored.slice(0, 3);
        top.forEach((t, i) => {
          const reasons = [];
          if (t.status === 'In Progress') reasons.push('already started');
          if (t.priority === 'Highest' || t.priority === 'High') reasons.push('high priority');
          if (t.dueDate) {
            const due = new Date(t.dueDate);
            const daysUntilDue = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
            if (daysUntilDue < 0) reasons.push(`overdue by ${Math.abs(daysUntilDue)} day(s)`);
            else if (daysUntilDue <= 1) reasons.push('due today/tomorrow');
            else if (daysUntilDue <= 3) reasons.push(`due in ${daysUntilDue} days`);
          }
          if (t.issueType === 'Bug') reasons.push('bug fix');

          out += `  ${i + 1}. ${t.key}: ${t.summary}\n`;
          out += `     [${t.priority}] ${t.issueType} | ${t.status}`;
          if (t.dueDate) out += ` | Due: ${t.dueDate}`;
          out += `\n`;
          if (reasons.length > 0) out += `     Why: ${reasons.join(', ')}\n`;
          out += `\n`;
        });

        // Blocked tickets
        const blocked = scored.filter(t => isTicketBlocked(t));
        if (blocked.length > 0) {
          out += `--- Blocked (${blocked.length}) ---\n`;
          for (const t of blocked) {
            const blockers = (t.issueLinks || [])
              .filter(l => l.description?.toLowerCase().includes('is blocked by'))
              .map(l => l.linkedKey);
            out += `  ${t.key}: ${t.summary} — blocked by: ${blockers.join(', ') || 'flagged'}\n`;
          }
          out += `\n`;
        }

        out += `Use 'select_ticket' with a ticket key to get an implementation plan.\n`;
        return textResponse(out);
      }

      // ── select_ticket ───────────────────────────────────────────────────
      case "select_ticket": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return errorResponse(keyCheck.error);

        const client = getJiraClient();
        const t = await client.getTicket(args.ticket_key);

        let out = `Selected Ticket: ${t.key}\n`;
        out += `${'='.repeat(50)}\n\n`;

        // Full details
        out += `Title: ${t.summary}\n`;
        out += `Type: ${t.statusCategory} | Status: ${t.status} | Priority: ${t.priority}\n`;
        out += `Assignee: ${t.assignee}`;
        if (t.dueDate) out += ` | Due: ${t.dueDate}`;
        out += `\n`;
        if (t.labels.length > 0) out += `Labels: ${t.labels.join(", ")}\n`;
        out += `\n`;

        // Description
        out += `--- Description ---\n`;
        out += `${t.description}\n\n`;

        // Subtasks
        if (t.subtasks.length > 0) {
          out += `--- Subtasks (${t.subtasks.length}) ---\n`;
          for (const st of t.subtasks) {
            const done = st.status === 'Done' ? 'x' : ' ';
            out += `  [${done}] ${st.key}: ${st.summary} [${st.status}]\n`;
          }
          out += `\n`;
        }

        // Linked Issues
        if (t.issueLinks.length > 0) {
          out += `--- Linked Issues ---\n`;
          for (const link of t.issueLinks) {
            out += `  ${link.description}: ${link.linkedKey} [${link.linkedStatus}]\n`;
          }
          out += `\n`;
        }

        // Comments (context for implementation)
        if (t.comments.length > 0) {
          out += `--- Recent Comments (${Math.min(t.comments.length, 5)}) ---\n`;
          for (const c of t.comments.slice(-5)) {
            const preview = (c.body || '').substring(0, 300);
            const ellipsis = c.body && c.body.length > 300 ? '...' : '';
            out += `  ${c.author} (${c.created?.substring(0, 10)}):\n    ${preview}${ellipsis}\n\n`;
          }
        }

        // Implementation plan
        out += `--- Implementation Plan ---\n`;
        out += `Based on the ticket details above, here's a suggested approach:\n\n`;

        // Determine ticket type for plan guidance
        const isBug = t.summary.toLowerCase().includes('bug') ||
                      t.summary.toLowerCase().includes('fix') ||
                      t.labels.some(l => l.toLowerCase() === 'bug');

        if (isBug) {
          out += `1. Reproduce the issue described in the ticket\n`;
          out += `2. Identify the root cause by analyzing the relevant code\n`;
          out += `3. Implement the fix with minimal changes\n`;
          out += `4. Add/update tests to cover the bug scenario\n`;
          out += `5. Verify the fix resolves the issue without side effects\n`;
        } else if (t.subtasks.length > 0) {
          out += `Follow the subtask breakdown:\n`;
          const pending = t.subtasks.filter(st => st.status !== 'Done');
          for (let i = 0; i < pending.length; i++) {
            out += `${i + 1}. ${pending[i].key}: ${pending[i].summary}\n`;
          }
          if (pending.length === 0) {
            out += `All subtasks are done! Review and close the parent ticket.\n`;
          }
        } else {
          out += `1. Analyze the requirements from the description\n`;
          out += `2. Identify affected files and components\n`;
          out += `3. Implement the changes step by step\n`;
          out += `4. Write tests for the new functionality\n`;
          out += `5. Review changes for quality and completeness\n`;
        }

        out += `\nShall I proceed with this plan? Say "yes" to start or suggest changes.\n`;

        return textResponse(out);
      }

      // ── set_preferences ─────────────────────────────────────────────────
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
          return textResponse(out);
        }

        savePreferences();
        return textResponse(`Preferences updated: ${changes.join(', ')}.\nThese will be remembered across sessions.`);
      }

      // ── run_skill ─────────────────────────────────────────────────────
      case "run_skill": {
        const { skill, args: skillArgs } = args;

        if (skill === "developer-mode") {
          config.developer_mode = !config.developer_mode;
          saveConfig();
          return textResponse(`Developer Mode: ${config.developer_mode ? "ENABLED" : "DISABLED"}`);
        }

        if (skill === "file-info") {
          const targetPath = skillArgs || ".";
          try {
            const stats = fs.statSync(targetPath);
            return textResponse(
              `File: "${targetPath}"\nType: ${stats.isDirectory() ? "Directory" : "File"}\nSize: ${stats.size} bytes\nModified: ${stats.mtime.toISOString()}`
            );
          } catch (e) {
            return errorResponse(`File error: ${e.message}`);
          }
        }

        return errorResponse(`Unknown skill: ${skill}`);
      }

      default:
        return errorResponse(`Unknown tool: ${name}`);
    }
  } catch (error) {
    Logger.error("Tool execution failed", { tool: name, error: error.message, code: error.code });
    const prefix = error.code ? `[${error.code}] ` : '';
    return errorResponse(`${prefix}${error.message}`);
  }
});

// ── Start ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.info("Server started", { version: CONST.VERSION });
}

main().catch((error) => {
  Logger.error("Fatal error", { error: error.message });
  process.exit(1);
});
