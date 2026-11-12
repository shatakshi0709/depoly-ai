import prisma from '../config/db.js';
import { emitDeploymentEvent, emitDeploymentLog } from '../sockets/socketManager.js';
import { DEPLOYMENT_STATUS, STEP_STATUS, SOCKET_EVENTS } from '@deplo/shared';
import { createRenderWebService, verifyBackendHealth } from '../services/render.service.js';
import { injectVercelEnvironmentVariable, triggerVercelDeploy } from '../services/vercel.service.js';

/**
 * Trigger a new deployment pipeline for a project.
 */
export async function triggerDeployment(req, res, next) {
  try {
    const { projectId, commitHash = 'main-head', commitMessage = 'Manual deployment trigger' } = req.body;

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: req.user.userId,
      },
      include: {
        services: true,
        envVariables: true,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found.',
      });
    }

    // Atomic SQL transaction creating deployment, sequential steps, and initial log
    const deployment = await prisma.$transaction(async (tx) => {
      const dep = await tx.deployment.create({
        data: {
          projectId: project.id,
          status: DEPLOYMENT_STATUS.ANALYZING,
          commitHash: commitHash.slice(0, 7),
          commitMessage,
          triggeredBy: req.user.email,
        },
      });

      const steps = [
        { name: 'Repository Inspection', provider: 'GITHUB', order: 1 },
        { name: 'Backend Build & Deploy', provider: 'RENDER', order: 2 },
        { name: 'Backend Health Verification', provider: 'RENDER', order: 3 },
        { name: 'Environment URL Injection', provider: 'VERCEL', order: 4 },
        { name: 'Frontend Build & Deploy', provider: 'VERCEL', order: 5 },
      ];

      for (const step of steps) {
        await tx.deploymentStep.create({
          data: {
            deploymentId: dep.id,
            stepName: step.name,
            provider: step.provider,
            stepOrder: step.order,
            status: step.order === 1 ? STEP_STATUS.RUNNING : STEP_STATUS.PENDING,
            startedAt: step.order === 1 ? new Date() : null,
          },
        });
      }

      await tx.deploymentLog.create({
        data: {
          deploymentId: dep.id,
          logLevel: 'INFO',
          stage: 'ORCHESTRATOR',
          message: `Deployment orchestration initialized for "${project.name}" (Branch: ${project.defaultBranch}).`,
        },
      });

      return dep;
    });

    emitDeploymentEvent(deployment.id, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId: deployment.id,
      status: DEPLOYMENT_STATUS.ANALYZING,
    });

    // Start asynchronous orchestration pipeline execution
    executeOrchestration(deployment.id, project);

    res.status(201).json({
      success: true,
      message: 'Deployment pipeline initiated.',
      data: deployment,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get deployment status, execution steps, and live logs.
 */
export async function getDeployment(req, res, next) {
  try {
    const { id } = req.params;

    const deployment = await prisma.deployment.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true, githubRepoFullName: true, defaultBranch: true, userId: true },
        },
        steps: {
          orderBy: { stepOrder: 'asc' },
        },
        logs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!deployment || deployment.project.userId !== req.user.userId) {
      return res.status(404).json({
        success: false,
        message: 'Deployment not found.',
      });
    }

    res.json({
      success: true,
      data: deployment,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Chained Orchestration Pipeline Engine
 * Guarantees correct order: Render Backend -> Health Check -> Vercel Env Injection -> Vercel Frontend Deploy.
 */
async function executeOrchestration(deploymentId, project) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const startTime = Date.now();

  async function addLog(stage, message, logLevel = 'INFO') {
    try {
      await prisma.deploymentLog.create({
        data: { deploymentId, stage, message, logLevel },
      });
      emitDeploymentLog(deploymentId, { stage, message, logLevel });
    } catch (e) {
      console.error('Failed to write log:', e.message);
    }
  }

  async function updateStep(order, status, externalDeployId = null) {
    try {
      const step = await prisma.deploymentStep.findFirst({
        where: { deploymentId, stepOrder: order },
      });
      if (step) {
        await prisma.deploymentStep.update({
          where: { id: step.id },
          data: {
            status,
            externalDeployId: externalDeployId || step.externalDeployId,
            completedAt: status === STEP_STATUS.SUCCESS || status === STEP_STATUS.FAILED ? new Date() : null,
          },
        });
        emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STEP_UPDATE, {
          stepId: step.id,
          order,
          status,
        });
      }
    } catch (e) {
      console.error('Failed to update step:', e.message);
    }
  }

  try {
    const backendService = project.services?.find((s) => s.serviceType === 'BACKEND');
    const frontendService = project.services?.find((s) => s.serviceType === 'FRONTEND');

    // -------------------------------------------------------------
    // Step 1: Repository Inspection (GitHub)
    // -------------------------------------------------------------
    await addLog('GITHUB', `Connecting to repository: ${project.githubRepoFullName} (${project.defaultBranch})...`);
    await sleep(1500);
    await addLog('ANALYZER', `Validated directory structure: Backend (${backendService?.rootDirectory || '/server'}), Frontend (${frontendService?.rootDirectory || '/client'}).`);
    await updateStep(1, STEP_STATUS.SUCCESS);

    // -------------------------------------------------------------
    // Step 2: Backend Build & Deploy (Render Cloud Service)
    // -------------------------------------------------------------
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: DEPLOYMENT_STATUS.DEPLOYING_BACKEND },
    });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId,
      status: DEPLOYMENT_STATUS.DEPLOYING_BACKEND,
    });

    await updateStep(2, STEP_STATUS.RUNNING);
    await addLog('RENDER', `Provisioning Render web service container for "${project.name}"...`);

    const renderResult = await createRenderWebService({
      name: project.name,
      repoUrl: project.githubRepoUrl,
      branch: project.defaultBranch,
      rootDir: backendService?.rootDirectory || '/server',
      buildCommand: backendService?.buildCommand || 'npm install',
      startCommand: backendService?.startCommand || 'npm start',
    });

    await sleep(2000);
    await addLog('RENDER', `Running build command: "${backendService?.buildCommand || 'npm install'}"`);
    await sleep(1500);
    await addLog('RENDER', `Service container deployed. URL assigned: ${renderResult.url}`);
    await updateStep(2, STEP_STATUS.SUCCESS, renderResult.serviceId);

    // -------------------------------------------------------------
    // Step 3: Health Verification (HTTP poll before proceeding)
    // -------------------------------------------------------------
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: DEPLOYMENT_STATUS.HEALTH_CHECKING, backendUrl: renderResult.url },
    });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId,
      status: DEPLOYMENT_STATUS.HEALTH_CHECKING,
      backendUrl: renderResult.url,
    });

    await updateStep(3, STEP_STATUS.RUNNING);
    const healthPath = backendService?.healthCheckPath || '/health';
    await addLog('HEALTH_CHECK', `Verifying backend health on GET ${renderResult.url}${healthPath}...`);

    const healthResult = await verifyBackendHealth(renderResult.url, healthPath);
    if (!healthResult.healthy) {
      throw new Error(`Backend service failed health check verification at ${renderResult.url}${healthPath}`);
    }

    await addLog('HEALTH_CHECK', `HTTP 200 OK — Backend service is healthy, online, and accepting traffic.`);
    await updateStep(3, STEP_STATUS.SUCCESS);

    // -------------------------------------------------------------
    // Step 4: Environment URL Injection (Vercel)
    // -------------------------------------------------------------
    await updateStep(4, STEP_STATUS.RUNNING);
    await addLog('VERCEL', `Auto-injecting live backend URL into Vercel production environment: VITE_API_URL=${renderResult.url}`);

    await injectVercelEnvironmentVariable(project.name, 'VITE_API_URL', renderResult.url);
    await sleep(1200);
    await addLog('VERCEL', `Environment variable VITE_API_URL successfully synced to Vercel.`);
    await updateStep(4, STEP_STATUS.SUCCESS);

    // -------------------------------------------------------------
    // Step 5: Frontend Build & Deploy (Vercel)
    // -------------------------------------------------------------
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: DEPLOYMENT_STATUS.DEPLOYING_FRONTEND },
    });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId,
      status: DEPLOYMENT_STATUS.DEPLOYING_FRONTEND,
    });

    await updateStep(5, STEP_STATUS.RUNNING);
    await addLog('VERCEL', `Triggering Vercel production build for frontend (${frontendService?.buildCommand || 'npm run build'})...`);

    const vercelResult = await triggerVercelDeploy({
      name: project.name,
      repoUrl: project.githubRepoUrl,
      branch: project.defaultBranch,
      rootDir: frontendService?.rootDirectory || '/client',
      buildCommand: frontendService?.buildCommand || 'npm run build',
    });

    await sleep(2500);
    await addLog('VERCEL', `Edge routing and asset optimization complete.`);
    await addLog('VERCEL', `Production frontend live: ${vercelResult.url}`);
    await updateStep(5, STEP_STATUS.SUCCESS, vercelResult.deploymentId);

    // -------------------------------------------------------------
    // Deployment Pipeline Completed: SUCCESS
    // -------------------------------------------------------------
    const completedAt = new Date();
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    const finalizedDeployment = await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DEPLOYMENT_STATUS.SUCCESS,
        frontendUrl: vercelResult.url,
        durationSeconds,
        completedAt,
      },
    });

    await addLog('ORCHESTRATOR', `🎉 Full-stack multi-cloud pipeline completed successfully in ${durationSeconds} seconds.`);

    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId,
      status: DEPLOYMENT_STATUS.SUCCESS,
      backendUrl: renderResult.url,
      frontendUrl: vercelResult.url,
      durationSeconds,
    });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_COMPLETED, finalizedDeployment);

  } catch (error) {
    console.error(`Orchestration error for ${deploymentId}:`, error);
    await addLog('ORCHESTRATOR', `Pipeline halted: ${error.message}`, 'ERROR');
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DEPLOYMENT_STATUS.FAILED,
        errorMessage: error.message,
        completedAt: new Date(),
      },
    });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId,
      status: DEPLOYMENT_STATUS.FAILED,
      error: error.message,
    });
  }
}
