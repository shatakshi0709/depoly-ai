import { Router } from 'express';
import { register, login, getMe, githubOAuthStart, githubOAuthCallback, githubOAuthConnectStart } from '../controllers/auth.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import { optionalAuthenticateToken } from '../middleware/optionalAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'auth', message: 'Too many authentication attempts. Please try again later.' });
const oauthLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keyPrefix: 'oauth', message: 'Too many OAuth requests. Please try again later.' });

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/me', authenticateToken, getMe);
router.get('/github/start', oauthLimiter, githubOAuthStart);
router.get('/github/connect/start', oauthLimiter, authenticateToken, githubOAuthConnectStart);
router.post('/github', oauthLimiter, optionalAuthenticateToken, githubOAuthCallback);

export default router;

