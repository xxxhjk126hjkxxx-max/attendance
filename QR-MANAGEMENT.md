# QR module — moved

This module is now part of the unified application documented in
[README.md](README.md).

The earlier note described a separate static page (`/students.html`) backed by
a standalone `assets/` bundle. That page has been retired: the functionality
lives in the single-page application served at `/`, behind the authenticated
API, with server-side permissions and database persistence.

* Setup, architecture and API: [README.md](README.md)
* Current status and verified test results: [DELIVERY-REPORT.md](DELIVERY-REPORT.md)
* Design and behaviour of the QR system: README → "QR code system"
* Attendance rules and audit behaviour: README → "Attendance rules"
