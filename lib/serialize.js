'use strict';

function iso(ts) {
  return ts && typeof ts.toDate === 'function' ? ts.toDate().toISOString() : null;
}

/* Shapes a Firestore issue document for a given viewer.
   - everyone signed in sees the community feed (title, photos, status, location)
   - reporter identity is visible only to admins
   - internal notes are visible only to admins */
function serializeIssue(id, d, viewer, extra) {
  const isAdmin = viewer.role === 'admin';
  const out = {
    id,
    title: d.title,
    description: d.description,
    category: d.category,
    priority: d.priority,
    status: d.status,
    team: d.team || '',
    address: d.address || '',
    lat: d.lat,
    lng: d.lng,
    photos: d.photos || [],
    history: d.history || [],
    notes: (d.notes || [])
      .filter((n) => isAdmin || !n.internal)
      .map((n) => (isAdmin ? { at: n.at, by: n.by, text: n.text, internal: !!n.internal } : { at: n.at, by: n.by, text: n.text })),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
    closedAt: iso(d.closedAt),
    isMine: d.reporterUid === viewer.uid
  };
  if (isAdmin) { out.reporterEmail = d.reporterEmail || ''; }
  return Object.assign(out, extra || {});
}

module.exports = { serializeIssue, iso };
