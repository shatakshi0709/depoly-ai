import { Router } from 'express';
import { getRepositories, analyze, getMetadata } from '../controllers/github.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Protect all GitHub routes
router.use(authenticateToken);

router.get('/repos', getRepositories);
router.post('/analyze', analyze);
router.get('/metadata', getMetadata);

export default router;

