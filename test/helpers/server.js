'use strict';

/**
 * Test harness: boots the real HTTP application against a throwaway SQLite
 * database on an ephemeral port, and provides a small cookie-aware client so
 * tests exercise exactly the same code path as the browser.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApplication } = require('../../src/app');
const { createAuthService } = require('../../src/services/auth');
const { createAuditLogger } = require('../../src/services/audit');

const ADMIN = { username: 'admin', password: 'Test-Admin-Passw0rd!', email: 'admin@test.edu' };
const NEW_PASSWORD = 'Rotated-Test-Passw0rd!';

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const app = createApplication({ dbPath });
  const audit = createAuditLogger(app.db);
  const auth = createAuthService(app.db, { audit });
  const bootstrap = await auth.ensureInitialAdmin({
    username: ADMIN.username,
    password: ADMIN.password,
    email: ADMIN.email,
    fullName: 'Test Administrator'
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const base = `http://127.0.0.1:${port}`;

  async function close() {
    await new Promise(resolve => app.server.close(resolve));
    app.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /** Current administrator password (rotated when the harness changes it). */
  const credentials = { password: ADMIN.password, rotated: false };

  return { app, db: app.db, base, port, close, bootstrap, auth, credentials };
}

/** Minimal browser-like client: keeps cookies and sends the CSRF header. */
function createClient(base, credentials) {
  const cookies = new Map();
  const client = {
    csrf: null,
    user: null,
    cookies,
    credentials: credentials || { password: ADMIN.password },
    header(name) {
      return Array.from(cookies.entries()).map(([key, value]) => `${key}=${value}`);
    },
    async request(method, url, body, options = {}) {
      const headers = { ...(options.headers || {}) };
      const cookie = client.header();
      if (cookie.length) headers.cookie = cookie.join('; ');
      if (method !== 'GET' && method !== 'HEAD') {
        headers['x-csrf-token'] = options.csrf !== undefined ? options.csrf : client.csrf;
        if (options.csrf === null) delete headers['x-csrf-token'];
      }
      headers.origin = options.origin === null ? '' : (options.origin || base);
      if (!headers.origin) delete headers.origin;
      let payload;
      if (body !== undefined && body !== null) {
        if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
          payload = body;
          headers['content-type'] = options.contentType || 'application/octet-stream';
        } else if (typeof body === 'string') {
          payload = body;
          headers['content-type'] = options.contentType || 'application/json';
        } else {
          payload = JSON.stringify(body);
          headers['content-type'] = 'application/json';
        }
      }
      const response = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
      const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
      for (const raw of setCookies) {
        const [pair] = raw.split(';');
        const index = pair.indexOf('=');
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!value || /max-age=0/i.test(raw)) cookies.delete(name);
        else cookies.set(name, value);
      }
      if (cookies.has('attendance_csrf')) client.csrf = decodeURIComponent(cookies.get('attendance_csrf'));
      const type = response.headers.get('content-type') || '';
      const isJson = type.includes('application/json');
      const data = isJson ? await response.json().catch(() => null) : null;
      if (!isJson) await response.arrayBuffer();
      return { status: response.status, body: data, headers: response.headers, contentType: type };
    },
    get: (url, options) => client.request('GET', url, null, options),
    post: (url, body, options) => client.request('POST', url, body, options),
    put: (url, body, options) => client.request('PUT', url, body, options),
    del: (url, options) => client.request('DELETE', url, null, options),
    async login(identifier = ADMIN.username, password = ADMIN.password) {
      const response = await client.post('/api/auth/login', { identifier, password });
      if (response.status === 200) client.user = response.body.user;
      return response;
    },
    /** Full sign-in including the mandatory first password change. */
    async signInAsSuperAdmin({ rotate = true } = {}) {
      let response = await client.login(ADMIN.username, client.credentials.password);
      if (response.status === 200 && response.body.user.mustChangePassword && rotate) {
        await client.post('/api/auth/change-password', { currentPassword: client.credentials.password, newPassword: NEW_PASSWORD });
        client.credentials.password = NEW_PASSWORD;
        response = await client.login(ADMIN.username, NEW_PASSWORD);
      }
      return response;
    }
  };
  return client;
}

module.exports = { startServer, createClient, ADMIN, NEW_PASSWORD };
