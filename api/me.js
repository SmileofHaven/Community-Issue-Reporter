'use strict';
const { wrap } = require('../lib/http');
const { authenticate } = require('../lib/auth');
const { getDb, getAdmin } = require('../lib/firebase');

/* GET /api/me — call right after login. Creates the profile on first sign-in and returns the (claim-based) role. */
module.exports = wrap({
  GET: async (req) => {
    const user = await authenticate(req);
    const db = getDb();
    const ref = db.doc('users/' + user.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: getAdmin().firestore.Timestamp.now()
      });
    }
    return { uid: user.uid, email: user.email, name: user.name, picture: user.picture, role: user.role };
  }
});
