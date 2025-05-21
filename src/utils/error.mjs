/**
 * Error handling utilities
 */

/**
 * Custom HTTP error class
 */
export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

/**
 * Error handler function for request processing
 * @param {Error} err - The error to handle
 * @param {Function} fixCors - Function to apply CORS headers
 * @returns {Response} - Response with error message
 */
export const errorHandler = (err, fixCors) => {
  console.error(err);
  return new Response(err.message, fixCors({ status: err.status ?? 500 }));
};
