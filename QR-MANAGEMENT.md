# Secure QR code management

Student cards use an opaque, cryptographically random 256-bit bearer token in a versioned QR payload (`{"v":1,"token":"…"}`). No name, student number, course, or other personal information is encoded. Tokens are persisted in SQLite and only returned to an authenticated administrator. Existing students receive tokens during server startup migration.

## QR and scan API

Every endpoint below requires an administrator bearer token from `POST /api/auth/login`.

- `GET /api/students/:id/qr` — retrieve the student's active QR payload; revoked codes return `qr: null`.
- `GET /api/students/qr-cards` — list student card metadata and active QR tokens for authenticated bulk card generation.
- `POST /api/students/:id/qr/rotate` — issue a fresh token and invalidate the former token.
- `POST /api/students/:id/qr/revoke` — revoke a token; the student can be issued a new one later.
- `POST /api/attendance/scan` with `{ "qr": { "v": 1, "token": "…" } }` — validate active token server-side and record attendance. Invalid/revoked tokens fail; duplicate same-day attendance returns `409`.
- `POST /api/attendance` remains for authenticated manual attendance and also rejects duplicate same-day entries.

The student management page supports individual QR card viewing and PNG download, bulk generation, printing, token rotation, and revocation. A revoked card is shown without a scannable code. QR downloads are composed locally in the browser; the server does not store generated image files.

The endpoints are administrator-only, so scanning requires the authenticated management session. Do not treat a QR token as identity proof by itself: it is a bearer credential and can be copied. Use HTTPS in deployment and revoke/rotate a card if exposed. The existing main dashboard scanner remains its earlier local demo flow; connecting it to `/api/attendance/scan` is a separate integration step.
