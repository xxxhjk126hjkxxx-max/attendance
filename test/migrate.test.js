'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrate } = require('../migrate');

function memoryDb() { return new Database(':memory:'); }

test('migration preserves legacy attendance without assigning fake lectures', () => {
  const db = memoryDb();
  db.exec(`
    CREATE TABLE students (student_id TEXT PRIMARY KEY, name TEXT NOT NULL, course TEXT NOT NULL, academic_level TEXT NOT NULL);
    INSERT INTO students VALUES ('s-1','Student One','Math','Level 1');
    CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, attended_at TEXT NOT NULL, status TEXT NOT NULL, course TEXT NOT NULL DEFAULT '');
    INSERT INTO attendance (student_id, attended_at, status, course) VALUES ('s-1','2025-01-02T10:00:00Z','present','Math');
  `);

  migrate(db);
  const archived = db.prepare('SELECT student_id, attended_at, status, course FROM attendance_legacy_archive').get();
  assert.deepEqual(archived, { student_id: 's-1', attended_at: '2025-01-02T10:00:00Z', status: 'present', course: 'Math' });
  assert.equal(db.prepare('PRAGMA table_info(attendance)').all().some(column => column.name === 'lecture_id'), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attendance').get().count, 0);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.close();
});

test('migration can run repeatedly on the new schema', () => {
  const db = memoryDb();
  db.exec(`CREATE TABLE students (student_id TEXT PRIMARY KEY, name TEXT NOT NULL, course TEXT NOT NULL, academic_level TEXT NOT NULL);`);
  migrate(db);
  assert.doesNotThrow(() => migrate(db));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 1);
  db.close();
});

test('migration refuses to overwrite an existing legacy archive', () => {
  const db = memoryDb();
  db.exec(`
    CREATE TABLE students (student_id TEXT PRIMARY KEY, name TEXT NOT NULL, course TEXT NOT NULL, academic_level TEXT NOT NULL);
    CREATE TABLE lectures (id INTEGER PRIMARY KEY AUTOINCREMENT, course TEXT NOT NULL, title TEXT NOT NULL, lecture_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(course, lecture_date, title));
    CREATE TABLE lecture_enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, lecture_id INTEGER NOT NULL, student_id TEXT NOT NULL, enrolled_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(lecture_id, student_id));
    CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, attended_at TEXT NOT NULL, status TEXT NOT NULL, course TEXT NOT NULL DEFAULT '');
    CREATE TABLE attendance_legacy_archive (id INTEGER);
  `);
  assert.throws(() => migrate(db), /attendance_legacy_archive already exists/);
  db.close();
});
