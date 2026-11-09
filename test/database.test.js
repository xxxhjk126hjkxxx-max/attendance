'use strict';

/**
 * Database-level tests: constraints, transactions, referential integrity and
 * the legacy-data migration path.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { migrate, openDatabase } = require('../src/db');

function memoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

test('migrations create every required entity', () => {
  const db = memoryDb();
  migrate(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
  for (const required of [
    'users', 'roles', 'students', 'courses', 'course_enrollments', 'lectures',
    'attendance_sessions', 'attendance', 'audit_logs', 'schema_migrations',
    'sessions', 'login_attempts', 'password_resets', 'settings'
  ]) {
    assert.ok(tables.includes(required), `missing table ${required}`);
  }
  db.close();
});

test('foreign keys and unique constraints are enforced by the database', () => {
  const db = memoryDb();
  migrate(db);
  db.prepare("INSERT INTO students (student_id, name, course, academic_level) VALUES ('s1','One','C','L1')").run();
  db.prepare("INSERT INTO courses (code, name_en) VALUES ('C1','Course One')").run();

  assert.throws(() => db.prepare("INSERT INTO course_enrollments (course_id, student_id) VALUES (999, 's1')").run(), /FOREIGN KEY/,
    'enrollment must reference an existing course');
  assert.throws(() => db.prepare("INSERT INTO course_enrollments (course_id, student_id) VALUES (1, 'missing')").run(), /FOREIGN KEY/,
    'enrollment must reference an existing student');

  db.prepare("INSERT INTO course_enrollments (course_id, student_id) VALUES (1, 's1')").run();
  assert.throws(() => db.prepare("INSERT INTO course_enrollments (course_id, student_id) VALUES (1, 's1')").run(), /UNIQUE/,
    'a student cannot be enrolled twice in the same course');

  assert.throws(() => db.prepare("INSERT INTO students (student_id, name, course, academic_level) VALUES ('s1','Dup','C','L1')").run(), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO students (student_id, name, course, academic_level) VALUES ('s2','Two','C','L1') RETURNING 1").run() &&
    db.prepare("INSERT INTO attendance (lecture_id, student_id, status) VALUES (1, 's2', 'invalid')").run(), /FOREIGN KEY|CHECK/);
  db.close();
});

test('one attendance record per student per lecture is enforced at database level', () => {
  const db = memoryDb();
  migrate(db);
  db.prepare("INSERT INTO students (student_id, name, course, academic_level) VALUES ('s1','One','C','L1')").run();
  db.prepare("INSERT INTO courses (code, name_en) VALUES ('C1','Course One')").run();
  db.prepare("INSERT INTO lectures (course, course_id, title, lecture_date, start_time, end_time) VALUES ('Course One', 1, 'L1', '2026-01-05', '09:00', '10:00')").run();
  db.prepare("INSERT INTO attendance (lecture_id, student_id, status) VALUES (1, 's1', 'present')").run();
  assert.throws(() => db.prepare("INSERT INTO attendance (lecture_id, student_id, status) VALUES (1, 's1', 'late')").run(), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO attendance (lecture_id, student_id, status) VALUES (1, 's1', 'nonsense')").run(), /UNIQUE|CHECK/);
  db.close();
});

test('deleting a student cascades enrollments but keeps audit history independent', () => {
  const db = memoryDb();
  migrate(db);
  db.prepare("INSERT INTO students (student_id, name, course, academic_level) VALUES ('s1','One','C','L1')").run();
  db.prepare("INSERT INTO courses (code, name_en) VALUES ('C1','Course One')").run();
  db.prepare("INSERT INTO course_enrollments (course_id, student_id) VALUES (1, 's1')").run();
  db.prepare("DELETE FROM students WHERE student_id = 's1'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM course_enrollments').get().count, 0);
  db.close();
});

test('migration adopts legacy free-text courses and enrolls their students', () => {
  const db = memoryDb();
  db.exec(`
    CREATE TABLE students (student_id TEXT PRIMARY KEY, name TEXT NOT NULL, course TEXT NOT NULL, academic_level TEXT NOT NULL);
    INSERT INTO students VALUES ('legacy-1','Legacy Student','Intro to Statistics','Level 2');
    INSERT INTO students VALUES ('legacy-2','Second Student','Intro to Statistics','Level 2');
  `);
  migrate(db);
  const course = db.prepare("SELECT * FROM courses WHERE name_en = 'Intro to Statistics'").get();
  assert.ok(course, 'legacy course name becomes a real course record');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM course_enrollments WHERE course_id = ?').get(course.id).count, 2);
  assert.ok(db.prepare("SELECT * FROM students WHERE student_id = 'legacy-1'").get(), 'legacy students are preserved');
  db.close();
});

test('a failed migration rolls back atomically', () => {
  const db = memoryDb();
  const { migrations } = require('../src/db/migrations');
  const original = migrations[migrations.length - 1].up;
  migrations[migrations.length - 1].up = () => { throw new Error('boom'); };
  try {
    assert.throws(() => migrate(db), /boom/);
  } finally {
    migrations[migrations.length - 1].up = original;
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  assert.ok(!tables.includes('students'), 'no partial schema is left behind');
  db.close();
});

test('the database file is created on disk and can be reopened', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-db-'));
  const file = path.join(dir, 'nested', 'db.sqlite');
  const db = openDatabase(file);
  migrate(db);
  db.prepare("INSERT INTO students (student_id, name, course, academic_level) VALUES ('p1','Persisted','C','L1')").run();
  db.close();
  assert.ok(fs.existsSync(file));
  const reopened = new Database(file);
  assert.equal(reopened.prepare("SELECT name FROM students WHERE student_id='p1'").get().name, 'Persisted');
  reopened.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
