/**
 * @file render.service.js
 * @description Render Cloud Provider API client for backend service provisioning, deploy polling, and health checks.
 */

import axios from 'axios';
import { env } from '../config/env.js';

const RENDER_API_BASE = 'https://api.render.com/v1';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeServiceName(name) {
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
 */
export async function createRenderWebService({ name, repoUrl, branch = 'main', rootDir = '/server', buildCommand = 'npm install', startCommand = 'npm start', envVars = [] }) {
  const client = getRenderClient();

  if (client) {
    const payload = {
      type: 'web_service',
      name: safeServiceName(name),
      repo: repoUrl,
      branch,
      autoDeploy: 'no',
      rootDir: rootDir === '/' ? '' : String(rootDir).replace(/^\//, ''),
      serviceDetails: {
        env: 'node',
        buildCommand,
        startCommand,
        plan: 'starter',
        envVars: (envVars || []).map((e) => ({ key: e.key, value: e.value })),
        healthCheckPath: '/health',
      },
    };

    const response = await client.post('/services', payload);
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
 * Fetch deploy/build events/logs from Render if available. Returns array of { message }.
 * If unsupported/unavailable, returns empty array without failing the pipeline.
 */
export async function fetchRenderDeployLogs(serviceId, deployId, { limit = 200 } = {}) {
  const client = getRenderClient();
  if (!client) return [];
  try {
    // Render API surfaces events; exact path may vary by account/API version.
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

  // Explicitly-labeled simulation only in development opt-in mode.
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
