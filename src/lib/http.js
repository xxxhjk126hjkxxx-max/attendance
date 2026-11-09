'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * Security headers applied to every response. A nonce-based CSP lets the SPA
 * run its own inline bootstrap script while blocking injected scripts.
 */
function securityHeaders({ nonce, isProduction, allowFraming = false } = {}) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce ?? ''}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    allowFraming ? 'frame-ancestors *' : "frame-ancestors 'none'"
  ].join('; ');

  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': allowFraming ? 'ALLOWALL' : 'DENY',
    'Referrer-Policy': 'same-origin',
    'X-XSS-Protection': '0',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(self)',
    ...(isProduction ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
  };
}

function applyHeaders(res, headers) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(text);
}

function sendBuffer(res, status, buffer, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': buffer.length,
    'cache-control': 'no-store',
    ...extraHeaders
  });
  res.end(buffer);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    const fail = error => {
      if (aborted) return;
      aborted = true;
      req.pause();
      reject(error);
    };
    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        // Stop buffering and let the error handler reply 413. The socket is not
        // destroyed so the client still receives a well-formed JSON error.
        const error = new Error('Request body is too large.');
        error.status = 413;
        fail(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', error => fail(error));
  });
}

async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  const text = raw.toString('utf8');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') {
      const error = new Error('Request body must be a JSON object.');
      error.status = 400;
      throw error;
    }
    return parsed;
  } catch (error) {
    if (error.status) throw error;
    const invalid = new Error('Request body must be valid JSON.');
    invalid.status = 400;
    throw invalid;
  }
}

/**
 * Serves a file from one of the allowed directories, refusing any path that
 * escapes the directory after normalisation (path traversal protection).
 */
function serveStatic(res, req, roots, pathname, { immutable = false } = {}) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('\0')) return false;
  for (const root of roots) {
    const target = path.resolve(root, '.' + path.posix.normalize(decoded));
    if (target !== root && !target.startsWith(root + path.sep)) continue;
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const ext = path.extname(target).toLowerCase();
    const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag });
      res.end();
      return true;
    }
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      etag,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'last-modified': stat.mtime.toUTCString()
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    fs.createReadStream(target).pipe(res);
    return true;
  }
  return false;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  return parts.join('; ');
}

function clientIp(req) {
  return req.socket?.remoteAddress || 'unknown';
}

module.exports = {
  MIME, securityHeaders, applyHeaders, sendJson, sendText, sendBuffer,
  readBody, readJson, serveStatic, parseCookies, serializeCookie, clientIp
};
