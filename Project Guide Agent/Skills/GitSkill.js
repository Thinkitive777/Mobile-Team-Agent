/// MARK: - Git Skill
/// Exposes git commit history with automatic Jira ticket linking.

const BaseSkill = require("./Core/BaseSkill");
const GitUtils = require("../Utils/git-utils");
const CONST = require("../Constants/constants");

class GitSkill extends BaseSkill {
  constructor() {
    super();
    this.name = "GitSkill";
  }

  getTools() {
    return [
      {
        name: "get_recent_commits",
        description: "Fetch recent git commits with automatic Jira ticket linking.",
        inputSchema: {
          type: "object",
          properties: {
            since: { type: "string", description: "Time period (default: '48 hours ago')" },
          },
        },
      }
    ];
  }

  async handleTool(name, args, context) {
    const { getRepoPath } = context;

    switch (name) {
      case "get_recent_commits": {
        const since = args.since || CONST.GIT_DEFAULT_SINCE;
        const commits = await GitUtils.getRecentCommits(since, getRepoPath());

        if (commits.length === 0) {
          return this.textResponse(`No commits found since ${since}.`);
        }

        let out = `Recent Commits (${since}) — ${commits.length} total\n\n`;
        for (const c of commits) {
          out += `${c.hash}: ${c.message}\n`;
          if (c.ticketIds.length > 0) out += `   Tickets: ${c.ticketIds.join(", ")}\n`;
          out += `   ${c.author} @ ${c.datetime}\n\n`;
        }

        return this.textResponse(out);
      }

      default:
        return null;
    }
  }

  getPrompt() {
    return (
      this.loadPromptChunk("git.md") ||
      `### Git Commands
Git data is fetched automatically via \`morning_standup\` or \`end_of_day_report\`, but you can fetch manually via \`get_recent_commits\`.`
    );
  }
}

module.exports = GitSkill;
