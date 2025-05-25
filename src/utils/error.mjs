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
  console.error("Caught error:", err); // Log the full error object for debugging

  let status = 500;
  let message = "An unexpected error occurred.";
  let code = "internal_error";
  let type = "internal_error";

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
    code = `http_error_${status}`;
    type = "api_error";
  } else if (err.status) {
    // Handle errors from GoogleGenerativeAI client that have a status property
    status = err.status;
    message = err.message;
    code = `gemini_api_error_${status}`;
    type = "api_error";
  } else if (err.cause?.response?.status) {
    // Handle errors from GoogleGenerativeAI client when wrapped in a cause (e.g., from network issues)
    status = err.cause.response.status;
    message = err.message;
    code = `gemini_api_error_${status}`;
    type = "api_error";
  } else if (err.name === "GoogleGenerativeAIError") {
    // Specific error type from the Google Generative AI library
    status = 500; // Default to 500 if no specific status is provided by the library
    message = `Gemini API error: ${err.message}`;
    code = "gemini_api_error";
    type = "api_error";
  } else if (err.name === "APIError" && err.status) {
    // Catch generic APIError with status (e.g. from Cloudflare Workers AI)
    status = err.status;
    message = err.message;
    code = `api_error_${status}`;
    type = "api_error";
  } else if (err.message.includes("content blocked")) {
    // Heuristic for content blocking errors not caught by specific error objects
    status = 400; // Or 403, depending on desired strictness
    message = "Content violates safety policies.";
    code = "content_filter_violation";
    type = "api_error";
  }

  const errorResponse = {
    error: {
      message: message,
      type: type,
      code: code,
    },
  };

  return new Response(JSON.stringify(errorResponse), fixCors({
    status: status,
    headers: { 'Content-Type': 'application/json' }
  }));
};
