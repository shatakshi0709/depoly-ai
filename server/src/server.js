import express from 'express';
import http from 'http';
import cors from 'cors';
import morgan from 'morgan';

import { env } from './config/env.js';
import { testDbConnection } from './config/db.js';
import { initSocketIO } from './sockets/socketManager.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Route imports
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
initSocketIO(server, env.CLIENT_URL);

// Middleware
app.use(cors({
  origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

