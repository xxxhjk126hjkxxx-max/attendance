# University Attendance Management System

A database-driven attendance platform for a university academic affairs office:
student records, course and lecture scheduling, QR-based and manual attendance,
corrections with a full audit trail, analytics and real Excel/PDF exports — in
Arabic (RTL) and English (LTR).

Built on the repository's existing Node.js + SQLite stack. No framework, no
second backend, no client-side database.

---

## Table of contents

1. [Quick start](#quick-start)
2. [Configuration](#configuration)
3. [Initial administrator setup](#initial-administrator-setup)
4. [Architecture](#architecture)
5. [Data model](#data-model)
6. [Roles and permissions](#roles-and-permissions)
7. [API reference](#api-reference)
8. [QR code system](#qr-code-system)
9. [Attendance rules](#attendance-rules)
10. [Reports and exports](#reports-and-exports)
11. [Security](#security)
12. [Testing](#testing)
13. [Operations](#operations)
14. [Project layout](#project-layout)
15. [Troubleshooting](#troubleshooting)

---

## Quick start

Requirements: **Node.js 20+**, npm, and a C toolchain for `better-sqlite3`
(prebuilt binaries are used on common platforms).

```sh
npm install

export ADMIN_PASSWORD='use-a-long-unique-secret'   # 12+ chars, mixed classes
export ADMIN_EMAIL='admin@example.edu'
npm start
```

Open <http://localhost:3000> and sign in as `admin` with the password you set.
The account is flagged **must change password**, so the first sign-in is
followed by a mandatory password rotation.

Optional demo data (development only, refused when `NODE_ENV=production`):

```sh
npm run seed:demo
```

## Configuration

All configuration is read from the environment (a `.env` file is loaded
automatically when present). See [`.env.example`](.env.example) for the full
list. No value is ever committed to the repository.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables stricter checks and disables demo seeding |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | HTTP listener |
| `DB_PATH` | `./.data/attendance.sqlite` | SQLite database file |
| `ADMIN_USERNAME` | `admin` | Initial super administrator username |
| `ADMIN_PASSWORD` | — | Initial password; **required** on first start, must be strong |
| `ADMIN_EMAIL` | — | Initial administrator e-mail |
| `SESSION_TTL_HOURS` | `8` | Session lifetime |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers from a reverse proxy |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failed sign-ins before an account is throttled |
| `LOGIN_WINDOW_MINUTES` | `15` | Throttle window |
| `API_MAX_REQUESTS_PER_MINUTE` | `3000` | Global per-IP request budget |
| `UNIVERSITY_NAME_EN` / `_AR` | — | Name printed on PDF and Excel exports |

## Initial administrator setup

On start-up the application:

1. applies pending migrations;
2. issues QR tokens for students that do not have one;
3. creates the first super administrator **only when no super administrator
   exists**, hashing the password with Argon2id (`m=19456, t=2, p=1`).

If `ADMIN_PASSWORD` is missing or fails the password policy, start-up **stops**
with an explicit setup error — the server never runs without a usable
administrator, and an existing administrator is never recreated or reset.

## Architecture

```
server.js                 entry point: config → migrations → admin bootstrap → listen
src/config.js             environment parsing and validation
src/app.js               HTTP layer: routing, security middleware, error mapping
src/db/index.js           connection, PRAGMAs, migration runner
src/db/migrations/        versioned, idempotent, transactional schema changes
src/lib/                  http helpers, validation, security, i18n, Arabic shaping
src/services/             auth, students, courses, attendance, qr, reports, exports,
                          dashboard, permissions, audit
public/                   static SPA (design system + view modules)
test/                     unit, database and API integration tests
scripts/                  demo seeder, jsdom UI smoke test
```

Requests flow `app.js → route → service → database`, with validation at the
boundary (`src/lib/validate.js`) and errors normalised by `src/lib/errors.js`
(`AppError` → JSON `{ error, code, fields }`). Multi-table writes (bulk
attendance, lecture finalisation, enrollment changes) run inside
`db.transaction(...)`.

## Data model

`users`, `roles`, `sessions`, `login_attempts`, `password_resets`, `students`,
`courses`, `course_enrollments`, `lectures`, `lecture_enrollments`,
`lecture_students`, `attendance_sessions`, `attendance`, `attendance_audit`,
`audit_logs`, `settings`, `schema_migrations`.

Key guarantees:

* foreign keys are enabled on every connection;
* `attendance` has a unique `(lecture_id, student_id)` index — a student cannot
  be counted twice for one lecture;
* statuses are constrained to `present | absent | late | excused`;
* deletes are restricted or cascaded deliberately per relation (for example,
  removing a student cascades enrollments but attendance history is preserved
  through the audit log);
* migrations 001–005 upgrade the original single-table database in place,
  adopting legacy free-text course names as real courses and archiving the old
  table instead of dropping it.

## Roles and permissions

| Permission | Super Admin | Administrator | Instructor |
| --- | :-: | :-: | :-: |
| dashboard, students, courses, lectures (view) | ✓ | ✓ | ✓ |
| students, courses, lectures (manage) | ✓ | ✓ | — |
| attendance view / mark | ✓ | ✓ | ✓ |
| attendance correct / delete | ✓ | correct only | — |
| QR view | ✓ | ✓ | ✓ |
| QR rotate / revoke | ✓ | ✓ | — |
| reports view | ✓ | ✓ | ✓ |
| reports export | ✓ | ✓ | — |
| audit log | ✓ | ✓ | — |
| users, settings, backup | ✓ | — | — |

Permissions are enforced in `src/services/permissions.js` on the **server**, for
every route, before any data is read or written. Hiding a control in the UI is
never the security boundary. Instructor data access is additionally scoped to
the courses and lectures they own.

## API reference

All `/api/*` routes require authentication except `POST /api/auth/login`,
`POST /api/auth/forgot-password`, `POST /api/auth/reset-password` and
`GET /api/system/health`. Browser clients authenticate with an HttpOnly session
cookie plus a CSRF header; API clients may use `Authorization: Bearer <token>`
returned by the login endpoint.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Sign in; returns user + session/token |
| `GET` | `/api/auth/session` | Current user and permissions |
| `POST` | `/api/auth/logout` | Revoke the current session |
| `POST` | `/api/auth/change-password` | Rotate own password (invalidates other sessions) |
| `POST` | `/api/auth/forgot-password` | Issue a single-use, 1-hour reset link (logged; no SMTP configured) |
| `POST` | `/api/auth/reset-password` | Consume a reset token and set a new password |
| `GET` | `/api/dashboard` | KPIs, 14-day trend, course performance, recent activity |
| `GET/POST` | `/api/students` | Paginated list with search/filters; create |
| `GET` | `/api/students/options` | Lightweight list for pickers |
| `GET/PUT/DELETE` | `/api/students/:id` | Profile, update, delete |
| `GET` | `/api/students/:id/attendance` | Per-student attendance history and rate |
| `GET` | `/api/students/:id/qr` | QR payload (opaque token) |
| `GET` | `/api/students/:id/qr.png` | Server-rendered PNG card image |
| `POST` | `/api/students/:id/qr/rotate` | Issue a new token |
| `POST` | `/api/students/:id/qr/revoke` | Revoke the token |
| `GET` | `/api/students/:id/qr/card.pdf` | Printable A4 card (AR/EN) |
| `GET` | `/api/students/qr-cards/pdf` | Bulk card sheet |
| `GET/POST` | `/api/courses` | List (with `includeArchived`) and create |
| `GET/PUT/DELETE` | `/api/courses/:id` | Detail, update, delete or archive |
| `POST` | `/api/courses/:id/archive` \| `/restore` | Archive lifecycle |
| `GET/POST` | `/api/courses/:id/enrollments` | Roster and bulk enrollment |
| `DELETE` | `/api/courses/:id/enrollments/:studentId` | Drop a student |
| `GET/POST` | `/api/lectures` | List and schedule a lecture (snapshots the roster) |
| `GET/PUT/DELETE` | `/api/lectures/:id` | Detail, update, delete (blocked when attendance exists) |
| `POST` | `/api/lectures/:id/status` | `scheduled` \| `cancelled` \| `completed` |
| `POST` | `/api/lectures/:id/open-session` | Open an attendance session |
| `POST` | `/api/lectures/:id/finalize` | Mark unrecorded enrolled students absent |
| `GET` | `/api/attendance` | Filter by date, course, lecture, student, status |
| `POST` | `/api/attendance` | Mark one student |
| `POST` | `/api/attendance/bulk` | Mark a full roster in one transaction |
| `PUT/DELETE` | `/api/attendance/:id` | Correct or remove a record (audited) |
| `POST` | `/api/attendance/scan` | QR scan → attendance (409 on duplicate) |
| `GET` | `/api/attendance/audit` | Correction history |
| `POST` | `/api/qr/decode` | Decode an uploaded QR image |
| `GET` | `/api/reports/summary` | Aggregates by course, level, student, day |
| `GET` | `/api/reports/options` | Filter options |
| `GET` | `/api/reports/lecture/:id` | Lecture sheet |
| `GET` | `/api/reports/student/:id/pdf` | Student report PDF |
| `GET` | `/api/reports/export/xlsx` | Real XLSX (Office Open XML) |
| `GET` | `/api/reports/export/pdf` | Report PDF (AR or EN) |
| `GET/POST` | `/api/users` | Account administration (super admin) |
| `GET/PUT/DELETE` | `/api/users/:id` | Update role/status, deactivate |
| `GET` | `/api/audit-logs` | Searchable audit trail |
| `GET/PUT` | `/api/settings` | Academic year, semester, branding |
| `GET` | `/api/system/health` | Liveness, database and schema status |
| `GET` | `/api/system/backup` | Consistent SQLite snapshot download |

Errors use a consistent shape:

```json
{ "error": "Student is already enrolled in this course.", "code": "CONFLICT" }
```

Validation failures add a `fields` map: `{ "error": "...", "fields": { "id": "..." } }`.

## QR code system

* Payload: `{"v":1,"token":"<256-bit random, base64url>"}` — no name, student
  number, course or any other personal data.
* Tokens are stored hashed-indexed server-side and can be **rotated** or
  **revoked**; a revoked card stops working immediately.
* QR images are always rendered by the server (`/qr.png`), so the browser needs
  no QR library and the token never appears in client-side markup beyond the
  authenticated response.
* Scanning: camera scan in the browser (jsQR, bundled locally) or upload of a
  card photo (`POST /api/qr/decode`).
* Cards print A4, bilingual, with the university seal and the Cairo typeface.

## Attendance rules

* A student can only be marked for a lecture whose roster (`lecture_enrollments`)
  contains them — recorded absences are therefore derived from the scheduled
  course, never from a global "everyone attends daily" assumption.
* Canceled lectures refuse attendance; attendance windows
  (`attendance_opens_at` / `attendance_closes_at`) are honoured when set.
* `POST /api/attendance` is idempotent: identical re-submission returns `200`
  with `unchanged: true`; conflicting submissions require a correction.
* A duplicate QR scan returns `409 { "duplicate": true }`.
* Finalising a lecture marks **only unrecorded enrolled students** absent.
* `late` is resolved automatically from the lecture start time (+15 min) when a
  scan arrives after it; every manual change is written to `attendance_audit`
  with actor, previous status, new status and reason.
* Attendance rate = `(present + late) / roster × 100`.

## Reports and exports

* Dashboards and reports are computed from live SQL aggregates — no hardcoded
  numbers, no client-side storage.
* XLSX exports are genuine Office Open XML workbooks (generated with `exceljs`)
  with styled headers, frozen panes and per-sheet totals — not CSV renamed.
* PDF exports are generated with `pdfkit` and embedded Cairo, with Arabic text
  reshaped and reordered to visual order so reports are readable in Arabic.

## Security

| Control | Implementation |
| --- | --- |
| Password hashing | Argon2id, tuned memory/iterations, per-password salt |
| Password policy | 12+ characters, mixed classes, no username/email, common-password blocklist |
| Sessions | 256-bit random token, SHA-256 stored server-side, HttpOnly + SameSite=Lax, TTL and rotation |
| CSRF | Double-submit token, per-session, verified on every mutating request |
| Origin checks | Cross-origin state changes rejected |
| Brute force | Per-account/per-IP exponential throttle, failed attempts audited |
| SQL injection | Exclusive use of prepared statements with bound parameters |
| XSS | No `innerHTML` with user data (escaped templates), strict CSP with nonce for the single inline bootstrap script |
| Uploads | Size limit, MIME + magic-byte validation, decoded in memory, never written to disk |
| Headers | CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS behind HTTPS |
| Least privilege | Server-side RBAC, instructor data scoping, last-super-admin deletion guard |
| Auditing | Successful/failed sign-ins, CRUD, attendance corrections, exports, settings |
| Backups | On-demand consistent snapshot endpoint (super admin only) |

Secrets live only in the environment; `.env` and `*.sqlite` are git-ignored.

## Testing

```sh
npm test        # unit + database + API integration tests (node:test, no extra deps)
npm run test:ui # jsdom UI smoke test against a running server
```

The integration suite boots the real application on an ephemeral port with a
throwaway SQLite file and drives it over HTTP: session handling, forced password
change, CSRF rejection, RBAC 403s, 429 throttling, student CRUD and pagination,
SQL-injection payloads, QR issuance/rotation/revocation/scanning, attendance
deduplication and correction audit, lecture finalisation, dashboard maths,
XLSX/PDF magic bytes, audit logs, static-file traversal and payload limits.

UI smoke test:

```sh
rm -f .data/e2e.sqlite*
ADMIN_PASSWORD='Str0ng-Dev-Passw0rd!' ADMIN_EMAIL='admin@example.edu' \
  DB_PATH=.data/e2e.sqlite PORT=3101 node server.js &
DB_PATH=.data/e2e.sqlite node scripts/seed-demo.js
node scripts/browser-check.js
```

## Operations

* **Migrations**: `npm run migrate` (apply), `npm run migrate:status` (show).
  Each migration runs in a transaction and rolls back completely on failure.
* **Backups**: `GET /api/system/backup` streams a consistent snapshot, or copy
  the SQLite file while the service is stopped (WAL checkpoint happens on
  graceful shutdown).
* **Reverse proxy**: terminate TLS upstream, set `COOKIE_SECURE=true` and
  `TRUST_PROXY=true`.
* **Health check**: `GET /api/system/health` → `{ ok, database, schemaVersion, uptime }`.
* **Logs**: structured JSON lines on stdout (request method, path, status,
  duration, actor) plus the persistent `audit_logs` table for business events.

## Project layout

```
src/lib/http.js          request helpers, cookies, JSON responses, static files
src/lib/security.js      password policy, hashing wrapper, tokens, CSRF, rate limiting
src/lib/validate.js      input coercion and field-level validation
src/lib/arabic.js        Arabic reshaping for PDF output
src/lib/i18n.js          server-side message catalogue (AR/EN)
src/services/auth.js     sessions, login, password lifecycle, bootstrap admin
src/services/students.js CRUD, QR token lifecycle, per-student history
src/services/courses.js  courses, enrollment, archive
src/services/attendance.js marking, bulk marking, scanning, corrections, audit
src/services/qr.js       payloads, PNG rendering, printable cards
src/services/reports.js  filter building and SQL aggregates
src/services/exports.js  XLSX and PDF generation
public/assets/css/app.css  design tokens and component classes
public/assets/js/*.js      core, views, views-attendance, views-academic, views-admin, app
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `ADMINISTRATOR SETUP ERROR` on start | `ADMIN_PASSWORD` missing or too weak — set a 12+ character password |
| `429 Too Many Requests` while testing | Sign-in throttle; wait for the window or use a fresh database |
| `better-sqlite3` build error | Install build tools and match Node's ABI (`npm rebuild better-sqlite3`) |
| Arabic PDF shows disconnected letters | Cairo TTFs missing from `assets/fonts/` |
| Blank page after an upgrade | Hard-reload; the SPA is served with immutable asset caching |
