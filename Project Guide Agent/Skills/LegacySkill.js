const BaseSkill = require("./Core/BaseSkill");
const OfflineQueue = require("../Services/offline-queue");
const { JiraNetworkError } = require("../Utils/errors");
const fs = require("fs");

class LegacySkill extends BaseSkill {
  constructor() {
    super();
    this.name = "LegacySkill";
  }

  getTools() {
    return [
      {
        name: "sync_offline_actions",
        description: "Retry queued Jira write actions that failed while offline.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "run_skill",
        description: "Execute a skill: developer-mode, file-info, or route to other tools.",
        inputSchema: {
          type: "object",
          properties: {
            skill: { type: "string" },
            args: { type: "string" },
          },
          required: ["skill"],
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
    const { getJiraClient, config, saveConfig } = context;

    switch (name) {
      case "sync_offline_actions": {
        const queue = OfflineQueue.getQueue();
        if (queue.length === 0) return this.textResponse("No offline actions in queue.");

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
        return this.textResponse(out);
      }

      case "run_skill": {
        const { skill, args: skillArgs } = args;

        if (skill === "developer-mode") {
          config.developer_mode = !config.developer_mode;
          saveConfig();
          return this.textResponse(`Developer Mode: ${config.developer_mode ? "ENABLED" : "DISABLED"}`);
        }

        if (skill === "file-info") {
          const targetPath = skillArgs || ".";
          try {
            const stats = fs.statSync(targetPath);
            return this.textResponse(
              `File: "${targetPath}"\nType: ${stats.isDirectory() ? "Directory" : "File"}\nSize: ${stats.size} bytes\nModified: ${stats.mtime.toISOString()}`
            );
          } catch (e) {
            return this.errorResponse(`File error: ${e.message}`);
          }
        }

        const skillRoutes = {
          'list-projects': 'list_projects', 'list_projects': 'list_projects', 'projects': 'list_projects', 'jira-projects': 'list_projects',
          'list-sprints': 'list_sprints', 'list_sprints': 'list_sprints', 'sprints': 'list_sprints',
          'list-tickets': 'list_tickets', 'list_tickets': 'list_tickets', 'tickets': 'list_tickets', 'my-tickets': 'list_tickets',
          'workload': 'analyze_workload', 'analyze-workload': 'analyze_workload',
          'standup': 'morning_standup', 'morning': 'morning_standup',
          'eod': 'end_of_day_report',
          'health': 'health_check', 'health-check': 'health_check',
          'suggestions': 'get_ticket_suggestions', 'suggest': 'get_ticket_suggestions',
          'status': 'get_setup_status', 'setup': 'get_setup_status',
          'preferences': 'set_preferences',
          'search-users': 'search_users', 'users': 'search_users',
        };

        const normalizedSkill = (skill || '').toLowerCase().trim();
        const routedTool = skillRoutes[normalizedSkill];

        if (routedTool) {
          return this.textResponse(`The skill "${skill}" maps to the tool "${routedTool}". Please call "${routedTool}" directly instead.`);
        }

        return this.errorResponse(`Unknown skill: "${skill}".`);
      }

      default:
        return null;
    }
  }

  getPrompt() {
    return this.loadPromptChunk("legacy.md");
  }
}

module.exports = LegacySkill;
