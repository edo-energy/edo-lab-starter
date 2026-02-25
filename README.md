# Edo Lab Project Starter

Minimal template for building projects that run inside the Edo Lab innovation showcase. Handles B2C auth automatically — in production via iframe postMessage, locally via a token-entry overlay.

---

## What's included

| File | Purpose |
|---|---|
| `dev-proxy.js` | Local dev server — serves static files + proxies Edo API calls |
| `edo.js` | Auth SDK — handles iframe postMessage handshake + dev overlay |
| `edo-dev-config.example.js` | Copy → `edo-dev-config.js` for silent auth (no overlay) |
| `.env.example` | Copy → `.env.local` to configure the dev proxy |
| `index.html` | Minimal HTML shell |
| `app.js` | Starter logic — replace with your code |
| `style.css` | Base Edo brand styles |

---

## Local dev workflow

No Lab app required. One command:

```bash
# 1. Clone / copy this starter
cp -r edo-lab-starter my-project && cd my-project

# 2. Start the dev proxy (Node.js built-ins only — no npm install)
node dev-proxy.js

# 3. Open http://localhost:3001 in your browser
#    Paste your B2C token when the overlay appears.
```

**Getting a B2C token:** open the Edo Lab app → DevTools → Network → any `/api/` request → copy the Authorization header value (strip "Bearer ").

**Silent auth (skip the overlay):** copy `edo-dev-config.example.js` → `edo-dev-config.js` and paste your token there. It's gitignored.

**Token expiry:** tokens last ~1 hour. When one expires, clear sessionStorage (DevTools → Application → Session Storage → Clear All) and refresh.

---

## How it works

```
browser (http://localhost:3001)
  │  edo.js calls edo.get('/point/site')
  │  → GET http://localhost:3001/api/edo/point/site
  │        Authorization: Bearer <your-token>
  ▼
dev-proxy.js
  → GET https://services.apis.edoenergy.com/point/site
        Authorization: Bearer <your-token>
  ▼
Edo API → response → browser
```

The proxy just forwards your token. No verification, no role checks — this is local dev only. Production security is handled by the Lab server.

---

## Available API calls

All calls use `edo.get(path, params)`. The dev proxy forwards them to `https://services.apis.edoenergy.com`.

```js
await edo.ready(); // always await this first

// ── Sites + buildings ────────────────────────────────────────────────────────
const sites     = await edo.get('/point/site');
const buildings = await edo.get(`/point/site/${siteId}/building`);

// ── Points ───────────────────────────────────────────────────────────────────
const classes   = await edo.get('/point/class');
const points    = await edo.get(`/point/building/${buildingId}/point`, {
  pc:       42,    // point class ID — filter to a specific class
  pageSize: 500,
});

// ── Equipment ────────────────────────────────────────────────────────────────
const equipment = await edo.get('/point/equipment', { b: buildingId });

// ── Timeseries ───────────────────────────────────────────────────────────────
const latest    = await edo.get('/timeseries/latest', { id: [1, 2, 3] });
const stats     = await edo.get('/timeseries/stat', {
  id: [1, 2, 3],
  start: '2025-12-01T00:00:00Z',
  end:   '2025-12-08T00:00:00Z',
});
// Rollup is fetched per-point (API doesn't support bulk):
const rollups   = await Promise.all(
  pointIds.map(id => edo.get(`/timeseries/rollup/1/hour`, { id }))
);
```

**Raw API field names** (no normalization in local dev):
- Sites: `ID`, `Name`
- Buildings: `id`, `name`, `address`
- Points: `ID`, `PointClassID`, `EquipmentID`, `FormatName`
- Point classes: `value` (= class ID), `text`, `description`
- Equipment: `id`, `name`, `abbreviation`
- Timeseries latest: `id`, `value`, `latest_ts`
- Timeseries rollup: `ts`, `value` (one array per request, no pointId in response)
- Timeseries stat: `id`, `avg`, `min`, `max`, `count`

---

## Promoting to Edo Lab

1. Create a GitHub repo and push your project
2. Deploy to Azure Static Web Apps (free tier)
3. In `edo-lab/client/src/config/projects.js`, add an entry:
   ```js
   {
     id:          'my-project',
     type:        'visualization',
     title:       'My Project',
     description: 'One sentence description.',
     status:      'concept',
     tags:        ['Tag1', 'Tag2'],
     enabled:     false,
     url:         'https://my-project.azurestaticapps.net',
   }
   ```
4. Set `enabled: true` when ready to publish

In production, the Lab app handles auth via postMessage — no proxy needed.
