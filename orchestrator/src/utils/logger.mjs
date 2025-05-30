/**
 * Simple logging utility for the Orchestrator.
 * Provides basic logging functions with structured output.
 */

export class Logger {
  /**
   * Logs an informational message.
   * @param {string} message - The message to log.
   * @param {Object} [context={}] - Additional context to include with the log.
   */
  info(message, context = {}) {
    this._log('INFO', message, context);
  }

  /**
   * Logs a warning message.
   * @param {string} message - The message to log.
   * @param {Object} [context={}] - Additional context to include with the log.
   */
  warn(message, context = {}) {
    this._log('WARN', message, context);
  }

  /**
   * Logs an error message.
   * @param {Error} error - The error object to log.
   * @param {string} [message] - An optional descriptive message for the error.
   * @param {Object} [context={}] - Additional context to include with the log.
   */
  error(error, message, context = {}) {
    const errorContext = {
      ...context,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
    };
    if (message) {
      errorContext.description = message;
    }
    this._log('ERROR', error.message, errorContext);
  }

  /**
   * Internal logging method.
   * @param {string} level - The log level (INFO, WARN, ERROR).
   * @param {string} message - The main log message.
   * @param {Object} context - The context object to log.
   */
  _log(level, message, context) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...context,
    };
    console.log(JSON.stringify(logEntry));
  }
}

export const logger = new Logger();