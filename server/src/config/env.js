import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from server/.env first, then repo-root .env without overriding.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const INSECURE_JWT_SECRET = 'deplo-ai-default-jwt-secret-key-32-chars-long';
const INSECURE_ENCRYPTION_KEY = 'deplo-ai-encryption-key-32-bytes!';
const INSECURE_DB_URL = 'postgresql://postgres:postgres@localhost:5432/deplo_ai?schema=public';

function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseCorsOrigins(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const jwtSecret = process.env.JWT_SECRET || INSECURE_JWT_SECRET;
const encryptionKey = process.env.ENCRYPTION_KEY || INSECURE_ENCRYPTION_KEY;
const databaseUrl = process.env.DATABASE_URL || INSECURE_DB_URL;

if (isProduction) {
  requireEnv('DATABASE_URL');
  requireEnv('JWT_SECRET');
  requireEnv('ENCRYPTION_KEY');
  requireEnv('CLIENT_URL');
  if (jwtSecret === INSECURE_JWT_SECRET) {
    throw new Error('Insecure default JWT_SECRET is not allowed in production.');
  }
  if (encryptionKey === INSECURE_ENCRYPTION_KEY) {
    throw new Error('Insecure default ENCRYPTION_KEY is not allowed in production.');
  }
} else {
  if (jwtSecret === INSECURE_JWT_SECRET) {
    console.warn('[config] Using default JWT_SECRET (development only). Set JWT_SECRET in server/.env for security.');
  }
  if (encryptionKey === INSECURE_ENCRYPTION_KEY) {
    console.warn('[config] Using default ENCRYPTION_KEY (development only). Set ENCRYPTION_KEY in server/.env for security.');
  }
}

const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const extraCorsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);

export const env = {
  NODE_ENV,
  isProduction,
  PORT: parseInt(process.env.PORT, 10) || 5001,
  CLIENT_URL: clientUrl,
  CORS_ORIGINS: Array.from(new Set([clientUrl, ...extraCorsOrigins])),
  DATABASE_URL: databaseUrl,
  JWT_SECRET: jwtSecret,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  ENCRYPTION_KEY: encryptionKey,
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || '',
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || '',
  GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:5173/auth/callback',
  RENDER_API_KEY: process.env.RENDER_API_KEY || '',
  VERCEL_API_KEY: process.env.VERCEL_API_KEY || '',
  VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID || '',
  // Simulation is allowed only when explicitly enabled in non-production mode.
  ALLOW_SIMULATED_DEPLOYMENTS:
    !isProduction && String(process.env.ALLOW_SIMULATED_DEPLOYMENTS || '').toLowerCase() === 'true',
};

