# Community Issue Reporter — Backend

Serverless REST API for the issue reporter. **100% free tier, no credit card needed.**

| Piece | Service |
|---|---|
| Hosting + API | Vercel Hobby (static files at repo root, API in `/api`) |
| Auth | Firebase Authentication (Google + email/password) |
| Database | Cloud Firestore (Spark plan) |
| Photos | Cloudinary free tier (signed browser uploads) |

The frontend only talks to `/api/*` (plus the Firebase Auth SDK for the login popup), so it can be
rewritten in any framework without touching the backend. Frontend to-do list: `FRONTEND_CHANGES.txt`.

## One-time setup

### 1. Firebase
1. [console.firebase.google.com](https://console.firebase.google.com) → create a project (skip Analytics).
2. **Authentication → Sign-in method**: enable *Google* and *Email/Password*.
3. **Authentication → Settings → Authorized domains**: add your Vercel domain (e.g. `your-app.vercel.app`) — Google sign-in fails without it.
4. **Firestore Database → Create database** → pick a region near you → **Production mode** (not test mode).
5. Firestore **Rules** tab → paste `firestore.rules` → Publish. (All access goes through the API; direct client access stays denied. Test-mode rules would leave the database open to everyone, so don't use them.)
6. **Project settings → Service accounts → Generate new private key** → keep the JSON file private.
7. Base64-encode it into one line for the env var:
   - macOS/Linux: `base64 -w0 key.json` (macOS: `base64 -i key.json`)
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))`

### 1b. Frontend config
Firebase console -> Project settings -> Your apps -> add a **Web app** -> copy its config into `config.js` (public values, safe to commit).

### 2. Cloudinary
Create a free account → Dashboard shows *Cloud name*, *API key*, *API secret*.

### 3. Vercel
Import the GitHub repo → **Settings → Environment Variables**, add (see `.env.example`):
`FIREBASE_SERVICE_ACCOUNT`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
(optionally `ALLOWED_ORIGINS` for cross-origin local frontends) → Deploy.

### 4. First admin
Sign in once on the site, then locally (with `.env` filled in):
```
npm install
npm run set-admin -- you@example.com          # promote
npm run set-admin -- you@example.com --remove # demote
```
That user must sign out and back in. Roles live in a signed Firebase custom claim, so they can't be
spoofed from the browser.

## Local development
```
npm install
npm test            # unit + API tests (in-memory fake Firestore, no credentials needed)
npm i -g vercel
vercel dev          # serves static files + /api locally; reads .env
```

## API reference
All routes except `/api/config` need `Authorization: Bearer <Firebase ID token>`.
Errors: `{ "error": "message", "details": { "field": "reason" } }`.

| Method & path | Who | Purpose |
|---|---|---|
| `GET /api/config` | public | categories, teams, statuses, priorities, limits |
| `GET /api/me` | user | creates profile on first login; returns `{uid,email,name,picture,role}` |
| `GET /api/issues?lat&lng&radiusKm=5&status=open\|fixed\|all&limit=50` | user | issues near a point, nearest first (`distanceKm`) |
| `GET /api/issues?mine=1` | user | my own reports |
| `GET /api/issues/:id` | user | one issue |
| `POST /api/issues` | user | create `{title,description,category,priority,address,lat,lng,photos:[{url,name}]}` → `201` |
| `POST /api/upload-signature` | user | signed Cloudinary upload params |
| `GET /api/admin/issues?status&team&limit` | admin | all issues incl. reporter email + internal notes |
| `PATCH /api/issues/:id` | admin | `{status?, team?, priority?, note?:{text,internal}}` |
| `DELETE /api/issues/:id` | admin | remove spam |

`open` = New / Assigned / In Progress, `fixed` = Closed. Assigning a team to a *New* issue moves it to *Assigned*.

## Data model (Firestore)
- `issues/{CF-####}`: title, description, category, priority, status, team, address, lat, lng, `geohash`, photos[], notes[], history[], reporterUid, reporterEmail, createdAt, updatedAt, closedAt?
- `users/{uid}`: uid, email, name, role (mirror of the claim), createdAt, lastReportAt
- `meta/counters`: `{ issue: <last number> }` for ticket ids

## Security model
- Identity and role come only from the verified Firebase ID token; admin routes also check for revoked tokens.
- Firestore rules deny all direct client access; the API validates every input (lengths, enums, coordinates).
- Photo URLs must be HTTPS Cloudinary URLs from *your* cloud name (blocks `javascript:` / foreign URLs).
- Citizens never see reporter identity or internal notes. One report per user every 30 s (anti-spam).
- Output is JSON only; the frontend must still HTML-escape text it renders.

## Free-tier limits to keep in mind
- Firestore Spark has daily read/write quotas; "near me" reads every issue in the surrounding geohash cells, so keep `radiusKm` modest and the page from polling.
- Nominatim (address search) allows about 1 request/second — fine for a demo, debounce the search box.
- Vercel Hobby is for non-commercial use.
- If the dataset grows: add a composite index (`geohash` + a boolean `isFixed`) to filter status inside Firestore instead of in the function.
