'use strict';
const { getAuth } = require('./firebase');
const { HttpError } = require('./http');

/* Verifies the Firebase ID token in "Authorization: Bearer <token>".
   Role comes ONLY from the signed custom claim, never from client input. */
async function authenticate(req, opts) {
  const header = (req.headers && req.headers.authorization) || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) { throw new HttpError(401, 'Missing bearer token'); }
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(m[1], !!(opts && opts.checkRevoked));
  } catch (e) {
    throw new HttpError(401, 'Invalid or expired token');
  }
  return {
    uid: decoded.uid,
    email: decoded.email || '',
    name: decoded.name || '',
    picture: decoded.picture || '',
    role: decoded.role === 'admin' ? 'admin' : 'user'
  };
}

/* Admin routes also check token revocation, so demoting an admin takes effect immediately. */
async function requireAdmin(req) {
  const user = await authenticate(req, { checkRevoked: true });
  if (user.role !== 'admin') { throw new HttpError(403, 'Admin access required'); }
  return user;
}

module.exports = { authenticate, requireAdmin };
