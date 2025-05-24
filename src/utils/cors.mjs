/**
 * CORS utilities for handling cross-origin requests in the Cloudflare Worker.
 * Provides permissive CORS configuration for maximum client compatibility.
 */

/**
 * Applies CORS headers to response options for cross-origin compatibility.
 * Enables unrestricted access from any origin with common HTTP methods and headers.
 *
 * @param {Object} options - Response options object
 * @param {Headers} [options.headers] - Existing response headers
 * @param {number} [options.status] - HTTP status code
 * @param {string} [options.statusText] - HTTP status text
 * @returns {Object} Response options with CORS headers applied
 */
export const fixCors = ({ headers, status, statusText }) => {
  headers = new Headers(headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  headers.set("Access-Control-Max-Age", "86400");
  return { headers, status, statusText };
};

/**
 * Handles CORS preflight OPTIONS requests with permissive headers.
 * Allows all origins, methods, and headers for maximum compatibility.
 *
 * @returns {Response} Empty response with CORS preflight headers
 */
export const handleOPTIONS = () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    }
  });
};
