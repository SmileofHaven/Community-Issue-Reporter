'use strict';
/* Tiny HTTP toolkit: method routing, JSON errors, CORS, body parsing. */

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

class Reply {
  constructor(status, body, headers) {
    this.status = status;
    this.body = body;
    this.headers = headers || {};
  }
}
const created = (body) => new Reply(201, body);

function applyCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers && req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  }
}

function readJson(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { throw new HttpError(400, 'Request body is not valid JSON'); }
  }
  if (body === undefined || body === null) { return {}; }
  if (typeof body !== 'object' || Array.isArray(body)) { throw new HttpError(400, 'Request body must be a JSON object'); }
  return body;
}

/* wrap({ GET: fn, POST: fn }) -> (req, res) handler. Each fn returns data or a Reply. */
function wrap(methods) {
  return async function handler(req, res) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    res.setHeader('Cache-Control', 'no-store');

    const fn = methods[req.method];
    if (!fn) {
      res.setHeader('Allow', Object.keys(methods).join(', '));
      res.status(405).json({ error: 'Method ' + req.method + ' not allowed' });
      return;
    }
    try {
      const out = await fn(req, res);
      const reply = out instanceof Reply ? out : new Reply(200, out);
      Object.keys(reply.headers).forEach((k) => res.setHeader(k, reply.headers[k]));
      res.status(reply.status).json(reply.body);
    } catch (err) {
      if (err instanceof HttpError) {
        const body = { error: err.message };
        if (err.details) { body.details = err.details; }
        res.status(err.status).json(body);
        return;
      }
      console.error('Unhandled API error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

module.exports = { HttpError, Reply, created, wrap, readJson };
