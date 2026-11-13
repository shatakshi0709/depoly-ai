/**
 * Sanitize provider/orchestration log content before persistence/display.
 * Strips control chars, limits length, and redacts common secret patterns.
 */
const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g, // GitHub tokens
  /sk_[A-Za-z0-9]{16,}/g,
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
