const path = require('path');
const os = require('os');

/**
 * Centralized configuration constants for ProjectGuide Agent.
 * All magic numbers and configurable values live here.
 */
module.exports = Object.freeze({
  // Version
  VERSION: '3.2.0',

  // File system paths
  CONFIG_DIR: path.join(os.homedir(), '.projectguide-agent'),
  CONFIG_FILE: path.join(os.homedir(), '.projectguide-agent', 'config.json'),
  PREFERENCES_FILE: path.join(os.homedir(), '.projectguide-agent', 'preferences.json'),
  REPORTS_DIR: path.join(os.homedir(), '.projectguide-agent', 'daily-reports'),
  CONFIG_FILE_PERMISSIONS: 0o600,
  REPORT_FILE_PERMISSIONS: 0o600,

  // Jira API
  JIRA_MAX_RESULTS: 50,
  JIRA_REQUEST_TIMEOUT_MS: 15000,
  JIRA_MAX_RETRIES: 3,
  JIRA_RETRY_BASE_DELAY_MS: 1000,
  JIRA_DEFAULT_FIELDS: [
    'key', 'summary', 'status', 'priority', 'assignee',
    'duedate', 'created', 'updated', 'labels', 'issuelinks',
  ],

  // Git
  GIT_DEFAULT_SINCE: '48 hours ago',
  GIT_SHORT_HASH_LENGTH: 7,
  GIT_MAX_BUFFER: 1024 * 1024,
  GIT_LOG_FORMAT: '%H|%s|%ai|%an',

  // Display
  COMMENT_PREVIEW_LENGTH: 150,
  COMMENT_PREVIEW_COUNT: 3,
  COMMITS_PREVIEW_LIMIT: 5,
  STANDUP_COMMIT_WINDOW: '48 hours ago',

  // Commit content analysis
  DIFF_MAX_COMMITS: 15,          // Max commits to fetch diffs for (avoid overload)
  DIFF_CONTEXT_LINES: 3,         // Context lines in diff snippets
  DIFF_MAX_LINES_PER_COMMIT: 200, // Truncate large diffs
  DIFF_SUMMARY_MAX_FILES: 20,    // Max files to list in summary

  // Ticket ID regex
  TICKET_ID_PATTERN: /[A-Z][A-Z0-9]+-\d+/g,
});
