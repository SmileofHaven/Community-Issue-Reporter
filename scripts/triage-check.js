'use strict';
// usage: GEMINI_API_KEY=key node scripts/triage-check.js [image_url]
const { triage } = require('../lib/triage');

if (!process.env.GEMINI_API_KEY) {
  console.error('set GEMINI_API_KEY first');
  process.exit(1);
}

const photos = process.argv[2] ? [{ url: process.argv[2] }] : [];
const input = {
  title: 'Deep pothole near market',
  description: 'Large pothole on the main road, two bikes slipped here this week',
  category: 'other',
  priority: 'Medium',
  photos
};

const t = Date.now();
triage(input).then((r) => {
  console.log(r ? r : 'all models failed => manual triage would be used');
  console.log('took ' + (Date.now() - t) + 'ms');
  process.exit(r ? 0 : 1);
});