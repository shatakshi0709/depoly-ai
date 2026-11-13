import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_EVENTS } from '@deplo/shared';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

function getSocketUrl() {
  // Desktop/packaged app can point to configured backend; web dev/prod uses same-origin/proxy.
  const configured = import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL;
  if (configured) return configured.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
  return undefined; // same-origin
}

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const authToken = token || localStorage.getItem('deplo_token');
    if (!authToken) {
      setSocket((prev) => {
        if (prev) prev.disconnect();
        return null;
      });
      setConnected(false);
      return;
    }

    const url = getSocketUrl();
    const newSocket = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      auth: { token: authToken },
    });

    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => setConnected(false));
    newSocket.on('connect_error', () => setConnected(false));

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [token]);

  const joinDeployment = useCallback((deploymentId) => {
    if (socket && deploymentId) {
      socket.emit(SOCKET_EVENTS.JOIN_DEPLOYMENT, { deploymentId });
    }
  }, [socket]);

  const leaveDeployment = useCallback((deploymentId) => {
    if (socket && deploymentId) {
      socket.emit(SOCKET_EVENTS.LEAVE_DEPLOYMENT, { deploymentId });
    }
  }, [socket]);

  return (
    <SocketContext.Provider value={{ socket, connected, joinDeployment, leaveDeployment }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}

