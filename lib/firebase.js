'use strict';
/* Lazy Firebase Admin initialisation (so importing a module never needs credentials). */
const admin = require('firebase-admin');

let initialised = false;

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { throw new Error('FIREBASE_SERVICE_ACCOUNT is not set'); }
  // Accept either raw JSON or base64-encoded JSON (easier to paste into env var UIs).
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw.trim(), 'base64').toString('utf8');
  const sa = JSON.parse(text);
  if (sa.private_key) { sa.private_key = sa.private_key.replace(/\\n/g, '\n'); }
  return sa;
}

function init() {
  if (initialised || admin.apps.length) { initialised = true; return; }
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
  initialised = true;
}

function getAdmin() { init(); return admin; }
function getDb() { init(); return admin.firestore(); }
function getAuth() { init(); return admin.auth(); }

module.exports = { getAdmin, getDb, getAuth };
