'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePassword } = require('../src/config');
const { RateLimiter } = require('../src/lib/security');
const validate = require('../src/lib/validate');
const { hasArabic, preparePdfText } = require('../src/lib/arabic');
const { permissionsFor, can } = require('../src/services/permissions');

test('password policy rejects weak bootstrap passwords', () => {
  assert.ok(validatePassword('short').length > 0, 'short password rejected');
  assert.ok(validatePassword('alllowercaseonly').length > 0, 'single character class rejected');
  assert.ok(validatePassword('password').length > 0);
  assert.ok(validatePassword('A-Really-Long-Pass-2026!').length === 0, 'strong password accepted');
});

test('ratelimiter blocks after the configured number of hits and resets', () => {
  const limiter = new RateLimiter({ windowMs: 1000, max: 3 });
  assert.equal(limiter.key('a').allowed, true);
  assert.equal(limiter.key('a').allowed, true);
  assert.equal(limiter.key('a').allowed, true);
  assert.equal(limiter.key('a').allowed, false, 'fourth attempt blocked');
  assert.equal(limiter.key('b').allowed, true, 'other keys are independent');
  limiter.reset('a');
  assert.equal(limiter.key('a').allowed, true);
  limiter.sweep();
});

test('validators normalise dates, times and pagination safely', () => {
  assert.equal(validate.dateOnly('2026-02-28'), '2026-02-28');
  assert.equal(validate.dateOnly('2026-02-30'), null, 'invalid calendar date rejected');
  assert.equal(validate.dateOnly('not-a-date'), null);
  assert.equal(validate.timeOnly('9:05'), '09:05');
  assert.equal(validate.timeOnly('25:00'), null);
  assert.equal(validate.int('7', { min: 1 }), 7);
  assert.equal(validate.int('0', { min: 1, fallback: 5 }), 5);
  const query = new URLSearchParams('page=3&pageSize=999');
  const page = validate.pagination(query, { defaultSize: 10, maxSize: 100 });
  assert.deepEqual(page, { page: 3, pageSize: 100, offset: 200 });
  const fallback = validate.pagination(new URLSearchParams('page=abc'), { defaultSize: 20 });
  assert.deepEqual(fallback, { page: 1, pageSize: 20, offset: 0 });
});

test('escapeHtml neutralises script injection payloads', () => {
  const escaped = validate.escapeHtml('<img src=x onerror="alert(1)">');
  assert.ok(!escaped.includes('<'));
  assert.ok(escaped.includes('&lt;img'));
});

test('permission matrix enforces least privilege', () => {
  assert.equal(can({ role: 'super_admin' }, 'users.manage'), true);
  assert.equal(can({ role: 'admin' }, 'users.manage'), false, 'admins cannot manage accounts');
  assert.equal(can({ role: 'instructor' }, 'attendance.mark'), true);
  assert.equal(can({ role: 'instructor' }, 'students.manage'), false);
  assert.equal(can({ role: 'instructor' }, 'students.view'), true);
  assert.equal(can({ role: 'admin' }, 'students.manage'), true, '.manage implies .view');
  assert.equal(can(null, 'dashboard.view'), false);
  assert.ok(permissionsFor('super_admin').length > permissionsFor('instructor').length);
});

test('arabic text is shaped for PDF output while latin stays untouched', () => {
  assert.equal(hasArabic('الحضور'), true);
  assert.equal(hasArabic('Attendance'), false);
  const shaped = preparePdfText('الحضور والغياب');
  assert.ok(shaped.length > 0);
  assert.notEqual(shaped, 'الحضور والغياب', 'arabic text must be reshaped/reordered');
  assert.equal(preparePdfText('Attendance report'), 'Attendance report');
});

test('client ip honours forwarding headers only for trusted proxies', () => {
  const { clientIp } = require('../src/lib/http');
  const req = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, socket: { remoteAddress: '::ffff:10.0.0.1' } };
  assert.equal(clientIp(req), '10.0.0.1', 'spoofed header ignored by default');
  assert.equal(clientIp(req, { trustProxy: true }), '203.0.113.9', 'first hop used behind a trusted proxy');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } }), '127.0.0.1', 'ipv4-mapped addresses unwrapped');
});
