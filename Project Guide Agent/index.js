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
const { AppError, ConfigError, ValidationError, JiraNetworkError } = require("./errors");
const { validate, ticketKeySchema, dateSchema, serviceSchema, jiraUrlSchema, emailSchema } = require("./validators");
const JiraClient = require("./jira-client");
const OfflineQueue = require("./offline-queue");
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
          start_at: { type: "number", description: "Pagination offset (default: 0)" },
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
      name: "sync_offline_actions",
      description: "Retry queued Jira write actions that failed while offline.",
      inputSchema: { type: "object", properties: {} },
    },
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
      description: "Interactive ticket search with categorized output (Bugs/Stories/Tasks/Subtasks). IMPORTANT: Requires project, sprint, and assignee. If any are missing and no saved preferences exist, the tool will return a prompt asking for the missing details. Ask the user BEFORE calling this tool if they haven't specified these filters.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project key (REQUIRED — falls back to saved preference if omitted)" },
          sprint: { type: "string", description: "Sprint name (REQUIRED — falls back to saved preference if omitted)" },
          assignee: { type: "string", description: "Assignee (REQUIRED — falls back to saved preference if omitted, use 'currentUser' for the authenticated user)" },
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

    // ── Ticket Actions (Write) ──
    {
      name: "list_tickets",
      description: "List Jira tickets with flexible filters. Simpler alternative to smart_ticket_query — doesn't require project/sprint. Great for quick lookups like 'my tickets this week', 'all bugs', 'overdue tasks'.",
      inputSchema: {
        type: "object",
        properties: {
          assignee: { type: "string", description: "Filter by assignee ('me' or 'currentUser' for yourself, or a name)" },
          status: { type: "string", description: "Comma-separated statuses (e.g. 'To Do,In Progress')" },
          priority: { type: "string", description: "Comma-separated priorities (e.g. 'High,Highest')" },
          project: { type: "string", description: "Project key (e.g. PROJ)" },
          sprint: { type: "string", description: "Sprint name" },
          type: { type: "string", description: "Issue type filter (Bug, Story, Task, Epic)" },
          updated_since: { type: "string", description: "Updated since (e.g. '-7d', '-1w', 'startOfWeek()')" },
          due_this_week: { type: "boolean", description: "Only show tickets due this week" },
          include_done: { type: "boolean", description: "Include completed tickets (default: false)" },
          jql: { type: "string", description: "Raw JQL (overrides all other filters)" },
          max_results: { type: "number", description: "Max results to return (default: 50)" },
          start_at: { type: "number", description: "Pagination offset (default: 0)" },
        },
      },
    },
    {
      name: "transition_ticket",
      description: "Move a Jira ticket to a new status (e.g. 'To Do' → 'In Progress' → 'Done'). Shows available transitions if no target specified.",
      inputSchema: {
        type: "object",
        properties: {
          ticket_key: { type: "string", description: "Jira ticket key (e.g. PROJ-123)" },
          status: { type: "string", description: "Target status name (e.g. 'In Progress', 'Done'). Omit to see available transitions." },
        },
        required: ["ticket_key"],
      },
    },
    {
      name: "add_comment",
      description: "Add a comment to a Jira ticket. Use for progress updates, notes, or questions.",
      inputSchema: {
        type: "object",
        properties: {
          ticket_key: { type: "string", description: "Jira ticket key (e.g. PROJ-123)" },
          comment: { type: "string", description: "Comment text to add" },
        },
        required: ["ticket_key", "comment"],
      },
    },
    {
      name: "assign_ticket",
      description: "Assign a Jira ticket to a user. Use search_users to find the account ID first.",
      inputSchema: {
        type: "object",
        properties: {
          ticket_key: { type: "string", description: "Jira ticket key (e.g. PROJ-123)" },
          account_id: { type: "string", description: "Jira account ID of the assignee. Use search_users to find it." },
          assign_to_me: { type: "boolean", description: "Set true to assign to the currently authenticated user" },
        },
        required: ["ticket_key"],
      },
    },
    {
      name: "create_ticket",
      description: "Create a new Jira ticket. Returns the new ticket key.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project key (e.g. PROJ). Uses saved preference if omitted." },
          summary: { type: "string", description: "Ticket title/summary" },
          type: { type: "string", description: "Issue type: Bug, Story, Task, Sub-task, Epic (default: Task)" },
          description: { type: "string", description: "Detailed description" },
          priority: { type: "string", description: "Priority: Highest, High, Medium, Low, Lowest (default: Medium)" },
          assignee: { type: "string", description: "Account ID to assign to (omit for unassigned)" },
          labels: { type: "string", description: "Comma-separated labels" },
          due_date: { type: "string", description: "Due date (YYYY-MM-DD)" },
          parent: { type: "string", description: "Parent ticket key (for Sub-tasks)" },
          custom_fields: { type: "string", description: "JSON string of custom fields. Use get_create_meta first to discover required custom fields." },
        },
        required: ["summary"],
      },
    },
    {
      name: "get_create_meta",
      description: "Get required fields for creating a ticket (useful for custom fields).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project key" },
          type: { type: "string", description: "Issue type (e.g. Sub-task, Bug)" },
        },
        required: ["project", "type"]
      },
    },
    {
      name: "search_users",
      description: "Search for Jira users by name or email. Useful for finding account IDs for assignment.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (name or email)" },
        },
        required: ["query"],
      },
    },
    {
      name: "log_work",
      description: "Log time spent on a Jira ticket. Use Jira time format (e.g. '2h', '1d', '30m').",
      inputSchema: {
        type: "object",
        properties: {
          ticket_key: { type: "string", description: "Jira ticket key (e.g. PROJ-123)" },
          time_spent: { type: "string", description: "Time spent in Jira format (e.g. '2h', '1d 4h', '30m')" },
          comment: { type: "string", description: "Optional work description" },
        },
        required: ["ticket_key", "time_spent"],
      },
    },

    // ── Legacy ──
    {
      name: "run_skill",
      description: "Execute a skill: developer-mode, file-info, or route to other tools (list-projects, list-sprints, list-tickets, etc.).",
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

        const startAt = typeof args.start_at === 'number' ? args.start_at : 0;
        const result = await client.searchTickets(jqlString, [
          ...CONST.JIRA_DEFAULT_FIELDS, 'issuetype'
        ], CONST.JIRA_MAX_RESULTS, startAt);
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

      // ── sync_offline_actions ──────────────────────────────────────────
      case "sync_offline_actions": {
        const queue = OfflineQueue.getQueue();
        if (queue.length === 0) return textResponse("No offline actions in queue.");

        const client = getJiraClient();
        const results = [];
        const remainingQueue = [];
        let anyOfflineFailures = false;

        for (const action of queue) {
          try {
            switch (action.type) {
              case "transition_ticket":
                await client.transitionTicket(action.args.ticket_key, action.args.status);
                results.push(`✅ [${action.type}] ${action.args.ticket_key} transitioned to ${action.args.status}`);
                break;
              case "add_comment":
                await client.addComment(action.args.ticket_key, action.args.comment);
                results.push(`✅ [${action.type}] Added comment to ${action.args.ticket_key}`);
                break;
              case "assign_ticket":
                await client.assignTicket(action.args.ticket_key, action.args.account_id);
                results.push(`✅ [${action.type}] Assigned ${action.args.ticket_key} to ${action.args.account_id}`);
                break;
              case "create_ticket":
                await client.createTicket(action.args.project, action.args.summary, action.args.type, action.args.description, action.args.priority, action.args.extras);
                results.push(`✅ [${action.type}] Created ticket: ${action.args.summary}`);
                break;
              case "log_work":
                await client.logWork(action.args.ticket_key, action.args.time_spent, action.args.comment);
                results.push(`✅ [${action.type}] Logged ${action.args.time_spent} on ${action.args.ticket_key}`);
                break;
              default:
                results.push(`⚠️ Unknown action type: ${action.type}`);
            }
          } catch (err) {
            if (err instanceof JiraNetworkError) {
              anyOfflineFailures = true;
              remainingQueue.push(action);
              results.push(`❌ [${action.type}] Offline error: ${err.message}. Kept in queue.`);
            } else {
              results.push(`❌ [${action.type}] Failed permanently: ${err.message}`);
            }
          }
        }

        OfflineQueue.saveQueue(remainingQueue);
        
        let out = `Offline Sync Results:\n\n${results.join('\n')}`;
        if (anyOfflineFailures) out += `\n\nSome actions remain in the queue because you are still offline.`;
        return textResponse(out);
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

        let allSprints = [];
        let out = `Sprints for ${projectKey}:\n\n`;

        for (const board of boards) {
          let sprints;
          try {
            sprints = await client.getSprints(board.id);
          } catch (err) {
             Logger.warn(`Could not fetch sprints for board ${board.name}`, { error: err.message });
             continue;
          }

          if (sprints.length > 0) {
            out += `--- Board: ${board.name} ---\n`;
            for (const s of sprints) {
              const isCurrent = preferences.last_sprint === s.name ? ' (current)' : '';
              const active = s.state === 'active' ? ' [ACTIVE]' : '';
              out += `  ${s.name}${active}${isCurrent}\n`;
              if (s.startDate && s.endDate) {
                out += `    ${s.startDate.substring(0, 10)} to ${s.endDate.substring(0, 10)}\n`;
              }
              if (s.goal) out += `    Goal: ${s.goal}\n`;
              allSprints.push(s);
            }
            out += `\n`;
          }
        }

        if (allSprints.length === 0) {
          return textResponse(`No active or future sprints found for ${projectKey} across ${boards.length} board(s).`);
        }

        // Auto-save board ID for future use
        preferences.last_board_id = boards[0].id;
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
        const assignee = args.assignee || preferences.last_assignee;

        // If critical filters are missing, ask the user to specify them
        const missing = [];
        if (!project) missing.push('project (use list_projects to see available projects)');
        if (!sprint) missing.push('sprint (use list_sprints to see active sprints)');
        if (!assignee) missing.push('assignee (e.g. your Jira username, or "currentUser" for yourself)');

        if (missing.length > 0) {
          let out = `I need a few details before I can list tickets:\n\n`;
          for (const m of missing) {
            out += `  - ${m}\n`;
          }
          out += `\nPlease provide the missing details, or use set_preferences to save defaults for future queries.`;
          return textResponse(out);
        }

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

      // ── list_tickets ──────────────────────────────────────────────────
      case "list_tickets": {
        const client = getJiraClient();
        let jqlString;

        if (args.jql) {
          jqlString = args.jql;
        } else {
          const clauses = [];

          // Assignee
          const assignee = args.assignee || 'me';
          if (assignee === 'me' || assignee === 'currentUser') {
            clauses.push('assignee = currentUser()');
          } else {
            clauses.push(`assignee = "${assignee}"`);
          }

          // Project
          const project = args.project || preferences.last_project;
          if (project) clauses.push(`project = "${project}"`);

          // Sprint
          if (args.sprint) clauses.push(`sprint = "${args.sprint}"`);

          // Status
          if (args.status) {
            const statuses = args.status.split(",").map(s => `"${s.trim()}"`).join(",");
            clauses.push(`status in (${statuses})`);
          }

          // Exclude done by default
          if (!args.include_done && !args.status) {
            clauses.push('statusCategory != Done');
          }

          // Priority
          if (args.priority) {
            const priorities = args.priority.split(",").map(p => `"${p.trim()}"`).join(",");
            clauses.push(`priority in (${priorities})`);
          }

          // Issue type
          if (args.type) {
            clauses.push(`issuetype = "${args.type}"`);
          }

          // Updated since
          if (args.updated_since) {
            clauses.push(`updated >= "${args.updated_since}"`);
          }

          // Due this week
          if (args.due_this_week) {
            clauses.push('duedate >= startOfWeek() AND duedate <= endOfWeek()');
          }

          jqlString = clauses.join(' AND ') + ' ORDER BY priority DESC, duedate ASC';
        }

        const maxResults = args.max_results || CONST.JIRA_MAX_RESULTS;
        const startAt = typeof args.start_at === 'number' ? args.start_at : 0;
        const result = await client.searchTickets(jqlString, [
          ...CONST.JIRA_DEFAULT_FIELDS, 'issuetype'
        ], maxResults, startAt);
        const tickets = result.tickets;

        if (tickets.length === 0) {
          return textResponse(`No tickets found.\nQuery: ${jqlString}`);
        }

        const now = new Date();
        let out = `Prioritized Ticket List:\n\n`;

        // Sort by: overdue first, then priority, then due date
        const priorityOrder = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };
        const sorted = [...tickets].sort((a, b) => {
          const aOverdue = a.dueDate && new Date(a.dueDate) < now && a.statusCategory !== 'Done';
          const bOverdue = b.dueDate && new Date(b.dueDate) < now && b.statusCategory !== 'Done';
          if (aOverdue && !bOverdue) return -1;
          if (!aOverdue && bOverdue) return 1;
          const pa = priorityOrder[a.priority] ?? 2;
          const pb = priorityOrder[b.priority] ?? 2;
          if (pa !== pb) return pa - pb;
          if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return 0;
        });

        for (const t of sorted) {
          const dueDate = t.dueDate ? new Date(t.dueDate) : null;
          const overdue = dueDate && dueDate < now && t.statusCategory !== 'Done';
          const blocked = isTicketBlocked(t);
          const tags = [];
          if (overdue) tags.push('OVERDUE');
          if (blocked) tags.push('BLOCKED');
          if (t.status === 'In Progress') tags.push('IN PROGRESS');

          const dueFmt = t.dueDate ? ` (Due: ${t.dueDate})` : '';
          const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';

          out += `- [${t.priority}] ${t.key}: ${t.summary}${dueFmt}${tagStr} via Jira\n`;
          out += `   Status: ${t.status} | Type: ${t.issueType || 'Task'} | Assignee: ${t.assignee}\n`;
        }

        out += `\nShowing ${tickets.length}`;
        if (result.total > tickets.length) out += ` of ${result.total}`;
        out += ` ticket(s).\n`;

        // Quick insights
        const overdue = sorted.filter(t => t.dueDate && new Date(t.dueDate) < now && t.statusCategory !== 'Done');
        const blockedCount = sorted.filter(t => isTicketBlocked(t)).length;
        if (overdue.length > 0 || blockedCount > 0) {
          out += `\nAlerts:`;
          if (overdue.length > 0) out += ` ${overdue.length} overdue`;
          if (blockedCount > 0) out += ` ${blockedCount} blocked`;
          out += `\n`;
        }

        return textResponse(out);
      }

      // ── transition_ticket ──────────────────────────────────────────────
      case "transition_ticket": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return errorResponse(keyCheck.error);

        const client = getJiraClient();

        // If no status given, show available transitions
        if (!args.status) {
          try {
            const transitions = await client.getTransitions(args.ticket_key);
            if (transitions.length === 0) {
              return textResponse(`No transitions available for ${args.ticket_key}. The ticket may already be in a final state.`);
            }
            let out = `Available transitions for ${args.ticket_key}:\n\n`;
            for (const t of transitions) {
              out += `  - "${t.name}" → ${t.to}\n`;
            }
            out += `\nUse transition_ticket with the status name to move the ticket.\n`;
            return textResponse(out);
          } catch (err) {
            if (err instanceof JiraNetworkError) {
              return textResponse(`You are offline. Cannot fetch available transitions for ${args.ticket_key}. Specify the target status manually to queue the action.`);
            }
            throw err;
          }
        }

        try {
          const result = await client.transitionTicket(args.ticket_key, args.status);
          return textResponse(`${args.ticket_key} moved to "${result.to}" (transition: ${result.transitionName})`);
        } catch (err) {
          if (err instanceof JiraNetworkError) {
            OfflineQueue.addAction({ type: "transition_ticket", args });
            return textResponse(`You are offline. Transition to "${args.status}" for ${args.ticket_key} has been queued and will be synced later.`);
          }
          throw err;
        }
      }

      // ── add_comment ────────────────────────────────────────────────────
      case "add_comment": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return errorResponse(keyCheck.error);
        if (!args.comment || !args.comment.trim()) return errorResponse("Comment text is required.");

        const client = getJiraClient();
        try {
          const result = await client.addComment(args.ticket_key, args.comment);
          return textResponse(`Comment added to ${args.ticket_key} by ${result.author} at ${result.created}`);
        } catch (err) {
          if (err instanceof JiraNetworkError) {
            OfflineQueue.addAction({ type: "add_comment", args });
            return textResponse(`You are offline. Your comment on ${args.ticket_key} has been queued and will be synced later.`);
          }
          throw err;
        }
      }

      // ── assign_ticket ──────────────────────────────────────────────────
      case "assign_ticket": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return errorResponse(keyCheck.error);

        const client = getJiraClient();

        let accountId = args.account_id || null;

        // If assign_to_me, get current user's account ID
        if (args.assign_to_me) {
          try {
            const me = await client.testConnection();
            accountId = me.accountId;
          } catch (err) {
            if (err instanceof JiraNetworkError) {
              return textResponse("You are offline. Cannot fetch your account ID for 'assign_to_me'. Please provide account_id manually to queue the action.");
            }
            throw err;
          }
        }

        if (!accountId && !args.assign_to_me) {
          return errorResponse("Provide account_id or set assign_to_me=true. Use search_users to find account IDs.");
        }

        try {
          const result = await client.assignTicket(args.ticket_key, accountId);
          return textResponse(`${args.ticket_key} assigned to ${result.assignedTo}`);
        } catch (err) {
          if (err instanceof JiraNetworkError) {
            OfflineQueue.addAction({ type: "assign_ticket", args: { ticket_key: args.ticket_key, account_id: accountId } });
            return textResponse(`You are offline. Assignment of ${args.ticket_key} has been queued and will be synced later.`);
          }
          throw err;
        }
      }

      // ── create_ticket ──────────────────────────────────────────────────
      case "create_ticket": {
        if (!args.summary || !args.summary.trim()) return errorResponse("Summary is required.");

        const project = args.project || preferences.last_project;
        if (!project) return errorResponse("Project key is required. Use list_projects to see available projects, or set_preferences to save a default.");

        const client = getJiraClient();
        const extras = {};
        if (args.assignee) extras.assignee = args.assignee;
        if (args.labels) extras.labels = args.labels.split(",").map(l => l.trim());
        if (args.due_date) extras.duedate = args.due_date;
        if (args.parent) extras.parent = args.parent;
        if (args.custom_fields) {
          try {
            extras.customFields = JSON.parse(args.custom_fields);
          } catch (e) {
            return errorResponse(`Invalid custom_fields JSON: ${e.message}`);
          }
        }

        try {
          const result = await client.createTicket(
            project,
            args.summary,
            args.type || 'Task',
            args.description || '',
            args.priority || 'Medium',
            extras
          );

          let out = `Ticket created: ${result.key}\n`;
          out += `Project: ${project} | Type: ${args.type || 'Task'} | Priority: ${args.priority || 'Medium'}\n`;
          out += `Summary: ${args.summary}\n`;
          if (args.due_date) out += `Due: ${args.due_date}\n`;
          out += `\nView in Jira: ${config.jira.url || process.env.JIRA_URL}/browse/${result.key}`;
          return textResponse(out);
        } catch (err) {
          if (err instanceof JiraNetworkError) {
            OfflineQueue.addAction({ type: "create_ticket", args: { project, summary: args.summary, type: args.type || 'Task', description: args.description || '', priority: args.priority || 'Medium', extras } });
            return textResponse(`You are offline. Creation of ticket "${args.summary}" has been queued and will be synced later.`);
          }
          if (err.name === 'JiraConnectionError' && err.details?.status === 400) {
            const body = err.details?.body || '';
            return errorResponse(`Failed to create ticket (400 Bad Request). This usually means required fields are missing.\nError from Jira: ${body}\n\nTip: Use the 'get_create_meta' tool to find required custom fields for '${args.type || 'Task'}', then pass them as a JSON string in the 'custom_fields' property.`);
          }
          throw err;
        }
      }

      // ── get_create_meta ──────────────────────────────────────────────────
      case "get_create_meta": {
        const client = getJiraClient();
        const data = await client.getCreateMeta(args.project, args.type);
        const proj = data.projects?.[0];
        if (!proj) return errorResponse(`Project ${args.project} not found or no permissions.`);
        const typeMeta = proj.issuetypes?.find(it => it.name === args.type);
        if (!typeMeta) return errorResponse(`Issue type ${args.type} not found in project ${args.project}. Available: ${proj.issuetypes.map(it => it.name).join(', ')}`);
        
        const fields = typeMeta.fields;
        let out = `Fields for ${args.type} in ${args.project}:\n\n`;
        const required = [];
        const optional = [];
        for (const [key, val] of Object.entries(fields)) {
          const schema = val.schema ? `${val.schema.type}${val.schema.custom ? ' (custom)' : ''}` : 'unknown';
          const info = `  - ${key} ("${val.name}"): ${schema}`;
          if (val.required) required.push(info);
          else optional.push(info);
        }
        out += `--- Required Fields ---\n`;
        out += required.length > 0 ? required.join('\n') : "  (none)";
        out += `\n\n--- Optional Fields ---\n`;
        out += optional.length > 0 ? optional.join('\n') : "  (none)";
        
        return textResponse(out);
      }

      // ── search_users ───────────────────────────────────────────────────
      case "search_users": {
        if (!args.query || !args.query.trim()) return errorResponse("Search query is required.");

        const client = getJiraClient();
        const users = await client.searchUsers(args.query);

        if (users.length === 0) {
          return textResponse(`No users found matching "${args.query}".`);
        }

        let out = `Users matching "${args.query}":\n\n`;
        for (const u of users) {
          out += `  - ${u.displayName}`;
          if (u.email) out += ` (${u.email})`;
          out += `\n    Account ID: ${u.accountId}`;
          if (!u.active) out += ` [INACTIVE]`;
          out += `\n`;
        }
        return textResponse(out);
      }

      // ── log_work ───────────────────────────────────────────────────────
      case "log_work": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return errorResponse(keyCheck.error);
        if (!args.time_spent || !args.time_spent.trim()) return errorResponse("time_spent is required (e.g. '2h', '1d', '30m').");

        const client = getJiraClient();
        try {
          const result = await client.logWork(args.ticket_key, args.time_spent, args.comment || '');
          return textResponse(`Logged ${result.timeSpent} on ${args.ticket_key} by ${result.author}`);
        } catch (err) {
          if (err instanceof JiraNetworkError) {
            OfflineQueue.addAction({ type: "log_work", args });
            return textResponse(`You are offline. Logging ${args.time_spent} on ${args.ticket_key} has been queued and will be synced later.`);
          }
          throw err;
        }
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

        // Smart routing: map common skill names to actual tools
        const skillRoutes = {
          'list-projects': 'list_projects',
          'list_projects': 'list_projects',
          'projects': 'list_projects',
          'jira-projects': 'list_projects',
          'list-sprints': 'list_sprints',
          'list_sprints': 'list_sprints',
          'sprints': 'list_sprints',
          'list-tickets': 'list_tickets',
          'list_tickets': 'list_tickets',
          'tickets': 'list_tickets',
          'my-tickets': 'list_tickets',
          'workload': 'analyze_workload',
          'analyze-workload': 'analyze_workload',
          'standup': 'morning_standup',
          'morning': 'morning_standup',
          'eod': 'end_of_day_report',
          'health': 'health_check',
          'health-check': 'health_check',
          'suggestions': 'get_ticket_suggestions',
          'suggest': 'get_ticket_suggestions',
          'status': 'get_setup_status',
          'setup': 'get_setup_status',
          'preferences': 'set_preferences',
          'search-users': 'search_users',
          'users': 'search_users',
        };

        const normalizedSkill = skill.toLowerCase().trim();
        const routedTool = skillRoutes[normalizedSkill];

        if (routedTool) {
          return textResponse(
            `The skill "${skill}" maps to the tool "${routedTool}". Please call "${routedTool}" directly instead.\n\n` +
            `Hint: Use the "${routedTool}" tool with appropriate parameters.`
          );
        }

        // If still not found, provide helpful guidance
        const availableSkills = ['developer-mode', 'file-info'];
        const availableTools = [
          'list_projects', 'list_sprints', 'list_tickets', 'smart_ticket_query',
          'get_ticket_details', 'get_ticket_suggestions', 'select_ticket',
          'transition_ticket', 'add_comment', 'assign_ticket', 'create_ticket',
          'search_users', 'log_work', 'analyze_workload', 'morning_standup',
          'end_of_day_report', 'health_check', 'set_preferences',
        ];
        return errorResponse(
          `Unknown skill: "${skill}".\n\n` +
          `Available skills: ${availableSkills.join(', ')}\n` +
          `Available tools: ${availableTools.join(', ')}\n\n` +
          `Try calling the appropriate tool directly instead of using run_skill.`
        );
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
