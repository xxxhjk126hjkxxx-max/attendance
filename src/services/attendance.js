'use strict';

const { notFound, conflict, unprocessable, forbidden } = require('../lib/errors');
const { str, int, dateOnly, minutesOfDay } = require('../lib/validate');

const STATUSES = ['present', 'late', 'excused', 'absent'];
const SOURCES = ['qr', 'manual', 'correction', 'bulk', 'import'];

/**
 * Attendance rules that are enforced on the server:
 *  - a student must be on the lecture roster (course enrollment snapshot),
 *  - the lecture must not be cancelled/completed,
 *  - the attendance window must be open for QR/bulk check-in,
 *  - one record per (lecture, student) — enforced by a unique index too,
 *  - every manual change is audited with the responsible administrator.
 */
function createAttendanceService(db, { audit }) {
  const selectRecord = db.prepare(`
    SELECT a.id, a.lecture_id AS lectureId, a.student_id AS studentId, s.name AS studentName,
           l.title AS lectureTitle, COALESCE(c.name_en, l.course) AS course, l.lecture_date AS lectureDate,
           l.start_time AS startTime, l.end_time AS endTime, a.status, a.marked_at AS markedAt,
           a.marked_by AS markedBy, a.marked_by_id AS markedById, a.source, a.note
    FROM attendance a
    JOIN students s ON s.student_id = a.student_id
    JOIN lectures l ON l.id = a.lecture_id
    LEFT JOIN courses c ON c.id = l.course_id
    WHERE a.id = ?
  `);

  const insert = db.prepare(`
    INSERT INTO attendance (lecture_id, student_id, status, marked_at, marked_by, marked_by_id, source, note, session_id)
    VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
  `);

  const existingFor = db.prepare('SELECT * FROM attendance WHERE lecture_id = ? AND student_id = ?');
  const lectureById = db.prepare(`
    SELECT l.*, s.id AS sessionId, s.closed_at AS sessionClosedAt, s.opens_at AS sessionOpensAt
    FROM lectures l LEFT JOIN attendance_sessions s ON s.lecture_id = l.id WHERE l.id = ?
  `);
  const enrolled = db.prepare('SELECT 1 FROM lecture_enrollments WHERE lecture_id = ? AND student_id = ?');
  const studentById = db.prepare('SELECT student_id AS id, name, course, academic_level AS level, status FROM students WHERE student_id = ?');

  function scopedLectures(user) {
    if (user?.role !== 'instructor') return null;
    return db.prepare(`
      SELECT l.id FROM lectures l LEFT JOIN courses c ON c.id = l.course_id
      WHERE l.instructor_id = ? OR c.instructor_id = ?
    `).all(user.id, user.id).map(row => row.id);
  }

  function assertLectureAccess(user, lecture) {
    if (user?.role !== 'instructor') return;
    const allowed = db.prepare(`
      SELECT 1 FROM lectures l LEFT JOIN courses c ON c.id = l.course_id
      WHERE l.id = ? AND (l.instructor_id = ? OR c.instructor_id = ?)
    `).get(lecture.id, user.id, user.id);
    if (!allowed) throw forbidden('You can only record attendance for lectures assigned to you.');
  }

  /**
   * Suggested status for a check-in: `present` inside the window, `late` when the
   * scan happens after the lecture start plus the grace period.
   */
  function resolveStatus(lecture, now = new Date()) {
    const startMinutes = minutesOfDay(lecture.start_time);
    const localMinutes = now.getHours() * 60 + now.getMinutes();
    const sameDay = lecture.lecture_date === now.toISOString().slice(0, 10);
    if (sameDay && startMinutes !== null && localMinutes > startMinutes + 15) return 'late';
    return 'present';
  }

  function checkWindow(lecture) {
    if (lecture.status === 'cancelled') return 'This lecture has been cancelled; attendance cannot be recorded.';
    const now = new Date();
    const opens = lecture.attendance_opens_at ? new Date(String(lecture.attendance_opens_at).replace(' ', 'T')) : null;
    const closes = lecture.attendance_closes_at ? new Date(String(lecture.attendance_closes_at).replace(' ', 'T')) : null;
    if (opens && now < opens) return `Attendance opens at ${lecture.attendance_opens_at}.`;
    if (closes && now > closes) return `Attendance closed at ${lecture.attendance_closes_at}.`;
    return null;
  }

  function list({ page = 1, pageSize = 20, lectureId = null, courseId = null, date = null, from = null, to = null,
    status = null, source = null, search = '', studentId = null, user = null } = {}) {
    const where = [];
    const params = [];
    if (lectureId) { where.push('a.lecture_id = ?'); params.push(lectureId); }
    if (courseId) { where.push('l.course_id = ?'); params.push(courseId); }
    if (date) { where.push('l.lecture_date = ?'); params.push(date); }
    if (from) { where.push('l.lecture_date >= ?'); params.push(from); }
    if (to) { where.push('l.lecture_date <= ?'); params.push(to); }
    if (status && STATUSES.includes(status)) { where.push('a.status = ?'); params.push(status); }
    if (source) { where.push('a.source = ?'); params.push(source); }
    if (studentId) { where.push('a.student_id = ?'); params.push(studentId); }
    if (search) {
      where.push('(s.name LIKE ? COLLATE NOCASE OR s.student_id LIKE ? COLLATE NOCASE OR l.title LIKE ? COLLATE NOCASE)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (user?.role === 'instructor') {
      where.push('(l.instructor_id = ? OR c.instructor_id = ?)');
      params.push(user.id, user.id);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `
      FROM attendance a
      JOIN students s ON s.student_id = a.student_id
      JOIN lectures l ON l.id = a.lecture_id
      LEFT JOIN courses c ON c.id = l.course_id
      ${clause}
    `;
    const total = db.prepare(`SELECT COUNT(*) AS count ${base}`).get(...params).count;
    const items = db.prepare(`
      SELECT a.id, a.lecture_id AS lectureId, a.student_id AS studentId, s.name AS studentName,
             l.title AS lectureTitle, COALESCE(c.name_en, l.course) AS course, c.code AS courseCode,
             l.lecture_date AS lectureDate, l.start_time AS startTime, a.status, a.marked_at AS markedAt,
             a.marked_by AS markedBy, a.source, a.note
      ${base}
      ORDER BY l.lecture_date DESC, l.start_time DESC, a.marked_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  function markManual({ lectureId, studentId, status, note = '', user, ip }) {
    if (!STATUSES.includes(status)) throw unprocessable('Select a valid attendance status.', { status: 'Invalid status.' });
    const lecture = lectureById.get(lectureId);
    if (!lecture) throw notFound('Lecture not found.');
    assertLectureAccess(user, lecture);
    if (lecture.status === 'cancelled') throw conflict('This lecture was cancelled; attendance cannot be recorded.');
    const student = studentById.get(studentId);
    if (!student) throw notFound('Student not found.');
    if (!enrolled.get(lectureId, studentId)) {
      throw conflict('That student is not enrolled in this lecture.', { studentId: 'Student is not on the lecture roster.' });
    }

    const by = user?.username || 'system';
    const existing = existingFor.get(lectureId, studentId);
    const cleanNote = str(note, { max: 300 }) || null;

    if (existing) {
      if (existing.status === status) {
        return { item: selectRecord.get(existing.id), updated: false, unchanged: true };
      }
      const run = db.transaction(() => {
        db.prepare(`
          UPDATE attendance SET status = ?, marked_at = datetime('now'), marked_by = ?, marked_by_id = ?,
            source = 'correction', note = ? WHERE id = ?
        `).run(status, by, user?.id ?? null, cleanNote || 'Manual correction', existing.id);
        db.prepare(`
          INSERT INTO attendance_audit (attendance_id, previous_status, new_status, changed_by, reason)
          VALUES (?, ?, ?, ?, ?)
        `).run(existing.id, existing.status, status, by, cleanNote || 'Manual correction');
        return selectRecord.get(existing.id);
      });
      const item = run();
      audit.record({ actor: user, action: 'attendance.corrected', entityType: 'attendance', entityId: existing.id, details: { from: existing.status, to: status, note: cleanNote }, ip });
      return { item, updated: true, unchanged: false };
    }

    const info = insert.run(lectureId, studentId, status, by, user?.id ?? null, 'manual', cleanNote, lecture.sessionId ?? null);
    audit.record({ actor: user, action: 'attendance.marked', entityType: 'attendance', entityId: Number(info.lastInsertRowid), details: { lectureId, studentId, status, source: 'manual' }, ip });
    return { item: selectRecord.get(Number(info.lastInsertRowid)), updated: false, unchanged: false };
  }

  /** Bulk marking for a whole lecture roster. Unknown students are skipped. */
  function markBulk({ lectureId, entries, user, ip }) {
    const lecture = lectureById.get(lectureId);
    if (!lecture) throw notFound('Lecture not found.');
    assertLectureAccess(user, lecture);
    if (lecture.status === 'cancelled') throw conflict('This lecture was cancelled; attendance cannot be recorded.');
    if (!Array.isArray(entries) || entries.length === 0) throw unprocessable('Provide at least one attendance entry.');
    if (entries.length > 1000) throw unprocessable('Too many entries in one request (maximum 1000).');

    const by = user?.username || 'system';
    const results = { created: 0, updated: 0, skipped: [], unchanged: 0 };

    const run = db.transaction(() => {
      for (const entry of entries) {
        const studentId = str(entry.studentId, { max: 40 });
        const status = str(entry.status, { max: 12 });
        if (!studentId || !STATUSES.includes(status)) { results.skipped.push({ studentId, reason: 'invalid' }); continue; }
        if (!studentById.get(studentId) || !enrolled.get(lectureId, studentId)) {
          results.skipped.push({ studentId, reason: 'not_enrolled' });
          continue;
        }
        const existing = existingFor.get(lectureId, studentId);
        const note = str(entry.note, { max: 300 }) || null;
        if (!existing) {
          insert.run(lectureId, studentId, status, by, user?.id ?? null, 'bulk', note, lecture.sessionId ?? null);
          results.created += 1;
          continue;
        }
        if (existing.status === status) { results.unchanged += 1; continue; }
        db.prepare(`
          UPDATE attendance SET status = ?, marked_at = datetime('now'), marked_by = ?, marked_by_id = ?,
            source = 'correction', note = ? WHERE id = ?
        `).run(status, by, user?.id ?? null, note || 'Bulk correction', existing.id);
        db.prepare(`
          INSERT INTO attendance_audit (attendance_id, previous_status, new_status, changed_by, reason)
          VALUES (?, ?, ?, ?, ?)
        `).run(existing.id, existing.status, status, by, note || 'Bulk correction');
        results.updated += 1;
      }
    });
    run();
    audit.record({ actor: user, action: 'attendance.bulk_marked', entityType: 'lecture', entityId: lectureId, details: results, ip });
    return results;
  }

  /** QR check-in. The token is resolved server-side; nothing is trusted from the client. */
  function scan({ qr, lectureId, user, ip }) {
    if (!qr || qr.v !== 1 || typeof qr.token !== 'string' || qr.token.length < 20 || qr.token.length > 120) {
      throw unprocessable('This QR code is not a valid university attendance code.');
    }
    const lecture = lectureById.get(lectureId);
    if (!lecture) throw notFound('Lecture not found.');
    assertLectureAccess(user, lecture);

    const student = db.prepare(`
      SELECT student_id AS id, name, course, academic_level AS level, status
      FROM students WHERE qr_token = ? AND (qr_revoked_at IS NULL OR qr_revoked_at = '')
    `).get(qr.token);
    if (!student) throw notFound('QR code is invalid, revoked, or not registered.');
    if (student.status && student.status !== 'active') {
      throw forbidden('This student record is not active. Attendance cannot be recorded.');
    }
    if (!enrolled.get(lecture.id, student.id)) {
      throw conflict('Student is not enrolled in this lecture.', { studentId: student.id });
    }

    const windowError = checkWindow(lecture);
    if (windowError) throw conflict(windowError);

    const existing = existingFor.get(lecture.id, student.id);
    if (existing) {
      return {
        duplicate: true,
        message: `Attendance already recorded for ${student.name}.`,
        item: selectRecord.get(existing.id)
      };
    }

    const status = resolveStatus(lecture);
    const by = user?.username || 'system';
    const info = insert.run(lecture.id, student.id, status, by, user?.id ?? null, 'qr', 'Scanned QR attendance', lecture.sessionId ?? null);
    audit.record({ actor: user, action: 'attendance.scanned', entityType: 'attendance', entityId: Number(info.lastInsertRowid), details: { lectureId: lecture.id, studentId: student.id, status }, ip });
    return { duplicate: false, item: selectRecord.get(Number(info.lastInsertRowid)), student };
  }

  function correct(id, { status, reason, user, ip }) {
    if (!STATUSES.includes(status)) throw unprocessable('Select a valid attendance status.');
    const existing = db.prepare(`
      SELECT a.*, l.instructor_id AS lectureInstructor, c.instructor_id AS courseInstructor
      FROM attendance a JOIN lectures l ON l.id = a.lecture_id
      LEFT JOIN courses c ON c.id = l.course_id WHERE a.id = ?
    `).get(id);
    if (!existing) throw notFound('Attendance record not found.');
    if (user?.role === 'instructor' && ![existing.lectureInstructor, existing.courseInstructor].includes(user.id)) {
      throw forbidden('You can only correct attendance for lectures assigned to you.');
    }
    const cleanReason = str(reason, { max: 300 }) || 'Authorized correction';
    if (existing.status === status) return { item: selectRecord.get(id), updated: false };

    const by = user?.username || 'system';
    const run = db.transaction(() => {
      db.prepare(`
        UPDATE attendance SET status = ?, marked_at = datetime('now'), marked_by = ?, marked_by_id = ?,
          source = 'correction', note = ? WHERE id = ?
      `).run(status, by, user?.id ?? null, cleanReason, id);
      db.prepare(`
        INSERT INTO attendance_audit (attendance_id, previous_status, new_status, changed_by, reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, existing.status, status, by, cleanReason);
    });
    run();
    audit.record({ actor: user, action: 'attendance.corrected', entityType: 'attendance', entityId: id, details: { from: existing.status, to: status, reason: cleanReason }, ip });
    return { item: selectRecord.get(id), updated: true };
  }

  function remove(id, user, { ip }) {
    const existing = selectRecord.get(id);
    if (!existing) throw notFound('Attendance record not found.');
    db.prepare('DELETE FROM attendance WHERE id = ?').run(id);
    audit.record({ actor: user, action: 'attendance.deleted', entityType: 'attendance', entityId: id, details: existing, ip });
    return { deleted: id };
  }

  function auditTrail({ attendanceId = null, lectureId = null, page = 1, pageSize = 25 }) {
    const where = [];
    const params = [];
    if (attendanceId) { where.push('aa.attendance_id = ?'); params.push(attendanceId); }
    if (lectureId) { where.push('a.lecture_id = ?'); params.push(lectureId); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`
      SELECT COUNT(*) AS count FROM attendance_audit aa
      JOIN attendance a ON a.id = aa.attendance_id ${clause}
    `).get(...params).count;
    const items = db.prepare(`
      SELECT aa.id, aa.attendance_id AS attendanceId, aa.previous_status AS previousStatus,
             aa.new_status AS newStatus, aa.changed_by AS changedBy, aa.changed_at AS changedAt, aa.reason,
             a.student_id AS studentId, s.name AS studentName, l.title AS lectureTitle, l.lecture_date AS lectureDate
      FROM attendance_audit aa
      JOIN attendance a ON a.id = aa.attendance_id
      JOIN students s ON s.student_id = a.student_id
      JOIN lectures l ON l.id = a.lecture_id
      ${clause}
      ORDER BY aa.changed_at DESC, aa.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * Auto-fills `absent` for an open lecture's unmarked roster. Absence is never
   * inferred for lectures the student was not enrolled in.
   */
  function finalizeLecture(lectureId, user, { ip } = {}) {
    const lecture = lectureById.get(lectureId);
    if (!lecture) throw notFound('Lecture not found.');
    assertLectureAccess(user, lecture);
    const roster = db.prepare(`
      SELECT student_id FROM lecture_enrollments le
      WHERE le.lecture_id = ? AND NOT EXISTS (
        SELECT 1 FROM attendance a WHERE a.lecture_id = le.lecture_id AND a.student_id = le.student_id
      )
    `).all(lectureId);
    const by = user?.username || 'system';
    const run = db.transaction(() => {
      for (const row of roster) {
        insert.run(lectureId, row.student_id, 'absent', by, user?.id ?? null, 'bulk', 'Marked absent at lecture finalization', lecture.sessionId ?? null);
      }
      db.prepare("UPDATE attendance_sessions SET closed_at = datetime('now') WHERE lecture_id = ?").run(lectureId);
      db.prepare("UPDATE lectures SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(lectureId);
    });
    run();
    audit.record({ actor: user, action: 'attendance.finalized', entityType: 'lecture', entityId: lectureId, details: { markedAbsent: roster.length }, ip });
    return { markedAbsent: roster.length, lectureId };
  }

  return {
    list, markManual, markBulk, scan, correct, remove, auditTrail, finalizeLecture,
    STATUSES, SOURCES, resolveStatus, checkWindow, lectureById, enrolled, studentById
  };
}

module.exports = { createAttendanceService, STATUSES };
