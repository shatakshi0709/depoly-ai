/**
 * @file auth.js
 * @description JWT verification middleware for securing REST endpoints.
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.split(' ')[1] 
    : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied: No authentication token provided.',
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded; // { userId, email, ... }
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Access denied: Invalid or expired token.',
    });
  }
}

