'use strict';
const gf = require('geofire-common');

const hashFor = (lat, lng) => gf.geohashForLocation([lat, lng]);
/* Firestore geohash range-query bounds covering a circle (radius in km). */
const boundsFor = (lat, lng, radiusKm) => gf.geohashQueryBounds([lat, lng], radiusKm * 1000);
/* Great-circle distance in km. */
const distanceKm = (a, b) => gf.distanceBetween(a, b);

module.exports = { hashFor, boundsFor, distanceKm };
