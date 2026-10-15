'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const v = require('../lib/validate');
const geo = require('../lib/geo');
const cl = require('../lib/cloudinary');
const { serializeIssue } = require('../lib/serialize');
const { HttpError } = require('../lib/http');

const CLOUD = 'democloud';
const goodPhoto = { url: 'https://res.cloudinary.com/democloud/image/upload/v1/civicfix/issues/a.jpg', name: 'a.jpg' };
const base = { title: 'Big pothole', description: 'Deep pothole near the bus stop', lat: 16.7, lng: 74.24 };

function details(fn) {
  try { fn(); } catch (e) { assert.ok(e instanceof HttpError); assert.equal(e.status, 400); return e.details; }
  assert.fail('expected validation error');
}

test('parseNewIssue accepts a valid report and applies defaults', () => {
  const out = v.parseNewIssue(Object.assign({ photos: [goodPhoto] }, base), CLOUD);
  assert.equal(out.category, 'other');
  assert.equal(out.priority, 'Medium');
  assert.equal(out.photos.length, 1);
});

test('parseNewIssue accepts numeric strings for coordinates', () => {
  const out = v.parseNewIssue(Object.assign({}, base, { lat: '16.7', lng: '74.24' }), CLOUD);
  assert.equal(out.lat, 16.7);
});

test('parseNewIssue rejects bad fields and reports each one', () => {
  const d = details(() => v.parseNewIssue({ title: 'x', description: 'short', lat: 99, lng: 'abc', category: 'nope', priority: 'Urgent' }, CLOUD));
  ['title', 'description', 'lat', 'lng', 'category', 'priority'].forEach((k) => assert.ok(d[k], k));
});

test('parseNewIssue rejects foreign / dangerous photo URLs and too many photos', () => {
  const bad = ['javascript:alert(1)', 'https://evil.com/res.cloudinary.com/democloud/x.jpg',
    'https://res.cloudinary.com/othercloud/image/upload/a.jpg', 'http://res.cloudinary.com/democloud/a.jpg'];
  bad.forEach((url) => {
    const d = details(() => v.parseNewIssue(Object.assign({ photos: [{ url }] }, base), CLOUD));
    assert.ok(d['photos[0]'], url);
  });
  const many = Array.from({ length: 7 }, () => goodPhoto);
  assert.ok(details(() => v.parseNewIssue(Object.assign({ photos: many }, base), CLOUD)).photos);
  // fail closed when Cloudinary is not configured
  assert.ok(details(() => v.parseNewIssue(Object.assign({ photos: [goodPhoto] }, base), undefined))['photos[0]']);
});

test('control characters are stripped from text', () => {
  const out = v.parseNewIssue(Object.assign({}, base, { title: 'Pot\u0000hole\u0007 here' }), CLOUD);
  assert.equal(out.title, 'Pothole here');
});

test('parseListQuery', () => {
  assert.deepEqual(v.parseListQuery({ mine: '1' }), { mine: true });
  const q = v.parseListQuery({ lat: '16.7', lng: '74.2' });
  assert.equal(q.radiusKm, 5); assert.equal(q.status, 'all'); assert.equal(q.limit, 50);
  assert.ok(details(() => v.parseListQuery({ lat: '16.7' })).lng);
  assert.ok(details(() => v.parseListQuery({ lat: '1', lng: '1', radiusKm: '500' })).radiusKm);
  assert.ok(details(() => v.parseListQuery({ lat: '1', lng: '1', status: 'weird' })).status);
});

test('parsePatch', () => {
  assert.deepEqual(v.parsePatch({ status: 'Closed' }), { status: 'Closed' });
  assert.equal(v.parsePatch({ team: '' }).team, '');
  assert.deepEqual(v.parsePatch({ note: { text: ' hi ', internal: 1 } }).note, { text: 'hi', internal: true });
  assert.ok(details(() => v.parsePatch({})).body);
  assert.ok(details(() => v.parsePatch({ status: 'Done' })).status);
  assert.ok(details(() => v.parsePatch({ team: 'Ghosts' })).team);
  assert.ok(details(() => v.parsePatch({ note: { text: '   ' } })).note);
});

test('parseIssueId only allows CF-#### ids', () => {
  assert.equal(v.parseIssueId('CF-1041'), 'CF-1041');
  ['../x', 'CF-1', 'cf-1041', 'CF-1041/extra', undefined].forEach((bad) =>
    assert.throws(() => v.parseIssueId(bad), (e) => e.status === 404));
});

test('geo: bounds contain the point hash; distance is sane', () => {
  const lat = 16.705, lng = 74.2433;
  const h = geo.hashFor(lat, lng);
  const bounds = geo.boundsFor(lat, lng, 5);
  assert.ok(bounds.some(([s, e]) => h >= s && h <= e));
  const d = geo.distanceKm([16.705, 74.2433], [16.715, 74.2433]);
  assert.ok(d > 1.0 && d < 1.2, String(d)); // 0.01 degrees latitude ≈ 1.11 km
});

test('cloudinary signature matches the documented algorithm', () => {
  process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  process.env.CLOUDINARY_API_KEY = 'key123';
  process.env.CLOUDINARY_API_SECRET = 'secret456';
  const sig = cl.signUpload(1700000000000);
  const expected = crypto.createHash('sha1').update('folder=civicfix/issues&timestamp=1700000000secret456').digest('hex');
  assert.equal(sig.signature, expected);
  assert.equal(sig.timestamp, 1700000000);
  assert.ok(!JSON.stringify(sig).includes('secret456'));
});

test('serializeIssue hides reporter + internal notes from non-admins', () => {
  const d = { title: 't', reporterUid: 'u1', reporterEmail: 'a@b.c', notes: [{ at: '1', by: 'x', text: 'pub', internal: false }, { at: '2', by: 'x', text: 'secret', internal: true }] };
  const citizen = serializeIssue('CF-1001', d, { uid: 'u2', role: 'user' });
  assert.equal(citizen.reporterEmail, undefined);
  assert.equal(citizen.isMine, false);
  assert.deepEqual(citizen.notes.map((n) => n.text), ['pub']);
  const admin = serializeIssue('CF-1001', d, { uid: 'a', role: 'admin' });
  assert.equal(admin.reporterEmail, 'a@b.c');
  assert.equal(admin.notes.length, 2);
  assert.equal(serializeIssue('CF-1001', d, { uid: 'u1', role: 'user' }).isMine, true);
});
