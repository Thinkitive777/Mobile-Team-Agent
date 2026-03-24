const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execPromise = promisify(exec);

class GitUtils {
  static async getRecentCommits(since = '48 hours ago', repoPath = process.cwd()) {
    try {
      const { stdout } = await execPromise(
        `git -C "${repoPath}" log --since="${since}" --format="%H|%s|%ai|%an" --all`,
        { maxBuffer: 1024 * 1024 }
      );

      if (!stdout.trim()) {
        return [];
      }

      return stdout
        .trim()
        .split('\n')
        .map(line => {
          const [hash, message, datetime, author] = line.split('|');
          return {
            hash: hash.substring(0, 7),
            message,
            datetime,
            author,
            ticketIds: GitUtils.extractTicketIds(message),
          };
        });
    } catch (error) {
      if (error.message.includes('not a git repository')) {
        return [];
      }
      throw new Error(`Git log error: ${error.message}`);
    }
  }

  static extractTicketIds(text) {
    const regex = /[A-Z]+-\d+/g;
    const matches = text.match(regex) || [];
    return [...new Set(matches)]; // Remove duplicates
  }

  static async getTodayCommits(repoPath = process.cwd()) {
    try {
      // Get today's date at midnight
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayString = today.toISOString().split('T')[0]; // YYYY-MM-DD format

      const { stdout } = await execPromise(
        `git -C "${repoPath}" log --since="${todayString}" --format="%H|%s|%ai|%an" --all`,
        { maxBuffer: 1024 * 1024 }
      );

      if (!stdout.trim()) {
        return [];
      }

      return stdout
        .trim()
        .split('\n')
        .map(line => {
          const [hash, message, datetime, author] = line.split('|');
          return {
            hash: hash.substring(0, 7),
            message,
            datetime,
            author,
            ticketIds: GitUtils.extractTicketIds(message),
          };
        });
    } catch (error) {
      if (error.message.includes('not a git repository')) {
        return [];
      }
      throw new Error(`Git log error: ${error.message}`);
    }
  }

  static linkCommitsToTickets(commits, ticketData) {
    const ticketMap = new Map();

    // Build map of ticket key -> ticket object
    ticketData.forEach(ticket => {
      ticketMap.set(ticket.key, ticket);
    });

    // Link commits to tickets
    const linkedTickets = {};
    commits.forEach(commit => {
      commit.ticketIds.forEach(ticketId => {
        if (!linkedTickets[ticketId]) {
          linkedTickets[ticketId] = {
            ticket: ticketMap.get(ticketId),
            commits: [],
          };
        }
        linkedTickets[ticketId].commits.push(commit);
      });
    });

    return linkedTickets;
  }

  static formatCommitLine(commit) {
    const ticketPart = commit.ticketIds.length > 0 ? ` [${commit.ticketIds.join(', ')}]` : '';
    return `- ${commit.hash}: ${commit.message}${ticketPart}`;
  }
}

module.exports = GitUtils;
