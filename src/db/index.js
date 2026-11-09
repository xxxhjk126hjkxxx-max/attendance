'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { migrations, tableExists } = require('./migrations');

/**
 * Opens (or creates) the SQLite database and brings it to the current schema.
 * Safe to call more than once per process; the returned handle is cached.
 */
let cached = null;
let cachedPath = null;

function openDatabase(dbPath) {
  if (cached && cachedPath === dbPath && cached.open) return cached;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  cached = db;
  cachedPath = dbPath;
  return db;
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      description TEXT,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const cols = new Set(db.prepare('PRAGMA table_info(schema_migrations)').all().map(row => row.name));
  if (!cols.has('description')) db.exec('ALTER TABLE schema_migrations ADD COLUMN description TEXT');
}

function appliedVersions(db) {
  if (!tableExists(db, 'schema_migrations')) return new Set();
  return new Set(db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version));
}

/**
 * Runs all pending migrations inside one transaction. If any migration fails the
 * whole run is rolled back, so a partially migrated database is never left behind.
 */
function migrate(db, { dryRun = false } = {}) {
  ensureMigrationTable(db);
  const applied = appliedVersions(db);
  const pending = migrations.filter(migration => !applied.has(migration.version));
  const result = { applied: [], skipped: [...applied], pending: pending.map(m => m.version) };

  if (dryRun || pending.length === 0) return result;

  const run = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
      db.prepare('INSERT OR REPLACE INTO schema_migrations (version, description) VALUES (?, ?)')
        .run(migration.version, migration.description);
      result.applied.push(migration.version);
    }
  });
  run();
  result.pending = [];
  return result;
}

function schemaVersion(db) {
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  return rows.length ? rows[rows.length - 1].version : null;
}

module.exports = { openDatabase, migrate, schemaVersion, migrations, ensureMigrationTable };
