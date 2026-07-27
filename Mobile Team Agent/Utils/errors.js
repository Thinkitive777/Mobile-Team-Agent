/// MARK: - Error Classes
/// Structured error hierarchy for Mobile Team Agent.
/// Each error carries a machine-readable code and optional details for
/// Jira, Git, config, and validation failures.

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

class JiraNetworkError extends AppError {
  constructor(message, details = null) {
    super(message, 'JIRA_NETWORK_ERROR', details);
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

class FigmaConnectionError extends AppError {
  constructor(message, details = null) {
    super(message, 'FIGMA_CONNECTION_ERROR', details);
  }
}

class FigmaAuthError extends AppError {
  constructor(message, details = null) {
    super(message, 'FIGMA_AUTH_ERROR', details);
  }
}

class FigmaNetworkError extends AppError {
  constructor(message, details = null) {
    super(message, 'FIGMA_NETWORK_ERROR', details);
  }
}

class FigmaRateLimitError extends AppError {
  constructor(message, details = null) {
    super(message, 'FIGMA_RATE_LIMIT', details);
  }
}

class FigmaNotFoundError extends AppError {
  constructor(message, details = null) {
    super(message, 'FIGMA_NOT_FOUND', details);
  }
}

module.exports = {
  AppError,
  JiraConnectionError,
  JiraAuthError,
  JiraRateLimitError,
  JiraNetworkError,
  GitError,
  ConfigError,
  ValidationError,
  FigmaConnectionError,
  FigmaAuthError,
  FigmaNetworkError,
  FigmaRateLimitError,
  FigmaNotFoundError,
};
