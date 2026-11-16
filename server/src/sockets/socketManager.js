import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { SOCKET_EVENTS } from '@deplo/shared';
import { env } from '../config/env.js';
import prisma from '../config/db.js';

let ioInstance = null;

function extractToken(socket) {
  const authToken = socket.handshake?.auth?.token;
  if (authToken) return authToken;
  const header = socket.handshake?.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return null;
}

export function initSocketIO(httpServer, corsOrigins = []) {
  const allowedOrigins = Array.isArray(corsOrigins) ? corsOrigins : [corsOrigins].filter(Boolean);

  ioInstance = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin not allowed by Socket.IO CORS'));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Authenticate socket connections before allowing room joins.
  ioInstance.use((socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) {
        return next(new Error('Unauthorized'));
      }
      const decoded = jwt.verify(token, env.JWT_SECRET);
      socket.user = decoded; // { userId, email, ... }
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  });

  ioInstance.on('connection', (socket) => {
    // User-scoped room for notifications
    if (socket.user?.userId) {
      socket.join(`user:${socket.user.userId}`);
    }

    // Join room for a specific deployment to receive live logs (owner only).
    socket.on(SOCKET_EVENTS.JOIN_DEPLOYMENT, async ({ deploymentId } = {}) => {
      try {
        if (!deploymentId || typeof deploymentId !== 'string') {
          socket.emit('deployment_room_error', { message: 'Invalid deployment identifier.' });
          return;
        }

        const deployment = await prisma.deployment.findUnique({
          where: { id: deploymentId },
          select: { id: true, project: { select: { userId: true } } },
        });

        if (!deployment || deployment.project.userId !== socket.user?.userId) {
          socket.emit('deployment_room_error', { message: 'Access denied for this deployment.' });
          return;
        }

        socket.join(`deployment:${deploymentId}`);
        socket.emit('joined_room', { room: `deployment:${deploymentId}` });
      } catch {
        socket.emit('deployment_room_error', { message: 'Unable to join deployment room.' });
      }
    });

    // Leave deployment room
    socket.on(SOCKET_EVENTS.LEAVE_DEPLOYMENT, ({ deploymentId } = {}) => {
      if (deploymentId && typeof deploymentId === 'string') {
        socket.leave(`deployment:${deploymentId}`);
      }
    });
  });

  return ioInstance;
}

/**
 * Broadcast an event to all clients watching a deployment.
 */
export function emitDeploymentEvent(deploymentId, eventName, data) {
  if (!ioInstance) return;
  ioInstance.to(`deployment:${deploymentId}`).emit(eventName, data);
}

/**
 * Stream a log chunk in real time to subscribers.
 */
export function emitDeploymentLog(deploymentId, { id, stage, message, logLevel = 'INFO', source = 'ORCHESTRATOR', createdAt }) {
  if (!ioInstance) return;
  const payload = {
    deploymentId,
    id,
    stage,
    message,
    logLevel,
    source,
    createdAt: createdAt || new Date().toISOString(),
    timestamp: createdAt || new Date().toISOString(),
  };
  ioInstance.to(`deployment:${deploymentId}`).emit(SOCKET_EVENTS.DEPLOYMENT_LOG, payload);
}

/**
 * Emit a user-scoped notification event.
 */
export function emitUserNotification(userId, notification) {
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${userId}`).emit(SOCKET_EVENTS.NOTIFICATION_CREATED, notification);
}

export function getIO() {
  return ioInstance;
}

