'use strict';
const { wrap, Reply } = require('../lib/http');
const { CATEGORIES, TEAMS, STATUSES, PRIORITIES, LIMITS } = require('../lib/config');

/* GET /api/config — public. Categories, teams, statuses, limits (icons/styling stay in the frontend, keyed by id). */
module.exports = wrap({
  GET: async () => new Reply(
    200,
    {
      categories: CATEGORIES,
      teams: TEAMS,
      statuses: STATUSES,
      priorities: PRIORITIES,
      limits: {
        title: LIMITS.title,
        description: LIMITS.description,
        photos: LIMITS.photos,
        radiusKm: LIMITS.radiusKm
      }
    },
    { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
  )
});
