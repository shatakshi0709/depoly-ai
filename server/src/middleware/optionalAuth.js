import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function optionalAuthenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null;

  if (token) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      req.user = decoded;
    } catch {
      req.user = undefined;
    }
  }

  next();
}
