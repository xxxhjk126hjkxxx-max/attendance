'use strict';

/**
 * Ordered, idempotent schema migrations.
 *
 * Every migration is written so that it can safely run against a database that
 * was created by an older version of the application. Legacy rows are never
 * deleted: the previous `attendance` table is archived instead of being dropped.
 */

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function columns(db, name) {
  if (!tableExists(db, name)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name));
}

function addColumn(db, table, column, definition) {
  if (!columns(db, table).has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function addColumnIfMissing(db, table, column, definition) {
  if (tableExists(db, table)) addColumn(db, table, column, definition);
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

const migrations = [
  {
    version: '001-students',
    description: 'Students table with QR token columns',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS students (
          student_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          course TEXT NOT NULL,
          academic_level TEXT NOT NULL,
          qr_token TEXT UNIQUE,
          qr_revoked_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_students_name ON students(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_students_course ON students(course COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_students_level ON students(academic_level COLLATE NOCASE);
      `);
      addColumnIfMissing(db, 'students', 'qr_token', 'TEXT');
      addColumnIfMissing(db, 'students', 'qr_revoked_at', 'TEXT');
      addColumnIfMissing(db, 'students', 'email', 'TEXT');
      addColumnIfMissing(db, 'students', 'phone', 'TEXT');
      addColumnIfMissing(db, 'students', 'status', "TEXT NOT NULL DEFAULT 'active'");
    }
  },
  {
    version: '002-attendance-lecture-schema',
    description: 'Lecture-scoped attendance, preserving legacy rows in an archive table',
    up(db) {
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
      `);
    }
  },
  {
    version: '003-auth-rbac',
    description: 'Roles, users, sessions, login throttling, password resets, audit log and settings',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          name_en TEXT NOT NULL,
          name_ar TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          email TEXT,
          full_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role_id INTEGER NOT NULL REFERENCES roles(id),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
          must_change_password INTEGER NOT NULL DEFAULT 0,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          last_login_at TEXT,
          password_changed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(lower(email)) WHERE email IS NOT NULL;

        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          csrf_token TEXT NOT NULL,
          ip TEXT,
          user_agent TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

        CREATE TABLE IF NOT EXISTS login_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          identifier TEXT NOT NULL,
          ip TEXT,
          attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
          success INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier, attempted_at);

        CREATE TABLE IF NOT EXISTS password_resets (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          requested_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          used_at TEXT,
          requested_ip TEXT
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id INTEGER,
          actor_username TEXT NOT NULL,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          details TEXT,
          ip TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO roles (key, name_en, name_ar) VALUES
          ('super_admin', 'Super Administrator', 'مشرف عام'),
          ('admin', 'Administrator', 'مشرف'),
          ('instructor', 'Instructor', 'محاضر');
      `);
    }
  },
  {
    version: '004-courses-and-sessions',
    description: 'Courses, course enrollments, lecture scheduling windows and attendance sessions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS courses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          name_en TEXT NOT NULL,
          name_ar TEXT,
          department TEXT,
          academic_level TEXT,
          credit_hours INTEGER NOT NULL DEFAULT 3,
          instructor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          archived_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(code COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS course_enrollments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
          enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
          status TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','dropped','completed')),
          UNIQUE (course_id, student_id)
        );
        CREATE INDEX IF NOT EXISTS idx_course_enrollments_student ON course_enrollments(student_id, course_id);
        CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_id);

        CREATE TABLE IF NOT EXISTS lecture_students (
          lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
          student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
          PRIMARY KEY (lecture_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS attendance_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lecture_id INTEGER NOT NULL UNIQUE REFERENCES lectures(id) ON DELETE CASCADE,
          method TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','manual','mixed')),
          opens_at TEXT,
          closes_at TEXT,
          opened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          opened_at TEXT NOT NULL DEFAULT (datetime('now')),
          closed_at TEXT
        );
      `);

      addColumnIfMissing(db, 'lectures', 'course_id', 'INTEGER REFERENCES courses(id) ON DELETE SET NULL');
      addColumnIfMissing(db, 'lectures', 'instructor_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
      addColumnIfMissing(db, 'lectures', 'attendance_opens_at', 'TEXT');
      addColumnIfMissing(db, 'lectures', 'attendance_closes_at', 'TEXT');
      addColumnIfMissing(db, 'lectures', 'room', 'TEXT');
      addColumnIfMissing(db, 'lectures', 'status', "TEXT NOT NULL DEFAULT 'scheduled'");
      addColumnIfMissing(db, 'lectures', 'updated_at', 'TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_lectures_course_date ON lectures(course_id, lecture_date)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_lectures_date ON lectures(lecture_date)');

      addColumnIfMissing(db, 'attendance', 'session_id', 'INTEGER REFERENCES attendance_sessions(id) ON DELETE SET NULL');
      addColumnIfMissing(db, 'attendance', 'marked_by_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
      db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status)');

      // Adopt legacy free-text student course names as real courses so that no
      // existing data is lost, then enroll those students in their course.
      const orphanNames = db.prepare(`
        SELECT DISTINCT course FROM students
        WHERE course IS NOT NULL AND trim(course) <> ''
          AND course NOT IN (SELECT name_en FROM courses)
      `).all();

      const insertCourse = db.prepare(`
        INSERT INTO courses (code, name_en, name_ar, academic_level)
        VALUES (?, ?, ?, ?)
      `);
      for (const row of orphanNames) {
        const code = String(row.course).trim().toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]+/g, '-').slice(0, 24);
        const uniqueCode = code || 'COURSE';
        let finalCode = uniqueCode;
        let attempt = 1;
        while (db.prepare('SELECT 1 FROM courses WHERE code = ?').get(finalCode)) {
          finalCode = `${uniqueCode}-${attempt++}`;
        }
        const level = db.prepare('SELECT academic_level FROM students WHERE course = ? LIMIT 1').get(row.course);
        insertCourse.run(finalCode, String(row.course).trim(), null, level ? level.academic_level : null);
      }

      db.exec(`
        INSERT OR IGNORE INTO course_enrollments (course_id, student_id)
        SELECT c.id, s.student_id
        FROM students s
        JOIN courses c ON c.name_en = s.course
        WHERE s.student_id IS NOT NULL;
      `);

      // Link existing lectures to the course whose name matches the legacy text column.
      db.exec(`
        UPDATE lectures
        SET course_id = (SELECT c.id FROM courses c WHERE c.name_en = lectures.course OR c.code = lectures.course LIMIT 1)
        WHERE course_id IS NULL;
      `);
    }
  },
  {
    version: '005-lecture-roster-sync',
    description: 'Keep lecture rosters in sync with course enrollments and add lookup indexes',
    up(db) {
      db.exec(`
        INSERT OR IGNORE INTO lecture_enrollments (lecture_id, student_id)
        SELECT l.id, ce.student_id
        FROM lectures l
        JOIN course_enrollments ce ON ce.course_id = l.course_id
        WHERE l.course_id IS NOT NULL;

        INSERT OR IGNORE INTO lecture_students (lecture_id, student_id)
        SELECT lecture_id, student_id FROM lecture_enrollments;

        CREATE INDEX IF NOT EXISTS idx_attendance_lecture_status ON attendance(lecture_id, status);
      `);
      // Legacy databases may predate the timestamp columns, so index only when
      // the column really exists.
      if (columns(db, 'students').has('created_at')) {
        db.exec('CREATE INDEX IF NOT EXISTS idx_students_created ON students(created_at)');
      }
    }
  }
];

module.exports = { migrations, tableExists, columns };
