'use strict';
const crypto = require('crypto');

const FOLDER = 'civicfix/issues';

function cfg() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  return { cloudName, apiKey, apiSecret };
}

/* Signed-upload parameters: the browser uploads straight to Cloudinary, the secret never leaves the server. */
function signUpload(now) {
  const { cloudName, apiKey, apiSecret } = cfg();
  if (!cloudName || !apiKey || !apiSecret) { return null; }
  const timestamp = Math.floor((now || Date.now()) / 1000);
  // Cloudinary signs the alphabetically-sorted "k=v&k=v" string with the API secret appended.
  const toSign = 'folder=' + FOLDER + '&timestamp=' + timestamp;
  const signature = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
  return { cloudName, apiKey, timestamp, folder: FOLDER, signature };
}

/* Only accept photo URLs that really live in OUR Cloudinary account (blocks javascript:/foreign URLs). */
function isAllowedPhotoUrl(url, cloudName) {
  if (!cloudName || typeof url !== 'string' || url.length > 600) { return false; }
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  return u.protocol === 'https:' && u.hostname === 'res.cloudinary.com' &&
         u.pathname.indexOf('/' + cloudName + '/') === 0;
}

module.exports = { signUpload, isAllowedPhotoUrl, FOLDER };
