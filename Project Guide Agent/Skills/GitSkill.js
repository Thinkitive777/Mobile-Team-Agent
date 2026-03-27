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
        description: "Fetch recent git commits with automatic Jira ticket linking and code change analysis (files changed, lines added/removed, work areas).",
        inputSchema: {
          type: "object",
          properties: {
            since: { type: "string", description: "Time period (default: '48 hours ago')" },
            include_diffs: { type: "boolean", description: "Include file-level diff stats per commit (default: true)" },
            include_areas: { type: "boolean", description: "Include work area analysis — which parts of the codebase were touched (default: true)" },
          },
        },
      },
      {
        name: "get_commit_details",
        description: "Get full details for a specific commit: diff stats, actual code changes (patch), files modified, and linked Jira tickets.",
        inputSchema: {
          type: "object",
          properties: {
            commit_hash: { type: "string", description: "Commit hash (short or full)" },
          },
          required: ["commit_hash"],
        },
      }
    ];
  }

  textResponse(msg) {
    return { content: [{ type: "text", text: msg }] };
  }

  async handleTool(name, args, context) {
    const { getRepoPath } = context;

    switch (name) {
      case "get_recent_commits": {
        const since = args.since || CONST.GIT_DEFAULT_SINCE;
        const includeDiffs = args.include_diffs !== false;
        const includeAreas = args.include_areas !== false;

        let commits;
        if (includeDiffs) {
          commits = await GitUtils.getCommitsWithDiffs(since, getRepoPath());
        } else {
          commits = await GitUtils.getRecentCommits(since, getRepoPath());
        }

        if (commits.length === 0) {
          return this.textResponse(`No commits found since ${since}.`);
        }

        let out = `Recent Commits (${since}) — ${commits.length} total\n\n`;
        for (const c of commits) {
          out += `${c.hash}: ${c.message}\n`;
          if (c.ticketIds.length > 0) out += `   Tickets: ${c.ticketIds.join(", ")}\n`;
          out += `   ${c.author} @ ${c.datetime}\n`;

          // Include diff stats if available
          if (includeDiffs && c.diffStats && c.diffStats.files.length > 0) {
            out += `   Changes: +${c.diffStats.totalInsertions}/-${c.diffStats.totalDeletions} in ${c.diffStats.files.length} file(s)\n`;
            for (const f of c.diffStats.files.slice(0, 5)) {
              out += `     ${f.path} (+${f.insertions}/-${f.deletions})\n`;
            }
            if (c.diffStats.files.length > 5) {
              out += `     ... and ${c.diffStats.files.length - 5} more file(s)\n`;
            }
          }
          out += `\n`;
        }

        // Work area analysis
        if (includeAreas) {
          try {
            const analysis = await GitUtils.analyzeWorkAreas(since, getRepoPath());
            if (Object.keys(analysis.areas).length > 0) {
              out += `--- Work Areas ---\n`;
              out += `Total: +${analysis.totalInsertions}/-${analysis.totalDeletions} across ${analysis.totalCommits} commit(s)\n\n`;

              const sortedAreas = Object.entries(analysis.areas)
                .sort((a, b) => (b[1].insertions + b[1].deletions) - (a[1].insertions + a[1].deletions));

              for (const [area, data] of sortedAreas.slice(0, 8)) {
                out += `  ${area}: ${data.fileCount} file(s), +${data.insertions}/-${data.deletions}, ${data.commits} commit(s)\n`;
              }

              if (analysis.topFiles.length > 0) {
                out += `\n--- Most Changed Files ---\n`;
                for (const f of analysis.topFiles.slice(0, 5)) {
                  out += `  ${f.path}: +${f.insertions}/-${f.deletions} (${f.commitCount} commit(s))\n`;
                }
              }
            }
          } catch (areaErr) {
            // Non-fatal — just skip area analysis
          }
        }

        return this.textResponse(out);
      }

      case "get_commit_details": {
        const hash = args.commit_hash;
        if (!hash || !hash.trim()) {
          return this.textResponse('Error: commit_hash is required.');
        }

        // Get the commit info
        const repoPath = getRepoPath();
        const stats = await GitUtils.getCommitDiffStats(hash, repoPath);
        const diff = await GitUtils.getCommitDiff(hash, repoPath);

        if (!diff && stats.files.length === 0) {
          return this.textResponse(`No data found for commit ${hash}. Check that the hash is correct.`);
        }

        let out = `Commit Details: ${hash}\n${'='.repeat(50)}\n\n`;

        if (stats.files.length > 0) {
          out += `Files Changed: ${stats.files.length}\n`;
          out += `Total: +${stats.totalInsertions}/-${stats.totalDeletions} lines\n\n`;
          out += `--- Files ---\n`;
          for (const f of stats.files) {
            out += `  ${f.path} (+${f.insertions}/-${f.deletions})\n`;
          }
          out += `\n`;
        }

        if (diff) {
          out += `--- Diff ---\n`;
          out += diff;
        }

        // Extract ticket IDs from the diff context
        const ticketIds = GitUtils.extractTicketIds(diff);
        if (ticketIds.length > 0) {
          out += `\n\n--- Referenced Tickets ---\n`;
          out += ticketIds.join(', ') + '\n';
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
