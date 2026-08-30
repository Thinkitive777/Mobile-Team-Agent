/// MARK: - Git Utilities
/// Shell-safe git operations: commit fetching, ticket ID extraction,
/// commit-to-ticket linking, and commit statistics.

const { execFile } = require('child_process');
const { promisify } = require('util');

const {
  GIT_DEFAULT_SINCE, GIT_MAX_BUFFER, GIT_FETCH_TIMEOUT_MS,
  GIT_SHORT_HASH_LENGTH, GIT_LOG_FORMAT, TICKET_ID_PATTERN,
  DIFF_MAX_COMMITS, DIFF_MAX_LINES_PER_COMMIT, DIFF_SUMMARY_MAX_FILES,
} = require('../Constants/constants');
const { GitError } = require('./errors');
const Logger = require('./logger');

const execFileAsync = promisify(execFile);

// `git merge-tree --write-tree` — the read-only merge used for conflict
// prediction — landed in git 2.38. Below that the pre-PR check is refused.
const MERGE_TREE_MIN_GIT = [2, 38];

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

  // ── Pre-PR analysis: read-only branch & merge plumbing ────────────────
  //
  // Every method below is strictly read-only with respect to the working
  // tree. Only `rev-parse`, `merge-tree`, `diff`, `log`, `rev-list`,
  // `for-each-ref`, `merge-base` and `fetch` are used. `fetch` writes to
  // .git but never touches tracked files or uncommitted work.

  /**
   * Runs a git command without throwing on a non-zero exit.
   * Callers that care about failure inspect `code` themselves — merge-tree
   * uses exit 1 to mean "conflicts", which is a result, not an error.
   * @returns {Promise<{stdout: string, stderr: string, code: number}>}
   */
  static async _git(args, repoPath = process.cwd()) {
    try {
      const { stdout, stderr } = await execFileAsync(
        'git', ['-C', repoPath, ...args], { maxBuffer: GIT_MAX_BUFFER }
      );
      return { stdout: stdout || '', stderr: stderr || '', code: 0 };
    } catch (error) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        code: typeof error.code === 'number' ? error.code : 1,
      };
    }
  }

  /**
   * Verifies the repo can support a merge analysis before anything else runs.
   * A shallow clone makes merge-base silently wrong rather than failing, so
   * it is rejected outright instead of producing a confidently bad answer.
   * @returns {Promise<{ok: boolean, reason: string|null, shallow: boolean, gitVersion: string}>}
   */
  static async preflight(repoPath = process.cwd()) {
    const version = await this._git(['--version'], repoPath);
    const raw = (version.stdout.match(/\d+\.\d+(\.\d+)?/) || [''])[0];
    const [major, minor] = raw.split('.').map(Number);
    const fail = (reason) => ({ ok: false, reason, shallow: false, gitVersion: raw });

    if (version.code !== 0) return fail('git is not installed or not on PATH.');

    if (major < MERGE_TREE_MIN_GIT[0] ||
       (major === MERGE_TREE_MIN_GIT[0] && minor < MERGE_TREE_MIN_GIT[1])) {
      return fail(
        `git ${raw} is too old — merge analysis needs ${MERGE_TREE_MIN_GIT.join('.')} or newer ` +
        `(\`git merge-tree --write-tree\`). Upgrade git and retry.`
      );
    }

    const inRepo = await this._git(['rev-parse', '--is-inside-work-tree'], repoPath);
    if (inRepo.code !== 0 || inRepo.stdout.trim() !== 'true') {
      return fail(`Not a git repository: ${repoPath}`);
    }

    const shallow = await this._git(['rev-parse', '--is-shallow-repository'], repoPath);
    if (shallow.stdout.trim() === 'true') {
      return fail(
        'This is a shallow clone. Merge-base results would be wrong, so the check is ' +
        'refused rather than guessed. Run `git fetch --unshallow` first.'
      );
    }

    return { ok: true, reason: null, shallow: false, gitVersion: raw };
  }

  /**
   * Name of the branch currently checked out, or null on a detached HEAD.
   */
  static async currentBranch(repoPath = process.cwd()) {
    const res = await this._git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
    const name = res.stdout.trim();
    return (res.code === 0 && name && name !== 'HEAD') ? name : null;
  }

  /**
   * Resolves a user-supplied branch name to something git can actually use,
   * falling back to the remote-tracking copy when only that exists.
   * @returns {Promise<{ref: string, via: string}|null>} null when unresolvable.
   */
  static async resolveRef(ref, repoPath = process.cwd(), remote = 'origin') {
    if (!ref) return null;
    const candidates = [
      { ref, via: 'local branch' },
      { ref: `${remote}/${ref}`, via: `remote branch (${remote})` },
    ];
    for (const candidate of candidates) {
      const res = await this._git(
        ['rev-parse', '--verify', '--quiet', `${candidate.ref}^{commit}`], repoPath
      );
      if (res.code === 0 && res.stdout.trim()) return candidate;
    }
    return null;
  }

  /**
   * Updates remote-tracking refs so comparisons are not made against a stale
   * local copy of the target branch. Never touches the working tree.
   * Failure is non-fatal — offline should degrade, not abort.
   */
  static async fetchRemote(repoPath = process.cwd(), remote = 'origin') {
    const res = await this._git(['fetch', '--quiet', '--prune', remote], repoPath);
    if (res.code !== 0) {
      Logger.debug('Git: fetch failed, continuing with local refs', {
        reason: res.stderr.substring(0, 120),
      });
      return { ok: false, reason: res.stderr.trim().substring(0, 150) };
    }
    return { ok: true, reason: null };
  }

  /**
   * Fetches a pull request's head commit into FETCH_HEAD so its code can be
   * analysed locally. Works on private repos using the developer's existing
   * git credentials — no API token involved.
   */
  static async fetchPullRequest(number, repoPath = process.cwd(), remote = 'origin') {
    const localRef = `refs/mta/pr/${number}`;
    const res = await this._git(
      ['fetch', '--quiet', '--force', remote, `pull/${number}/head:${localRef}`], repoPath
    );
    if (res.code !== 0) {
      return { ok: false, ref: null, reason: res.stderr.trim().substring(0, 200) };
    }
    return { ok: true, ref: localRef, reason: null };
  }

  /**
   * Performs the merge entirely in the object database — nothing is checked
   * out, staged or written to the working tree.
   *
   * Output format (verified against git 2.50):
   *   line 0      tree OID
   *   lines 1..n  conflicted paths (--name-only), terminated by a blank line
   *   remainder   human-readable "Auto-merging" / "CONFLICT" detail
   *
   * Exit 0 = clean. Exit 1 means EITHER conflicts OR an unusable ref
   * ("not something we can merge") — git does not distinguish them by code,
   * so the tree OID is what separates the two: a real merge always writes
   * one, a failed lookup never does. Keying off the exit code alone would
   * report a nonexistent branch as a clean merge.
   *
   * @returns {Promise<{clean: boolean, conflicts: string[], tree: string|null,
   *                    detail: string, error: string|null}>}
   */
  static async mergeTree(mergeInto, mergeFrom, repoPath = process.cwd()) {
    const res = await this._git(
      ['merge-tree', '--write-tree', '--name-only', mergeInto, mergeFrom], repoPath
    );

    const lines = res.stdout.split('\n');
    const tree = (/^[0-9a-f]{7,64}$/.test((lines[0] || '').trim()))
      ? lines[0].trim()
      : null;

    if (res.code !== 0 && !tree) {
      return {
        clean: false, conflicts: [], tree: null, detail: '',
        error: res.stderr.trim().substring(0, 200) || 'merge-tree failed',
      };
    }
    const conflicts = [];
    let i = 1;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') break;
      conflicts.push(line.trim());
    }

    return {
      clean: res.code === 0,
      conflicts,
      tree,
      detail: lines.slice(i + 1).join('\n').trim(),
      error: null,
    };
  }

  /**
   * Files changed on `mergeFrom` since it diverged from `mergeInto`.
   * Uses three-dot range so unrelated commits landing on the target branch
   * are not misreported as this branch's work.
   * @returns {Promise<Array<{status: string, path: string, oldPath: string|null}>>}
   */
  static async changedFiles(mergeInto, mergeFrom, repoPath = process.cwd()) {
    const res = await this._git(
      ['diff', '--name-status', '-M', `${mergeInto}...${mergeFrom}`], repoPath
    );
    if (res.code !== 0) return [];

    return res.stdout.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split('\t');
      const status = (parts[0] || '').trim();
      // Renames arrive as "R096\told/path\tnew/path"
      if (status.startsWith('R') && parts.length >= 3) {
        return { status: 'R', path: parts[2], oldPath: parts[1] };
      }
      return { status: status.charAt(0), path: parts[1] || '', oldPath: null };
    }).filter(f => f.path);
  }

  /**
   * Added/removed line counts per changed file, for churn scoring.
   * Binary files report null counts rather than 0, so they can be excluded
   * instead of silently counting as "no change".
   * @returns {Promise<Array<{path: string, added: number|null, removed: number|null}>>}
   */
  static async diffNumstat(mergeInto, mergeFrom, repoPath = process.cwd()) {
    const res = await this._git(
      ['diff', '--numstat', '-M', `${mergeInto}...${mergeFrom}`], repoPath
    );
    if (res.code !== 0) return [];

    return res.stdout.trim().split('\n').filter(Boolean).map(line => {
      const [added, removed, ...rest] = line.split('\t');
      const isBinary = added === '-' || removed === '-';
      return {
        path: (rest.join('\t') || '').trim(),
        added: isBinary ? null : Number(added),
        removed: isBinary ? null : Number(removed),
      };
    }).filter(f => f.path);
  }

  /**
   * How far apart the two branches are.
   * `behind` is what drives staleness risk — commits on the target that this
   * branch has not absorbed yet.
   * @returns {Promise<{ahead: number, behind: number}>}
   */
  static async aheadBehind(mergeInto, mergeFrom, repoPath = process.cwd()) {
    const res = await this._git(
      ['rev-list', '--left-right', '--count', `${mergeInto}...${mergeFrom}`], repoPath
    );
    if (res.code !== 0) return { ahead: 0, behind: 0 };
    const [behind, ahead] = res.stdout.trim().split(/\s+/).map(Number);
    return {
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
    };
  }

  /**
   * Paths that have previously been reverted or hot-fixed — historically
   * fragile ground. One `git log` pass over recent history rather than one
   * call per changed file, which would be dozens of subprocesses.
   * @returns {Promise<Set<string>>}
   */
  static async fragilePathSet(repoPath = process.cwd(), limit = 400) {
    const res = await this._git([
      'log', `-n${limit}`, '--format=%x00%s', '--name-only', '--no-merges',
    ], repoPath);
    if (res.code !== 0) return new Set();

    const fragile = new Set();
    let inFragileCommit = false;
    for (const line of res.stdout.split('\n')) {
      if (line.startsWith('\u0000')) {
        inFragileCommit = /\b(revert|hotfix|hot-fix)\b/i.test(line.slice(1));
        continue;
      }
      const filePath = line.trim();
      if (inFragileCommit && filePath) fragile.add(filePath);
    }
    return fragile;
  }

  /**
   * Parses `owner/repo` out of a remote URL, normalising SSH and HTTPS forms
   * so a PR link can be matched against the checked-out repo.
   * Handles: git@host:owner/repo.git, https://host/owner/repo.git,
   *          ssh://git@host/owner/repo.git
   * @returns {Promise<{host: string, owner: string, repo: string, slug: string}|null>}
   */
  static async remoteSlug(repoPath = process.cwd(), remote = 'origin') {
    const res = await this._git(['remote', 'get-url', remote], repoPath);
    if (res.code !== 0) return null;
    return this.parseRemoteUrl(res.stdout.trim());
  }

  /**
   * Pure URL parser — split out from remoteSlug so it can be unit-tested and
   * reused on PR links pasted by the user.
   */
  static parseRemoteUrl(url) {
    if (!url) return null;
    const cleaned = url.trim().replace(/\.git$/, '');
    const scp = cleaned.match(/^[\w.-]+@([\w.-]+):([^/]+)\/(.+)$/);
    const uri = cleaned.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/([^/]+)\/(.+)$/);
    const match = scp || uri;
    if (!match) return null;

    const [, host, owner, repo] = match;
    const normalisedRepo = repo.replace(/\/+$/, '');
    return {
      host: host.toLowerCase(),
      owner,
      repo: normalisedRepo,
      slug: `${owner}/${normalisedRepo}`.toLowerCase(),
    };
  }

  /**
   * Parses a pull request link into the repo it belongs to plus its number,
   * so it can be checked against the checked-out repo before any work runs.
   * Accepts the /pull/ and /pull-requests/ forms and tolerates trailing
   * segments such as /files or #discussion_r123.
   * @returns {{host: string, owner: string, repo: string, slug: string, number: number}|null}
   */
  static parsePullRequestUrl(url) {
    if (!url) return null;
    const match = String(url).trim().match(
      /^(?:https?:\/\/)?([\w.-]+)\/([^/\s]+)\/([^/\s]+)\/(?:pull|pull-requests|merge_requests)\/(\d+)/i
    );
    if (!match) return null;

    const [, host, owner, repo, number] = match;
    const normalisedRepo = repo.replace(/\.git$/, '');
    return {
      host: host.toLowerCase(),
      owner,
      repo: normalisedRepo,
      slug: `${owner}/${normalisedRepo}`.toLowerCase(),
      number: Number(number),
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

  /**
   * Compare the current branch against its upstream.
   * Fetches the remote-tracking refs first (read-only — never touches the
   * working tree) so ahead/behind counts are accurate.
   */
  static async getBranchSyncStatus(repoPath = process.cwd(), doFetch = true) {
    const run = (args, opts = {}) =>
      execFileAsync('git', ['-C', repoPath, ...args], { maxBuffer: GIT_MAX_BUFFER, ...opts });

    let branch;
    try {
      branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    } catch (error) {
      return this._handleGitError(error, 'getBranchSyncStatus');
    }

    let dirty = false;
    try {
      dirty = (await run(['status', '--porcelain'])).stdout.trim().length > 0;
    } catch (_) { /* non-fatal */ }

    let upstream = null;
    try {
      upstream = (await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).stdout.trim();
    } catch (_) {
      return { branch, upstream: null, ahead: 0, behind: 0, dirty, fetched: false, fetchError: null };
    }

    let fetched = false;
    let fetchError = null;
    if (doFetch) {
      try {
        await run(['fetch', '--quiet', upstream.split('/')[0]], { timeout: GIT_FETCH_TIMEOUT_MS });
        fetched = true;
      } catch (error) {
        fetchError = (error.message || 'fetch failed').substring(0, 120);
        Logger.debug('Git fetch failed', { error: fetchError });
      }
    }

    let ahead = 0;
    let behind = 0;
    try {
      const counts = (await run(['rev-list', '--left-right', '--count', `${upstream}...HEAD`])).stdout.trim().split(/\s+/);
      behind = parseInt(counts[0], 10) || 0;
      ahead = parseInt(counts[1], 10) || 0;
    } catch (error) {
      return this._handleGitError(error, 'getBranchSyncStatus');
    }

    return { branch, upstream, ahead, behind, dirty, fetched, fetchError };
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
