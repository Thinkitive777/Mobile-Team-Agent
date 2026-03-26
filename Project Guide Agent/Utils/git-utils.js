const { execFile } = require('child_process');
const { promisify } = require('util');

const {
  GIT_DEFAULT_SINCE, GIT_MAX_BUFFER,
  GIT_SHORT_HASH_LENGTH, GIT_LOG_FORMAT, TICKET_ID_PATTERN,
} = require('../Constants/constants');
const { GitError } = require('./errors');
const Logger = require('./logger');

const execFileAsync = promisify(execFile);

class GitUtils {
  /**
   * Get commits since a given time.
   * Uses execFile (not exec) to prevent shell injection.
   */
  static async getRecentCommits(since = GIT_DEFAULT_SINCE, repoPath = process.cwd()) {
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', repoPath,
        'log',
        `--since=${since}`,
        `--format=${GIT_LOG_FORMAT}`,
        '--all',
      ], { maxBuffer: GIT_MAX_BUFFER });

      if (!stdout.trim()) return [];

      return this._parseCommitOutput(stdout);
    } catch (error) {
      return this._handleGitError(error, 'getRecentCommits');
    }
  }

  /**
   * Get all commits made today (since midnight local time).
   */
  static async getTodayCommits(repoPath = process.cwd()) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    try {
      const { stdout } = await execFileAsync('git', [
        '-C', repoPath,
        'log',
        `--since=${todayStr}`,
        `--format=${GIT_LOG_FORMAT}`,
        '--all',
      ], { maxBuffer: GIT_MAX_BUFFER });

      if (!stdout.trim()) return [];

      return this._parseCommitOutput(stdout);
    } catch (error) {
      return this._handleGitError(error, 'getTodayCommits');
    }
  }

  /**
   * Get commit count stats for a period.
   */
  static async getCommitStats(since = '7 days ago', repoPath = process.cwd()) {
    try {
      const commits = await this.getRecentCommits(since, repoPath);
      const byAuthor = {};
      const byDay = {};

      for (const c of commits) {
        byAuthor[c.author] = (byAuthor[c.author] || 0) + 1;
        const day = c.datetime.split(' ')[0];
        byDay[day] = (byDay[day] || 0) + 1;
      }

      return {
        total: commits.length,
        byAuthor,
        byDay,
        ticketsMentioned: [...new Set(commits.flatMap(c => c.ticketIds))],
      };
    } catch (error) {
      Logger.warn('Failed to get commit stats', { error: error.message });
      return { total: 0, byAuthor: {}, byDay: {}, ticketsMentioned: [] };
    }
  }

  /**
   * Extract Jira-style ticket IDs from text.
   * Pattern: [A-Z][A-Z0-9]+-\d+  (e.g., PROJ-123, AB2-45)
   */
  static extractTicketIds(text) {
    if (!text) return [];
    const matches = text.match(TICKET_ID_PATTERN) || [];
    return [...new Set(matches)];
  }

  /**
   * Map commits to their linked tickets.
   */
  static linkCommitsToTickets(commits, ticketData) {
    const ticketMap = new Map();
    for (const t of ticketData) ticketMap.set(t.key, t);

    const linked = {};
    for (const commit of commits) {
      for (const id of commit.ticketIds) {
        if (!linked[id]) {
          linked[id] = { ticket: ticketMap.get(id) || null, commits: [] };
        }
        linked[id].commits.push(commit);
      }
    }
    return linked;
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  static _parseCommitOutput(stdout) {
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split('|');
      const hash = (parts[0] || '').substring(0, GIT_SHORT_HASH_LENGTH);
      const message = parts[1] || '';
      const datetime = parts[2] || '';
      const author = parts[3] || '';
      return {
        hash,
        fullHash: parts[0] || '',
        message,
        datetime,
        author,
        ticketIds: this.extractTicketIds(message),
      };
    });
  }

  static _handleGitError(error, method) {
    const msg = error.message || '';
    // Non-fatal: not a git repo, or no commits match
    if (msg.includes('not a git repository') ||
        msg.includes('does not have any commits') ||
        msg.includes('bad default revision')) {
      Logger.debug(`Git: no data (${method})`, { reason: msg.substring(0, 100) });
      return [];
    }
    Logger.error(`Git error in ${method}`, { error: msg.substring(0, 200) });
    throw new GitError(`Git operation failed: ${msg.substring(0, 150)}`);
  }
}

module.exports = GitUtils;
