/**
 * @file errorHandler.js
 * @description Centralized Express error-handling middleware.
 */

import { env } from '../config/env.js';

export function errorHandler(err, req, res, next) {
  // CORS middleware passes a plain Error for disallowed origins.
  let statusCode = err.statusCode || res.statusCode;
  let message = err.message || 'Internal Server Error';

  if (message === 'Origin not allowed by CORS' || message === 'Origin not allowed by Socket.IO CORS') {
    statusCode = 403;
    message = 'Request origin is not allowed.';
  }

  if (!statusCode || statusCode === 200) statusCode = 500;

  const isServerError = statusCode >= 500;
  const safeMessage = env.isProduction && isServerError ? 'Internal Server Error' : message;

  // Avoid logging request bodies or sensitive payloads.
  console.error(`[Error] ${req.method} ${req.originalUrl} - ${statusCode}`);

  res.status(statusCode).json({
    success: false,
    message: safeMessage,
  });
}

export function notFoundHandler(req, res, next) {
  const error = new Error('Resource not found.');
  error.statusCode = 404;
  next(error);
}

