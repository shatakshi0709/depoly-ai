import crypto from 'crypto';
import { env } from '../config/env.js';

const TTL_MS = 10 * 60 * 1000; // 10 minutes

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function fromB64url(s) {
  return Buffer.from(String(s), 'base64url').toString('utf8');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(payloadB64).digest('base64url');
}

/**
 * Create a signed, expiring OAuth state value (stateless).
 */
export function createOAuthState(meta = {}) {
  const payload = {
    n: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + TTL_MS,
    m: meta && typeof meta === 'object' ? meta : {},
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyOAuthState(state) {
  if (typeof state !== 'string' || !state.includes('.')) return { ok: false, reason: 'invalid' };
  const [payloadB64, sig] = state.split('.', 2);
  if (!payloadB64 || !sig) return { ok: false, reason: 'invalid' };
  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature' };
  }
  try {
    const payload = JSON.parse(fromB64url(payloadB64));
    if (!payload?.exp || Date.now() > Number(payload.exp)) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
