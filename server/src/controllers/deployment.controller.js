import prisma from '../config/db.js';
import { emitDeploymentEvent, emitDeploymentLog } from '../sockets/socketManager.js';
import { DEPLOYMENT_STATUS, STEP_STATUS, SOCKET_EVENTS } from '@deplo/shared';

/**
 * Trigger a new deployment pipeline for a project.
 */
export async function triggerDeployment(req, res, next) {
  try {
    const { projectId, commitHash = 'main-head', commitMessage = 'Manual deployment trigger' } = req.body;

    // Verify user owns the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: req.user.userId,
      },
      include: {
        services: true,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found.',
      });
    }

    // Atomic SQL transaction creating deployment, steps, and initial log
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

      // Sequential deployment pipeline steps
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
          message: `Deployment orchestration started for "${project.name}" (Branch: ${project.defaultBranch}).`,
        },
      });

      return dep;
    });

    // Notify connected clients via Socket.IO
    emitDeploymentEvent(deployment.id, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId: deployment.id,
      status: DEPLOYMENT_STATUS.ANALYZING,
    });

    // Start background simulation / orchestration runner
    runOrchestrationPipeline(deployment.id, project);

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
 * Asynchronous Orchestration State Machine
 * Coordinates: GitHub Inspection -> Render Backend Deploy -> Health Check -> Vercel Env Injection -> Vercel Frontend Deploy
 */
async function runOrchestrationPipeline(deploymentId, project) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  async function updateStep(order, status) {
    try {
      const step = await prisma.deploymentStep.findFirst({
        where: { deploymentId, stepOrder: order },
      });
      if (step) {
        await prisma.deploymentStep.update({
          where: { id: step.id },
          data: {
            status,
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
    // -------------------------------------------------------------
    // Step 1: Repository Inspection (GitHub)
    // -------------------------------------------------------------
    await addLog('GITHUB', `Cloning repository tree from ${project.githubRepoFullName}...`);
    await sleep(2000);
    await addLog('ANALYZER', `Scanning directories: Found /server (Express.js) and /client (React Vite).`);
    await updateStep(1, STEP_STATUS.SUCCESS);

    // -------------------------------------------------------------
    // Step 2: Backend Build & Deploy (Render)
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
    await addLog('RENDER', `Provisioning Render web service container (Node.js runtime)...`);
    await sleep(2500);
    await addLog('RENDER', `Running build command: "npm install"`);
    await sleep(2000);
    await addLog('RENDER', `Build succeeded. Starting service: "npm start"`);
    await updateStep(2, STEP_STATUS.SUCCESS);

    // -------------------------------------------------------------
    // Step 3: Health Verification (HTTP poll)
    // -------------------------------------------------------------
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: DEPLOYMENT_STATUS.HEALTH_CHECKING },
    });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId,
      status: DEPLOYMENT_STATUS.HEALTH_CHECKING,
    });

    await updateStep(3, STEP_STATUS.RUNNING);
    const mockBackendUrl = `https://api-${project.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.onrender.com`;
    await addLog('HEALTH_CHECK', `Polling GET ${mockBackendUrl}/health ...`);
    await sleep(2000);
    await addLog('HEALTH_CHECK', `HTTP 200 OK — Backend service is healthy and accepting traffic.`);
    await updateStep(3, STEP_STATUS.SUCCESS);

    // Update backend URL in database
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { backendUrl: mockBackendUrl },
    });

    // -------------------------------------------------------------
    // Step 4: Environment URL Injection (Vercel)
    // -------------------------------------------------------------
    await updateStep(4, STEP_STATUS.RUNNING);
    await addLog('VERCEL', `Auto-injecting VITE_API_URL=${mockBackendUrl} into Vercel production environment.`);
    await sleep(1500);
    await addLog('VERCEL', `Environment variable configuration updated and synced.`);
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
    await addLog('VERCEL', `Triggering Vercel deployment pipeline (Vite build)...`);
    await sleep(2000);
    await addLog('VERCEL', `Optimizing static assets & generating edge routing...`);
    await sleep(2000);

    const mockFrontendUrl = `https://${project.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.vercel.app`;
    await addLog('VERCEL', `Frontend deployment complete: ${mockFrontendUrl}`);
    await updateStep(5, STEP_STATUS.SUCCESS);

    // -------------------------------------------------------------
    // Pipeline Finished: SUCCESS
    // -------------------------------------------------------------
    const completedAt = new Date();
    const durationSeconds = 12; // Duration of orchestration demo

    const finalizedDeployment = await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DEPLOYMENT_STATUS.SUCCESS,
        frontendUrl: mockFrontendUrl,
        durationSeconds,
        completedAt,
      },
    });

    await addLog('ORCHESTRATOR', `🎉 Orchestration completed successfully in ${durationSeconds} seconds.`);

    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, {
      deploymentId,
      status: DEPLOYMENT_STATUS.SUCCESS,
      backendUrl: mockBackendUrl,
      frontendUrl: mockFrontendUrl,
    });
    emitDeploymentEvent(deploymentId, SOCKET_EVENTS.DEPLOYMENT_COMPLETED, finalizedDeployment);

  } catch (error) {
    console.error(`Orchestration error for ${deploymentId}:`, error);
    await addLog('ORCHESTRATOR', `Pipeline failed: ${error.message}`, 'ERROR');
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

