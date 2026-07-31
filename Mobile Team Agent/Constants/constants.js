/// MARK: - Constants
/// Centralized configuration constants for Mobile Team Agent.
/// All magic numbers, file paths, API defaults, and regex patterns live here.

const path = require('path');
const os = require('os');
module.exports = Object.freeze({
  // Version
  VERSION: '3.3.0',

  // File system paths
  CONFIG_DIR: path.join(os.homedir(), '.mobile-team-agent'),
  // Pre-rename location. Migrated once on startup, then never used again.
  LEGACY_CONFIG_DIR: path.join(os.homedir(), '.projectguide-agent'),
  // User data to carry across. Excludes src/ and bin/ (the installed program).
  LEGACY_MIGRATION_ITEMS: [
    'config.json', 'preferences.json', 'offline_queue.json',
    'daily-reports', 'memory', 'prompts',
  ],
  CONFIG_FILE: path.join(os.homedir(), '.mobile-team-agent', 'config.json'),
  PREFERENCES_FILE: path.join(os.homedir(), '.mobile-team-agent', 'preferences.json'),
  REPORTS_DIR: path.join(os.homedir(), '.mobile-team-agent', 'daily-reports'),
  CONFIG_FILE_PERMISSIONS: 0o600,
  REPORT_FILE_PERMISSIONS: 0o600,

  // Project-based update storage (Documents/MobileTeamAgent/<ProjectName>/)
  DESKTOP_DIR: path.join(os.homedir(), 'Desktop'),
  DESKTOP_UPDATES_DIR: path.join(os.homedir(), 'Documents', 'MobileTeamAgent'),

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

  // Memory
  MEMORY_DIR: path.join(os.homedir(), '.mobile-team-agent', 'memory'),
  MEMORY_FILE_PERMISSIONS: 0o600,
  MEMORY_MAX_ENTRIES_PER_TICKET: 50,
  MEMORY_MAX_JOURNAL_ENTRIES: 200,
  MEMORY_SEARCH_LIMIT: 20,

  // Ticket ID regex
  TICKET_ID_PATTERN: /[A-Z][A-Z0-9]+-\d+/g,
});
