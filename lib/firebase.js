'use strict';
/* lazy firebase admin init (importing never needs credentials) */
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { throw new Error('FIREBASE_SERVICE_ACCOUNT is not set'); }
  // raw json or base64 json
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw.trim(), 'base64').toString('utf8');
  const sa = JSON.parse(text);
  if (sa.private_key) { sa.private_key = sa.private_key.replace(/\\n/g, '\n'); }
  return sa;
}

function init() {
  if (getApps().length) { return; }
  initializeApp({ credential: cert(loadServiceAccount()) });
}

// keeps the old admin.firestore.Timestamp / FieldValue shape for callers
function getAdmin() { init(); return { firestore: { Timestamp, FieldValue } }; }
function getDb() { init(); return getFirestore(); }
function getAuth() { init(); return getAdminAuth(); }

module.exports = { getAdmin, getDb, getAuth };