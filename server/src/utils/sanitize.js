/**
 * @file sanitize.js
 * @description Sanitize provider/orchestration log content, inputs, branch names, and slugs.
 * Strips control chars, limits length, and redacts sensitive credentials.
 */

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g, // GitHub tokens
  /sk_[A-Za-z0-9]{16,}/g,
  /rnd_[A-Za-z0-9]{20,}/g, // Render API tokens
  /vcp_[A-Za-z0-9]{20,}/g, // Vercel tokens
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /(api[_-]?key|token|secret|password|authorization|cookie)\s*[:=]\s*([^\s"',;]+)/gi,
];

export function sanitizeLogMessage(input, maxLen = 8000) {
  let s = String(input ?? '');
  // remove ANSI escape sequences and most control chars except \n\t
  s = s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  for (const p of SECRET_PATTERNS) {
    s = s.replace(p, (m, k) => (k ? `${k}=[REDACTED]` : '[REDACTED]'));
  }
  if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
  return s;
}

export function sanitizeText(input, maxLen = 2000) {
  let s = String(input ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/**
 * Generate a safe URL/DNS-compliant slug for cloud service naming.
 * Lowercase alphanumeric and hyphens only, no leading/trailing hyphens.
 */
export function generateProjectSlug(name, maxLen = 40) {
  if (!name || typeof name !== 'string') return 'deplo-app';
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
  return slug || 'deplo-app';
}

/**
 * Sanitize and validate Git branch names.
 * Strips whitespace, control characters, leading/trailing slashes, and invalid ref chars.
 */
export function sanitizeBranchName(branch, defaultBranch = 'main') {
  if (!branch || typeof branch !== 'string') return defaultBranch;
  let clean = branch
    .trim()
    .replace(/[\x00-\x20\x7F~^:?*\[\\]/g, '')
    .replace(/\/\.+/g, '/')
    .replace(/\.{2,}/g, '.')
    .replace(/^\/+|\/+$/g, '')
    .slice(0, 100);
  if (!clean || clean === '.' || clean === '/') return defaultBranch;
  return clean;
}

/**
 * Mask specific sensitive key-value pairs in a text string.
 */
export function maskSensitiveValues(text, keys = []) {
  if (!text || typeof text !== 'string') return text;
  let result = text;
  for (const key of keys) {
    if (!key || typeof key !== 'string') continue;
    const regex = new RegExp(`(${key}\\s*[:=]\\s*)([^\\s"',;]+)`, 'gi');
    result = result.replace(regex, '$1[REDACTED]');
  }
  return result;
}
