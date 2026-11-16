import { Router } from 'express';
import { getRepositories, analyze, generateConfig } from '../controllers/github.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Protect all GitHub routes
router.use(authenticateToken);

const githubLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'github',
  message: 'Too many GitHub requests. Please wait before retrying.',
});

// GET /api/github/repos — List user repositories (shared API contract)
router.get('/repos', githubLimiter, getRepositories);

// POST /api/github/analyze — Full repository analysis (versioned path)
router.post('/analyze', githubLimiter, analyze);

// POST /api/github/connect — Alias: returns connection status (OAuth is initiated via auth routes)
// The actual OAuth flow is: GET /api/v1/auth/github/connect/start → GitHub → POST /api/v1/auth/github
// This endpoint tells the caller whether GitHub is already connected for the current user.
router.post('/connect', githubLimiter, async (req, res, next) => {
  try {
    const { default: prisma } = await import('../config/db.js');
    const oauth = await prisma.oAuthAccount.findFirst({
      where: { userId: req.user.userId, provider: 'github' },
      select: { id: true, createdAt: true },
    });
    if (oauth) {
      return res.json({
        success: true,
        connected: true,
        message: 'GitHub account is connected.',
        connectedSince: oauth.createdAt,
      });
    }
    return res.json({
      success: true,
      connected: false,
      message: 'GitHub account is not connected. Initiate OAuth via GET /api/v1/auth/github/connect/start.',
      oauthStartUrl: '/api/v1/auth/github/connect/start',
    });
  } catch (error) {
    next(error);
  }
});

export default router;

