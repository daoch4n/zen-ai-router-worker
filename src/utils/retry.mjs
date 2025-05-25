/**
 * Asynchronously delays execution for a specified number of milliseconds.
 *
 * @param {number} ms - The number of milliseconds to wait.
 * @returns {Promise<void>} A Promise that resolves after the delay.
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes an asynchronous function with a retry mechanism,
 * incorporating exponential backoff.
 *
 * @param {Function} asyncFunction - The asynchronous function to execute.
 * @param {Object} options - Retry options.
 * @param {number} [options.maxRetries=3] - Maximum number of retry attempts.
 * @param {number} [options.initialDelay=100] - Initial delay in milliseconds before the first retry.
 * @param {number} [options.backoffFactor=2] - Factor by which the delay increases with each retry.
 * @param {Function} [options.onRetry] - Callback function to execute on each retry attempt.
 * @returns {Promise<*>} A Promise that resolves with the result of asyncFunction
 *   or rejects if all retries are exhausted.
 */
async function executeWithRetry(asyncFunction, {
  maxRetries = 3,
  initialDelay = 100,
  backoffFactor = 2,
  onRetry = () => {}
} = {}) {
  let attempt = 0;
  let currentDelay = initialDelay;

  while (attempt <= maxRetries) {
    try {
      return await asyncFunction();
    } catch (error) {
      attempt++;
      if (attempt > maxRetries) {
        throw error; // Re-throw the error if max retries are exhausted
      }

      onRetry(attempt, error, currentDelay);
      await delay(currentDelay);
      currentDelay *= backoffFactor;
    }
  }
}

export { executeWithRetry, delay };