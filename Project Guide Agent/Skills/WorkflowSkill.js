const BaseSkill = require("./Core/BaseSkill");
const { validate, dateSchema } = require("../Utils/validators");
const CONST = require("../Constants/constants");
const ReportManager = require("../Services/report-manager");
const GitUtils = require("../Utils/git-utils");

class WorkflowSkill extends BaseSkill {
  constructor() {
    super();
    this.name = "WorkflowSkill";
  }

  getTools() {
    return [
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
      }
    ];
  }

  textResponse(msg) {
    return { content: [{ type: "text", text: msg }] };
  }

  errorResponse(msg) {
    return { content: [{ type: "text", text: msg }], isError: true };
  }

  async handleTool(name, args, context) {
    const { getJiraClient, getRepoPath, preferences } = context;

    switch (name) {
      case "morning_standup": {
        let tickets = [];
        let jiraError = null;
        let gitError = null;
        let totalTickets = 0;

        try {
          const client = getJiraClient();
          const result = await client.searchTickets(
            "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, duedate ASC"
          );
          tickets = result.tickets;
          totalTickets = result.tickets.length + (!result.isLast ? 1 : 0);
        } catch (err) {
          jiraError = err.message;
        }

        let commits = [];
        try {
          commits = await GitUtils.getRecentCommits(CONST.STANDUP_COMMIT_WINDOW, getRepoPath());
        } catch (err) {
          gitError = err.message;
        }

        const carryForward = ReportManager.getYesterdayCarryForward();
        const now = new Date();
        let out = `Morning Standup — ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n\n`;

        if (jiraError) out += `[Jira unavailable: ${jiraError}]\n\n`;
        if (gitError) out += `[Git unavailable: ${gitError}]\n\n`;

        if (tickets.length > 0) {
          const highPriority = tickets.filter(t => t.priority === "Highest" || t.priority === "High");
          const inProgress = tickets.filter(t => t.status === "In Progress");
          const overdue = tickets.filter(t => t.dueDate && new Date(t.dueDate) < now);

          out += `Workload: ${tickets.length} pending`;
          if (totalTickets > tickets.length) out += ` (${totalTickets} total)`;
          out += `\n\n`;

          if (overdue.length > 0) {
            out += `OVERDUE (${overdue.length}):\n`;
            for (const t of overdue) out += `  - ${t.key}: ${t.summary} (due ${t.dueDate})\n`;
            out += `\n`;
          }

          if (highPriority.length > 0) {
            out += `High Priority (${highPriority.length}):\n`;
            for (const t of highPriority) {
               out += `  - ${t.key}: ${t.summary}${t.dueDate ? ` (due ${t.dueDate})` : ''}\n`;
            }
            out += `\n`;
          }

          if (inProgress.length > 0) {
            out += `Currently Working On (${inProgress.length}):\n`;
            for (const t of inProgress) {
              const related = commits.filter(c => c.ticketIds.includes(t.key));
              out += `  - ${t.key}: ${t.summary}${related.length > 0 ? ` (${related.length} recent commit(s))` : ''}\n`;
            }
            out += `\n`;
          }

          out += `--- Suggested Plan ---\n`;
          let step = 1;
          if (inProgress.length > 0) {
            out += `${step++}. Continue: ${inProgress[0].key} — ${inProgress[0].summary}\n`;
            const inProgressKeys = new Set(inProgress.map(t => t.key));
            const nextHigh = highPriority.find(t => !inProgressKeys.has(t.key));
            if (nextHigh) out += `${step++}. Prioritize: ${nextHigh.key} — ${nextHigh.summary}\n`;
          } else if (overdue.length > 0) {
            out += `${step++}. Urgent: ${overdue[0].key} — ${overdue[0].summary} (OVERDUE)\n`;
          } else if (highPriority.length > 0) {
            out += `${step++}. Start: ${highPriority[0].key} — ${highPriority[0].summary}\n`;
          }
          out += `\n`;
        }

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

        if (carryForward.length > 0) {
          out += `Carried from yesterday:\n`;
          for (const item of carryForward) out += `  - ${item}\n`;
          out += `\n`;
        }

        const greeting = preferences.greeting_name ? `${preferences.greeting_name}, w` : 'W';
        out += `--- ${greeting}hat would you like to work on today? ---\n`;
        if (tickets.length > 0) {
          const inProgress = tickets.filter(t => t.status === "In Progress");
          const topPicks = inProgress.length > 0 ? inProgress : tickets.slice(0, 3);
          out += `Quick picks:\n`;
          topPicks.forEach((t, i) => out += `  ${i + 1}. ${t.key}: ${t.summary} [${t.priority}]\n`);
          out += `\nSay a ticket key (e.g. "${topPicks[0].key}") to get a full implementation plan.\n`;
        } else if (!jiraError) {
          out += `No pending tickets found. Use 'list_projects' to explore your Jira projects.\n`;
        }
        return this.textResponse(out);
      }

      case "end_of_day_report": {
        if (args.date) {
          const dateCheck = validate(dateSchema, args.date);
          if (!dateCheck.success) return this.errorResponse(dateCheck.error);
        }
        const reportDate = args.date || ReportManager.formatDate();

        let commits = [];
        let gitError = null;
        try { commits = await GitUtils.getTodayCommits(getRepoPath()); } catch (err) { gitError = err.message; }

        let completed = [];
        let inProgress = [];
        let jiraError = null;
        try {
          const client = getJiraClient();
          const result = await client.searchTickets(`assignee = currentUser() AND updated >= "${reportDate}" ORDER BY updated DESC`);
          completed = result.tickets.filter(t => t.statusCategory === "Done" || t.status === "Done");
          inProgress = result.tickets.filter(t => t.status === "In Progress");
        } catch (err) {
          jiraError = err.message;
        }

        const carryForward = ReportManager.getYesterdayCarryForward().filter(item => !completed.some(t => item.includes(t.key)));
        for (const t of inProgress) {
          const entry = `${t.key}: ${t.summary}`;
          if (!carryForward.includes(entry)) carryForward.push(entry);
        }

        let notes = '';
        if (commits.length > 0) notes += `${commits.length} commit(s) made today. `;
        if (completed.length > 0) notes += `${completed.length} ticket(s) completed. `;
        if (jiraError) notes += `[Jira was unavailable: ${jiraError}]`;
        if (!jiraError && gitError) notes += `[Git was unavailable: ${gitError}]`;
        if (!notes) notes = 'Quiet day.';

        const report = ReportManager.generateDailyReport(reportDate, {
          completed: completed.map(t => `${t.key}: ${t.summary}`),
          inProgress: inProgress.map(t => `${t.key}: ${t.summary}`),
          commits, carryForward, blockers: [], notes,
        });

        const reportPath = ReportManager.saveReport(reportDate, report);

        let out = `End-of-Day Report — ${reportDate}\n\nSaved to: ${reportPath}\n\nSummary:\n`;
        out += `- ${commits.length} commit(s)\n- ${completed.length} ticket(s) completed\n`;
        out += `- ${inProgress.length} ticket(s) in progress\n- ${carryForward.length} item(s) carry forward\n`;
        if (jiraError) out += `\n[Jira was unavailable — report based on Git data only]\n`;
        if (gitError) out += `\n[Git was unavailable — commit section may be incomplete]\n`;

        return this.textResponse(out);
      }

      case "get_daily_report": {
        const dateCheck = validate(dateSchema, args.date);
        if (!dateCheck.success) return this.errorResponse(dateCheck.error);

        const content = ReportManager.getReport(args.date);
        if (!content) return this.errorResponse(`No report found for ${args.date}. Use 'list_daily_reports'.`);
        return this.textResponse(content);
      }

      case "list_daily_reports": {
        if (args.start_date) { const c = validate(dateSchema, args.start_date); if (!c.success) return this.errorResponse(c.error); }
        if (args.end_date) { const c = validate(dateSchema, args.end_date); if (!c.success) return this.errorResponse(c.error); }

        const reports = ReportManager.listReports(args.start_date, args.end_date);
        if (reports.length === 0) return this.textResponse("No daily reports found.");

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
        return this.textResponse(out);
      }

      case "weekly_summary": {
        if (args.end_date) {
            const c = validate(dateSchema, args.end_date);
            if (!c.success) return this.errorResponse(c.error);
        }
        const endDate = args.end_date ? new Date(args.end_date) : new Date();
        return this.textResponse(ReportManager.generateWeeklySummary(endDate));
      }

      default:
        return null;
    }
  }

  getPrompt() {
    return (
      this.loadPromptChunk("workflow.md") ||
      `### Workflow Automations
Use \`morning_standup\` to kickstart the day for a user.
Use \`end_of_day_report\` when the user is wrapping up.`
    );
  }
}

module.exports = WorkflowSkill;
