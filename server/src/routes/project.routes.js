import { Router } from 'express';
import { getProjects, getProjectById, createProject, getAnalytics } from '../controllers/project.controller.js';
import { triggerDeployment, getDeployment, retryDeployment, getProjectDeployments } from '../controllers/deployment.controller.js';
import { getEnvVariables, saveEnvVariable, deleteEnvVariable } from '../controllers/env.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// All project and deployment routes require JWT authentication
router.use(authenticateToken);

// Project management routes
router.get('/', getProjects);
router.post('/', createProject);
router.get('/analytics', getAnalytics);
router.get('/:id', getProjectById);

// Environment variables routes
router.get('/:projectId/env', getEnvVariables);
router.post('/:projectId/env', saveEnvVariable);
router.delete('/:projectId/env/:envId', deleteEnvVariable);

// Deployment orchestration routes
router.post('/deployments/trigger', triggerDeployment);
router.post('/deployments/:id/retry', retryDeployment);
router.get('/deployments/:id', getDeployment);
router.get('/:projectId/deployments', getProjectDeployments);

export default router;
