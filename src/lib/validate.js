'use strict';

const { unprocessable } = require('./errors');

/** Escapes a string for safe embedding in HTML (defence in depth; the UI also escapes). */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function str(value, { max = 200, min = 0 } = {}) {
  const out = String(value ?? '').trim();
  if (out.length > max) return out.slice(0, max);
  if (out.length < min) return '';
  return out;
}

function required(value, label, { max = 200 } = {}) {
  const out = str(value, { max });
  if (!out) throw unprocessable(`${label} is required.`, {});
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function dateOnly(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (DATE_RE.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d) return raw;
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function timeOnly(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function int(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return fallback;
  if (parsed > max) return fallback;
  return parsed;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function email(value, { optional = true } = {}) {
  const raw = str(value, { max: 160 }).toLowerCase();
  if (!raw) {
    if (optional) return null;
    throw unprocessable('Email address is required.', { email: 'Email address is required.' });
  }
  if (!EMAIL_RE.test(raw)) throw unprocessable('Enter a valid email address.', { email: 'Enter a valid email address.' });
  return raw;
}

const PHONE_RE = /^[+()\d\s-]{6,25}$/;

function phone(value) {
  const raw = str(value, { max: 25 });
  if (!raw) return null;
  if (!PHONE_RE.test(raw)) throw unprocessable('Enter a valid phone number.', { phone: 'Enter a valid phone number.' });
  return raw;
}

/** Converts "HH:MM" into minutes since midnight for window comparisons. */
function minutesOfDay(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function pagination(query, { defaultSize = 10, maxSize = 100 } = {}) {
  // Out-of-range values are clamped (not silently reset) so ``pageSize=999``
  // behaves predictably and a huge value can never force an expensive query.
  const page = Math.min(100000, Math.max(1, int(query.get('page'), { fallback: 1 }) || 1));
  const pageSize = Math.min(maxSize, Math.max(1, int(query.get('pageSize'), { fallback: defaultSize }) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = {
  escapeHtml, str, required, dateOnly, timeOnly, int, bool, email, phone,
  minutesOfDay, pagination, DATE_RE, TIME_RE, EMAIL_RE
};
