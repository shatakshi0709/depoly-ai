/**
 * @file render.service.js
 * @description Render Cloud Provider API client for backend service provisioning, deploy polling, and health checks.
 */

import axios from 'axios';
import { env } from '../config/env.js';
import { isNonEmptyString } from '../utils/validate.js';

const RENDER_API_BASE = 'https://api.render.com/v1';

/**
 * Render compute plans. "free" is the only plan that does not require
 * payment information. All other plans are paid and require explicit
 * user selection -- they are never silently applied.
 */
export const RENDER_PLANS = {
  FREE: 'free',
  STARTER: 'starter',
};

/**
 * List of plans that are safe to use without explicit user payment consent.
 * Only "free" is in this list. Any other plan requires explicit selection.
 */
const FREE_ONLY_PLANS = new Set([RENDER_PLANS.FREE]);

/**
 * Validate that a plan selection is allowed. Paid plans require explicit
 * opt-in; they are never silently applied.
 */
function assertFreePlanOrExplicit(plan, explicit) {
  if (!FREE_ONLY_PLANS.has(plan) && !explicit) {
    throw new Error(
      `Render plan "${plan}" is a paid plan and requires explicit selection. ` +
        'Use plan="free" for no-cost deployment, or explicitly pass a paid plan.'
    );
  }
}

let cachedOwnerId = null;

/**
 * Diagnostic information from the last Render /owners request.
 * Safe for logging — contains no API keys or secrets.
 */
let lastOwnerDiagnostic = {
  statusCode: null,
  entryCount: 0,
  hasOwnerId: false,
  errorMessage: null,
};

/**
 * Get the last /owners diagnostic info (for debugging, no secrets).
 */
export function getOwnerDiagnostic() {
  return { ...lastOwnerDiagnostic };
}

function getRenderClient() {
  if (!env.RENDER_API_KEY) return null;
  return axios.create({
    baseURL: RENDER_API_BASE,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${env.RENDER_API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Extract workspace ID from a single owner entry.
 * Render API returns entries shaped as { owner: { id, name } }.
 */
function extractOwnerId(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return entry?.owner?.id || entry?.id || null;
}

/**
 * Extract workspace name from a single owner entry.
 */
function extractOwnerName(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return entry?.owner?.name || entry?.name || null;
}

/**
 * Fetch accessible Render workspaces (owners) from the authenticated API key.
 * Handles pagination via cursor. Returns all workspaces found.
 * Never arbitrarily selects among multiple workspaces.
 */
export async function getRenderOwners() {
  const client = getRenderClient();
  lastOwnerDiagnostic = { statusCode: null, entryCount: 0, hasOwnerId: false, errorMessage: null };

  if (!client) {
    lastOwnerDiagnostic.errorMessage = 'No Render API client (API key missing)';
    return { owners: [], hasMore: false, error: lastOwnerDiagnostic.errorMessage };
  }

  const allOwners = [];
  let cursor = null;
  let pageCount = 0;
  const maxPages = 10;

  try {
    do {
      pageCount++;
      const params = cursor ? { cursor } : {};
      const res = await client.get('/owners', { params });

      lastOwnerDiagnostic.statusCode = res.status;
      const page = Array.isArray(res.data) ? res.data : (res.data?.owners || []);

      for (const entry of page) {
        const ownerId = extractOwnerId(entry);
        const ownerName = extractOwnerName(entry);
        if (ownerId) {
          allOwners.push({ id: String(ownerId), name: ownerName || 'Unnamed workspace' });
          lastOwnerDiagnostic.hasOwnerId = true;
        }
      }

      lastOwnerDiagnostic.entryCount = allOwners.length;

      const nextCursor = res.data?.nextCursor || res.data?.pagination?.cursor || res.data?.cursor;
      if (!nextCursor || pageCount >= maxPages) break;
      cursor = nextCursor;
    } while (true);

    return { owners: allOwners, hasMore: false, error: null };
  } catch (err) {
    const status = err?.response?.status;
    lastOwnerDiagnostic.statusCode = status;
    lastOwnerDiagnostic.errorMessage = status ? `HTTP ${status}` : (err?.message || 'Unknown error');
    return { owners: [], hasMore: false, error: lastOwnerDiagnostic.errorMessage };
  }
}

/**
 * Fetch a single Render owner ID for service provisioning.
 * Returns null (without caching) when there are zero or multiple workspaces,
 * so the caller can present workspace selection to the user.
 * Result is cached for the process lifetime when exactly one workspace exists.
 */
export async function getRenderOwnerId() {
  if (cachedOwnerId) return cachedOwnerId;

  const result = await getRenderOwners();

  if (result.error) {
    return null;
  }

  if (result.owners.length === 0) {
    return null;
  }

  if (result.owners.length > 1) {
    return null;
  }

  const ownerId = result.owners[0]?.id;
  if (ownerId) {
    cachedOwnerId = String(ownerId);
  }
  return cachedOwnerId;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function safeServiceName(name) {
  return String(name || 'deplo-service')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'deplo-service';
}

/**
 * Create or update a Render web service. Returns service id/url and latest deploy id when available.
 * In normal mode requires live credentials and provider responses. Explicit dev simulation only when enabled.
 * Payload follows Render's native web service schema with envSpecificDetails.
 */
export async function createRenderWebService({ name, repoUrl, branch = 'main', rootDir = '/server', buildCommand = 'npm install', startCommand = 'npm start', envVars = [], runtime = 'node', plan = RENDER_PLANS.FREE, explicitPaidPlan = false }) {
  const client = getRenderClient();

  if (client) {
    const ownerId = await getRenderOwnerId();
    if (!ownerId) {
      throw new Error(
        'Render account has no accessible workspace (ownerId). ' +
        'Ensure the API key has access to exactly one Render workspace, ' +
        'or select a workspace before deploying.'
      );
    }

    // Validate required build/start commands before calling Render API
    if (!isNonEmptyString(buildCommand)) {
      throw new Error('buildCommand is required for Render web service provisioning.');
    }
    if (!isNonEmptyString(startCommand)) {
      throw new Error('startCommand is required for Render web service provisioning.');
    }

    // Never silently create a paid service. Paid plans require explicit selection.
    assertFreePlanOrExplicit(plan, explicitPaidPlan);

    const payload = {
      type: 'web_service',
      name: safeServiceName(name),
      repo: repoUrl,
      branch,
      autoDeploy: 'no',
      rootDir: rootDir === '/' ? '' : String(rootDir).replace(/^\//, ''),
      serviceDetails: {
        runtime,
        plan,
        region: 'oregon',
        envSpecificDetails: {
          buildCommand,
          startCommand,
        },
        envVars: (envVars || []).map((e) => ({ key: e.key, value: e.value })),
        healthCheckPath: '/health',
      },
    };
    if (ownerId) {
      payload.ownerId = ownerId;
    }

    let response;
    try {
      response = await client.post('/services', payload);
    } catch (err) {
      const renderErr = sanitizeRenderError(err);
      throw new Error(`Render API provisioning failed: ${renderErr.message}`);
    }
    const service = response.data?.service || response.data;
    const deployId = response.data?.deployId || service?.deployId || service?.latestDeployId || null;
    const serviceId = service?.id || service?.service?.id;
    const serviceUrl = service?.serviceDetails?.url || service?.url || (service?.name ? `https://${service.name}.onrender.com` : null);

    if (!serviceId) {
      throw new Error('Render API did not return a service identifier.');
    }

    return {
      serviceId,
      deployId,
      url: serviceUrl,
      status: 'CREATED',
      isLiveCloud: true,
      simulated: false,
    };
  }

  if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
    const safeName = safeServiceName(name);
    return {
      serviceId: `sim-srv-${Math.random().toString(36).substring(2, 10)}`,
      deployId: `sim-dep-${Math.random().toString(36).substring(2, 10)}`,
      url: `https://sim-api-${safeName}.onrender.com`,
      status: 'CREATED',
      isLiveCloud: false,
      simulated: true,
    };
  }

  throw new Error('Render API key is not configured. Live backend deployment cannot proceed.');
}

/**
 * Trigger a new deploy for an existing Render service (best-effort when supported).
 */
export async function triggerRenderDeploy(serviceId) {
  const client = getRenderClient();
  if (!client) {
    if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
      return { deployId: `sim-dep-${Math.random().toString(36).substring(2, 10)}`, simulated: true };
    }
    throw new Error('Render API key is not configured.');
  }
  const res = await client.post(`/services/${serviceId}/deploys`, { clearCache: 'do_not_clear' });
  const deploy = res.data || {};
  const deployId = deploy.id || deploy.deploy?.id;
  if (!deployId) throw new Error('Render API did not return a deploy identifier.');
  return { deployId, simulated: false };
}

/**
 * Poll Render deploy status until live or failure/timeout.
 */
export async function pollRenderDeployStatus(serviceId, deployId, { timeoutMs = 10 * 60 * 1000, intervalMs = 8000 } = {}) {
  const client = getRenderClient();
  const start = Date.now();

  if (!client) {
    if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
      await sleep(1500);
      return { status: 'live', finished: true, simulated: true };
    }
    throw new Error('Render API key is not configured for deployment status polling.');
  }

  while (Date.now() - start < timeoutMs) {
    const res = await client.get(`/services/${serviceId}/deploys/${deployId}`);
    const status = res.data?.status || res.data?.deploy?.status || 'unknown';
    const finished = status === 'live' || status === 'deactivated' || status === 'build_failed' || status === 'update_failed' || status === 'canceled';
    if (finished) {
      return { status, finished: true, simulated: false, raw: res.data };
    }
    await sleep(intervalMs);
  }

  return { status: 'timeout', finished: true, timedOut: true, simulated: false };
}

/**
 * Fetch Render service details (URL, status).
 */
export async function getRenderService(serviceId) {
  const client = getRenderClient();
  if (!client) {
    if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
      return { url: null, simulated: true };
    }
    throw new Error('Render API key is not configured.');
  }
  const res = await client.get(`/services/${serviceId}`);
  const service = res.data || {};
  return {
    id: service.id,
    name: service.name,
    url: service.serviceDetails?.url || service.url || null,
    suspended: service.suspended,
    simulated: false,
  };
}

/**
 * List all Render web services in the authenticated workspace.
 * Used to check for existing services before creating duplicates.
 * Returns an array of { id, name, url }.
 */
export async function listRenderServices() {
  const client = getRenderClient();
  if (!client) {
    if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
      return { services: [], simulated: true };
    }
    throw new Error('Render API key is not configured.');
  }
  const res = await client.get('/services');
  const services = Array.isArray(res.data) ? res.data : (res.data?.services || []);
  return services.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.serviceDetails?.url || s.url || null,
    suspended: s.suspended,
    simulated: false,
  }));
}

/**
 * Fetch deploy/build events/logs from Render if available. Returns array of { message }.
 * If unsupported/unavailable, returns empty array without failing the pipeline.
 */
export async function fetchRenderDeployLogs(serviceId, deployId, { limit = 200 } = {}) {
  const client = getRenderClient();
  if (!client) return [];
  try {
    const res = await client.get(`/services/${serviceId}/deploys/${deployId}/events`, { params: { limit } });
    const events = Array.isArray(res.data) ? res.data : (res.data?.events || []);
    return events
      .map((e) => ({
        message: e?.event?.message || e?.message || e?.details || JSON.stringify(e),
        level: (e?.event?.type || '').toLowerCase().includes('error') ? 'ERROR' : 'INFO',
      }))
      .filter((e) => e.message && e.message !== '{}' && e.message !== 'null')
      .slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Health verification: verifies backend HTTP health check endpoint.
 */
export async function verifyBackendHealth(backendUrl, healthPath = '/health', { maxRetries = 20, delayMs = 5000 } = {}) {
  const fullUrl = `${String(backendUrl).replace(/\/$/, '')}${String(healthPath).startsWith('/') ? healthPath : '/' + healthPath}`;

  if (env.ALLOW_SIMULATED_DEPLOYMENTS && !env.RENDER_API_KEY) {
    await sleep(800);
    return {
      healthy: true,
      statusCode: 200,
      url: fullUrl,
      latencyMs: 42,
      simulated: true,
    };
  }

  let lastError = 'Health check did not return a successful response.';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const start = Date.now();
      const res = await axios.get(fullUrl, { timeout: 5000, validateStatus: () => true });
      if (res.status >= 200 && res.status < 400) {
        return {
          healthy: true,
          statusCode: res.status,
          url: fullUrl,
          latencyMs: Date.now() - start,
          simulated: false,
        };
      }
      lastError = `Received HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message || 'Request failed';
    }
    if (attempt < maxRetries) await sleep(delayMs);
  }

  return { healthy: false, error: lastError, url: fullUrl, simulated: false };
}

/**
 * Sanitize Render API error details from an axios error.
 * Extracts the provider error message without exposing secrets/keys/tokens.
 */
export function sanitizeRenderError(err) {
  if (!err) return { message: 'Unknown Render API error.' };

  if (!err.response) {
    return { message: err.message || 'Render API request failed.' };
  }

  const { status, data } = err.response || {};
  let detail = '';

  try {
    if (data && typeof data === 'object') {
      const errObj = data.error || data;
      if (typeof errObj === 'object' && errObj.message) {
        detail = String(errObj.message);
      } else if (typeof data.message === 'string') {
        detail = data.message;
      } else if (typeof data.error === 'string') {
        detail = data.error;
      } else {
        detail = JSON.stringify(data).slice(0, 1000);
      }
    } else if (typeof data === 'string') {
      detail = data.slice(0, 1000);
    }
  } catch {
    detail = String(data).slice(0, 1000);
  }

  const sanitized = detail
    .replace(/[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
    .replace(/sk_live_[A-Za-z0-9]+/g, '[REDACTED]')
    .replace(/ghp_[A-Za-z0-9]+/g, '[REDACTED]')
    .replace(/rnd_[A-Za-z0-9]+/g, '[REDACTED]');

  return {
    message: status ? `HTTP ${status}: ${sanitized || 'Render API request failed.'}` : sanitized || 'Render API request failed.',
    status,
    detail: sanitized,
  };
}
