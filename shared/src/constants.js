/**
 * @file constants.js
 * @description Centralized constants used across Server, Web, and Desktop applications.
 */

export const DEPLOYMENT_STATUS = {
  QUEUED: 'QUEUED',
  ANALYZING: 'ANALYZING',
  DEPLOYING_BACKEND: 'DEPLOYING_BACKEND',
  HEALTH_CHECKING: 'HEALTH_CHECKING',
  DEPLOYING_FRONTEND: 'DEPLOYING_FRONTEND',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

export const STEP_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
};

export const PROVIDER = {
  RENDER: 'RENDER',
  VERCEL: 'VERCEL',
  GITHUB: 'GITHUB',
};

export const SERVICE_TYPE = {
  BACKEND: 'BACKEND',
  FRONTEND: 'FRONTEND',
  DATABASE: 'DATABASE',
};

export const LOG_LEVEL = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
};

export const SOCKET_EVENTS = {
  // Client to Server
  JOIN_DEPLOYMENT: 'join_deployment',
  LEAVE_DEPLOYMENT: 'leave_deployment',

  // Server to Client
  DEPLOYMENT_STATUS_CHANGED: 'deployment_status_changed',
  DEPLOYMENT_LOG: 'deployment_log',
  DEPLOYMENT_STEP_UPDATE: 'deployment_step_update',
  DEPLOYMENT_COMPLETED: 'deployment_completed',
  DEPLOYMENT_ERROR: 'deployment_error',
};

export const FRAMEWORK_PRESETS = {
  REACT_VITE: 'REACT_VITE',
  NEXT_JS: 'NEXT_JS',
  EXPRESS_NODE: 'EXPRESS_NODE',
  NEST_JS: 'NEST_JS',
  FAST_API: 'FAST_API',
  DJANGO: 'DJANGO',
  STATIC_HTML: 'STATIC_HTML',
};
