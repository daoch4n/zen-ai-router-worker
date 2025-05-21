/**
 * CORS utilities for handling cross-origin requests
 */

/**
 * Applies CORS headers to a response options object
 * @param {Object} options - Response options
 * @param {Headers} [options.headers] - Response headers
 * @param {number} [options.status] - Response status
 * @param {string} [options.statusText] - Response status text
 * @returns {Object} - Response options with CORS headers
 */
export const fixCors = ({ headers, status, statusText }) => {
  headers = new Headers(headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return { headers, status, statusText };
};

/**
 * Handles OPTIONS requests for CORS preflight
 * @returns {Response} - Response with CORS headers
 */
export const handleOPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    }
  });
};
