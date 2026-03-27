const BaseSkill = require("./Core/BaseSkill");
const { validate, ticketKeySchema } = require("../Utils/validators");
const CONST = require("../Constants/constants");

function isTicketBlocked(ticket) {
  const nameBlocked = (ticket.summary + ' ' + ticket.status).toLowerCase().includes('blocked');
  const labelBlocked = (ticket.labels || []).some(l => l.toLowerCase() === 'blocked');
  const linkBlocked = (ticket.issueLinks || []).some(link =>
    link.description?.toLowerCase().includes('is blocked by') &&
    link.linkedStatus !== 'Done'
  );
  return nameBlocked || labelBlocked || linkBlocked;
}

class JiraReadSkill extends BaseSkill {
  constructor() {
    super();
    this.name = "JiraReadSkill";
  }

  getTools() {
    return [
      {
        name: "fetch_jira_tickets",
        description: "Search Jira tickets with JQL filters: assignee, status, sprint, updated date range.",
        inputSchema: {
          type: "object",
          properties: {
            assignee: { type: "string", description: "Filter by assignee (or 'currentUser')" },
            status: { type: "string", description: "Comma-separated statuses (e.g. 'To Do,In Progress')" },
            sprint: { type: "string", description: "Sprint name" },
            project: { type: "string", description: "Project key (e.g. CMDN). Required when querying a specific project." },
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
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project key to filter by (e.g. CMDN). Uses last project if omitted." },
          },
        },
      },
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
        description: "Interactive ticket search with categorized output. Requires project, sprint, and assignee.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project key" },
            sprint: { type: "string", description: "Sprint name" },
            assignee: { type: "string", description: "Assignee" },
            status: { type: "string", description: "Comma-separated statuses" },
            priority: { type: "string", description: "Filter by priority" },
          },
        },
      },
      {
        name: "get_ticket_suggestions",
        description: "Analyze assigned tickets and provide intelligent suggestions on what to work on next.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project key" },
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
        name: "list_tickets",
        description: "List Jira tickets with flexible filters. Simpler alternative to smart_ticket_query.",
        inputSchema: {
          type: "object",
          properties: {
            assignee: { type: "string", description: "Filter by assignee" },
            status: { type: "string", description: "Comma-separated statuses" },
            priority: { type: "string", description: "Comma-separated priorities" },
            project: { type: "string", description: "Project key" },
            component: { type: "string", description: "Filter by component name (e.g. iOS, Android)" },
            sprint: { type: "string", description: "Sprint name" },
            type: { type: "string", description: "Issue type filter" },
            updated_since: { type: "string", description: "Updated since" },
            due_this_week: { type: "boolean", description: "Only show tickets due this week" },
            include_done: { type: "boolean", description: "Include completed tickets (default: false)" },
            jql: { type: "string", description: "Raw JQL" },
            max_results: { type: "number", description: "Max results" },
            start_at: { type: "number", description: "Pagination offset" },
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
    const { getJiraClient, preferences, savePreferences } = context;

    switch (name) {
      case "fetch_jira_tickets": {
        const client = getJiraClient();
        let jqlString;

        if (args.jql) {
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
          const fetchProject = args.project || preferences.last_project;
          if (fetchProject) {
            clauses.push(`project = "${fetchProject}"`);
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
          jqlString =
            clauses.length > 0
              ? clauses.join(" AND ") + " ORDER BY updated DESC"
              : "assignee = currentUser() ORDER BY updated DESC";
        }

        const result = await client.searchTickets(jqlString, [...CONST.JIRA_DEFAULT_FIELDS, 'issuetype'], CONST.JIRA_MAX_RESULTS, null);
        const tickets = result.tickets;

        let out = `Found ${tickets.length} ticket(s)`;
        if (!result.isLast) out += ` (more results available — use a narrower filter to see all)`;
        out += `\nQuery: ${jqlString}\n\n`;

        // Warn if results don't match the requested project
        const requestedProject = args.project || preferences.last_project;
        if (requestedProject && tickets.length > 0) {
          const wrongProject = tickets.filter(t => !t.key.startsWith(requestedProject + '-'));
          if (wrongProject.length > 0) {
            out += `WARNING: ${wrongProject.length} ticket(s) returned from a different project (expected ${requestedProject}). Check that the project key is correct.\n\n`;
          }
        }

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
        return this.textResponse(out);
      }

      case "get_ticket_details": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return this.errorResponse(keyCheck.error);

        const client = getJiraClient();
        const t = await client.getTicket(args.ticket_key);

        let out = `${t.key}: ${t.summary}\n\n`;
        out += `Status: ${t.status} | Priority: ${t.priority} | Assignee: ${t.assignee}\n`;
        if (t.dueDate) out += `Due: ${t.dueDate}\n`;
        if (t.labels.length > 0) out += `Labels: ${t.labels.join(", ")}\n`;
        out += `\nDescription:\n${t.description}\n`;

        if (t.subtasks.length > 0) {
          out += `\nSubtasks (${t.subtasks.length}):\n`;
          for (const st of t.subtasks) out += `  - ${st.key}: ${st.summary} [${st.status}]\n`;
        }

        if (t.issueLinks.length > 0) {
          out += `\nLinked Issues:\n`;
          for (const link of t.issueLinks) out += `  - ${link.description}: ${link.linkedKey} [${link.linkedStatus}]\n`;
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
        return this.textResponse(out);
      }

      case "analyze_workload": {
        const client = getJiraClient();
        const workloadProject = args.project || preferences.last_project;
        const workloadClauses = ['assignee = currentUser()'];
        if (workloadProject) workloadClauses.push(`project = "${workloadProject}"`);
        const workloadJql = workloadClauses.join(' AND ') + ' ORDER BY priority DESC, duedate ASC';
        const result = await client.searchTickets(workloadJql);
        const tickets = result.tickets;
        const now = new Date();

        const cat = { done: [], inProgress: [], notStarted: [], blocked: [], overdue: [] };

        for (const t of tickets) {
          const dueDate = t.dueDate ? new Date(t.dueDate) : null;
          const overdue = dueDate && dueDate < now && t.statusCategory !== "Done";

          if (t.statusCategory === "Done" || t.status === "Done") cat.done.push(t);
          else if (isTicketBlocked(t)) cat.blocked.push(t);
          else if (overdue) cat.overdue.push(t);
          else if (t.status === "In Progress") cat.inProgress.push(t);
          else cat.notStarted.push(t);
        }

        const fmt = (arr) => arr.length > 0 ? arr.map(t => `${t.key}: ${t.summary}`).join(", ") : "None";

        let out = `Workload Analysis (${tickets.length} shown${!result.isLast ? ', more available' : ''})\n\n`;
        out += `Done (${cat.done.length}): ${fmt(cat.done)}\n`;
        out += `In Progress (${cat.inProgress.length}): ${fmt(cat.inProgress)}\n`;
        out += `Not Started (${cat.notStarted.length}): ${fmt(cat.notStarted)}\n`;
        out += `Blocked (${cat.blocked.length}): ${fmt(cat.blocked)}\n`;
        out += `Overdue (${cat.overdue.length}): ${fmt(cat.overdue)}\n`;

        out += `\n--- Insights ---\n`;
        if (cat.overdue.length > 0) out += `OVERDUE: ${cat.overdue.map(t => `${t.key} (due ${t.dueDate})`).join(", ")}\n`;
        if (cat.blocked.length > 0) {
          for (const t of cat.blocked) {
            const blockers = (t.issueLinks || []).filter(l => l.description?.toLowerCase().includes("is blocked by")).map(l => l.linkedKey);
            out += `BLOCKED: ${t.key} — blocked by: ${blockers.join(", ") || "flagged/labeled"}\n`;
          }
        }
        if (cat.inProgress.length > 0) out += `\nRecommended focus: ${cat.inProgress[0].key} (${cat.inProgress[0].summary})\n`;
        else if (cat.overdue.length > 0) out += `\nRecommended focus: ${cat.overdue[0].key} (OVERDUE)\n`;
        else if (cat.notStarted.length > 0) out += `\nRecommended next: ${cat.notStarted[0].key} (${cat.notStarted[0].summary})\n`;

        return this.textResponse(out);
      }

      case "list_projects": {
        const client = getJiraClient();
        const projects = await client.getProjects();
        if (projects.length === 0) return this.textResponse("No Jira projects found. Check your permissions.");

        let out = `Available Projects (${projects.length})\n\n`;
        for (const p of projects) {
          const isCurrent = preferences.last_project === p.key ? ' (current)' : '';
          out += `  ${p.key}: ${p.name}${isCurrent}\n`;
        }

        if (preferences.last_project) out += `\nLast used project: ${preferences.last_project}\n`;
        out += `\nTo select a project, use 'set_preferences' with project key.\nThen use 'list_sprints' to see active sprints.\n`;
        return this.textResponse(out);
      }

      case "list_sprints": {
        const projectKey = args.project_key || preferences.last_project;
        if (!projectKey) return this.errorResponse("No project specified. Use 'list_projects' first or pass project_key.");

        const client = getJiraClient();
        let boards;
        try { boards = await client.getBoards(projectKey); } catch (err) { return this.errorResponse(`Could not fetch boards: ${err.message}`); }
        if (boards.length === 0) return this.errorResponse(`No boards found for project ${projectKey}.`);

        let allSprints = [];
        let out = `Sprints for ${projectKey}:\n\n`;

        for (const board of boards) {
          let sprints;
          try { sprints = await client.getSprints(board.id); } catch (err) { continue; }
          if (sprints.length > 0) {
            out += `--- Board: ${board.name} ---\n`;
            for (const s of sprints) {
              const isCurrent = preferences.last_sprint === s.name ? ' (current)' : '';
              const active = s.state === 'active' ? ' [ACTIVE]' : '';
              out += `  ${s.name}${active}${isCurrent}\n`;
              if (s.startDate && s.endDate) out += `    ${s.startDate.substring(0, 10)} to ${s.endDate.substring(0, 10)}\n`;
              allSprints.push(s);
            }
            out += `\n`;
          }
        }

        if (allSprints.length === 0) return this.textResponse(`No active or future sprints found for ${projectKey}.`);

        preferences.last_board_id = boards[0].id;
        if (!preferences.last_project || preferences.last_project !== projectKey) preferences.last_project = projectKey;
        savePreferences();

        out += `\nTo select a sprint, use 'set_preferences' with sprint name.\nThen use 'smart_ticket_query' to view tickets in that sprint.\n`;
        return this.textResponse(out);
      }

      case "smart_ticket_query": {
        const client = getJiraClient();
        const project = args.project || preferences.last_project;
        const sprint = args.sprint || preferences.last_sprint;
        const assignee = args.assignee || preferences.last_assignee;

        const missing = [];
        if (!project) missing.push('project');
        if (!sprint) missing.push('sprint');
        if (!assignee) missing.push('assignee');

        if (missing.length > 0) {
          return this.textResponse(`Need details: ${missing.join(', ')}`);
        }

        const clauses = [`project = "${project}"`, `sprint = "${sprint}"`];
        if (assignee === 'currentUser') clauses.push('assignee = currentUser()');
        else if (assignee) clauses.push(`assignee = "${assignee}"`);
        
        if (args.status) {
          const statuses = args.status.split(",").map(s => `"${s.trim()}"`).join(",");
          clauses.push(`status in (${statuses})`);
        }
        if (args.priority) {
          const priorities = args.priority.split(",").map(p => `"${p.trim()}"`).join(",");
          clauses.push(`priority in (${priorities})`);
        }

        const jql = clauses.join(' AND ') + ' ORDER BY priority DESC, duedate ASC';
        const result = await client.searchTickets(jql, [...CONST.JIRA_DEFAULT_FIELDS, 'issuetype']);
        const tickets = result.tickets;

        if (tickets.length === 0) return this.textResponse(`No tickets found.\nQuery: ${jql}`);

        const categories = { Bug: [], Story: [], Task: [], 'Sub-task': [], Epic: [], Other: [] };
        const now = new Date();

        for (const t of tickets) {
          const type = t.issueType || 'Other';
          const cat = categories[type] || categories['Other'];
          cat.push(t);
        }

        let out = `Tickets Found: ${tickets.length}\nProject: ${project} | Sprint: ${sprint}\nQuery: ${jql}\n\n`;
        for (const [type, items] of Object.entries(categories)) {
          if (items.length === 0) continue;
          out += `--- ${type}s (${items.length}) ---\n`;
          for (const t of items) {
            const dueDate = t.dueDate ? new Date(t.dueDate) : null;
            const overdue = dueDate && dueDate < now && t.statusCategory !== 'Done';
            const overdueTag = overdue ? ' OVERDUE' : '';
            out += `  [${t.priority}] ${t.key}: ${t.summary}\n     Status: ${t.status}${overdueTag}`;
            if (t.dueDate) out += ` | Due: ${t.dueDate}`;
            out += `\n`;
          }
          out += `\n`;
        }
        return this.textResponse(out);
      }

      case "get_ticket_suggestions": {
        const client = getJiraClient();
        const project = args.project || preferences.last_project;

        const clauses = ['assignee = currentUser()', 'statusCategory != Done'];
        if (project) clauses.push(`project = "${project}"`);

        const jql = clauses.join(' AND ') + ' ORDER BY priority DESC, duedate ASC';
        const result = await client.searchTickets(jql, [...CONST.JIRA_DEFAULT_FIELDS, 'issuetype']);
        const tickets = result.tickets;

        if (tickets.length === 0) return this.textResponse("No open tickets assigned to you. You're all caught up!");

        const now = new Date();
        const scored = tickets.map(t => {
          let score = 0;
          if (t.priority === 'Highest') score += 50;
          else if (t.priority === 'High') score += 35;
          else if (t.priority === 'Medium') score += 20;
          
          if (t.dueDate) {
            const due = new Date(t.dueDate);
            const daysUntilDue = (due - now) / (1000 * 60 * 60 * 24);
            if (daysUntilDue < 0) score += 40;
            else if (daysUntilDue <= 1) score += 30;
            else if (daysUntilDue <= 3) score += 20;
          }
          if (t.status === 'In Progress') score += 25;
          if (t.issueType === 'Bug') score += 15;
          if (isTicketBlocked(t)) score -= 30;
          return { ...t, score };
        });

        scored.sort((a, b) => b.score - a.score);

        let out = `Ticket Suggestions (${scored.length} open tickets)\n\n--- Top Recommendations ---\n`;
        const top = scored.slice(0, 3);
        top.forEach((t, i) => {
          out += `  ${i + 1}. ${t.key}: ${t.summary}\n     [${t.priority}] ${t.issueType} | ${t.status}`;
          if (t.dueDate) out += ` | Due: ${t.dueDate}`;
          out += `\n\n`;
        });
        return this.textResponse(out);
      }

      case "select_ticket": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return this.errorResponse(keyCheck.error);

        const client = getJiraClient();
        const t = await client.getTicket(args.ticket_key);

        let out = `Selected Ticket: ${t.key}\n${'='.repeat(50)}\n\n`;
        out += `Title: ${t.summary}\nType: ${t.statusCategory} | Status: ${t.status} | Priority: ${t.priority}\n`;
        out += `Assignee: ${t.assignee}`;
        if (t.dueDate) out += ` | Due: ${t.dueDate}`;
        out += `\n\n--- Description ---\n${t.description}\n\n`;
        
        if (t.subtasks.length > 0) {
          out += `--- Subtasks (${t.subtasks.length}) ---\n`;
          for (const st of t.subtasks) out += `  [${st.status === 'Done' ? 'x' : ' '}] ${st.key}: ${st.summary} [${st.status}]\n`;
          out += `\n`;
        }

        if (t.comments.length > 0) {
          out += `--- Recent Comments ---\n`;
          for (const c of t.comments.slice(-3)) {
            out += `  ${c.author} (${c.created?.substring(0, 10)}):\n    ${(c.body || '').substring(0, 100)}...\n\n`;
          }
        }
        return this.textResponse(out);
      }

      case "list_tickets": {
        const client = getJiraClient();
        let jqlString = args.jql;
        let resolvedProject = null; // hoisted so post-fetch validation can access it

        if (!jqlString) {
          const clauses = [];
          const assignee = args.assignee || 'me';
          if (assignee === 'me' || assignee === 'currentUser') clauses.push('assignee = currentUser()');
          else clauses.push(`assignee = "${assignee}"`);

          resolvedProject = args.project || preferences.last_project;

          // If the project value looks like a name/slug (contains dash or spaces, or is lowercase),
          // try to resolve it to a key via list_projects
          if (resolvedProject && !/^[A-Z][A-Z0-9]+$/.test(resolvedProject)) {
            try {
              const projects = await client.getProjects();
              const match = projects.find(p =>
                p.name.toLowerCase().replace(/[\s-]/g, '') === resolvedProject.toLowerCase().replace(/[\s-]/g, '') ||
                p.key.toLowerCase() === resolvedProject.toLowerCase()
              );
              if (match) {
                resolvedProject = match.key;
              } else {
                return this.errorResponse(
                  `Could not find a project matching "${resolvedProject}".\n` +
                  `Available projects: ${projects.map(p => `${p.key} (${p.name})`).join(', ')}`
                );
              }
            } catch (e) {
              // Proceed with the original value — better than blocking
            }
          }

          if (resolvedProject) clauses.push(`project = "${resolvedProject}"`);
          if (args.sprint) clauses.push(`sprint = "${args.sprint}"`);
          if (args.component) clauses.push(`component = "${args.component}"`);

          if (args.status) {
            const statuses = args.status.split(",").map(s => `"${s.trim()}"`).join(",");
            clauses.push(`status in (${statuses})`);
          }
          if (!args.include_done && !args.status) clauses.push('statusCategory != Done');
          if (args.priority) {
            const priorities = args.priority.split(",").map(p => `"${p.trim()}"`).join(",");
            clauses.push(`priority in (${priorities})`);
          }
          if (args.type) clauses.push(`issuetype = "${args.type}"`);
          if (args.updated_since) clauses.push(`updated >= "${args.updated_since}"`);
          if (args.due_this_week) clauses.push('duedate >= startOfWeek() AND duedate <= endOfWeek()');

          jqlString = clauses.join(' AND ') + ' ORDER BY priority DESC, duedate ASC';
        }

        const maxResults = args.max_results || CONST.JIRA_MAX_RESULTS;
        const result = await client.searchTickets(jqlString, [...CONST.JIRA_DEFAULT_FIELDS, 'issuetype'], maxResults, null);
        const tickets = result.tickets;

        if (tickets.length === 0) return this.textResponse(`No tickets found.\nQuery: ${jqlString}`);

        // Validate that returned tickets belong to the requested project
        const expectedProject = resolvedProject;
        if (expectedProject && tickets.length > 0) {
          const wrongProject = tickets.filter(t => !t.key.startsWith(expectedProject + '-'));
          if (wrongProject.length > 0) {
            return this.errorResponse(
              `WARNING: Results contain ${wrongProject.length} ticket(s) NOT from project ${expectedProject} ` +
              `(e.g. ${wrongProject[0].key}). The project key may be wrong or stale.\n` +
              `Query used: ${jqlString}\n` +
              `Please verify the project key via 'list_projects' and retry.`
            );
          }
        }

        const now = new Date();
        let out = `Prioritized Ticket List:\n\nQuery: ${jqlString}\n\n`;
        for (const t of tickets) {
          const dueDate = t.dueDate ? new Date(t.dueDate) : null;
          const overdue = dueDate && dueDate < now && t.statusCategory !== 'Done';
          const dueFmt = t.dueDate ? ` (Due: ${t.dueDate})` : '';
          out += `- [${t.priority}] ${t.key}: ${t.summary}${dueFmt}${overdue ? ' [OVERDUE]' : ''}\n`;
          out += `   Status: ${t.status} | Type: ${t.issueType || 'Task'} | Assignee: ${t.assignee}\n`;
        }

        out += `\nShowing ${tickets.length} ticket(s).\n`;
        return this.textResponse(out);
      }

      default:
        return null;
    }
  }

  getPrompt() {
    return (
      this.loadPromptChunk("jira_read.md") ||
      "### Ticket Queries (Read)\n" +
        "- Use `list_tickets` for direct queries filtering by status, priority, etc.\n" +
        "- Use `smart_ticket_query` when examining sprints.\n" +
        "- Use `get_ticket_details` before attempting any updates to ensure context."
    );
  }
}

module.exports = JiraReadSkill;
