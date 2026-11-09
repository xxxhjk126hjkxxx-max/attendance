'use strict';

const argon2 = require('@node-rs/argon2');
const { config, validatePassword } = require('../config');
const { randomToken, hashToken, timingSafeEqualString } = require('../lib/security');
const { AppError, unauthorized, forbidden, tooMany, unprocessable, conflict, notFound } = require('../lib/errors');
const { permissionsFor, ROLE_LABELS } = require('./permissions');

const ARGON_OPTIONS = {
  // Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
};

async function hashPassword(password) {
  const errors = validatePassword(password);
  if (errors.length) throw unprocessable(errors[0], { password: errors[0] });
  return argon2.hash(String(password), ARGON_OPTIONS);
}

function createAuthService(db, { audit }) {
  const selectUserByUsername = db.prepare(`
    SELECT u.*, r.key AS role FROM users u JOIN roles r ON r.id = u.role_id
    WHERE lower(u.username) = lower(?)
  `);
  const selectUserById = db.prepare(`
    SELECT u.*, r.key AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?
  `);
  const selectUserByEmail = db.prepare(`
    SELECT u.*, r.key AS role FROM users u JOIN roles r ON r.id = u.role_id
    WHERE lower(u.email) = lower(?) AND u.email IS NOT NULL
  `);

  const publicUser = row => row && {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || { en: row.role, ar: row.role },
    permissions: permissionsFor(row.role),
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at
  };

  const recentFailures = db.prepare(`
    SELECT COUNT(*) AS count FROM login_attempts
    WHERE identifier = ? AND success = 0 AND attempted_at >= datetime('now', ?)
  `);
  const recordAttempt = db.prepare(
    'INSERT INTO login_attempts (identifier, ip, success) VALUES (?, ?, ?)'
  );

  function throttled(identifier) {
    const windowMinutes = `-${Math.max(1, Math.round(config.limits.loginWindowMs / 60000))} minutes`;
    const row = recentFailures.get(String(identifier).toLowerCase(), windowMinutes);
    return row.count >= config.limits.loginMaxAttempts;
  }

  async function login({ identifier, password, ip, userAgent }) {
    const key = String(identifier || '').trim().toLowerCase();
    if (!key || !password) throw unprocessable('Username and password are required.');
    if (throttled(key)) {
      const minutes = Math.round(config.limits.loginWindowMs / 60000);
      throw tooMany(`Too many failed sign-in attempts. Try again in ${minutes} minutes.`, minutes * 60);
    }

    const user = selectUserByUsername.get(key) || selectUserByEmail.get(key);
    const valid = user ? await argon2.verify(user.password_hash, String(password)).catch(() => false) : false;

    if (!user || !valid) {
      recordAttempt.run(key, ip, 0);
      audit.record({
        actor: { username: key },
        action: 'auth.login_failed',
        entityType: 'user',
        details: { identifier: key },
        ip
      });
      throw unauthorized('Invalid username or password.');
    }
    if (user.status !== 'active') {
      recordAttempt.run(key, ip, 0);
      throw forbidden('This account has been disabled. Contact a super administrator.');
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw forbidden('This account is temporarily locked. Try again later.');
    }

    recordAttempt.run(key, ip, 1);
    db.prepare('DELETE FROM login_attempts WHERE identifier = ? AND attempted_at < datetime(\'now\', \'-1 day\')').run(key);

    const token = randomToken(32);
    const csrf = randomToken(24);
    const expiresAt = new Date(Date.now() + config.sessionTtlMs);
    db.prepare(`
      INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(hashToken(token), user.id, csrf, ip, String(userAgent || '').slice(0, 300), expiresAt.toISOString());
    db.prepare("UPDATE users SET last_login_at = datetime('now'), failed_attempts = 0, locked_until = NULL WHERE id = ?").run(user.id);

    audit.record({ actor: user, action: 'auth.login', entityType: 'user', entityId: user.id, ip });

    return {
      token,
      csrfToken: csrf,
      expiresAt: expiresAt.toISOString(),
      user: publicUser(user)
    };
  }

  function getSession(token) {
    if (!token) return null;
    const row = db.prepare(`
      SELECT s.token_hash, s.csrf_token, s.expires_at, s.user_id,
             u.username, u.email, u.full_name, u.status, u.must_change_password, r.key AS role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = ?
    `).get(hashToken(token));
    if (!row) return null;
    if (new Date(row.expires_at) <= new Date()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
      return null;
    }
    if (row.status !== 'active') {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
      return null;
    }
    db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE token_hash = ?").run(row.token_hash);
    return {
      tokenHash: row.token_hash,
      csrf_token: row.csrf_token,
      userId: row.user_id,
      role: row.role,
      username: row.username,
      email: row.email,
      fullName: row.full_name,
      mustChangePassword: Boolean(row.must_change_password),
      expiresAt: row.expires_at
    };
  }

  function logout(tokenHash, actor, ip) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    audit.record({ actor, action: 'auth.logout', entityType: 'user', entityId: actor?.id, ip });
  }

  function purgeExpiredSessions() {
    return db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run().changes;
  }

  async function changePassword(userId, { currentPassword, newPassword }, { ip, actor } = {}) {
    const user = selectUserById.get(userId);
    if (!user) throw notFound('User not found.');
    const valid = await argon2.verify(user.password_hash, String(currentPassword || '')).catch(() => false);
    if (!valid) throw unprocessable('Current password is incorrect.', { currentPassword: 'Current password is incorrect.' });
    if (timingSafeEqualString(currentPassword, newPassword)) {
      throw unprocessable('The new password must be different from the current password.', { newPassword: 'Choose a different password.' });
    }
    const hash = await hashPassword(newPassword);
    db.prepare(`
      UPDATE users SET password_hash = ?, must_change_password = 0,
        password_changed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(hash, userId);
    // Invalidate every other session for this account after a password change.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    audit.record({ actor: actor || user, action: 'auth.password_changed', entityType: 'user', entityId: userId, ip });
  }

  /** Issues a single-use password reset token. Returned to the caller for delivery. */
  function createPasswordReset(identifier, { ip } = {}) {
    const key = String(identifier || '').trim();
    const user = selectUserByUsername.get(key) || selectUserByEmail.get(key);
    if (!user) return null; // Do not reveal whether the account exists.
    const token = randomToken(32);
    db.prepare(`
      INSERT INTO password_resets (token_hash, user_id, expires_at, requested_ip)
      VALUES (?, ?, datetime('now', '+1 hour'), ?)
    `).run(hashToken(token), user.id, ip || null);
    audit.record({ actor: { username: key }, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id, ip });
    return { token, user: publicUser(user) };
  }

  async function completePasswordReset({ token, newPassword }, { ip } = {}) {
    const row = db.prepare(`
      SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
    `).get(hashToken(String(token || '')));
    if (!row) throw unprocessable('This reset link is invalid or has expired.', { token: 'Invalid or expired reset token.' });
    const hash = await hashPassword(newPassword);
    const run = db.transaction(() => {
      db.prepare(`
        UPDATE users SET password_hash = ?, must_change_password = 0,
          password_changed_at = datetime('now'), updated_at = datetime('now'),
          failed_attempts = 0, locked_until = NULL
        WHERE id = ?
      `).run(hash, row.user_id);
      db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(row.token_hash);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    });
    run();
    audit.record({ actor: { username: 'system' }, action: 'auth.password_reset_completed', entityType: 'user', entityId: row.user_id, ip });
  }

  /**
   * First-run administrator bootstrap. Never overwrites an existing account and
   * refuses to start with a missing or weak ADMIN_PASSWORD.
   */
  async function ensureInitialAdmin({ username, password, email, fullName }) {
    const existing = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role_id = (SELECT id FROM roles WHERE key = 'super_admin')").get();
    if (existing.count > 0) return { created: false, reason: 'A super administrator already exists.' };

    if (!password) {
      return {
        created: false,
        error: 'ADMIN_PASSWORD is not set. Administrator account was not created. Set a strong ADMIN_PASSWORD (12+ characters) and restart.'
      };
    }
    const errors = validatePassword(password);
    if (errors.length) {
      return { created: false, error: `ADMIN_PASSWORD is too weak: ${errors.join(' ')} Administrator account was not created.` };
    }
    if (selectUserByUsername.get(username)) {
      return { created: false, error: `Username "${username}" already exists; refusing to overwrite it.` };
    }

    const hash = await argon2.hash(password, ARGON_OPTIONS);
    const roleId = db.prepare("SELECT id FROM roles WHERE key = 'super_admin'").get().id;
    const info = db.prepare(`
      INSERT INTO users (username, email, full_name, password_hash, role_id, status, must_change_password, password_changed_at)
      VALUES (?, ?, ?, ?, ?, 'active', 1, NULL)
    `).run(username, email || null, fullName || 'System Administrator', hash, roleId);

    audit.record({
      actor: { username: 'system' },
      action: 'auth.initial_admin_created',
      entityType: 'user',
      entityId: info.lastInsertRowid,
      details: { username, role: 'super_admin' }
    });
    return { created: true, id: info.lastInsertRowid };
  }

  async function createUser({ username, email, fullName, password, role }, actor, { ip } = {}) {
    const cleanUsername = String(username || '').trim();
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(cleanUsername)) {
      throw unprocessable('Username must be 3–40 characters (letters, numbers, . _ -).', { username: 'Invalid username.' });
    }
    if (!['super_admin', 'admin', 'instructor'].includes(role)) {
      throw unprocessable('Select a valid role.', { role: 'Invalid role.' });
    }
    if (selectUserByUsername.get(cleanUsername)) {
      throw conflict('That username is already taken.', { username: 'Username already exists.' });
    }
    const hash = await hashPassword(password);
    const roleId = db.prepare('SELECT id FROM roles WHERE key = ?').get(role).id;
    const info = db.prepare(`
      INSERT INTO users (username, email, full_name, password_hash, role_id, must_change_password)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(cleanUsername, email || null, String(fullName || cleanUsername).trim(), hash, roleId);
    audit.record({ actor, action: 'users.created', entityType: 'user', entityId: info.lastInsertRowid, details: { username: cleanUsername, role }, ip });
    return publicUser(selectUserById.get(info.lastInsertRowid));
  }

  async function updateUser(id, { email, fullName, role, status, password }, actor, { ip } = {}) {
    const user = selectUserById.get(id);
    if (!user) throw notFound('User not found.');
    const nextRole = role && ['super_admin', 'admin', 'instructor'].includes(role) ? role : user.role;
    const nextStatus = status === 'disabled' || status === 'active' ? status : user.status;

    if (user.id === actor?.id && (nextStatus === 'disabled' || nextRole !== user.role)) {
      throw unprocessable('You cannot disable your own account or change your own role.');
    }
    if (user.role === 'super_admin' && (nextRole !== 'super_admin' || nextStatus !== 'active')) {
      const remaining = db.prepare(`
        SELECT COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.key = 'super_admin' AND u.status = 'active' AND u.id <> ?
      `).get(user.id).count;
      if (remaining === 0) throw unprocessable('At least one active super administrator must remain.');
    }

    const roleId = db.prepare('SELECT id FROM roles WHERE key = ?').get(nextRole).id;
    db.prepare(`
      UPDATE users SET email = ?, full_name = ?, role_id = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(email ?? user.email, String(fullName || user.full_name).trim(), roleId, nextStatus, id);

    if (password) {
      const hash = await hashPassword(password);
      db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = NULL WHERE id = ?").run(hash, id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (nextStatus === 'disabled') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);

    audit.record({ actor, action: 'users.updated', entityType: 'user', entityId: id, details: { role: nextRole, status: nextStatus, passwordReset: Boolean(password) }, ip });
    return publicUser(selectUserById.get(id));
  }

  function listUsers() {
    const rows = db.prepare(`
      SELECT u.*, r.key AS role FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.created_at, u.id
    `).all();
    return rows.map(publicUser);
  }

  function deleteUser(id, actor, { ip } = {}) {
    const user = selectUserById.get(id);
    if (!user) throw notFound('User not found.');
    if (user.id === actor?.id) throw unprocessable('You cannot delete your own account.');
    if (user.role === 'super_admin') {
      const remaining = db.prepare(`
        SELECT COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.key = 'super_admin' AND u.status = 'active' AND u.id <> ?
      `).get(id).count;
      if (remaining === 0) throw unprocessable('At least one active super administrator must remain.');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit.record({ actor, action: 'users.deleted', entityType: 'user', entityId: id, details: { username: user.username }, ip });
  }

  return {
    publicUser,
    login,
    getSession,
    logout,
    purgeExpiredSessions,
    changePassword,
    hashPassword,
    validatePassword,
    createPasswordReset,
    completePasswordReset,
    ensureInitialAdmin,
    createUser,
    updateUser,
    listUsers,
    deleteUser,
    getUserById: id => publicUser(selectUserById.get(id)),
    findByUsername: username => selectUserByUsername.get(username)
  };
}

module.exports = { createAuthService, hashPassword, AppError };
