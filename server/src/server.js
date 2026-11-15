import express from 'express';
import http from 'http';
import cors from 'cors';
import morgan from 'morgan';

import { env, isAllowedOrigin } from './config/env.js';
import { testDbConnection } from './config/db.js';
import { initSocketIO } from './sockets/socketManager.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Polyfill BigInt JSON serialization for PostgreSQL counts and aggregates
BigInt.prototype.toJSON = function () {
  return Number(this);
};

// Route imports
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import projectRoutes from './routes/project.routes.js';
import githubRoutes from './routes/github.routes.js';
import notificationRoutes from './routes/notification.routes.js';

const app = express();
const server = http.createServer(app);

// If behind a proxy/load balancer in production, trust first proxy for correct IP/rate limiting.
if (env.isProduction) {
  app.set('trust proxy', 1);
}

// Initialize Socket.IO with trusted origins
initSocketIO(server, env.CORS_ORIGINS);

// Middleware
const corsOptions = {
  origin(origin, callback) {
    // Allow non-browser clients (no Origin), the packaged desktop app, and trusted browser origins.
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Basic security headers (safe defaults; no external dependency required)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (env.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// Root welcome route
app.get('/', (req, res) => {
  res.json({
    name: 'deplo.ai API Gateway',
    version: '1.0.0',
    description: 'Cloud Orchestration & Automated Deployment Engine',
    docs: '/api/v1/health',
  });
});

// API Routes
app.use('/api/v1', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/github', githubRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = env.PORT;

server.listen(PORT, async () => {
  console.log(`\n==================================================`);
  console.log(`🚀 deplo.ai Backend Server is running on port ${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/api/v1/health`);
  console.log(`🔌 Socket.IO Gateway active`);
  console.log(`==================================================\n`);

  // Non-blocking test for database connection on startup
  await testDbConnection();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

