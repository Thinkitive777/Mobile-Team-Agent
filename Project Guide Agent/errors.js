/**
 * Structured error classes for ProjectGuide Agent.
 * Each error carries a machine-readable code and optional details.
 */

class AppError extends Error {
  constructor(message, code = 'APP_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

class JiraConnectionError extends AppError {
  constructor(message, details = null) {
    super(message, 'JIRA_CONNECTION_ERROR', details);
  }
}

class JiraAuthError extends AppError {
  constructor(message, details = null) {
    super(message, 'JIRA_AUTH_ERROR', details);
  }
}

class JiraRateLimitError extends AppError {
  constructor(message, details = null) {
    super(message, 'JIRA_RATE_LIMIT', details);
  }
}

class GitError extends AppError {
  constructor(message, details = null) {
    super(message, 'GIT_ERROR', details);
  }
}

class ConfigError extends AppError {
  constructor(message, details = null) {
    super(message, 'CONFIG_ERROR', details);
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

module.exports = {
  AppError,
  JiraConnectionError,
  JiraAuthError,
  JiraRateLimitError,
  GitError,
  ConfigError,
  ValidationError,
};
