'use strict';

/**
 * Application entry point.
 *
 * 1. Loads configuration (environment variables, optional .env file).
 * 2. Opens the database and applies pending migrations.
 * 3. Creates the initial super administrator from ADMIN_PASSWORD when none exists.
 * 4. Starts the HTTP server.
 */

const { config } = require('./src/config');
const { createApplication } = require('./src/app');
const { createAuthService } = require('./src/services/auth');
const { createAuditLogger } = require('./src/services/audit');
const { createStudentService } = require('./src/services/students');

async function main() {
  const { server, db, migration } = createApplication({ dbPath: config.dbPath });

  if (migration.applied.length) {
    console.log(`Applied ${migration.applied.length} database migration(s): ${migration.applied.join(', ')}`);
  }

  const audit = createAuditLogger(db);
  const auth = createAuthService(db, { audit });
  const students = createStudentService(db, { audit });
  const issued = students.backfillQrTokens();
  if (issued) console.log(`Issued QR tokens for ${issued} student(s).`);

  const bootstrap = await auth.ensureInitialAdmin({
    username: config.admin.username,
    password: config.admin.password,
    email: config.admin.email,
    fullName: config.admin.fullName
  });

  if (bootstrap.created) {
    console.log(`Created initial super administrator "${config.admin.username}". A password change is required at first sign-in.`);
  } else if (bootstrap.error) {
    // Administrator login is impossible without a valid account, so refuse to
    // start rather than silently running an unsecured/unusable system.
    console.error('');
    console.error('  ADMINISTRATOR SETUP ERROR');
    console.error(`  ${bootstrap.error}`);
    console.error('');
    console.error('  Set a strong ADMIN_PASSWORD (12+ chars, mixed character classes) in the');
    console.error('  environment or .env file, then run `npm start` again.');
    console.error('  See README.md → "Initial administrator setup".');
    console.error('');
    db.close();
    process.exit(1);
  } else {
    console.log(`Administrator account already exists (${bootstrap.reason || 'no change'}).`);
  }

  auth.purgeExpiredSessions();
  const sessionSweeper = setInterval(() => auth.purgeExpiredSessions(), 30 * 60 * 1000);
  sessionSweeper.unref();

  server.listen(config.port, config.host, () => {
    console.log(`University Attendance System v${require('./package.json').version}`);
    console.log(`Environment : ${config.env}`);
    console.log(`Database    : ${config.dbPath}`);
    console.log(`Listening   : http://${config.host}:${config.port}`);
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down gracefully…`);
    clearInterval(sessionSweeper);
    server.close(() => {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
      db.close();
      console.log('Database closed. Bye.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', reason => console.error('Unhandled rejection:', reason));
}

main().catch(error => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
