/// MARK: - Git Utilities
/// Shell-safe git operations: commit fetching, ticket ID extraction,
/// commit-to-ticket linking, and commit statistics.

const { execFile } = require('child_process');
const { promisify } = require('util');

const {
  GIT_DEFAULT_SINCE, GIT_MAX_BUFFER,
  GIT_SHORT_HASH_LENGTH, GIT_LOG_FORMAT, TICKET_ID_PATTERN,
  DIFF_MAX_COMMITS, DIFF_MAX_LINES_PER_COMMIT, DIFF_SUMMARY_MAX_FILES,
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

  // ── Commit content analysis ────────────────────────────────────────────

  /**
   * Get diff stats for a single commit: files changed, insertions, deletions.
   * Returns { files: [{path, insertions, deletions}], totalInsertions, totalDeletions }
   */
  static async getCommitDiffStats(commitHash, repoPath = process.cwd()) {
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', repoPath,
        'diff-tree', '--no-commit-id', '--numstat', '-r', commitHash,
      ], { maxBuffer: GIT_MAX_BUFFER });

      if (!stdout.trim()) return { files: [], totalInsertions: 0, totalDeletions: 0 };

      const files = [];
      let totalInsertions = 0;
      let totalDeletions = 0;

      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const [ins, del, filePath] = line.split('\t');
        const insertions = ins === '-' ? 0 : parseInt(ins, 10) || 0;
        const deletions = del === '-' ? 0 : parseInt(del, 10) || 0;
        files.push({ path: filePath, insertions, deletions });
        totalInsertions += insertions;
        totalDeletions += deletions;
      }

      return { files: files.slice(0, DIFF_SUMMARY_MAX_FILES), totalInsertions, totalDeletions };
    } catch (error) {
      Logger.debug('Failed to get commit diff stats', { hash: commitHash, error: error.message });
      return { files: [], totalInsertions: 0, totalDeletions: 0 };
    }
  }

  /**
   * Get the actual diff content (patch) for a single commit, truncated to max lines.
   * Returns the raw diff string.
   */
  static async getCommitDiff(commitHash, repoPath = process.cwd()) {
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', repoPath,
        'show', '--format=', '--stat', '--patch', commitHash,
      ], { maxBuffer: GIT_MAX_BUFFER });

      if (!stdout.trim()) return '';

      const lines = stdout.split('\n');
      if (lines.length > DIFF_MAX_LINES_PER_COMMIT) {
        return lines.slice(0, DIFF_MAX_LINES_PER_COMMIT).join('\n') +
          `\n... (truncated, ${lines.length - DIFF_MAX_LINES_PER_COMMIT} more lines)`;
      }
      return stdout;
    } catch (error) {
      Logger.debug('Failed to get commit diff', { hash: commitHash, error: error.message });
      return '';
    }
  }

  /**
   * Get enriched commits with diff stats for a time period.
   * Each commit gets: { ...commit, diffStats: { files, totalInsertions, totalDeletions } }
   */
  static async getCommitsWithDiffs(since = GIT_DEFAULT_SINCE, repoPath = process.cwd()) {
    const commits = await this.getRecentCommits(since, repoPath);
    const limited = commits.slice(0, DIFF_MAX_COMMITS);

    const enriched = [];
    for (const commit of limited) {
      const diffStats = await this.getCommitDiffStats(commit.fullHash, repoPath);
      enriched.push({ ...commit, diffStats });
    }

    return enriched;
  }

  /**
   * Analyze what areas of the codebase were worked on.
   * Groups files by directory/module and returns a summary.
   * Returns { areas: { "src/auth": { files, insertions, deletions } }, topFiles: [...] }
   */
  static async analyzeWorkAreas(since = GIT_DEFAULT_SINCE, repoPath = process.cwd()) {
    const commits = await this.getCommitsWithDiffs(since, repoPath);

    const areaMap = {};   // dir → { files: Set, insertions, deletions, commits }
    const fileMap = {};   // file → { insertions, deletions, commitCount }

    for (const commit of commits) {
      for (const file of commit.diffStats.files) {
        // Extract area (first 2 path segments, or just directory)
        const parts = file.path.split('/');
        const area = parts.length > 1 ? parts.slice(0, 2).join('/') : parts[0];

        if (!areaMap[area]) areaMap[area] = { files: new Set(), insertions: 0, deletions: 0, commits: 0 };
        areaMap[area].files.add(file.path);
        areaMap[area].insertions += file.insertions;
        areaMap[area].deletions += file.deletions;
        areaMap[area].commits++;

        if (!fileMap[file.path]) fileMap[file.path] = { insertions: 0, deletions: 0, commitCount: 0 };
        fileMap[file.path].insertions += file.insertions;
        fileMap[file.path].deletions += file.deletions;
        fileMap[file.path].commitCount++;
      }
    }

    // Convert Sets to counts and sort areas by total changes
    const areas = {};
    for (const [area, data] of Object.entries(areaMap)) {
      areas[area] = {
        fileCount: data.files.size,
        insertions: data.insertions,
        deletions: data.deletions,
        commits: data.commits,
      };
    }

    // Top files by total changes
    const topFiles = Object.entries(fileMap)
      .map(([path, stats]) => ({ path, ...stats, totalChanges: stats.insertions + stats.deletions }))
      .sort((a, b) => b.totalChanges - a.totalChanges)
      .slice(0, 10);

    return {
      totalCommits: commits.length,
      areas,
      topFiles,
      totalInsertions: commits.reduce((sum, c) => sum + c.diffStats.totalInsertions, 0),
      totalDeletions: commits.reduce((sum, c) => sum + c.diffStats.totalDeletions, 0),
    };
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
