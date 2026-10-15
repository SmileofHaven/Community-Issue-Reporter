'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { triage, normalize } = require('../lib/triage');

const base = { title: 'Deep pothole', description: 'Pothole on the main road near the market', category: 'other', priority: 'Medium', photos: [] };

test('maps model output to a crew from the fixed list', async () => {
  const r = await triage(base, async () => ({ category: 'pothole', priority: 'High', reason: 'road damage', confidence: 0.9 }));
  assert.equal(r.team, 'Roads & Potholes Crew');
  assert.equal(r.priority, 'High');
});

test('invalid model output falls back to reporter values', () => {
  const r = normalize({ category: 'nonsense', priority: 'Urgent' }, base);
  assert.equal(r.category, 'other');
  assert.equal(r.priority, 'Medium');
  assert.equal(r.team, '');
});

test('hazard keywords force High priority', () => {
  const r = normalize({ category: 'streetlight', priority: 'Low', confidence: 0.9 }, Object.assign({}, base, { description: 'live wire hanging near the school gate' }));
  assert.equal(r.priority, 'High');
});

test('low confidence cannot override the reporter category', () => {
  const r = normalize({ category: 'garbage', priority: 'Low', confidence: 0.5 }, Object.assign({}, base, { category: 'pothole' }));
  assert.equal(r.category, 'pothole');
});

test('returns null when the model call fails', async () => {
  assert.equal(await triage(base, async () => null), null);
});

test('chain falls through failing models to the next one', async () => {
  const { callModel } = require('../lib/triage');
  const realFetch = global.fetch;
  const seen = [];
  process.env.GEMINI_API_KEY = 'k';
  process.env.TRIAGE_MODELS = 'm1,m2,m3';
  global.fetch = async (url) => {
    const m = /models\/(.+):generateContent/.exec(url)[1];
    seen.push(m);
    if (m === 'm1') { return { ok: false }; }
    if (m === 'm2') { throw new Error('network'); }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"category":"pothole","priority":"High"}' }] } }] }) };
  };
  try {
    const raw = await callModel(base);
    assert.deepEqual(seen, ['m1', 'm2', 'm3']);
    assert.equal(raw._model, 'm3');
  } finally {
    global.fetch = realFetch;
    delete process.env.TRIAGE_MODELS;
    delete process.env.GEMINI_API_KEY;
  }
});

test('returns null when every model fails', async () => {
  const { callModel } = require('../lib/triage');
  const realFetch = global.fetch;
  process.env.GEMINI_API_KEY = 'k';
  process.env.TRIAGE_MODELS = 'm1,m2';
  global.fetch = async () => ({ ok: false });
  try {
    assert.equal(await callModel(base), null);
  } finally {
    global.fetch = realFetch;
    delete process.env.TRIAGE_MODELS;
    delete process.env.GEMINI_API_KEY;
  }
});
