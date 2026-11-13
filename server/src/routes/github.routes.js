import { Router } from 'express';
import { getRepositories, analyze } from '../controllers/github.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Protect all GitHub routes
router.use(authenticateToken);

router.get('/repos', getRepositories);
router.post('/analyze', analyze);

export default router;

