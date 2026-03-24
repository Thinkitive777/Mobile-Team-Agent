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

// Import helpers
const JiraClient = require("./jira-client.js");
const GitUtils = require("./git-utils.js");
const ReportManager = require("./report-manager.js");

const CONFIG_DIR = path.join(os.homedir(), ".projectguide-agent");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Load or initialize config
let config = {
  jira: { connected: false, url: null, email: null, token: null },
  github: { connected: false, token: null, user: null, repo: null },
  developer_mode: false,
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch (e) {
    console.error("Error loading config:", e);
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function maskToken(token) {
  if (!token || token === "********") return "tok_****";
  if (token.length <= 4) return "tok_****";
  return `tok_****${token.slice(-4)}`;
}

function getJiraClient() {
  const url = process.env.JIRA_URL || config.jira.url;
  const email = process.env.JIRA_EMAIL || config.jira.email;
  const token = process.env.JIRA_TOKEN || config.jira.token;

  if (!url || !email || !token) {
    throw new Error("Jira not configured. Please provide JIRA_URL, JIRA_EMAIL, and JIRA_TOKEN.");
  }

  return new JiraClient(url, email, token);
}

const server = new Server(
  {
    name: "projectguide-agent",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Setup and status
      {
        name: "get_setup_status",
        description: "Check connection status for Jira and GitHub. Suggests next setup steps.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "configure_service",
        description: "Configure Jira or GitHub. For Jira: requires url, email, token. For GitHub: requires token, user, repo.",
        inputSchema: {
          type: "object",
          properties: {
            service: { type: "string", enum: ["jira", "github"] },
            url: { type: "string", description: "Jira instance URL (Jira only)" },
            email: { type: "string", description: "Jira email address (Jira only)" },
            token: { type: "string", description: "API token or access token" },
            user: { type: "string", description: "GitHub username (GitHub only)" },
            repo: { type: "string", description: "GitHub repo path like owner/repo (GitHub only)" },
          },
          required: ["service", "token"],
        },
      },

      // Jira tools
      {
        name: "jira_connection_test",
        description: "Test Jira connection by fetching current user info.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "fetch_jira_tickets",
        description: "Fetch Jira tickets with filters. Supports: assignee, status, sprint, updated date range.",
        inputSchema: {
          type: "object",
          properties: {
            assignee: { type: "string", description: "Filter by assignee (email or 'currentUser')" },
            status: { type: "string", description: "Comma-separated statuses (e.g., 'To Do,In Progress,Done')" },
            sprint: { type: "string", description: "Sprint name to filter by" },
            updated_since: { type: "string", description: "Filter by updated date (e.g., '-7d', '2026-03-24')" },
          },
        },
      },
      {
        name: "get_ticket_details",
        description: "Get full details of a Jira ticket including comments, subtasks, and history.",
        inputSchema: {
          type: "object",
          properties: {
            ticket_key: { type: "string", description: "Jira ticket key (e.g., 'PROJ-123')" },
          },
          required: ["ticket_key"],
        },
      },
      {
        name: "analyze_workload",
        description: "Analyze all assigned tickets and categorize them (Done/In Progress/Not Started/Blocked/Overdue).",
        inputSchema: { type: "object", properties: {} },
      },

      // Git tools
      {
        name: "get_recent_commits",
        description: "Fetch recent commits from git (default: last 48 hours). Extracts linked Jira tickets.",
        inputSchema: {
          type: "object",
          properties: {
            since: { type: "string", description: "Time period (e.g., '48 hours ago', '7 days ago')" },
          },
        },
      },

      // Automation tools
      {
        name: "morning_standup",
        description: "Generate morning standup: fetches pending/in-progress tickets and recent commits, then creates a daily plan.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "end_of_day_report",
        description: "Generate and save end-of-day report. Saves to ~/.projectguide-agent/daily-reports/YYYY-MM-DD.md",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date for report (default: today). Format: YYYY-MM-DD" },
          },
        },
      },

      // Report tools
      {
        name: "get_daily_report",
        description: "Retrieve a saved daily report by date.",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Report date in YYYY-MM-DD format" },
          },
          required: ["date"],
        },
      },
      {
        name: "list_daily_reports",
        description: "List all saved daily reports, optionally filtered by date range.",
        inputSchema: {
          type: "object",
          properties: {
            start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
            end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
          },
        },
      },

      // Legacy tools (for backward compatibility)
      {
        name: "run_skill",
        description: "Execute a specialized skill (e.g., developer-mode, file-info).",
        inputSchema: {
          type: "object",
          properties: {
            skill: { type: "string", description: "The skill to run" },
            args: { type: "string", description: "Arguments for the skill" },
          },
          required: ["skill"],
        },
      },
      {
        name: "invoke_projectguide",
        description: "Activate the Project Guide Agent. Use this to start fresh.",
        inputSchema: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Reason for invocation" },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "invoke_projectguide": {
        const missing = [];
        if (!config.jira.connected && !process.env.JIRA_URL) missing.push("Jira");
        if (!config.github.connected && !process.env.GITHUB_TOKEN) missing.push("GitHub");

        let mission = "🚀 Project Guide Agent v2.0 ACTIVATED.\n\n";

        if (missing.length > 0) {
          mission += `📋 Setup Required: ${missing.join(", ")} not yet connected.\n`;
          mission += `Use 'configure_service' to set up these services, or set env vars:\n`;
          if (missing.includes("Jira")) mission += `  - JIRA_URL, JIRA_EMAIL, JIRA_TOKEN\n`;
          if (missing.includes("GitHub")) mission += `  - GITHUB_TOKEN, GITHUB_USER, GITHUB_REPO\n`;
        } else {
          mission += "✅ All services connected! Ready to go.\n";
          mission += "Try 'morning_standup' to start your day or 'analyze_workload' to see your tasks.";
        }

        return { content: [{ type: "text", text: mission }] };
      }

      case "get_setup_status": {
        const missing = [];
        if (!config.jira.connected && !process.env.JIRA_URL) missing.push("Jira");
        if (!config.github.connected && !process.env.GITHUB_TOKEN) missing.push("GitHub");

        const status = {
          version: "2.0.0",
          jira: {
            connected: config.jira.connected || !!process.env.JIRA_URL,
            url: config.jira.url || process.env.JIRA_URL || null,
            token: maskToken(config.jira.token || process.env.JIRA_TOKEN),
          },
          github: {
            connected: config.github.connected || !!process.env.GITHUB_TOKEN,
            user: config.github.user || process.env.GITHUB_USER || null,
            token: maskToken(config.github.token || process.env.GITHUB_TOKEN),
          },
          missing_services: missing,
          suggestion: missing.length > 0
            ? `Setup ${missing[0]} to unlock more features`
            : "All systems ready!",
        };

        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      }

      case "configure_service": {
        const { service, url, email, token, user, repo } = args;

        if (service === "jira") {
          if (!url || !email || !token) {
            return {
              content: [{ type: "text", text: "Error: Jira requires url, email, and token" }],
              isError: true,
            };
          }
          config.jira = { connected: true, url, email, token };
        } else if (service === "github") {
          if (!token) {
            return { content: [{ type: "text", text: "Error: GitHub requires token" }], isError: true };
          }
          config.github = { connected: true, token, user: user || "unknown", repo: repo || null };
        } else {
          return { content: [{ type: "text", text: `Unknown service: ${service}` }], isError: true };
        }

        saveConfig();
        return { content: [{ type: "text", text: `✅ ${service} configured successfully` }] };
      }

      case "jira_connection_test": {
        try {
          const client = getJiraClient();
          const result = await client.testConnection();
          return {
            content: [
              {
                type: "text",
                text: `✅ Jira connection successful!\nUser: ${result.user}\nEmail: ${result.email}`,
              },
            ],
          };
        } catch (error) {
          return { content: [{ type: "text", text: `❌ ${error.message}` }], isError: true };
        }
      }

      case "fetch_jira_tickets": {
        try {
          const { assignee, status, sprint, updated_since } = args;
          const client = getJiraClient();

          let jql = [];
          if (assignee) {
            jql.push(`assignee = ${assignee === "currentUser" ? "currentUser()" : `"${assignee}"`}`);
          }
          if (status) {
            const statuses = status.split(",").map(s => `"${s.trim()}"`).join(",");
            jql.push(`status in (${statuses})`);
          }
          if (sprint) {
            jql.push(`sprint = "${sprint}"`);
          }
          if (updated_since) {
            jql.push(`updated >= ${updated_since}`);
          }

          const jqlString = jql.length > 0 ? jql.join(" AND ") : "ORDER BY updated DESC";
          const tickets = await client.searchTickets(jqlString);

          let output = `📋 Found ${tickets.length} ticket(s)\n\n`;
          tickets.forEach(t => {
            output += `[${t.priority}] ${t.key}: ${t.summary}\n`;
            output += `   Status: ${t.status} | Assignee: ${t.assignee}\n`;
            if (t.dueDate) output += `   Due: ${t.dueDate}\n`;
            output += `\n`;
          });

          return { content: [{ type: "text", text: output }] };
        } catch (error) {
          return { content: [{ type: "text", text: `❌ ${error.message}` }], isError: true };
        }
      }

      case "get_ticket_details": {
        try {
          const { ticket_key } = args;
          if (!ticket_key) {
            return { content: [{ type: "text", text: "Error: ticket_key required" }], isError: true };
          }

          const client = getJiraClient();
          const ticket = await client.getTicket(ticket_key);

          let output = `📄 ${ticket.key}: ${ticket.summary}\n\n`;
          output += `Status: ${ticket.status} | Priority: ${ticket.priority}\n`;
          output += `Assignee: ${ticket.assignee}\n`;
          if (ticket.dueDate) output += `Due: ${ticket.dueDate}\n`;
          output += `\nDescription:\n${ticket.description}\n`;

          if (ticket.subtasks.length > 0) {
            output += `\n📌 Subtasks:\n`;
            ticket.subtasks.forEach(st => {
              output += `  - ${st.key}: ${st.summary} [${st.status}]\n`;
            });
          }

          if (ticket.comments.length > 0) {
            output += `\n💬 Latest Comments:\n`;
            ticket.comments.slice(-3).forEach(c => {
              output += `  ${c.author}: ${c.body.substring(0, 100)}...\n`;
            });
          }

          return { content: [{ type: "text", text: output }] };
        } catch (error) {
          return { content: [{ type: "text", text: `❌ ${error.message}` }], isError: true };
        }
      }

      case "analyze_workload": {
        try {
          const client = getJiraClient();

          // Fetch all assigned tickets
          const allTickets = await client.searchTickets('assignee = currentUser() ORDER BY priority DESC, duedate ASC');

          // Categorize tickets
          const categorized = {
            done: [],
            inProgress: [],
            notStarted: [],
            blocked: [],
            overdue: [],
          };

          const now = new Date();

          allTickets.forEach(ticket => {
            const dueDate = ticket.dueDate ? new Date(ticket.dueDate) : null;
            const isOverdue = dueDate && dueDate < now && ticket.status !== "Done";

            if (ticket.status === "Done") {
              categorized.done.push(ticket);
            } else if (ticket.status === "In Progress") {
              categorized.inProgress.push(ticket);
            } else if (isOverdue) {
              categorized.overdue.push(ticket);
            } else if (ticket.summary.includes("BLOCKED") || ticket.summary.includes("blocked")) {
              categorized.blocked.push(ticket);
            } else {
              categorized.notStarted.push(ticket);
            }
          });

          let output = `📊 Workload Analysis\n`;
          output += `Total: ${allTickets.length} ticket(s)\n\n`;

          output += `✅ Done (${categorized.done.length}): ${categorized.done.map(t => t.key).join(", ") || "None"}\n`;
          output += `🚧 In Progress (${categorized.inProgress.length}): ${categorized.inProgress.map(t => t.key).join(", ") || "None"}\n`;
          output += `📌 Not Started (${categorized.notStarted.length}): ${categorized.notStarted.map(t => t.key).join(", ") || "None"}\n`;
          output += `🚫 Blocked (${categorized.blocked.length}): ${categorized.blocked.map(t => t.key).join(", ") || "None"}\n`;
          output += `⏰ Overdue (${categorized.overdue.length}): ${categorized.overdue.map(t => t.key).join(", ") || "None"}\n`;

          if (categorized.inProgress.length > 0) {
            output += `\n🎯 Recommended Next Step:\n`;
            const next = categorized.inProgress[0];
            output += `${next.key}: ${next.summary}\n`;
          }

          return { content: [{ type: "text", text: output }] };
        } catch (error) {
          return { content: [{ type: "text", text: `❌ ${error.message}` }], isError: true };
        }
      }

      case "get_recent_commits": {
        try {
          const { since = "48 hours ago" } = args;
          const repoPath = process.env.GITHUB_REPO ? process.cwd() : process.cwd();
          const commits = await GitUtils.getRecentCommits(since, repoPath);

          if (commits.length === 0) {
            return { content: [{ type: "text", text: "No commits found in the specified period." }] };
          }

          let output = `📝 Recent Commits (${since})\n\n`;
          commits.forEach(c => {
            output += `${c.hash}: ${c.message}\n`;
            if (c.ticketIds.length > 0) {
              output += `   Tickets: ${c.ticketIds.join(", ")}\n`;
            }
            output += `   By: ${c.author} on ${c.datetime}\n\n`;
          });

          return { content: [{ type: "text", text: output }] };
        } catch (error) {
          return { content: [{ type: "text", text: `❌ ${error.message}` }], isError: true };
        }
      }

      case "morning_standup": {
        try {
          const client = getJiraClient();

          // Get pending and in-progress tickets
          const tickets = await client.searchTickets(
            'assignee = currentUser() AND status != Done ORDER BY priority DESC, duedate ASC'
          );

          // Get recent commits
          const commits = await GitUtils.getRecentCommits("48 hours ago");

          let output = `🌅 Morning Standup\n`;
          output += `📅 ${new Date().toLocaleDateString()}\n\n`;

          // Tickets summary
          output += `📊 Your Workload:\n`;
          output += `Total pending: ${tickets.length} ticket(s)\n\n`;

          // High priority tickets
          const highPriority = tickets.filter(t => t.priority === "Highest" || t.priority === "High");
          if (highPriority.length > 0) {
            output += `🔴 High Priority:\n`;
            highPriority.forEach(t => {
              output += `  - ${t.key}: ${t.summary}\n`;
              if (t.dueDate) output += `    Due: ${t.dueDate}\n`;
            });
            output += `\n`;
          }

          // In progress tickets
          const inProgress = tickets.filter(t => t.status === "In Progress");
          if (inProgress.length > 0) {
            output += `🚧 Currently Working On:\n`;
            inProgress.forEach(t => {
              output += `  - ${t.key}: ${t.summary}\n`;
            });
            output += `\n`;
          }

          // Recent commits
          if (commits.length > 0) {
            output += `✅ Recent Work:\n`;
            output += `${commits.length} commit(s) in last 48 hours\n`;
            commits.slice(0, 3).forEach(c => {
              output += `  - ${c.hash}: ${c.message}\n`;
            });
            output += `\n`;
          }

          // Daily plan
          output += `📋 Suggested Daily Plan:\n`;
          if (inProgress.length > 0) {
            output += `1. Continue: ${inProgress[0].key}\n`;
            if (highPriority.length > 0 && !inProgress.includes(highPriority[0])) {
              output += `2. Focus on: ${highPriority[0].key}\n`;
            }
          } else if (highPriority.length > 0) {
            output += `1. Start: ${highPriority[0].key}\n`;
          }

          return { content: [{ type: "text", text: output }] };
        } catch (error) {
          return { content: [{ type: "text", text: `❌ ${error.message}` }], isError: true };
        }
      }

      case "end_of_day_report": {
        try {
          const { date } = args;
          const reportDate = date || ReportManager.formatDate();

          // Get today's commits
          const commits = await GitUtils.getTodayCommits();

          // Get today's tickets activity
          const client = getJiraClient();
          const tickets = await client.searchTickets(
            `assignee = currentUser() AND updated >= "${reportDate}" ORDER BY updated DESC`
          );

          // Categorize tickets
          const completed = tickets.filter(t => t.status === "Done");
          const inProgress = tickets.filter(t => t.status === "In Progress");

          // Generate report
          const report = ReportManager.generateDailyReport(
            reportDate,
            completed.map(t => `${t.key}: ${t.summary}`),
            inProgress.map(t => `${t.key}: ${t.summary}`),
            commits,
            [],
            `${commits.length} commit(s) made. ${completed.length} ticket(s) completed.`
          );

          // Save report
          const reportPath = ReportManager.saveReport(reportDate, report);

          let output = `✅ Daily Report Generated\n\n`;
          output += `📁 Saved to: ${reportPath}\n\n`;
          output += `📊 Summary:\n`;
          output += `- ${commits.length} commit(s)\n`;
          output += `- ${completed.length} completed ticket(s)\n`;
          output += `- ${inProgress.length} in-progress ticket(s)\n`;

          return { content: [{ type: "text", text: output }] };
        } catch (error) {
          return { content: [{ type: "text", text: `❌ ${error.message}` }], isError: true };
        }
      }

      case "get_daily_report": {
        try {
          const { date } = args;
          if (!date) {
            return { content: [{ type: "text", text: "Error: date required (YYYY-MM-DD)" }], isError: true };
          }

          const content = ReportManager.getReport(date);
          return { content: [{ type: "text", text: content }] };
        } catch (error) {
          return { content: [{ type: "text", text: `❌ ${error.message}` }], isError: true };
        }
      }

      case "list_daily_reports": {
        try {
          const { start_date, end_date } = args;
          const reports = ReportManager.listReports(start_date, end_date);

          if (reports.length === 0) {
            return { content: [{ type: "text", text: "No daily reports found." }] };
          }

          let output = `📋 Daily Reports\n\n`;
          reports.forEach(r => {
            const stats = fs.readFileSync(r.path, 'utf-8');
            const lines = stats.split('\n').length;
            output += `- ${r.date} (${lines} lines)\n`;
          });

          return { content: [{ type: "text", text: output }] };
        } catch (error) {
          return { content: [{ type: "text", text: `❌ ${error.message}` }], isError: true };
        }
      }

      case "run_skill": {
        const { skill, args: skillArgs } = args;

        if (skill === "developer-mode") {
          config.developer_mode = !config.developer_mode;
          saveConfig();
          return {
            content: [
              {
                type: "text",
                text: `Developer Mode is now ${config.developer_mode ? "ENABLED" : "DISABLED"}`,
              },
            ],
          };
        }

        if (skill === "file-info") {
          const targetPath = skillArgs || ".";
          try {
            const stats = fs.statSync(targetPath);
            return {
              content: [
                {
                  type: "text",
                  text: `📄 File Info for "${targetPath}":\n- Type: ${stats.isDirectory() ? "Directory" : "File"}\n- Size: ${stats.size} bytes\n- Modified: ${stats.mtime}`,
                },
              ],
            };
          } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
          }
        }

        return { content: [{ type: "text", text: `Unknown skill: ${skill}` }], isError: true };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Project Guide Agent v2.0.0 running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
