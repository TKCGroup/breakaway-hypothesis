# Earth Watch globe: deploy notes for Altbot and Breakaway

Branch `tkc-pm/earth-globe` (off `40fc658`). Nothing here has been pushed or deployed.
Owner of the repo is Breakaway; deploy goes through Altbot (`AGENTS.md`).

## What changed

- `GET /earth` now serves a MapLibre GL JS globe page (`src/earthGlobe.ts`,
  `src/earthGlobeClient.ts`, rules shared in `src/logic/earthFilters.ts`).
- `GET /earth?view=classic` serves the previous Leaflet + three.js page unchanged.
  Delete that branch in `src/server.ts` (and `earthWatchHtml`) once the globe is accepted.
- `/api/earth`, `/visualizations`, `/earth/visualizations`, `/dashboard`, `/api/dashboard`,
  `/run`, `/healthz` and the three.js asset routes are unchanged. No new route, no new
  dependency, no lockfile change, no Dockerfile change, no env var.
- `/earth` now also reads the snapshot (same code as `/api/earth`, 4 s cap, any failure is
  swallowed) to server-render the first signal list for readers without JavaScript. It is still
  edge-cached with `s-maxage=300`, so expect at most one extra snapshot read per 5 minutes per
  edge location.

## Origins the page contacts (the exact CSP)

The service sets the CSP itself (`earthGlobeContentSecurityPolicy()` in `src/earthGlobe.ts`):

```
default-src 'self'; base-uri 'self';
connect-src 'self' https://gibs.earthdata.nasa.gov https://services.swpc.noaa.gov https://www.spc.noaa.gov https://services9.arcgis.com;
form-action 'none'; frame-ancestors 'none';
img-src 'self' data: blob: https://gibs.earthdata.nasa.gov;
script-src 'self' 'unsafe-inline' https://unpkg.com;
style-src 'self' 'unsafe-inline' https://unpkg.com;
worker-src blob:; child-src blob:
```

| Origin | Why | Loaded |
| --- | --- | --- |
| `https://unpkg.com` | MapLibre GL JS 5.24.0 script and CSS, pinned with SRI (already allowed today for Leaflet) | after first paint, skipped in low-power mode |
| `https://gibs.earthdata.nasa.gov` | NASA GIBS Blue Marble imagery tiles (`connect-src` is new: MapLibre fetches tiles, it does not use `<img>`) | with the globe |
| `https://services.swpc.noaa.gov` | NOAA SWPC OVATION aurora JSON, about 0.9 MB | only when Aurora is switched on |
| `https://www.spc.noaa.gov` | SPC categorical outlook GeoJSON, about 6 KB per day | only when Storm outlook is switched on |
| `https://services9.arcgis.com` | IMF PortWatch chokepoints (already in today's `connect-src`) | only when Shipping chokepoints is switched on |
| `blob:` (worker, img) | MapLibre runs its tile worker from a blob URL | with the globe |

No longer needed by `/earth` (still in the classic page's CSP): `cartocdn`, `nationalmap.gov`,
`fonts.googleapis.com`, `fonts.gstatic.com`, `api.weather.gov`, `earthquake.usgs.gov`,
`www.ngdc.noaa.gov`, `mapservices.weather.noaa.gov`. Web fonts were dropped (system fonts).

## Cloudflare Worker `tkcgroup-earth-watch` (not changed by this branch)

- The globe needs no new Worker route: it uses `/` (proxied to `/earth`), `/api/earth` and
  `/visualizations` only. MapLibre is loaded from unpkg, not from `/assets/*`.
- The Worker must pass the service's `Content-Security-Policy` header through untouched (or
  replace it with exactly the policy above). If it sets its own CSP, the globe fails visibly.
- The Worker should pass `?view=classic` through if you want the rollback path at the public host.
- Cache: unchanged (`s-maxage=300` on HTML, `s-maxage=60` on `/api/earth`).

## Deploy packet (branch + commit, test command, env delta, behaviour to verify)

- Branch/commit: `tkc-pm/earth-globe` at the tip commit.
- Test command: `pnpm typecheck && pnpm test && pnpm build` (the Dockerfile already runs all three).
- Env delta: none. Build delta: `tsconfig.build.json` sets `removeComments`, because the page serialises
  functions and would otherwise ship their comments to the browser.
- Verify after deploy: `/` shows the globe and the signal list; the browser console has no CSP
  violations; `/?view=classic` still shows the old page; `/api/earth` is unchanged; turn on
  Aurora, Storm outlook and Shipping chokepoints and each reports a status line.

## Imagery and licences

- Imagery: NASA GIBS Blue Marble Shaded Relief with Bathymetry, keyless, public domain (NASA
  Earth science data policy). It is the same layer the retired globe already used. Max native
  zoom 8 (about 1 km per pixel at the equator at that level); the page is a situational
  globe, not a street map.
- Engine: MapLibre GL JS, BSD-3-Clause. Attribution is in the map's attribution control, the
  page footer and the About panel.
- Event data: USGS, NOAA/NWS, NOAA/NHC, NOAA/SWPC, NASA (public domain / official). SPC outlook:
  public domain. IMF PortWatch: free with attribution; confirm the current terms page before
  any commercial redistribution beyond this display. Places: GeoNames CC BY 4.0 (credited).
- Not on this page by design: cameras, license-plate readers, military, flight tracking, radio,
  voice, API keys, Google 3D tiles. `earthGlobePage.test.ts` fails if those terms appear.

## Not ported from the classic page (still there at `?view=classic`)

USGS ShakeMap contours and felt-radius rings, antipodes, the seismic run-up chart, NHC forecast
cone and track geometry (storms show as points from `/api/earth`), tsunami warnings and history,
on-demand NWS zone geometry for non-spatial alerts, the aggregate signal heat layer, and the
USGS topo basemap. The date filters, hazard pills, source filter, ranking, stale-gate and
map-context text, target regions, day/night bands and Night Watch (ambient glow) are ported.

## Checked

Desktop 1440x900 and phone 390x844 headless Chrome: no horizontal overflow, list-only paths
(JavaScript off, Data Saver on) never request the map engine, accessibility tree has no unnamed
controls, keyboard order and Escape/focus return work. Screenshots are in `work/`.
Not verified: iOS Safari and low-end Android GPUs (MapLibre globe projection is WebGL 1/2),
behaviour behind the real Cloudflare Worker, and the Cloud SQL-backed server-rendered list
(tests use the in-memory repository).
