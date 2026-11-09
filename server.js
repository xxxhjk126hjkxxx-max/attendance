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
const VALID_STATUSES = ['present', 'late', 'excused', 'absent'];

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

  CREATE TABLE IF NOT EXISTS lectures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course TEXT NOT NULL,
    title TEXT NOT NULL,
    lecture_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(course, lecture_date, title)
  );

  CREATE INDEX IF NOT EXISTS idx_lectures_course_date ON lectures(course COLLATE NOCASE, lecture_date);

  CREATE TABLE IF NOT EXISTS lecture_enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lecture_id INTEGER NOT NULL,
    student_id TEXT NOT NULL,
    enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(lecture_id, student_id),
    FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lecture_id INTEGER NOT NULL,
    student_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'present' CHECK(status IN ('present','late','excused','absent')),
    marked_at TEXT NOT NULL DEFAULT (datetime('now')),
    marked_by TEXT NOT NULL DEFAULT 'system',
    source TEXT NOT NULL DEFAULT 'manual',
    note TEXT,
    UNIQUE(lecture_id, student_id),
    FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attendance_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    reason TEXT,
    FOREIGN KEY (attendance_id) REFERENCES attendance(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_lecture ON attendance(lecture_id, student_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(marked_at);
  CREATE INDEX IF NOT EXISTS idx_audit_attendance ON attendance_audit(attendance_id, changed_at DESC);
`);

const studentColumns = new Set(db.prepare('PRAGMA table_info(students)').all().map(row => row.name));
if (!studentColumns.has('qr_token')) db.exec('ALTER TABLE students ADD COLUMN qr_token TEXT');
if (!studentColumns.has('qr_revoked_at')) db.exec('ALTER TABLE students ADD COLUMN qr_revoked_at TEXT');

db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_students_qr_token ON students(qr_token) WHERE qr_token IS NOT NULL');

db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_lecture_student ON attendance(lecture_id, student_id) WHERE lecture_id IS NOT NULL');

const sessions = new Map();
const hash = value => crypto.createHash('sha256').update(String(value)).digest();

function constantTimeEqual(a, b) {
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function normalizeStudent(input, { create = false } = {}) {
  const student = {
    id: String(input.id ?? '').trim(),
    name: String(input.name ?? '').trim(),
    course: String(input.course ?? '').trim(),
    level: String(input.level ?? '').trim()
  };

  const errors = {};
  if (create && (!student.id || student.id.length > 40 || !/^[\p{L}\p{N}._/-]+$/u.test(student.id))) {
    errors.id = 'Enter a valid student ID (up to 40 letters, numbers, or . _ / -).';
  }
  if (!student.name || student.name.length > 100) errors.name = 'Name is required and must be at most 100 characters.';
  if (!student.course || student.course.length > 100) errors.course = 'Course is required and must be at most 100 characters.';
  if (!student.level || student.level.length > 60) errors.level = 'Academic level is required and must be at most 60 characters.';
  return { student, errors };
}

function getSessionFromRequest(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    send(res, 401, { error: 'Authentication required. Please sign in again.' });
    return false;
  }
  if (session.role !== 'admin') {
    send(res, 403, { error: 'Administrator role required.' });
    return false;
  }
  return true;
}

function getAuthenticatedUser(req) {
  const session = getSessionFromRequest(req);
  return session ? (session.email || 'admin') : 'system';
}

function isoDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseIntValue(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const selectStudent = db.prepare('SELECT student_id AS id, name, course, academic_level AS level, created_at AS createdAt, updated_at AS updatedAt FROM students WHERE student_id = ?');
const getQrStudent = db.prepare('SELECT student_id AS id, name, course, qr_token AS token, qr_revoked_at AS revokedAt FROM students WHERE student_id = ?');
const newQrToken = () => crypto.randomBytes(32).toString('base64url');

const assignTokens = db.transaction(() => {
  for (const row of db.prepare('SELECT student_id FROM students WHERE qr_token IS NULL').all()) {
    db.prepare('UPDATE students SET qr_token = ? WHERE student_id = ?').run(newQrToken(), row.student_id);
  }
});
assignTokens();

db.exec(`
  CREATE TABLE IF NOT EXISTS lecture_students (
    lecture_id INTEGER NOT NULL,
    student_id TEXT NOT NULL,
    PRIMARY KEY (lecture_id, student_id),
    FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
  );
`);

const ensureLectureEnrollmentTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lecture_students'");
if (ensureLectureEnrollmentTable.get()) {
  db.exec(`
    INSERT OR IGNORE INTO lecture_students (lecture_id, student_id)
    SELECT lecture_id, student_id FROM attendance WHERE lecture_id IS NOT NULL AND student_id IS NOT NULL;
  `);
}

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
      if (!constantTimeEqual(body.email || '', ADMIN_EMAIL) || !constantTimeEqual(body.password || '', ADMIN_PASSWORD)) {
        return send(res, 401, { error: 'Invalid email or password.' });
      }
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, { role: 'admin', email: ADMIN_EMAIL, expiresAt: Date.now() + SESSION_TTL_MS });
      return send(res, 200, { token, role: 'admin', expiresIn: SESSION_TTL_MS / 1000 });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!requireAdmin(req, res)) return;

      if (req.method === 'GET' && url.pathname === '/api/students') {
        const page = Math.max(1, Math.min(100000, parseInt(url.searchParams.get('page') || '1', 10) || 1));
        const pageSize = Math.max(1, Math.min(100, parseInt(url.searchParams.get('pageSize') || '10', 10) || 10));
        const search = (url.searchParams.get('search') || '').trim().slice(0, 100);
        const course = (url.searchParams.get('course') || '').trim().slice(0, 100);
        const level = (url.searchParams.get('level') || '').trim().slice(0, 60);
        const where = [];
        const params = [];

        if (search) {
          where.push('(name LIKE ? COLLATE NOCASE OR student_id LIKE ? COLLATE NOCASE)');
          params.push(`%${search}%`, `%${search}%`);
        }
        if (course) {
          where.push('course = ?');
          params.push(course);
        }
        if (level) {
          where.push('academic_level = ?');
          params.push(level);
        }

        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = db.prepare(`SELECT COUNT(*) AS count FROM students ${clause}`).get(...params).count;
        const rows = db.prepare(`
          SELECT student_id AS id, name, course, academic_level AS level, created_at AS createdAt, updated_at AS updatedAt
          FROM students ${clause}
          ORDER BY name COLLATE NOCASE, student_id
          LIMIT ? OFFSET ?
        `).all(...params, pageSize, (page - 1) * pageSize);

        const courses = db.prepare('SELECT DISTINCT course FROM students ORDER BY course COLLATE NOCASE').all().map(row => row.course);
        const levels = db.prepare('SELECT DISTINCT academic_level AS level FROM students ORDER BY academic_level COLLATE NOCASE').all().map(row => row.level);

        return send(res, 200, {
          items: rows,
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
          courses,
          levels
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/students/options') {
        return send(res, 200, {
          courses: db.prepare('SELECT DISTINCT course FROM students ORDER BY course COLLATE NOCASE').all().map(x => x.course),
          levels: db.prepare('SELECT DISTINCT academic_level AS level FROM students ORDER BY academic_level COLLATE NOCASE').all().map(x => x.level)
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/students') {
        const body = await readJson(req);
        const { student, errors } = normalizeStudent(body, { create: true });
        if (Object.keys(errors).length) {
          return send(res, 422, { error: 'Please correct the highlighted fields.', fields: errors });
        }

        try {
          db.prepare('INSERT INTO students (student_id,name,course,academic_level,qr_token) VALUES (?,?,?,?,?)')
            .run(student.id, student.name, student.course, student.level, newQrToken());
          return send(res, 201, { item: selectStudent.get(student.id) });
        } catch (error) {
          if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return send(res, 409, { error: 'That student ID is already registered.', fields: { id: 'Student ID must be unique.' } });
          }
          throw error;
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/students/qr-cards') {
        const rows = db.prepare(`
          SELECT student_id AS id, name, course, academic_level AS level, qr_token AS token, qr_revoked_at AS revokedAt
          FROM students
          ORDER BY name COLLATE NOCASE, student_id
        `).all();
        return send(res, 200, { items: rows });
      }

      const studentMatch = url.pathname.match(/^\/api\/students\/([^/]+)(?:\/(attendance|qr|qr\/rotate|qr\/revoke))?$/);
      if (studentMatch) {
        const id = decodeURIComponent(studentMatch[1]);
        const subroute = studentMatch[2];

        if (req.method === 'GET' && subroute === 'attendance') {
          const item = selectStudent.get(id);
          if (!item) return send(res, 404, { error: 'Student not found.' });
          const history = db.prepare(`
            SELECT a.id, a.lecture_id AS lectureId, l.title AS lectureTitle, l.course AS course, l.lecture_date AS lectureDate,
                   a.attended_at AS attendedAt, a.status, a.marked_by AS markedBy, a.source
            FROM attendance a
            LEFT JOIN lectures l ON l.id = a.lecture_id
            WHERE a.student_id = ?
            ORDER BY a.marked_at DESC, a.id DESC
            LIMIT 500
          `).all(id);
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
          db.prepare('UPDATE students SET qr_token = ?, qr_revoked_at = NULL WHERE student_id = ?').run(token, id);
          return send(res, 200, { item: { id, qr: { v: 1, token } } });
        }

        if (req.method === 'POST' && subroute === 'qr/revoke') {
          const result = db.prepare("UPDATE students SET qr_revoked_at = datetime('now') WHERE student_id = ? AND qr_revoked_at IS NULL").run(id);
          if (!result.changes) return selectStudent.get(id) ? send(res, 409, { error: 'QR code is already revoked.' }) : send(res, 404, { error: 'Student not found.' });
          return send(res, 200, { revoked: true, id });
        }

        if (req.method === 'GET' && !subroute) {
          const item = selectStudent.get(id);
          return item ? send(res, 200, { item }) : send(res, 404, { error: 'Student not found.' });
        }

        if (req.method === 'PUT' && !subroute) {
          const body = await readJson(req);
          const { student, errors } = normalizeStudent({ ...body, id });
          if (Object.keys(errors).length) {
            return send(res, 422, { error: 'Please correct the highlighted fields.', fields: errors });
          }
          const result = db.prepare("UPDATE students SET name = ?, course = ?, academic_level = ?, updated_at = datetime('now') WHERE student_id = ?")
            .run(student.name, student.course, student.level, id);
          return result.changes ? send(res, 200, { item: selectStudent.get(id) }) : send(res, 404, { error: 'Student not found.' });
        }

        if (req.method === 'DELETE' && !subroute) {
          const result = db.prepare('DELETE FROM students WHERE student_id = ?').run(id);
          return result.changes ? send(res, 200, { deleted: id }) : send(res, 404, { error: 'Student not found.' });
        }
      }

      if (req.method === 'POST' && url.pathname === '/api/lectures') {
        const body = await readJson(req);
        const course = String(body.course || '').trim();
        const title = String(body.title || '').trim();
        const lectureDate = isoDate(body.lectureDate || body.date || '');
        const startTime = String(body.startTime || '').trim();
        const endTime = String(body.endTime || '').trim();

        if (!course || !title || !lectureDate || !startTime || !endTime) {
          return send(res, 422, { error: 'Course, title, date, start time, and end time are required.' });
        }

        try {
          const result = db.prepare(`
            INSERT INTO lectures (course, title, lecture_date, start_time, end_time, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(course, title, lectureDate, startTime, endTime, getAuthenticatedUser(req));

          return send(res, 201, {
            item: {
              id: result.lastInsertRowid,
              course,
              title,
              lectureDate,
              startTime,
              endTime,
              createdBy: getAuthenticatedUser(req)
            }
          });
        } catch (error) {
          if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return send(res, 409, { error: 'A lecture with this course, title, and date already exists.' });
          }
          throw error;
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/lectures') {
        const course = (url.searchParams.get('course') || '').trim();
        const lectureDate = isoDate(url.searchParams.get('date') || '');
        const where = [];
        const params = [];

        if (course) {
          where.push('course = ?');
          params.push(course);
        }
        if (lectureDate) {
          where.push('lecture_date = ?');
          params.push(lectureDate);
        }

        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const rows = db.prepare(`
          SELECT l.id, l.course, l.title, l.lecture_date AS lectureDate, l.start_time AS startTime, l.end_time AS endTime,
                 l.created_by AS createdBy, l.created_at AS createdAt,
                 (SELECT COUNT(*) FROM lecture_enrollments WHERE lecture_id = l.id) AS enrolledCount,
                 (SELECT COUNT(*) FROM attendance WHERE lecture_id = l.id) AS markedCount
          FROM lectures l ${clause}
          ORDER BY l.lecture_date DESC, l.start_time DESC
        `).all(...params);

        return send(res, 200, { items: rows });
      }

      const lectureMatch = url.pathname.match(/^\/api\/lectures\/(\d+)(?:\/(enrollments|attendance|summary))?$/);
      if (lectureMatch) {
        const lectureId = Number.parseInt(lectureMatch[1], 10);
        const subroute = lectureMatch[2];

        if (req.method === 'POST' && subroute === 'enrollments') {
          const body = await readJson(req);
          const studentIds = Array.isArray(body.studentIds) ? body.studentIds : (body.studentId ? [body.studentId] : []);
          const lecture = db.prepare('SELECT * FROM lectures WHERE id = ?').get(lectureId);
          if (!lecture) return send(res, 404, { error: 'Lecture not found.' });

          const insert = db.prepare('INSERT OR IGNORE INTO lecture_enrollments (lecture_id, student_id) VALUES (?, ?)');
          let inserted = 0;
          for (const value of studentIds) {
            const studentId = String(value || '').trim();
            if (!studentId) continue;
            if (!db.prepare('SELECT 1 FROM students WHERE student_id = ?').get(studentId)) continue;
            const result = insert.run(lectureId, studentId);
            inserted += result.changes;
          }

          return send(res, 200, { lectureId, inserted, totalEnrolled: db.prepare('SELECT COUNT(*) AS count FROM lecture_enrollments WHERE lecture_id = ?').get(lectureId).count });
        }

        if (req.method === 'GET' && subroute === 'attendance') {
          const lecture = db.prepare('SELECT * FROM lectures WHERE id = ?').get(lectureId);
          if (!lecture) return send(res, 404, { error: 'Lecture not found.' });

          const rows = db.prepare(`
            SELECT a.id, a.lecture_id AS lectureId, a.student_id AS studentId, s.name AS studentName, s.course AS studentCourse,
                   a.status, a.marked_at AS markedAt, a.marked_by AS markedBy, a.source, a.note
            FROM attendance a
            JOIN students s ON s.student_id = a.student_id
            WHERE a.lecture_id = ?
            ORDER BY a.marked_at DESC, s.name COLLATE NOCASE
          `).all(lectureId);

          const summary = {
            lectureId: lecture.id,
            course: lecture.course,
            title: lecture.title,
            lectureDate: lecture.lecture_date,
            startTime: lecture.start_time,
            endTime: lecture.end_time,
            totalEnrolled: db.prepare('SELECT COUNT(*) AS count FROM lecture_enrollments WHERE lecture_id = ?').get(lectureId).count,
            totalMarked: rows.length,
            present: rows.filter(row => row.status === 'present').length,
            late: rows.filter(row => row.status === 'late').length,
            excused: rows.filter(row => row.status === 'excused').length,
            absent: rows.filter(row => row.status === 'absent').length
          };

          return send(res, 200, { lecture, summary, items: rows });
        }

        if (req.method === 'GET' && subroute === 'summary') {
          const lecture = db.prepare('SELECT * FROM lectures WHERE id = ?').get(lectureId);
          if (!lecture) return send(res, 404, { error: 'Lecture not found.' });

          const rows = db.prepare('SELECT status, COUNT(*) AS count FROM attendance WHERE lecture_id = ? GROUP BY status').all(lectureId);
          const summary = { lectureId, course: lecture.course, title: lecture.title, date: lecture.lecture_date, totalEnrolled: db.prepare('SELECT COUNT(*) AS count FROM lecture_enrollments WHERE lecture_id = ?').get(lectureId).count };
          for (const status of VALID_STATUSES) {
            const match = rows.find(row => row.status === status);
            summary[status] = match ? match.count : 0;
          }
          return send(res, 200, { summary });
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/attendance') {
        const lectureId = parseIntValue(url.searchParams.get('lectureId'), 0);
        const course = (url.searchParams.get('course') || '').trim();
        const date = isoDate(url.searchParams.get('date') || '');
        const status = (url.searchParams.get('status') || '').trim();
        const search = (url.searchParams.get('search') || '').trim();
        const page = Math.max(1, parseIntValue(url.searchParams.get('page'), 1));
        const pageSize = Math.min(Math.max(1, parseIntValue(url.searchParams.get('pageSize'), 20)), 200);

        const where = [];
        const params = [];

        if (lectureId) {
          where.push('a.lecture_id = ?');
          params.push(lectureId);
        }
        if (course) {
          where.push('l.course = ?');
          params.push(course);
        }
        if (date) {
          where.push('l.lecture_date = ?');
          params.push(date);
        }
        if (status && VALID_STATUSES.includes(status)) {
          where.push('a.status = ?');
          params.push(status);
        }
        if (search) {
          where.push('(s.name LIKE ? COLLATE NOCASE OR s.student_id LIKE ? COLLATE NOCASE)');
          params.push(`%${search}%`, `%${search}%`);
        }

        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = db.prepare(`
          SELECT COUNT(*) AS count
          FROM attendance a
          JOIN students s ON s.student_id = a.student_id
          JOIN lectures l ON l.id = a.lecture_id
          ${clause}
        `).get(...params).count;

        const rows = db.prepare(`
          SELECT a.id, a.lecture_id AS lectureId, a.student_id AS studentId, s.name AS studentName,
                 s.course AS studentCourse, l.course AS lectureCourse, l.title AS lectureTitle,
                 l.lecture_date AS lectureDate, l.start_time AS startTime, l.end_time AS endTime,
                 a.status, a.marked_at AS markedAt, a.marked_by AS markedBy, a.source, a.note
          FROM attendance a
          JOIN students s ON s.student_id = a.student_id
          JOIN lectures l ON l.id = a.lecture_id
          ${clause}
          ORDER BY a.marked_at DESC, s.name COLLATE NOCASE
          LIMIT ? OFFSET ?
        `).all(...params, pageSize, (page - 1) * pageSize);

        const courses = db.prepare('SELECT DISTINCT course FROM lectures ORDER BY course COLLATE NOCASE').all().map(row => row.course);
        const lectures = db.prepare('SELECT id, course, title, lecture_date AS lectureDate FROM lectures ORDER BY lecture_date DESC, start_time DESC').all();

        return send(res, 200, {
          items: rows,
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
          courses,
          lectures
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/attendance/scan') {
        const body = await readJson(req);
        const lectureId = parseIntValue(body.lectureId, 0);
        const qr = body.qr;

        if (!lectureId || !qr || qr.v !== 1 || typeof qr.token !== 'string' || qr.token.length < 40 || qr.token.length > 80) {
          return send(res, 422, { error: 'Invalid QR code or lecture reference.' });
        }

        const lecture = db.prepare('SELECT * FROM lectures WHERE id = ?').get(lectureId);
        if (!lecture) return send(res, 404, { error: 'Lecture not found.' });

        const student = db.prepare('SELECT student_id AS id, name, course, academic_level AS level FROM students WHERE qr_token = ? AND (qr_revoked_at IS NULL OR qr_revoked_at = \'\')').get(qr.token);
        if (!student) return send(res, 404, { error: 'QR code is invalid, revoked, or not registered.' });

        const enrolled = db.prepare('SELECT 1 FROM lecture_enrollments WHERE lecture_id = ? AND student_id = ?').get(lectureId, student.id);
        if (!enrolled) {
          return send(res, 409, { error: 'Student is not enrolled in this lecture.' });
        }

        const existing = db.prepare('SELECT * FROM attendance WHERE lecture_id = ? AND student_id = ?').get(lectureId, student.id);
        if (existing) {
          return send(res, 409, { error: 'Attendance is already recorded for this student in this lecture.' });
        }

        const by = getAuthenticatedUser(req);
        const result = db.prepare(`
          INSERT INTO attendance (lecture_id, student_id, status, marked_by, source, note)
          VALUES (?, ?, ?, ?, 'qr', ?)
        `).run(lectureId, student.id, 'present', by, 'Scanned QR attendance');

        return send(res, 201, {
          item: {
            id: result.lastInsertRowid,
            lectureId,
            studentId: student.id,
            studentName: student.name,
            status: 'present',
            markedBy: by,
            source: 'qr',
            lectureDate: lecture.lecture_date,
            note: 'Scanned QR attendance'
          }
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/attendance/manual') {
        const body = await readJson(req);
        const lectureId = parseIntValue(body.lectureId, 0);
        const studentId = String(body.studentId || '').trim();
        const status = String(body.status || '').trim();
        const note = String(body.note || '').trim();

        if (!lectureId || !studentId || !VALID_STATUSES.includes(status)) {
          return send(res, 422, { error: 'Valid lecture, student, and attendance status are required.' });
        }

        const lecture = db.prepare('SELECT * FROM lectures WHERE id = ?').get(lectureId);
        if (!lecture) return send(res, 404, { error: 'Lecture not found.' });

        const student = selectStudent.get(studentId);
        if (!student) return send(res, 404, { error: 'Student not found.' });

        const enrolled = db.prepare('SELECT 1 FROM lecture_enrollments WHERE lecture_id = ? AND student_id = ?').get(lectureId, studentId);
        if (!enrolled) {
          return send(res, 409, { error: 'Student is not enrolled in this lecture.' });
        }

        const existing = db.prepare('SELECT * FROM attendance WHERE lecture_id = ? AND student_id = ?').get(lectureId, studentId);
        const by = getAuthenticatedUser(req);

        if (existing) {
          if (existing.status === status) {
            return send(res, 200, { item: { ...existing, lectureTitle: lecture.title, studentName: student.name, updated: false } });
          }

          const result = db.transaction(() => {
            db.prepare(`
              UPDATE attendance
              SET status = ?, marked_at = datetime('now'), marked_by = ?, source = 'manual', note = ?
              WHERE id = ?
            `).run(status, by, note || 'Manual attendance correction', existing.id);
            db.prepare(`
              INSERT INTO attendance_audit (attendance_id, previous_status, new_status, changed_by, reason)
              VALUES (?, ?, ?, ?, ?)
            `).run(existing.id, existing.status, status, by, note || 'Manual attendance correction');
            return db.prepare(`
              SELECT a.*, s.name AS studentName, l.title AS lectureTitle
              FROM attendance a
              JOIN students s ON s.student_id = a.student_id
              JOIN lectures l ON l.id = a.lecture_id
              WHERE a.id = ?
            `).get(existing.id);
          })();

          return send(res, 200, { item: result, updated: true });
        }

        const result = db.prepare(`
          INSERT INTO attendance (lecture_id, student_id, status, marked_by, source, note)
          VALUES (?, ?, ?, ?, 'manual', ?)
        `).run(lectureId, studentId, status, by, note || 'Manual attendance');

        return send(res, 201, {
          item: {
            id: result.lastInsertRowid,
            lectureId,
            studentId,
            studentName: student.name,
            lectureTitle: lecture.title,
            status,
            markedBy: by,
            source: 'manual',
            note: note || 'Manual attendance'
          }
        });
      }

      const attendanceEditMatch = url.pathname.match(/^\/api\/attendance\/(\d+)$/);
      if (attendanceEditMatch && req.method === 'PUT') {
        const attendanceId = Number.parseInt(attendanceEditMatch[1], 10);
        const body = await readJson(req);
        const status = String(body.status || '').trim();
        const reason = String(body.reason || body.note || '').trim();
        if (!VALID_STATUSES.includes(status)) {
          return send(res, 422, { error: 'Valid attendance status is required.' });
        }

        const existing = db.prepare(`
          SELECT a.*, s.name AS studentName, l.title AS lectureTitle, l.course AS course
          FROM attendance a
          JOIN students s ON s.student_id = a.student_id
          JOIN lectures l ON l.id = a.lecture_id
          WHERE a.id = ?
        `).get(attendanceId);
        if (!existing) return send(res, 404, { error: 'Attendance record not found.' });

        const by = getAuthenticatedUser(req);
        const result = db.transaction(() => {
          db.prepare(`
            UPDATE attendance
            SET status = ?, marked_at = datetime('now'), marked_by = ?, source = 'correction', note = ?
            WHERE id = ?
          `).run(status, by, reason || 'Authorized correction', attendanceId);
          db.prepare(`
            INSERT INTO attendance_audit (attendance_id, previous_status, new_status, changed_by, reason)
            VALUES (?, ?, ?, ?, ?)
          `).run(attendanceId, existing.status, status, by, reason || 'Authorized correction');
          return db.prepare(`
            SELECT a.*, s.name AS studentName, l.title AS lectureTitle, l.course AS course
            FROM attendance a
            JOIN students s ON s.student_id = a.student_id
            JOIN lectures l ON l.id = a.lecture_id
            WHERE a.id = ?
          `).get(attendanceId);
        })();

        return send(res, 200, { item: result, updated: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/attendance') {
        const body = await readJson(req);
        const lectureId = parseIntValue(body.lectureId, 0);
        const studentId = String(body.studentId || '').trim();
        const status = String(body.status || 'present').trim();
        if (!lectureId || !studentId) return send(res, 422, { error: 'Lecture and student are required.' });
        if (!VALID_STATUSES.includes(status)) return send(res, 422, { error: 'Invalid attendance status.' });

        const lecture = db.prepare('SELECT * FROM lectures WHERE id = ?').get(lectureId);
        if (!lecture) return send(res, 404, { error: 'Lecture not found.' });

        const student = selectStudent.get(studentId);
        if (!student) return send(res, 404, { error: 'Student not found.' });

        const enrolled = db.prepare('SELECT 1 FROM lecture_enrollments WHERE lecture_id = ? AND student_id = ?').get(lectureId, studentId);
        if (!enrolled) {
          return send(res, 409, { error: 'Student is not enrolled in this lecture.' });
        }

        const existing = db.prepare('SELECT * FROM attendance WHERE lecture_id = ? AND student_id = ?').get(lectureId, studentId);
        if (existing) {
          if (existing.status === status) return send(res, 200, { item: { ...existing, lectureTitle: lecture.title, studentName: student.name, updated: false } });
          const by = getAuthenticatedUser(req);
          const updated = db.transaction(() => {
            db.prepare('UPDATE attendance SET status = ?, marked_at = datetime("now"), marked_by = ?, source = "manual", note = ? WHERE id = ?')
              .run(status, by, 'Attendance update', existing.id);
            db.prepare('INSERT INTO attendance_audit (attendance_id, previous_status, new_status, changed_by, reason) VALUES (?, ?, ?, ?, ?)')
              .run(existing.id, existing.status, status, by, 'Manual update');
            return db.prepare('SELECT * FROM attendance WHERE id = ?').get(existing.id);
          })();
          return send(res, 200, { item: { ...updated, lectureTitle: lecture.title, studentName: student.name, updated: true } });
        }

        const by = getAuthenticatedUser(req);
        const result = db.prepare('INSERT INTO attendance (lecture_id, student_id, status, marked_by, source, note) VALUES (?, ?, ?, ?, "manual", ?)')
          .run(lectureId, studentId, status, by, 'Manual attendance registration');

        return send(res, 201, { item: { id: result.lastInsertRowid, lectureId, studentId, lectureTitle: lecture.title, studentName: student.name, status, markedBy: by, source: 'manual', updated: false } });
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

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
