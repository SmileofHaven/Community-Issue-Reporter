'use strict';
const { wrap, created, readJson, HttpError } = require('../../lib/http');
const { authenticate } = require('../../lib/auth');
const { getDb, getAdmin } = require('../../lib/firebase');
const { parseNewIssue, parseListQuery } = require('../../lib/validate');
const { serializeIssue } = require('../../lib/serialize');
const { LIMITS } = require('../../lib/config');
const geo = require('../../lib/geo');
const { autoAssign } = require('../../lib/autoassign');
const { waitUntil } = require('@vercel/functions');

function matchesStatus(status, filter) {
  if (filter === 'open') { return status !== 'Closed'; }
  if (filter === 'fixed') { return status === 'Closed'; }
  return true;
}

/* GET /api/issues?lat&lng&radiusKm&status=open|fixed|all&limit   -> issues near a point, nearest first
   GET /api/issues?mine=1                                         -> issues reported by the caller */
async function list(req) {
  const user = await authenticate(req);
  const q = parseListQuery(req.query || {});
  const db = getDb();

  if (q.mine) {
    const snap = await db.collection('issues').where('reporterUid', '==', user.uid).limit(200).get();
    const issues = snap.docs
      .map((d) => serializeIssue(d.id, d.data(), user))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return { issues, count: issues.length };
  }

  const center = [q.lat, q.lng];
  const bounds = geo.boundsFor(q.lat, q.lng, q.radiusKm);
  const snaps = await Promise.all(bounds.map((b) =>
    db.collection('issues').orderBy('geohash').startAt(b[0]).endAt(b[1]).get()));

  const found = new Map();
  snaps.forEach((s) => s.docs.forEach((doc) => {
    if (found.has(doc.id)) { return; }
    const data = doc.data();
    const dist = geo.distanceKm(center, [data.lat, data.lng]);
    // Geohash ranges over-fetch the surrounding cells: drop false positives with the exact distance.
    if (dist > q.radiusKm || !matchesStatus(data.status, q.status)) { return; }
    found.set(doc.id, { doc, dist });
  }));

  const rows = Array.from(found.values()).sort((a, b) => a.dist - b.dist).slice(0, q.limit);
  return {
    issues: rows.map((r) => serializeIssue(r.doc.id, r.doc.data(), user, { distanceKm: Math.round(r.dist * 100) / 100 })),
    count: rows.length,
    center: { lat: q.lat, lng: q.lng },
    radiusKm: q.radiusKm
  };
}

/* POST /api/issues — create a report. Server decides id, status, reporter and timestamps. */
async function create(req) {
  const user = await authenticate(req);
  const input = parseNewIssue(readJson(req), process.env.CLOUDINARY_CLOUD_NAME);
  const admin = getAdmin();
  const db = getDb();
  const Timestamp = admin.firestore.Timestamp;

  const counterRef = db.doc('meta/counters');
  const userRef = db.doc('users/' + user.uid);
  let issueId;
  let doc;

  await db.runTransaction(async (tx) => {
    const [counter, profile] = await Promise.all([tx.get(counterRef), tx.get(userRef)]);

    // Cheap anti-spam: one report per cooldown window per user.
    const last = profile.exists && profile.data().lastReportAt ? profile.data().lastReportAt.toMillis() : 0;
    if (Date.now() - last < LIMITS.reportCooldownMs) {
      throw new HttpError(429, 'Please wait a few seconds before submitting another report');
    }

    const next = (counter.exists ? counter.data().issue : 1000) + 1;
    issueId = 'CF-' + next;
    const now = Timestamp.now();
    const iso = now.toDate().toISOString();
    /* reporterName: per-report display name provided by the user. Falls back to a sanitised email
       local part so older clients and missing-name reports still get a sensible attribution. */
    const fallbackName = (user.email || 'Citizen').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const reporterName = (input.reporterName && input.reporterName.trim()) || user.name || fallbackName;
    doc = {
      title: input.title,
      description: input.description,
      category: input.category,
      priority: input.priority,
      status: 'New',
      team: '',
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      geohash: geo.hashFor(input.lat, input.lng),
      photos: input.photos,
      notes: [],
      history: [{ status: 'New', at: iso }],
      reporterUid: user.uid,
      reporterEmail: user.email,
      reporterName: reporterName.slice(0, 60),
      createdAt: now,
      updatedAt: now
    };

    tx.set(counterRef, { issue: next }, { merge: true });
    tx.set(userRef, { uid: user.uid, email: user.email, name: user.name, role: user.role, lastReportAt: now }, { merge: true });
    tx.set(db.doc('issues/' + issueId), doc);
  });

  // ai triage runs after the response => reporter does not wait
  waitUntil(autoAssign(db, issueId));

  return created(serializeIssue(issueId, doc, user));
}

module.exports = wrap({ GET: list, POST: create });