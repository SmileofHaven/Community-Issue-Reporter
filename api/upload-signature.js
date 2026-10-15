'use strict';
const { wrap, HttpError } = require('../lib/http');
const { authenticate } = require('../lib/auth');
const { signUpload } = require('../lib/cloudinary');

/* POST /api/upload-signature — signed Cloudinary upload params for the signed-in user. */
module.exports = wrap({
  POST: async (req) => {
    await authenticate(req);
    const sig = signUpload();
    if (!sig) { throw new HttpError(503, 'Image uploads are not configured'); }
    return sig;
  }
});
