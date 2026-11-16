/**
 * @file backoff.js
 * @description Exponential backoff with full jitter for cloud provider polling and resilient retries.
 * Mitigates the "thundering herd" problem when polling Render and Vercel deployment APIs.
 */

/**
 * Calculate exponential backoff delay with full jitter.
 * Formula: randomBetween(0, min(maxMs, baseMs * (factor ^ attempt)))
 *
 * @param {number} attempt Current retry attempt index (0-based or 1-based)
 * @param {object} options Configuration options
 * @param {number} options.baseMs Minimum initial delay in milliseconds (default: 1000)
 * @param {number} options.maxMs Maximum cap delay in milliseconds (default: 30000)
 * @param {number} options.factor Exponential multiplier (default: 2)
 * @returns {number} Jittered delay in milliseconds
 */
export function calculateBackoff(attempt = 0, { baseMs = 1000, maxMs = 30000, factor = 2 } = {}) {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const exponential = baseMs * Math.pow(factor, safeAttempt);
  const capped = Math.min(maxMs, exponential);
  // Full jitter: uniformly random between 0 and capped delay
  return Math.floor(Math.random() * capped);
}

/**
 * Sleep for a jittered exponential backoff duration.
 *
 * @param {number} attempt
 * @param {object} options
 * @returns {Promise<number>} Resolves with the actual delay slept
 */
export async function sleepWithBackoff(attempt, options) {
  const delay = calculateBackoff(attempt, options);
  await new Promise((resolve) => setTimeout(resolve, delay));
  return delay;
}

/**
 * Execute an async operation with bounded exponential backoff retries.
 *
 * @param {Function} fn Async function to execute
 * @param {object} options
 * @param {number} options.maxAttempts Maximum number of execution attempts (default: 3)
 * @param {Function} [options.shouldRetry] Optional predicate (err, attempt) => boolean
 * @param {number} [options.baseMs]
 * @param {number} [options.maxMs]
 * @returns {Promise<any>} Result of successful execution
 */
export async function retryWithBackoff(fn, { maxAttempts = 3, shouldRetry = () => true, baseMs = 1000, maxMs = 30000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const isLast = attempt === maxAttempts - 1;
      if (isLast || !shouldRetry(err, attempt)) {
        throw err;
      }
      await sleepWithBackoff(attempt, { baseMs, maxMs });
    }
  }
  throw lastError;
}
