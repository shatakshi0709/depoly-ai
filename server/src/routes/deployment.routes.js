import { Router } from 'express';
import {
  getDeployment,
  getDeploymentHealth,
  getDeploymentLogs,
  getDeploymentUrls,
  getProjectDeployments,
  retryDeployment,
  streamDeploymentLogs,
  triggerDeployment,
} from '../controllers/deployment.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();
router.use(authenticateToken);

const deployLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyPrefix: 'deployment-engine',
  message: 'Too many deployment requests. Please wait before retrying.',
});

// POST /api/deploy — Start a new deployment
router.post('/', deployLimiter, triggerDeployment);

// GET /api/deploy — List deployments for a project (pass ?projectId=)
router.get('/', getProjectDeployments);

// GET /api/deploy/:id — Get full deployment record (status, steps, logs)
router.get('/:id', getDeployment);

// GET /api/deploy/:id/logs — Paginated deployment logs (polling)
router.get('/:id/logs', getDeploymentLogs);

// GET /api/deploy/:id/stream — Server-Sent Events (SSE) live log stream
router.get('/:id/stream', streamDeploymentLogs);

// GET /api/deploy/:id/health — HTTP health check for deployed services
router.get('/:id/health', getDeploymentHealth);

// GET /api/deploy/:id/urls — Retrieve frontend and backend public URLs
router.get('/:id/urls', getDeploymentUrls);

// POST /api/deploy/:id/retry — Retry a failed deployment
router.post('/:id/retry', deployLimiter, retryDeployment);

export default router;
