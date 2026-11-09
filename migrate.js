'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '.data', 'attendance.sqlite');

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function columns(db, name) {
  return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name));
}

function createAttendanceTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lecture_id INTEGER NOT NULL,
      student_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'present'
        CHECK (status IN ('present','late','excused','absent')),
      marked_at TEXT NOT NULL DEFAULT (datetime('now')),
      marked_by TEXT NOT NULL DEFAULT 'system',
      source TEXT NOT NULL DEFAULT 'manual',
      note TEXT,
      UNIQUE (lecture_id, student_id),
      FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
    );
  `);
}

function migrate(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const runMigration = db.transaction(() => {
    if (!tableExists(db, 'students')) {
      db.exec(`
        CREATE TABLE students (
          student_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          course TEXT NOT NULL,
          academic_level TEXT NOT NULL,
          qr_token TEXT UNIQUE,
          qr_revoked_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } else {
      const studentColumns = columns(db, 'students');
      if (!studentColumns.has('qr_token')) db.exec('ALTER TABLE students ADD COLUMN qr_token TEXT');
      if (!studentColumns.has('qr_revoked_at')) db.exec('ALTER TABLE students ADD COLUMN qr_revoked_at TEXT');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS lectures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course TEXT NOT NULL,
        title TEXT NOT NULL,
        lecture_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (course, lecture_date, title)
      );
      CREATE TABLE IF NOT EXISTS lecture_enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lecture_id INTEGER NOT NULL,
        student_id TEXT NOT NULL,
        enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (lecture_id, student_id),
        FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
      );
    `);

    if (!tableExists(db, 'attendance')) {
      createAttendanceTable(db);
    } else {
      const attendanceColumns = columns(db, 'attendance');
      if (!attendanceColumns.has('lecture_id')) {
        if (tableExists(db, 'attendance_legacy_archive')) {
          throw new Error('Legacy attendance needs archiving, but attendance_legacy_archive already exists. Back up and resolve the archive before retrying.');
        }
        // Historical rows have no lecture/enrollment association. Preserve them unchanged
        // instead of inventing a lecture or counting them toward scheduled attendance.
        db.exec('DROP INDEX IF EXISTS idx_attendance_student_time');
        db.exec('ALTER TABLE attendance RENAME TO attendance_legacy_archive');
        createAttendanceTable(db);
      } else {
        const required = ['id', 'lecture_id', 'student_id', 'status', 'marked_at', 'marked_by', 'source', 'note'];
        const missing = required.filter(column => !attendanceColumns.has(column));
        if (missing.length) {
          throw new Error(`Attendance schema is incomplete (missing: ${missing.join(', ')}). No destructive migration was attempted.`);
        }
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS attendance_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attendance_id INTEGER NOT NULL,
        previous_status TEXT,
        new_status TEXT NOT NULL CHECK (new_status IN ('present','late','excused','absent')),
        changed_by TEXT NOT NULL,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        reason TEXT NOT NULL,
        FOREIGN KEY (attendance_id) REFERENCES attendance(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_attendance_lecture_student ON attendance(lecture_id, student_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_marked_at ON attendance(marked_at);
      CREATE INDEX IF NOT EXISTS idx_attendance_audit_record ON attendance_audit(attendance_id, changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lecture_enrollments_student ON lecture_enrollments(student_id, lecture_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_lecture_student
        ON attendance(lecture_id, student_id);
      INSERT OR IGNORE INTO schema_migrations(version) VALUES ('002-attendance-lecture-schema');
    `);
  });

  runMigration();
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  try {
    migrate(db);
    console.log(`Database migration complete: ${DB_PATH}`);
  } catch (error) {
    console.error(`Database migration failed safely: ${error.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

module.exports = { migrate };
