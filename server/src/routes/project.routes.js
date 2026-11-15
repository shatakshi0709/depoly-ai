import { Router } from 'express';
import { getProjects, getProjectById, createProject, getAnalytics } from '../controllers/project.controller.js';
import { triggerDeployment, getDeployment, retryDeployment, getProjectDeployments } from '../controllers/deployment.controller.js';
import { getEnvVariables, saveEnvVariable, deleteEnvVariable } from '../controllers/env.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// All project and deployment routes require JWT authentication
router.use(authenticateToken);

const sensitiveLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'projects', message: 'Too many requests. Please slow down.' });
const deployLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: 'deploy', message: 'Too many deployment requests. Please wait before retrying.' });

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
router.post('/deployments/trigger', deployLimiter, triggerDeployment);
router.post('/deployments/:id/retry', deployLimiter, retryDeployment);
router.get('/deployments/:id', getDeployment);
router.get('/:projectId/deployments', getProjectDeployments);

export default router;
