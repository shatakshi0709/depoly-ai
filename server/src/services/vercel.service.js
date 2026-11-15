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
 * Map analyzer framework labels to Vercel framework slugs.
 */
export function mapVercelFramework(analyzerFramework) {
  switch (String(analyzerFramework || '').toUpperCase()) {
    case 'NEXT_JS': return 'nextjs';
    case 'VUE': return 'vue';
    case 'CREATE_REACT_APP': return 'create-react-app';
    case 'STATIC_HTML': return null;
    case 'REACT_VITE':
    default: return 'vite';
  }
}

function normalizeRootDir(rootDir) {
  if (!rootDir || rootDir === '/') return null;
  return String(rootDir).replace(/^\//, '');
}

/**
 * Ensure Vercel project exists (best-effort) and return project id/name.
 * Explicitly configures framework, rootDirectory, buildCommand and outputDirectory
 * so a Vite app living in a subdirectory (e.g. vite-project/) resolves its dist/ output.
 */
export async function ensureVercelProject({ name, repoUrl, rootDir = '/client', buildCommand = 'npm run build', outputDirectory = null, framework = 'vite' }) {
  const client = getVercelClient();
  const projectName = safeName(name);
  const normalizedRoot = normalizeRootDir(rootDir);

  if (!client) {
    if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
      return { projectId: `sim-prj-${projectName}`, name: projectName, simulated: true };
    }
    throw new Error('Vercel API key is not configured.');
  }

  const settings = {
    framework,
    rootDirectory: normalizedRoot,
    buildCommand,
  };
  if (outputDirectory) settings.outputDirectory = outputDirectory;

  // Try fetch existing project
  try {
    const res = await client.get(`/v9/projects/${projectName}`);
    const projectId = res.data?.id;
    const existingName = res.data?.name || projectName;
    // Keep settings in sync: a project created during an earlier failed attempt may
    // have a wrong/missing rootDirectory or outputDirectory, which is exactly what
    // causes "[STATIC_BUILD_NO_OUT_DIR] No Output Directory named dist found".
    try {
      await client.patch(`/v9/projects/${projectId || existingName}`, settings);
    } catch {
      // Non-fatal: the deployment payload also carries projectSettings as a fallback.
    }
    return { projectId, name: existingName, simulated: false };
  } catch {
    // create below
  }

  const repo = parseRepoFullName(repoUrl);
  const body = {
    name: projectName,
    ...settings,
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
  let skipped = 0;
  const failures = [];
  for (const item of envVars) {
    if (!item || !item.key) continue;
    // Vercel rejects empty env var values with HTTP 400. A null/undefined/blank value
    // (e.g. VITE_API_URL for a frontend-only project with no backend) is intentionally
    // skipped rather than sent as an invalid empty variable.
    const rawValue = item.value;
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
      skipped += 1;
      continue;
    }
    const body = {
      key: item.key,
      value: String(rawValue),
      type: 'plain',
      target: ['production', 'preview'],
    };
    try {
      await client.post(`/v10/projects/${projectNameOrId}/env`, body);
      applied += 1;
    } catch (err) {
      // 409 => the key already exists on this project; update it in place so the
      // value is actually propagated instead of silently keeping the stale value.
      if (err?.response?.status === 409) {
        try {
          const listRes = await client.get(`/v10/projects/${projectNameOrId}/env`);
          const existing = (listRes.data?.envs || []).find((e) => e.key === item.key);
          if (existing?.id) {
            await client.patch(`/v10/projects/${projectNameOrId}/env/${existing.id}`, {
              value: body.value,
              target: body.target,
            });
            applied += 1;
            continue;
          }
        } catch (updateErr) {
          failures.push({ key: item.key, error: updateErr?.message || 'update failed' });
          continue;
        }
      }
      // Never swallow the failure: a silently skipped env var would be reported as
      // success while the deployed app runs without its required configuration.
      failures.push({ key: item.key, error: err?.message || 'request failed' });
    }
  }

  if (failures.length) {
    const summary = failures.map((f) => `${f.key} (${f.error})`).join('; ');
    const error = new Error(
      `Failed to configure ${failures.length} Vercel environment variable(s): ${summary}`,
    );
    error.failures = failures;
    error.applied = applied;
    throw error;
  }

  return { success: true, simulated: false, count: applied, skipped };
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
export async function triggerVercelDeploy({ name, repoUrl, branch = 'main', rootDir = '/client', buildCommand = 'npm run build', outputDirectory = null, framework = 'vite', projectId = null }) {
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

  const projectSettings = {
    buildCommand,
    rootDirectory: normalizeRootDir(rootDir),
    framework,
  };
  // Without an explicit outputDirectory, Vercel falls back to framework defaults and
  // fails with [STATIC_BUILD_NO_OUT_DIR] when the app lives in a subdirectory.
  if (outputDirectory) projectSettings.outputDirectory = outputDirectory;

  const payload = {
    name: safeProjectName,
    gitSource: {
      type: 'github',
      ref: branch,
      repoId: undefined,
      org: repo.org,
      repo: repo.repo,
    },
    projectSettings,
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
