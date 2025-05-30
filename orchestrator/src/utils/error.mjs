import { logger } from './logger.mjs';

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
 * Processes Google API error responses and creates appropriate HttpError instances.
 * Handles both JSON error responses and plain text responses.
 *
 * @param {Response} response - Failed response from Google API
 * @returns {Promise<HttpError>} HttpError with user-friendly message and appropriate status
 */
export async function processGoogleApiError(response) {
  const status = response.status;
  let errorMessage = `Google API error: ${status} ${response.statusText}`;

  try {
    // Try to parse JSON error response
    const errorText = await response.text();
    const errorData = JSON.parse(errorText);

    if (errorData.error && errorData.error.message) {
      errorMessage = errorData.error.message;
    } else if (errorData.message) {
      errorMessage = errorData.message;
    }
  } catch (parseError) {
    // If we can't parse the error response, use the status text
    // This is expected for non-JSON error responses
  }

  // Map to user-friendly message
  const friendlyMessage = mapGoogleApiError(status, errorMessage);

  // Determine appropriate status code for client response
  const clientStatus = status >= 500 ? 502 : status;

  return new HttpError(friendlyMessage, clientStatus);
}

/**
 * Validates text input for byte length constraints.
 * Important for APIs that have byte-based limits (like Google TTS).
 *
 * @param {string} text - Text to validate
 * @param {number} maxBytes - Maximum allowed bytes
 * @param {number} minLength - Minimum character length
 * @returns {void}
 * @throws {HttpError} When text exceeds limits
 */
export function validateTextLength(text, maxBytes, minLength = 1) {
  if (!text || typeof text !== 'string') {
    throw new HttpError("Text must be a non-empty string", 400);
  }

  const trimmedText = text.trim();

  if (trimmedText.length < minLength) {
    throw new HttpError(`Text must be at least ${minLength} character${minLength > 1 ? 's' : ''} long`, 400);
  }

  // Check byte length (important for multi-byte characters)
  const byteLength = new TextEncoder().encode(trimmedText).length;
  if (byteLength > maxBytes) {
    throw new HttpError(
      `Text is too long (${byteLength} bytes). Maximum allowed is ${maxBytes} bytes. ` +
      `Consider shortening your text or splitting it into multiple requests.`,
      400
    );
  }
}

/**
 * Validates voice name format against known patterns.
 * Provides early validation before sending to Google API.
 *
 * @param {string} voiceName - Voice name to validate
 * @param {Object} patterns - Voice name patterns to check against
 * @returns {void}
 * @throws {HttpError} When voice name format is invalid
 */
export function validateVoiceName(voiceName, patterns) {
  if (!voiceName || typeof voiceName !== 'string') {
    throw new HttpError("Voice name must be a non-empty string", 400);
  }

  const trimmedVoice = voiceName.trim();

  if (trimmedVoice.length === 0) {
    throw new HttpError("Voice name cannot be empty", 400);
  }

  // Check against known patterns
  const isValidFormat = Object.values(patterns).some(pattern => pattern.test(trimmedVoice));

  if (!isValidFormat) {
    throw new HttpError(
      `Invalid voice name format: "${trimmedVoice}". ` +
      `Expected formats: language-region-type-variant (e.g., en-US-Standard-A) or Gemini voice names (e.g., Puck, Charon).`,
      400
    );
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
export const errorHandler = (err, fixCors, request = null) => {
  logger.error(err, "Unhandled error during request processing", {
    url: request ? request.url : 'N/A',
    method: request ? request.method : 'N/A',
  });
  return new Response(err.message, fixCors({ status: err.status ?? 500 }));
};