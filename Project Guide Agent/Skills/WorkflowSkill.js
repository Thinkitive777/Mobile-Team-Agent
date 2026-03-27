const path = require("path");
const BaseSkill = require("./Core/BaseSkill");
const { validate, dateSchema } = require("../Utils/validators");
const CONST = require("../Constants/constants");
const ReportManager = require("../Services/report-manager");
const GitUtils = require("../Utils/git-utils");
const Logger = require("../Utils/logger");

class WorkflowSkill extends BaseSkill {
  constructor() {
    super();
    this.name = "WorkflowSkill";
  }

  getTools() {
    return [
      {
        name: "morning_standup",
        description: "Generate morning standup when user greets (Good morning / Hi / start my day): pending tickets, recent commits, prioritized daily plan. Works even if Jira is unavailable.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_daily_updates",
        description: "Return a summary of today's work when user asks for updates (e.g. 'today's updates', 'my updates', 'provide updates', 'what have I done today'). Aggregates GitHub commits, Jira ticket progress, and code changes.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Jira project key to scope ticket query (optional)" },
          },
        },
      },
      {
        name: "end_of_day_report",
        description: "Generate, save, and display end-of-day report. Saves to ~/.projectguide-agent and also to Desktop/ProjectGuide-Updates/<project>/ when a project is active.",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Report date (default: today, YYYY-MM-DD)" },
            project_name: { type: "string", description: "Project name for Desktop storage (default: active Jira project)" },
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
        description: "List all saved daily reports with optional date range. Includes Desktop project-based reports.",
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
      {
        name: "get_consolidated_summary",
        description: "Generate a consolidated summary of all work done across all projects for a given day. Aggregates tasks and progress from Desktop project-based reports.",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date to summarize (default: today, YYYY-MM-DD)" },
          },
        },
      },
    ];
  }

  textResponse(msg) {
    return { content: [{ type: "text", text: msg }] };
  }

  errorResponse(msg) {
    return { content: [{ type: "text", text: msg }], isError: true };
  }

  async handleTool(name, args, context) {
    const { getJiraClient, getRepoPath, preferences, config } = context;

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

      case "get_daily_updates": {
        // Intent-based updates: "today's updates", "my updates", "provide updates"
        // Returns a focused summary of what the user has done today.
        const now = new Date();
        const todayStr = ReportManager.formatDate(now);
        const projectFilter = args.project || preferences.last_project || null;

        let commits = [];
        let gitError = null;
        try { commits = await GitUtils.getTodayCommits(getRepoPath()); } catch (err) { gitError = err.message; }

        let updatedTickets = [];
        let completedTickets = [];
        let inProgressTickets = [];
        let jiraError = null;
        try {
          const client = getJiraClient();
          const projectClause = projectFilter ? ` AND project = "${projectFilter}"` : '';
          const result = await client.searchTickets(
            `assignee = currentUser() AND updated >= "${todayStr}"${projectClause} ORDER BY updated DESC`
          );
          updatedTickets = result.tickets;
          completedTickets = result.tickets.filter(t => t.statusCategory === "Done" || t.status === "Done");
          inProgressTickets = result.tickets.filter(t => t.status === "In Progress");
        } catch (err) {
          jiraError = err.message;
        }

        let out = `Daily Updates — ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n\n`;
        if (projectFilter) out += `Project: ${projectFilter}\n\n`;

        // Commits section
        if (commits.length > 0) {
          out += `## Code Changes (${commits.length} commit(s) today)\n`;
          for (const c of commits) {
            const ticketTag = c.ticketIds.length > 0 ? ` [${c.ticketIds.join(', ')}]` : '';
            out += `  - ${c.hash}: ${c.message}${ticketTag}\n`;
          }
          out += '\n';
        } else if (!gitError) {
          out += `## Code Changes\n  - No commits today\n\n`;
        }
        if (gitError) out += `[Git unavailable: ${gitError}]\n\n`;

        // Jira ticket progress
        if (!jiraError) {
          if (completedTickets.length > 0) {
            out += `## Completed Tickets (${completedTickets.length})\n`;
            for (const t of completedTickets) out += `  - ${t.key}: ${t.summary}\n`;
            out += '\n';
          }
          if (inProgressTickets.length > 0) {
            out += `## In Progress (${inProgressTickets.length})\n`;
            for (const t of inProgressTickets) out += `  - ${t.key}: ${t.summary}\n`;
            out += '\n';
          }
          if (updatedTickets.length > 0 && completedTickets.length === 0 && inProgressTickets.length === 0) {
            out += `## Updated Tickets (${updatedTickets.length})\n`;
            for (const t of updatedTickets) out += `  - ${t.key}: ${t.summary} [${t.status}]\n`;
            out += '\n';
          }
          if (updatedTickets.length === 0) {
            out += `## Jira Tickets\n  - No tickets updated today\n\n`;
          }
        } else {
          out += `[Jira unavailable: ${jiraError}]\n\n`;
        }

        // Summary line
        const commitCount = commits.length;
        const doneCount = completedTickets.length;
        const wipCount = inProgressTickets.length;
        out += `---\nSummary: ${commitCount} commit(s), ${doneCount} completed, ${wipCount} in progress`;
        if (projectFilter) out += ` (project: ${projectFilter})`;
        out += '\n';

        // Save to Desktop under the project directory if a project is active
        const repoPath = (() => { try { return getRepoPath(); } catch { return null; } })();
        const dailyUpdatesProject = args.project
          || (config && config.jira && config.jira.active_project && config.jira.active_project !== '__default__'
              ? config.jira.active_project
              : null)
          || preferences.last_project
          || (repoPath ? path.basename(repoPath) : null);

        if (dailyUpdatesProject) {
          try {
            const savedPath = ReportManager.saveProjectReport(todayStr, out, dailyUpdatesProject);
            out += `\nSaved to Desktop: ${savedPath}`;
          } catch (saveErr) {
            Logger.warn('Failed to save daily updates to Desktop', { error: saveErr.message });
          }
        }

        return this.textResponse(out);
      }

      case "end_of_day_report": {
        if (args.date) {
          const dateCheck = validate(dateSchema, args.date);
          if (!dateCheck.success) return this.errorResponse(dateCheck.error);
        }
        const reportDate = args.date || ReportManager.formatDate();

        // Determine project name for Desktop storage
        const projectName = args.project_name
          || (config && config.jira && config.jira.active_project && config.jira.active_project !== '__default__'
              ? config.jira.active_project
              : null)
          || preferences.last_project
          || null;

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
        if (projectName) notes += `Project: ${projectName}. `;
        if (jiraError) notes += `[Jira was unavailable: ${jiraError}]`;
        if (!jiraError && gitError) notes += `[Git was unavailable: ${gitError}]`;
        if (!notes) notes = 'Quiet day.';

        const report = ReportManager.generateDailyReport(reportDate, {
          completed: completed.map(t => `${t.key}: ${t.summary}`),
          inProgress: inProgress.map(t => `${t.key}: ${t.summary}`),
          commits, carryForward, blockers: [], notes,
        });

        // Always save to the standard reports directory
        const reportPath = ReportManager.saveReport(reportDate, report);

        // Also save to Desktop under the project directory if a project is active
        let desktopPath = null;
        if (projectName) {
          try {
            desktopPath = ReportManager.saveProjectReport(reportDate, report, projectName);
          } catch (desktopErr) {
            Logger.warn('Failed to save Desktop project report', { error: desktopErr.message });
          }
        }

        let out = `End-of-Day Report — ${reportDate}\n\nSaved to: ${reportPath}\n`;
        if (desktopPath) out += `Also saved to Desktop: ${desktopPath}\n`;
        out += `\nSummary:\n`;
        out += `- ${commits.length} commit(s)\n- ${completed.length} ticket(s) completed\n`;
        out += `- ${inProgress.length} ticket(s) in progress\n- ${carryForward.length} item(s) carry forward\n`;
        if (projectName) out += `- Project: ${projectName}\n`;
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
        const desktopProjects = ReportManager.listProjectNames();

        if (reports.length === 0 && desktopProjects.length === 0) {
          return this.textResponse("No daily reports found.");
        }

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

        if (desktopProjects.length > 0) {
          out += `\nDesktop project reports:\n`;
          for (const p of desktopProjects) {
            out += `  Project: ${p}\n`;
            const pDir = ReportManager.getProjectDir(p);
            const fs = require('fs');
            const path = require('path');
            const files = fs.readdirSync(pDir).filter(f => f.endsWith('.md'));
            for (const f of files.sort().reverse().slice(0, 5)) {
              out += `    - ${f.replace('.md', '')}\n`;
            }
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

      case "get_consolidated_summary": {
        if (args.date) {
          const c = validate(dateSchema, args.date);
          if (!c.success) return this.errorResponse(c.error);
        }
        const summaryDate = args.date ? new Date(args.date) : new Date();
        return this.textResponse(ReportManager.generateConsolidatedSummary(summaryDate));
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
