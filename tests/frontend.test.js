'use strict';
/* Frontend <-> backend contract tests.
   Loads the REAL pages (index/dashboard/report/admin + app.js) in jsdom, wires window.fetch straight into the REAL
   API handlers backed by an in-memory Firestore, fakes Firebase Auth + Cloudinary, then drives the UI. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');
const fake = require('./fake-firebase');

const TOKENS = {
  user1: { uid: 'u1', email: 'u1@example.com', name: 'Asha Rao' },
  user2: { uid: 'u2', email: 'u2@example.com', name: 'Ravi K' },
  admin1: { uid: 'a1', email: 'ops@example.com', name: 'Ops Controller', role: 'admin' }
};
const fb = fake.create(TOKENS);
const fbPath = require.resolve('../lib/firebase');
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: fb.exports };
process.env.CLOUDINARY_CLOUD_NAME = 'democloud';
process.env.CLOUDINARY_API_KEY = 'k';
process.env.CLOUDINARY_API_SECRET = 's';

const root = path.join(__dirname, '..');
const handlers = {
  '/api/config': require('../api/config.js'),
  '/api/me': require('../api/me.js'),
  '/api/upload-signature': require('../api/upload-signature.js'),
  '/api/issues': require('../api/issues/index.js'),
  '/api/admin/issues': require('../api/admin/issues.js')
};
const issueHandler = require('../api/issues/[id].js');
const geo = require('../lib/geo');

const LAT = 16.705, LNG = 74.2433;
const LEAFLET_STUB = `(function(){
  var handlers = window.__mapHandlers = {};
  function chain(){ var p; var f = function(){ return p; };
    p = new Proxy(f, { get: function(t, k){
      if (k === 'then' || typeof k === 'symbol') { return undefined; }
      if (k === 'on') { return function(ev, fn){ handlers[ev] = fn; return p; }; }
      if (k === 'getLatLng') { return function(){ return { lat: 0, lng: 0 }; }; }
      return p; } });
    return p; }
  window.L = { map: chain, tileLayer: chain, marker: chain, divIcon: chain, layerGroup: chain };
})();`;

/* ---------- seed data ---------- */
function seedIssue(id, o) {
  const ts = new fb.Timestamp(Date.parse(o.created || '2026-10-10T08:00:00Z'));
  fb.store.set('issues/' + id, Object.assign({
    title: 'Issue ' + id, description: 'Description for ' + id + ' long enough', category: 'pothole',
    priority: 'Medium', status: 'New', team: '', address: 'Addr ' + id, photos: [], notes: [],
    history: [{ status: 'New', at: '2026-10-10T08:00:00.000Z' }],
    reporterUid: 'u2', reporterEmail: 'u2@example.com', createdAt: ts, updatedAt: ts
  }, o, { geohash: geo.hashFor(o.lat, o.lng) }));
}
function seed() {
  fb.store.clear();
  seedIssue('CF-1101', { title: 'Pothole at gate', lat: LAT, lng: LNG, reporterUid: 'u1', reporterEmail: 'u1@example.com', priority: 'High' });
  seedIssue('CF-1102', { title: 'Broken streetlight', category: 'streetlight', lat: LAT + 0.005, lng: LNG, status: 'In Progress', team: 'Electrical Team' });
  seedIssue('CF-1103', { title: 'Cleared garbage', category: 'garbage', lat: LAT + 0.01, lng: LNG, status: 'Closed', team: 'Sanitation Dept.',
    notes: [{ at: '2026-10-11T08:00:00.000Z', by: 'Ops', text: 'Crew cleared it', internal: false },
            { at: '2026-10-11T09:00:00.000Z', by: 'Ops', text: 'SECRET invoice note', internal: true }] });
  seedIssue('CF-1104', { title: 'Drain overflow', category: 'drainage', lat: LAT + 0.03, lng: LNG, reporterUid: 'u1', reporterEmail: 'u1@example.com' });
  seedIssue('CF-1105', { title: 'Far away issue', lat: LAT + 0.3, lng: LNG });
  seedIssue('CF-1106', { title: 'Water leak fixed', category: 'water', lat: LAT + 0.02, lng: LNG, status: 'Closed', reporterUid: 'u1', reporterEmail: 'u1@example.com' });
  fb.store.set('meta/counters', { issue: 1106 });
}

/* ---------- fake network: window.fetch -> real API handlers ---------- */
async function callHandler(handler, { method = 'GET', token, query = {}, body } = {}) {
  const res = { headers: {}, statusCode: 200, body: undefined };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  await handler({ method, headers: token ? { authorization: 'Bearer ' + token } : {}, query, body }, res);
  return res;
}
const jsonRes = (status, body) => ({ ok: status < 400, status, json: async () => body });

function makeFetch(net, win) {
  return async function fetch(url, init) {
    init = init || {};
    url = String(url);
    if (url.startsWith('data:')) { return { ok: true, blob: async () => new win.Blob(['img'], { type: 'image/jpeg' }) }; }
    if (url.startsWith('https://api.cloudinary.com/')) {
      net.uploads.push(init.body);
      return jsonRes(200, { secure_url: 'https://res.cloudinary.com/democloud/image/upload/v1/civicfix/issues/u' + net.uploads.length + '.jpg' });
    }
    if (url.startsWith('https://nominatim.openstreetmap.org/reverse')) { return jsonRes(200, { display_name: 'MG Road, Test City', address: { road: 'MG Road', city: 'Test City' } }); }
    if (url.startsWith('https://nominatim.openstreetmap.org/search')) { return jsonRes(200, [{ lat: String(LAT), lon: String(LNG), display_name: 'Searchville, Region, Country' }]); }

    const u = new URL(url, 'http://localhost');
    const auth = init.headers && init.headers.Authorization;
    const token = auth ? auth.replace(/^Bearer /, '') : undefined;
    const query = Object.fromEntries(u.searchParams.entries());
    const body = init.body ? JSON.parse(init.body) : undefined;
    net.calls.push({ method: init.method || 'GET', path: u.pathname, query });

    let handler = handlers[u.pathname];
    const m = u.pathname.match(/^\/api\/issues\/([^/]+)$/);
    if (m) { handler = issueHandler; query.id = decodeURIComponent(m[1]); }
    if (!handler) { return jsonRes(404, { error: 'no route ' + u.pathname }); }
    const r = await callHandler(handler, { method: init.method || 'GET', token, query, body });
    return jsonRes(r.statusCode, r.body);
  };
}

/* ---------- fake Firebase Auth (browser SDK shape used by app.js) ---------- */
function makeFirebase(opts) {
  const userFor = (token, extra) => token && ({
    uid: TOKENS[token] ? TOKENS[token].uid : 'x', email: TOKENS[token] && TOKENS[token].email,
    displayName: TOKENS[token] && TOKENS[token].name, getIdToken: async () => token, ...extra
  });
  const auth = { currentUser: userFor(opts.token), authStateReady: async () => {} };
  const m = {
    GoogleAuthProvider: class {},
    signInWithPopup: async (a) => { a.currentUser = userFor(opts.googleToken || 'user1'); },
    signInWithEmailAndPassword: async (a, email, pw) => {
      if (pw !== 'goodpass') { throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' }); }
      a.currentUser = userFor(opts.emailToken || 'user1');
    },
    createUserWithEmailAndPassword: async (a) => { a.currentUser = userFor('user2'); return { user: a.currentUser }; },
    updateProfile: async () => {},
    sendPasswordResetEmail: async (a, email) => { opts.resetFor = email; },
    signOut: async (a) => { a.currentUser = null; }
  };
  return { auth, m };
}

/* ---------- page harness ---------- */
async function openPage(file, opts) {
  opts = opts || {};
  const net = { calls: [], uploads: [] };
  const navs = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) { errors.push(e.stack || e.message); } });
  vc.on('error', (e) => errors.push(String(e)));

  // Serve local scripts from disk, stub Leaflet, and answer every other subresource with an empty 200 (no real network).
  const jsHeaders = { 'Content-Type': 'application/javascript' };
  const resources = { interceptors: [requestInterceptor((request) => {
    const url = request.url;
    const name = path.basename(url.split('?')[0]);
    if (url.startsWith('http://localhost/') && (name === 'config.js' || name === 'app.js')) {
      return new Response(fs.readFileSync(path.join(root, name)), { headers: jsHeaders });
    }
    if (/leaflet\.js/.test(url)) { return new Response(LEAFLET_STUB, { headers: jsHeaders }); }
    return new Response('', { headers: { 'Content-Type': 'text/plain' } });
  })] };

  const firebase = makeFirebase(opts);
  const dom = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8'), {
    url: 'http://localhost/' + file + (opts.search || ''), runScripts: 'dangerously', resources,
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.__CF_TEST__ = { firebase, navigate: (u) => navs.push(u) };
      window.fetch = makeFetch(net, window);
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.confirm = () => true;
      Object.defineProperty(window.navigator, 'geolocation', { value: {
        getCurrentPosition(ok, no) { opts.geo ? ok({ coords: { latitude: opts.geo[0], longitude: opts.geo[1] } }) : no(new Error('denied')); }
      } });
    }
  });
  await new Promise((r) => { if (dom.window.document.readyState === 'complete') { r(); } else { dom.window.addEventListener('load', r); } });
  const $ = (s) => dom.window.document.querySelector(s);
  const $$ = (s) => Array.from(dom.window.document.querySelectorAll(s));
  return { dom, win: dom.window, doc: dom.window.document, $, $$, net, navs, errors, firebase };
}
async function waitFor(fn, what, ms) {
  const end = Date.now() + (ms || 3000);
  for (;;) {
    let v; try { v = fn(); } catch (e) { v = false; }
    if (v) { return v; }
    if (Date.now() > end) { throw new Error('timed out waiting for: ' + what); }
    await new Promise((r) => setTimeout(r, 10));
  }
}
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
function setVal(el, v) { el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true })); el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true })); }
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const noErrors = (p) => assert.deepEqual(p.errors, [], 'page raised errors:\n' + p.errors.join('\n'));

/* ============================================================== login page */
test('login: Google sign-in routes citizens to the dashboard and admins to the console', async () => {
  seed();
  let p = await openPage('index.html', { googleToken: 'user1' });
  assert.equal(p.$('#roleSeg'), null, 'demo role picker must be gone');
  click(p.$('#googleBtn'));
  await waitFor(() => p.navs.includes('dashboard.html'), 'citizen redirect');
  assert.equal(fb.store.get('users/u1').email, 'u1@example.com'); // profile created by GET /api/me
  noErrors(p);

  p = await openPage('index.html', { googleToken: 'admin1' });
  click(p.$('#googleBtn'));
  await waitFor(() => p.navs.includes('admin.html'), 'admin redirect');
  noErrors(p);
});

test('login: bad password shows a friendly error; sign-up mode + forgot password work', async () => {
  seed();
  const p = await openPage('index.html', {});
  setVal(p.$('#email'), 'u1@example.com'); setVal(p.$('#password'), 'wrongpass');
  p.$('#emailForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$('#loginAlert').classList.contains('show'), 'error alert');
  assert.match(text(p.$('#loginAlert')), /Incorrect email or password/);
  assert.equal(p.navs.length, 0);

  click(p.$('#forgotLink'));
  await waitFor(() => p.firebase && true, 'noop');
  await waitFor(() => /Check your inbox/.test(text(p.$('.toast-wrap'))), 'reset toast');

  click(p.$('#createLink'));
  assert.equal(p.$('#fName').classList.contains('hidden'), false);
  assert.equal(text(p.$('#signInBtn')), 'Create account');
  setVal(p.$('#fullName'), 'New Person'); setVal(p.$('#email'), 'new@example.com'); setVal(p.$('#password'), 'goodpass');
  p.$('#emailForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => p.navs.includes('dashboard.html'), 'signup redirect');
  noErrors(p);
});

test('login: an already signed-in user skips the form', async () => {
  seed();
  const p = await openPage('index.html', { token: 'admin1' });
  await waitFor(() => p.navs.includes('admin.html'), 'auto redirect');
});

/* ============================================================== route guards */
test('guards: signed-out -> login; citizen -> not the admin console; expired token -> login', async () => {
  seed();
  let p = await openPage('dashboard.html', {});
  await waitFor(() => p.navs.includes('index.html'), 'signed-out redirect');
  p = await openPage('admin.html', { token: 'user1' });
  await waitFor(() => p.navs.includes('dashboard.html'), 'citizen blocked from admin');
  p = await openPage('dashboard.html', { token: 'expired-token' });
  await waitFor(() => p.navs.includes('index.html'), '401 -> login');
  assert.equal(p.firebase.auth.currentUser, null, '401 must sign the user out');
});

/* ============================================================== dashboard */
test('dashboard: open/fixed near-me boxes, my reports, privacy, detail + radius', async () => {
  seed();
  const p = await openPage('dashboard.html', { token: 'user1', geo: [LAT, LNG] });
  await waitFor(() => p.$$('#openList .nitem').length === 3 && p.$$('#feed .issue').length === 3, 'lists rendered');

  const open = p.$$('#openList .nitem h4').map(text);
  assert.deepEqual(open, ['Pothole at gate', 'Broken streetlight', 'Drain overflow']); // nearest first, far one excluded
  assert.deepEqual(p.$$('#fixedList .nitem h4').map(text), ['Cleared garbage', 'Water leak fixed']);
  assert.equal(text(p.$('#openCount')), '3');
  assert.equal(text(p.$('#fixedCount')), '2');
  // my stats: 3 reports (1101 New, 1104 New, 1106 Closed)
  assert.equal(text(p.$('#sTotal')), '3'); assert.equal(text(p.$('#sPending')), '2'); assert.equal(text(p.$('#sClosed')), '1');
  assert.ok(!/u2@example\.com/.test(p.doc.body.textContent), "other citizens' emails must not be exposed");
  assert.ok(p.net.calls.filter((c) => c.path === '/api/issues' && !c.query.mine).length === 1, 'one near-me request for both boxes');

  // detail modal from the fixed box: public note visible, internal note hidden
  click(p.$$('#fixedList .nitem')[0]);
  await waitFor(() => p.$('#detailModal').classList.contains('open'), 'detail open');
  assert.match(text(p.$('#dBody')), /Crew cleared it/);
  assert.ok(!/SECRET/.test(p.doc.body.textContent), 'internal notes must never reach citizens');

  // smaller radius re-queries the API
  setVal(p.$('#radiusSel'), '1');
  await waitFor(() => p.$$('#openList .nitem').length === 2, 'radius 1km');
  assert.equal(p.$$('#fixedList .nitem').length, 0);
  assert.match(text(p.$('#fixedList')), /No fixed issues within 1 km/);
  noErrors(p);
});

test('dashboard: GPS denied falls back to the default area; saved profile name works', async () => {
  seed();
  const p = await openPage('dashboard.html', { token: 'user1' }); // geolocation denied
  await waitFor(() => /default area/.test(text(p.$('#locNote'))), 'fallback note');
  await waitFor(() => !p.$('#openList .nempty') || !/Loading/.test(text(p.$('#openList'))), 'near query finished');
  setVal(p.$('#pName'), 'Asha R.');
  click(p.$('#pSave'));
  await waitFor(() => /Profile saved/.test(text(p.$('.toast-wrap'))), 'profile saved');
  assert.equal(text(p.$('[data-user-name]')), 'Asha R.');
  noErrors(p);
});

/* ============================================================== report */
test('report: full wizard -> photos upload to Cloudinary -> POST /api/issues -> redirect', async () => {
  seed();
  const p = await openPage('report.html', { token: 'user1' });
  await waitFor(() => p.$$('.cat').length === 6, 'categories from config');
  click(p.$$('.cat')[0]);                                             // pothole
  setVal(p.$('#priority'), 'High');
  click(p.$('#nextBtn'));
  setVal(p.$('#title'), 'Huge pothole by the school');
  setVal(p.$('#desc'), 'Deep pothole, bikes swerve into traffic.');
  click(p.$('#nextBtn'));
  p.win.__mapHandlers.click({ latlng: { lat: LAT, lng: LNG } });        // drop the pin
  await waitFor(() => /MG Road/.test(p.$('#address').value), 'reverse geocode');
  click(p.$('#nextBtn'));
  p.win.CF.readImage = async (f) => ({ name: f.name, data: 'data:image/jpeg;base64,AAAA' });
  const input = p.$('#fileBrowse');
  Object.defineProperty(input, 'files', { value: [new p.win.File(['x'], 'a.jpg', { type: 'image/jpeg' }), new p.win.File(['y'], 'b.jpg', { type: 'image/jpeg' })] });
  input.dispatchEvent(new p.win.Event('change'));
  await waitFor(() => p.$$('#thumbs .thumb').length === 2, 'photo previews');
  click(p.$('#nextBtn'));
  click(p.$('#submitBtn'));
  try { await waitFor(() => p.navs.length === 1, 'redirect after submit'); }
  catch (e) { throw new Error(e.message + ' | toasts: ' + text(p.$('.toast-wrap')) + ' | errors: ' + p.errors.join(';') + ' | calls: ' + JSON.stringify(p.net.calls)); }

  assert.equal(p.navs[0], 'dashboard.html?new=CF-1107');
  assert.equal(p.net.uploads.length, 2);
  const saved = fb.store.get('issues/CF-1107');
  assert.equal(saved.title, 'Huge pothole by the school');
  assert.equal(saved.priority, 'High'); assert.equal(saved.status, 'New'); assert.equal(saved.reporterUid, 'u1');
  assert.equal(saved.photos.length, 2);
  assert.match(saved.photos[0].url, /^https:\/\/res\.cloudinary\.com\/democloud\//);
  assert.equal(saved.address, 'MG Road, Test City');
  const fd = p.net.uploads[0];                                        // signed upload fields
  assert.ok(fd.get('signature') && fd.get('timestamp') && fd.get('api_key') && fd.get('folder') === 'civicfix/issues');
  noErrors(p);
});

test('report: server-side validation / rate-limit errors are shown, not swallowed', async () => {
  seed();
  const p = await openPage('report.html', { token: 'user1' });
  await p.win.CF.createIssue({ category: 'other', priority: 'Low', title: 'First report ok', description: 'First report description ok',
    address: '', lat: LAT, lng: LNG, photos: [] });
  await assert.rejects(p.win.CF.createIssue({ category: 'other', priority: 'Low', title: 'Second too fast', description: 'Second report description',
    address: '', lat: LAT, lng: LNG, photos: [] }), (e) => e.status === 429 && /wait/.test(p.win.CF.errText(e)));
  await assert.rejects(p.win.CF.createIssue({ title: 'x' }), (e) => e.status === 400 && /description|title|lat/i.test(p.win.CF.errText(e)));
});

/* ============================================================== admin */
test('admin: loads all tickets; assign / status / note / drag-drop / delete go through PATCH & DELETE', async () => {
  seed();
  const p = await openPage('admin.html', { token: 'admin1' });
  await waitFor(() => text(p.$('#ovTotal')) === '6 total', 'overview loaded');
  assert.equal(text(p.$('#oOpen')), '4');                              // New+Assigned+In Progress = 1101,1102,1104,1105
  click(p.$('[data-nav="issues"]'));
  await waitFor(() => p.$$('.kcard').length === 6, 'kanban cards');
  assert.equal(p.$$('.kcol[data-status="New"] .kcard').length, 3);

  // Assign team (also sets priority + a staff-only dispatch note); New -> Assigned automatically
  click(p.$('.kcard[data-id="CF-1101"] [data-act="assign"]'));
  assert.ok(p.$('#assignModal').classList.contains('open'));
  setVal(p.$('#aTeam'), 'Roads & Potholes Crew'); setVal(p.$('#aPriority'), 'Low'); setVal(p.$('#aNote'), 'Bring cones');
  click(p.$('#aSave'));
  await waitFor(() => fb.store.get('issues/CF-1101').status === 'Assigned', 'assigned');
  let d = fb.store.get('issues/CF-1101');
  assert.equal(d.team, 'Roads & Potholes Crew'); assert.equal(d.priority, 'Low');
  assert.deepEqual(d.notes.map((n) => [n.text, n.internal]), [['Bring cones', true]]);
  await waitFor(() => p.$$('.kcol[data-status="Assigned"] .kcard').length === 1 && !p.$('#assignModal').classList.contains('open'), 'board re-rendered');

  // Status change with a public note (visible to the reporter)
  click(p.$('.kcard[data-id="CF-1102"] [data-act="status"]'));
  setVal(p.$('#sStatus'), 'Closed'); setVal(p.$('#sNote'), 'Light replaced');
  click(p.$('#sSave'));
  await waitFor(() => fb.store.get('issues/CF-1102').status === 'Closed', 'closed');
  d = fb.store.get('issues/CF-1102');
  assert.deepEqual(d.notes.map((n) => [n.text, n.internal]), [['Light replaced', false]]);
  assert.ok(d.closedAt);
  const citizenView = await callHandler(issueHandler, { token: 'user2', query: { id: 'CF-1102' } });
  assert.deepEqual(citizenView.body.notes.map((n) => n.text), ['Light replaced']);

  // Internal note
  click(p.$('.kcard[data-id="CF-1104"] [data-act="note"]'));
  setVal(p.$('#nText'), 'Needs inspection');
  click(p.$('#nSave'));
  await waitFor(() => (fb.store.get('issues/CF-1104').notes || []).length === 1, 'note saved');
  assert.equal(fb.store.get('issues/CF-1104').notes[0].internal, true);
  assert.equal(fb.store.get('issues/CF-1104').notes[0].by, 'Ops Controller');

  // Drag & drop to "In Progress" is a plain status PATCH
  const dropTo = (id, status) => { const ev = new p.win.Event('drop', { bubbles: true, cancelable: true }); ev.dataTransfer = { getData: () => id };
    p.$('.kcol[data-status="' + status + '"]').dispatchEvent(ev); };
  dropTo('CF-1105', 'In Progress');
  await waitFor(() => fb.store.get('issues/CF-1105').status === 'In Progress', 'drag to in progress');
  // ...but "Assigned" with no team opens the assign dialog instead of guessing a crew
  dropTo('CF-1104', 'Assigned');
  await waitFor(() => p.$('#assignModal').classList.contains('open'), 'assign dialog');
  assert.equal(fb.store.get('issues/CF-1104').status, 'New');
  click(p.$('#assignModal [data-close]'));

  // Table view + delete (spam)
  click(p.$('#viewTabs [data-view="table"]'));
  await waitFor(() => p.$$('#tableBody tr').length === 6, 'table rows');
  click(p.$('#tableBody [data-act="delete"][data-id="CF-1105"]'));
  await waitFor(() => !fb.store.has('issues/CF-1105'), 'deleted');
  await waitFor(() => p.$$('#tableBody tr').length === 5, 'row removed');
  noErrors(p);
});

test('admin: reporter email is shown on the map dialog; API errors surface as toasts', async () => {
  seed();
  const p = await openPage('admin.html', { token: 'admin1' });
  await waitFor(() => text(p.$('#ovTotal')) === '6 total', 'loaded');
  click(p.$('[data-nav="issues"]'));
  await waitFor(() => p.$$('.kcard').length === 6, 'cards');
  click(p.$('.kcard[data-id="CF-1101"] [data-act="map"]'));
  assert.match(text(p.$('#amMeta')), /u1@example\.com/);
  // simulate a server rejection (issue deleted by someone else meanwhile)
  fb.store.delete('issues/CF-1102');
  click(p.$('.kcard[data-id="CF-1102"] [data-act="status"]'));
  setVal(p.$('#sStatus'), 'Closed');
  click(p.$('#sSave'));
  await waitFor(() => /Issue not found/.test(text(p.$('.toast-wrap'))), 'error toast');
  assert.ok(p.$('#statusModal').classList.contains('open'), 'dialog stays open on failure');
  assert.equal(p.$('#sSave').disabled, false, 'button is re-enabled after failure');
  noErrors(p);
});
