'use strict';

const { notFound, conflict, unprocessable } = require('../lib/errors');
const { str, int, dateOnly, timeOnly, minutesOfDay } = require('../lib/validate');

function createCourseService(db, { audit }) {
  const selectCourse = db.prepare(`
    SELECT c.id, c.code, c.name_en AS nameEn, c.name_ar AS nameAr, c.department,
           c.academic_level AS academicLevel, c.credit_hours AS creditHours,
           c.instructor_id AS instructorId, u.full_name AS instructorName,
           c.archived_at AS archivedAt, c.created_at AS createdAt, c.updated_at AS updatedAt,
           (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.status = 'enrolled') AS studentCount,
           (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id) AS lectureCount
    FROM courses c LEFT JOIN users u ON u.id = c.instructor_id
    WHERE c.id = ?
  `);

  function list({ search = '', includeArchived = false, instructorId = null } = {}) {
    const where = [];
    const params = [];
    if (!includeArchived) where.push('c.archived_at IS NULL');
    if (search) {
      where.push('(c.code LIKE ? COLLATE NOCASE OR c.name_en LIKE ? COLLATE NOCASE OR c.name_ar LIKE ? COLLATE NOCASE)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (instructorId) {
      where.push('(c.instructor_id = ? OR EXISTS (SELECT 1 FROM lectures l WHERE l.course_id = c.id AND l.instructor_id = ?))');
      params.push(instructorId, instructorId);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(`
      SELECT c.id, c.code, c.name_en AS nameEn, c.name_ar AS nameAr, c.department,
             c.academic_level AS academicLevel, c.credit_hours AS creditHours,
             c.instructor_id AS instructorId, u.full_name AS instructorName,
             c.archived_at AS archivedAt, c.created_at AS createdAt,
             (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.status = 'enrolled') AS studentCount,
             (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id) AS lectureCount
      FROM courses c LEFT JOIN users u ON u.id = c.instructor_id
      ${clause}
      ORDER BY c.code COLLATE NOCASE
    `).all(...params);
  }

  function get(id) {
    const course = selectCourse.get(id);
    if (!course) throw notFound('Course not found.');
    const students = db.prepare(`
      SELECT s.student_id AS id, s.name, s.academic_level AS level, ce.status, ce.enrolled_at AS enrolledAt
      FROM course_enrollments ce JOIN students s ON s.student_id = ce.student_id
      WHERE ce.course_id = ? ORDER BY s.name COLLATE NOCASE
    `).all(id);
    const lectures = db.prepare(`
      SELECT l.id, l.title, l.lecture_date AS lectureDate, l.start_time AS startTime,
             l.end_time AS endTime, l.status,
             (SELECT COUNT(*) FROM attendance a WHERE a.lecture_id = l.id) AS marked
      FROM lectures l WHERE l.course_id = ? ORDER BY l.lecture_date DESC, l.start_time DESC
    `).all(id);
    return { ...course, students, lectures };
  }

  function normalize(input, { partial = false } = {}) {
    const errors = {};
    const code = str(input.code, { max: 24 }).toUpperCase();
    const nameEn = str(input.nameEn ?? input.name_en ?? input.name, { max: 120 });
    const nameAr = str(input.nameAr ?? input.name_ar, { max: 120 }) || null;
    const department = str(input.department, { max: 120 }) || null;
    const academicLevel = str(input.academicLevel ?? input.level, { max: 60 }) || null;
    const creditHours = int(input.creditHours, { min: 1, max: 20, fallback: 3 });
    const instructorId = input.instructorId ? int(input.instructorId, { min: 1 }) : null;

    if (!code || !/^[A-Z0-9-]{2,24}$/.test(code)) errors.code = 'Course code must be 2–24 letters, numbers, or dashes.';
    if (!nameEn) errors.nameEn = 'English course name is required.';
    if (instructorId && !db.prepare("SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.key IN ('instructor','admin','super_admin')").get(instructorId)) {
      errors.instructorId = 'Select a valid instructor.';
    }
    if (Object.keys(errors).length) throw unprocessable('Please correct the highlighted fields.', errors);
    return { code, nameEn, nameAr, department, academicLevel, creditHours, instructorId, partial };
  }

  function create(input, actor, { ip } = {}) {
    const data = normalize(input);
    if (db.prepare('SELECT 1 FROM courses WHERE code = ?').get(data.code)) {
      throw conflict('A course with that code already exists.', { code: 'Course code must be unique.' });
    }
    const info = db.prepare(`
      INSERT INTO courses (code, name_en, name_ar, department, academic_level, credit_hours, instructor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(data.code, data.nameEn, data.nameAr, data.department, data.academicLevel, data.creditHours, data.instructorId);
    audit.record({ actor, action: 'courses.created', entityType: 'course', entityId: info.lastInsertRowid, details: { code: data.code, nameEn: data.nameEn }, ip });
    return selectCourse.get(info.lastInsertRowid);
  }

  function update(id, input, actor, { ip } = {}) {
    const existing = selectCourse.get(id);
    if (!existing) throw notFound('Course not found.');
    const data = normalize(input, { partial: true });
    if (data.code !== existing.code && db.prepare('SELECT 1 FROM courses WHERE code = ? AND id <> ?').get(data.code, id)) {
      throw conflict('A course with that code already exists.', { code: 'Course code must be unique.' });
    }
    // Historical attendance rows keep their own lecture snapshot, so renaming a
    // course never rewrites past records.
    db.prepare(`
      UPDATE courses SET code = ?, name_en = ?, name_ar = ?, department = ?, academic_level = ?,
        credit_hours = ?, instructor_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(data.code, data.nameEn, data.nameAr, data.department, data.academicLevel, data.creditHours, data.instructorId, id);
    audit.record({ actor, action: 'courses.updated', entityType: 'course', entityId: id, details: { code: data.code, nameEn: data.nameEn }, ip });
    return selectCourse.get(id);
  }

  function archive(id, archived, actor, { ip } = {}) {
    const existing = selectCourse.get(id);
    if (!existing) throw notFound('Course not found.');
    db.prepare("UPDATE courses SET archived_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(archived ? new Date().toISOString() : null, id);
    audit.record({ actor, action: archived ? 'courses.archived' : 'courses.restored', entityType: 'course', entityId: id, ip });
    return selectCourse.get(id);
  }

  function remove(id, actor, { ip } = {}) {
    const existing = selectCourse.get(id);
    if (!existing) throw notFound('Course not found.');
    const lectureCount = db.prepare('SELECT COUNT(*) AS count FROM lectures WHERE course_id = ?').get(id).count;
    // Courses with historical lectures are archived instead of destroyed so that
    // attendance history stays intact.
    if (lectureCount > 0) {
      db.prepare("UPDATE courses SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
      audit.record({ actor, action: 'courses.archived_on_delete', entityType: 'course', entityId: id, details: { lectureCount }, ip });
      return { archived: true, id, lectureCount };
    }
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
    audit.record({ actor, action: 'courses.deleted', entityType: 'course', entityId: id, details: { code: existing.code }, ip });
    return { deleted: id };
  }

  function enroll(courseId, studentIds, actor, { ip } = {}) {
    const course = db.prepare('SELECT id, name_en FROM courses WHERE id = ?').get(courseId);
    if (!course) throw notFound('Course not found.');
    const ids = (Array.isArray(studentIds) ? studentIds : [studentIds])
      .map(value => str(value, { max: 40 })).filter(Boolean);
    if (!ids.length) throw unprocessable('Select at least one student.', { studentIds: 'No students selected.' });

    const insert = db.prepare("INSERT OR IGNORE INTO course_enrollments (course_id, student_id) VALUES (?, ?)");
    const syncStudent = db.prepare('UPDATE students SET course = ? WHERE student_id = ? AND (course IS NULL OR course = \'\')');
    const addToLecture = db.prepare(`
      INSERT OR IGNORE INTO lecture_enrollments (lecture_id, student_id)
      SELECT id, ? FROM lectures WHERE course_id = ?
    `);
    const addToRoster = db.prepare(`
      INSERT OR IGNORE INTO lecture_students (lecture_id, student_id)
      SELECT id, ? FROM lectures WHERE course_id = ?
    `);
    const missing = [];
    let enrolled = 0;
    const run = db.transaction(() => {
      for (const studentId of ids) {
        const student = db.prepare('SELECT student_id FROM students WHERE student_id = ?').get(studentId);
        if (!student) { missing.push(studentId); continue; }
        enrolled += insert.run(courseId, studentId).changes;
        syncStudent.run(course.name_en, studentId);
        addToLecture.run(studentId, courseId);
        addToRoster.run(studentId, courseId);
      }
    });
    run();
    audit.record({ actor, action: 'courses.enrolled', entityType: 'course', entityId: courseId, details: { enrolled, studentIds: ids.slice(0, 200) }, ip });
    return { enrolled, courseId, missing, total: db.prepare("SELECT COUNT(*) AS count FROM course_enrollments WHERE course_id = ? AND status = 'enrolled'").get(courseId).count };
  }

  function unenroll(courseId, studentId, actor, { ip } = {}) {
    const result = db.prepare('DELETE FROM course_enrollments WHERE course_id = ? AND student_id = ?').run(courseId, studentId);
    if (!result.changes) throw notFound('That student is not enrolled in this course.');
    audit.record({ actor, action: 'courses.unenrolled', entityType: 'course', entityId: courseId, details: { studentId }, ip });
    return { removed: studentId };
  }

  return { list, get, create, update, archive, remove, enroll, unenroll, selectCourse, normalize };
}

function createLectureService(db, { audit }) {
  const selectLecture = db.prepare(`
    SELECT l.id, l.course_id AS courseId, COALESCE(c.name_en, l.course) AS course,
           c.code AS courseCode, l.title, l.lecture_date AS lectureDate,
           l.start_time AS startTime, l.end_time AS endTime, l.room,
           l.attendance_opens_at AS attendanceOpensAt, l.attendance_closes_at AS attendanceClosesAt,
           l.instructor_id AS instructorId, u.full_name AS instructorName,
           l.status, l.created_by AS createdBy, l.created_at AS createdAt,
           s.id AS sessionId, s.method AS sessionMethod, s.opened_at AS sessionOpenedAt, s.closed_at AS sessionClosedAt,
           (SELECT COUNT(*) FROM lecture_enrollments le WHERE le.lecture_id = l.id) AS enrolledCount,
           (SELECT COUNT(*) FROM attendance a WHERE a.lecture_id = l.id) AS markedCount
    FROM lectures l
    LEFT JOIN courses c ON c.id = l.course_id
    LEFT JOIN users u ON u.id = l.instructor_id
    LEFT JOIN attendance_sessions s ON s.lecture_id = l.id
    WHERE l.id = ?
  `);

  const CHECKIN_GRACE_MINUTES = 15;

  function buildWindow({ lectureDate, startTime, endTime, attendanceOpensAt, attendanceClosesAt }) {
    const baseDate = lectureDate;
    const openDefault = `${baseDate} ${startTime}:00`;
    const closeDefault = `${baseDate} ${endTime}:00`;
    const opens = attendanceOpensAt ? String(attendanceOpensAt).replace('T', ' ').slice(0, 19) : openDefault;
    const closes = attendanceClosesAt ? String(attendanceClosesAt).replace('T', ' ').slice(0, 19) : closeDefault;
    return { opens, closes };
  }

  function list({ courseId = null, date = null, from = null, to = null, instructorId = null, status = '', search = '' } = {}) {
    const where = [];
    const params = [];
    if (courseId) { where.push('l.course_id = ?'); params.push(courseId); }
    if (date) { where.push('l.lecture_date = ?'); params.push(date); }
    if (from) { where.push('l.lecture_date >= ?'); params.push(from); }
    if (to) { where.push('l.lecture_date <= ?'); params.push(to); }
    if (instructorId) { where.push('l.instructor_id = ?'); params.push(instructorId); }
    if (status) { where.push('l.status = ?'); params.push(status); }
    if (search) {
      where.push('(l.title LIKE ? COLLATE NOCASE OR COALESCE(c.name_en, l.course) LIKE ? COLLATE NOCASE OR c.code LIKE ? COLLATE NOCASE)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(`
      SELECT l.id, l.course_id AS courseId, COALESCE(c.name_en, l.course) AS course, c.code AS courseCode,
             l.title, l.lecture_date AS lectureDate, l.start_time AS startTime, l.end_time AS endTime,
             l.room, l.attendance_opens_at AS attendanceOpensAt, l.attendance_closes_at AS attendanceClosesAt,
             l.instructor_id AS instructorId, u.full_name AS instructorName, l.status,
             (SELECT COUNT(*) FROM lecture_enrollments le WHERE le.lecture_id = l.id) AS enrolledCount,
             (SELECT COUNT(*) FROM attendance a WHERE a.lecture_id = l.id) AS markedCount,
             (SELECT COUNT(*) FROM attendance a WHERE a.lecture_id = l.id AND a.status IN ('present','late')) AS attendedCount
      FROM lectures l
      LEFT JOIN courses c ON c.id = l.course_id
      LEFT JOIN users u ON u.id = l.instructor_id
      ${clause}
      ORDER BY l.lecture_date DESC, l.start_time DESC
      LIMIT 500
    `).all(...params);
  }

  function get(id) {
    const lecture = selectLecture.get(id);
    if (!lecture) throw notFound('Lecture not found.');
    const roster = db.prepare(`
      SELECT s.student_id AS id, s.name, s.academic_level AS level, s.course AS programCourse,
             a.id AS attendanceId, a.status, a.marked_at AS markedAt, a.source, a.marked_by AS markedBy
      FROM lecture_enrollments le
      JOIN students s ON s.student_id = le.student_id
      LEFT JOIN attendance a ON a.lecture_id = le.lecture_id AND a.student_id = le.student_id
      WHERE le.lecture_id = ?
      ORDER BY s.name COLLATE NOCASE
    `).all(id);
    return { lecture, roster, summary: summarize(lecture, roster) };
  }

  function summarize(lecture, roster) {
    const counts = { present: 0, late: 0, excused: 0, absent: 0, unmarked: 0 };
    for (const row of roster) {
      if (!row.status) counts.unmarked += 1;
      else counts[row.status] = (counts[row.status] || 0) + 1;
    }
    return {
      lectureId: lecture.id,
      enrolled: roster.length,
      marked: roster.length - counts.unmarked,
      ...counts,
      attendanceRate: roster.length ? Math.round(((counts.present + counts.late) / roster.length) * 1000) / 10 : 0
    };
  }

  function normalize(input) {
    const errors = {};
    const courseId = int(input.courseId, { min: 1 });
    const title = str(input.title, { max: 140 });
    const lectureDate = dateOnly(input.lectureDate ?? input.date);
    const startTime = timeOnly(input.startTime);
    const endTime = timeOnly(input.endTime);
    const room = str(input.room, { max: 60 }) || null;
    const instructorId = input.instructorId ? int(input.instructorId, { min: 1 }) : null;
    const attendanceOpensAt = str(input.attendanceOpensAt, { max: 25 }) || null;
    const attendanceClosesAt = str(input.attendanceClosesAt, { max: 25 }) || null;

    if (!courseId || !db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) errors.courseId = 'Select a valid course.';
    if (!title) errors.title = 'Lecture title is required.';
    if (!lectureDate) errors.lectureDate = 'Enter a valid lecture date.';
    if (!startTime) errors.startTime = 'Enter a valid start time (HH:MM).';
    if (!endTime) errors.endTime = 'Enter a valid end time (HH:MM).';
    if (startTime && endTime && minutesOfDay(endTime) <= minutesOfDay(startTime)) {
      errors.endTime = 'End time must be after the start time.';
    }
    if (instructorId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active'").get(instructorId)) {
      errors.instructorId = 'Select a valid instructor.';
    }
    if (attendanceOpensAt && attendanceClosesAt && attendanceOpensAt >= attendanceClosesAt) {
      errors.attendanceClosesAt = 'The attendance window must close after it opens.';
    }
    if (Object.keys(errors).length) throw unprocessable('Please correct the highlighted fields.', errors);
    return { courseId, title, lectureDate, startTime, endTime, room, instructorId, attendanceOpensAt, attendanceClosesAt };
  }

  function create(input, actor, { ip } = {}) {
    const data = normalize(input);
    const course = db.prepare('SELECT id, name_en FROM courses WHERE id = ?').get(data.courseId);
    if (course.archived_at) throw unprocessable('This course is archived. Restore it before scheduling new lectures.');
    const window = buildWindow(data);

    try {
      const run = db.transaction(() => {
        const info = db.prepare(`
          INSERT INTO lectures (course, course_id, title, lecture_date, start_time, end_time, room,
                                instructor_id, attendance_opens_at, attendance_closes_at, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(course.name_en, data.courseId, data.title, data.lectureDate, data.startTime, data.endTime,
          data.room, data.instructorId, window.opens, window.closes, actor?.username || 'system');

        const lectureId = Number(info.lastInsertRowid);
        db.prepare(`
          INSERT INTO attendance_sessions (lecture_id, method, opens_at, closes_at, opened_by)
          VALUES (?, 'qr', ?, ?, ?)
        `).run(lectureId, window.opens, window.closes, actor?.id ?? null);

        // Snapshot the current course roster onto the lecture.
        db.prepare(`
          INSERT OR IGNORE INTO lecture_enrollments (lecture_id, student_id)
          SELECT ?, student_id FROM course_enrollments WHERE course_id = ? AND status = 'enrolled'
        `).run(lectureId, data.courseId);
        db.prepare(`
          INSERT OR IGNORE INTO lecture_students (lecture_id, student_id)
          SELECT ?, student_id FROM lecture_enrollments WHERE lecture_id = ?
        `).run(lectureId, lectureId);
        return lectureId;
      });
      const lectureId = run();
      audit.record({ actor, action: 'lectures.created', entityType: 'lecture', entityId: lectureId, details: { courseId: data.courseId, title: data.title, lectureDate: data.lectureDate }, ip });
      return selectLecture.get(lectureId);
    } catch (error) {
      if (String(error.code).startsWith('SQLITE_CONSTRAINT')) {
        throw conflict('A lecture with this title already exists on that date for this course.', { title: 'Duplicate lecture.' });
      }
      throw error;
    }
  }

  function update(id, input, actor, { ip } = {}) {
    const existing = selectLecture.get(id);
    if (!existing) throw notFound('Lecture not found.');
    const data = normalize({ courseId: input.courseId ?? existing.courseId, ...input });
    const course = db.prepare('SELECT name_en FROM courses WHERE id = ?').get(data.courseId);
    const window = buildWindow(data);
    db.prepare(`
      UPDATE lectures SET course = ?, course_id = ?, title = ?, lecture_date = ?, start_time = ?, end_time = ?,
        room = ?, instructor_id = ?, attendance_opens_at = ?, attendance_closes_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(course.name_en, data.courseId, data.title, data.lectureDate, data.startTime, data.endTime,
      data.room, data.instructorId, window.opens, window.closes, id);
    db.prepare('UPDATE attendance_sessions SET opens_at = ?, closes_at = ? WHERE lecture_id = ?').run(window.opens, window.closes, id);
    // Add newly enrolled course students to the lecture roster without removing marks.
    db.prepare(`
      INSERT OR IGNORE INTO lecture_enrollments (lecture_id, student_id)
      SELECT ?, student_id FROM course_enrollments WHERE course_id = ? AND status = 'enrolled'
    `).run(id, data.courseId);
    audit.record({ actor, action: 'lectures.updated', entityType: 'lecture', entityId: id, details: { title: data.title, lectureDate: data.lectureDate }, ip });
    return selectLecture.get(id);
  }

  function remove(id, actor, { ip } = {}) {
    const existing = selectLecture.get(id);
    if (!existing) throw notFound('Lecture not found.');
    const marked = db.prepare('SELECT COUNT(*) AS count FROM attendance WHERE lecture_id = ?').get(id).count;
    if (marked > 0) {
      throw conflict(`This lecture has ${marked} attendance record(s). Cancel the lecture instead of deleting it to keep the audit history.`);
    }
    db.prepare('DELETE FROM lectures WHERE id = ?').run(id);
    audit.record({ actor, action: 'lectures.deleted', entityType: 'lecture', entityId: id, details: { title: existing.title }, ip });
    return { deleted: id };
  }

  function setStatus(id, status, actor, { ip } = {}) {
    if (!['scheduled', 'cancelled', 'completed'].includes(status)) throw unprocessable('Invalid lecture status.');
    const existing = selectLecture.get(id);
    if (!existing) throw notFound('Lecture not found.');
    db.prepare("UPDATE lectures SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    if (status === 'completed') {
      db.prepare("UPDATE attendance_sessions SET closed_at = datetime('now') WHERE lecture_id = ? AND closed_at IS NULL").run(id);
    }
    audit.record({ actor, action: `lectures.${status}`, entityType: 'lecture', entityId: id, ip });
    return selectLecture.get(id);
  }

  function openSession(id, actor, { ip } = {}) {
    const existing = selectLecture.get(id);
    if (!existing) throw notFound('Lecture not found.');
    if (existing.sessionId) {
      db.prepare("UPDATE attendance_sessions SET closed_at = NULL, opened_at = datetime('now') WHERE lecture_id = ?").run(id);
    } else {
      const window = { opens: `${existing.lectureDate} ${existing.startTime}:00`, closes: `${existing.lectureDate} ${existing.endTime}:00` };
      db.prepare(`
        INSERT INTO attendance_sessions (lecture_id, method, opens_at, closes_at, opened_by)
        VALUES (?, 'mixed', ?, ?, ?)
      `).run(id, window.opens, window.closes, actor?.id ?? null);
    }
    db.prepare("UPDATE lectures SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").run(id);
    audit.record({ actor, action: 'lectures.session_opened', entityType: 'lecture', entityId: id, ip });
    return get(id);
  }

  /** Returns the time-window verdict used by attendance validation. */
  function windowState(lecture) {
    const now = new Date();
    const opens = lecture.attendanceOpensAt ? new Date(String(lecture.attendanceOpensAt).replace(' ', 'T')) : null;
    const closes = lecture.attendanceClosesAt ? new Date(String(lecture.attendanceClosesAt).replace(' ', 'T')) : null;
    return {
      closed: lecture.sessionClosedAt ? true : false,
      beforeOpen: opens ? now < opens : false,
      afterClose: closes ? now > closes : false,
      opensAt: lecture.attendanceOpensAt,
      closesAt: lecture.attendanceClosesAt,
      graceMinutes: CHECKIN_GRACE_MINUTES
    };
  }

  return { list, get, create, update, remove, setStatus, openSession, selectLecture, windowState, summarize, CHECKIN_GRACE_MINUTES };
}

module.exports = { createCourseService, createLectureService };
