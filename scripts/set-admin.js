'use strict';
/* Promote / demote an admin.
   Usage:  npm run set-admin -- user@example.com            (promote)
           npm run set-admin -- user@example.com --remove   (demote)
   Needs FIREBASE_SERVICE_ACCOUNT in .env. The user must have signed in at least once. */
const { getAuth, getDb, getAdmin } = require('../lib/firebase');

async function main() {
  const [email, flag] = process.argv.slice(2);
  if (!email) {
    console.error('Usage: npm run set-admin -- <email> [--remove]');
    process.exit(1);
  }
  const remove = flag === '--remove';
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);

  const claims = Object.assign({}, user.customClaims || {});
  if (remove) { delete claims.role; } else { claims.role = 'admin'; }
  await auth.setCustomUserClaims(user.uid, claims);
  if (remove) { await auth.revokeRefreshTokens(user.uid); } // demotion takes effect immediately

  await getDb().doc('users/' + user.uid).set({
    uid: user.uid,
    email: user.email || email,
    name: user.displayName || '',
    role: remove ? 'user' : 'admin',
    roleUpdatedAt: getAdmin().firestore.Timestamp.now()
  }, { merge: true });

  console.log((remove ? 'Removed admin from ' : 'Granted admin to ') + email +
    '. They must sign out and back in (or refresh their ID token) for it to apply.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
