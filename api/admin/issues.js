'use strict';
const { wrap } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { getDb } = require('../../lib/firebase');
const { parseAdminListQuery } = require('../../lib/validate');
const { serializeIssue } = require('../../lib/serialize');

/* GET /api/admin/issues?status&team&limit — everything, newest first, with reporter + internal notes. */
module.exports = wrap({
  GET: async (req) => {
    const admin = await requireAdmin(req);
    const q = parseAdminListQuery(req.query || {});
    const snap = await getDb().collection('issues').orderBy('createdAt', 'desc').limit(q.limit).get();
    const issues = snap.docs
      .filter((d) => (!q.status || d.data().status === q.status) && (!q.team || d.data().team === q.team))
      .map((d) => serializeIssue(d.id, d.data(), admin));
    return { issues, count: issues.length };
  }
});
