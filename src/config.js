'use strict';

/**
 * Central configuration.
 *
 * Values come from environment variables. A local `.env` file is loaded when
 * present (never overriding variables that are already set) so that `npm start`
 * behaves the same way in development and in production.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

const toBool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const config = {
  root: ROOT,
  env: NODE_ENV,
  isProduction,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || path.join(ROOT, '.data', 'attendance.sqlite'),
  sessionTtlMs: Number(process.env.SESSION_TTL_HOURS || 8) * 60 * 60 * 1000,
  // Cookies are only marked Secure when TLS is actually terminated in front of us.
  cookieSecure: toBool(process.env.COOKIE_SECURE, isProduction),
  trustProxy: toBool(process.env.TRUST_PROXY, isProduction),
  admin: {
    username: (process.env.ADMIN_USERNAME || 'admin').trim(),
    password: process.env.ADMIN_PASSWORD || '',
    email: (process.env.ADMIN_EMAIL || '').trim(),
    fullName: (process.env.ADMIN_NAME || 'System Administrator').trim()
  },
  university: {
    nameEn: process.env.UNIVERSITY_NAME_EN || 'International University of Africa',
    nameAr: process.env.UNIVERSITY_NAME_AR || 'جامعة أفريقيا العالمية',
    shortName: process.env.UNIVERSITY_SHORT_NAME || 'IUA'
  },
  limits: {
    jsonBodyBytes: 1024 * 1024,
    uploadBytes: 6 * 1024 * 1024,
    loginWindowMs: Number(process.env.LOGIN_WINDOW_MINUTES || 15) * 60 * 1000,
    loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 5),
    apiWindowMs: 60 * 1000,
    apiMaxRequests: Number(process.env.API_MAX_REQUESTS_PER_MINUTE || 3000)
  }
};

/** Password policy shared by first-run setup, password changes and admin creation. */
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'admin', 'admin123', 'administrator',
  '1234567890', '123456789012', 'qwertyuiop', 'letmein123', 'changeme123',
  'welcome12345', 'p@ssw0rd123', 'admin@12345'
]);

function validatePassword(password) {
  const errors = [];
  const value = String(password || '');
  if (value.length < 12) errors.push('Password must be at least 12 characters long.');
  if (value.length > 200) errors.push('Password must be at most 200 characters long.');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(value)).length;
  if (classes < 3) errors.push('Password must contain at least three of: lowercase letters, uppercase letters, digits, symbols.');
  if (WEAK_PASSWORDS.has(value.toLowerCase())) errors.push('That password is too common. Choose a unique password.');
  if (/^(.)\1+$/.test(value)) errors.push('Password must not repeat a single character.');
  return errors;
}

module.exports = { config, validatePassword, loadDotEnv, ROOT };
