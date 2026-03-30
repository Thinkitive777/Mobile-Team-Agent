const BaseSkill = require("./Core/BaseSkill");
const { validate, dateSchema } = require("../Utils/validators");
const CONST = require("../Constants/constants");
const ReportManager = require("../Services/report-manager");
const GitUtils = require("../Utils/git-utils");
const MemoryManager = require("../Services/memory-manager");

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
        name: "plan_my_day",
        description: "Deep daily planning: analyzes tickets (new, pending, blocked, overdue), reads comments for context, checks yesterday's completed work, and produces a prioritized action plan. Use when developer says 'let's plan today's work', 'plan my day', 'what should I focus on today'.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project key (uses saved preference if omitted)" },
          },
        },
      },
      {
        name: "end_of_day_report",
        description: "Generate, save, and display end-of-day report. Includes carry-forward from yesterday, critical/overdue flagging, and non-ticket work entries.",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Report date (default: today, YYYY-MM-DD)" },
            extra_work: { type: "string", description: "Non-ticket work done today (e.g. 'Design review 2h, Team sync meeting, Code review for PR #45'). Comma-separated entries." },
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
        let newTickets = [];

        try {
          const client = getJiraClient();
          const result = await client.searchTickets(
            "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, duedate ASC"
          );
          tickets = result.tickets;
          totalTickets = result.tickets.length + (!result.isLast ? 1 : 0);

          // Detect newly assigned tickets (assigned to current user in the last 24h)
          try {
            const newResult = await client.searchTickets(
              "assignee = currentUser() AND assignee CHANGED AFTER -1d AND statusCategory != Done ORDER BY priority DESC"
            );
            newTickets = newResult.tickets;
          } catch (newErr) {
            // Fall back: use created date as approximation
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yStr = yesterday.toISOString().split('T')[0];
            newTickets = tickets.filter(t => t.created && t.created >= yStr);
          }
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

        // New tickets section
        if (newTickets.length > 0) {
          out += `NEW — Assigned since yesterday (${newTickets.length}):\n`;
          for (const t of newTickets) {
            out += `  - ${t.key}: ${t.summary} [${t.priority}]${t.dueDate ? ` (due ${t.dueDate})` : ''}\n`;
          }
          out += `\n`;
        }

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
          out += `\nTip: Say "plan my day" for a deeper analysis with comment context and blocker details.\n`;
        } else if (!jiraError) {
          out += `No pending tickets found. Use 'list_projects' to explore your Jira projects.\n`;
        }
        return this.textResponse(out);
      }

      case "plan_my_day": {
        const now = new Date();
        let tickets = [];
        let newTickets = [];
        let jiraError = null;
        let gitError = null;

        try {
          const client = getJiraClient();
          const project = args.project || preferences.last_project;
          const clauses = ['assignee = currentUser()', 'statusCategory != Done'];
          if (project) clauses.push(`project = "${project}"`);
          const jql = clauses.join(' AND ') + ' ORDER BY priority DESC, duedate ASC';
          const result = await client.searchTickets(jql, [...CONST.JIRA_DEFAULT_FIELDS, 'issuetype', 'comment']);
          tickets = result.tickets;

          // Detect newly assigned tickets
          try {
            const newClauses = ['assignee = currentUser()', 'assignee CHANGED AFTER -1d', 'statusCategory != Done'];
            if (project) newClauses.push(`project = "${project}"`);
            const newResult = await client.searchTickets(newClauses.join(' AND ') + ' ORDER BY priority DESC');
            newTickets = newResult.tickets;
          } catch (newErr) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yStr = yesterday.toISOString().split('T')[0];
            newTickets = tickets.filter(t => t.created && t.created >= yStr);
          }
        } catch (err) {
          jiraError = err.message;
        }

        let commits = [];
        let workAreas = null;
        try {
          commits = await GitUtils.getRecentCommits(CONST.STANDUP_COMMIT_WINDOW, getRepoPath());
          // Analyze what code areas were worked on recently
          workAreas = await GitUtils.analyzeWorkAreas(CONST.STANDUP_COMMIT_WINDOW, getRepoPath());
        } catch (err) {
          gitError = err.message;
        }

        // Fetch yesterday's report for "completed yesterday" section
        const yesterdayReport = ReportManager.getYesterdayCarryForward();
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayContent = ReportManager.getReport(ReportManager.formatDate(yesterdayDate));
        let completedYesterday = [];
        if (yesterdayContent) {
          const sections = ReportManager._extractSections(yesterdayContent);
          completedYesterday = sections.completed;
        }

        let out = `Daily Work Plan — ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n`;
        out += `${'='.repeat(60)}\n\n`;

        if (jiraError) out += `[Jira unavailable: ${jiraError}]\n\n`;
        if (gitError) out += `[Git unavailable: ${gitError}]\n\n`;

        // === Yesterday's Completed Work ===
        if (completedYesterday.length > 0) {
          out += `COMPLETED YESTERDAY:\n`;
          for (const item of completedYesterday) out += `  [done] ${item}\n`;
          out += `\n`;
        }

        // === Recent Code Changes (what you were actually working on) ===
        if (workAreas && workAreas.totalCommits > 0) {
          out += `RECENT CODE ACTIVITY (${CONST.STANDUP_COMMIT_WINDOW}):\n`;
          out += `  ${workAreas.totalCommits} commit(s), +${workAreas.totalInsertions}/-${workAreas.totalDeletions} lines\n\n`;

          const sortedAreas = Object.entries(workAreas.areas)
            .sort((a, b) => (b[1].insertions + b[1].deletions) - (a[1].insertions + a[1].deletions));

          if (sortedAreas.length > 0) {
            out += `  Areas worked on:\n`;
            for (const [area, data] of sortedAreas.slice(0, 6)) {
              out += `    ${area} — ${data.fileCount} file(s), +${data.insertions}/-${data.deletions}\n`;
            }
            out += `\n`;
          }

          if (workAreas.topFiles.length > 0) {
            out += `  Most changed files:\n`;
            for (const f of workAreas.topFiles.slice(0, 5)) {
              out += `    ${f.path} — +${f.insertions}/-${f.deletions} (${f.commitCount} commit(s))\n`;
            }
            out += `\n`;
          }

          // Link commits to tickets for context
          const ticketCommits = {};
          for (const c of commits) {
            for (const tid of c.ticketIds) {
              if (!ticketCommits[tid]) ticketCommits[tid] = [];
              ticketCommits[tid].push(c);
            }
          }
          if (Object.keys(ticketCommits).length > 0) {
            out += `  Commits linked to tickets:\n`;
            for (const [tid, tCommits] of Object.entries(ticketCommits)) {
              out += `    ${tid}: ${tCommits.length} commit(s) — ${tCommits.map(c => c.message).join('; ')}\n`;
            }
            out += `\n`;
          }
        }

        if (tickets.length === 0 && !jiraError) {
          out += `No pending tickets assigned to you. You're all caught up!\n`;
          return this.textResponse(out);
        }

        const inProgress = tickets.filter(t => t.status === "In Progress");
        const overdue = tickets.filter(t => t.dueDate && new Date(t.dueDate) < now);
        const highPriority = tickets.filter(t => t.priority === "Highest" || t.priority === "High");
        const blocked = tickets.filter(t => {
          const nameBlocked = (t.summary + ' ' + t.status).toLowerCase().includes('blocked');
          const labelBlocked = (t.labels || []).some(l => l.toLowerCase() === 'blocked');
          const linkBlocked = (t.issueLinks || []).some(link =>
            link.description?.toLowerCase().includes('is blocked by') && link.linkedStatus !== 'Done'
          );
          return nameBlocked || labelBlocked || linkBlocked;
        });
        const notStarted = tickets.filter(t =>
          t.status !== "In Progress" && !blocked.includes(t) && !(t.dueDate && new Date(t.dueDate) < now)
        );
        const newKeys = new Set(newTickets.map(t => t.key));

        // === New Tickets ===
        if (newTickets.length > 0) {
          out += `NEW — Assigned since yesterday (${newTickets.length}):\n`;
          for (const t of newTickets) {
            out += `  [new] ${t.key}: ${t.summary} [${t.priority}]${t.dueDate ? ` (due ${t.dueDate})` : ''}\n`;
          }
          out += `\n`;
        }

        // === Blockers ===
        if (blocked.length > 0) {
          out += `BLOCKED (${blocked.length}) — Needs attention:\n`;
          for (const t of blocked) {
            const blockers = (t.issueLinks || []).filter(l => l.description?.toLowerCase().includes("is blocked by")).map(l => `${l.linkedKey} [${l.linkedStatus}]`);
            out += `  [blocked] ${t.key}: ${t.summary}\n`;
            if (blockers.length > 0) out += `            Blocked by: ${blockers.join(", ")}\n`;
            // Show latest comment for context
            if (t.comments && t.comments.length > 0) {
              const latest = t.comments[t.comments.length - 1];
              const preview = (latest.body || '').substring(0, 120);
              out += `            Latest comment (${latest.author}): ${preview}...\n`;
            }
          }
          out += `\n`;
        }

        // === Overdue ===
        if (overdue.length > 0) {
          out += `OVERDUE (${overdue.length}) — Past due date:\n`;
          for (const t of overdue) {
            const daysOver = Math.ceil((now - new Date(t.dueDate)) / (1000 * 60 * 60 * 24));
            out += `  [overdue] ${t.key}: ${t.summary} — ${daysOver} day(s) overdue (was due ${t.dueDate})\n`;
          }
          out += `\n`;
        }

        // === In Progress ===
        if (inProgress.length > 0) {
          out += `IN PROGRESS (${inProgress.length}):\n`;
          for (const t of inProgress) {
            const related = commits.filter(c => c.ticketIds.includes(t.key));
            out += `  [wip] ${t.key}: ${t.summary}`;
            if (related.length > 0) out += ` (${related.length} recent commit(s))`;
            if (t.dueDate) out += ` (due ${t.dueDate})`;
            out += `\n`;
            // Show latest comment for context on WIP tickets
            if (t.comments && t.comments.length > 0) {
              const latest = t.comments[t.comments.length - 1];
              const preview = (latest.body || '').substring(0, 120);
              out += `         Latest comment (${latest.author}): ${preview}...\n`;
            }
          }
          out += `\n`;
        }

        // === Not Started ===
        if (notStarted.length > 0) {
          out += `NOT STARTED (${notStarted.length}):\n`;
          for (const t of notStarted) {
            const tag = newKeys.has(t.key) ? '[new] ' : '      ';
            out += `  ${tag}${t.key}: ${t.summary} [${t.priority}]${t.dueDate ? ` (due ${t.dueDate})` : ''}\n`;
          }
          out += `\n`;
        }

        // === Carry forward from yesterday ===
        if (yesterdayReport.length > 0) {
          out += `CARRIED FROM YESTERDAY:\n`;
          for (const item of yesterdayReport) out += `  - ${item}\n`;
          out += `\n`;
        }

        // === Memory Context ===
        try {
          const memCtx = MemoryManager.getContextForToday();
          if (memCtx.activeDecisions.length > 0) {
            out += `ACTIVE DECISIONS (${memCtx.activeDecisions.length}):\n`;
            for (const d of memCtx.activeDecisions.slice(0, 5)) {
              const tickets = d.relatedTickets.length > 0 ? ` [${d.relatedTickets.join(', ')}]` : '';
              out += `  - ${d.text}${tickets}\n`;
            }
            out += `\n`;
          }
          // Show notes for in-progress tickets
          for (const t of inProgress) {
            const ticketNotes = MemoryManager.getTicketNotes(t.key);
            if (ticketNotes.length > 0) {
              const latest = ticketNotes[ticketNotes.length - 1];
              out += `  Note on ${t.key}: "${latest.text}" (${latest.timestamp.substring(0, 10)})\n`;
            }
          }
          if (inProgress.some(t => MemoryManager.getTicketNotes(t.key).length > 0)) {
            out += `\n`;
          }
        } catch (memErr) {
          // Non-fatal — memory is optional
        }

        // === Today's Recommended Plan ===
        out += `${'='.repeat(60)}\n`;
        out += `TODAY'S RECOMMENDED PLAN:\n\n`;
        let step = 1;

        if (blocked.length > 0) {
          out += `${step++}. UNBLOCK: Resolve blockers on ${blocked.map(t => t.key).join(', ')} — check linked issues or escalate\n`;
        }
        if (overdue.length > 0) {
          const overdueNotBlocked = overdue.filter(t => !blocked.includes(t));
          if (overdueNotBlocked.length > 0) {
            out += `${step++}. URGENT: Finish overdue ${overdueNotBlocked.map(t => t.key).join(', ')}\n`;
          }
        }
        if (inProgress.length > 0) {
          const wipNotOverdue = inProgress.filter(t => !overdue.includes(t));
          if (wipNotOverdue.length > 0) {
            out += `${step++}. CONTINUE: ${wipNotOverdue[0].key} — ${wipNotOverdue[0].summary}\n`;
          }
        }
        if (highPriority.length > 0) {
          const highNotStartedYet = highPriority.filter(t => t.status !== "In Progress" && !overdue.includes(t) && !blocked.includes(t));
          if (highNotStartedYet.length > 0) {
            out += `${step++}. NEXT: Pick up high priority ${highNotStartedYet[0].key} — ${highNotStartedYet[0].summary}\n`;
          }
        }
        if (newTickets.length > 0) {
          const newNotCovered = newTickets.filter(t => !inProgress.some(ip => ip.key === t.key) && !overdue.some(od => od.key === t.key));
          if (newNotCovered.length > 0) {
            out += `${step++}. REVIEW: Check newly assigned ${newNotCovered.map(t => t.key).join(', ')} — read descriptions and plan\n`;
          }
        }

        out += `\n--- Say a ticket key to dive deep, or "let's start" to begin with #1 ---\n`;

        return this.textResponse(out);
      }

      case "end_of_day_report": {
        if (args.date) {
          const dateCheck = validate(dateSchema, args.date);
          if (!dateCheck.success) return this.errorResponse(dateCheck.error);
        }
        const reportDate = args.date || ReportManager.formatDate();

        let commits = [];
        let todayWorkAreas = null;
        let gitError = null;
        try {
          commits = await GitUtils.getTodayCommits(getRepoPath());
          if (commits.length > 0) {
            // Analyze today's code changes
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            todayWorkAreas = await GitUtils.analyzeWorkAreas(today.toISOString().split('T')[0], getRepoPath());
          }
        } catch (err) { gitError = err.message; }

        let completed = [];
        let inProgress = [];
        let overdue = [];
        let criticalPending = [];
        let jiraError = null;
        const now = new Date();
        try {
          const client = getJiraClient();
          const result = await client.searchTickets(`assignee = currentUser() AND updated >= "${reportDate}" ORDER BY updated DESC`);
          completed = result.tickets.filter(t => t.statusCategory === "Done" || t.status === "Done");
          inProgress = result.tickets.filter(t => t.status === "In Progress");

          // Also fetch all open tickets to find overdue/critical items not updated today
          const allOpenResult = await client.searchTickets(
            "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, duedate ASC"
          );
          overdue = allOpenResult.tickets.filter(t => t.dueDate && new Date(t.dueDate) < now);
          criticalPending = allOpenResult.tickets.filter(t =>
            (t.priority === "Highest" || t.priority === "High") &&
            t.statusCategory !== "Done"
          );
        } catch (err) {
          jiraError = err.message;
        }

        const carryForward = ReportManager.getYesterdayCarryForward().filter(item => !completed.some(t => item.includes(t.key)));
        for (const t of inProgress) {
          const entry = `${t.key}: ${t.summary}`;
          if (!carryForward.includes(entry)) carryForward.push(entry);
        }

        // Build blockers list for EOD
        const blockers = [];
        for (const t of inProgress) {
          const nameBlocked = (t.summary + ' ' + t.status).toLowerCase().includes('blocked');
          const labelBlocked = (t.labels || []).some(l => l.toLowerCase() === 'blocked');
          const linkBlocked = (t.issueLinks || []).some(link =>
            link.description?.toLowerCase().includes('is blocked by') && link.linkedStatus !== 'Done'
          );
          if (nameBlocked || labelBlocked || linkBlocked) {
            blockers.push(`${t.key}: ${t.summary} (BLOCKED)`);
          }
        }

        // Parse non-ticket work
        const extraWork = [];
        if (args.extra_work) {
          const entries = args.extra_work.split(',').map(e => e.trim()).filter(Boolean);
          extraWork.push(...entries);
        }

        // Include journal entries from today as extra context
        try {
          const todayJournal = MemoryManager.getJournalForDate(reportDate);
          for (const j of todayJournal) {
            const jText = j.text;
            // Don't duplicate if already in extraWork
            if (!extraWork.some(w => w.includes(jText)) && !completed.some(t => jText.includes(t.key))) {
              extraWork.push(`[Journal] ${jText}`);
            }
          }
        } catch (memErr) {
          // Non-fatal
        }

        let notes = '';
        if (commits.length > 0) notes += `${commits.length} commit(s) made today. `;
        if (completed.length > 0) notes += `${completed.length} ticket(s) completed. `;
        if (extraWork.length > 0) notes += `${extraWork.length} non-ticket activities logged. `;
        if (jiraError) notes += `[Jira was unavailable: ${jiraError}]`;
        if (!jiraError && gitError) notes += `[Git was unavailable: ${gitError}]`;
        if (!notes) notes = 'Quiet day.';

        const report = ReportManager.generateDailyReport(reportDate, {
          completed: [
            ...completed.map(t => `${t.key}: ${t.summary}`),
            ...extraWork.map(w => `[Non-ticket] ${w}`),
          ],
          inProgress: inProgress.map(t => `${t.key}: ${t.summary}`),
          commits,
          carryForward,
          blockers,
          notes,
        });

        const reportPath = ReportManager.saveReport(reportDate, report);

        let out = `End-of-Day Report — ${reportDate}\n\nSaved to: ${reportPath}\n\n`;

        // Summary
        out += `SUMMARY:\n`;
        out += `- ${commits.length} commit(s)\n`;
        out += `- ${completed.length} ticket(s) completed\n`;
        if (extraWork.length > 0) out += `- ${extraWork.length} non-ticket activit${extraWork.length === 1 ? 'y' : 'ies'}\n`;
        out += `- ${inProgress.length} ticket(s) in progress\n`;
        out += `- ${carryForward.length} item(s) carry forward\n`;

        // Critical/Overdue flagging
        if (overdue.length > 0 || criticalPending.length > 0 || blockers.length > 0) {
          out += `\nATTENTION NEEDED:\n`;
          if (overdue.length > 0) {
            out += `  OVERDUE (${overdue.length}):\n`;
            for (const t of overdue) out += `    - ${t.key}: ${t.summary} (due ${t.dueDate})\n`;
          }
          if (criticalPending.length > 0) {
            const critNotDone = criticalPending.filter(t => !overdue.some(o => o.key === t.key));
            if (critNotDone.length > 0) {
              out += `  HIGH PRIORITY PENDING (${critNotDone.length}):\n`;
              for (const t of critNotDone) out += `    - ${t.key}: ${t.summary} [${t.priority}]\n`;
            }
          }
          if (blockers.length > 0) {
            out += `  BLOCKERS (${blockers.length}):\n`;
            for (const b of blockers) out += `    - ${b}\n`;
          }
        }

        // Code changes summary
        if (todayWorkAreas && todayWorkAreas.totalCommits > 0) {
          out += `\nCODE CHANGES TODAY:\n`;
          out += `  ${todayWorkAreas.totalCommits} commit(s), +${todayWorkAreas.totalInsertions}/-${todayWorkAreas.totalDeletions} lines\n`;

          const sortedAreas = Object.entries(todayWorkAreas.areas)
            .sort((a, b) => (b[1].insertions + b[1].deletions) - (a[1].insertions + a[1].deletions));

          if (sortedAreas.length > 0) {
            out += `  Areas:\n`;
            for (const [area, data] of sortedAreas.slice(0, 6)) {
              out += `    ${area} — ${data.fileCount} file(s), +${data.insertions}/-${data.deletions}\n`;
            }
          }
          if (todayWorkAreas.topFiles.length > 0) {
            out += `  Top files:\n`;
            for (const f of todayWorkAreas.topFiles.slice(0, 5)) {
              out += `    ${f.path} (+${f.insertions}/-${f.deletions})\n`;
            }
          }
        }

        // Non-ticket work
        if (extraWork.length > 0) {
          out += `\nNON-TICKET WORK:\n`;
          for (const w of extraWork) out += `  - ${w}\n`;
        }

        if (jiraError) out += `\n[Jira was unavailable — report based on Git data only]\n`;
        if (gitError) out += `\n[Git was unavailable — commit section may be incomplete]\n`;

        out += `\nTip: Tomorrow, say "plan my day" to start with a prioritized plan.\n`;

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
