import prisma from '../config/db.js';
import { isUuid, isNonEmptyString } from '../utils/validate.js';

function sanitizeServiceInput(input) {
  if (!input || typeof input !== 'object') return null;
  const pick = (v, max = 255) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
  return {
    rootDirectory: pick(input.rootDirectory),
    buildCommand: pick(input.buildCommand),
    startCommand: pick(input.startCommand),
    healthCheckPath: pick(input.healthCheckPath),
    renderPlan: pick(input.renderPlan),
    listensOnPortEnv: input.listensOnPortEnv === true,
    listensOnAllInterfaces: input.listensOnAllInterfaces === true,
  };
}

/**
 * Determine whether a backend service payload represents a real, provisionable backend.
 *
 * Guards against persisting a "phantom" backend service — e.g. one submitted for a
 * frontend-only analysis (detected:false / all-null config) — which would otherwise be
 * stored with default values and later trigger a doomed Render provisioning attempt.
 */
export function isValidBackendServiceInput(input) {
  if (!input || typeof input !== 'object') return false;
  if (input.detected === false) return false;
  const hasText = (v) => typeof v === 'string' && v.trim().length > 0;
  return hasText(input.rootDirectory) && hasText(input.buildCommand) && hasText(input.startCommand);
}

/**
 * List all projects owned by the authenticated user.
 */
export async function getProjects(req, res, next) {
  try {
    const projects = await prisma.project.findMany({
      where: { userId: req.user.userId },
      include: {
        services: true,
        deployments: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
        _count: {
          select: { deployments: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({
      success: true,
      data: projects,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get single project by ID with its services, env vars, and past deployments.
 */
export async function getProjectById(req, res, next) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid project identifier.' });
    }

    const project = await prisma.project.findFirst({
      where: {
        id,
        userId: req.user.userId,
      },
      include: {
        services: true,
        envVariables: {
          select: {
            id: true,
            serviceTarget: true,
            key: true,
            isSecret: true,
            updatedAt: true,
          },
        },
        deployments: {
          orderBy: { startedAt: 'desc' },
          take: 10,
          include: {
            steps: {
              orderBy: { stepOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found.',
      });
    }

    res.json({
      success: true,
      data: project,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new project with backend and frontend services.
 */
export async function createProject(req, res, next) {
  try {
    const {
      name,
      githubRepoFullName,
      githubRepoUrl,
      defaultBranch = 'main',
      detectedPreset = 'REACT_VITE',
      backendService,
      frontendService,
    } = req.body || {};

    if (!isNonEmptyString(name) || !isNonEmptyString(githubRepoFullName) || !isNonEmptyString(githubRepoUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Project name, repository name, and repository URL are required.',
      });
    }

    if (name.trim().length > 100 || githubRepoFullName.trim().length > 255 || githubRepoUrl.trim().length > 500) {
      return res.status(400).json({ success: false, message: 'Project fields exceed allowed length.' });
    }

    const safeBackend = sanitizeServiceInput(backendService);
    const backendIsProvisionable = isValidBackendServiceInput(backendService);
    const safeFrontend = sanitizeServiceInput(frontendService);
    const safeBranch = (typeof defaultBranch === 'string' ? defaultBranch.trim() : 'main').slice(0, 50) || 'main';
    const safePreset = (typeof detectedPreset === 'string' ? detectedPreset.trim() : 'REACT_VITE').slice(0, 50) || 'REACT_VITE';

    const project = await prisma.$transaction(async (tx) => {
      // 1. Create Project
      const newProj = await tx.project.create({
        data: {
          userId: req.user.userId,
          name: name.trim(),
          githubRepoFullName: githubRepoFullName.trim(),
          githubRepoUrl: githubRepoUrl.trim(),
          defaultBranch: safeBranch,
          detectedPreset: safePreset,
        },
      });

      // 2. Create Backend Service (Render) — only when a genuine backend was analyzed.
      // A phantom/empty backend payload (e.g. from a frontend-only analysis) is skipped
      // so it can never be persisted and later trigger Render provisioning.
      if (safeBackend && backendIsProvisionable) {
        await tx.projectService.create({
          data: {
            projectId: newProj.id,
            serviceType: 'BACKEND',
            provider: 'RENDER',
            rootDirectory: safeBackend.rootDirectory || '/server',
            buildCommand: safeBackend.buildCommand || 'npm install',
            startCommand: safeBackend.startCommand || 'npm start',
            healthCheckPath: safeBackend.healthCheckPath || '/health',
            renderPlan: safeBackend.renderPlan || 'free',
            listensOnPortEnv: safeBackend.listensOnPortEnv || false,
            listensOnAllInterfaces: safeBackend.listensOnAllInterfaces || false,
          },
        });
      }

      // 3. Create Frontend Service (Vercel)
      if (safeFrontend) {
        await tx.projectService.create({
          data: {
            projectId: newProj.id,
            serviceType: 'FRONTEND',
            provider: 'VERCEL',
            rootDirectory: safeFrontend.rootDirectory || '/client',
            buildCommand: safeFrontend.buildCommand || 'npm run build',
            startCommand: safeFrontend.startCommand || 'npm run preview',
          },
        });
      }

      return newProj;
    });

    res.status(201).json({
      success: true,
      message: 'Project created successfully.',
      data: project,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * College SQL Requirement: Query the Analytical Database View (v_project_deployment_metrics)
 */
export async function getAnalytics(req, res, next) {
  try {
    const metrics = await prisma.$queryRaw`
      SELECT 
        v.*
      FROM v_project_deployment_metrics v
      JOIN projects p ON v.project_id = p.id
      WHERE p.user_id = ${req.user.userId}::uuid;
    `;

    // Convert any BigInt fields to standard Numbers for JSON response
    const sanitizedMetrics = metrics.map((m) => ({
      ...m,
      total_deployments: Number(m.total_deployments || 0),
      successful_deployments: Number(m.successful_deployments || 0),
      failed_deployments: Number(m.failed_deployments || 0),
    }));

    res.json({
      success: true,
      data: sanitizedMetrics,
    });
  } catch (error) {
    next(error);
  }
}
