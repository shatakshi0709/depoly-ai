/**
 * @file vercel.service.js
 * @description Vercel Cloud Provider API client for env injection, deployments, readiness polling, and log retrieval.
 */

import axios from 'axios';
import { env } from '../config/env.js';

const VERCEL_API_BASE = 'https://api.vercel.com';

function getVercelClient() {
  if (!env.VERCEL_API_KEY) return null;
  return axios.create({
    baseURL: VERCEL_API_BASE,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${env.VERCEL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    params: env.VERCEL_TEAM_ID ? { teamId: env.VERCEL_TEAM_ID } : {},
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeName(name) {
  return String(name || 'deplo-frontend')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'deplo-frontend';
}

function parseRepoFullName(repoUrl) {
  const m = String(repoUrl || '').match(/github\.com[:/]+([^/]+)\/([^/.#?]+)/i);
  if (!m) return null;
  return { org: m[1], repo: m[2] };
}

/**
 * Ensure Vercel project exists (best-effort) and return project id/name.
 */
export async function ensureVercelProject({ name, repoUrl, rootDir = '/client', buildCommand = 'npm run build' }) {
  const client = getVercelClient();
  const projectName = safeName(name);

  if (!client) {
    if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
      return { projectId: `sim-prj-${projectName}`, name: projectName, simulated: true };
    }
    throw new Error('Vercel API key is not configured.');
  }

  // Try fetch existing project
  try {
    const res = await client.get(`/v9/projects/${projectName}`);
    return { projectId: res.data?.id, name: res.data?.name || projectName, simulated: false };
  } catch {
    // create below
  }

  const repo = parseRepoFullName(repoUrl);
  const body = {
    name: projectName,
    framework: 'vite',
    rootDirectory: rootDir === '/' ? null : String(rootDir).replace(/^\//, ''),
    buildCommand,
  };
  if (repo) {
    body.gitRepository = { type: 'github', repo: `${repo.org}/${repo.repo}` };
  }

  const created = await client.post('/v10/projects', body);
  return { projectId: created.data?.id, name: created.data?.name || projectName, simulated: false };
}

/**
 * Upsert environment variables on a Vercel project.
 */
export async function upsertVercelEnvVars(projectNameOrId, envVars = []) {
  const client = getVercelClient();
  if (!client) {
    if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
      return { success: true, simulated: true, count: envVars.length };
    }
    throw new Error('Vercel API key is not configured. Environment propagation cannot proceed.');
  }

  let applied = 0;
  for (const item of envVars) {
    if (!item || !item.key) continue;
    try {
      await client.post(`/v10/projects/${projectNameOrId}/env`, {
        key: item.key,
        value: String(item.value ?? ''),
        type: 'plain',
        target: ['production', 'preview'],
      });
      applied += 1;
    } catch {
      // try update path not universally available; best-effort per key
    }
  }
  return { success: true, simulated: false, count: applied };
}

/**
 * Auto-inject backend URL into Vercel environment variables.
 */
export async function injectVercelEnvironmentVariable(projectName, key, value) {
  const result = await upsertVercelEnvVars(projectName, [{ key, value }]);
  return { success: true, key, isLiveCloud: !result.simulated, simulated: !!result.simulated };
}

/**
 * Trigger deployment of frontend to Vercel and return deployment id/url.
 */
export async function triggerVercelDeploy({ name, repoUrl, branch = 'main', rootDir = '/client', buildCommand = 'npm run build', projectId = null }) {
  const client = getVercelClient();
  const safeProjectName = safeName(name);
  const repo = parseRepoFullName(repoUrl);

  if (!client) {
    if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
      return {
        deploymentId: `sim_dpl_${Math.random().toString(36).substring(2, 12)}`,
        projectId: projectId || `sim-prj-${safeProjectName}`,
        url: `https://sim-${safeProjectName}.vercel.app`,
        status: 'READY',
        isLiveCloud: false,
        simulated: true,
      };
    }
    throw new Error('Vercel API key is not configured. Frontend deployment cannot proceed.');
  }

  if (!repo) {
    throw new Error('Invalid GitHub repository URL for Vercel deployment.');
  }

  const payload = {
    name: safeProjectName,
    gitSource: {
      type: 'github',
      ref: branch,
      repoId: undefined,
      org: repo.org,
      repo: repo.repo,
    },
    projectSettings: {
      buildCommand,
      rootDirectory: rootDir === '/' ? null : String(rootDir).replace(/^\//, ''),
      framework: 'vite',
    },
    target: 'production',
  };

  const response = await client.post('/v13/deployments', payload);
  const deploy = response.data || {};
  const deploymentId = deploy.id;
  if (!deploymentId) {
    throw new Error('Vercel API did not return a deployment identifier.');
  }

  return {
    deploymentId,
    projectId: projectId || deploy.projectId || safeProjectName,
    url: deploy.url ? `https://${deploy.url}` : (deploy.alias && deploy.alias[0] ? `https://${deploy.alias[0]}` : null),
    status: deploy.readyState || 'QUEUED',
    isLiveCloud: true,
    simulated: false,
  };
}

/**
 * Poll Vercel deployment readiness until READY/ERROR/CANCELED or timeout.
 */
export async function pollVercelDeployment(deploymentId, { timeoutMs = 12 * 60 * 1000, intervalMs = 8000 } = {}) {
  const client = getVercelClient();
  const start = Date.now();

  if (!client) {
    if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
      await sleep(1500);
      return { readyState: 'READY', finished: true, simulated: true };
    }
    throw new Error('Vercel API key is not configured for deployment polling.');
  }

  while (Date.now() - start < timeoutMs) {
    const res = await client.get(`/v13/deployments/${deploymentId}`);
    const data = res.data || {};
    const readyState = data.readyState || data.state || 'QUEUED';
    const finished = readyState === 'READY' || readyState === 'ERROR' || readyState === 'CANCELED';
    const url = data.url ? `https://${data.url}` : (data.alias && data.alias[0] ? `https://${data.alias[0]}` : null);
    if (finished) {
      return { readyState, finished: true, url, projectId: data.projectId, simulated: false, raw: data };
    }
    await sleep(intervalMs);
  }

  return { readyState: 'TIMEOUT', finished: true, timedOut: true, simulated: false };
}

/**
 * Fetch Vercel deployment build logs/events if available. Best-effort.
 */
export async function fetchVercelDeploymentLogs(deploymentId, { limit = 200 } = {}) {
  const client = getVercelClient();
  if (!client) return [];
  try {
    const res = await client.get(`/v2/deployments/${deploymentId}/events`, { params: { limit } });
    const events = Array.isArray(res.data) ? res.data : (res.data?.events || []);
    return events
      .map((e) => ({
        message: e?.text || e?.payload?.text || e?.message || '',
        level: (e?.type || '').toLowerCase().includes('error') ? 'ERROR' : 'INFO',
      }))
      .filter((e) => e.message)
      .slice(-limit);
  } catch {
    return [];
  }
}
