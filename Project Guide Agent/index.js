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
        const status = {
          version: CONST.VERSION,
          jira: {
            connected: config.jira.connected || !!process.env.JIRA_URL,
            url: config.jira.url || process.env.JIRA_URL || null,
            email: config.jira.email || process.env.JIRA_EMAIL || null,
            token: maskToken(config.jira.token || process.env.JIRA_TOKEN),
          },
          github: {
            connected: config.github.connected || !!process.env.GITHUB_TOKEN,
            user: config.github.user || process.env.GITHUB_USER || null,
          },
          reports: {
            directory: ReportManager.REPORTS_DIR,
            count: ReportManager.listReports().length,
          },
          developer_mode: config.developer_mode,
        };
        return textResponse(JSON.stringify(status, null, 2));
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
        return textResponse(`${service} configured successfully.`);
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

        const result = await client.searchTickets(jqlString);
        const tickets = result.tickets;

        let out = `Found ${tickets.length} ticket(s)`;
        if (result.total > tickets.length) {
          out += ` (showing ${tickets.length} of ${result.total})`;
        }
        out += `\n\n`;

        for (const t of tickets) {
          out += `[${t.priority}] ${t.key}: ${t.summary}\n`;
          out += `   Status: ${t.status} | Assignee: ${t.assignee}`;
          if (t.dueDate) out += ` | Due: ${t.dueDate}`;
          if (t.labels.length > 0) out += ` | Labels: ${t.labels.join(", ")}`;
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
