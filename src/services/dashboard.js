'use strict';

const { minutesOfDay } = require('../lib/validate');

/**
 * Dashboard analytics. Every figure is derived from scheduled lectures and the
 * roster snapshot (`lecture_enrollments`) — never from "every student must
 * attend every day" assumptions.
 */
function createDashboardService(db) {
  const lectureAggregate = db.prepare(`
    SELECT
      COUNT(*) AS lectures,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledLectures
    FROM lectures
    WHERE lecture_date BETWEEN ? AND ?
  `);

  const attendanceAggregate = db.prepare(`
    SELECT
      COUNT(*) AS marked,
      SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused,
      SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent
    FROM attendance a
    JOIN lectures l ON l.id = a.lecture_id
    WHERE l.lecture_date BETWEEN ? AND ? AND l.status <> 'cancelled'
  `);

  const rosterAggregate = db.prepare(`
    SELECT COUNT(*) AS roster
    FROM lecture_enrollments le
    JOIN lectures l ON l.id = le.lecture_id
    WHERE l.lecture_date BETWEEN ? AND ? AND l.status <> 'cancelled'
  `);

  const toIso = date => date.toISOString().slice(0, 10);
  const shiftDays = (date, days) => {
    const copy = new Date(date.getTime());
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
  };

  function rangeStats(from, to) {
    const lectures = lectureAggregate.get(from, to);
    const attendance = attendanceAggregate.get(from, to);
    const roster = rosterAggregate.get(from, to).roster || 0;
    const marked = attendance.marked || 0;
    const present = attendance.present || 0;
    const late = attendance.late || 0;
    const excused = attendance.excused || 0;
    const absent = attendance.absent || 0;
    return {
      from,
      to,
      lectures: lectures.lectures || 0,
      cancelledLectures: lectures.cancelledLectures || 0,
      roster,
      marked,
      unmarked: Math.max(0, roster - marked),
      present,
      late,
      excused,
      absent,
      attended: present + late,
      // Rate is measured against the roster of lectures that actually happened.
      attendanceRate: roster ? Math.round(((present + late) / roster) * 1000) / 10 : 0,
      markedRate: marked ? Math.round(((present + late) / marked) * 1000) / 10 : 0
    };
  }

  function overview({ now = new Date() } = {}) {
    const today = toIso(now);
    const students = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(status,'active') = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN COALESCE(status,'active') <> 'active' THEN 1 ELSE 0 END) AS inactive
      FROM students
    `).get();
    const courses = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM courses WHERE archived_at IS NULL) AS activeCourses,
        (SELECT COUNT(*) FROM courses) AS totalCourses,
        (SELECT COUNT(*) FROM lectures) AS totalLectures,
        (SELECT COUNT(*) FROM lectures WHERE lecture_date = ?) AS lecturesToday
    `).get(today);

    const todayStats = rangeStats(today, today);
    const weekStart = toIso(shiftDays(now, -6));
    const prevWeekStart = toIso(shiftDays(now, -13));
    const prevWeekEnd = toIso(shiftDays(now, -7));
    const monthStart = `${today.slice(0, 7)}-01`;
    const prevMonthEnd = toIso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
    const prevMonthStart = `${prevMonthEnd.slice(0, 7)}-01`;

    const week = rangeStats(weekStart, today);
    const previousWeek = rangeStats(prevWeekStart, prevWeekEnd);
    const month = rangeStats(monthStart, today);
    const previousMonth = rangeStats(prevMonthStart, prevMonthEnd);

    // Daily trend for the last 14 days (including days with no lectures).
    const trendStart = shiftDays(now, -13);
    const trendRows = db.prepare(`
      SELECT l.lecture_date AS date,
             COUNT(DISTINCT l.id) AS lectures,
             (SELECT COUNT(*) FROM lecture_enrollments le WHERE le.lecture_id IN (SELECT id FROM lectures x WHERE x.lecture_date = l.lecture_date AND x.status <> 'cancelled')) AS roster,
             SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
             SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
             SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused
      FROM lectures l
      LEFT JOIN attendance a ON a.lecture_id = l.id
      WHERE l.lecture_date >= ? AND l.status <> 'cancelled'
      GROUP BY l.lecture_date
      ORDER BY l.lecture_date
    `).all(toIso(trendStart));

    const trendMap = new Map(trendRows.map(row => [row.date, row]));
    const trend = [];
    for (let i = 0; i < 14; i += 1) {
      const date = toIso(shiftDays(trendStart, i));
      const row = trendMap.get(date);
      const roster = row?.roster || 0;
      const present = row?.present || 0;
      const late = row?.late || 0;
      trend.push({
        date,
        lectures: row?.lectures || 0,
        roster,
        present,
        late,
        absent: row?.absent || 0,
        excused: row?.excused || 0,
        attendanceRate: roster ? Math.round(((present + late) / roster) * 1000) / 10 : 0
      });
    }

    // Per-course performance over the trailing 30 days.
    const courseWindowStart = toIso(shiftDays(now, -29));
    const coursePerformance = db.prepare(`
      SELECT c.id, c.code, c.name_en AS nameEn, c.name_ar AS nameAr,
             (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.status = 'enrolled') AS students,
             (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id AND l.lecture_date BETWEEN ? AND ? AND l.status <> 'cancelled') AS lectures,
             (SELECT COUNT(*) FROM lecture_enrollments le JOIN lectures l ON l.id = le.lecture_id
                WHERE l.course_id = c.id AND l.lecture_date BETWEEN ? AND ? AND l.status <> 'cancelled') AS roster,
             (SELECT COUNT(*) FROM attendance a JOIN lectures l ON l.id = a.lecture_id
                WHERE l.course_id = c.id AND l.lecture_date BETWEEN ? AND ? AND a.status IN ('present','late')) AS attended,
             (SELECT COUNT(*) FROM attendance a JOIN lectures l ON l.id = a.lecture_id
                WHERE l.course_id = c.id AND l.lecture_date BETWEEN ? AND ? AND a.status = 'absent') AS absent
      FROM courses c
      WHERE c.archived_at IS NULL
      ORDER BY attended DESC, c.code
      LIMIT 12
    `).all(courseWindowStart, today, courseWindowStart, today, courseWindowStart, today, courseWindowStart, today)
      .map(row => ({ ...row, attendanceRate: row.roster ? Math.round((row.attended / row.roster) * 1000) / 10 : 0 }));

    const recentActivity = db.prepare(`
      SELECT a.id, a.status, a.marked_at AS markedAt, a.source, a.marked_by AS markedBy,
             s.student_id AS studentId, s.name AS studentName,
             l.id AS lectureId, l.title AS lectureTitle, l.lecture_date AS lectureDate,
             COALESCE(c.name_en, l.course) AS course
      FROM attendance a
      JOIN students s ON s.student_id = a.student_id
      JOIN lectures l ON l.id = a.lecture_id
      LEFT JOIN courses c ON c.id = l.course_id
      ORDER BY a.marked_at DESC, a.id DESC
      LIMIT 12
    `).all();

    // Absence alerts: students whose attendance rate is below 75% with >= 2 absences.
    const absenceAlerts = db.prepare(`
      SELECT s.student_id AS studentId, s.name, s.academic_level AS level,
             SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absences,
             SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended,
             COUNT(a.id) AS marked
      FROM attendance a
      JOIN students s ON s.student_id = a.student_id
      JOIN lectures l ON l.id = a.lecture_id
      WHERE l.lecture_date >= ?
      GROUP BY s.student_id
      HAVING absences >= 2
      ORDER BY (CAST(attended AS REAL) / MAX(marked, 1)) ASC, absences DESC
      LIMIT 6
    `).all(toIso(shiftDays(now, -29))).map(row => ({
      ...row,
      attendanceRate: row.marked ? Math.round((row.attended / row.marked) * 1000) / 10 : 0
    }));

    const todayLectures = db.prepare(`
      SELECT l.id, l.title, COALESCE(c.name_en, l.course) AS course, c.code AS courseCode,
             l.start_time AS startTime, l.end_time AS endTime, l.status, l.room,
             u.full_name AS instructorName,
             (SELECT COUNT(*) FROM lecture_enrollments le WHERE le.lecture_id = l.id) AS enrolled,
             (SELECT COUNT(*) FROM attendance a WHERE a.lecture_id = l.id AND a.status IN ('present','late')) AS attended,
             (SELECT COUNT(*) FROM attendance a WHERE a.lecture_id = l.id) AS marked
      FROM lectures l
      LEFT JOIN courses c ON c.id = l.course_id
      LEFT JOIN users u ON u.id = l.instructor_id
      WHERE l.lecture_date = ?
      ORDER BY l.start_time
    `).all(today);

    const weeklySeries = db.prepare(`
      SELECT strftime('%Y-%W', l.lecture_date) AS period,
             MIN(l.lecture_date) AS startDate, MAX(l.lecture_date) AS endDate,
             SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended,
             (SELECT COUNT(*) FROM lecture_enrollments le JOIN lectures x ON x.id = le.lecture_id
               WHERE strftime('%Y-%W', x.lecture_date) = strftime('%Y-%W', l.lecture_date)
                 AND x.status <> 'cancelled') AS roster
      FROM lectures l LEFT JOIN attendance a ON a.lecture_id = l.id
      WHERE l.lecture_date >= ? AND l.status <> 'cancelled'
      GROUP BY period ORDER BY period DESC LIMIT 8
    `).all(toIso(shiftDays(now, -83))).map(row => ({
      period: row.period,
      from: row.startDate,
      to: row.endDate,
      attendanceRate: row.roster ? Math.round((row.attended / row.roster) * 1000) / 10 : 0
    })).reverse();

    const monthlySeries = db.prepare(`
      SELECT strftime('%Y-%m', l.lecture_date) AS period,
             SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended,
             (SELECT COUNT(*) FROM lecture_enrollments le JOIN lectures x ON x.id = le.lecture_id
               WHERE strftime('%Y-%m', x.lecture_date) = strftime('%Y-%m', l.lecture_date)
                 AND x.status <> 'cancelled') AS roster
      FROM lectures l LEFT JOIN attendance a ON a.lecture_id = l.id
      WHERE l.lecture_date >= ? AND l.status <> 'cancelled'
      GROUP BY period ORDER BY period DESC LIMIT 6
    `).all(toIso(shiftDays(now, -200))).map(row => ({
      period: row.period,
      attendanceRate: row.roster ? Math.round((row.attended / row.roster) * 1000) / 10 : 0
    })).reverse();

    const unmarkedLectures = db.prepare(`
      SELECT l.id, l.title, l.lecture_date AS lectureDate, COALESCE(c.name_en, l.course) AS course,
             (SELECT COUNT(*) FROM lecture_enrollments le WHERE le.lecture_id = l.id) AS enrolled,
             (SELECT COUNT(*) FROM attendance a WHERE a.lecture_id = l.id) AS marked
      FROM lectures l LEFT JOIN courses c ON c.id = l.course_id
      WHERE l.status <> 'cancelled' AND l.lecture_date <= ?
      ORDER BY l.lecture_date DESC, l.start_time DESC
      LIMIT 40
    `).all(today).filter(row => row.marked < row.enrolled).slice(0, 6);

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        totalStudents: students.total || 0,
        activeStudents: students.active || 0,
        presentToday: todayStats.present + todayStats.late,
        absentToday: todayStats.absent,
        lateToday: todayStats.late,
        excusedToday: todayStats.excused,
        unmarkedToday: todayStats.unmarked,
        attendanceRate: todayStats.attendanceRate,
        totalCourses: courses.activeCourses || 0,
        totalLectures: courses.totalLectures || 0,
        lecturesToday: courses.lecturesToday || 0,
        rosterToday: todayStats.roster,
        markedToday: todayStats.marked
      },
      periods: {
        today: todayStats,
        week,
        previousWeek,
        month,
        previousMonth
      },
      trend,
      weeklySeries,
      monthlySeries,
      coursePerformance,
      recentActivity,
      absenceAlerts,
      todayLectures,
      unmarkedLectures
    };
  }

  return { overview, rangeStats };
}

module.exports = { createDashboardService };
