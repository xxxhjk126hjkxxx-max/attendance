'use strict';

const { str, dateOnly, int } = require('../lib/validate');
const { notFound } = require('../lib/errors');

/**
 * Reporting queries shared by the JSON API, the PDF exporter and the XLSX
 * exporter so that every output shows the same figures.
 */
function createReportService(db) {
  function buildFilters(input = {}, user) {
    const from = dateOnly(input.from) || null;
    const to = dateOnly(input.to) || null;
    const courseId = input.courseId ? int(input.courseId, { min: 1 }) : null;
    const studentId = str(input.studentId, { max: 40 }) || null;
    const lectureId = input.lectureId ? int(input.lectureId, { min: 1 }) : null;
    const status = ['present', 'late', 'excused', 'absent'].includes(input.status) ? input.status : null;
    const search = str(input.search, { max: 100 }) || null;
    return { from, to, courseId, studentId, lectureId, status, search, instructorId: user?.role === 'instructor' ? user.id : null };
  }

  function whereClause(filters) {
    const where = [];
    const params = [];
    if (filters.from) { where.push('l.lecture_date >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('l.lecture_date <= ?'); params.push(filters.to); }
    if (filters.courseId) { where.push('l.course_id = ?'); params.push(filters.courseId); }
    if (filters.studentId) { where.push('a.student_id = ?'); params.push(filters.studentId); }
    if (filters.lectureId) { where.push('a.lecture_id = ?'); params.push(filters.lectureId); }
    if (filters.status) { where.push('a.status = ?'); params.push(filters.status); }
    if (filters.search) {
      where.push('(s.name LIKE ? COLLATE NOCASE OR s.student_id LIKE ? COLLATE NOCASE)');
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.instructorId) {
      where.push('(l.instructor_id = ? OR c.instructor_id = ?)');
      params.push(filters.instructorId, filters.instructorId);
    }
    return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  /** Paginated, filterable attendance rows (used by the UI table). */
  function attendance(filters, { page = 1, pageSize = 50 } = {}) {
    const { clause, params } = whereClause(filters);
    const base = `
      FROM attendance a
      JOIN students s ON s.student_id = a.student_id
      JOIN lectures l ON l.id = a.lecture_id
      LEFT JOIN courses c ON c.id = l.course_id
      ${clause}
    `;
    const total = db.prepare(`SELECT COUNT(*) AS count ${base}`).get(...params).count;
    const items = db.prepare(`
      SELECT a.id, s.student_id AS studentId, s.name AS studentName, s.academic_level AS level,
             c.code AS courseCode, COALESCE(c.name_en, l.course) AS course, l.title AS lectureTitle,
             l.lecture_date AS lectureDate, l.start_time AS startTime, a.status, a.source,
             a.marked_at AS markedAt, a.marked_by AS markedBy, a.note
      ${base}
      ORDER BY l.lecture_date DESC, l.start_time DESC, s.name COLLATE NOCASE
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  function summary(filters) {
    const { clause, params } = whereClause(filters);
    const base = `
      FROM attendance a
      JOIN students s ON s.student_id = a.student_id
      JOIN lectures l ON l.id = a.lecture_id
      LEFT JOIN courses c ON c.id = l.course_id
      ${clause}
    `;
    const row = db.prepare(`
      SELECT COUNT(*) AS marked,
             SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
             SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused,
             SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
             COUNT(DISTINCT a.student_id) AS students,
             COUNT(DISTINCT a.lecture_id) AS lectures
      ${base}
    `).get(...params);

    const lectureWhere = [];
    const lectureParams = [];
    if (filters.from) { lectureWhere.push('l.lecture_date >= ?'); lectureParams.push(filters.from); }
    if (filters.to) { lectureWhere.push('l.lecture_date <= ?'); lectureParams.push(filters.to); }
    if (filters.courseId) { lectureWhere.push('l.course_id = ?'); lectureParams.push(filters.courseId); }
    if (filters.lectureId) { lectureWhere.push('l.id = ?'); lectureParams.push(filters.lectureId); }
    if (filters.instructorId) { lectureWhere.push('(l.instructor_id = ? OR c.instructor_id = ?)'); lectureParams.push(filters.instructorId, filters.instructorId); }
    const lectureClause = lectureWhere.length ? `WHERE ${lectureWhere.join(' AND ')}` : '';
    const lecturesRow = db.prepare(`
      SELECT COUNT(DISTINCT l.id) AS lectures,
             (SELECT COUNT(*) FROM lecture_enrollments le WHERE le.lecture_id IN (
                SELECT l2.id FROM lectures l2 LEFT JOIN courses c2 ON c2.id = l2.course_id ${lectureClause.replace(/l\./g, 'l2.').replace(/c\./g, 'c2.')}
             )) AS roster
      FROM lectures l LEFT JOIN courses c ON c.id = l.course_id
      ${lectureClause}
    `).get(...lectureParams, ...lectureParams);

    const marked = row.marked || 0;
    const roster = lecturesRow.roster || 0;
    return {
      marked,
      present: row.present || 0,
      late: row.late || 0,
      excused: row.excused || 0,
      absent: row.absent || 0,
      students: row.students || 0,
      lectures: lecturesRow.lectures || 0,
      roster,
      attended: (row.present || 0) + (row.late || 0),
      attendanceRate: roster ? Math.round((((row.present || 0) + (row.late || 0)) / roster) * 1000) / 10 : 0,
      markedRate: marked ? Math.round((((row.present || 0) + (row.late || 0)) / marked) * 1000) / 10 : 0
    };
  }

  function byCourse(filters) {
    const { clause, params } = whereClause(filters);
    return db.prepare(`
      SELECT c.id AS courseId, c.code AS courseCode, c.name_en AS nameEn, c.name_ar AS nameAr,
             COUNT(a.id) AS marked,
             SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
             SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused,
             SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent
      FROM attendance a
      JOIN students s ON s.student_id = a.student_id
      JOIN lectures l ON l.id = a.lecture_id
      JOIN courses c ON c.id = l.course_id
      ${clause}
      GROUP BY c.id ORDER BY c.code
    `).all(...params).map(row => ({
      ...row,
      attendanceRate: row.marked ? Math.round((((row.present || 0) + (row.late || 0)) / row.marked) * 1000) / 10 : 0
    }));
  }

  function byStudent(filters) {
    const { clause, params } = whereClause(filters);
    return db.prepare(`
      SELECT s.student_id AS studentId, s.name AS studentName, s.academic_level AS level,
             COUNT(a.id) AS marked,
             SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
             SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused,
             SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent
      FROM attendance a
      JOIN students s ON s.student_id = a.student_id
      JOIN lectures l ON l.id = a.lecture_id
      LEFT JOIN courses c ON c.id = l.course_id
      ${clause}
      GROUP BY s.student_id ORDER BY s.name COLLATE NOCASE
    `).all(...params).map(row => ({
      ...row,
      attendanceRate: row.marked ? Math.round((((row.present || 0) + (row.late || 0)) / row.marked) * 1000) / 10 : 0
    }));
  }

  function byDay(filters) {
    const { clause, params } = whereClause(filters);
    return db.prepare(`
      SELECT l.lecture_date AS date,
             COUNT(DISTINCT l.id) AS lectures,
             COUNT(a.id) AS marked,
             SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
             SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused,
             SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent
      FROM lectures l
      LEFT JOIN attendance a ON a.lecture_id = l.id
      LEFT JOIN students s ON s.student_id = a.student_id
      LEFT JOIN courses c ON c.id = l.course_id
      ${clause.replace(/a\.lecture_id/g, 'a.lecture_id')}
      GROUP BY l.lecture_date ORDER BY l.lecture_date DESC
    `).all(...params);
  }

  function lectureReport(lectureId) {
    const lecture = db.prepare(`
      SELECT l.id, l.title, l.lecture_date AS lectureDate, l.start_time AS startTime, l.end_time AS endTime,
             l.room, l.status, c.code AS courseCode, COALESCE(c.name_en, l.course) AS course,
             c.name_ar AS courseAr, u.full_name AS instructorName
      FROM lectures l LEFT JOIN courses c ON c.id = l.course_id LEFT JOIN users u ON u.id = l.instructor_id
      WHERE l.id = ?
    `).get(lectureId);
    if (!lecture) throw notFound('Lecture not found.');
    const roster = db.prepare(`
      SELECT s.student_id AS studentId, s.name AS studentName, s.academic_level AS level,
             COALESCE(a.status, 'unmarked') AS status, a.marked_at AS markedAt, a.source, a.marked_by AS markedBy
      FROM lecture_enrollments le
      JOIN students s ON s.student_id = le.student_id
      LEFT JOIN attendance a ON a.lecture_id = le.lecture_id AND a.student_id = le.student_id
      WHERE le.lecture_id = ?
      ORDER BY s.name COLLATE NOCASE
    `).all(lectureId);
    const counts = { present: 0, late: 0, excused: 0, absent: 0, unmarked: 0 };
    roster.forEach(row => { counts[row.status] = (counts[row.status] || 0) + 1; });
    return {
      lecture,
      roster,
      summary: {
        ...counts,
        enrolled: roster.length,
        attendanceRate: roster.length ? Math.round(((counts.present + counts.late) / roster.length) * 1000) / 10 : 0
      }
    };
  }

  function filterOptions(user) {
    const scope = user?.role === 'instructor' ? 'WHERE l.instructor_id = ? OR c.instructor_id = ?' : '';
    const params = user?.role === 'instructor' ? [user.id, user.id] : [];
    return {
      courses: db.prepare('SELECT id, code, name_en AS nameEn, name_ar AS nameAr FROM courses WHERE archived_at IS NULL ORDER BY code').all(),
      lectures: db.prepare(`
        SELECT l.id, l.title, l.lecture_date AS lectureDate, COALESCE(c.name_en, l.course) AS course
        FROM lectures l LEFT JOIN courses c ON c.id = l.course_id ${scope}
        ORDER BY l.lecture_date DESC, l.start_time DESC LIMIT 200
      `).all(...params),
      students: db.prepare('SELECT student_id AS id, name FROM students ORDER BY name COLLATE NOCASE LIMIT 2000').all(),
      levels: db.prepare('SELECT DISTINCT academic_level AS level FROM students ORDER BY academic_level').all().map(r => r.level)
    };
  }

  return { buildFilters, attendance, summary, byCourse, byStudent, byDay, lectureReport, filterOptions };
}

module.exports = { createReportService };
