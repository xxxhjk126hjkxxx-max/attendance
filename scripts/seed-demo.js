'use strict';

/**
 * Development/demo seed. NEVER run this against production data.
 *
 *   npm run seed:demo
 *
 * It creates sample courses, students, lectures and attendance so the dashboard
 * can be reviewed with realistic data. All rows are clearly labelled as demo.
 */

const { config } = require('../src/config');
const { createApplication } = require('../src/app');
const { createAuditLogger } = require('../src/services/audit');
const { createStudentService } = require('../src/services/students');
const { createCourseService, createLectureService } = require('../src/services/courses');
const { createAttendanceService } = require('../src/services/attendance');

const DEMO_MARKER = 'DEMO';

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    console.error('Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=true to override.');
    process.exit(1);
  }

  const { db } = createApplication({ dbPath: config.dbPath });
  const audit = createAuditLogger(db);
  const students = createStudentService(db, { audit });
  const courses = createCourseService(db, { audit });
  const lectures = createLectureService(db, { audit });
  const attendance = createAttendanceService(db, { audit });

  const admin = db.prepare(`
    SELECT u.id, u.username, r.key AS role FROM users u JOIN roles r ON r.id = u.role_id
    ORDER BY CASE r.key WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1
  `).get();
  if (!admin) {
    console.error('No administrator found. Start the server once with ADMIN_PASSWORD set, then re-run the seed.');
    process.exit(1);
  }
  const actor = { id: admin.id, username: admin.username, role: admin.role };

  const existing = db.prepare("SELECT COUNT(*) AS count FROM courses WHERE code LIKE 'DEMO%'").get().count;
  if (existing) {
    console.log(`Demo data already present (${existing} demo courses). Nothing to do.`);
    return;
  }

  const courseSpecs = [
    { code: 'DEMO-CS101', nameEn: 'Introduction to Computing', nameAr: 'مقدمة في الحوسبة', department: 'Computer Science', academicLevel: 'Level 1' },
    { code: 'DEMO-MA201', nameEn: 'Discrete Mathematics', nameAr: 'الرياضيات المتقطعة', department: 'Mathematics', academicLevel: 'Level 2' },
    { code: 'DEMO-IS301', nameEn: 'Database Systems', nameAr: 'أنظمة قواعد البيانات', department: 'Information Systems', academicLevel: 'Level 3' },
    { code: 'DEMO-EN102', nameEn: 'Academic English', nameAr: 'الإنجليزية الأكاديمية', department: 'Languages', academicLevel: 'Level 1' }
  ];

  const createdCourses = courseSpecs.map(spec => courses.create(spec, actor));

  const firstNames = ['Ahmed', 'Sara', 'Mohamed', 'Fatima', 'Omar', 'Layla', 'Yousef', 'Noor', 'Khalid', 'Huda', 'Ibrahim', 'Mariam', 'Tariq', 'Aisha', 'Hassan', 'Zainab'];
  const lastNames = ['Ali', 'Ibrahim', 'Hassan', 'Osman', 'Elamin', 'Yousif', 'Mahmoud', 'Abdalla', 'Salih', 'Babiker', 'Hamid', 'Nour'];
  const createdStudents = [];
  let counter = 1;
  for (const course of createdCourses) {
    for (let i = 0; i < 8; i += 1) {
      const id = `DEMO-2026-${String(counter).padStart(4, '0')}`;
      const name = `${firstNames[(counter * 3) % firstNames.length]} ${lastNames[(counter * 5) % lastNames.length]}`;
      try {
        createdStudents.push(students.create({
          id, name, course: course.nameEn, level: course.academicLevel,
          email: `demo${counter}@example.edu`
        }, actor));
      } catch (error) {
        console.warn(`  skipped ${id}: ${error.message}`);
      }
      counter += 1;
    }
    courses.enroll(course.id, createdStudents.filter(s => s.course === course.nameEn).map(s => s.id), actor);
  }

  const today = new Date();
  let lectureCount = 0;
  for (const course of createdCourses) {
    for (let dayOffset = 13; dayOffset >= 0; dayOffset -= 1) {
      if (dayOffset % 3 !== 0) continue;
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - dayOffset));
      const lectureDate = date.toISOString().slice(0, 10);
      const lecture = lectures.create({
        courseId: course.id,
        title: `Lecture ${14 - dayOffset} — ${course.code}`,
        lectureDate,
        startTime: '09:00',
        endTime: '10:30',
        room: 'Hall A',
      }, actor);
      lectureCount += 1;

      // Deterministic pseudo-random attendance so the demo is reproducible.
      const roster = db.prepare('SELECT student_id FROM lecture_enrollments WHERE lecture_id = ?').all(lecture.id);
      const entries = roster.map((row, index) => {
        const seed = (lecture.id * 7 + index * 13) % 100;
        const status = seed < 68 ? 'present' : seed < 82 ? 'late' : seed < 90 ? 'excused' : 'absent';
        return { studentId: row.student_id, status };
      });
      attendance.markBulk({ lectureId: lecture.id, entries, user: actor, ip: '127.0.0.1' });
      db.prepare("UPDATE attendance SET marked_at = ? WHERE lecture_id = ?")
        .run(`${lectureDate} 09:${String((lecture.id * 3) % 60).padStart(2, '0')}:00`, lecture.id);
    }
  }

  console.log(`Seeded ${DEMO_MARKER} data: ${createdStudents.length} students, ${createdCourses.length} courses, ${lectureCount} lectures.`);
  console.log('Sign in and open the dashboard to review the analytics.');
}

main().catch(error => {
  console.error('Seed failed:', error);
  process.exit(1);
});
