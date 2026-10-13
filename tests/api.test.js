'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fake = require('./fake-firebase');

const TOKENS = {
  user1: { uid: 'u1', email: 'u1@example.com', name: 'User One' },
  user2: { uid: 'u2', email: 'u2@example.com', name: 'User Two' },
  admin1: { uid: 'a1', email: 'ops@example.com', name: 'Ops', role: 'admin' }
};
const fb = fake.create(TOKENS);
const fbPath = require.resolve('../lib/firebase');
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: fb.exports };

process.env.CLOUDINARY_CLOUD_NAME = 'democloud';
process.env.CLOUDINARY_API_KEY = 'k';
process.env.CLOUDINARY_API_SECRET = 's';

const root = path.join(__dirname, '..');
const h = {
  me: require(path.join(root, 'api/me.js')),
  config: require(path.join(root, 'api/config.js')),
  upload: require(path.join(root, 'api/upload-signature.js')),
  issues: require(path.join(root, 'api/issues/index.js')),
  issue: require(path.join(root, 'api/issues/[id].js')),
  adminIssues: require(path.join(root, 'api/admin/issues.js'))
};
const geo = require('../lib/geo');

async function call(handler, { method = 'GET', token, query, body } = {}) {
  const res = { headers: {}, statusCode: 200, body: undefined };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  const req = { method, headers: token ? { authorization: 'Bearer ' + token } : {}, query: query || {}, body };
  await handler(req, res);
  return res;
}

const LAT = 16.705, LNG = 74.2433;
const photo = { url: 'https://res.cloudinary.com/democloud/image/upload/v1/civicfix/issues/p.jpg', name: 'p.jpg' };
const report = (extra) => Object.assign({ title: 'Deep pothole', description: 'Pothole on the main road near the market', lat: LAT, lng: LNG, category: 'pothole', photos: [photo] }, extra);
const resetCooldown = () => fb.store.forEach((d, p) => { if (p.startsWith('users/')) { delete d.lastReportAt; } });

test('auth + method guards', async () => {
  assert.equal((await call(h.issues)).statusCode, 401);
  assert.equal((await call(h.issues, { token: 'nope' })).statusCode, 401);
  const r = await call(h.me, { method: 'POST', token: 'user1' });
  assert.equal(r.statusCode, 405);
  assert.equal(r.headers.Allow, 'GET');
  assert.equal((await call(h.adminIssues, { token: 'user1' })).statusCode, 403);
  assert.equal((await call(h.issue, { method: 'PATCH', token: 'user1', query: { id: 'CF-1001' }, body: { status: 'Closed' } })).statusCode, 403);
  assert.equal((await call(h.issue, { method: 'DELETE', token: 'user1', query: { id: 'CF-1001' } })).statusCode, 403);
});

test('GET /api/me creates the profile; role comes from the token claim only', async () => {
  const u = await call(h.me, { token: 'user1' });
  assert.equal(u.body.role, 'user');
  assert.equal(fb.store.get('users/u1').email, 'u1@example.com');
  assert.equal((await call(h.me, { token: 'admin1' })).body.role, 'admin');
});

test('config is public and cacheable; upload signature needs auth', async () => {
  const c = await call(h.config);
  assert.equal(c.statusCode, 200);
  assert.ok(c.body.categories.length && c.body.teams.length);
  assert.match(c.headers['Cache-Control'], /s-maxage/);
  assert.equal((await call(h.upload, { method: 'POST' })).statusCode, 401);
  const s = await call(h.upload, { method: 'POST', token: 'user1' });
  assert.equal(s.statusCode, 200);
  assert.equal(s.body.cloudName, 'democloud');
  assert.equal(s.body.apiSecret, undefined);
});

test('POST /api/issues: creates CF-1001, server-controlled fields, cooldown, sequential ids', async () => {
  const r = await call(h.issues, { method: 'POST', token: 'user1', body: report({ status: 'Closed', reporterUid: 'hacker', id: 'CF-9' }) });
  assert.equal(r.statusCode, 201);
  assert.equal(r.body.id, 'CF-1001');
  assert.equal(r.body.status, 'New');
  assert.equal(r.body.isMine, true);
  const saved = fb.store.get('issues/CF-1001');
  assert.equal(saved.reporterUid, 'u1');
  assert.equal(saved.geohash, geo.hashFor(LAT, LNG));
  assert.equal(saved.history[0].status, 'New');

  const again = await call(h.issues, { method: 'POST', token: 'user1', body: report() });
  assert.equal(again.statusCode, 429);

  resetCooldown();
  const second = await call(h.issues, { method: 'POST', token: 'user1', body: report({ title: 'Broken light' }) });
  assert.equal(second.body.id, 'CF-1002');

  const bad = await call(h.issues, { method: 'POST', token: 'user2', body: { title: 'x' } });
  assert.equal(bad.statusCode, 400);
  assert.ok(bad.body.details.description && bad.body.details.lat);
});

test('GET /api/issues near me: open/fixed split, radius, distance order, privacy', async () => {
  // seed: CF-1001 + CF-1002 are New at the centre; add a Closed one 1.1 km away and a far one.
  const base = fb.store.get('issues/CF-1001');
  const mk = (id, lat, status) => fb.store.set('issues/' + id, Object.assign({}, base, { lat, status, geohash: geo.hashFor(lat, LNG), reporterUid: 'u2' }));
  mk('CF-2001', LAT + 0.01, 'Closed');
  mk('CF-2002', LAT + 0.3, 'New'); // ~33 km away

  const open = await call(h.issues, { token: 'user2', query: { lat: String(LAT), lng: String(LNG), radiusKm: '5', status: 'open' } });
  assert.deepEqual(open.body.issues.map((i) => i.id).sort(), ['CF-1001', 'CF-1002']);

  const fixed = await call(h.issues, { token: 'user2', query: { lat: String(LAT), lng: String(LNG), radiusKm: '5', status: 'fixed' } });
  assert.deepEqual(fixed.body.issues.map((i) => i.id), ['CF-2001']);
  assert.ok(fixed.body.issues[0].distanceKm > 1 && fixed.body.issues[0].distanceKm < 1.3);

  const all = await call(h.issues, { token: 'user2', query: { lat: String(LAT), lng: String(LNG), radiusKm: '5' } });
  assert.equal(all.body.count, 3);
  assert.equal(all.body.issues[2].id, 'CF-2001'); // farthest last
  assert.ok(!all.body.issues.some((i) => i.id === 'CF-2002'));
  all.body.issues.forEach((i) => assert.equal(i.reporterEmail, undefined));

  const wide = await call(h.issues, { token: 'user2', query: { lat: String(LAT), lng: String(LNG), radiusKm: '50' } });
  assert.ok(wide.body.issues.some((i) => i.id === 'CF-2002'));

  assert.equal((await call(h.issues, { token: 'user2', query: { lat: '16.7' } })).statusCode, 400);
});

test('GET /api/issues?mine=1 returns only my reports', async () => {
  const mine = await call(h.issues, { token: 'user1', query: { mine: '1' } });
  assert.deepEqual(mine.body.issues.map((i) => i.id).sort(), ['CF-1001', 'CF-1002']);
  assert.ok(mine.body.issues.every((i) => i.isMine));
});

test('PATCH: assign auto-moves New -> Assigned, close/reopen, notes visibility, validation', async () => {
  const patch = (body, id) => call(h.issue, { method: 'PATCH', token: 'admin1', query: { id: id || 'CF-1001' }, body });

  const a = await patch({ team: 'Roads & Potholes Crew' });
  assert.equal(a.statusCode, 200);
  assert.equal(a.body.status, 'Assigned');
  assert.equal(a.body.history.length, 2);

  const closed = await patch({ status: 'Closed', note: { text: 'Patched with asphalt', internal: false } });
  assert.equal(closed.body.status, 'Closed');
  assert.ok(closed.body.closedAt);

  await patch({ note: { text: 'Contractor invoice pending', internal: true } });

  const citizen = await call(h.issue, { token: 'user2', query: { id: 'CF-1001' } });
  assert.deepEqual(citizen.body.notes.map((n) => n.text), ['Patched with asphalt']);
  assert.equal(citizen.body.reporterEmail, undefined);
  const adminView = await call(h.issue, { token: 'admin1', query: { id: 'CF-1001' } });
  assert.equal(adminView.body.notes.length, 2);
  assert.equal(adminView.body.reporterEmail, 'u1@example.com');

  const reopened = await patch({ status: 'In Progress' });
  assert.equal(reopened.body.closedAt, null);
  assert.equal(fb.store.get('issues/CF-1001').closedAt, undefined);

  assert.equal((await patch({ status: 'Done' })).statusCode, 400);
  assert.equal((await patch({})).statusCode, 400);
  assert.equal((await patch({ status: 'Closed' }, 'CF-7777')).statusCode, 404);
  assert.equal((await call(h.issue, { token: 'user1', query: { id: '../users' } })).statusCode, 404);
});

test('admin list: filters + reporter visibility; DELETE removes', async () => {
  const all = await call(h.adminIssues, { token: 'admin1' });
  assert.equal(all.statusCode, 200);
  assert.ok(all.body.count >= 4);
  assert.ok(all.body.issues.every((i) => i.reporterEmail !== undefined));
  const f = await call(h.adminIssues, { token: 'admin1', query: { status: 'Closed' } });
  assert.deepEqual(f.body.issues.map((i) => i.id), ['CF-2001']);
  assert.equal((await call(h.adminIssues, { token: 'admin1', query: { status: 'Nope' } })).statusCode, 400);

  const del = await call(h.issue, { method: 'DELETE', token: 'admin1', query: { id: 'CF-2002' } });
  assert.deepEqual(del.body, { deleted: 'CF-2002' });
  assert.equal(fb.store.has('issues/CF-2002'), false);
  assert.equal((await call(h.issue, { method: 'DELETE', token: 'admin1', query: { id: 'CF-2002' } })).statusCode, 404);
});
