'use strict';

/** Writes an immutable audit trail entry. Never throws into the request path. */
function createAuditLogger(db) {
  const insert = db.prepare(`
    INSERT INTO audit_logs (actor_id, actor_username, action, entity_type, entity_id, details, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  function record({ actor, action, entityType, entityId = null, details = null, ip = null }) {
    try {
      insert.run(
        actor?.id ?? null,
        actor?.username || actor?.email || 'system',
        String(action).slice(0, 80),
        String(entityType).slice(0, 60),
        entityId === null || entityId === undefined ? null : String(entityId).slice(0, 120),
        details ? JSON.stringify(details).slice(0, 4000) : null,
        ip ? String(ip).slice(0, 60) : null
      );
    } catch (error) {
      console.error('Audit log write failed:', error.message);
    }
  }

  function list({ page = 1, pageSize = 25, entityType, action, actor, search } = {}) {
    const where = [];
    const params = [];
    if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
    if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
    if (actor) { where.push('actor_username LIKE ?'); params.push(`%${actor}%`); }
    if (search) {
      where.push('(details LIKE ? OR entity_id LIKE ? OR action LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${clause}`).get(...params).count;
    const items = db.prepare(`
      SELECT id, actor_id AS actorId, actor_username AS actor, action,
             entity_type AS entityType, entity_id AS entityId, details, ip, created_at AS createdAt
      FROM audit_logs ${clause}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    return { items, total };
  }

  return { record, list };
}

module.exports = { createAuditLogger };
