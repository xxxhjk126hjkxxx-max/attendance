# Attendance management migration and status

The server now runs `migrate.js` before startup (`npm start`). The migration checks the actual SQLite schema and is safe to rerun. If it finds the original attendance table without a lecture ID, it renames that table to `attendance_legacy_archive` and creates the scheduled-lecture attendance schema. Legacy rows remain preserved, but are deliberately excluded from lecture attendance calculations because they cannot be reliably associated with a real lecture or enrollment. Back up `.data/attendance.sqlite` before deploying any schema change.

## Run and verify

```sh
npm install
npm test
ADMIN_EMAIL=admin@example.edu ADMIN_PASSWORD='use-a-long-unique-secret' npm start
```

The API supports creating/listing lectures, enrolling actual students, filtered attendance queries, QR attendance scans, and administrator-entered status changes. Attendance uniqueness is enforced by SQLite on `(lecture_id, student_id)`. The current server authenticates these routes as the configured administrator. Manual corrections are audited with the admin identity, old/new status, timestamp, and reason.

Important: the current browser pages are not yet a complete lecture/attendance administration interface. The API does not provide push-based real-time updates; the client must poll or an SSE/WebSocket implementation must be added. Do not treat this phase as fully production-ready until routes are exercised against a backed-up database, auth is hardened for deployment, and the dashboard UI is connected to these endpoints.
