# Edo Lab Project Starter — Claude Code Context

This file gives Claude Code persistent context for building Edo Lab projects. Read this before making any implementation decisions.

---

## What Is This?

This is the starter template for building **Edo Lab projects** — interactive data dashboards and visualizations that connect to live Edo Energy building data. Projects built from this starter are:

- **Static sites** — plain HTML, CSS, and vanilla JavaScript. No build step, no framework.
- **Embedded in Edo Lab** via `<iframe>` in production. Auth is handled automatically via postMessage.
- **Developed locally** using `dev-proxy.js`, which handles B2C OAuth and proxies API calls.

Edo Energy aggregates commercial buildings into AI-powered Virtual Power Plants (VPPs). The platform collects sensor data from buildings at 1–15 minute intervals via BACnet/Modbus gateways. Projects built here visualize and analyze that data.

---

## Files in This Starter

| File | Purpose |
|---|---|
| `dev-proxy.js` | Local dev server — OAuth2 PKCE auth + API proxy + static file serving |
| `edo.js` | Auth SDK — handles iframe postMessage (prod) and dev overlay (local) |
| `index.html` | HTML shell — wire up your UI here |
| `app.js` | Starter logic — replace with your project code |
| `style.css` | Base styles — Edo brand tokens |
| `edo-dev-config.example.js` | Copy → `edo-dev-config.js` for silent local auth (optional) |
| `example.env` | Copy → `.env.local` to configure the dev proxy (optional) |
| `.gitignore` | Gitignores dev token files — never commit these |

---

## Local Dev Workflow

```bash
node dev-proxy.js
# open http://localhost:3001
# click "Authorize with Edo" → B2C login popup → auto-connects
# token cached to .token-cache.json — next run connects silently
```

**That's it.** No Lab app, no npm install, no build step.

### How auth works locally

1. `dev-proxy.js` starts on `:3001` and serves your static files
2. `edo.js` checks if dev-proxy has a cached token → if yes, connects silently
3. If not, shows the dev overlay with an "Authorize with Edo" button
4. Clicking it opens a B2C login popup via OAuth2 PKCE
5. After login, token is cached to `.token-cache.json` (gitignored)
6. Future sessions connect silently until the token expires (~1 hour)

### Fallback: paste token manually
If the Authorize flow doesn't work, paste a raw B2C token in the overlay's lower field. Get it from DevTools → Network → any `/api/` request → Authorization header (strip "Bearer ").

---

## Using the `edo` SDK

Always `await edo.ready()` before making API calls. After that, use `edo.get(path, params)` for everything.

```js
async function main() {
  await edo.ready();

  const sites = await edo.get('/point/site');
  // sites is an array of raw site objects
}

main().catch(err => console.error(err));
```

The SDK is global — `edo` is available on `window` after `<script src="edo.js"></script>`.

---

## Edo API Reference

All paths are relative to the Edo API base. The dev proxy forwards `/api/edo/*` → `https://services-internal.apis.edoenergy.com/*`.

### Sites

```js
const sites = await edo.get('/point/site');
// Returns: [{ ID, Name, Abbreviation, Timezone, Active, PartnerID }, ...]
```

### Buildings

```js
const buildings = await edo.get(`/point/site/${siteId}/building`);
// Returns: [{ id, name, address, siteID, sqft, timezone, latitude, longitude }, ...]
```

### Point Classes

```js
const classes = await edo.get('/point/class');
// Returns: [{ value, text, description, unitAbbreviation }, ...]
// `value` is the class ID used in point queries
// `text` is the short name, `description` is the full name
```

Common point class names (search by `text` or `description`):
- Zone Temperature (`text` contains "Zone Temp")
- Supply Air Temperature
- Return Air Temperature
- CO2
- Occupancy

### Points

```js
const points = await edo.get(`/point/building/${buildingId}/point`, {
  pc:       classId,   // point class ID (from /point/class value field) — optional filter
  pageSize: 500,       // max points per request
});
// Returns: [{ ID, PointClassID, EquipmentID, FormatName, RawName, PointClassName, UnitAbbreviation }, ...]
// Raw field names use PascalCase — use ID not id, PointClassID not pointClassId
```

### Equipment

```js
const equipment = await edo.get('/point/equipment', { b: buildingId });
// Returns: [{ id, name, abbreviation, buildingID, typeID, parentEquipmentID }, ...]
// Equipment field names use camelCase
```

### Timeseries — Latest Values

```js
const latest = await edo.get('/timeseries/latest', { id: [ptId1, ptId2, ptId3] });
// Returns: [{ id, value, latest_ts }, ...]
// id matches the point's raw ID field
```

### Timeseries — Statistics (min/max/avg over a range)

```js
const end   = new Date();
const start = new Date(+end - 7 * 24 * 3600 * 1000);  // 7 days ago

const stats = await edo.get('/timeseries/stat', {
  id:    [ptId1, ptId2],
  start: start.toISOString(),
  end:   end.toISOString(),
});
// Returns: [{ id, avg, min, max, count }, ...]
```

### Timeseries — Rollup (hourly aggregates)

**Important:** rollup is fetched per-point — one request per point ID.

```js
const end   = new Date();
const start = new Date(+end - 7 * 24 * 3600 * 1000);

// Fetch rollup for all points in parallel
const rollups = await Promise.all(
  pointIds.map(id => edo.get(`/timeseries/rollup/1/hour`, {
    id,
    // start/end optional — omit for all available data
  }))
);
// Each rollup is: [{ ts, value }, ...]  (sorted ascending by ts)
// No pointId in the response — track by index in your Promise.all
```

### API Response Patterns

The API sometimes wraps arrays in a pagination envelope. Always unwrap:

```js
const toArr = r => Array.isArray(r) ? r : (r?.data ?? r?.items ?? r?.value ?? []);
const points = toArr(await edo.get(`/point/building/${buildingId}/point`, { pc: classId }));
```

---

## Raw Field Name Reference

The API returns inconsistent casing across endpoints. Use these patterns:

| Entity | ID field | Name field | Other key fields |
|---|---|---|---|
| Site | `ID` | `Name` | `Abbreviation`, `Timezone` |
| Building | `id` | `name` | `address`, `siteID` |
| Point | `ID` | `FormatName` | `PointClassID`, `EquipmentID`, `UnitAbbreviation` |
| Point Class | `value` | `text` | `description`, `unitAbbreviation` |
| Equipment | `id` | `name` | `abbreviation`, `buildingID`, `typeID` |
| Timeseries latest | `id` | — | `value`, `latest_ts` |
| Timeseries rollup | — | — | `ts`, `value` |
| Timeseries stat | `id` | — | `avg`, `min`, `max`, `count` |

---

## Common Patterns

### Building a picker-driven dashboard

```js
async function main() {
  await edo.ready();
  const sites = await edo.get('/point/site');
  populatePicker('siteSelect', sites, s => ({ value: s.ID, label: s.Name }));
}

function populatePicker(id, items, mapper) {
  const sel = document.getElementById(id);
  sel.innerHTML = '<option value="">— select —</option>' +
    items.map(i => { const m = mapper(i); return `<option value="${m.value}">${m.label}</option>`; }).join('');
}

document.getElementById('siteSelect').addEventListener('change', async e => {
  const buildings = await edo.get(`/point/site/${e.target.value}/building`);
  populatePicker('buildingSelect', buildings, b => ({ value: b.id, label: b.name }));
});
```

### Finding a point class by name

```js
const classes = await edo.get('/point/class');
const zoneTemp = classes.find(c =>
  (c.text ?? '').toLowerCase().includes('zone temp') ||
  (c.description ?? '').toLowerCase().includes('zone temp')
);
const classId = zoneTemp?.value;  // use in ?pc= param
```

### Joining points to equipment

```js
const eqMap = Object.fromEntries(equipment.map(e => [String(e.id), e]));

points.forEach(point => {
  const eq = eqMap[String(point.EquipmentID)];
  const name = eq?.name ?? point.FormatName ?? `Point ${point.ID}`;
});
```

### Loading state pattern

```js
function show(id) {
  ['empty', 'loading', 'error', 'content'].forEach(s => {
    document.getElementById(s).style.display = s === id ? '' : 'none';
  });
}

// Usage:
show('loading');
try {
  const data = await edo.get('/point/site');
  // ... render
  show('content');
} catch (err) {
  document.getElementById('errorMsg').textContent = err.message;
  show('error');
}
```

---

## Promoting to Edo Lab

When your project is ready to share:

1. Create a GitHub repo (under `edo-energy` org or personal)
2. Deploy to **Azure Static Web Apps** (free tier, connects directly to GitHub)
3. Add an entry to `edo-lab/client/src/config/projects.js`:

```js
{
  id:          'my-project',
  type:        'visualization',
  title:       'My Project Title',
  description: 'One sentence describing what this shows.',
  status:      'concept',     // 'concept' | 'in-progress' | 'live'
  tags:        ['Buildings', 'Energy'],
  enabled:     false,         // set true when ready to publish
  url:         'https://my-project.azurestaticapps.net',
}
```

In production, `edo.js` receives auth via postMessage from the parent Lab app — no token pasting, no dev proxy.

---

## What NOT to Do

- **No npm / no build step** — keep it plain HTML + vanilla JS. No React, no bundlers.
- **No hardcoded tokens** — never commit `edo-dev-config.js` or `.token-cache.json`
- **No server-side logic** — this is a static site; all logic runs in the browser
- **No new API routes in the Lab server** — call the Edo API directly through the proxy at `/api/edo/*`
