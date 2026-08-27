/// MARK: - GitHub CLI Utilities
/// Reads pull request metadata through the `gh` CLI rather than a stored
/// token. `gh` already holds the developer's credentials — including SSO
/// sessions that a bare personal access token often cannot satisfy — so this
/// works on private repos with no extra setup and nothing to leak.
///
/// The PR's *code* never comes from here: it is fetched with plain git
/// (`git fetch origin pull/N/head`) using existing git credentials. Only the
/// metadata git cannot know — base branch, title, author, state — needs `gh`.

const { execFile } = require('child_process');
const { promisify } = require('util');

const { GIT_MAX_BUFFER } = require('../Constants/constants');
const Logger = require('./logger');

const execFileAsync = promisify(execFile);

const PR_FIELDS = 'number,title,author,baseRefName,headRefName,state,isDraft,url,additions,deletions';

class GhUtils {
  /**
   * Whether the `gh` CLI is installed and authenticated.
   * Both are checked — an installed but logged-out gh fails at the first real
   * call, and a confusing auth error mid-report is worse than an early one.
   * @returns {Promise<{available: boolean, reason: string|null}>}
   */
  static async status() {
    try {
      await execFileAsync('gh', ['--version'], { maxBuffer: GIT_MAX_BUFFER });
    } catch {
      return {
        available: false,
        reason: 'The GitHub CLI (`gh`) is not installed. Install it with `brew install gh`, ' +
                'or pass the branch names directly instead of a PR link.',
      };
    }

    try {
      await execFileAsync('gh', ['auth', 'status'], { maxBuffer: GIT_MAX_BUFFER });
    } catch {
      return {
        available: false,
        reason: 'The GitHub CLI is installed but not logged in. Run `gh auth login`, ' +
                'or pass the branch names directly instead of a PR link.',
      };
    }

    return { available: true, reason: null };
  }

  /**
   * Reads a pull request's metadata.
   * @param {string} slug  owner/repo
   * @param {number} number
   * @returns {Promise<{ok: boolean, pr: object|null, reason: string|null}>}
   */
  static async viewPullRequest(slug, number) {
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr', 'view', String(number), '--repo', slug, '--json', PR_FIELDS,
      ], { maxBuffer: GIT_MAX_BUFFER });
      return { ok: true, pr: JSON.parse(stdout), reason: null };
    } catch (error) {
      const message = (error.stderr || error.message || '').trim();
      Logger.debug('gh: pr view failed', { reason: message.substring(0, 150) });

      if (/could not resolve to a pullrequest|not found/i.test(message)) {
        return { ok: false, pr: null, reason: `Pull request #${number} was not found in ${slug}.` };
      }
      return { ok: false, pr: null, reason: message.substring(0, 200) || 'gh pr view failed' };
    }
  }
}

module.exports = GhUtils;
