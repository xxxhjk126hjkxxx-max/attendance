'use strict';

/**
 * CLI wrapper around the schema migrations.
 *
 *   node migrate.js            apply pending migrations
 *   node migrate.js --status   show applied / pending migrations
 */

const { config } = require('./src/config');
const { openDatabase, migrate, migrations } = require('./src/db');

if (require.main === module) {
  const statusOnly = process.argv.includes('--status');
  let db;
  try {
    db = openDatabase(config.dbPath);
    const result = migrate(db, { dryRun: statusOnly });
    if (statusOnly) {
      console.log(`Database: ${config.dbPath}`);
      for (const migration of migrations) {
        const state = result.pending.includes(migration.version) ? 'pending' : 'applied';
        console.log(`  [${state}] ${migration.version} — ${migration.description}`);
      }
    } else {
      if (result.applied.length === 0) {
        console.log(`Database schema already up to date: ${config.dbPath}`);
      } else {
        console.log(`Database migration complete: ${config.dbPath}`);
        for (const version of result.applied) console.log(`  applied ${version}`);
      }
    }
  } catch (error) {
    console.error(`Database migration failed safely: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (db) db.close();
  }
}

module.exports = { migrate };
