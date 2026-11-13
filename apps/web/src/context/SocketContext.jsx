import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_EVENTS } from '@deplo/shared';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('deplo_token');
    // Same-origin connection works with Vite dev proxy and production; auth sent for room authorization.
    const newSocket = io({
      transports: ['websocket', 'polling'],
      autoConnect: true,
      auth: token ? { token } : {},
    });

    newSocket.on('connect', () => {
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const joinDeployment = (deploymentId) => {
    if (socket && deploymentId) {
      socket.emit(SOCKET_EVENTS.JOIN_DEPLOYMENT, { deploymentId });
    }
  };

  const leaveDeployment = (deploymentId) => {
    if (socket && deploymentId) {
      socket.emit(SOCKET_EVENTS.LEAVE_DEPLOYMENT, { deploymentId });
    }
  };

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

