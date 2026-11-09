'use strict';

const crypto = require('node:crypto');

/**
 * Session tokens and CSRF tokens are generated with the CSPRNG. Only the SHA-256
 * hash of a session token is stored, so a database leak cannot be replayed.
 */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function timingSafeEqualString(a, b) {
  const left = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const right = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(left, right);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

/**
 * Fixed-window rate limiter stored in memory. Suitable for a single-node
 * deployment; for a cluster, back it with the database or a shared store.
 */
class RateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), Math.min(windowMs, 60_000));
    this.timer.unref?.();
  }

  key(key) {
    const now = Date.now();
    const bucket = this.hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + this.windowMs };
      this.hits.set(key, fresh);
      return { ...fresh, allowed: true };
    }
    bucket.count += 1;
    return { ...bucket, allowed: bucket.count <= this.max };
  }

  peek(key) {
    const bucket = this.hits.get(key);
    if (!bucket || bucket.resetAt <= Date.now()) return { count: 0, resetAt: Date.now() + this.windowMs };
    return bucket;
  }

  reset(key) {
    this.hits.delete(key);
  }

  sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.hits) {
      if (bucket.resetAt <= now) this.hits.delete(key);
    }
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection: the browser receives a readable `csrf` cookie
 * and must echo it in the X-CSRF-Token header. Combined with SameSite=Lax
 * cookies and an Origin/Host check this blocks cross-site state changes.
 */
function verifyCsrf(req, session) {
  if (SAFE_METHODS.has(req.method)) return true;
  const header = req.headers['x-csrf-token'];
  if (!header || !session) return false;
  return timingSafeEqualString(header, session.csrf_token);
}

module.exports = { randomToken, hashToken, sha256, timingSafeEqualString, RateLimiter, verifyCsrf, SAFE_METHODS };
