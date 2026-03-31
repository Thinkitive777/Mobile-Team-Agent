/// MARK: - Configuration Manager
/// Loads, validates, and persists Jira/GitHub config and user preferences.
/// Provides getJiraClient() factory and token masking utilities.

const fs = require("fs");
const CONST = require("../Constants/constants");
const Logger = require("../Utils/logger");
const { ConfigError } = require("../Utils/errors");
const JiraClient = require("./jira-client");

// ── Config ──────────────────────────────────────────────────────────────

if (!fs.existsSync(CONST.CONFIG_DIR)) {
  fs.mkdirSync(CONST.CONFIG_DIR, { recursive: true, mode: 0o700 });
}

let config = {
  jira: {
    connected: false,
    active_project: null,
    url: null, email: null, token: null,
    projects: {},
  },
  github: { connected: false, token: null, user: null, repo: null },
  developer_mode: false,
};

if (fs.existsSync(CONST.CONFIG_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(CONST.CONFIG_FILE, "utf-8"));
    if (loaded.jira && !loaded.jira.projects) {
      loaded.jira.projects = {};
    }
    if (loaded.jira && loaded.jira.url && loaded.jira.email && loaded.jira.token) {
      const legacyKey = loaded.jira.active_project || '__default__';
      if (!loaded.jira.projects[legacyKey]) {
        loaded.jira.projects[legacyKey] = {
          url: loaded.jira.url,
          email: loaded.jira.email,
          token: loaded.jira.token,
        };
        if (!loaded.jira.active_project) loaded.jira.active_project = legacyKey;
      }
    }
    config = { ...config, ...loaded };
    if (!config.jira.projects) config.jira.projects = {};
  } catch (e) {
    Logger.error("Config file corrupted, using defaults", { error: e.message });
  }
}

// ── Token Utilities ─────────────────────────────────────────────────────

function isTokenMasked(token) {
  if (!token) return false;
  return token === '********' || token === 'tok_****' || /^\*+$/.test(token) || token.startsWith('tok_****');
}

function maskToken(token) {
  if (!token || token === "********" || token.length <= 4) return "tok_****";
  return `tok_****${token.slice(-4)}`;
}

// ── Startup Integrity Check ─────────────────────────────────────────────

(function validateConfigIntegrity() {
  if (config.jira && config.jira.connected) {
    const activeKey = config.jira.active_project;
    const creds = activeKey && config.jira.projects && config.jira.projects[activeKey]
      ? config.jira.projects[activeKey]
      : { url: config.jira.url, email: config.jira.email, token: config.jira.token };
    const { url, email, token } = creds;
    if (!url || !email || !token || isTokenMasked(token)) {
      Logger.warn('Jira config integrity check failed — resetting connected=false', {
        activeProject: activeKey,
        hasUrl: !!url, hasEmail: !!email, hasToken: !!token, tokenMasked: isTokenMasked(token),
      });
      config.jira.connected = false;
    }
  }
})();

// ── Config Persistence ──────────────────────────────────────────────────

function saveConfig() {
  try {
    fs.writeFileSync(CONST.CONFIG_FILE, JSON.stringify(config, null, 2), {
      mode: CONST.CONFIG_FILE_PERMISSIONS,
    });
  } catch (err) {
    Logger.error("Failed to save config", { error: err.message });
    throw new ConfigError("Failed to save configuration: " + err.message);
  }
}

// ── Preferences ─────────────────────────────────────────────────────────

let preferences = {
  last_project: null,
  last_sprint: null,
  last_board_id: null,
  last_assignee: null,
  greeting_name: null,
};

if (fs.existsSync(CONST.PREFERENCES_FILE)) {
  try {
    preferences = { ...preferences, ...JSON.parse(fs.readFileSync(CONST.PREFERENCES_FILE, "utf-8")) };
  } catch (e) {
    Logger.error("Preferences file corrupted, using defaults", { error: e.message });
  }
}

function savePreferences() {
  try {
    fs.writeFileSync(CONST.PREFERENCES_FILE, JSON.stringify(preferences, null, 2), {
      mode: CONST.CONFIG_FILE_PERMISSIONS,
    });
  } catch (err) {
    Logger.error("Failed to save preferences", { error: err.message });
  }
}

// ── Jira Client Factory ────────────────────────────────────────────────

function getJiraClient(projectName = null) {
  const targetProject = projectName || config.jira.active_project;
  let url = null, email = null, token = null;

  if (targetProject && config.jira.projects && config.jira.projects[targetProject]) {
    ({ url, email, token } = config.jira.projects[targetProject]);
  } else {
    url = config.jira.url;
    email = config.jira.email;
    token = config.jira.token;
  }

  url = url || process.env.JIRA_URL;
  email = email || process.env.JIRA_EMAIL;
  token = token || process.env.JIRA_TOKEN;

  if (isTokenMasked(token)) {
    throw new ConfigError(
      "Jira credentials are corrupted — stored token is masked. Run 'configure_service' with service='jira' to fix."
    );
  }

  if (!url || !email || !token) {
    const missing = [!url && 'url', !email && 'email', !token && 'token'].filter(Boolean).join(', ');
    throw new ConfigError(`Jira not fully configured (missing: ${missing}). Run 'configure_service' with service='jira'.`);
  }

  return new JiraClient(url, email, token);
}

// ── Repo Path ──────────────────────────────────────────────────────────

function getRepoPath() {
  return process.env.REPO_PATH || process.cwd();
}

// ── Exports ────────────────────────────────────────────────────────────

module.exports = {
  config,
  preferences,
  saveConfig,
  savePreferences,
  getJiraClient,
  getRepoPath,
  maskToken,
  isTokenMasked,
};
