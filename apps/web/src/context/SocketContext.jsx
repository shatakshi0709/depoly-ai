import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_EVENTS } from '@deplo/shared';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Connect to the backend Socket.IO gateway
    const newSocket = io('http://localhost:5001', {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    newSocket.on('connect', () => {
      console.log('⚡ Connected to deplo.ai real-time socket:', newSocket.id);
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('🔌 Disconnected from deplo.ai real-time socket');
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

