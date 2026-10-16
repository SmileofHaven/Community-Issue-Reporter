'use strict';
const { triage } = require('./triage');
const { getAdmin } = require('./firebase');

// runs after the response is sent => never throws, never blocks the reporter
async function autoAssign(db, issueId, triageFn) {
  try {
    const ref = db.doc('issues/' + issueId);
    const snap = await ref.get();
    if (!snap.exists) { return; }
    const d = snap.data();
    const ai = await (triageFn || triage)({
      title: d.title,
      description: d.description,
      category: d.category,
      priority: d.priority,
      photos: d.photos || []
    });
    if (!ai) { return; }

    const Timestamp = getAdmin().firestore.Timestamp;
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (!cur.exists) { return; }
      const c = cur.data();
      // an admin already acted on it => leave their work alone
      if (c.status !== 'New' || c.team) { return; }
      const now = Timestamp.now();
      const upd = {
        category: ai.category,
        priority: ai.priority,
        ai: { category: ai.category, priority: ai.priority, reason: ai.reason, confidence: ai.confidence },
        updatedAt: now
      };
      if (ai.team) {
        upd.team = ai.team;
        upd.status = 'Assigned';
        upd.history = (c.history || []).concat([{ status: 'Assigned', at: now.toDate().toISOString() }]);
      }
      tx.update(ref, upd);
    });
  } catch (e) {
    // triage is best effort => report stays as submitted
  }
}

module.exports = { autoAssign };
