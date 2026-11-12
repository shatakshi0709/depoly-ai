import { Server } from 'socket.io';
import { SOCKET_EVENTS } from '@deplo/shared';

let ioInstance = null;

export function initSocketIO(httpServer, corsOrigin) {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: [corsOrigin, 'http://localhost:5173', 'http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  ioInstance.on('connection', (socket) => {
    console.log(`🔌 Client connected to Socket.IO: ${socket.id}`);

    // Join room for a specific deployment to receive live logs
    socket.on(SOCKET_EVENTS.JOIN_DEPLOYMENT, ({ deploymentId }) => {
      if (deploymentId) {
        socket.join(`deployment:${deploymentId}`);
        console.log(`📡 Socket ${socket.id} joined room: deployment:${deploymentId}`);
        socket.emit('joined_room', { room: `deployment:${deploymentId}` });
      }
    });

    // Leave deployment room
    socket.on(SOCKET_EVENTS.LEAVE_DEPLOYMENT, ({ deploymentId }) => {
      if (deploymentId) {
        socket.leave(`deployment:${deploymentId}`);
        console.log(`👋 Socket ${socket.id} left room: deployment:${deploymentId}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected from Socket.IO: ${socket.id}`);
    });
  });

  return ioInstance;
}

/**
 * Broadcast an event to all clients watching a deployment.
 */
export function emitDeploymentEvent(deploymentId, eventName, data) {
  if (!ioInstance) {
    console.warn('Socket.IO not initialized yet');
    return;
  }
  ioInstance.to(`deployment:${deploymentId}`).emit(eventName, data);
}

/**
 * Stream a log chunk in real time to subscribers.
 */
export function emitDeploymentLog(deploymentId, { stage, message, logLevel = 'INFO' }) {
  if (!ioInstance) return;
  const payload = {
    deploymentId,
    stage,
    message,
    logLevel,
    timestamp: new Date().toISOString(),
  };
  ioInstance.to(`deployment:${deploymentId}`).emit(SOCKET_EVENTS.DEPLOYMENT_LOG, payload);
}

export function getIO() {
  return ioInstance;
}

