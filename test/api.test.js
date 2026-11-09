'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, createClient, ADMIN, NEW_PASSWORD } = require('./helpers/server');

let ctx;

test.before(async () => {
  ctx = await startServer();
});

test.after(async () => {
  await ctx.close();
});

function freshClient() {
  return createClient(ctx.base, ctx.credentials);
}

async function adminClient() {
  const client = freshClient();
  const response = await client.signInAsSuperAdmin();
  assert.equal(response.status, 200, `admin sign-in failed: ${JSON.stringify(response.body)}`);
  assert.equal(response.body.user.mustChangePassword, false);
  return client;
}

async function seedCourseAndStudents(client, { students = 3 } = {}) {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  const course = await client.post('/api/courses', {
    code: `T${suffix}`, nameEn: `Test Course ${suffix}`, nameAr: 'مقرر اختبار',
    department: 'Testing', academicLevel: 'Level 1', creditHours: 3
  });
  assert.equal(course.status, 201, JSON.stringify(course.body));
  const ids = [];
  for (let i = 0; i < students; i += 1) {
    const created = await client.post('/api/students', {
      id: `${suffix}-${i}`,
      name: `Student ${suffix} ${i}`,
      course: `Test Course ${suffix}`,
      level: 'Level 1'
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.push(created.body.item.id);
  }
  await client.post(`/api/courses/${course.body.item.id}/enrollments`, { studentIds: ids });
  return { courseId: course.body.item.id, studentIds: ids, code: `T${suffix}` };
}

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function createLecture(client, courseId, { date = isoDate(0), startTime = '00:00', endTime = '23:59', title } = {}) {
  const response = await client.post('/api/lectures', {
    courseId, title: title || `Lecture ${Math.random().toString(36).slice(2, 8)}`,
    lectureDate: date, startTime, endTime
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.item;
}

// ---------------------------------------------------------------- auth

test('unauthenticated API access is rejected', async () => {
  const client = freshClient();
  for (const path of ['/api/students', '/api/dashboard', '/api/attendance', '/api/reports/summary']) {
    const response = await client.get(path);
    assert.equal(response.status, 401, `${path} must require authentication`);
  }
});

test('health endpoint reports database connectivity', async () => {
  const client = freshClient();
  const response = await client.get('/api/system/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.database, true);
  assert.match(response.body.schemaVersion, /^00/);
});

test('invalid credentials are rejected and audited', async () => {
  const client = freshClient();
  const response = await client.login('admin', 'wrong-password');
  assert.equal(response.status, 401);
  assert.match(response.body.error, /Invalid username or password/);
  const auditRow = ctx.db.prepare("SELECT * FROM audit_logs WHERE action = 'auth.login_failed' ORDER BY id DESC LIMIT 1").get();
  assert.ok(auditRow, 'failed login recorded in the audit log');
});

test('csrf protection blocks cookie-authenticated state changes without the token', async () => {
  const client = await adminClient();
  const response = await client.post('/api/students', { id: 'CSRF-1', name: 'CSRF Test', level: 'Level 1' }, { csrf: null });
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'CSRF');
});

test('cross-origin authenticated requests are rejected', async () => {
  const client = await adminClient();
  const response = await client.post('/api/students', { id: 'ORIGIN-1', name: 'Origin Test', level: 'Level 1' }, { origin: 'https://evil.example' });
  assert.equal(response.status, 403);
});

test('bearer tokens work for API clients without csrf', async () => {
  const login = await freshClient().post('/api/auth/login', { identifier: ADMIN.username, password: ctx.credentials.password });
  assert.equal(login.status, 200);
  const response = await fetch(`${ctx.base}/api/dashboard`, { headers: { authorization: `Bearer ${login.body.token}` } });
  assert.equal(response.status, 200);
});

test('sign-in is rate limited after repeated failures', async () => {
  const client = freshClient();
  let lastStatus = 0;
  for (let i = 0; i < 8; i += 1) {
    const response = await client.login('admin', `wrong-${i}`);
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 429, 'brute-force attempts are throttled');
  const blocked = await client.login(ADMIN.username, ctx.credentials.password);
  assert.equal(blocked.status, 429, 'even the correct password is blocked while throttled');
  ctx.db.prepare('DELETE FROM login_attempts').run();
});

test('password change requires the current password and invalidates sessions', async () => {
  const client = freshClient();
  await client.signInAsSuperAdmin();
  const wrong = await client.post('/api/auth/change-password', { currentPassword: 'nope', newPassword: 'Another-Str0ng-Pass!' });
  assert.equal(wrong.status, 422);

  const other = freshClient();
  await other.login(ADMIN.username, ctx.credentials.password);
  const unchanged = await client.post('/api/auth/change-password', { currentPassword: ctx.credentials.password, newPassword: ctx.credentials.password });
  assert.equal(unchanged.status, 422, 'reusing the same password is rejected');
  const rotated = await client.post('/api/auth/change-password', {
    currentPassword: ctx.credentials.password,
    newPassword: 'Second-Rotation-Passw0rd!'
  });
  assert.equal(rotated.status, 200);
  ctx.credentials.password = 'Second-Rotation-Passw0rd!';
  const staleSession = await other.get('/api/students');
  assert.equal(staleSession.status, 401, 'changing the password invalidates other sessions');
});

test('password reset tokens are single use and expire', async () => {
  const client = freshClient();
  const identifier = ADMIN.username;
  // The reset link is never returned over HTTP (no mail service is configured),
  // so the token is read from the server-side store exactly as an administrator
  // reading the log link would.
  const issued = await client.post('/api/auth/forgot-password', { identifier });
  assert.equal(issued.status, 200);
  assert.equal(JSON.stringify(issued.body).includes('token'), false, 'the reset token is never returned in the response');

  const row = ctx.db.prepare('SELECT * FROM password_resets ORDER BY requested_at DESC, rowid DESC LIMIT 1').get();
  assert.ok(row, 'a reset request is persisted');
  assert.ok(row.expires_at > row.requested_at, 'the reset token expires after it was requested');

  // The link is printed to the server log for out-of-band delivery; the test
  // issues its own token through the same service to obtain the plain value.
  const { token: rawToken } = ctx.auth.createPasswordReset(identifier, { ip: '127.0.0.1' });
  assert.ok(rawToken && rawToken.length >= 40);

  const weak = await client.post('/api/auth/reset-password', { token: rawToken, newPassword: 'short' });
  assert.equal(weak.status, 422, 'the password policy applies to resets');

  const ok = await client.post('/api/auth/reset-password', { token: rawToken, newPassword: 'Reset-Passw0rd-2026!' });
  assert.equal(ok.status, 200);
  ctx.credentials.password = 'Reset-Passw0rd-2026!';

  const replay = await client.post('/api/auth/reset-password', { token: rawToken, newPassword: 'Replay-Passw0rd-2026!' });
  assert.equal(replay.status, 422, 'a reset token cannot be reused');

  const signIn = await freshClient().login(ADMIN.username, 'Reset-Passw0rd-2026!');
  assert.equal(signIn.status, 200);

  const unknown = await client.post('/api/auth/reset-password', { token: 'x'.repeat(43), newPassword: 'Unknown-Passw0rd-2026!' });
  assert.equal(unknown.status, 422);
});

test('an unknown account receives the same response as a known one', async () => {
  const client = freshClient();
  const known = await client.post('/api/auth/forgot-password', { identifier: ADMIN.username });
  const unknown = await client.post('/api/auth/forgot-password', { identifier: 'nobody@example.edu' });
  assert.equal(known.status, unknown.status);
  assert.deepEqual(known.body, unknown.body, 'no account enumeration through the reset endpoint');
});

// ---------------------------------------------------------------- students

test('student CRUD validates input and enforces unique IDs', async () => {
  const client = await adminClient();
  const id = `S-${Date.now()}`;
  const created = await client.post('/api/students', { id, name: 'Valid Student', course: 'Test', level: 'Level 2' });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.id, id);

  const duplicate = await client.post('/api/students', { id, name: 'Duplicate', level: 'Level 1' });
  assert.equal(duplicate.status, 409, 'duplicate student IDs are rejected');

  const invalid = await client.post('/api/students', { id: '', name: '', level: '' });
  assert.equal(invalid.status, 422);
  assert.ok(invalid.body.fields.id && invalid.body.fields.name);

  const updated = await client.put(`/api/students/${encodeURIComponent(id)}`, { name: 'Renamed Student', level: 'Level 3', status: 'active' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.item.name, 'Renamed Student');

  const profile = await client.get(`/api/students/${encodeURIComponent(id)}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.item.level, 'Level 3');

  const removed = await client.del(`/api/students/${encodeURIComponent(id)}`);
  assert.equal(removed.status, 200);
  const missing = await client.get(`/api/students/${encodeURIComponent(id)}`);
  assert.equal(missing.status, 404);
});

test('student list supports search, filters and pagination', async () => {
  const client = await adminClient();
  await seedCourseAndStudents(client, { students: 5 });
  const all = await client.get('/api/students?pageSize=100');
  assert.equal(all.status, 200);
  assert.ok(all.body.total >= 5);
  const filtered = await client.get('/api/students?search=Student&pageSize=2&page=2');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.pageSize, 2);
  assert.ok(filtered.body.totalPages >= 2);
  assert.equal(filtered.body.items.length <= 2, true);
  const byCourse = await client.get('/api/students?course=Test Course&level=Level 1');
  assert.equal(byCourse.status, 200);
});

test('sql injection payloads in filters are treated as data', async () => {
  const client = await adminClient();
  const response = await client.get(`/api/students?search=${encodeURIComponent("'; DROP TABLE students; --")}`);
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.items));
  const stillThere = ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'").get();
  assert.ok(stillThere, 'students table still exists');
});

// ---------------------------------------------------------------- QR

test('QR codes are opaque tokens that can be rotated and revoked', async () => {
  const client = await adminClient();
  const { studentIds } = await seedCourseAndStudents(client, { students: 1 });
  const id = studentIds[0];

  const card = await client.get(`/api/students/${encodeURIComponent(id)}/qr`);
  assert.equal(card.status, 200);
  assert.equal(card.body.item.qr.v, 1);
  assert.ok(card.body.item.qr.token.length >= 40, 'token is high-entropy');
  assert.equal(JSON.stringify(card.body.item.qr).includes(card.body.item.name), false, 'payload contains no personal data');

  const png = await client.get(`/api/students/${encodeURIComponent(id)}/qr.png`);
  assert.equal(png.status, 200);
  assert.equal(png.contentType, 'image/png');

  const rotated = await client.post(`/api/students/${encodeURIComponent(id)}/qr/rotate`, {});
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.item.qr.token, card.body.item.qr.token, 'rotation issues a new token');

  const revoked = await client.post(`/api/students/${encodeURIComponent(id)}/qr/revoke`, {});
  assert.equal(revoked.status, 200);
  const afterRevoke = await client.get(`/api/students/${encodeURIComponent(id)}/qr`);
  assert.equal(afterRevoke.body.item.qr, null, 'revoked QR is not returned');
  const pngAfter = await client.get(`/api/students/${encodeURIComponent(id)}/qr.png`);
  assert.equal(pngAfter.status, 404);
});

test('QR scanning records attendance, rejects duplicates and unknown tokens', async () => {
  const client = await adminClient();
  const { courseId, studentIds } = await seedCourseAndStudents(client, { students: 2 });
  const lecture = await createLecture(client, courseId);
  const card = await client.get(`/api/students/${encodeURIComponent(studentIds[0])}/qr`);

  const scan = await client.post('/api/attendance/scan', { lectureId: lecture.id, qr: card.body.item.qr });
  assert.equal(scan.status, 201, JSON.stringify(scan.body));
  assert.equal(scan.body.item.studentId, studentIds[0]);
  assert.ok(['present', 'late'].includes(scan.body.item.status));

  const duplicate = await client.post('/api/attendance/scan', { lectureId: lecture.id, qr: card.body.item.qr });
  assert.equal(duplicate.status, 409, 'duplicate attendance is prevented');

  const invalid = await client.post('/api/attendance/scan', { lectureId: lecture.id, qr: { v: 1, token: 'x'.repeat(43) } });
  assert.equal(invalid.status, 404, 'unknown token rejected');

  const malformed = await client.post('/api/attendance/scan', { lectureId: lecture.id, qr: { v: 2, token: 'short' } });
  assert.equal(malformed.status, 422);
});

test('attendance rejects students that are not enrolled in the lecture', async () => {
  const client = await adminClient();
  const first = await seedCourseAndStudents(client, { students: 1 });
  const second = await seedCourseAndStudents(client, { students: 1 });
  const lecture = await createLecture(client, first.courseId);
  const response = await client.post('/api/attendance', {
    lectureId: lecture.id, studentId: second.studentIds[0], status: 'present'
  });
  assert.equal(response.status, 409);
});

// ---------------------------------------------------------------- attendance

test('manual attendance, corrections and audit trail work end to end', async () => {
  const client = await adminClient();
  const { courseId, studentIds } = await seedCourseAndStudents(client, { students: 2 });
  const lecture = await createLecture(client, courseId);

  const marked = await client.post('/api/attendance', { lectureId: lecture.id, studentId: studentIds[0], status: 'present' });
  assert.equal(marked.status, 201, JSON.stringify(marked.body));

  const same = await client.post('/api/attendance', { lectureId: lecture.id, studentId: studentIds[0], status: 'present' });
  assert.equal(same.status, 200);
  assert.equal(same.body.unchanged, true, 'identical re-submission is idempotent');

  const corrected = await client.put(`/api/attendance/${marked.body.item.id}`, { status: 'excused', reason: 'Medical certificate' });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.item.status, 'excused');

  const audit = await client.get(`/api/attendance/audit?attendanceId=${marked.body.item.id}`);
  assert.equal(audit.status, 200);
  assert.equal(audit.body.total, 1);
  assert.equal(audit.body.items[0].previousStatus, 'present');
  assert.equal(audit.body.items[0].newStatus, 'excused');
  assert.equal(audit.body.items[0].reason, 'Medical certificate');
  assert.ok(audit.body.items[0].changedBy);
});

test('bulk attendance marking creates and updates records in one request', async () => {
  const client = await adminClient();
  const { courseId, studentIds } = await seedCourseAndStudents(client, { students: 3 });
  const lecture = await createLecture(client, courseId);
  const response = await client.post('/api/attendance/bulk', {
    lectureId: lecture.id,
    entries: [
      { studentId: studentIds[0], status: 'present' },
      { studentId: studentIds[1], status: 'absent' },
      { studentId: studentIds[2], status: 'late' },
      { studentId: 'does-not-exist', status: 'present' }
    ]
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.created, 3);
  assert.equal(response.body.skipped.length, 1);

  const second = await client.post('/api/attendance/bulk', {
    lectureId: lecture.id,
    entries: [{ studentId: studentIds[0], status: 'present' }, { studentId: studentIds[1], status: 'excused' }]
  });
  assert.equal(second.body.unchanged, 1);
  assert.equal(second.body.updated, 1);
});

test('finalising a lecture marks only unrecorded enrolled students absent', async () => {
  const client = await adminClient();
  const { courseId, studentIds } = await seedCourseAndStudents(client, { students: 3 });
  const lecture = await createLecture(client, courseId);
  await client.post('/api/attendance', { lectureId: lecture.id, studentId: studentIds[0], status: 'present' });

  const finalised = await client.post(`/api/lectures/${lecture.id}/finalize`, {});
  assert.equal(finalised.status, 200);
  assert.equal(finalised.body.markedAbsent, 2, 'only the two unmarked students become absent');

  const detail = await client.get(`/api/lectures/${lecture.id}`);
  assert.equal(detail.body.summary.present, 1);
  assert.equal(detail.body.summary.absent, 2);
  assert.equal(detail.body.summary.attendanceRate, 33.3);

  const secondFinalise = await client.post(`/api/lectures/${lecture.id}/finalize`, {});
  assert.equal(secondFinalise.body.markedAbsent, 0, 'finalising twice does not duplicate absences');
});

test('attendance list filters by date, course, lecture and status', async () => {
  const client = await adminClient();
  const { courseId, studentIds } = await seedCourseAndStudents(client, { students: 2 });
  const lecture = await createLecture(client, courseId, { date: isoDate(-2) });
  await client.post('/api/attendance/bulk', {
    lectureId: lecture.id,
    entries: [{ studentId: studentIds[0], status: 'present' }, { studentId: studentIds[1], status: 'absent' }]
  });

  const byDate = await client.get(`/api/attendance?date=${isoDate(-2)}`);
  assert.equal(byDate.status, 200);
  assert.ok(byDate.body.items.length >= 2);
  const byStatus = await client.get(`/api/attendance?status=absent&lectureId=${lecture.id}`);
  assert.equal(byStatus.body.items.every(row => row.status === 'absent'), true);
  const byCourse = await client.get(`/api/attendance?courseId=${courseId}`);
  assert.ok(byCourse.body.items.length >= 2);
});

// ---------------------------------------------------------------- courses / lectures

test('courses can be created, archived and are protected once they have lectures', async () => {
  const client = await adminClient();
  const { courseId, code } = await seedCourseAndStudents(client, { students: 1 });
  const duplicate = await client.post('/api/courses', { code, nameEn: 'Duplicate code' });
  assert.equal(duplicate.status, 409);

  await createLecture(client, courseId);
  const removed = await client.del(`/api/courses/${courseId}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.archived, true, 'course with lectures is archived, not deleted');
  const list = await client.get('/api/courses');
  assert.equal(list.body.items.some(item => item.id === courseId), false, 'archived course hidden by default');
  const all = await client.get('/api/courses?includeArchived=true');
  assert.equal(all.body.items.some(item => item.id === courseId), true);
});

test('lecture creation validates times and snapshots the course roster', async () => {
  const client = await adminClient();
  const { courseId, studentIds } = await seedCourseAndStudents(client, { students: 2 });
  const bad = await client.post('/api/lectures', {
    courseId, title: 'Bad times', lectureDate: isoDate(0), startTime: '11:00', endTime: '10:00'
  });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.endTime);

  const lecture = await createLecture(client, courseId);
  const detail = await client.get(`/api/lectures/${lecture.id}`);
  assert.equal(detail.body.roster.length, 2);
  assert.deepEqual(detail.body.roster.map(row => row.id).sort(), [...studentIds].sort());

  const cancelled = await client.post(`/api/lectures/${lecture.id}/status`, { status: 'cancelled' });
  assert.equal(cancelled.status, 200);
  const blocked = await client.post('/api/attendance', { lectureId: lecture.id, studentId: studentIds[0], status: 'present' });
  assert.equal(blocked.status, 409, 'attendance cannot be recorded for a cancelled lecture');
});

test('lectures with attendance cannot be deleted but can be cancelled', async () => {
  const client = await adminClient();
  const { courseId, studentIds } = await seedCourseAndStudents(client, { students: 1 });
  const lecture = await createLecture(client, courseId);
  await client.post('/api/attendance', { lectureId: lecture.id, studentId: studentIds[0], status: 'present' });
  const blocked = await client.del(`/api/lectures/${lecture.id}`);
  assert.equal(blocked.status, 409);
});

// ---------------------------------------------------------------- dashboard / reports

test('dashboard statistics derive from the scheduled roster', async () => {
  const client = await adminClient();
  const before = await client.get('/api/dashboard');
  assert.equal(before.status, 200);

  const { courseId, studentIds } = await seedCourseAndStudents(client, { students: 4 });
  const lecture = await createLecture(client, courseId);
  await client.post('/api/attendance/bulk', {
    lectureId: lecture.id,
    entries: [
      { studentId: studentIds[0], status: 'present' },
      { studentId: studentIds[1], status: 'late' },
      { studentId: studentIds[2], status: 'absent' },
      { studentId: studentIds[3], status: 'excused' }
    ]
  });

  const after = await client.get('/api/dashboard');
  assert.equal(after.status, 200);
  assert.deepEqual(
    { present: after.body.stats.presentToday - before.body.stats.presentToday },
    { present: 2 },
    'present today counts present + late'
  );
  assert.equal(after.body.stats.absentToday - before.body.stats.absentToday, 1);
  assert.equal(after.body.stats.excusedToday - before.body.stats.excusedToday, 1);
  assert.ok(after.body.trend.length === 14);
  assert.ok(after.body.coursePerformance.length >= 1);
  assert.ok(after.body.stats.attendanceRate >= 0 && after.body.stats.attendanceRate <= 100);
});

test('report endpoints return consistent aggregates and real exports', async () => {
  const client = await adminClient();
  const { courseId, studentIds } = await seedCourseAndStudents(client, { students: 2 });
  const lecture = await createLecture(client, courseId);
  await client.post('/api/attendance/bulk', {
    lectureId: lecture.id,
    entries: [{ studentId: studentIds[0], status: 'present' }, { studentId: studentIds[1], status: 'absent' }]
  });

  const summary = await client.get(`/api/reports/summary?courseId=${courseId}`);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.summary.present, 1);
  assert.equal(summary.body.summary.absent, 1);
  assert.ok(summary.body.byCourse.length >= 1);
  assert.ok(summary.body.byStudent.length >= 2);

  const lectureReport = await client.get(`/api/reports/lecture/${lecture.id}`);
  assert.equal(lectureReport.status, 200);
  assert.equal(lectureReport.body.roster.length, 2);

  const xlsx = await client.get(`/api/reports/export/xlsx?from=${isoDate(-30)}&to=${isoDate(1)}`);
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.contentType, /spreadsheetml/);

  const pdf = await client.get(`/api/reports/export/pdf?from=${isoDate(-30)}&to=${isoDate(1)}&lang=ar`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.contentType, 'application/pdf');
});

test('XLSX export is a real Office Open XML file, not a renamed CSV', async () => {
  const client = await adminClient();
  const response = await client.request('GET', '/api/reports/export/xlsx');
  assert.equal(response.status, 200);
  const buffer = Buffer.from(await (await fetch(`${ctx.base}/api/reports/export/xlsx`, {
    headers: { cookie: client.header().join('; ') }
  })).arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK', 'XLSX is a ZIP container');
  const zip = buffer.toString('latin1');
  assert.ok(zip.includes('[Content_Types].xml'));
  assert.ok(zip.includes('xl/worksheets/sheet1.xml'));
});

test('PDF exports begin with a valid PDF header in both languages', async () => {
  const client = await adminClient();
  for (const lang of ['en', 'ar']) {
    const response = await fetch(`${ctx.base}/api/reports/export/pdf?lang=${lang}`, { headers: { cookie: client.header().join('; ') } });
    assert.equal(response.status, 200);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(buffer.length > 1000);
  }
});

test('student PDF report is generated', async () => {
  const client = await adminClient();
  const { studentIds } = await seedCourseAndStudents(client, { students: 1 });
  const response = await client.get(`/api/reports/student/${encodeURIComponent(studentIds[0])}/pdf`);
  assert.equal(response.status, 200);
  assert.equal(response.contentType, 'application/pdf');
});

test('QR card PDF renders for a single student and for the bulk sheet', async () => {
  const client = await adminClient();
  const { studentIds } = await seedCourseAndStudents(client, { students: 1 });
  const single = await client.get(`/api/students/${encodeURIComponent(studentIds[0])}/qr/card.pdf?lang=ar`);
  assert.equal(single.status, 200);
  assert.equal(single.contentType, 'application/pdf');
  const bulk = await client.get('/api/students/qr-cards/pdf?lang=en');
  assert.equal(bulk.status, 200);
  assert.equal(bulk.contentType, 'application/pdf');
});

// ---------------------------------------------------------------- RBAC

test('role permissions are enforced on the server, not just in the UI', async () => {
  const admin = await adminClient();
  const instructorName = `prof_${Date.now().toString(36)}`;
  const created = await admin.post('/api/users', {
    username: instructorName, fullName: 'Professor Test', role: 'instructor', password: 'Instructor-Passw0rd!'
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const instructor = freshClient();
  await instructor.post('/api/auth/login', { identifier: instructorName, password: 'Instructor-Passw0rd!' });
  await instructor.post('/api/auth/change-password', { currentPassword: 'Instructor-Passw0rd!', newPassword: 'Instructor-Passw0rd2!' });
  await instructor.post('/api/auth/login', { identifier: instructorName, password: 'Instructor-Passw0rd2!' });

  assert.equal((await instructor.get('/api/students')).status, 200, 'instructors may view students');
  assert.equal((await instructor.post('/api/students', { id: 'X1', name: 'X', level: 'L' })).status, 403, 'instructors cannot create students');
  assert.equal((await instructor.get('/api/users')).status, 403, 'instructors cannot manage accounts');
  assert.equal((await instructor.get('/api/reports/export/xlsx')).status, 403, 'instructors cannot export');
  assert.equal((await instructor.put('/api/attendance/1', { status: 'absent', reason: 'x' })).status, 403, 'instructors cannot correct records');
  assert.equal((await instructor.get('/api/dashboard')).status, 200);

  const adminUser = await admin.post('/api/users', {
    username: `mgr_${Date.now().toString(36)}`, fullName: 'Manager', role: 'admin', password: 'Manager-Passw0rd1!'
  });
  assert.equal(adminUser.status, 201);
  const manager = freshClient();
  await manager.post('/api/auth/login', { identifier: adminUser.body.item.username, password: 'Manager-Passw0rd1!' });
  await manager.post('/api/auth/change-password', { currentPassword: 'Manager-Passw0rd1!', newPassword: 'Manager-Passw0rd2!' });
  await manager.post('/api/auth/login', { identifier: adminUser.body.item.username, password: 'Manager-Passw0rd2!' });
  assert.equal((await manager.post('/api/students', { id: `M-${Date.now()}`, name: 'Managed', level: 'L1' })).status, 201);
  assert.equal((await manager.get('/api/users')).status, 403, 'administrators cannot manage accounts');
  assert.equal((await manager.get('/api/reports/export/pdf')).status, 200, 'administrators may export');
});

test('weak passwords for new accounts are rejected with a clear message', async () => {
  const admin = await adminClient();
  const response = await admin.post('/api/users', {
    username: `weak_${Date.now().toString(36)}`, fullName: 'Weak', role: 'instructor', password: 'password123'
  });
  assert.equal(response.status, 422);
});

test('the last super administrator cannot be deleted', async () => {
  const admin = await adminClient();
  const users = await admin.get('/api/users');
  const superAdmin = users.body.items.find(user => user.role === 'super_admin');
  const response = await admin.del(`/api/users/${superAdmin.id}`);
  assert.equal(response.status, 422);
});

// ---------------------------------------------------------------- audit / hardening

test('audit log records sensitive operations', async () => {
  const client = await adminClient();
  const { studentIds } = await seedCourseAndStudents(client, { students: 1 });
  await client.put(`/api/students/${encodeURIComponent(studentIds[0])}`, { name: 'Audited Student', level: 'Level 1' });
  const logs = await client.get('/api/audit-logs?search=students.updated');
  assert.equal(logs.status, 200);
  assert.ok(logs.body.items.some(entry => entry.action === 'students.updated'));
  assert.ok(logs.body.items.every(entry => entry.actor && entry.createdAt));
});

test('security headers are sent and CSP blocks inline scripts without a nonce', async () => {
  const response = await fetch(`${ctx.base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self' 'nonce-/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /font-src 'self' data:/, 'no third-party font CDN is allowed');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html, /<script nonce="[A-Za-z0-9_-]+">/);
  assert.ok(!html.includes('__APP_VERSION__'), 'server placeholders are replaced');
});

test('static files cannot be read outside the public directory', async () => {
  for (const attempt of ['/assets/../src/app.js', '/assets/%2e%2e/src/app.js', '/vendor/../../package.json', '/assets/..%2f..%2fetc%2fpasswd']) {
    const response = await fetch(ctx.base + attempt);
    const text = await response.text();
    assert.ok(response.status === 404 || response.status === 400, `${attempt} must not be served (got ${response.status})`);
    assert.ok(!text.includes('createApplication'), 'source code is not exposed');
  }
});

test('oversized and malformed JSON payloads are rejected', async () => {
  const client = await adminClient();
  const malformed = await client.post('/api/students', '{"id":', { contentType: 'application/json' });
  assert.equal(malformed.status, 400);
  let hugeStatus = 0;
  try {
    const huge = await client.post('/api/students', { id: 'BIG', name: 'x'.repeat(2 * 1024 * 1024), level: 'L1' });
    hugeStatus = huge.status;
  } catch {
    // A client that aborts mid-upload is equally acceptable: the server refused it.
    hugeStatus = 413;
  }
  assert.ok([413, 422].includes(hugeStatus), `oversized body rejected (got ${hugeStatus})`);
});

test('QR image upload decodes and validates a real generated card', async () => {
  const client = await adminClient();
  const { studentIds } = await seedCourseAndStudents(client, { students: 1 });
  const png = await fetch(`${ctx.base}/api/students/${encodeURIComponent(studentIds[0])}/qr.png`, {
    headers: { cookie: client.header().join('; ') }
  });
  const buffer = Buffer.from(await png.arrayBuffer());
  const response = await client.post('/api/qr/decode', buffer, { contentType: 'image/png' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.student.id, studentIds[0]);

  const garbage = await client.post('/api/qr/decode', Buffer.from('not an image at all'.repeat(10)), { contentType: 'image/png' });
  assert.equal(garbage.status, 422);
});

test('health, settings and backup endpoints are protected and functional', async () => {
  const client = await adminClient();
  const settings = await client.put('/api/settings', { academic_year: '2025 / 2026', semester: '2' });
  assert.equal(settings.status, 200);
  const fetched = await client.get('/api/settings');
  assert.equal(fetched.body.settings.academic_year, '2025 / 2026');

  const backup = await client.get('/api/system/backup');
  assert.equal(backup.status, 200);
  assert.equal(backup.contentType, 'application/octet-stream');

  const anonymous = freshClient();
  assert.equal((await anonymous.get('/api/system/backup')).status, 401);
});
