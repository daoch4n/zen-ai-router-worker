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

export class ToolExecutionError extends HttpError {
  constructor(message, originalError) {
    super(message, 500); // Internal Server Error
    this.name = 'ToolExecutionError';
    this.originalError = originalError;
  }
}

export class MalformedRequestError extends HttpError {
  constructor(message) {
    super(message, 400); // Bad Request
    this.name = 'MalformedRequestError';
  }
}

export class DOOperationError extends HttpError {
  constructor(message, originalError, isNotFound = false) {
    super(message, isNotFound ? 404 : 500); // Not Found or Internal Server Error
    this.name = 'DOOperationError';
    this.originalError = originalError;
    this.isNotFound = isNotFound;
  }
}

/**
 * Formats an error into an Anthropic-style error object.
 * @param {Error} error - The error object.
 * @param {number} statusCode - The HTTP status code.
 * @returns {object} - The Anthropic-style error object.
 */
const formatAnthropicError = (error, statusCode) => {
  let type = 'api_error';
  let message = 'An unexpected error occurred.';

  if (error instanceof MalformedRequestError) {
    type = 'invalid_request_error';
    message = error.message;
  } else if (error instanceof DOOperationError && error.isNotFound) {
    type = 'api_error'; // Anthropic doesn't have a specific 'not_found' error type for API errors.
    message = error.message;
  } else if (error instanceof HttpError) {
    message = error.message;
  } else {
    // Generic error
    message = error.message || 'An unexpected error occurred.';
  }

  return {
    error: {
      type: type,
      message: message,
    },
  };
};

/**
 * Error handler function for request processing
 * @param {Error} err - The error to handle
 * @param {Function} fixCors - Function to apply CORS headers
 * @returns {Response} - Response with error message
 */
export const errorHandler = (err, fixCors) => {
  console.error(err); // Log the original error for debugging

  let statusCode = err.status ?? 500;
  if (err instanceof MalformedRequestError) {
    statusCode = 400;
  } else if (err instanceof DOOperationError && err.isNotFound) {
    statusCode = 404;
  } else if (!(err instanceof HttpError)) {
    // If it's not a custom HttpError, treat it as a generic internal server error.
    statusCode = 500;
  }

  const anthropicErrorResponse = formatAnthropicError(err, statusCode);
  return new Response(JSON.stringify(anthropicErrorResponse), fixCors({ status: statusCode, headers: { 'Content-Type': 'application/json' } }));
};
