import { Router } from 'express';
import {
  cancelDeployment,
  downloadDeploymentLogs,
  getDeployment,
  getDeploymentHealth,
  getDeploymentLogs,
  getDeploymentStats,
  getDeploymentUrls,
  getProjectDeployments,
  handleRenderWebhook,
  handleVercelWebhook,
  retryDeployment,
  rollbackDeployment,
  streamDeploymentLogs,
  triggerDeployment,
} from '../controllers/deployment.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Provider webhooks (public callbacks; verified via payload signature where applicable)
router.post('/webhook/render', handleRenderWebhook);
router.post('/webhook/vercel', handleVercelWebhook);

// Protected deployment engine routes
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

// GET /api/deploy/stats — Aggregate telemetry and deployment statistics
router.get('/stats', getDeploymentStats);

// GET /api/deploy/:id — Get full deployment record (status, steps, logs)
router.get('/:id', getDeployment);

// GET /api/deploy/:id/logs — Paginated deployment logs (polling)
router.get('/:id/logs', getDeploymentLogs);

// GET /api/deploy/:id/logs/download — Download raw plain text log file
router.get('/:id/logs/download', downloadDeploymentLogs);

// GET /api/deploy/:id/stream — Server-Sent Events (SSE) live log stream
router.get('/:id/stream', streamDeploymentLogs);

// GET /api/deploy/:id/health — HTTP health check for deployed services
router.get('/:id/health', getDeploymentHealth);

// GET /api/deploy/:id/urls — Retrieve frontend and backend public URLs
router.get('/:id/urls', getDeploymentUrls);

// POST /api/deploy/:id/retry — Retry a failed deployment
router.post('/:id/retry', deployLimiter, retryDeployment);

// POST /api/deploy/:id/cancel — Cancel an active deployment
router.post('/:id/cancel', cancelDeployment);

// POST /api/deploy/:id/rollback — Rollback to previous successful deployment
router.post('/:id/rollback', deployLimiter, rollbackDeployment);

export default router;
