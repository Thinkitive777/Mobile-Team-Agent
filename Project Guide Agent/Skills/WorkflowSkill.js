const fs = require("fs");
const os = require("os");
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
        description: "Legacy: return a raw summary of today's work (commits + Jira progress). Prefer end_of_day_report for the formatted daily updates file.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Jira project key to scope ticket query (optional)" },
          },
        },
      },
      {
        name: "end_of_day_report",
        description: "Triggered by 'today's updates', 'daily updates', 'my updates', 'list of tasks done', 'report of today'. Creates ~/Desktop/Todays Updates/updates-ddmmyyyy.md with project-wise completed tickets, commits, and work summary. If nothing was done today, returns a 'no updates' message.",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Report date (default: today, YYYY-MM-DD)" },
            project_name: { type: "string", description: "Project name override (default: inferred from active Jira project)" },
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
          // Categorise by status
          const toDo = tickets.filter(t =>
            t.status === "To Do" || t.status === "Open" || t.status === "Backlog" || t.status === "Selected for Development"
          );
          const inProgress = tickets.filter(t => t.status === "In Progress");
          const devDone = tickets.filter(t =>
            t.status === "Development Done" || t.status === "Dev Done" || t.status === "Code Review" || t.status === "In Review"
          );
          const overdue = tickets.filter(t => t.dueDate && new Date(t.dueDate) < now);

          out += `Workload: ${tickets.length} pending`;
          if (totalTickets > tickets.length) out += ` (${totalTickets} total)`;
          out += `\n\n`;

          if (overdue.length > 0) {
            out += `⚠️  OVERDUE (${overdue.length}):\n`;
            for (const t of overdue) out += `  - ${t.key}: ${t.summary} [${t.priority}] (due ${t.dueDate})\n`;
            out += `\n`;
          }

          if (inProgress.length > 0) {
            out += `🔄  In Progress (${inProgress.length}):\n`;
            for (const t of inProgress) {
              const related = commits.filter(c => c.ticketIds.includes(t.key));
              out += `  - ${t.key}: ${t.summary} [${t.priority}]${related.length > 0 ? ` · ${related.length} recent commit(s)` : ''}\n`;
            }
            out += `\n`;
          }

          if (devDone.length > 0) {
            out += `✅  Development Done / In Review (${devDone.length}):\n`;
            for (const t of devDone) out += `  - ${t.key}: ${t.summary} [${t.priority}]\n`;
            out += `\n`;
          }

          if (toDo.length > 0) {
            out += `📋  To Do (${toDo.length}):\n`;
            for (const t of toDo) out += `  - ${t.key}: ${t.summary} [${t.priority}]\n`;
            out += `\n`;
          }

          // Score tickets: priority weight + type bonus, suggest next work
          const PRIORITY_SCORE = { Highest: 5, High: 4, Medium: 3, Low: 2, Lowest: 1 };
          const TYPE_BONUS = { Bug: 2, Hotfix: 2, Story: 1, Task: 0, Subtask: 0 };
          const scored = tickets
            .filter(t => t.status !== "Development Done" && t.status !== "Dev Done" && t.status !== "Code Review" && t.status !== "In Review")
            .map(t => ({
              ticket: t,
              score: (PRIORITY_SCORE[t.priority] || 2) + (TYPE_BONUS[t.type] || 0) + (t.dueDate && new Date(t.dueDate) < now ? 3 : 0),
            }))
            .sort((a, b) => b.score - a.score);

          out += `--- Suggested Next Work ---\n`;
          let step = 1;
          if (inProgress.length > 0) {
            out += `${step++}. Continue: ${inProgress[0].key} — ${inProgress[0].summary} [${inProgress[0].priority}]\n`;
          }
          if (devDone.length > 0) {
            out += `${step++}. Needs review/merge: ${devDone[0].key} — ${devDone[0].summary}\n`;
          }
          for (const { ticket } of scored.filter(s => s.ticket.status !== "In Progress").slice(0, 2)) {
            const reason = ticket.dueDate && new Date(ticket.dueDate) < now
              ? 'OVERDUE'
              : ticket.priority === "Highest" || ticket.priority === "High"
              ? `${ticket.priority} priority`
              : ticket.type === "Bug" ? 'Bug fix' : `${ticket.priority} priority`;
            out += `${step++}. Pick up: ${ticket.key} — ${ticket.summary} (${reason})\n`;
          }
          out += `\n`;
        }

        if (commits.length > 0) {
          out += `Recent Activity (${commits.length} commit(s) in last 48h):\n`;
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
          const inProgressNow = tickets.filter(t => t.status === "In Progress");
          const topPicks = inProgressNow.length > 0 ? inProgressNow.slice(0, 3) : tickets.slice(0, 3);
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

        let allTickets = [];
        let jiraError = null;
        try {
          const client = getJiraClient();
          const result = await client.searchTickets(
            `assignee = currentUser() AND updated >= "${reportDate}" ORDER BY updated DESC`
          );
          allTickets = result.tickets;
        } catch (err) {
          jiraError = err.message;
        }

        const completedTickets = allTickets.filter(t => t.statusCategory === "Done" || t.status === "Done");

        // Early exit if nothing to report
        if (commits.length === 0 && completedTickets.length === 0 && !gitError && !jiraError) {
          return this.textResponse("No updates for today. Would you like to pick up a task?");
        }

        // Group completed tickets by project key (e.g. "CMDN" from "CMDN-123")
        const ticketsByProject = {};
        for (const t of completedTickets) {
          const proj = t.key.split('-')[0];
          if (!ticketsByProject[proj]) ticketsByProject[proj] = [];
          ticketsByProject[proj].push(t);
        }

        // Group commits by project key via ticketIds extracted from messages
        const commitsByProject = {};
        const unlinkedCommits = [];
        for (const c of commits) {
          const projects = [...new Set(c.ticketIds.map(id => id.split('-')[0]))];
          if (projects.length === 0) {
            unlinkedCommits.push(c);
          } else {
            for (const p of projects) {
              if (!commitsByProject[p]) commitsByProject[p] = [];
              commitsByProject[p].push(c);
            }
          }
        }

        // Collect all project keys (from tickets + commits), preserve insertion order
        const allProjects = [
          ...new Set([
            ...Object.keys(ticketsByProject),
            ...Object.keys(commitsByProject),
          ]),
        ];
        if (unlinkedCommits.length > 0 && allProjects.length === 0) allProjects.push('General');
        if (unlinkedCommits.length > 0 && !allProjects.includes('General')) allProjects.push('General');

        // Determine project display name from args or config
        const activeProjectKey = args.project_name
          || (config && config.jira && config.jira.active_project && config.jira.active_project !== '__default__'
              ? config.jira.active_project
              : null)
          || preferences.last_project
          || null;

        // Format date as dd/mm/yyyy for display and ddmmyyyy for filename
        const [yyyy, mm, dd] = reportDate.split('-');
        const displayDate = `${dd}/${mm}/${yyyy}`;
        const filenameDatePart = `${dd}${mm}${yyyy}`;

        // Build markdown content in required format
        let content = `Daily Updates - ${displayDate}\n\n`;

        if (jiraError) content += `> Note: Jira unavailable — ${jiraError}\n\n`;
        if (gitError) content += `> Note: Git unavailable — ${gitError}\n\n`;

        for (const proj of allProjects) {
          const projTickets = ticketsByProject[proj] || [];
          const projCommits = proj === 'General' ? unlinkedCommits : (commitsByProject[proj] || []);

          // Determine a display name: use the active project name if key matches, otherwise use key
          const projDisplayName = (activeProjectKey && proj !== 'General' && proj === activeProjectKey.split('-')[0])
            ? activeProjectKey
            : proj;

          content += `Project: ${projDisplayName}\n\n`;

          content += `Completed Tickets\n`;
          if (projTickets.length > 0) {
            for (const t of projTickets) content += `${t.key} - ${t.summary}\n`;
          } else {
            content += `No completed tickets\n`;
          }
          content += `\n`;

          content += `Commits\n`;
          if (projCommits.length > 0) {
            for (const c of projCommits) {
              // Normalised format: strip ticket prefix from message if already present, show clean message
              const cleanMsg = c.message.replace(/^[A-Z][A-Z0-9]+-\d+\s*[-:]?\s*/i, '').trim() || c.message;
              content += `${cleanMsg}\n`;
            }
          } else {
            content += `No commits\n`;
          }
          content += `\n`;

          content += `Summary of Work\n`;
          const summaryParts = [];
          if (projTickets.length > 0) {
            summaryParts.push(`Completed ${projTickets.length} ticket(s): ${projTickets.map(t => t.key).join(', ')}`);
          }
          if (projCommits.length > 0) {
            summaryParts.push(`Made ${projCommits.length} commit(s)`);
            const areas = [...new Set(projCommits.flatMap(c => c.ticketIds))];
            if (areas.length > 0) summaryParts.push(`related to ${areas.slice(0, 3).join(', ')}`);
          }
          content += (summaryParts.length > 0 ? summaryParts.join('. ') + '.' : 'No significant changes today.') + '\n';
          content += `\n`;
        }

        // Save to ~/Desktop/Todays Updates/updates-ddmmyyyy.md
        const todaysUpdatesDir = path.join(os.homedir(), 'Desktop', 'Todays Updates');
        if (!fs.existsSync(todaysUpdatesDir)) {
          fs.mkdirSync(todaysUpdatesDir, { recursive: true, mode: 0o755 });
        }
        const reportFilePath = path.join(todaysUpdatesDir, `updates-${filenameDatePart}.md`);
        fs.writeFileSync(reportFilePath, content, { encoding: 'utf-8', mode: CONST.REPORT_FILE_PERMISSIONS });
        Logger.info('Daily updates saved', { path: reportFilePath });

        let out = `Daily Updates — ${displayDate}\n\n`;
        out += `Saved to: ${reportFilePath}\n\n`;
        out += content;

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
