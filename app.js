/**
 * app.js — starter project logic
 *
 * Replace this file with your project's code.
 * The `edo` global is provided by edo.js (loaded before this script).
 *
 * Available API routes (all prefixed /api on the Lab server):
 *   /buildings                                   → list of sites
 *   /buildings/sites/:siteId                     → buildings for a site
 *   /buildings/:buildingId/equipment             → equipment for a building
 *   /buildings/:buildingId/equipment/classes     → equipment class definitions
 *   /buildings/:buildingId/points                → points (pageSize, pageNumber, pointClassId)
 *   /equipment/:equipmentId                      → single equipment
 *   /equipment/:equipmentId/points               → points for an equipment
 *   /point-classes                               → all point class definitions
 *   /timeseries/latest?id=1&id=2                 → latest values
 *   /timeseries/rollup?id=1&interval=1&unit=hour → aggregated trend data
 *   /timeseries/stat?id=1&id=2&start=...&end=... → min/max/avg stats
 */
async function main() {
  const app = document.getElementById('app');
  app.textContent = 'Connecting…';

  try {
    // Example: list sites and buildings
    const sites = await edo.get('/buildings');

    if (!sites.length) {
      app.innerHTML = '<p>No sites available for your account.</p>';
      return;
    }

    const site      = sites[0];
    const buildings = await edo.get(`/buildings/sites/${site.id}`);

    app.innerHTML = `
      <h2>${site.name}</h2>
      <ul>
        ${buildings.map(b => `<li>${b.name}</li>`).join('')}
      </ul>`;
  } catch (err) {
    app.innerHTML = `<p style="color:#e53e3e">Error: ${err.message}</p>`;
    console.error(err);
  }
}

main();
