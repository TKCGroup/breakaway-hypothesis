import type { EarthMapEvent, EarthWatchData } from "./earth.js";
import { CITY_ATTRIBUTION } from "./logic/nearestCity.js";
import { ambientClientSource } from "./logic/ambient.js";
import {
  earthFiltersClientSource,
  selectEvents,
  sortSignals
} from "./logic/earthFilters.js";
import { solarClientSource } from "./logic/solar.js";
import { globeClientSource } from "./earthGlobeClient.js";

/**
 * The public Earth Watch page: a light globe, a signal list, and public-safe layers.
 *
 * Replaces the Leaflet + three.js page for `/earth` (that page is still served at
 * `/earth?view=classic` until Altbot signs off, see DEPLOY-NOTES.md). The design
 * rules, in order of how often they were decided against:
 *
 * 1. White space. One globe, one row of filters, everything else on request.
 * 2. Weight. The map engine is loaded after the list is on screen, only when the
 *    device is not in a low-power state, and never for a reader without JavaScript.
 * 3. Honesty. A failed feed says so and never renders as an empty all-clear.
 * 4. Public-safe only. Official hazard data, space weather, the SPC outlook and
 *    shipping chokepoints. No cameras, plate readers, military, flight, radio or
 *    voice layers belong on this page.
 *
 * The script is assembled from four sources that the tests run directly:
 * solar geometry, the ambient rule, the filter rules, and `globeClient`.
 */

/**
 * MapLibre GL JS, pinned and integrity-checked, loaded from unpkg exactly as the
 * retired page loaded Leaflet. unpkg is already an allowed script and style origin,
 * so no new script origin is needed and the Cloudflare Worker route list is unchanged.
 */
export const MAPLIBRE = {
  version: "5.24.0",
  js: "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js",
  css: "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css",
  jsIntegrity:
    "sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp",
  cssIntegrity:
    "sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK"
} as const;

/** Every origin the globe page may contact, and why. Also the source of the CSP. */
export const GLOBE_ORIGINS = {
  scriptAndStyle: ["https://unpkg.com"],
  connectAndImage: [
    // NASA GIBS: Blue Marble imagery tiles (public domain).
    "https://gibs.earthdata.nasa.gov"
  ],
  connect: [
    // NOAA SWPC OVATION aurora forecast, only when the aurora layer is switched on.
    "https://services.swpc.noaa.gov",
    // NOAA/NWS Storm Prediction Center categorical outlook GeoJSON.
    "https://www.spc.noaa.gov",
    // IMF PortWatch chokepoints (Esri-hosted feature service; already allowed today).
    "https://services9.arcgis.com"
  ]
} as const;

export function earthGlobeContentSecurityPolicy(): string {
  const imgAndConnect = GLOBE_ORIGINS.connectAndImage.join(" ");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src 'self' ${imgAndConnect} ${GLOBE_ORIGINS.connect.join(" ")}`,
    "form-action 'none'",
    "frame-ancestors 'none'",
    `img-src 'self' data: blob: ${imgAndConnect}`,
    `script-src 'self' 'unsafe-inline' ${GLOBE_ORIGINS.scriptAndStyle.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${GLOBE_ORIGINS.scriptAndStyle.join(" ")}`,
    // MapLibre runs its tile worker from a blob: URL.
    "worker-src blob:",
    "child-src blob:"
  ].join("; ");
}

const ATTRIBUTION = [
  "Imagery: NASA GIBS Blue Marble (public domain)",
  "Events: USGS, NOAA/NWS, NOAA/NHC, NOAA/SWPC, NASA via Earth Watch",
  "Outlook: NOAA/NWS SPC",
  "Shipping: IMF PortWatch"
];

const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char
  );

const safeHttps = (value: unknown): string => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.href : "#";
  } catch {
    return "#";
  }
};

const FAMILY_COLORS: Record<string, string> = {
  earthquake: "#347FAC",
  weather: "#BE2618",
  natural: "#DE5F26",
  volcano: "#7A4D91",
  tsunami: "#246B82",
  space_weather: "#697B73"
};

export interface EarthGlobePageOptions {
  /** Live snapshot for the server-rendered list. Absent means the list loads by script. */
  data?: EarthWatchData | null;
  now?: Date;
}

/**
 * The list a reader without JavaScript gets, and the first paint for everyone else.
 * It applies the shared "now" window, so it agrees with the map's default view.
 */
export function renderSignalListHtml(
  data: EarthWatchData,
  now: Date,
  limit = 40
): string {
  const events = sortSignals(
    selectEvents<EarthMapEvent>(
      data.map.events,
      { hazards: [], source: "all", window: "now" },
      now.getTime()
    ),
    "score"
  );
  if (!events.length) {
    return '<li class="empty">No qualifying official signals in this view.</li>';
  }
  const rows = events.slice(0, limit).map((event) => {
    const link = safeHttps(event.officialUrl);
    const title = escapeHtml(event.title);
    const name =
      link === "#"
        ? title
        : `<a href="${escapeHtml(link)}" rel="noopener">${title}</a>`;
    return (
      `<li><span class="signal static"><span class="sbar" style="--c:${FAMILY_COLORS[event.family] ?? "#697B73"}"></span>` +
      `<span class="txt"><span class="name">${name}</span>` +
      `<span class="meta">${escapeHtml(event.sourceLabel)} · <time datetime="${escapeHtml(event.eventTime)}">${escapeHtml(event.eventTime.slice(0, 16).replace("T", " "))} UTC</time>` +
      ` · alert gate ${escapeHtml(event.staleGateResult)}</span></span>` +
      `<span class="score">${escapeHtml(event.score)}</span></span></li>`
    );
  });
  if (events.length > limit) {
    rows.push(
      `<li class="empty">Showing the top ${limit} of ${events.length} signals. Turn on JavaScript for the full list and filters.</li>`
    );
  }
  return rows.join("");
}

const STYLE = `
:root {
  --paper:#F1F3EF; --panel:#FBFCFA; --ink:#1E2A2C; --muted:#5C6A66; --hair:#D4DAD3;
  --clear:#2F7D57; --watch:#D3921F; --high:#DE5F26; --critical:#BE2618; --focus:#176452;
  --ambient-color:#2F7D57; --ambient-alpha:0.08; --ambient-reach:4vmin;
}
* { box-sizing:border-box; }
html, body { margin:0; }
body {
  background:var(--paper); color:var(--ink); min-height:100vh; min-height:100dvh;
  font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased;
}
a { color:var(--focus); }
button, select, input { font:inherit; color:inherit; }
button { cursor:pointer; }
:focus-visible { outline:3px solid var(--focus); outline-offset:2px; }
.skip { position:absolute; left:8px; top:-60px; background:var(--ink); color:var(--paper); padding:10px 14px; z-index:50; border-radius:4px; }
.skip:focus { top:8px; }
.mono { font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
[hidden] { display:none !important; }

/* Header: a wordmark, one status chip, two quiet buttons. */
.topbar {
  display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:14px 20px;
}
.brand { display:flex; align-items:baseline; gap:10px; margin-right:auto; }
.brand h1 { margin:0; font-size:19px; letter-spacing:.06em; text-transform:uppercase; font-weight:700; }
.brand span { color:var(--muted); font-size:12px; letter-spacing:.14em; text-transform:uppercase; }
.status { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--muted); }
.chip {
  --tone:var(--muted); display:inline-flex; align-items:center; gap:7px; padding:3px 10px;
  border:1px solid var(--tone); border-radius:999px; color:var(--ink); font-size:12.5px; font-weight:600;
}
.chip::before { content:""; width:8px; height:8px; border-radius:50%; background:var(--tone); }
.dot { width:8px; height:8px; border-radius:50%; background:var(--clear); display:inline-block; }
.dot.stale { background:var(--critical); }
.nav { display:flex; gap:6px; align-items:center; }
.nav a, .quiet-btn {
  min-height:40px; display:inline-flex; align-items:center; padding:0 12px; border:1px solid transparent;
  border-radius:6px; background:transparent; color:var(--muted); text-decoration:none; font-size:13px;
}
.nav a:hover, .quiet-btn:hover { color:var(--ink); border-color:var(--hair); }
.quiet-btn[aria-expanded="true"] { color:var(--ink); border-color:var(--ink); }

.error { margin:0 20px 8px; padding:10px 14px; border:1px solid #F0C8A0; border-left:4px solid var(--critical); background:#FDF3EC; color:#753616; border-radius:4px; font-size:13.5px; }

/* Stage: the globe floats in the page. No card, no border, no fill. */
.main { display:grid; grid-template-columns:minmax(0,1fr); }
.stage { position:relative; height:66vh; height:66dvh; min-height:420px; }
#globe { position:absolute; inset:0; outline-offset:-3px; }
html:not([data-globe="ready"]) #globe { visibility:hidden; }
.maplibregl-canvas { outline:none; }
.maplibregl-ctrl-attrib { background:rgba(241,243,239,.85) !important; font-size:11px; }
.maplibregl-ctrl-group { border-radius:6px; box-shadow:none !important; border:1px solid var(--hair); }
.overlay { position:absolute; z-index:5; }
.top-left { left:20px; top:4px; right:20px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
.bottom-left { left:20px; bottom:34px; right:70px; }
.seg { display:inline-flex; gap:2px; background:var(--panel); border:1px solid var(--hair); border-radius:8px; padding:2px; }
.top-left .quiet-btn { background:var(--panel); border-color:var(--hair); }
.seg button {
  min-height:36px; padding:0 11px; border:0; border-radius:6px; background:transparent; color:var(--muted); font-size:13px;
}
.seg button:hover { color:var(--ink); }
.seg button[aria-pressed="true"] { background:var(--ink); color:var(--paper); }
.pills { display:flex; gap:6px; flex-wrap:nowrap; overflow-x:auto; padding-bottom:6px; scrollbar-width:none; }
.pills::-webkit-scrollbar { display:none; }
.pill {
  --hz:var(--ink); flex:0 0 auto; min-height:36px; display:inline-flex; align-items:center; gap:6px; padding:0 11px;
  border:1px solid var(--hair); border-radius:999px; background:var(--panel); font-size:12.5px; color:var(--muted);
}
.pill svg { color:var(--hz); }
.pill b { font-weight:600; font-variant-numeric:tabular-nums; opacity:.75; }
.pill:hover { color:var(--ink); border-color:var(--hz); }
.pill[aria-pressed="true"] { color:var(--ink); border-color:var(--hz); box-shadow:inset 0 0 0 1px var(--hz); font-weight:600; }
.pill[data-empty="true"] { opacity:.5; }
.focusline { font-size:12.5px; color:var(--muted); margin:0 0 6px; }

/* Panels open on request and sit over the globe's edge. */
.panel {
  position:absolute; z-index:8; background:var(--panel); border:1px solid var(--hair); border-radius:8px;
  padding:14px 16px; width:min(340px, calc(100% - 24px)); max-height:calc(100% - 24px); overflow:auto;
}
#layersPanel { right:12px; top:12px; }
#detail { left:12px; top:56px; --c:var(--ink); border-top:4px solid var(--c); }
.panel h2 { margin:0 0 4px; font-size:15px; line-height:1.3; }
.panel h2:focus { outline:none; }
.panel .x { position:absolute; right:6px; top:6px; min-height:36px; min-width:36px; border:0; background:transparent; font-size:20px; color:var(--muted); }
.panel dl { margin:8px 0 0; display:grid; grid-template-columns:auto 1fr; gap:3px 12px; font-size:12.5px; }
.panel dt { color:var(--muted); }
.panel dd { margin:0; overflow-wrap:anywhere; }
.prose { font-size:12.5px; color:#31413f; }
.prose p { margin:8px 0 0; }
.links { margin:10px 0 0; display:grid; gap:4px; font-size:12.5px; }
.links .quiet { color:var(--muted); }
.layer { display:grid; grid-template-columns:auto 1fr; gap:2px 10px; align-items:center; padding:9px 0; border-top:1px solid var(--hair); font-size:13.5px; }
.layer:first-of-type { border-top:0; }
.layer input[type="checkbox"] { width:20px; height:20px; margin:0; accent-color:var(--ink); }
.layer small { grid-column:2; color:var(--muted); font-size:11.5px; line-height:1.4; }
.layer small[data-tone="error"] { color:var(--critical); font-weight:600; }
.layer select { margin-left:8px; min-height:30px; border:1px solid var(--hair); border-radius:4px; background:var(--panel); }
.lowpower { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; padding:24px; z-index:3; }
.lowpower p { max-width:38ch; color:var(--muted); margin:0 0 12px; }
.primary { min-height:44px; padding:0 18px; border:1px solid var(--ink); border-radius:6px; background:var(--ink); color:var(--paper); font-weight:600; }
.status-line { position:absolute; left:20px; top:52px; z-index:4; font-size:12.5px; color:var(--muted); margin:0; }

/* Signals: a plain list, on the right at desktop widths and below the globe on a phone. */
.drawer { padding:8px 20px 28px; }
.drawer h2 { margin:14px 0 4px; font-size:13px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap; }
.drawer .tools { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:6px 0 8px; font-size:12.5px; color:var(--muted); }
.drawer select { min-height:34px; border:1px solid var(--hair); border-radius:4px; background:var(--panel); padding:0 6px; }
.summary { font-size:12.5px; color:var(--muted); margin:2px 0 0; }
.list { list-style:none; margin:0; padding:0; }
.signal { width:100%; display:grid; grid-template-columns:6px minmax(0,1fr) auto; gap:10px; text-align:left; padding:10px 0; border:0; border-bottom:1px solid var(--hair); background:transparent; align-items:stretch; }
button.signal:hover .name { text-decoration:underline; }
.signal .sbar { background:var(--c,#697B73); border-radius:3px; }
.signal .name { display:block; font-weight:600; font-size:14px; line-height:1.3; }
.signal .meta { display:block; color:var(--muted); font-size:12px; margin-top:2px; }
.signal .score { font-family:ui-monospace,Menlo,monospace; font-size:12px; color:var(--muted); }
.empty { color:var(--muted); font-size:13px; padding:10px 0; }
details.more { margin-top:14px; border-top:1px solid var(--hair); padding-top:8px; }
details.more summary { cursor:pointer; min-height:36px; display:flex; align-items:center; color:var(--muted); font-size:13px; }
.sources { list-style:none; display:flex; gap:6px; flex-wrap:wrap; margin:8px 0; padding:0; font-size:11.5px; }
.sources li { border:1px solid var(--hair); border-radius:999px; padding:2px 9px; color:var(--muted); }
.sources li.bad { border-color:var(--critical); color:var(--critical); }
.method { font-size:12px; color:var(--muted); }
.disc { font-size:12.5px; color:#753616; margin:12px 0 0; }
footer { padding:12px 20px 28px; font-size:11.5px; color:var(--muted); }
footer ul { margin:6px 0 0; padding:0; list-style:none; display:flex; gap:4px 16px; flex-wrap:wrap; }

/* The list-only experience: no JavaScript, or a device that should not load the map. */
html:not(.js) .stage, html:not(.js) .drawer .tools, html:not(.js) #layersToggle, html:not(.js) #listToggle { display:none; }
html[data-globe="paused"] .stage { height:auto; min-height:0; }
html[data-globe="paused"] .stage .overlay { display:none; }
html[data-globe="paused"] .lowpower { position:static; padding:8px 20px 0; justify-content:flex-start; text-align:left; }
html[data-globe="failed"] .stage { height:auto; min-height:0; }
html[data-globe="failed"] .lowpower { position:static; padding:8px 20px 0; justify-content:flex-start; text-align:left; }
html[data-globe="failed"] .stage .overlay { display:none; }

@media (min-width:960px) {
  body { height:100vh; height:100dvh; overflow:hidden; display:flex; flex-direction:column; }
  .main { flex:1; min-height:0; grid-template-columns:minmax(0,1fr) 380px; }
  html[data-list="hidden"] .main { grid-template-columns:minmax(0,1fr); }
  html[data-list="hidden"] .drawer { display:none; }
  .stage { height:auto; min-height:0; }
  .drawer { overflow:auto; border-left:1px solid var(--hair); }
  footer { padding:6px 20px 10px; border-top:1px solid var(--hair); }
  footer ul { margin-top:2px; }
  html[data-globe="paused"] body, html[data-globe="failed"] body { overflow:auto; height:auto; display:block; }
}
@media (max-width:640px) {
  .topbar { padding:10px 14px; gap:8px; }
  .brand span { display:none; }
  .top-left { left:10px; right:10px; }
  .bottom-left { left:10px; right:56px; }
  .drawer, footer { padding-left:14px; padding-right:14px; }
  #detail { left:8px; right:8px; width:auto; top:auto; bottom:8px; max-height:60%; }
}
@media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto !important; } }

/* Night watch: dim the page after 3 idle minutes; the edge glow speaks for the lead event. */
#ambientGlow { position:fixed; inset:0; z-index:90; pointer-events:none; box-shadow:inset 0 0 var(--ambient-reach) calc(var(--ambient-reach) / 2.5) var(--ambient-color); opacity:var(--ambient-alpha); }
#ambientScrim { position:fixed; inset:0; z-index:80; background:#03050A; opacity:0; pointer-events:none; transition:opacity 2s ease; }
#ambientReadout { position:fixed; left:0; right:0; bottom:14px; z-index:91; text-align:center; font:12px/1.4 ui-monospace,Menlo,monospace; letter-spacing:.06em; color:var(--ambient-color); opacity:0; pointer-events:none; transition:opacity 2s ease; }
#ambientToggle { position:fixed; right:10px; bottom:10px; z-index:92; min-height:32px; padding:0 10px; border:1px solid var(--hair); border-radius:6px; background:var(--panel); color:var(--muted); font-size:11px; opacity:.6; }
#ambientToggle:hover { opacity:1; color:var(--ink); }
#ambientToggle[aria-pressed="true"] { color:var(--clear); border-color:var(--clear); }
html[data-ambient="on"] #ambientScrim { opacity:.955; pointer-events:auto; }
html[data-ambient="on"] #ambientReadout { opacity:.52; }
html[data-ambient="on"] #ambientToggle { opacity:.12; }
@media (prefers-reduced-motion:no-preference) { #ambientGlow.ambient-pulse { animation:ambient-breathe 7s ease-in-out infinite; } }
@keyframes ambient-breathe { 0%,100% { opacity:var(--ambient-alpha); } 50% { opacity:calc(var(--ambient-alpha) * 0.42); } }
@media (max-width:640px) { #ambientToggle { position:static; display:block; margin:0 14px 18px; } }
`;

export function earthGlobeHtml(options: EarthGlobePageOptions = {}): string {
  const now = options.now ?? new Date();
  const listHtml = options.data
    ? renderSignalListHtml(options.data, now)
    : '<li class="empty">Loading official signals. If this stays empty, the JSON at /api/earth has the same data.</li>';
  const posture = options.data?.posture;
  const TONES: Record<string, string> = {
    normal: "#2F7D57",
    watch: "#D3921F",
    elevated: "#DE5F26",
    critical: "#BE2618"
  };
  const toneColor = TONES[posture?.tone ?? ""] ?? "#5C6A66";
  const chipText = posture ? `${posture.stage} ${posture.label}` : "Loading";
  const freshText = options.data
    ? `Updated ${options.data.generatedAt.slice(0, 16).replace("T", " ")} UTC`
    : "Reading official records...";
  const healthy = options.data?.sources.filter((s) => s.status === "ok").length ?? 0;
  const summaryText = options.data
    ? `${options.data.summary.activeMapSignals} active map signals · ${healthy}/${options.data.sources.length} official sources healthy`
    : "Reading the latest official cycle...";
  const listCount = options.data
    ? selectEvents<EarthMapEvent>(
        options.data.map.events,
        { hazards: [], source: "all", window: "now" },
        now.getTime()
      ).length
    : 0;
  const config = JSON.stringify({
    mapJs: MAPLIBRE.js,
    mapJsIntegrity: MAPLIBRE.jsIntegrity,
    mapCss: MAPLIBRE.css,
    mapCssIntegrity: MAPLIBRE.cssIntegrity,
    attribution: ATTRIBUTION
  });

  return `<!doctype html>
<html lang="en" data-list="shown">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#F1F3EF">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Earth Watch">
  <title>Earth Watch - official geohazard conditions</title>
  <meta name="description" content="Official-source earthquake, volcano, tsunami, severe-weather, natural-event, and space-weather situational awareness on a live globe.">
  <meta property="og:title" content="Earth Watch - official geohazard conditions">
  <meta property="og:description" content="A live official-source view of current geological and natural hazard signals.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://earth.tkcgroup.co/">
  <link rel="canonical" href="https://earth.tkcgroup.co/">
  <script>document.documentElement.className += " js";</script>
  <style>${STYLE}</style>
</head>
<body>
  <a class="skip" href="#signals">Skip to the signal list</a>
  <div id="ambientScrim" aria-hidden="true"></div>
  <div id="ambientGlow" aria-hidden="true"></div>
  <div id="ambientReadout" aria-hidden="true"></div>

  <header class="topbar">
    <div class="brand"><h1>Earth Watch</h1><span>Official geohazard watch</span></div>
    <div class="status" role="status" aria-live="polite">
      <span class="dot${options.data && posture?.sourceHealth !== "healthy" ? " stale" : ""}" id="liveDot"></span>
      <span class="chip" id="postureChip" style="--tone:${toneColor}">${escapeHtml(chipText)}</span>
      <span class="mono" id="fresh">${escapeHtml(freshText)}</span>
    </div>
    <nav class="nav" aria-label="Earth Watch">
      <a href="/visualizations">Visualizations</a>
      <button type="button" class="quiet-btn" id="layersToggle" aria-expanded="false" aria-controls="layersPanel">Layers</button>
      <button type="button" class="quiet-btn" id="listToggle" aria-expanded="true" aria-controls="signals">Signals</button>
    </nav>
  </header>
  <div class="error" id="error" role="alert" hidden></div>

  <div class="main">
    <section class="stage" aria-label="Globe">
      <div id="globe" role="application" tabindex="0"
           aria-label="Interactive globe of official geohazard events. Arrow keys pan, plus and minus zoom. Every event is also in the signal list."></div>

      <div class="overlay top-left">
        <div class="seg" id="windows" role="group" aria-label="Time window"></div>
        <button type="button" class="quiet-btn" id="recentre">Top activity</button>
      </div>
      <p class="status-line" id="status" role="status" aria-live="polite"></p>

      <div class="overlay bottom-left">
        <p class="focusline" id="mapFocus">Finding the strongest eligible official activity...</p>
        <div class="pills" id="pills" role="group" aria-label="Filter by hazard family"></div>
      </div>

      <div class="lowpower" id="lowPower" hidden>
        <div>
          <p>The globe is paused (<span id="lowPowerReason">low power</span>). The full signal list below has every event.</p>
          <button type="button" class="primary" id="loadGlobe">Load the globe anyway</button>
        </div>
      </div>

      <aside class="panel" id="layersPanel" aria-label="Map layers" hidden>
        <h2>Layers</h2>
        <label class="layer"><input type="checkbox" id="tDayNight"><span>Day and night</span><small>Solar twilight bands, computed in the page.</small></label>
        <label class="layer"><input type="checkbox" id="tRegions"><span>Target regions</span><small>Configured watch regions, coloured by effective stage.</small></label>
        <label class="layer"><input type="checkbox" id="tAurora"><span>Aurora forecast</span><small id="auroraStatus">NOAA SWPC OVATION model, loaded when switched on.</small></label>
        <label class="layer"><input type="checkbox" id="tSpc"><span>Storm outlook
          <select id="spcDay" aria-label="SPC outlook day"><option value="1">Day 1</option><option value="2">Day 2</option><option value="3">Day 3</option></select></span>
          <small id="spcStatus">NOAA SPC categorical outlook, loaded when switched on.</small></label>
        <label class="layer"><input type="checkbox" id="tPorts"><span>Shipping chokepoints</span><small id="portsStatus">IMF PortWatch, loaded when switched on.</small></label>
        <label class="layer"><input type="checkbox" id="tSpin"><span>Slow spin</span><small>Pauses when you touch the globe.</small></label>
      </aside>

      <aside class="panel" id="detail" aria-labelledby="detailTitle" hidden>
        <button type="button" class="x" id="detailClose" aria-label="Close details">&times;</button>
        <h2 id="detailTitle" tabindex="-1"></h2>
        <div id="detailBody"></div>
      </aside>
    </section>

    <section class="drawer" id="signals" aria-label="Signals">
      <h2><span>Signals in this view</span><span class="mono" id="signalCount">${listCount}</span></h2>
      <p class="summary" id="summaryLine">${escapeHtml(summaryText)}</p>
      <div class="tools">
        <label>Source <select id="sourceFilter" aria-label="Official source">
          <option value="all">All official sources</option><option value="usgs">USGS</option><option value="nws">NOAA/NWS</option>
          <option value="swpc">NOAA/SWPC</option><option value="nasa">NASA</option><option value="tsunami">NOAA Tsunami</option>
        </select></label>
        <label>Rank <select id="signalSort" aria-label="Rank signals by">
          <option value="score">Score</option><option value="lastActive">Last active</option><option value="magnitude">Magnitude</option>
        </select></label>
      </div>
      <ol class="list" id="signalList">${listHtml}</ol>

      <details class="more">
        <summary>Non-spatial context <span class="mono">&nbsp;<span id="contextCount">0</span></span></summary>
        <ol class="list" id="contextList"><li class="empty">Loading...</li></ol>
      </details>
      <details class="more">
        <summary>About this page</summary>
        <p class="disc"><strong>Not a prediction or emergency-warning service.</strong> Earthquakes cannot be predicted by this page. For immediate instructions, follow the linked issuing agency and local emergency management.</p>
        <p class="method" id="about-posture"></p>
        <p class="method" id="method">Loading the disclosed map method...</p>
        <ul class="sources" id="sources"></ul>
      </details>
    </section>
  </div>

  <footer>
    Official-source situational awareness. Report-only. earth.tkcgroup.co
    <ul>
      <li>Imagery: <a href="https://earthdata.nasa.gov/gibs" rel="noopener">NASA GIBS</a> Blue Marble (public domain)</li>
      <li>Events: USGS, NOAA/NWS, NOAA/NHC, NOAA/SWPC, NASA</li>
      <li>Outlook: NOAA/NWS Storm Prediction Center</li>
      <li>Shipping: <a href="https://portwatch.imf.org/" rel="noopener">IMF PortWatch</a></li>
      <li>Places: ${escapeHtml(CITY_ATTRIBUTION)}</li>
      <li>Map engine: <a href="https://maplibre.org/" rel="noopener">MapLibre GL JS</a> (BSD-3-Clause)</li>
    </ul>
  </footer>

  <button id="ambientToggle" type="button" aria-pressed="false"
          title="Night watch: dim the page after 3 minutes idle so the edge glow reads in a dark room">night watch</button>

  <script>window.__earthGlobeConfig = ${config};</script>
  <script>
  (function() {
    "use strict";
${solarClientSource()}
${ambientClientSource()}
${earthFiltersClientSource()}
${globeClientSource()}
  })();
  </script>
</body>
</html>
`;
}
