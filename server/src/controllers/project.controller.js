import prisma from '../config/db.js';

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
    } = req.body;

    if (!name || !githubRepoFullName || !githubRepoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Project name, GitHub repository full name, and repository URL are required.',
      });
    }

    const project = await prisma.$transaction(async (tx) => {
      // 1. Create Project
      const newProj = await tx.project.create({
        data: {
          userId: req.user.userId,
          name,
          githubRepoFullName,
          githubRepoUrl,
          defaultBranch,
          detectedPreset,
        },
      });

      // 2. Create Backend Service (Render)
      if (backendService) {
        await tx.projectService.create({
          data: {
            projectId: newProj.id,
            serviceType: 'BACKEND',
            provider: 'RENDER',
            rootDirectory: backendService.rootDirectory || '/server',
            buildCommand: backendService.buildCommand || 'npm install',
            startCommand: backendService.startCommand || 'npm start',
            healthCheckPath: backendService.healthCheckPath || '/health',
          },
        });
      }

      // 3. Create Frontend Service (Vercel)
      if (frontendService) {
        await tx.projectService.create({
          data: {
            projectId: newProj.id,
            serviceType: 'FRONTEND',
            provider: 'VERCEL',
            rootDirectory: frontendService.rootDirectory || '/client',
            buildCommand: frontendService.buildCommand || 'npm run build',
            startCommand: frontendService.startCommand || 'npm run preview',
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
