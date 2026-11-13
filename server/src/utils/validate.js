const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function isValidEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

export function isSafeEnvKey(v) {
  return typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(v.trim());
}

export function isValidServiceTarget(v) {
  return ['SHARED', 'BACKEND', 'FRONTEND'].includes(v);
}
