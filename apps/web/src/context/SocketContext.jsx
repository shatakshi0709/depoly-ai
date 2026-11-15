import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_EVENTS } from '@deplo/shared';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

function getSocketUrl() {
  // Desktop/packaged app: main process resolves the backend URL at runtime.
  const desktopBase =
    typeof window !== 'undefined' && window.electronAPI && window.electronAPI.apiBaseUrl;
  if (desktopBase) {
    return String(desktopBase).replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
  }

  // Web dev/prod uses same-origin/proxy, or a configured VITE_* URL.
  const configured = import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL;
  if (configured) return configured.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
  return undefined; // same-origin
}

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  useEffect(() => {
    const authToken = token || localStorage.getItem('deplo_token');
    if (!authToken) {
      setSocket((prev) => {
        if (prev) prev.disconnect();
        return null;
      });
      setConnected(false);
      setConnectionError(null);
      return;
    }

    const url = getSocketUrl();
    const newSocket = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      auth: { token: authToken },
    });

    newSocket.on('connect', () => {
      setConnected(true);
      setConnectionError(null);
    });
    newSocket.on('disconnect', () => setConnected(false));
    newSocket.on('connect_error', (err) => {
      setConnected(false);
      // Surface the reason so the UI can fall back to polling instead of
      // silently appearing stuck (e.g. a rejected handshake origin).
      setConnectionError(err?.message || 'Live update connection failed.');
    });

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
    <SocketContext.Provider value={{ socket, connected, connectionError, joinDeployment, leaveDeployment }}>
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

