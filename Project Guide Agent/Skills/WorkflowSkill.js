/// MARK: - Workflow Skill
/// Daily workflow automations: morning standup, end-of-day reports,
/// daily/weekly summaries, and consolidated cross-project summaries.

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
        name: "end_of_day_report",
        description: "Triggered by ANY report/update intent: 'today's updates', 'daily updates', 'my updates', 'provide updates', 'provide report', 'list of tasks done', 'report of today', 'end of day', 'EOD', 'wrap up'. Creates ~/Desktop/Todays Updates/DD-MM-YYYY_updates.md with project-wise completed tickets, tasks performed, pending tasks, and notes. If nothing was done today, returns a 'no updates' message. NEVER use run_skill for this — call end_of_day_report directly.",
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
          // Fetch tickets updated today (for completed) + all open tickets (for pending)
          const [updatedResult, openResult] = await Promise.all([
            client.searchTickets(
              `assignee = currentUser() AND updated >= "${reportDate}" ORDER BY updated DESC`
            ),
            client.searchTickets(
              `assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, duedate ASC`
            ),
          ]);
          // Merge and deduplicate
          const seen = new Set();
          for (const t of [...updatedResult.tickets, ...openResult.tickets]) {
            if (!seen.has(t.key)) { seen.add(t.key); allTickets.push(t); }
          }
        } catch (err) {
          jiraError = err.message;
        }

        const completedTickets = allTickets.filter(t => t.statusCategory === "Done" || t.status === "Done");
        const pendingTickets = allTickets.filter(t =>
          t.status === "To Do" || t.status === "Open" || t.status === "Backlog"
          || t.status === "Selected for Development" || t.status === "In Progress"
        );
        const now = new Date();
        const overdueHighPriority = pendingTickets.filter(t =>
          t.dueDate && new Date(t.dueDate) < now
          && (t.priority === "Highest" || t.priority === "High")
        );
        const blockedTickets = allTickets.filter(t =>
          t.status === "Blocked" || t.status === "On Hold" || t.status === "Impediment"
        );

        // Group completed tickets by project key
        const completedByProject = {};
        for (const t of completedTickets) {
          const proj = t.key.split('-')[0];
          if (!completedByProject[proj]) completedByProject[proj] = [];
          completedByProject[proj].push(t);
        }

        // Group pending tickets by project key
        const pendingByProject = {};
        for (const t of pendingTickets) {
          const proj = t.key.split('-')[0];
          if (!pendingByProject[proj]) pendingByProject[proj] = [];
          pendingByProject[proj].push(t);
        }

        // Group commits by project key via ticketIds
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

        // Collect all project keys, preserve insertion order
        const allProjects = [
          ...new Set([
            ...Object.keys(completedByProject),
            ...Object.keys(pendingByProject),
            ...Object.keys(commitsByProject),
          ]),
        ];
        if (unlinkedCommits.length > 0 && allProjects.length === 0) allProjects.push('General');
        if (unlinkedCommits.length > 0 && !allProjects.includes('General')) allProjects.push('General');

        // Determine project display name from root folder name
        const rootFolderName = path.basename(getRepoPath());
        const activeProjectKey = args.project_name
          || rootFolderName
          || null;

        // Format date parts
        const [yyyy, mm, dd] = reportDate.split('-');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const displayDate = `${dd} ${months[parseInt(mm, 10) - 1]} ${yyyy}`;
        const filenameDatePart = `${dd}-${mm}-${yyyy}`;

        // Helper: humanize commit messages — strip ticket prefixes, capitalize, group similar
        const humanizeCommits = (projCommits) => {
          const cleaned = projCommits.map(c => {
            let msg = c.message.replace(/^[A-Z][A-Z0-9]+-\d+\s*[-:]?\s*/i, '').trim() || c.message;
            // Capitalize first letter
            msg = msg.charAt(0).toUpperCase() + msg.slice(1);
            // Remove trailing period if present, we add our own formatting
            msg = msg.replace(/\.+$/, '');
            return msg;
          });
          // Deduplicate very similar messages (same first 40 chars)
          const unique = [];
          const seen = new Set();
          for (const msg of cleaned) {
            const key = msg.slice(0, 40).toLowerCase();
            if (!seen.has(key)) { seen.add(key); unique.push(msg); }
          }
          return unique;
        };

        // Check if there's any data at all
        const hasAnyData = allProjects.length > 0 || commits.length > 0;

        if (!hasAnyData && !jiraError && !gitError) {
          // Nothing done today — save minimal file and return early
          const minContent = `# Updates\n## Daily Updates — ${displayDate}\n\n---\n\n🟡 No updates for today. Would you like to pick up a task?\n`;
          const todaysUpdatesDir = path.join(os.homedir(), 'Desktop', 'Todays Updates');
          try {
            if (!fs.existsSync(todaysUpdatesDir)) fs.mkdirSync(todaysUpdatesDir, { recursive: true });
            const fp = path.join(todaysUpdatesDir, `${filenameDatePart}_updates.md`);
            fs.writeFileSync(fp, minContent, { encoding: 'utf-8' });
          } catch (_) { /* best effort */ }
          return this.textResponse(`No updates for today. Would you like to pick up a task?`);
        }

        // Build markdown content in new format — per project
        let content = '';

        for (const proj of allProjects) {
          const projCompleted = completedByProject[proj] || [];
          const projPending = pendingByProject[proj] || [];
          const projCommits = proj === 'General' ? unlinkedCommits : (commitsByProject[proj] || []);

          const projDisplayName = activeProjectKey || proj;

          // Header
          content += `# ProjectName: ${projDisplayName} Updates\n`;
          content += `## Daily Updates — ${displayDate}\n\n`;
          content += `---\n\n`;

          if (jiraError) content += `> ⚠️ Jira unavailable — ${jiraError}\n\n`;
          if (gitError) content += `> ⚠️ Git unavailable — ${gitError}\n\n`;

          // 🔵 Tickets Completed Today
          content += `## 🔵 Tickets Completed Today\n`;
          if (projCompleted.length > 0) {
            for (const t of projCompleted) content += `🟢 ${t.key} — ${t.summary}\n`;
          } else {
            content += `🟡 No tickets completed today\n`;
          }
          content += `\n---\n\n`;

          // 🟣 Tasks Performed (humanized commits)
          content += `## 🟣 Tasks Performed\n`;
          if (projCommits.length > 0) {
            const humanized = humanizeCommits(projCommits);
            for (const msg of humanized) content += `🔵 ${msg}\n`;
          } else {
            content += `🔴 No development activity recorded today\n`;
          }
          content += `\n---\n\n`;

          // 🟡 Pending Tasks (To Do + In Progress only)
          content += `## 🟡 Pending Tasks\n`;
          if (projPending.length > 0) {
            for (const t of projPending) {
              const statusIcon = t.status === "In Progress" ? '🟠' : '🔴';
              content += `${statusIcon} ${t.key} — ${t.summary}\n`;
            }
          } else {
            content += `🟢 No pending tasks — all caught up!\n`;
          }
          content += `\n---\n\n`;

          // 🔴 Notes (overdue, blockers, suggestions)
          content += `## 🔴 Notes\n`;
          const projOverdue = overdueHighPriority.filter(t => t.key.startsWith(proj + '-'));
          const projBlocked = blockedTickets.filter(t => t.key.startsWith(proj + '-'));
          let hasNotes = false;

          if (projOverdue.length > 0) {
            for (const t of projOverdue) {
              content += `🔴 OVERDUE: ${t.key} — ${t.summary} (${t.priority} priority, due ${t.dueDate})\n`;
            }
            hasNotes = true;
          }

          if (projBlocked.length > 0) {
            for (const t of projBlocked) {
              content += `🟠 BLOCKED: ${t.key} — ${t.summary}\n`;
            }
            hasNotes = true;
          }

          // Suggest next focus
          const inProgressItems = projPending.filter(t => t.status === "In Progress");
          const toDoItems = projPending.filter(t => t.status !== "In Progress");
          if (inProgressItems.length > 0) {
            content += `🟢 Next focus: Continue work on ${inProgressItems[0].key} — ${inProgressItems[0].summary}\n`;
            hasNotes = true;
          } else if (toDoItems.length > 0) {
            content += `🟢 Next focus: Pick up ${toDoItems[0].key} — ${toDoItems[0].summary}\n`;
            hasNotes = true;
          }

          if (!hasNotes) {
            content += `🟢 No risks or blockers today\n`;
          }
          content += `\n*************\n\n`;
        }

        // Save to ~/Desktop/Todays Updates/DD-MM-YYYY_updates.md
        const todaysUpdatesDir = path.join(os.homedir(), 'Desktop', 'Todays Updates');
        let reportFilePath = null;
        let saveError = null;
        try {
          if (!fs.existsSync(todaysUpdatesDir)) {
            fs.mkdirSync(todaysUpdatesDir, { recursive: true });
          }
          reportFilePath = path.join(todaysUpdatesDir, `${filenameDatePart}_updates.md`);
          fs.writeFileSync(reportFilePath, content, { encoding: 'utf-8' });
          Logger.info('Daily updates saved', { path: reportFilePath });
        } catch (err) {
          saveError = err.message;
          Logger.error('Failed to save daily updates', { error: err.message, dir: todaysUpdatesDir });
        }

        let out = `Daily Updates — ${displayDate}\n\n`;
        if (reportFilePath && !saveError) {
          out += `Saved to: ${reportFilePath}\n\n`;
        } else if (saveError) {
          out += `Note: Could not save file to Desktop — ${saveError}\n\n`;
        }
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
