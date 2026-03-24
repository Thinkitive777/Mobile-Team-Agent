/**
 * Minimal structured logger for ProjectGuide Agent.
 * All output goes to stderr since MCP uses stdout for protocol messages.
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  static _level = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || LOG_LEVELS.info;

  static setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      Logger._level = LOG_LEVELS[level];
    }
  }

  static _emit(level, msg, data) {
    if (LOG_LEVELS[level] < Logger._level) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
    };
    if (data && Object.keys(data).length > 0) {
      // Redact sensitive fields
      const safe = { ...data };
      for (const key of ['token', 'password', 'secret', 'authorization']) {
        if (safe[key]) safe[key] = '***REDACTED***';
      }
      entry.data = safe;
    }
    console.error(JSON.stringify(entry));
  }

  static debug(msg, data) { Logger._emit('debug', msg, data); }
  static info(msg, data)  { Logger._emit('info', msg, data); }
  static warn(msg, data)  { Logger._emit('warn', msg, data); }
  static error(msg, data) { Logger._emit('error', msg, data); }
}

module.exports = Logger;
