const BaseSkill = require("./Core/BaseSkill");
const { validate, ticketKeySchema } = require("../Utils/validators");
const OfflineQueue = require("../Services/offline-queue");
const { JiraNetworkError } = require("../Utils/errors");

class JiraWriteSkill extends BaseSkill {
  constructor() {
    super();
    this.name = "JiraWriteSkill";
  }

  getTools() {
    return [
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
    const { getJiraClient, config, preferences } = context;

    switch (name) {
      case "transition_ticket": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return this.errorResponse(keyCheck.error);

        const client = getJiraClient();

        if (!args.status) {
          try {
            const transitions = await client.getTransitions(args.ticket_key);
            if (transitions.length === 0) {
              return this.textResponse(`No transitions available for ${args.ticket_key}. The ticket may already be in a final state.`);
            }
            let out = `Available transitions for ${args.ticket_key}:\n\n`;
            for (const t of transitions) {
              out += `  - "${t.name}" → ${t.to}\n`;
            }
            out += `\nUse transition_ticket with the status name to move the ticket.\n`;
            return this.textResponse(out);
          } catch (err) {
            if (err instanceof JiraNetworkError) {
              return this.textResponse(`You are offline. Cannot fetch available transitions for ${args.ticket_key}. Specify the target status manually to queue the action.`);
            }
            throw err;
          }
        }

        try {
          const result = await client.transitionTicket(args.ticket_key, args.status);
          return this.textResponse(`${args.ticket_key} moved to "${result.to}" (transition: ${result.transitionName})`);
        } catch (err) {
          if (err instanceof JiraNetworkError) {
            OfflineQueue.addAction({ type: "transition_ticket", args });
            return this.textResponse(`You are offline. Transition to "${args.status}" for ${args.ticket_key} has been queued and will be synced later.`);
          }
          throw err;
        }
      }

      case "add_comment": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return this.errorResponse(keyCheck.error);
        if (!args.comment || !args.comment.trim()) return this.errorResponse("Comment text is required.");

        const client = getJiraClient();
        try {
          const result = await client.addComment(args.ticket_key, args.comment);
          return this.textResponse(`Comment added to ${args.ticket_key} by ${result.author} at ${result.created}`);
        } catch (err) {
          if (err instanceof JiraNetworkError) {
            OfflineQueue.addAction({ type: "add_comment", args });
            return this.textResponse(`You are offline. Your comment on ${args.ticket_key} has been queued and will be synced later.`);
          }
          throw err;
        }
      }

      case "assign_ticket": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return this.errorResponse(keyCheck.error);

        const client = getJiraClient();
        let accountId = args.account_id || null;

        if (args.assign_to_me) {
          try {
            const me = await client.testConnection();
            accountId = me.accountId;
          } catch (err) {
            if (err instanceof JiraNetworkError) {
              return this.textResponse("You are offline. Cannot fetch your account ID for 'assign_to_me'. Please provide account_id manually to queue the action.");
            }
            throw err;
          }
        }

        if (!accountId && !args.assign_to_me) {
          return this.errorResponse("Provide account_id or set assign_to_me=true. Use search_users to find account IDs.");
        }

        try {
          const result = await client.assignTicket(args.ticket_key, accountId);
          return this.textResponse(`${args.ticket_key} assigned to ${result.assignedTo}`);
        } catch (err) {
          if (err instanceof JiraNetworkError) {
            OfflineQueue.addAction({ type: "assign_ticket", args: { ticket_key: args.ticket_key, account_id: accountId } });
            return this.textResponse(`You are offline. Assignment of ${args.ticket_key} has been queued and will be synced later.`);
          }
          throw err;
        }
      }

      case "create_ticket": {
        if (!args.summary || !args.summary.trim()) return this.errorResponse("Summary is required.");

        const project = args.project || preferences.last_project;
        if (!project) return this.errorResponse("Project key is required. Use list_projects to see available projects, or set_preferences to save a default.");

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
            return this.errorResponse(`Invalid custom_fields JSON: ${e.message}`);
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
          return this.textResponse(out);
        } catch (err) {
          if (err instanceof JiraNetworkError) {
            OfflineQueue.addAction({ type: "create_ticket", args: { project, summary: args.summary, type: args.type || 'Task', description: args.description || '', priority: args.priority || 'Medium', extras } });
            return this.textResponse(`You are offline. Creation of ticket "${args.summary}" has been queued and will be synced later.`);
          }
          if (err.name === 'JiraConnectionError' && err.details?.status === 400) {
            const body = err.details?.body || '';
            return this.errorResponse(`Failed to create ticket (400 Bad Request). This usually means required fields are missing.\nError from Jira: ${body}\n\nTip: Use the 'get_create_meta' tool to find required custom fields for '${args.type || 'Task'}', then pass them as a JSON string in the 'custom_fields' property.`);
          }
          throw err;
        }
      }

      case "get_create_meta": {
        const client = getJiraClient();
        const data = await client.getCreateMeta(args.project, args.type);
        const proj = data.projects?.[0];
        if (!proj) return this.errorResponse(`Project ${args.project} not found or no permissions.`);
        const typeMeta = proj.issuetypes?.find(it => it.name === args.type);
        if (!typeMeta) return this.errorResponse(`Issue type ${args.type} not found in project ${args.project}. Available: ${proj.issuetypes.map(it => it.name).join(', ')}`);
        
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
        
        return this.textResponse(out);
      }

      case "search_users": {
        if (!args.query || !args.query.trim()) return this.errorResponse("Search query is required.");

        const client = getJiraClient();
        const users = await client.searchUsers(args.query);

        if (users.length === 0) {
          return this.textResponse(`No users found matching "${args.query}".`);
        }

        let out = `Users matching "${args.query}":\n\n`;
        for (const u of users) {
          out += `  - ${u.displayName}`;
          if (u.email) out += ` (${u.email})`;
          out += `\n    Account ID: ${u.accountId}`;
          if (!u.active) out += ` [INACTIVE]`;
          out += `\n`;
        }
        return this.textResponse(out);
      }

      case "log_work": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return this.errorResponse(keyCheck.error);
        if (!args.time_spent || !args.time_spent.trim()) return this.errorResponse("time_spent is required (e.g. '2h', '1d', '30m').");

        const client = getJiraClient();
        try {
          const result = await client.logWork(args.ticket_key, args.time_spent, args.comment || '');
          return this.textResponse(`Logged ${result.timeSpent} on ${args.ticket_key} by ${result.author}`);
        } catch (err) {
          if (err instanceof JiraNetworkError) {
            OfflineQueue.addAction({ type: "log_work", args });
            return this.textResponse(`You are offline. Logging ${args.time_spent} on ${args.ticket_key} has been queued and will be synced later.`);
          }
          throw err;
        }
      }

      default:
        return null;
    }
  }

  getPrompt() {
    return (
      this.loadPromptChunk("jira_write.md") ||
      `### Ticket Actions (Write)
For writing to Jira, always make sure to queue offline actions automatically if the network fails.
- Use \`transition_ticket\` to change status.
- Use \`add_comment\` for updates.
- Use \`assign_ticket\` for handoffs (\`search_users\` if you need the account ID).
- Use \`create_ticket\` for new items.
- Use \`log_work\` for tracking hours.`
    );
  }
}

module.exports = JiraWriteSkill;
