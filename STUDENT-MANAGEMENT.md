# Student management module

The original repository was a static HTML dashboard and had no API server or database. This addition keeps that dashboard intact and adds a small Node.js API with SQLite persistence plus a dedicated student-management screen at `/students.html`.

## Run locally

Requires Node.js 20+ and a password-protected administrator account configured through environment variables. Do not commit credentials.

```sh
npm install
ADMIN_EMAIL=admin@example.edu ADMIN_PASSWORD='use-a-long-unique-secret' npm start
```

Open `http://localhost:3000/students.html`. This module's sign-in uses the server-configured admin account; the original dashboard's demo login has not been converted to real authentication. The SQLite database is created at `.data/attendance.sqlite` by default (or set `DB_PATH`). Back up this file appropriately.

## API

All `/api/students` and `/api/attendance` routes require a bearer session token issued by `POST /api/auth/login`. Sessions are in-memory, administrator-only, and expire after eight hours. The server validates input and uses parameterized SQL statements.

- `GET /api/students?search=&course=&level=&page=1&pageSize=10` — filtered, paginated list and filter options.
- `POST /api/students` — create; `id`, `name`, `course`, and `level` required. Duplicate IDs return `409`.
- `GET /api/students/:id` and `PUT /api/students/:id` — student profile and update (ID is immutable).
- `DELETE /api/students/:id` — delete student; attendance history is retained.
- `GET /api/students/:id/attendance` — individual attendance history (up to 500 most recent entries).
- `POST /api/attendance` — record an attendance event for a registered student.

The existing dashboard still uses its own browser-local data and demo sign-in; it has not been silently switched to the new API. Production use requires HTTPS, a managed secret, backups, and integration of the existing attendance scanner with the API.
