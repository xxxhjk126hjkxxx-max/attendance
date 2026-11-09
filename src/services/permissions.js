'use strict';

/**
 * Role → permission matrix. Authorisation is enforced in the API layer for every
 * route; the interface only hides what a user cannot do.
 */
const PERMISSIONS = {
  super_admin: [
    'dashboard.view',
    'students.view', 'students.manage',
    'courses.view', 'courses.manage',
    'lectures.view', 'lectures.manage',
    'attendance.view', 'attendance.mark', 'attendance.correct', 'attendance.delete',
    'qr.view', 'qr.manage',
    'reports.view', 'reports.export',
    'users.manage', 'settings.manage', 'audit.view', 'backup.manage'
  ],
  admin: [
    'dashboard.view',
    'students.view', 'students.manage',
    'courses.view', 'courses.manage',
    'lectures.view', 'lectures.manage',
    'attendance.view', 'attendance.mark', 'attendance.correct',
    'qr.view', 'qr.manage',
    'reports.view', 'reports.export',
    'audit.view'
  ],
  instructor: [
    'dashboard.view',
    'students.view',
    'courses.view',
    'lectures.view',
    'attendance.view', 'attendance.mark',
    'qr.view',
    'reports.view'
  ]
};

const ROLE_LABELS = {
  super_admin: { en: 'Super Administrator', ar: 'مشرف عام' },
  admin: { en: 'Administrator', ar: 'مشرف' },
  instructor: { en: 'Instructor', ar: 'محاضر' }
};

function permissionsFor(role) {
  return PERMISSIONS[role] ? [...PERMISSIONS[role]] : [];
}

function can(user, permission) {
  if (!user || !user.role) return false;
  const list = PERMISSIONS[user.role];
  if (!list) return false;
  if (list.includes(permission)) return true;
  // A `.manage` permission always implies the matching `.view` permission.
  if (permission.endsWith('.view')) {
    return list.includes(permission.replace(/\.view$/, '.manage'));
  }
  return false;
}

/** Instructors are scoped to lectures they own or courses assigned to them. */
function isScopedRole(role) {
  return role === 'instructor';
}

module.exports = { PERMISSIONS, ROLE_LABELS, permissionsFor, can, isScopedRole };
