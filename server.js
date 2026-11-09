'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '.data', 'attendance.sqlite');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD before starting the server.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    student_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    course TEXT NOT NULL,
    academic_level TEXT NOT NULL,
    qr_token TEXT UNIQUE,
    qr_revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_students_name ON students(name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_students_course ON students(course COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_students_level ON students(academic_level COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    attended_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'present' CHECK(status IN ('present','late','excused','absent')),
    course TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_student_time ON attendance(student_id, attended_at DESC);
`);
const studentColumns = new Set(db.prepare('PRAGMA table_info(students)').all().map(row => row.name));
if (!studentColumns.has('qr_token')) db.exec('ALTER TABLE students ADD COLUMN qr_token TEXT');
if (!studentColumns.has('qr_revoked_at')) db.exec('ALTER TABLE students ADD COLUMN qr_revoked_at TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_students_qr_token ON students(qr_token) WHERE qr_token IS NOT NULL');
const newQrToken = () => crypto.randomBytes(32).toString('base64url');
const assignMissingTokens = db.prepare('UPDATE students SET qr_token = ? WHERE student_id = ? AND qr_token IS NULL');
const assignTokens = db.transaction(() => {
  for (const row of db.prepare('SELECT student_id FROM students WHERE qr_token IS NULL').all()) assignMissingTokens.run(newQrToken(), row.student_id);
});
assignTokens();

const sessions = new Map();
const hash = value => crypto.createHash('sha256').update(String(value)).digest();
function constantTimeEqual(a, b) { return crypto.timingSafeEqual(hash(a), hash(b)); }
function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 64 * 1024) { reject(Object.assign(new Error('Request body is too large.'), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function normalizeStudent(input, { create = false } = {}) {
  const student = { id: String(input.id ?? '').trim(), name: String(input.name ?? '').trim(), course: String(input.course ?? '').trim(), level: String(input.level ?? '').trim() };
  const errors = {};
  if (create && (!student.id || student.id.length > 40 || !/^[\p{L}\p{N}._/-]+$/u.test(student.id))) errors.id = 'Enter a valid student ID (up to 40 letters, numbers, or . _ / -).';
  if (!student.name || student.name.length > 100) errors.name = 'Name is required and must be at most 100 characters.';
  if (!student.course || student.course.length > 100) errors.course = 'Course is required and must be at most 100 characters.';
  if (!student.level || student.level.length > 60) errors.level = 'Academic level is required and must be at most 60 characters.';
  return { student, errors };
}
function requireAdmin(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    send(res, 401, { error: 'Authentication required. Please sign in again.' });
    return false;
  }
  if (session.role !== 'admin') { send(res, 403, { error: 'Administrator role required.' }); return false; }
  return true;
}
const selectStudent = db.prepare('SELECT student_id AS id, name, course, academic_level AS level, created_at AS createdAt, updated_at AS updatedAt FROM students WHERE student_id = ?');
const getQrStudent = db.prepare('SELECT student_id AS id, name, course, qr_token AS token, qr_revoked_at AS revokedAt FROM students WHERE student_id = ?');
const insertAttendance = db.prepare('INSERT INTO attendance (student_id,attended_at,status,course) VALUES (?,?,?,?)');
const findDuplicateAttendance = db.prepare("SELECT id FROM attendance WHERE student_id = ? AND substr(attended_at,1,10) = ? LIMIT 1");
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const file = path.join(__dirname, 'index.html');
      if (!fs.existsSync(file)) return send(res, 404, { error: 'Dashboard not found.' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/students.html') {
      const file = path.join(__dirname, 'public', 'students.html');
      if (!fs.existsSync(file)) return send(res, 404, { error: 'Student management page not found.' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readJson(req);
      if (!constantTimeEqual(body.email || '', ADMIN_EMAIL) || !constantTimeEqual(body.password || '', ADMIN_PASSWORD)) return send(res, 401, { error: 'Invalid email or password.' });
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, { role: 'admin', expiresAt: Date.now() + SESSION_TTL_MS });
      return send(res, 200, { token, role: 'admin', expiresIn: SESSION_TTL_MS / 1000 });
    }
    if (url.pathname.startsWith('/api/')) {
      if (!requireAdmin(req, res)) return;
      if (req.method === 'GET' && url.pathname === '/api/students') {
        const page = Math.max(1, Math.min(100000, parseInt(url.searchParams.get('page') || '1', 10) || 1));
        const pageSize = Math.max(1, Math.min(100, parseInt(url.searchParams.get('pageSize') || '10', 10) || 10));
        const search = (url.searchParams.get('search') || '').trim().slice(0, 100), course = (url.searchParams.get('course') || '').trim().slice(0, 100), level = (url.searchParams.get('level') || '').trim().slice(0, 60);
        const where = [], params = [];
        if (search) { where.push('(name LIKE ? COLLATE NOCASE OR student_id LIKE ? COLLATE NOCASE)'); params.push(`%${search}%`, `%${search}%`); }
        if (course) { where.push('course = ?'); params.push(course); }
        if (level) { where.push('academic_level = ?'); params.push(level); }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = db.prepare(`SELECT COUNT(*) AS count FROM students ${clause}`).get(...params).count;
        const rows = db.prepare(`SELECT student_id AS id, name, course, academic_level AS level, created_at AS createdAt, updated_at AS updatedAt FROM students ${clause} ORDER BY name COLLATE NOCASE, student_id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
        const courses = db.prepare('SELECT DISTINCT course FROM students ORDER BY course COLLATE NOCASE').all().map(row => row.course);
        const levels = db.prepare('SELECT DISTINCT academic_level AS level FROM students ORDER BY academic_level COLLATE NOCASE').all().map(row => row.level);
        return send(res, 200, { items: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), courses, levels });
      }
      if (req.method === 'GET' && url.pathname === '/api/students/qr-cards') {
        const rows = db.prepare('SELECT student_id AS id,name,course,academic_level AS level,qr_token AS token,qr_revoked_at AS revokedAt FROM students ORDER BY name COLLATE NOCASE,student_id').all();
        return send(res, 200, { items: rows });
      }
      if (req.method === 'POST' && url.pathname === '/api/students') {
        const body = await readJson(req), { student, errors } = normalizeStudent(body, { create: true });
        if (Object.keys(errors).length) return send(res, 422, { error: 'Please correct the highlighted fields.', fields: errors });
        try {
          db.prepare('INSERT INTO students (student_id,name,course,academic_level,qr_token) VALUES (?,?,?,?,?)').run(student.id, student.name, student.course, student.level, newQrToken());
          return send(res, 201, { item: selectStudent.get(student.id) });
        } catch (error) {
          if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') return send(res, 409, { error: 'That student ID is already registered.', fields: { id: 'Student ID must be unique.' } });
          throw error;
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/students/options') {
        return send(res, 200, { courses: db.prepare('SELECT DISTINCT course FROM students ORDER BY course COLLATE NOCASE').all().map(x => x.course), levels: db.prepare('SELECT DISTINCT academic_level AS level FROM students ORDER BY academic_level COLLATE NOCASE').all().map(x => x.level) });
      }
      const studentMatch = url.pathname.match(/^\/api\/students\/([^/]+)(?:\/(attendance|qr|qr\/rotate|qr\/revoke))?$/);
      if (studentMatch) {
        const id = decodeURIComponent(studentMatch[1]), subroute = studentMatch[2];
        if (subroute === 'qr-cards') return send(res, 404, { error: 'Not found.' });
        if (req.method === 'GET' && subroute === 'attendance') {
          const item = selectStudent.get(id);
          if (!item) return send(res, 404, { error: 'Student not found.' });
          const history = db.prepare('SELECT id, student_id AS studentId, attended_at AS attendedAt, status, course FROM attendance WHERE student_id = ? ORDER BY attended_at DESC, id DESC LIMIT 500').all(id);
          return send(res, 200, { student: item, history });
        }
        if (req.method === 'GET' && subroute === 'qr') {
          const item = getQrStudent.get(id);
          if (!item) return send(res, 404, { error: 'Student not found.' });
          return send(res, 200, { item: { ...item, qr: item.revokedAt ? null : { v: 1, token: item.token } } });
        }
        if (req.method === 'POST' && subroute === 'qr/rotate') {
          const item = getQrStudent.get(id);
          if (!item) return send(res, 404, { error: 'Student not found.' });
          const token = newQrToken();
          db.prepare('UPDATE students SET qr_token=?,qr_revoked_at=NULL WHERE student_id=?').run(token, id);
          return send(res, 200, { item: { id, qr: { v: 1, token } } });
        }
        if (req.method === 'POST' && subroute === 'qr/revoke') {
          const result = db.prepare("UPDATE students SET qr_revoked_at=datetime('now') WHERE student_id=? AND qr_revoked_at IS NULL").run(id);
          if (!result.changes) return selectStudent.get(id) ? send(res, 409, { error: 'QR code is already revoked.' }) : send(res, 404, { error: 'Student not found.' });
          return send(res, 200, { revoked: true, id });
        }
        if (req.method === 'GET' && !subroute) {
          const item = selectStudent.get(id);
          return item ? send(res, 200, { item }) : send(res, 404, { error: 'Student not found.' });
        }
        if (req.method === 'PUT' && !subroute) {
          const body = await readJson(req), { student, errors } = normalizeStudent({ ...body, id });
          if (Object.keys(errors).length) return send(res, 422, { error: 'Please correct the highlighted fields.', fields: errors });
          const result = db.prepare("UPDATE students SET name=?,course=?,academic_level=?,updated_at=datetime('now') WHERE student_id=?").run(student.name, student.course, student.level, id);
          return result.changes ? send(res, 200, { item: selectStudent.get(id) }) : send(res, 404, { error: 'Student not found.' });
        }
        if (req.method === 'DELETE' && !subroute) {
          const result = db.prepare('DELETE FROM students WHERE student_id=?').run(id);
          return result.changes ? send(res, 200, { deleted: id }) : send(res, 404, { error: 'Student not found.' });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/attendance/scan') {
        const body = await readJson(req), qr = body.qr;
        if (!qr || qr.v !== 1 || typeof qr.token !== 'string' || qr.token.length < 40 || qr.token.length > 60) return send(res, 422, { error: 'Invalid QR code format.' });
        const student = getQrStudent.get(db.prepare('SELECT student_id FROM students WHERE qr_token=?').get(qr.token)?.student_id || '');
        if (!student || student.revokedAt) return send(res, 404, { error: 'QR code is invalid, revoked, or no longer registered.' });
        const at = new Date(), day = at.toISOString().slice(0, 10);
        const saveAttendance = db.transaction(() => {
          if (findDuplicateAttendance.get(student.id, day)) return null;
          const result = insertAttendance.run(student.id, at.toISOString(), 'present', student.course);
          return { id: result.lastInsertRowid, studentId: student.id, name: student.name, course: student.course, attendedAt: at.toISOString(), status: 'present' };
        });
        const record = saveAttendance();
        if (!record) return send(res, 409, { error: 'Attendance has already been recorded today.' });
        return send(res, 201, { item: record });
      }
      if (req.method === 'POST' && url.pathname === '/api/attendance') {
        const body = await readJson(req), id = String(body.studentId || '').trim(), status = String(body.status || 'present');
        if (!selectStudent.get(id)) return send(res, 404, { error: 'Student not found.' });
        if (!['present','late','excused','absent'].includes(status)) return send(res, 422, { error: 'Invalid attendance status.' });
        const at = body.attendedAt ? new Date(body.attendedAt) : new Date();
        if (Number.isNaN(at.getTime())) return send(res, 422, { error: 'Invalid attendance date.' });
        const student = selectStudent.get(id), day = at.toISOString().slice(0, 10);
        const saveAttendance = db.transaction(() => {
          if (findDuplicateAttendance.get(id, day)) return null;
          const result = insertAttendance.run(id, at.toISOString(), status, student.course);
          return { id: result.lastInsertRowid, studentId: id, attendedAt: at.toISOString(), status, course: student.course };
        });
        const item = saveAttendance();
        return item ? send(res, 201, { item }) : send(res, 409, { error: 'Attendance has already been recorded today.' });
      }
      return send(res, 404, { error: 'API route not found.' });
    }
    return send(res, 404, { error: 'Not found.' });
  } catch (error) {
    if (error.status) return send(res, error.status, { error: error.message });
    console.error(error);
    return send(res, 500, { error: 'An unexpected server error occurred.' });
  }
});
server.listen(PORT, () => console.log(`Attendance app ready at http://localhost:${PORT}`));
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
