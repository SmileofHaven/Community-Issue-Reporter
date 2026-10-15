# AI triage

on POST /api/issues the server asks a vision model to pick category and priority from the title, description and photos
the crew is derived from the category, so the model can never assign outside the fixed list

## flow
1. reporter submits a report (photos already uploaded to cloudinary)
2. lib/triage.js calls gemini (4s per model, 8s total, photos fetched from cloudinary as small jpegs) and validates the json against config lists
3. hazard keywords (live wire, open manhole, gas leak, sinkhole...) force High priority
4. a low-confidence model (below 0.8) cannot override a category the reporter picked
5. if a team results, the issue is saved as Assigned with that team, else New with no team
6. any failure or missing key => manual triage, behaviour is unchanged

## env vars
- GEMINI_API_KEY: enables triage (google ai studio key), leave unset to disable
- TRIAGE_MODELS: optional comma list tried in order, defaults to gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-flash-lite
  use free flash models listed in ai studio, a model that errors (503, 429, 404, timeout) falls through to the next

## data
issues/{id}.ai = { category, priority, reason, confidence } or null
returned only to admins by GET /api/admin/issues and GET /api/issues/:id
admins can still override team, priority and status through PATCH /api/issues/:id

## category => team
- pothole => Roads & Potholes Crew
- drainage => Drainage Unit
- streetlight => Electrical Team
- garbage => Sanitation Dept.
- water => Water Works
- other => no team (stays New)

## swapping the provider
only callModel() in lib/triage.js talks to the provider, it must return the parsed json object or null

## tests
npm test (tests/triage.test.js uses a mocked model, no network)

## manual check
GEMINI_API_KEY=your_key node scripts/triage-check.js [image_url]
