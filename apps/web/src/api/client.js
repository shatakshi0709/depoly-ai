import axios from 'axios';

function resolveBaseURL() {
  // Packaged Electron app: the main process resolves a runtime-configurable
  // backend URL and exposes it via the preload bridge. This takes priority so
  // the desktop build is not stuck with the relative `/api/v1` fallback
  // (which resolves to file:///api/v1 under file:// and cannot reach a server).
  const desktopBase = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.apiBaseUrl;
  if (desktopBase) {
    const base = String(desktopBase).replace(/\/$/, '');
    return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
  }

  const configured = import.meta.env.VITE_API_URL;
  if (configured) {
    const base = configured.replace(/\/$/, '');
    return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
  }
  return '/api/v1';
}

export const api = axios.create({
  baseURL: resolveBaseURL(),
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Attach Authorization Bearer token to every outgoing request
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('deplo_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Centralized error interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token if expired or invalid
      localStorage.removeItem('deplo_token');
      localStorage.removeItem('deplo_user');
      if (window.location.pathname !== '/login' && window.location.pathname !== '/register' && !window.location.pathname.startsWith('/auth/callback')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

