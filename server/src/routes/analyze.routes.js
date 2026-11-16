/**
 * @file analyze.routes.js
 * @description Shared API contract routes for repository analysis and configuration generation.
 *
 * Shared API contract (deplo.ai team plan):
 *   POST /api/analyze          — Analyse repository (Satakshi's module)
 *   POST /api/config/generate  — Generate deployment config (Satakshi's module)
 *
 * These routes proxy into the existing GitHub/analyzer controller so both the versioned
 * (/api/v1/github/analyze) and the unversioned (/api/analyze) paths work.
 */

import { Router } from 'express';
import { analyze, generateConfig } from '../controllers/github.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'analyze',
  message: 'Too many analysis requests. Please wait before retrying.',
});

// POST /api/analyze — Analyse a GitHub repository and detect framework/structure
router.post('/analyze', authenticateToken, analyzeLimiter, analyze);

// POST /api/config/generate — Generate a deployment configuration from analysis output
router.post('/config/generate', authenticateToken, analyzeLimiter, generateConfig);

export default router;
