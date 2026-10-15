'use strict';
const { wrap, readJson, HttpError } = require('../../lib/http');
const { authenticate, requireAdmin } = require('../../lib/auth');
const { getDb, getAdmin } = require('../../lib/firebase');
const { parseIssueId, parsePatch } = require('../../lib/validate');
const { serializeIssue } = require('../../lib/serialize');

/* GET /api/issues/:id — any signed-in user. */
async function get(req) {
  const user = await authenticate(req);
  const id = parseIssueId(req.query.id);
  const snap = await getDb().doc('issues/' + id).get();
  if (!snap.exists) { throw new HttpError(404, 'Issue not found'); }
  return serializeIssue(id, snap.data(), user);
}

/* PATCH /api/issues/:id — admin only. Body: { status?, team?, priority?, note?: { text, internal } } */
async function patch(req) {
  const adminUser = await requireAdmin(req);
  const id = parseIssueId(req.query.id);
  const body = parsePatch(readJson(req));
  const db = getDb();
  const { Timestamp, FieldValue } = getAdmin().firestore;
  const ref = db.doc('issues/' + id);

  const merged = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) { throw new HttpError(404, 'Issue not found'); }
    const d = snap.data();
    const nowTs = Timestamp.now();
    const nowIso = nowTs.toDate().toISOString();
    const upd = { updatedAt: nowTs };

    let status = body.status;
    if (body.team !== undefined) {
      upd.team = body.team;
      // Assigning a team to a brand-new ticket moves it to "Assigned" (unless a status was set explicitly).
      if (body.team && d.status === 'New' && status === undefined) { status = 'Assigned'; }
    }
    if (body.priority !== undefined) { upd.priority = body.priority; }

    if (status !== undefined && status !== d.status) {
      upd.status = status;
      upd.history = (d.history || []).concat([{ status, at: nowIso }]);
      if (status === 'Closed') { upd.closedAt = nowTs; }
      else if (d.status === 'Closed') { upd.closedAt = FieldValue.delete(); }
    }
    if (body.note) {
      upd.notes = (d.notes || []).concat([{
        at: nowIso,
        by: adminUser.name || adminUser.email || 'Ops Desk',
        text: body.note.text,
        internal: body.note.internal
      }]);
    }

    tx.update(ref, upd);
    const out = Object.assign({}, d, upd);
    if (out.status !== 'Closed') { out.closedAt = null; }
    return out;
  });

  return serializeIssue(id, merged, adminUser);
}

/* DELETE /api/issues/:id — admin only (spam/abuse removal). */
async function remove(req) {
  await requireAdmin(req);
  const id = parseIssueId(req.query.id);
  const ref = getDb().doc('issues/' + id);
  const snap = await ref.get();
  if (!snap.exists) { throw new HttpError(404, 'Issue not found'); }
  await ref.delete();
  return { deleted: id };
}

module.exports = wrap({ GET: get, PATCH: patch, DELETE: remove });
