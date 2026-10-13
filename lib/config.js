'use strict';
/* Single source of truth for domain constants. Served to the frontend by GET /api/config. */

const CATEGORIES = [
  { id: 'pothole', label: 'Pothole' },
  { id: 'drainage', label: 'Drainage / Overflow' },
  { id: 'streetlight', label: 'Streetlight Out' },
  { id: 'garbage', label: 'Garbage Dump' },
  { id: 'water', label: 'Water Leakage' },
  { id: 'other', label: 'Other' }
];

const TEAMS = [
  'Roads & Potholes Crew',
  'Drainage Unit',
  'Electrical Team',
  'Sanitation Dept.',
  'Water Works'
];

const STATUSES = ['New', 'Assigned', 'In Progress', 'Closed'];
const PRIORITIES = ['Low', 'Medium', 'High'];

const LIMITS = {
  title: [4, 120],
  description: [15, 2000],
  address: 300,
  note: [1, 1000],
  photos: 6,
  photoName: 100,
  radiusKm: { min: 0.1, max: 50, default: 5 },
  listLimit: { max: 100, default: 50 },
  adminListLimit: { max: 1000, default: 500 },
  reportCooldownMs: 30 * 1000
};

module.exports = {
  CATEGORIES,
  CATEGORY_IDS: CATEGORIES.map((c) => c.id),
  TEAMS,
  STATUSES,
  PRIORITIES,
  LIMITS
};
