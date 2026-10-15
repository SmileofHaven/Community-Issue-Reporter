'use strict';
const { CATEGORY_IDS, TEAMS, STATUSES, PRIORITIES, LIMITS } = require('./config');
const { HttpError } = require('./http');
const { isAllowedPhotoUrl } = require('./cloudinary');

const ID_RE = /^CF-\d{4,}$/;

/* Trim and strip control chars (keeps \t \n \r). Output encoding is the frontend's job (escapeHtml). */
function str(v) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '';
}

/* reporterName: optional in older clients, but the CivicFix client always sends one. Length 2–60. */
const REPORTER_NAME_RE = /^[^<>]{2,60}$/;
function num(v) {
  if (typeof v === 'string' && v.trim() !== '') { v = Number(v); }
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function inRange(s, [min, max]) { return s.length >= min && s.length <= max; }
function fail(details) { throw new HttpError(400, 'Validation failed', details); }

function parseIssueId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) { throw new HttpError(404, 'Issue not found'); }
  return id;
}

function parseLatLng(lat, lng, details) {
  const la = num(lat), lo = num(lng);
  if (la === null || la < -90 || la > 90) { details.lat = 'lat must be a number between -90 and 90'; }
  if (lo === null || lo < -180 || lo > 180) { details.lng = 'lng must be a number between -180 and 180'; }
  return [la, lo];
}

function parseNewIssue(body, cloudName) {
  const d = {};
  const title = str(body.title);
  const description = str(body.description);
  const address = str(body.address);
  const category = body.category === undefined ? 'other' : body.category;
  const priority = body.priority === undefined ? 'Medium' : body.priority;
  const reporterName = body.reporterName === undefined ? '' : str(body.reporterName);
  if (reporterName && !REPORTER_NAME_RE.test(reporterName)) {
    d.reporterName = 'reporterName must be 2-60 characters (no HTML)';
  }

  if (!inRange(title, LIMITS.title)) { d.title = 'title must be ' + LIMITS.title.join('-') + ' characters'; }
  if (!inRange(description, LIMITS.description)) { d.description = 'description must be ' + LIMITS.description.join('-') + ' characters'; }
  if (address.length > LIMITS.address) { d.address = 'address must be at most ' + LIMITS.address + ' characters'; }
  if (!CATEGORY_IDS.includes(category)) { d.category = 'category must be one of: ' + CATEGORY_IDS.join(', '); }
  if (!PRIORITIES.includes(priority)) { d.priority = 'priority must be one of: ' + PRIORITIES.join(', '); }
  const [lat, lng] = parseLatLng(body.lat, body.lng, d);

  const photos = [];
  if (body.photos !== undefined) {
    if (!Array.isArray(body.photos) || body.photos.length > LIMITS.photos) {
      d.photos = 'photos must be an array of at most ' + LIMITS.photos + ' items';
    } else {
      body.photos.forEach((p, i) => {
        const url = p && p.url;
        if (!isAllowedPhotoUrl(url, cloudName)) { d['photos[' + i + ']'] = 'photo url must be an uploaded image from this app'; return; }
        photos.push({ url, name: str(p.name).slice(0, LIMITS.photoName) });
      });
    }
  }
  if (Object.keys(d).length) { fail(d); }
  return { title, description, address, category, priority, reporterName, lat, lng, photos };
}

function parseListQuery(q) {
  const d = {};
  if (q.mine === '1' || q.mine === 'true') { return { mine: true }; }
  const [lat, lng] = parseLatLng(q.lat, q.lng, d);
  let radiusKm = q.radiusKm === undefined ? LIMITS.radiusKm.default : num(q.radiusKm);
  if (radiusKm === null || radiusKm < LIMITS.radiusKm.min || radiusKm > LIMITS.radiusKm.max) {
    d.radiusKm = 'radiusKm must be between ' + LIMITS.radiusKm.min + ' and ' + LIMITS.radiusKm.max;
  }
  const status = q.status === undefined ? 'all' : q.status;
  if (!['open', 'fixed', 'all'].includes(status)) { d.status = 'status must be open, fixed or all'; }
  let limit = q.limit === undefined ? LIMITS.listLimit.default : num(q.limit);
  if (limit === null || limit < 1 || limit > LIMITS.listLimit.max) { d.limit = 'limit must be 1-' + LIMITS.listLimit.max; }
  if (Object.keys(d).length) { fail(d); }
  return { mine: false, lat, lng, radiusKm, status, limit: Math.floor(limit) };
}

function parseAdminListQuery(q) {
  const d = {};
  if (q.status !== undefined && !STATUSES.includes(q.status)) { d.status = 'status must be one of: ' + STATUSES.join(', '); }
  if (q.team !== undefined && !TEAMS.includes(q.team)) { d.team = 'unknown team'; }
  const limit = q.limit === undefined ? LIMITS.adminListLimit.default : num(q.limit);
  if (limit === null || limit < 1 || limit > LIMITS.adminListLimit.max) { d.limit = 'limit must be 1-' + LIMITS.adminListLimit.max; }
  if (Object.keys(d).length) { fail(d); }
  return { status: q.status, team: q.team, limit: Math.floor(limit) };
}

function parsePatch(body) {
  const d = {};
  const out = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) { d.status = 'status must be one of: ' + STATUSES.join(', '); } else { out.status = body.status; }
  }
  if (body.team !== undefined) {
    if (body.team !== '' && !TEAMS.includes(body.team)) { d.team = 'unknown team'; } else { out.team = body.team; }
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) { d.priority = 'priority must be one of: ' + PRIORITIES.join(', '); } else { out.priority = body.priority; }
  }
  if (body.note !== undefined) {
    const text = body.note && str(body.note.text);
    if (!text || !inRange(text, LIMITS.note)) { d.note = 'note.text must be ' + LIMITS.note.join('-') + ' characters'; }
    else { out.note = { text, internal: !!body.note.internal }; }
  }
  if (!Object.keys(d).length && !Object.keys(out).length) { d.body = 'Provide at least one of: status, team, priority, note'; }
  if (Object.keys(d).length) { fail(d); }
  return out;
}

module.exports = { parseIssueId, parseNewIssue, parseListQuery, parseAdminListQuery, parsePatch };
