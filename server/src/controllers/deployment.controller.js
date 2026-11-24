import prisma from '../config/db.js';
import { emitDeploymentEvent, emitDeploymentLog, emitUserNotification } from '../sockets/socketManager.js';
import { DEPLOYMENT_STATUS, STEP_STATUS, SOCKET_EVENTS } from '@deplo/shared';
import { env } from '../config/env.js';
import { decrypt } from '../utils/crypto.js';
import { isUuid, isNonEmptyString } from '../utils/validate.js';
import { sanitizeLogMessage, sanitizeText } from '../utils/sanitize.js';
import {
  createRenderWebService,
  triggerRenderDeploy,
  pollRenderDeployStatus,
  getRenderService,
  fetchRenderDeployLogs,
  verifyBackendHealth,
  sanitizeRenderError,
} from '../services/render.service.js';
import {
  ensureVercelProject,
  upsertVercelEnvVars,
  triggerVercelDeploy,
  pollVercelDeployment,
  fetchVercelDeploymentLogs,
} from '../services/vercel.service.js';

const SAFE_ERROR_PROD = 'Deployment failed. Check deployment logs for details.';

function safeErrorMessage(err) {
  if (env.isProduction) return SAFE_ERROR_PROD;
  const msg = err?.message || 'Deployment pipeline failed.';
  return sanitizeText(msg, 500);
}

/**
 * Validate analyzer-provided backend service config against basic sanity rules.
 * Does not hardcode repo-specific settings; only ensures required fields are present
 * and well-formed before provider provisioning.
 */
export function validateBackendServiceConfig(backendService, repoUrl) {
  const issues = [];
  if (!backendService) {
    issues.push('No backend service configuration found from analyzer.');
    return issues;
  }
  if (!isNonEmptyString(backendService.rootDirectory) || backendService.rootDirectory.trim().length === 0) {
    issues.push('Backend rootDirectory is missing or empty.');
  }
  if (!isNonEmptyString(backendService.buildCommand) || backendService.buildCommand.trim().length === 0) {
    issues.push('Backend buildCommand is missing or empty.');
  }
  if (!isNonEmptyString(backendService.startCommand) || backendService.startCommand.trim().length === 0) {
    issues.push('Backend startCommand is missing or empty.');
  }
  if (!isNonEmptyString(repoUrl) || !/^https?:\/\/github\.com\//i.test(repoUrl)) {
    issues.push('Repository URL is missing or not a valid GitHub URL.');
  }
  if (!isNonEmptyString(backendService.healthCheckPath) || !String(backendService.healthCheckPath).startsWith('/')) {
    issues.push('Backend healthCheckPath is missing or does not start with "/".');
  }
  return issues;
}

async function createNotification({ userId, deploymentId, projectId, type, title, message }) {
  try {
    const n = await prisma.notification.create({
      data: { userId, deploymentId, projectId, type, title, message: String(message).slice(0, 2000) },
    });
    emitUserNotification(userId, n);
    return n;
  } catch {
    return null;
  }
}

async function addLog(deploymentId, { stage, message, logLevel = 'INFO', source = 'ORCHESTRATOR' }) {
  try {
    const safeStage = sanitizeText(stage || 'ORCHESTRATOR', 50) || 'ORCHESTRATOR';
    const safeMessage = sanitizeLogMessage(message || '', 8000);
    const safeLevel = ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(logLevel) ? logLevel : 'INFO';
    const safeSource = source === 'PROVIDER' ? 'PROVIDER' : 'ORCHESTRATOR';
    const log = await prisma.deploymentLog.create({
      data: {
        deploymentId,
        stage: safeStage,
        message: safeMessage,
        logLevel: safeLevel,
        source: safeSource,
      },
    });
    emitDeploymentLog(deploymentId, { stage: log.stage, message: log.message, logLevel: log.logLevel, source: log.source, createdAt: log.createdAt });
    return log;
  } catch {
    return null;
  }
}

async function ingestProviderLogs(deploymentId, stage, entries = [], providerLabel = 'PROVIDER') {
  const limited = (entries || []).slice(-200);
  for (const entry of limited) {
    if (!entry?.message) continue;
    await addLog(deploymentId, {
      stage,
      message: `[${sanitizeText(providerLabel, 30)}] ${sanitizeLogMessage(entry.message, 4000)}`,
      logLevel: entry.level === 'ERROR' ? 'ERROR' : 'INFO',
      source: 'PROVIDER',
    });
  }
}

async function updateStep(deploymentId, order, status, externalDeployId = null) {
  try {
    const step = await prisma.deploymentStep.findFirst({ where: { deploymentId, stepOrder: order } });
    if (!step) return;
    const runningStart = status === STEP_STATUS.RUNNING ? new Date() : step.startedAt;
    await prisma.deploymentStep.update({
      where: { id: step.id },
      data: {
        status,
        externalDeployId: externalDeployId || step.externalDeployId,
        startedAt: runningStart,
        completedAt: status === STEP_STATUS.SUCCESS || status === STEP_STATUS.FAILED || status === STEP_STATUS.SKIPPED ? new Date() : null,
      },
    });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STEP_UPDATE, { stepId: step.id, order, status });
  } catch {
    // best-effort
  }
}

async function failRemainingSteps(deploymentId, fromOrder) {
  try {
    const steps = await prisma.deploymentStep.findMany({ where: { deploymentId } });
    for (const s of steps) {
      if (s.stepOrder >= fromOrder && s.status !== STEP_STATUS.SUCCESS) {
        await updateStep(deploymentId, s.stepOrder, STEP_STATUS.FAILED);
      } else if (s.stepOrder > fromOrder && s.status === STEP_STATUS.PENDING) {
        await prisma.deploymentStep.update({ where: { id: s.id }, data: { status: STEP_STATUS.SKIPPED, completedAt: new Date() } });
      }
    }
  } catch {
    // ignore
  }
}

async function createDeploymentRecord({ project, userId, userEmail, commitHash, commitMessage, retriedFromId = null, attemptNumber = 1 }) {
  const safeCommitHash = typeof commitHash === 'string' ? commitHash.trim().slice(0, 40) : 'main-head';
  const safeCommitMessage = typeof commitMessage === 'string' ? commitMessage.trim().slice(0, 500) : 'Manual deployment trigger';

  return prisma.$transaction(async (tx) => {
    const dep = await tx.deployment.create({
      data: {
        projectId: project.id,
        status: DEPLOYMENT_STATUS.ANALYZING,
        attemptNumber,
        retriedFromId,
        commitHash: safeCommitHash.slice(0, 7),
        commitMessage: safeCommitMessage,
        triggeredBy: userEmail || 'MANUAL',
      },
    });

    const steps = [
      { name: 'Repository Inspection', provider: 'GITHUB', order: 1 },
      { name: 'Backend Build & Deploy', provider: 'RENDER', order: 2 },
      { name: 'Backend Health Verification', provider: 'RENDER', order: 3 },
      { name: 'Environment URL Injection', provider: 'VERCEL', order: 4 },
      { name: 'Frontend Build & Deploy', provider: 'VERCEL', order: 5 },
    ];

    await tx.deploymentStep.createMany({
      data: steps.map((step) => ({
        deploymentId: dep.id,
        stepName: step.name,
        provider: step.provider,
        stepOrder: step.order,
        status: step.order === 1 ? STEP_STATUS.RUNNING : STEP_STATUS.PENDING,
        startedAt: step.order === 1 ? new Date() : null,
      })),
    });

    await tx.deploymentLog.create({
      data: {
        deploymentId: dep.id,
        logLevel: 'INFO',
        source: 'ORCHESTRATOR',
        stage: 'ORCHESTRATOR',
        message: `Deployment orchestration initialized for "${project.name}" (Branch: ${project.defaultBranch}, Attempt #${attemptNumber}).`,
      },
    });

    if (env.ALLOW_SIMULATED_DEPLOYMENTS) {
      await tx.deploymentLog.create({
        data: {
          deploymentId: dep.id,
          logLevel: 'WARN',
          source: 'ORCHESTRATOR',
          stage: 'ORCHESTRATOR',
          message: 'SIMULATION MODE (development, explicitly enabled): provider actions may be simulated and are clearly labeled.',
        },
      });
    }

    return dep;
  });
}

function getProjectEnvVarsForProvider(projectEnvVars, target) {
  const out = [];
  for (const row of projectEnvVars || []) {
    if (!row || !row.key) continue;
    if (row.serviceTarget !== 'SHARED' && row.serviceTarget !== target) continue;
    try {
      const value = decrypt(row.valueEnc);
      if (value == null) continue;
      out.push({ key: row.key, value: String(value) });
    } catch {
      // skip undecryptable values
    }
  }
  return out;
}

export async function triggerDeployment(req, res, next) {
  try {
    const { projectId, commitHash = 'main-head', commitMessage = 'Manual deployment trigger' } = req.body || {};
    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, message: 'A valid project identifier is required.' });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.user.userId },
      include: { services: true },
    });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found.' });

    const deployment = await createDeploymentRecord({
      project,
      userId: req.user.userId,
      userEmail: req.user.email,
      commitHash,
      commitMessage,
      attemptNumber: 1,
    });

    emitDeploymentEvent(deployment.id, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId: deployment.id,
      status: DEPLOYMENT_STATUS.ANALYZING,
    });

    executeOrchestration(deployment.id, project.id, req.user.userId);

    res.status(201).json({ success: true, message: 'Deployment pipeline initiated.', data: deployment });
  } catch (error) {
    next(error);
  }
}

export async function retryDeployment(req, res, next) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid deployment identifier.' });
    }

    const original = await prisma.deployment.findUnique({
      where: { id },
      include: { project: { include: { services: true } } },
    });

    if (!original || original.project.userId !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Deployment not found.' });
    }
    if (original.status !== DEPLOYMENT_STATUS.FAILED) {
      return res.status(400).json({ success: false, message: 'Only failed deployments can be retried.' });
    }

    const nextAttempt = (original.attemptNumber || 1) + 1;
    const deployment = await createDeploymentRecord({
      project: original.project,
      userId: req.user.userId,
      userEmail: req.user.email,
      commitHash: original.commitHash || 'main-head',
      commitMessage: `Retry of deployment ${original.id.slice(0, 8)} (attempt ${nextAttempt})`,
      retriedFromId: original.id,
      attemptNumber: nextAttempt,
    });

    await createNotification({
      userId: req.user.userId,
      deploymentId: deployment.id,
      projectId: original.projectId,
      type: 'DEPLOYMENT_RETRY',
      title: 'Deployment retry started',
      message: `Retry attempt #${nextAttempt} started for "${original.project.name}".`,
    });

    emitDeploymentEvent(deployment.id, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId: deployment.id,
      status: DEPLOYMENT_STATUS.ANALYZING,
    });

    executeOrchestration(deployment.id, original.project.id, req.user.userId);

    res.status(201).json({ success: true, message: 'Deployment retry initiated.', data: deployment });
  } catch (error) {
    next(error);
  }
}

export async function getDeployment(req, res, next) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid deployment identifier.' });
    }

    const deployment = await prisma.deployment.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true, githubRepoFullName: true, defaultBranch: true, userId: true } },
        steps: { orderBy: { stepOrder: 'asc' } },
        logs: { orderBy: { createdAt: 'asc' } },
        retriedFrom: { select: { id: true, attemptNumber: true, status: true, startedAt: true } },
        retries: { select: { id: true, attemptNumber: true, status: true, startedAt: true }, orderBy: { startedAt: 'asc' } },
      },
    });

    if (!deployment || deployment.project.userId !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Deployment not found.' });
    }

    res.json({ success: true, data: deployment });
  } catch (error) {
    next(error);
  }
}

async function executeOrchestration(deploymentId, projectId, userId) {
  const startTime = Date.now();
  let currentStepOrder = 1;

  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      include: { services: true, envVariables: true },
    });
    if (!project) throw new Error('Project not found for deployment execution.');

    const backendService = project.services?.find((s) => s.serviceType === 'BACKEND');
    const frontendService = project.services?.find((s) => s.serviceType === 'FRONTEND');

    // Step 1: Repository inspection (orchestration)
    currentStepOrder = 1;
    await addLog(deploymentId, { stage: 'GITHUB', source: 'ORCHESTRATOR', message: `Repository: ${project.githubRepoFullName} (branch: ${project.defaultBranch})` });
    await addLog(deploymentId, { stage: 'ANALYZER', source: 'ORCHESTRATOR', message: `Backend: ${backendService?.rootDirectory || '/server'}, Frontend: ${frontendService?.rootDirectory || '/client'}` });
    await updateStep(deploymentId, 1, STEP_STATUS.SUCCESS);

    // Step 2: Render backend deploy
    currentStepOrder = 2;
    await prisma.deployment.update({ where: { id: deploymentId }, data: { status: DEPLOYMENT_STATUS.DEPLOYING_BACKEND } });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, { deploymentId, status: DEPLOYMENT_STATUS.DEPLOYING_BACKEND });
    await updateStep(deploymentId, 2, STEP_STATUS.RUNNING);

    const backendEnvVars = getProjectEnvVarsForProvider(project.envVariables, 'BACKEND');
    await addLog(deploymentId, { stage: 'RENDER', source: 'ORCHESTRATOR', message: `Provisioning backend service on Render for "${project.name}"...` });

    // Validate analyzer output against basic sanity rules before provider provisioning.
    const configIssues = validateBackendServiceConfig(backendService, project.githubRepoUrl);
    if (configIssues.length > 0) {
      throw new Error(`Invalid backend service configuration: ${configIssues.join('; ')}`);
    }

    // Retry dedup: reuse an existing Render service from a previous deployment of this project
    // instead of creating a duplicate. Only provision a new service when none exists.
    let renderServiceId = null;
    let renderDeployId = null;
    const priorDeployments = await prisma.deployment.findMany({
      where: { projectId, renderServiceId: { not: null } },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: { id: true, renderServiceId: true, renderDeployId: true, status: true, attemptNumber: true },
    });

    if (priorDeployments.length > 0) {
      const prior = priorDeployments[0];
      renderServiceId = prior.renderServiceId;
      renderDeployId = prior.renderDeployId || null;
      await addLog(deploymentId, { stage: 'RENDER', source: 'ORCHESTRATOR', message: `Reusing existing Render service ${renderServiceId} from prior deployment ${prior.id} (attempt #${prior.attemptNumber}).` });

      // Trigger a new deploy on the existing service when we have a live API key.
      if (env.RENDER_API_KEY && renderServiceId) {
        try {
          const t = await triggerRenderDeploy(renderServiceId);
          renderDeployId = t.deployId;
          await addLog(deploymentId, { stage: 'RENDER', source: 'ORCHESTRATOR', message: `Triggered new deploy ${renderDeployId} on existing Render service ${renderServiceId}.` });
        } catch (deployErr) {
          const renderErr = sanitizeRenderError(deployErr);
          await addLog(deploymentId, { stage: 'RENDER', source: 'ORCHESTRATOR', logLevel: 'ERROR', message: `Failed to trigger deploy on existing Render service: ${renderErr.message}` });
          throw deployErr;
        }
      }
    } else {
      const renderResult = await createRenderWebService({
        name: project.name,
        repoUrl: project.githubRepoUrl,
        branch: project.defaultBranch,
        rootDir: backendService?.rootDirectory || '/server',
        buildCommand: backendService?.buildCommand || 'npm install',
        startCommand: backendService?.startCommand || 'npm start',
        envVars: backendEnvVars,
      });

      renderServiceId = renderResult.serviceId || null;
      renderDeployId = renderResult.deployId || null;

      await prisma.deployment.update({
        where: { id: deploymentId },
        data: { renderServiceId: renderServiceId || null, renderDeployId: renderDeployId || null },
      });

      if (renderResult.simulated) {
        await addLog(deploymentId, { stage: 'RENDER', source: 'ORCHESTRATOR', logLevel: 'WARN', message: 'SIMULATED (dev mode): Render service/deploy created via explicit simulation, not a real provider deployment.' });
      }

      if (!renderDeployId && renderServiceId && env.RENDER_API_KEY) {
        try {
          const t = await triggerRenderDeploy(renderServiceId);
          renderDeployId = t.deployId;
          await prisma.deployment.update({ where: { id: deploymentId }, data: { renderDeployId } });
        } catch {
          // continue; polling by service latest deploy may be needed in future enhancement
        }
      }

      await addLog(deploymentId, { stage: 'RENDER', source: 'ORCHESTRATOR', message: `Render service reported (service: ${renderServiceId || 'n/a'}${renderDeployId ? `, deploy: ${renderDeployId}` : ''}).` });
    }

    // Poll Render deploy readiness when we have ids and live API
    if (env.RENDER_API_KEY && renderServiceId && renderDeployId) {
      await addLog(deploymentId, { stage: 'RENDER', source: 'ORCHESTRATOR', message: 'Polling Render deployment status until live...' });
      const renderStatus = await pollRenderDeployStatus(renderServiceId, renderDeployId, { timeoutMs: 12 * 60 * 1000, intervalMs: 10000 });
      const logs = await fetchRenderDeployLogs(renderServiceId, renderDeployId);
      await ingestProviderLogs(deploymentId, 'RENDER', logs, 'Render');
      if (renderStatus.timedOut) throw new Error('Render deployment timed out before reaching a live state.');
      if (renderStatus.status !== 'live') {
        throw new Error(`Render deployment did not reach live state (status: ${renderStatus.status || 'unknown'}).`);
      }
      await addLog(deploymentId, { stage: 'RENDER', source: 'ORCHESTRATOR', message: 'Render reports deployment status: live.' });
    } else if (!priorDeployments.length && renderResult?.simulated) {
      await addLog(deploymentId, { stage: 'RENDER', source: 'PROVIDER', logLevel: 'INFO', message: '[Render][SIMULATED] Build and deploy completed (simulated).' });
    } else if (!env.RENDER_API_KEY) {
      throw new Error('Render API key is required to confirm backend deployment status.');
    }

    // Resolve actual backend URL from provider when possible
    let backendUrl = null;
    if (env.RENDER_API_KEY && renderServiceId) {
      try {
        const svc = await getRenderService(renderServiceId);
        if (svc?.url) backendUrl = svc.url;
      } catch {
        // keep reported URL
      }
    }
    if (!backendUrl && renderResult?.url) backendUrl = renderResult.url;
    if (!backendUrl) throw new Error('Backend service URL could not be determined from provider response.');

    await addLog(deploymentId, { stage: 'RENDER', source: 'ORCHESTRATOR', message: `Backend service URL: ${backendUrl}` });
    await updateStep(deploymentId, 2, STEP_STATUS.SUCCESS, renderDeployId || renderServiceId);

    // Step 3: Health verification (real HTTP check; simulated only if explicitly enabled & no key)
    currentStepOrder = 3;
    await prisma.deployment.update({ where: { id: deploymentId }, data: { status: DEPLOYMENT_STATUS.HEALTH_CHECKING, backendUrl } });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, { deploymentId, status: DEPLOYMENT_STATUS.HEALTH_CHECKING, backendUrl });
    await updateStep(deploymentId, 3, STEP_STATUS.RUNNING);

    const healthPath = backendService?.healthCheckPath || '/health';
    await addLog(deploymentId, { stage: 'HEALTH_CHECK', source: 'ORCHESTRATOR', message: `Verifying backend health at ${backendUrl}${healthPath}...` });
    const healthResult = await verifyBackendHealth(backendUrl, healthPath, { maxRetries: 24, delayMs: 5000 });
    if (!healthResult.healthy) {
      throw new Error(healthResult.error ? `Backend health check failed: ${healthResult.error}` : 'Backend health check failed.');
    }
    if (healthResult.simulated) {
      await addLog(deploymentId, { stage: 'HEALTH_CHECK', source: 'ORCHESTRATOR', logLevel: 'WARN', message: 'SIMULATED (dev mode): Backend health verification simulated.' });
    } else {
      await addLog(deploymentId, { stage: 'HEALTH_CHECK', source: 'ORCHESTRATOR', message: `Backend healthy (HTTP ${healthResult.statusCode}).` });
    }
    await updateStep(deploymentId, 3, STEP_STATUS.SUCCESS);

    // Step 4: Vercel env propagation (includes VITE_API_URL + configured frontend/shared vars)
    currentStepOrder = 4;
    await updateStep(deploymentId, 4, STEP_STATUS.RUNNING);
    await addLog(deploymentId, { stage: 'VERCEL', source: 'ORCHESTRATOR', message: 'Preparing Vercel project and propagating environment variables...' });

    const vercelProject = await ensureVercelProject({
      name: project.name,
      repoUrl: project.githubRepoUrl,
      rootDir: frontendService?.rootDirectory || '/client',
      buildCommand: frontendService?.buildCommand || 'npm run build',
    });

    const frontendEnvVars = getProjectEnvVarsForProvider(project.envVariables, 'FRONTEND')
      .filter((e) => e.key !== 'VITE_API_URL');
    const envVarsToSet = [...frontendEnvVars, { key: 'VITE_API_URL', value: backendUrl }];
    const envResult = await upsertVercelEnvVars(vercelProject.projectId || vercelProject.name || project.name, envVarsToSet);
    await prisma.deployment.update({ where: { id: deploymentId }, data: { vercelProjectId: vercelProject.projectId || vercelProject.name || null } });

    if (envResult.simulated || vercelProject.simulated) {
      await addLog(deploymentId, { stage: 'VERCEL', source: 'ORCHESTRATOR', logLevel: 'WARN', message: 'SIMULATED (dev mode): Vercel project/env propagation simulated.' });
    } else {
      await addLog(deploymentId, { stage: 'VERCEL', source: 'ORCHESTRATOR', message: `Vercel environment variables propagated (${envVarsToSet.length} keys, values not logged).` });
    }
    await updateStep(deploymentId, 4, STEP_STATUS.SUCCESS, vercelProject.projectId || null);

    // Step 5: Vercel frontend deploy + readiness polling
    currentStepOrder = 5;
    await prisma.deployment.update({ where: { id: deploymentId }, data: { status: DEPLOYMENT_STATUS.DEPLOYING_FRONTEND } });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, { deploymentId, status: DEPLOYMENT_STATUS.DEPLOYING_FRONTEND });
    await updateStep(deploymentId, 5, STEP_STATUS.RUNNING);
    await addLog(deploymentId, { stage: 'VERCEL', source: 'ORCHESTRATOR', message: 'Triggering Vercel frontend deployment...' });

    const vercelResult = await triggerVercelDeploy({
      name: project.name,
      repoUrl: project.githubRepoUrl,
      branch: project.defaultBranch,
      rootDir: frontendService?.rootDirectory || '/client',
      buildCommand: frontendService?.buildCommand || 'npm run build',
      projectId: vercelProject.projectId,
    });

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { vercelDeployId: vercelResult.deploymentId || null, vercelProjectId: vercelResult.projectId || vercelProject.projectId || null },
    });

    if (vercelResult.simulated) {
      await addLog(deploymentId, { stage: 'VERCEL', source: 'ORCHESTRATOR', logLevel: 'WARN', message: 'SIMULATED (dev mode): Vercel deployment simulated.' });
      await addLog(deploymentId, { stage: 'VERCEL', source: 'PROVIDER', message: '[Vercel][SIMULATED] Build completed (simulated).' });
    }

    let finalFrontendUrl = vercelResult.url || null;
    if (env.VERCEL_API_KEY && vercelResult.deploymentId && !vercelResult.simulated) {
      await addLog(deploymentId, { stage: 'VERCEL', source: 'ORCHESTRATOR', message: 'Polling Vercel deployment readiness...' });
      const vercelStatus = await pollVercelDeployment(vercelResult.deploymentId, { timeoutMs: 12 * 60 * 1000, intervalMs: 10000 });
      const vLogs = await fetchVercelDeploymentLogs(vercelResult.deploymentId);
      await ingestProviderLogs(deploymentId, 'VERCEL', vLogs, 'Vercel');
      if (vercelStatus.timedOut) throw new Error('Vercel deployment timed out before reaching READY state.');
      if (vercelStatus.readyState !== 'READY') {
        throw new Error(`Vercel deployment failed (state: ${vercelStatus.readyState || 'unknown'}).`);
      }
      finalFrontendUrl = vercelStatus.url || finalFrontendUrl;
      await addLog(deploymentId, { stage: 'VERCEL', source: 'ORCHESTRATOR', message: 'Vercel reports deployment state: READY.' });
    }

    if (!finalFrontendUrl) throw new Error('Frontend deployment URL could not be determined from provider response.');

    await addLog(deploymentId, { stage: 'VERCEL', source: 'ORCHESTRATOR', message: `Frontend deployment URL: ${finalFrontendUrl}` });
    await updateStep(deploymentId, 5, STEP_STATUS.SUCCESS, vercelResult.deploymentId);

    // Success (only after provider-confirmed/simulated-explicit success path above)
    const completedAt = new Date();
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    const finalized = await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DEPLOYMENT_STATUS.SUCCESS,
        frontendUrl: finalFrontendUrl,
        backendUrl,
        durationSeconds,
        completedAt,
        errorMessage: null,
      },
    });

    await addLog(deploymentId, { stage: 'ORCHESTRATOR', source: 'ORCHESTRATOR', message: `Pipeline completed in ${durationSeconds} seconds.` });
    await createNotification({
      userId,
      deploymentId,
      projectId,
      type: 'DEPLOYMENT_SUCCESS',
      title: 'Deployment successful',
      message: `"${project.name}" deployed successfully${finalized.attemptNumber > 1 ? ` (attempt #${finalized.attemptNumber})` : ''}.`,
    });

    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId,
      status: DEPLOYMENT_STATUS.SUCCESS,
      backendUrl,
      frontendUrl: finalFrontendUrl,
      durationSeconds,
    });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_COMPLETED, finalized);

  } catch (error) {
    const safeMessage = safeErrorMessage(error);
    try {
      await failRemainingSteps(deploymentId, currentStepOrder);
      await addLog(deploymentId, { stage: 'ORCHESTRATOR', source: 'ORCHESTRATOR', logLevel: 'ERROR', message: `Pipeline halted: ${safeMessage}` });
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: DEPLOYMENT_STATUS.FAILED, errorMessage: safeMessage, completedAt: new Date() },
      });
      await createNotification({
        userId,
        deploymentId,
        projectId,
        type: 'DEPLOYMENT_FAILED',
        title: 'Deployment failed',
        message: safeMessage,
      });
      emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
        deploymentId,
        status: DEPLOYMENT_STATUS.FAILED,
        error: safeMessage,
      });
    } catch {
      // swallow secondary failures
    }
  }
}

export async function getProjectDeployments(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project identifier.' });
    }
    const project = await prisma.project.findFirst({ where: { id: projectId, userId: req.user.userId }, select: { id: true } });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found.' });
    const deployments = await prisma.deployment.findMany({
      where: { projectId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    res.json({ success: true, data: deployments });
  } catch (error) {
    next(error);
  }
}
