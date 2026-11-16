import axios from 'axios';
import { sanitizeLogMessage } from '../utils/sanitize.js';

/** Check an HTTP endpoint with bounded retries and a per-request timeout. */
export async function verifyHttpHealth(url, { maxRetries = 1, delayMs = 1000, timeoutMs = 5000 } = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      throw new Error('Health check URL must use HTTP or HTTPS and cannot contain credentials.');
    }
  } catch (error) {
    return { healthy: false, error: error.message || 'Invalid health check URL.', url: null };
  }

  const retries = Math.max(1, Math.min(30, Number.parseInt(maxRetries, 10) || 1));
  const requestTimeout = Math.max(250, Math.min(30000, Number.parseInt(timeoutMs, 10) || 5000));
  let lastError = 'Health check did not return a successful response.';
  let lastStatusCode;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await axios.get(parsedUrl.toString(), {
        timeout: requestTimeout,
        validateStatus: () => true,
      });
      lastStatusCode = response.status;
      if (response.status >= 200 && response.status < 400) {
        return {
          healthy: true,
          statusCode: response.status,
          url: parsedUrl.toString(),
          latencyMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
        };
      }
      lastError = `Health check returned HTTP ${response.status}.`;
    } catch (error) {
      lastError = sanitizeLogMessage(error?.message || 'Health check request failed.', 500);
    }

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
    }
  }

  return {
    healthy: false,
    statusCode: lastStatusCode,
    error: lastError,
    url: parsedUrl.toString(),
    checkedAt: new Date().toISOString(),
  };
}
