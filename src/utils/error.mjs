/**
 * Error handling utilities for HTTP request processing.
 * Provides custom error types and centralized error response handling.
 */

/**
 * Custom HTTP error class that extends the standard Error with HTTP status codes.
 * Used throughout the application to provide structured error responses.
 */
export class HttpError extends Error {
  /**
   * Creates an HTTP error with message and status code.
   *
   * @param {string} message - Error message to display to the client
   * @param {number} status - HTTP status code (400, 401, 404, 500, etc.)
   */
  constructor(message, status) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

/**
 * Centralized error handler that processes errors and creates HTTP responses.
 * Logs errors for debugging and applies CORS headers for client compatibility.
 *
 * @param {Error|HttpError} err - Error object to handle
 * @param {Function} fixCors - Function to apply CORS headers to response
 * @returns {Response} HTTP response with error message and appropriate status
 */
export const errorHandler = (err, fixCors) => {
  console.error(err);
  return new Response(err.message, fixCors({ status: err.status ?? 500 }));
};
