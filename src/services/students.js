'use strict';

const crypto = require('node:crypto');
const { AppError, notFound, conflict, unprocessable } = require('../lib/errors');
const { str, email, phone, int } = require('../lib/validate');

const ID_RE = /^[\p{L}\p{N}._/-]+$/u;
const STUDENT_STATUSES = ['active', 'suspended', 'graduated', 'withdrawn'];

function createStudentService(db, { audit }) {
  const newQrToken = () => crypto.randomBytes(32).toString('base64url');

  const selectOne = db.prepare(`
    SELECT s.student_id AS id, s.name, s.course, s.academic_level AS level,
           s.email, s.phone, s.status, s.qr_token AS qrToken, s.qr_revoked_at AS qrRevokedAt,
           s.created_at AS createdAt, s.updated_at AS updatedAt
    FROM students s WHERE s.student_id = ?
  `);

  const publicStudent = row => row && {
    id: row.id,
    name: row.name,
    course: row.course,
    level: row.level,
    email: row.email,
    phone: row.phone,
    status: row.status || 'active',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };

  function normalize(input, { create = false, existingId = null } = {}) {
    const errors = {};
    const id = str(existingId ?? input.id, { max: 40 });
    const name = str(input.name, { max: 100 });
    const course = str(input.course, { max: 100 });
    const level = str(input.level, { max: 60 });

    if ((create || existingId === null) && (!id || !ID_RE.test(id))) {
      errors.id = 'Enter a valid student ID (up to 40 letters, numbers, or . _ / -).';
    }
    if (!name) errors.name = 'Full name is required.';
    if (!level) errors.level = 'Academic level is required.';

    let emailValue = null;
    let phoneValue = null;
    try { emailValue = email(input.email); } catch (error) { errors.email = error.fields?.email || error.message; }
    try { phoneValue = phone(input.phone); } catch (error) { errors.phone = error.fields?.phone || error.message; }

    const status = STUDENT_STATUSES.includes(input.status) ? input.status : 'active';

    if (Object.keys(errors).length) throw unprocessable('Please correct the highlighted fields.', errors);

    return { id, name, course, level, email: emailValue, phone: phoneValue, status };
  }

  function list({ page = 1, pageSize = 10, search = '', course = '', level = '', status = '', sort = 'name', dir = 'asc', courseId = null } = {}) {
    const where = [];
    const params = [];
    const term = str(search, { max: 100 });
    if (term) {
      where.push('(s.name LIKE ? COLLATE NOCASE OR s.student_id LIKE ? COLLATE NOCASE OR s.email LIKE ? COLLATE NOCASE)');
      params.push(`%${term}%`, `%${term}%`, `%${term}%`);
    }
    if (course) { where.push('s.course = ?'); params.push(str(course, { max: 100 })); }
    if (level) { where.push('s.academic_level = ?'); params.push(str(level, { max: 60 })); }
    if (status) { where.push('COALESCE(s.status, \'active\') = ?'); params.push(status); }
    if (courseId) {
      where.push('EXISTS (SELECT 1 FROM course_enrollments ce WHERE ce.course_id = ? AND ce.student_id = s.student_id)');
      params.push(courseId);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortMap = { name: 's.name COLLATE NOCASE', id: 's.student_id', level: 's.academic_level', created: 's.created_at' };
    const orderBy = sortMap[sort] || sortMap.name;
    const direction = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const total = db.prepare(`SELECT COUNT(*) AS count FROM students s ${clause}`).get(...params).count;
    const items = db.prepare(`
      SELECT s.student_id AS id, s.name, s.course, s.academic_level AS level, s.email, s.phone,
             COALESCE(s.status,'active') AS status, s.created_at AS createdAt, s.updated_at AS updatedAt,
             (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.student_id = s.student_id AND ce.status = 'enrolled') AS courseCount,
             (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.student_id) AS attendanceCount
      FROM students s ${clause}
      ORDER BY ${orderBy} ${direction}, s.student_id
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);

    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filters: filterOptions()
    };
  }

  function filterOptions() {
    const courses = db.prepare('SELECT DISTINCT course FROM students WHERE course <> \'\' ORDER BY course COLLATE NOCASE').all().map(r => r.course);
    const levels = db.prepare('SELECT DISTINCT academic_level AS level FROM students ORDER BY academic_level COLLATE NOCASE').all().map(r => r.level);
    return { courses, levels, statuses: STUDENT_STATUSES };
  }

  function get(id) {
    const student = publicStudent(selectOne.get(id));
    if (!student) throw notFound('Student not found.');
    return student;
  }

  function create(input, actor, { ip } = {}) {
    const data = normalize(input, { create: true });
    if (selectOne.get(data.id)) {
      throw conflict('That student ID is already registered.', { id: 'Student ID must be unique.' });
    }
    try {
      const run = db.transaction(() => {
        db.prepare(`
          INSERT INTO students (student_id, name, course, academic_level, email, phone, status, qr_token)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(data.id, data.name, data.course, data.level, data.email, data.phone, data.status, newQrToken());

        // Keep the legacy text course and the relational course table in sync.
        if (data.course) {
          const course = db.prepare('SELECT id FROM courses WHERE lower(name_en) = lower(?) OR lower(code) = lower(?)').get(data.course, data.course);
          if (course) {
            db.prepare('INSERT OR IGNORE INTO course_enrollments (course_id, student_id) VALUES (?, ?)').run(course.id, data.id);
          }
        }
      });
      run();
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw conflict('That student ID is already registered.', { id: 'Student ID must be unique.' });
      }
      throw error;
    }
    audit.record({ actor, action: 'students.created', entityType: 'student', entityId: data.id, details: { name: data.name, course: data.course }, ip });
    return get(data.id);
  }

  function update(id, input, actor, { ip } = {}) {
    const existing = selectOne.get(id);
    if (!existing) throw notFound('Student not found.');
    const data = normalize(input, { create: false, existingId: id });
    db.prepare(`
      UPDATE students SET name = ?, course = ?, academic_level = ?, email = ?, phone = ?, status = ?,
        updated_at = datetime('now')
      WHERE student_id = ?
    `).run(data.name, data.course, data.level, data.email, data.phone, data.status, id);
    audit.record({
      actor,
      action: 'students.updated',
      entityType: 'student',
      entityId: id,
      details: { before: publicStudent(existing), after: data },
      ip
    });
    return get(id);
  }

  function remove(id, actor, { ip } = {}) {
    const existing = selectOne.get(id);
    if (!existing) throw notFound('Student not found.');
    const counts = db.prepare(`
      SELECT (SELECT COUNT(*) FROM attendance WHERE student_id = ?) AS attendance,
             (SELECT COUNT(*) FROM course_enrollments WHERE student_id = ?) AS enrollments
    `).get(id, id);
    // Attendance history must survive: only the roster entries are removed.
    db.prepare('DELETE FROM students WHERE student_id = ?').run(id);
    audit.record({
      actor,
      action: 'students.deleted',
      entityType: 'student',
      entityId: id,
      details: { name: existing.name, attendanceRecordsRemoved: counts.attendance, enrollmentsRemoved: counts.enrollments },
      ip
    });
    return { deleted: id };
  }

  function attendanceHistory(id, { limit = 200 } = {}) {
    const student = get(id);
    const history = db.prepare(`
      SELECT a.id, a.lecture_id AS lectureId, l.title AS lectureTitle,
             COALESCE(c.name_en, l.course) AS course, l.lecture_date AS lectureDate,
             l.start_time AS startTime, a.status, a.marked_at AS markedAt, a.marked_by AS markedBy,
             a.source, a.note
      FROM attendance a
      JOIN lectures l ON l.id = a.lecture_id
      LEFT JOIN courses c ON c.id = l.course_id
      WHERE a.student_id = ?
      ORDER BY l.lecture_date DESC, l.start_time DESC, a.id DESC
      LIMIT ?
    `).all(id, limit);

    const totals = db.prepare(`
      SELECT COUNT(*) AS marked,
             SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late,
             SUM(CASE WHEN status = 'excused' THEN 1 ELSE 0 END) AS excused,
             SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent
      FROM attendance WHERE student_id = ?
    `).get(id);

    const enrolledLectures = db.prepare(`
      SELECT COUNT(*) AS count FROM lecture_enrollments le
      JOIN lectures l ON l.id = le.lecture_id
      WHERE le.student_id = ? AND l.lecture_date <= date('now')
    `).get(id).count;

    const courses = db.prepare(`
      SELECT c.id, c.code, c.name_en AS nameEn, c.name_ar AS nameAr, ce.status, ce.enrolled_at AS enrolledAt
      FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id
      WHERE ce.student_id = ?
      ORDER BY c.code
    `).all(id);

    const attended = (totals.present || 0) + (totals.late || 0);
    return {
      student,
      history,
      courses,
      summary: {
        marked: totals.marked || 0,
        present: totals.present || 0,
        late: totals.late || 0,
        excused: totals.excused || 0,
        absent: totals.absent || 0,
        enrolledLectures,
        // Absence is measured only against lectures the student was enrolled in.
        attendanceRate: enrolledLectures ? Math.round((attended / enrolledLectures) * 1000) / 10 : null
      }
    };
  }

  function qrCard(id) {
    const row = selectOne.get(id);
    if (!row) throw notFound('Student not found.');
    const active = !row.qrRevokedAt;
    return {
      item: {
        id: row.id,
        name: row.name,
        course: row.course,
        level: row.level,
        revokedAt: row.qrRevokedAt,
        qr: active && row.qrToken ? { v: 1, token: row.qrToken } : null
      }
    };
  }

  function qrCards({ search = '', course = '', level = '' } = {}) {
    const where = [];
    const params = [];
    if (search) {
      where.push('(name LIKE ? COLLATE NOCASE OR student_id LIKE ? COLLATE NOCASE)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (course) { where.push('course = ?'); params.push(course); }
    if (level) { where.push('academic_level = ?'); params.push(level); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT student_id AS id, name, course, academic_level AS level,
             qr_token AS token, qr_revoked_at AS revokedAt
      FROM students ${clause}
      ORDER BY name COLLATE NOCASE, student_id
    `).all(...params);
    return {
      items: rows.map(row => ({
        id: row.id,
        name: row.name,
        course: row.course,
        level: row.level,
        revokedAt: row.revokedAt,
        qr: !row.revokedAt && row.token ? { v: 1, token: row.token } : null
      }))
    };
  }

  function rotateQr(id, actor, { ip } = {}) {
    const row = selectOne.get(id);
    if (!row) throw notFound('Student not found.');
    const token = newQrToken();
    db.prepare("UPDATE students SET qr_token = ?, qr_revoked_at = NULL, updated_at = datetime('now') WHERE student_id = ?").run(token, id);
    audit.record({ actor, action: 'qr.rotated', entityType: 'student', entityId: id, ip });
    return { item: { id, qr: { v: 1, token } } };
  }

  function revokeQr(id, actor, { ip } = {}) {
    const row = selectOne.get(id);
    if (!row) throw notFound('Student not found.');
    if (row.qrRevokedAt) throw conflict('QR code is already revoked.');
    db.prepare("UPDATE students SET qr_revoked_at = datetime('now'), updated_at = datetime('now') WHERE student_id = ?").run(id);
    audit.record({ actor, action: 'qr.revoked', entityType: 'student', entityId: id, ip });
    return { revoked: true, id };
  }

  function backfillQrTokens() {
    const rows = db.prepare('SELECT student_id FROM students WHERE qr_token IS NULL').all();
    const update = db.prepare('UPDATE students SET qr_token = ? WHERE student_id = ?');
    const run = db.transaction(() => rows.forEach(row => update.run(newQrToken(), row.student_id)));
    run();
    return rows.length;
  }

  return {
    list, get, create, update, remove, attendanceHistory,
    qrCard, qrCards, rotateQr, revokeQr, backfillQrTokens, filterOptions,
    publicStudent, STUDENT_STATUSES
  };
}

module.exports = { createStudentService, STUDENT_STATUSES };
