'use strict';

const http = require('node:http');
const path = require('node:path');
const { config } = require('./config');
const { openDatabase, migrate } = require('./db');
const { createAuditLogger } = require('./services/audit');
const { createAuthService } = require('./services/auth');
const { createStudentService } = require('./services/students');
const { createCourseService, createLectureService } = require('./services/courses');
const { createAttendanceService } = require('./services/attendance');
const { createDashboardService } = require('./services/dashboard');
const { createReportService } = require('./services/reports');
const { createQrService } = require('./services/qr');
const { createExportService } = require('./services/exports');
const { can } = require('./services/permissions');
const { AppError, forbidden, unprocessable, notFound } = require('./lib/errors');
const {
  securityHeaders, applyHeaders, sendJson, sendBuffer, readJson, readBody, serveStatic,
  parseCookies, serializeCookie, clientIp
} = require('./lib/http');
const { randomToken, RateLimiter, verifyCsrf, SAFE_METHODS } = require('./lib/security');
const { pagination, str, int, dateOnly, bool } = require('./lib/validate');

const SESSION_COOKIE = 'attendance_session';
const CSRF_COOKIE = 'attendance_csrf';

function createApplication({ dbPath = config.dbPath } = {}) {
  const db = openDatabase(dbPath);
  const migration = migrate(db);

  const audit = createAuditLogger(db);
  const auth = createAuthService(db, { audit });
  const students = createStudentService(db, { audit });
  const courses = createCourseService(db, { audit });
  const lectures = createLectureService(db, { audit });
  const attendance = createAttendanceService(db, { audit });
  const dashboard = createDashboardService(db);
  const reports = createReportService(db);
  const qr = createQrService(db, { students, university: config.university });
  const exports = createExportService({ university: config.university });

  const qrTokenLimiter = new RateLimiter({ windowMs: 60_000, max: 120 });
  const apiLimiter = new RateLimiter({ windowMs: config.limits.apiWindowMs, max: config.limits.apiMaxRequests });

  // ---------------------------------------------------------------- helpers

  function setSessionCookies(res, { token, csrfToken, expiresAt }) {
    const maxAge = Math.max(0, (new Date(expiresAt).getTime() - Date.now()) / 1000);
    res.setHeader('Set-Cookie', [
      serializeCookie(SESSION_COOKIE, token, { maxAge, secure: config.cookieSecure, httpOnly: true, sameSite: 'Lax' }),
      serializeCookie(CSRF_COOKIE, csrfToken, { maxAge, secure: config.cookieSecure, httpOnly: false, sameSite: 'Lax' })
    ]);
  }

  function clearSessionCookies(res) {
    res.setHeader('Set-Cookie', [
      serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.cookieSecure, httpOnly: true, sameSite: 'Lax' }),
      serializeCookie(CSRF_COOKIE, '', { maxAge: 0, secure: config.cookieSecure, httpOnly: false, sameSite: 'Lax' })
    ]);
  }

  function sessionFromRequest(req) {
    const cookies = parseCookies(req);
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const token = bearer || cookies[SESSION_COOKIE];
    if (!token) return { session: null, viaCookie: false, token: null };
    const session = auth.getSession(token);
    return { session, viaCookie: !bearer, token };
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const url = new URL(origin);
      const host = req.headers.host;
      return url.host === host;
    } catch {
      return false;
    }
  }

  async function requireUser(req, res, { permission } = {}) {
    const { session, viaCookie } = sessionFromRequest(req);
    if (!session) {
      sendJson(res, 401, { error: 'Authentication required. Please sign in again.', code: 'UNAUTHENTICATED' });
      return null;
    }
    if (viaCookie) {
      if (!sameOrigin(req)) {
        sendJson(res, 403, { error: 'Cross-origin request rejected.' });
        return null;
      }
      if (!verifyCsrf(req, session)) {
        sendJson(res, 403, { error: 'Your session security token is missing or expired. Reload the page and try again.', code: 'CSRF' });
        return null;
      }
    }
    const user = {
      id: session.userId,
      username: session.username,
      email: session.email,
      fullName: session.fullName,
      role: session.role,
      mustChangePassword: session.mustChangePassword
    };
    if (permission && !can(user, permission)) {
      sendJson(res, 403, { error: 'You do not have permission to perform this action.', code: 'FORBIDDEN' });
      audit.record({ actor: user, action: 'auth.permission_denied', entityType: 'api', entityId: req.url, details: { permission }, ip: clientIp(req) });
      return null;
    }
    return user;
  }

  function actorName(user) {
    return user?.username || 'system';
  }

  // ---------------------------------------------------------------- routes

  const routes = [];
  const route = (method, pattern, handler, options = {}) => {
    routes.push({ method, pattern, handler, ...options });
  };

  function match(pattern, pathname) {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/:[A-Za-z]+/g, key => {
      keys.push(key.slice(1));
      return '([^/]+)';
    })}$`);
    const result = regex.exec(pathname);
    if (!result) return null;
    const params = {};
    keys.forEach((key, index) => { params[key] = decodeURIComponent(result[index + 1]); });
    return params;
  }

  // ---- system / auth

  route('GET', '/api/system/bootstrap', async ({ res }) => {
    const admins = db.prepare(`
      SELECT COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'super_admin'
    `).get().count;
    sendJson(res, 200, {
      configured: admins > 0,
      needsSetup: admins === 0,
      schemaVersion: db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get()?.version || null,
      university: config.university,
      environment: config.env,
      version: require('../package.json').version
    });
  });

  route('GET', '/api/system/health', async ({ res }) => {
    const ok = db.prepare('SELECT 1 AS ok').get().ok === 1;
    sendJson(res, ok ? 200 : 503, {
      status: ok ? 'ok' : 'degraded',
      database: ok,
      uptime: Math.round(process.uptime()),
      schemaVersion: db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get()?.version || null,
      timestamp: new Date().toISOString()
    });
  });

  route('POST', '/api/auth/login', async ({ req, res }) => {
    const ip = clientIp(req);
    if (!sameOrigin(req)) throw forbidden('Cross-origin sign-in rejected.');
    const limiterKey = `${ip}`;
    const hit = apiLimiter.key(`login:${limiterKey}`);
    if (!hit.allowed) {
      return sendJson(res, 429, { error: 'Too many requests. Please wait a moment.' }, { 'retry-after': '60' });
    }
    const body = await readJson(req, config.limits.jsonBodyBytes);
    const result = await auth.login({
      identifier: body.identifier || body.email || body.username,
      password: body.password,
      ip,
      userAgent: req.headers['user-agent']
    });
    setSessionCookies(res, result);
    sendJson(res, 200, {
      user: result.user,
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt,
      // Bearer tokens are also returned for API clients; the browser uses cookies.
      token: result.token
    });
  });

  route('POST', '/api/auth/logout', async ({ req, res }) => {
    const { session, viaCookie } = sessionFromRequest(req);
    if (session) {
      if (viaCookie && !verifyCsrf(req, session)) throw forbidden('Reload the page before signing out.');
      auth.logout(session.tokenHash, { id: session.userId, username: session.username }, clientIp(req));
    }
    clearSessionCookies(res);
    sendJson(res, 200, { ok: true });
  });

  route('GET', '/api/auth/session', async ({ req, res }) => {
    const { session } = sessionFromRequest(req);
    if (!session) return sendJson(res, 401, { error: 'Not signed in.', code: 'UNAUTHENTICATED' });
    const user = auth.getUserById(session.userId);
    sendJson(res, 200, { user, csrfToken: session.csrf_token, expiresAt: session.expiresAt });
  });

  route('POST', '/api/auth/change-password', async ({ req, res }) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    await auth.changePassword(user.id, { currentPassword: body.currentPassword, newPassword: body.newPassword }, { ip: clientIp(req), actor: user });
    clearSessionCookies(res);
    sendJson(res, 200, { ok: true, message: 'Password changed. Please sign in again with your new password.' });
  });

  route('POST', '/api/auth/forgot-password', async ({ req, res }) => {
    const body = await readJson(req, config.limits.jsonBodyBytes);
    const reset = auth.createPasswordReset(body.identifier || body.email, { ip: clientIp(req) });
    if (reset) {
      const link = `/reset-password.html?token=${reset.token}`;
      // No mail service is configured: the link is written to the server log for
      // the administrator to deliver, and never returned over HTTP.
      console.log(`[password-reset] ${reset.user.username}: ${link}`);
    }
    sendJson(res, 200, { ok: true, message: 'If that account exists, a reset link has been issued.' });
  });

  route('POST', '/api/auth/reset-password', async ({ req, res }) => {
    const body = await readJson(req, config.limits.jsonBodyBytes);
    await auth.completePasswordReset({ token: body.token, newPassword: body.newPassword }, { ip: clientIp(req) });
    sendJson(res, 200, { ok: true });
  });

  // ---- dashboard

  route('GET', '/api/dashboard', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'dashboard.view' });
    if (!user) return;
    sendJson(res, 200, dashboard.overview());
  });

  // ---- students

  route('GET', '/api/students/options', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'students.view' });
    if (!user) return;
    sendJson(res, 200, students.filterOptions());
  });

  route('GET', '/api/students/qr-cards', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'qr.view' });
    if (!user) return;
    sendJson(res, 200, students.qrCards({
      search: str(url.searchParams.get('search'), { max: 100 }),
      course: str(url.searchParams.get('course'), { max: 100 }),
      level: str(url.searchParams.get('level'), { max: 60 })
    }));
  });

  route('GET', '/api/students/qr-cards/pdf', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'qr.view' });
    if (!user) return;
    const ids = String(url.searchParams.get('ids') || '').split(',').map(value => value.trim()).filter(Boolean);
    const lang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    const buffer = await qr.cardPdf(ids.length ? ids : students.qrCards({}).items.map(item => item.id).slice(0, 100), { lang });
    sendBuffer(res, 200, buffer, 'application/pdf', { 'content-disposition': 'attachment; filename="student-qr-cards.pdf"' });
  });

  route('GET', '/api/students', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'students.view' });
    if (!user) return;
    const { page, pageSize } = pagination(url.searchParams, { defaultSize: 10 });
    sendJson(res, 200, students.list({
      page,
      pageSize,
      search: url.searchParams.get('search') || '',
      course: url.searchParams.get('course') || '',
      level: url.searchParams.get('level') || '',
      status: url.searchParams.get('status') || '',
      sort: url.searchParams.get('sort') || 'name',
      dir: url.searchParams.get('dir') || 'asc',
      courseId: int(url.searchParams.get('courseId'), { min: 1 })
    }));
  });

  route('POST', '/api/students', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'students.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    sendJson(res, 201, { item: students.create(body, user, { ip: clientIp(req) }) });
  });

  route('GET', '/api/students/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'students.view' });
    if (!user) return;
    sendJson(res, 200, { item: students.get(params.id) });
  });

  route('PUT', '/api/students/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'students.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    sendJson(res, 200, { item: students.update(params.id, body, user, { ip: clientIp(req) }) });
  });

  route('DELETE', '/api/students/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'students.manage' });
    if (!user) return;
    sendJson(res, 200, students.remove(params.id, user, { ip: clientIp(req) }));
  });

  route('GET', '/api/students/:id/attendance', async ({ req, res, params, url }) => {
    const user = await requireUser(req, res, { permission: 'attendance.view' });
    if (!user) return;
    const limit = int(url.searchParams.get('limit'), { min: 1, max: 500, fallback: 200 });
    sendJson(res, 200, students.attendanceHistory(params.id, { limit }));
  });

  route('GET', '/api/students/:id/qr', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'qr.view' });
    if (!user) return;
    sendJson(res, 200, students.qrCard(params.id));
  });

  route('GET', '/api/students/:id/qr.png', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'qr.view' });
    if (!user) return;
    const card = students.qrCard(params.id).item;
    if (!card.qr) throw notFound('This QR code has been revoked.');
    const buffer = await qr.qrPng(card.qr, { width: 600 });
    sendBuffer(res, 200, buffer, 'image/png', {
      'content-disposition': `inline; filename="qr-${encodeURIComponent(card.id)}.png"`
    });
  });

  route('GET', '/api/students/:id/qr.svg', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'qr.view' });
    if (!user) return;
    const card = students.qrCard(params.id).item;
    if (!card.qr) throw notFound('This QR code has been revoked.');
    sendBuffer(res, 200, Buffer.from(await qr.qrSvg(card.qr)), 'image/svg+xml');
  });

  route('GET', '/api/students/:id/qr/card.pdf', async ({ req, res, params, url }) => {
    const user = await requireUser(req, res, { permission: 'qr.view' });
    if (!user) return;
    const lang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    const buffer = await qr.cardPdf([params.id], { lang });
    sendBuffer(res, 200, buffer, 'application/pdf', {
      'content-disposition': `attachment; filename="qr-card-${encodeURIComponent(params.id)}.pdf"`
    });
  });

  route('POST', '/api/students/:id/qr/rotate', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'qr.manage' });
    if (!user) return;
    sendJson(res, 200, students.rotateQr(params.id, user, { ip: clientIp(req) }));
  });

  route('POST', '/api/students/:id/qr/revoke', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'qr.manage' });
    if (!user) return;
    sendJson(res, 200, students.revokeQr(params.id, user, { ip: clientIp(req) }));
  });

  // ---- QR utilities

  route('POST', '/api/qr/decode', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'qr.view' });
    if (!user) return;
    const hit = qrTokenLimiter.key(`decode:${user.id}`);
    if (!hit.allowed) throw new AppError(429, 'Too many scans. Please wait a moment.');
    const contentType = String(req.headers['content-type'] || '');
    let buffer;
    if (contentType.includes('application/json')) {
      const body = await readJson(req, config.limits.uploadBytes);
      const dataUrl = String(body.image || body.dataUrl || '');
      const match = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl);
      if (!match) throw unprocessable('Upload a base64-encoded image.', { image: 'Invalid image payload.' });
      buffer = Buffer.from(match[1], 'base64');
    } else if (contentType.startsWith('image/')) {
      buffer = await readBody(req, config.limits.uploadBytes);
    } else {
      throw unprocessable('Upload a PNG or JPEG image of the QR code.');
    }
    if (!buffer || buffer.length < 64) throw unprocessable('The uploaded image is empty or too small.');
    const decoded = qr.decodeImage(buffer);
    if (!decoded) throw unprocessable('No QR code could be read from that image. Try a clearer, straight-on photo.');
    let payload = null;
    try { payload = JSON.parse(decoded); } catch { payload = null; }
    if (!payload || payload.v !== 1 || typeof payload.token !== 'string') {
      throw unprocessable('The image does not contain a valid university attendance QR code.');
    }
    const student = db.prepare('SELECT student_id AS id, name, academic_level AS level FROM students WHERE qr_token = ? AND qr_revoked_at IS NULL').get(payload.token);
    if (!student) throw notFound('This QR code is not registered or has been revoked.');
    sendJson(res, 200, { qr: { v: 1, token: payload.token }, student });
  });

  // ---- courses

  route('GET', '/api/courses', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'courses.view' });
    if (!user) return;
    sendJson(res, 200, {
      items: courses.list({
        search: url.searchParams.get('search') || '',
        includeArchived: bool(url.searchParams.get('includeArchived')),
        instructorId: user.role === 'instructor' ? user.id : null
      })
    });
  });

  route('POST', '/api/courses', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'courses.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    sendJson(res, 201, { item: courses.create(body, user, { ip: clientIp(req) }) });
  });

  route('GET', '/api/courses/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'courses.view' });
    if (!user) return;
    sendJson(res, 200, courses.get(int(params.id, { min: 1 })));
  });

  route('PUT', '/api/courses/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'courses.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    sendJson(res, 200, { item: courses.update(int(params.id, { min: 1 }), body, user, { ip: clientIp(req) }) });
  });

  route('POST', '/api/courses/:id/archive', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'courses.manage' });
    if (!user) return;
    sendJson(res, 200, { item: courses.archive(int(params.id, { min: 1 }), true, user, { ip: clientIp(req) }) });
  });

  route('POST', '/api/courses/:id/restore', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'courses.manage' });
    if (!user) return;
    sendJson(res, 200, { item: courses.archive(int(params.id, { min: 1 }), false, user, { ip: clientIp(req) }) });
  });

  route('DELETE', '/api/courses/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'courses.manage' });
    if (!user) return;
    sendJson(res, 200, courses.remove(int(params.id, { min: 1 }), user, { ip: clientIp(req) }));
  });

  route('POST', '/api/courses/:id/enrollments', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'courses.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    sendJson(res, 200, courses.enroll(int(params.id, { min: 1 }), body.studentIds || body.studentId, user, { ip: clientIp(req) }));
  });

  route('DELETE', '/api/courses/:id/enrollments/:studentId', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'courses.manage' });
    if (!user) return;
    sendJson(res, 200, courses.unenroll(int(params.id, { min: 1 }), params.studentId, user, { ip: clientIp(req) }));
  });

  // ---- lectures

  route('GET', '/api/lectures', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'lectures.view' });
    if (!user) return;
    sendJson(res, 200, {
      items: lectures.list({
        courseId: int(url.searchParams.get('courseId'), { min: 1 }),
        date: dateOnly(url.searchParams.get('date')),
        from: dateOnly(url.searchParams.get('from')),
        to: dateOnly(url.searchParams.get('to')),
        status: str(url.searchParams.get('status'), { max: 20 }),
        search: str(url.searchParams.get('search'), { max: 100 }),
        instructorId: user.role === 'instructor' ? user.id : null
      })
    });
  });

  route('POST', '/api/lectures', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'lectures.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    sendJson(res, 201, { item: lectures.create(body, user, { ip: clientIp(req) }) });
  });

  route('GET', '/api/lectures/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'lectures.view' });
    if (!user) return;
    sendJson(res, 200, lectures.get(int(params.id, { min: 1 })));
  });

  route('PUT', '/api/lectures/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'lectures.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    sendJson(res, 200, { item: lectures.update(int(params.id, { min: 1 }), body, user, { ip: clientIp(req) }) });
  });

  route('DELETE', '/api/lectures/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'lectures.manage' });
    if (!user) return;
    sendJson(res, 200, lectures.remove(int(params.id, { min: 1 }), user, { ip: clientIp(req) }));
  });

  route('POST', '/api/lectures/:id/status', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'lectures.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    sendJson(res, 200, { item: lectures.setStatus(int(params.id, { min: 1 }), str(body.status), user, { ip: clientIp(req) }) });
  });

  route('POST', '/api/lectures/:id/open-session', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'attendance.mark' });
    if (!user) return;
    sendJson(res, 200, lectures.openSession(int(params.id, { min: 1 }), user, { ip: clientIp(req) }));
  });

  route('GET', '/api/lectures/:id/attendance', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'attendance.view' });
    if (!user) return;
    sendJson(res, 200, lectures.get(int(params.id, { min: 1 })));
  });

  route('POST', '/api/lectures/:id/enrollments', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'lectures.manage' });
    if (!user) return;
    const lectureId = int(params.id, { min: 1 });
    const body = await readJson(req, config.limits.jsonBodyBytes);
    const ids = (Array.isArray(body.studentIds) ? body.studentIds : [body.studentId]).map(value => str(value, { max: 40 })).filter(Boolean);
    const insert = db.prepare('INSERT OR IGNORE INTO lecture_enrollments (lecture_id, student_id) VALUES (?, ?)');
    const insertLegacy = db.prepare('INSERT OR IGNORE INTO lecture_students (lecture_id, student_id) VALUES (?, ?)');
    let added = 0;
    const run = db.transaction(() => {
      for (const studentId of ids) {
        if (!db.prepare('SELECT 1 FROM students WHERE student_id = ?').get(studentId)) continue;
        added += insert.run(lectureId, studentId).changes;
        insertLegacy.run(lectureId, studentId);
      }
    });
    run();
    sendJson(res, 200, { lectureId, added, ...lectures.get(lectureId).summary });
  });

  route('POST', '/api/lectures/:id/finalize', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'attendance.mark' });
    if (!user) return;
    sendJson(res, 200, attendance.finalizeLecture(int(params.id, { min: 1 }), user, { ip: clientIp(req) }));
  });

  // ---- attendance

  route('GET', '/api/attendance', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'attendance.view' });
    if (!user) return;
    const { page, pageSize } = pagination(url.searchParams, { defaultSize: 20, maxSize: 200 });
    const result = attendance.list({
      page,
      pageSize,
      lectureId: int(url.searchParams.get('lectureId'), { min: 1 }),
      courseId: int(url.searchParams.get('courseId'), { min: 1 }),
      date: dateOnly(url.searchParams.get('date')),
      from: dateOnly(url.searchParams.get('from')),
      to: dateOnly(url.searchParams.get('to')),
      status: url.searchParams.get('status'),
      source: url.searchParams.get('source'),
      search: str(url.searchParams.get('search'), { max: 100 }),
      studentId: str(url.searchParams.get('studentId'), { max: 40 }),
      user
    });
    sendJson(res, 200, { ...result, filters: reports.filterOptions(user) });
  });

  route('POST', '/api/attendance', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'attendance.mark' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    if (body.status && body.status !== 'present') {
      // Recording a status other than present is an authorised correction.
      if (!can(user, 'attendance.correct')) throw forbidden('You cannot record excused or absent statuses.');
    }
    const result = attendance.markManual({
      lectureId: int(body.lectureId, { min: 1 }),
      studentId: str(body.studentId, { max: 40 }),
      status: str(body.status || 'present', { max: 12 }),
      note: body.note,
      user,
      ip: clientIp(req)
    });
    sendJson(res, (result.updated || result.unchanged) ? 200 : 201, result);
  });

  route('POST', '/api/attendance/bulk', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'attendance.mark' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    sendJson(res, 200, attendance.markBulk({
      lectureId: int(body.lectureId, { min: 1 }),
      entries: body.entries,
      user,
      ip: clientIp(req)
    }));
  });

  route('POST', '/api/attendance/scan', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'attendance.mark' });
    if (!user) return;
    const hit = qrTokenLimiter.key(`scan:${user.id}`);
    if (!hit.allowed) throw new AppError(429, 'Too many scans in a short time. Please wait.');
    const body = await readJson(req, config.limits.jsonBodyBytes);
    const result = attendance.scan({
      qr: body.qr,
      lectureId: int(body.lectureId, { min: 1 }),
      user,
      ip: clientIp(req)
    });
    sendJson(res, result.duplicate ? 409 : 201, result);
  });

  route('PUT', '/api/attendance/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'attendance.correct' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    sendJson(res, 200, attendance.correct(int(params.id, { min: 1 }), {
      status: str(body.status, { max: 12 }),
      reason: body.reason || body.note,
      user,
      ip: clientIp(req)
    }));
  });

  route('DELETE', '/api/attendance/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'attendance.delete' });
    if (!user) return;
    sendJson(res, 200, attendance.remove(int(params.id, { min: 1 }), user, { ip: clientIp(req) }));
  });

  route('GET', '/api/attendance/audit', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'audit.view' });
    if (!user) return;
    const { page, pageSize } = pagination(url.searchParams, { defaultSize: 25, maxSize: 200 });
    sendJson(res, 200, attendance.auditTrail({
      attendanceId: int(url.searchParams.get('attendanceId'), { min: 1 }),
      lectureId: int(url.searchParams.get('lectureId'), { min: 1 }),
      page,
      pageSize
    }));
  });

  // ---- reports & exports

  route('GET', '/api/reports/options', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'reports.view' });
    if (!user) return;
    sendJson(res, 200, reports.filterOptions(user));
  });

  route('GET', '/api/reports/summary', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'reports.view' });
    if (!user) return;
    const filters = reports.buildFilters(Object.fromEntries(url.searchParams), user);
    sendJson(res, 200, {
      summary: reports.summary(filters),
      byCourse: reports.byCourse(filters),
      byStudent: reports.byStudent(filters),
      byDay: reports.byDay(filters)
    });
  });

  route('GET', '/api/reports/attendance', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'reports.view' });
    if (!user) return;
    const filters = reports.buildFilters(Object.fromEntries(url.searchParams), user);
    const { page, pageSize } = pagination(url.searchParams, { defaultSize: 50, maxSize: 500 });
    sendJson(res, 200, reports.attendance(filters, { page, pageSize }));
  });

  route('GET', '/api/reports/lecture/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'reports.view' });
    if (!user) return;
    sendJson(res, 200, reports.lectureReport(int(params.id, { min: 1 })));
  });

  route('GET', '/api/reports/export/xlsx', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'reports.export' });
    if (!user) return;
    const filters = reports.buildFilters(Object.fromEntries(url.searchParams), user);
    const lang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    const rows = reports.attendance(filters, { page: 1, pageSize: 10000 }).items;
    const summary = reports.summary(filters);
    const buffer = await exports.attendanceXlsx({
      summary,
      rows,
      filters: { ...filters, courseName: filters.courseId ? reports.filterOptions(user).courses.find(c => c.id === filters.courseId)?.nameEn : null },
      lang,
      actor: actorName(user)
    });
    sendBuffer(res, 200, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {
      'content-disposition': `attachment; filename="attendance-${new Date().toISOString().slice(0, 10)}.xlsx"`
    });
  });

  route('GET', '/api/reports/export/pdf', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'reports.export' });
    if (!user) return;
    const filters = reports.buildFilters(Object.fromEntries(url.searchParams), user);
    const lang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    const rows = reports.attendance(filters, { page: 1, pageSize: 2000 }).items;
    const summary = reports.summary(filters);
    const buffer = await exports.attendancePdf({
      summary,
      rows,
      filters: { ...filters, courseName: filters.courseId ? reports.filterOptions(user).courses.find(c => c.id === filters.courseId)?.nameEn : null },
      lang,
      actor: actorName(user)
    });
    sendBuffer(res, 200, buffer, 'application/pdf', {
      'content-disposition': `attachment; filename="attendance-${new Date().toISOString().slice(0, 10)}.pdf"`
    });
  });

  route('GET', '/api/reports/student/:id/pdf', async ({ req, res, params, url }) => {
    const user = await requireUser(req, res, { permission: 'reports.export' });
    if (!user) return;
    const lang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    const data = students.attendanceHistory(params.id, { limit: 500 });
    const buffer = await exports.studentPdf({ ...data, lang, actor: actorName(user) });
    sendBuffer(res, 200, buffer, 'application/pdf', {
      'content-disposition': `attachment; filename="student-${encodeURIComponent(params.id)}.pdf"`
    });
  });

  // ---- users (super admin)

  route('GET', '/api/users', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'users.manage' });
    if (!user) return;
    sendJson(res, 200, { items: auth.listUsers() });
  });

  route('POST', '/api/users', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'users.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    const created = await auth.createUser({
      username: body.username,
      email: body.email,
      fullName: body.fullName,
      password: body.password,
      role: body.role
    }, user, { ip: clientIp(req) });
    sendJson(res, 201, { item: created });
  });

  route('PUT', '/api/users/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'users.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    const updated = await auth.updateUser(int(params.id, { min: 1 }), {
      email: body.email,
      fullName: body.fullName,
      role: body.role,
      status: body.status,
      password: body.password
    }, user, { ip: clientIp(req) });
    sendJson(res, 200, { item: updated });
  });

  route('DELETE', '/api/users/:id', async ({ req, res, params }) => {
    const user = await requireUser(req, res, { permission: 'users.manage' });
    if (!user) return;
    auth.deleteUser(int(params.id, { min: 1 }), user, { ip: clientIp(req) });
    sendJson(res, 200, { deleted: int(params.id, { min: 1 }) });
  });

  // ---- audit & settings

  route('GET', '/api/audit-logs', async ({ req, res, url }) => {
    const user = await requireUser(req, res, { permission: 'audit.view' });
    if (!user) return;
    const { page, pageSize } = pagination(url.searchParams, { defaultSize: 25, maxSize: 200 });
    const result = audit.list({
      page,
      pageSize,
      entityType: str(url.searchParams.get('entityType'), { max: 60 }),
      action: str(url.searchParams.get('action'), { max: 60 }),
      actor: str(url.searchParams.get('actor'), { max: 60 }),
      search: str(url.searchParams.get('search'), { max: 100 })
    });
    sendJson(res, 200, { ...result, page, pageSize, totalPages: Math.max(1, Math.ceil(result.total / pageSize)) });
  });

  route('GET', '/api/settings', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'dashboard.view' });
    if (!user) return;
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const map = Object.fromEntries(rows.map(row => [row.key, row.value]));
    sendJson(res, 200, { settings: map, university: config.university });
  });

  route('PUT', '/api/settings', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'settings.manage' });
    if (!user) return;
    const body = await readJson(req, config.limits.jsonBodyBytes);
    const allowed = ['academic_year', 'semester', 'default_attendance_window', 'late_grace_minutes', 'absence_alert_threshold'];
    const upsert = db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `);
    const saved = {};
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      const value = str(body[key], { max: 120 });
      upsert.run(key, value);
      saved[key] = value;
    }
    audit.record({ actor: user, action: 'settings.updated', entityType: 'settings', details: saved, ip: clientIp(req) });
    sendJson(res, 200, { settings: saved });
  });

  route('GET', '/api/system/backup', async ({ req, res }) => {
    const user = await requireUser(req, res, { permission: 'backup.manage' });
    if (!user) return;
    const tmp = path.join(require('node:os').tmpdir(), `attendance-backup-${Date.now()}.sqlite`);
    await db.backup(tmp);
    const buffer = require('node:fs').readFileSync(tmp);
    require('node:fs').unlinkSync(tmp);
    audit.record({ actor: user, action: 'system.backup_downloaded', entityType: 'system', ip: clientIp(req) });
    sendBuffer(res, 200, buffer, 'application/octet-stream', {
      'content-disposition': `attachment; filename="attendance-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sqlite"`
    });
  });

  // ---------------------------------------------------------------- static

  const PUBLIC_DIR = path.join(config.root, 'public');
  const VENDOR_DIR = path.join(PUBLIC_DIR, 'vendor');

  function serveSpa(req, res, pathname) {
    const nonce = randomToken(16);
    const headers = securityHeaders({ nonce, isProduction: config.isProduction, allowFraming: config.allowFraming });
    applyHeaders(res, headers);
    const pageMap = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/login': 'index.html',
      '/reset-password.html': 'reset-password.html'
    };
    const file = pageMap[pathname];
    if (!file) return false;
    const target = path.join(PUBLIC_DIR, file);
    const fs = require('node:fs');
    if (!fs.existsSync(target)) return false;
    const version = require('../package.json').version;
    const html = fs.readFileSync(target, 'utf8')
      .replace(/__CSP_NONCE__/g, nonce)
      .replace(/__APP_VERSION__/g, version);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(html);
    return true;
  }

  // ---------------------------------------------------------------- server

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('Bad request');
      return;
    }
    const pathname = url.pathname;
    applyHeaders(res, {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'same-origin'
    });

    try {
      if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/assets/')) {
        if (serveStatic(res, req, [path.join(PUBLIC_DIR, 'assets')], pathname.replace('/assets', ''), { immutable: true })) return;
        return sendJson(res, 404, { error: 'Asset not found.' });
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/vendor/')) {
        if (serveStatic(res, req, [VENDOR_DIR], pathname.replace('/vendor', ''), { immutable: true })) return;
        return sendJson(res, 404, { error: 'Asset not found.' });
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && serveSpa(req, res, pathname)) return;

      if (pathname.startsWith('/api/')) {
        for (const entry of routes) {
          if (!entry.handler) continue;
          if (entry.method !== req.method) continue;
          const params = match(entry.pattern, pathname);
          if (!params) continue;
          await entry.handler({ req, res, url, params });
          return;
        }
        throw notFound('API route not found.');
      }

      if (req.method === 'GET' && pathname === '/favicon.svg') {
        if (serveStatic(res, req, [PUBLIC_DIR], '/favicon.svg')) return;
        res.writeHead(404).end();
        return;
      }

      return sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(`[${req.method} ${pathname}]`, error);
      const payload = { error: error.message || 'An unexpected server error occurred.' };
      if (error.code) payload.code = error.code;
      if (error.fields) payload.fields = error.fields;
      if (error.details) payload.details = error.details;
      if (!res.headersSent) {
        if (status === 413) res.setHeader('connection', 'close');
        sendJson(res, status, payload);
      } else {
        res.end();
      }
    } finally {
      if (pathname.startsWith('/api/') && Date.now() - started > 500) {
        console.log(`slow request ${req.method} ${pathname} ${Date.now() - started}ms`);
      }
    }
  });

  return { server, db, migration };
}

module.exports = { createApplication };
