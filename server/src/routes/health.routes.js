import { Router } from 'express';
import prisma from '../config/db.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ONLINE',
    service: 'deplo.ai Orchestration API',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

router.get('/health/db', async (req, res) => {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;

    res.json({
      success: true,
      status: 'CONNECTED',
      database: 'PostgreSQL',
      latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'DISCONNECTED',
      ...(env.isProduction ? {} : { error: 'Database connectivity check failed.' }),
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

