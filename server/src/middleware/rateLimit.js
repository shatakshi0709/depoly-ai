/**
 * Lightweight in-memory rate limiter (no external deps). Suitable for dev/small deployments.
 * NOTE: Per-process only; use a shared store for multi-instance production.
 */
const buckets = new Map();

function now() { return Date.now(); }

export function rateLimit({ windowMs = 60_000, max = 30, keyPrefix = 'rl', message = 'Too many requests, please try again later.' } = {}) {
  return (req, res, next) => {
    try {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const key = `${keyPrefix}:${ip}`;
      const t = now();
      let b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        b = { count: 0, resetAt: t + windowMs };
      }
      b.count += 1;
      buckets.set(key, b);

      // occasional cleanup
      if (buckets.size > 5000) {
        for (const [k, v] of buckets.entries()) {
          if (v.resetAt <= t) buckets.delete(k);
        }
      }

      if (b.count > max) {
        res.setHeader('Retry-After', Math.ceil((b.resetAt - t) / 1000));
        return res.status(429).json({ success: false, message });
      }
      return next();
    } catch {
      return next();
    }
  };
}
