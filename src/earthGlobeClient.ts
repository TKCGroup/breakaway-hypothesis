// @ts-nocheck
/**
 * Browser logic for the Earth Watch globe page.
 *
 * `globeClient` is serialised into the page with `.toString()` (see earthGlobe.ts),
 * so it must stay self-contained: no imports, no module-scope references. The
 * shared rules it calls by bare name (selectEvents, sortSignals, familyCounts,
 * subsolarPoint, solarElevationDeg, ambientGlow) are emitted into the same scope
 * from src/logic, which is what keeps the page and the tests on one definition.
 *
 * This file is excluded from type checking on purpose: it is browser code that
 * talks to a lazily loaded global (maplibregl). Behaviour is covered by
 * earthGlobePage.test.ts (syntax, wiring, safety rules) and by the headless
 * browser checks recorded in DEPLOY-NOTES.md.
 *
 * Deliberate omissions from the retired flat-map page (still reachable at
 * /?view=classic): ShakeMap contours and felt rings, antipodes, the seismic
 * run-up chart, NHC cone and track geometry, tsunami history and warnings, and
 * on-demand NWS zone geometry. Nothing here contacts any origin that is not in
 * DEPLOY-NOTES.md.
 */
export function globeClient(): void {
  "use strict";

  var doc = document;
  function $(id) {
    return doc.getElementById(id);
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }
  // Every href on the page is checked here, including the ones built from data.
  function safeUrl(value) {
    try {
      var url = new URL(String(value));
      return url.protocol === "https:" ? url.href : "#";
    } catch (error) {
      return "#";
    }
  }
  function relative(value) {
    if (!value) return "-";
    var seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
    if (seconds < 60) return seconds + "s ago";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + "h ago";
    return Math.round(hours / 24) + "d ago";
  }
  function fmt(value) {
    if (!value) return "-";
    try {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short"
      }).format(new Date(value));
    } catch (error) {
      return String(value);
    }
  }
  function formatNumber(value) {
    return Number(value).toLocaleString("en-US");
  }
  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* private mode: preferences simply do not persist */
    }
    return null;
  }

  // ---- Constants ---------------------------------------------------------------
  var COLORS = {
    earthquake: "#347FAC",
    weather: "#BE2618",
    natural: "#DE5F26",
    volcano: "#7A4D91",
    tsunami: "#246B82",
    space_weather: "#697B73"
  };
  var FAMILIES = [
    { key: "earthquake", label: "Earthquake" },
    { key: "weather", label: "Severe weather" },
    { key: "volcano", label: "Volcano" },
    { key: "tsunami", label: "Tsunami" },
    { key: "natural", label: "Natural event" },
    { key: "space_weather", label: "Space weather" }
  ];
  var WINDOWS = [
    { key: "now", label: "Now" },
    { key: "24h", label: "24h" },
    { key: "7d", label: "7d" },
    { key: "30d", label: "30d" },
    { key: "forecast", label: "Forecast" },
    { key: "all", label: "All" }
  ];
  var SPC_COLORS = {
    TSTM: "#C1E9C1",
    MRGL: "#66C57D",
    SLGT: "#F6F67B",
    ENH: "#E6B366",
    MDT: "#E67E7E",
    HIGH: "#FF59FF"
  };
  var SIGNAL_CAP = 100;
  var GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  var URLS = {
    earth: "/api/earth",
    ovation: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
    spc: function (day) {
      return "https://www.spc.noaa.gov/products/outlook/day" + day + "otlk_cat.nolyr.geojson";
    },
    portPoints:
      "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/PortWatch_chokepoints_database/FeatureServer/0/query",
    portDaily:
      "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query"
  };
  var CONFIG = window.__earthGlobeConfig || {};

  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (error) {}

  var state = {
    data: null,
    window: "now",
    hazards: [],
    source: "all",
    sort: "score",
    selectedId: null,
    map: null,
    mapState: "idle", // idle | loading | ready | failed | paused
    layers: {
      dayNight: true,
      regions: true,
      aurora: false,
      spc: false,
      chokepoints: false,
      spin: !reducedMotion
    },
    spcDay: 1,
    userMoved: false,
    focusApplied: false,
    aurora: null,
    spcData: {},
    ports: null
  };
  var storedSort = store("earthWatch.signalSort");
  if (storedSort === "score" || storedSort === "lastActive" || storedSort === "magnitude") {
    state.sort = storedSort;
  }

  // ---- Filters (shared rules, see src/logic/earthFilters.ts) ---------------------
  function filterNow() {
    return { hazards: state.hazards, source: state.source, window: state.window };
  }
  function allEvents() {
    return state.data ? state.data.map.events : [];
  }
  function selected() {
    return selectEvents(allEvents(), filterNow(), Date.now());
  }
  function findEvent(id) {
    var list = allEvents().concat(state.data ? state.data.map.nonSpatialSignals || [] : []);
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
    return null;
  }
  function contextWindow(hours) {
    return hours >= 48 && hours % 24 === 0 ? hours / 24 + "d" : hours + "h";
  }
  function mapContextLabel(event) {
    if (!event.mapContext) return "unavailable";
    if (event.mapContext.result === "magnitude_extended") {
      return "magnitude context (" + contextWindow(event.mapContext.windowHours) + ")";
    }
    return event.mapContext.result + " (" + contextWindow(event.mapContext.windowHours) + ")";
  }

  // ---- Geometry helpers ------------------------------------------------------------
  // Returns [lon, lat]. Polygons use the mean of their outer ring.
  function pointFor(geometry) {
    if (!geometry) return null;
    if (geometry.type === "Point") return geometry.coordinates.slice(0, 2);
    var ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0] && geometry.coordinates[0][0];
    if (!ring || !ring.length) return null;
    var x = 0;
    var y = 0;
    for (var i = 0; i < ring.length; i += 1) {
      x += ring[i][0];
      y += ring[i][1];
    }
    return [x / ring.length, y / ring.length];
  }
  function circleRing(lat, lon, radiusKm) {
    var ring = [];
    var d = radiusKm / 6371;
    var la = (lat * Math.PI) / 180;
    var lo = (lon * Math.PI) / 180;
    for (var i = 0; i <= 72; i += 1) {
      var bearing = (i / 72) * 2 * Math.PI;
      var lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(bearing));
      var lon2 =
        lo +
        Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
      ring.push([((((lon2 * 180) / Math.PI + 540) % 360) - 180), (lat2 * 180) / Math.PI]);
    }
    return ring;
  }

  // ---- Header, pills, list --------------------------------------------------------
  function toneColor(tone) {
    return { normal: "#2F7D57", watch: "#D3921F", elevated: "#DE5F26", critical: "#BE2618" }[tone] || "#5C6A66";
  }
  function renderHeader() {
    var data = state.data;
    var chip = $("postureChip");
    var dot = $("liveDot");
    if (!data) return;
    chip.textContent = data.posture.stage + " " + data.posture.label;
    chip.style.setProperty("--tone", toneColor(data.posture.tone));
    chip.title = data.posture.action + ". " + data.posture.detail;
    $("fresh").textContent = "Updated " + relative(data.generatedAt);
    dot.classList.toggle("stale", data.posture.sourceHealth !== "healthy");
    $("about-posture").textContent = data.posture.action + ". " + data.posture.detail;
    var m = data.map;
    $("mapFocus").textContent =
      m.focus.mode === "us_fallback"
        ? "No eligible global signal; showing the United States."
        : "Leading signal: " + m.focus.label + ".";
    $("method").textContent = m.method + " " + m.coverage;
    var healthy = data.sources.filter(function (s) {
      return s.status === "ok";
    }).length;
    $("summaryLine").textContent =
      data.summary.activeMapSignals +
      " active map signals · " +
      healthy +
      "/" +
      data.sources.length +
      " official sources healthy";
    $("sources").innerHTML = data.sources
      .map(function (s) {
        return '<li class="' + (s.status === "ok" ? "" : "bad") + '">' + esc(s.label) + " &middot; " + esc(s.status) + "</li>";
      })
      .join("");
  }

  function hazardIcon(key) {
    var paths = {
      earthquake: '<path d="M1 8h2.2l1.6-4.6L7 12.6l2-7.2 1.5 4.4L12 8h3"/>',
      weather:
        '<path d="M4.4 11a2.9 2.9 0 0 1 .3-5.8 3.9 3.9 0 0 1 7.4.9A2.6 2.6 0 0 1 12 11"/><path d="M8.6 8.4 6.9 11.6h2.2L7.4 15"/>',
      volcano:
        '<path d="M1.6 14h12.8L10.4 6H5.6L1.6 14Z"/><path d="M6.6 6 8 2.2 9.4 6"/><path d="M11.6 3.2 12.8 1.6M4.4 3.2 3.2 1.6"/>',
      tsunami:
        '<path d="M1 11.4c2.2-5.6 6-8.2 9.2-6.6 2 1 2.6 3 1.6 4.4-.8 1.1-2.3 1-2.7-.2"/><path d="M1 14.2c1.3 0 1.3-1 2.6-1s1.3 1 2.6 1 1.3-1 2.6-1 1.3 1 2.6 1 1.3-1 2.6-1"/>',
      natural:
        '<path d="M13.6 2.4C7.2 2 3 4.6 3 9.2A4.6 4.6 0 0 0 7.6 13.8c4.6 0 6.4-5 6-11.4Z"/><path d="M2.4 14.4 8 8.8"/>',
      space_weather:
        '<circle cx="8" cy="8" r="3.1"/><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3.1 3.1l1.3 1.3M11.6 11.6l1.3 1.3M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3"/>',
      all: '<path d="M8 1.6 14.6 5 8 8.4 1.4 5 8 1.6Z"/><path d="M1.4 8.4 8 11.8l6.6-3.4"/><path d="M1.4 11.6 8 15l6.6-3.4"/>'
    };
    return (
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (paths[key] || paths.all) +
      "</svg>"
    );
  }

  function renderPills() {
    var host = $("pills");
    if (!host) return;
    var counts = state.data
      ? familyCounts(
          allEvents().concat(state.data.map.nonSpatialSignals || []),
          filterNow(),
          Date.now()
        )
      : { total: 0, byFamily: {} };
    var html =
      '<button type="button" class="pill" data-hazard="all" aria-pressed="' +
      (state.hazards.length ? "false" : "true") +
      '">' +
      hazardIcon("all") +
      "<span>Everything</span><b>" +
      counts.total +
      "</b></button>";
    FAMILIES.forEach(function (family) {
      var count = counts.byFamily[family.key] || 0;
      var on = state.hazards.indexOf(family.key) !== -1;
      html +=
        '<button type="button" class="pill" data-hazard="' +
        family.key +
        '" style="--hz:' +
        COLORS[family.key] +
        '" aria-pressed="' +
        (on ? "true" : "false") +
        '" data-empty="' +
        (count === 0 ? "true" : "false") +
        '">' +
        hazardIcon(family.key) +
        "<span>" +
        esc(family.label) +
        "</span><b>" +
        count +
        "</b></button>";
    });
    host.innerHTML = html;
  }

  function signalRow(event) {
    var quake =
      event.family === "earthquake" && isFinite(event.magnitude) ? " · M" + Number(event.magnitude).toFixed(1) : "";
    return (
      '<li><button type="button" class="signal" data-event-id="' +
      esc(event.id) +
      '"><span class="sbar" style="--c:' +
      (COLORS[event.family] || "#697B73") +
      '"></span><span class="txt"><span class="name">' +
      esc(event.title) +
      '</span><span class="meta">' +
      esc(event.sourceLabel) +
      esc(quake) +
      " · " +
      esc(relative(event.eventTime)) +
      " · map " +
      esc(mapContextLabel(event)) +
      " · alert gate " +
      esc(event.staleGateResult) +
      '</span></span><span class="score" title="Signal score">' +
      esc(event.score) +
      "</span></button></li>"
    );
  }
  function renderSignals() {
    var host = $("signalList");
    var events = selected();
    $("signalCount").textContent = String(events.length);
    if (!state.data) return;
    if (!events.length) {
      host.innerHTML = '<li class="empty">No qualifying official signals in this view.</li>';
      return;
    }
    var ranked = sortSignals(events, state.sort);
    host.innerHTML =
      ranked.slice(0, SIGNAL_CAP).map(signalRow).join("") +
      (ranked.length > SIGNAL_CAP
        ? '<li class="empty">Showing the top ' +
          SIGNAL_CAP +
          " of " +
          ranked.length +
          " signals in this view. Narrow it with the hazard pills or a shorter window.</li>"
        : "");
  }
  function renderContext() {
    var host = $("contextList");
    var list = state.data ? state.data.map.nonSpatialSignals || [] : [];
    var visible = list.filter(function (event) {
      return selectEvents([event], filterNow(), Date.now()).length > 0;
    });
    $("contextCount").textContent = String(visible.length);
    host.innerHTML = visible.length
      ? sortSignals(visible, state.sort).map(signalRow).join("")
      : '<li class="empty">No non-spatial context in this view.</li>';
  }

  // ---- Detail card ------------------------------------------------------------------
  function humanDestination(event) {
    var point = pointFor(event.geometry);
    if (event.source === "nws_alerts" && point) {
      return {
        url: "https://forecast.weather.gov/MapClick.php?lat=" + point[1].toFixed(4) + "&lon=" + point[0].toFixed(4),
        label: "NWS forecast and active hazards for this area"
      };
    }
    if (event.source.indexOf("swpc_") === 0) {
      return { url: "https://www.swpc.noaa.gov/products/planetary-k-index", label: "NOAA SWPC space-weather dashboard" };
    }
    if (event.source.indexOf("tsunami_") === 0) {
      return { url: "https://www.tsunami.gov/", label: "NOAA Tsunami Warning Center" };
    }
    var agency = ((event.detail && event.detail.sourceLinks) || [])[0];
    if (agency && agency.url) return { url: agency.url, label: agency.id + " page for this event" };
    return null;
  }
  function row(label, value) {
    return value == null || value === "" ? "" : "<dt>" + esc(label) + "</dt><dd>" + value + "</dd>";
  }
  function cityPhrase(city) {
    return (
      esc(city.name) +
      ", " +
      esc(city.country) +
      " &mdash; pop. " +
      esc(formatNumber(city.population)) +
      ", " +
      esc(formatNumber(city.distanceKm)) +
      " km " +
      esc(city.bearing)
    );
  }
  function eventCard(event) {
    var rows = "";
    rows += row("Official source", esc(event.sourceLabel));
    rows += row("Event time", esc(fmt(event.eventTime)));
    rows += row("Source updated", esc(fmt(event.sourceUpdatedAt)));
    rows += row("Ingest time", esc(fmt(event.ingestTime)));
    rows += row("Region", esc(event.region || "source-defined / outside configured targets"));
    rows += row("Cascade stage", esc(event.cascadeStage || "context only"));
    rows += row("Notification stale gate", esc(event.staleGateResult));
    if (event.staleGateReasons && event.staleGateReasons.length)
      rows += row("Notification blocked by", esc(event.staleGateReasons.join(", ")));
    rows += row("Map context", esc(mapContextLabel(event)));
    if (event.family === "earthquake") {
      if (isFinite(event.magnitude)) rows += row("Magnitude", "M" + esc(Number(event.magnitude).toFixed(1)));
      if (isFinite(event.depthKm)) {
        var depth = Number(event.depthKm);
        var band = depth < 70 ? "shallow" : depth < 300 ? "intermediate" : "deep";
        rows += row("Depth", esc(depth < 10 ? depth.toFixed(1) : String(Math.round(depth))) + " km (" + band + ")");
      }
      if (event.population && event.population.nearest)
        rows += row("Nearest town", cityPhrase(event.population.nearest));
      if (event.population && event.population.major)
        rows += row("Nearest major population", cityPhrase(event.population.major));
      var shaking = event.shaking;
      if (shaking && shaking.feltReports !== undefined)
        rows += row("Felt reports", esc(shaking.feltReports) + " submitted to USGS Did You Feel It?");
      else rows += row("Felt reports", "none received by USGS");
      if (shaking && shaking.pagerAlert) rows += row("USGS PAGER alert", esc(shaking.pagerAlert));
    }
    var detail = event.detail;
    var prose = "";
    if (detail) {
      rows += row("Issued by", detail.issuedBy && esc(detail.issuedBy));
      rows += row("In effect until", detail.expiresAt && esc(fmt(detail.expiresAt)));
      if (detail.headline) prose += "<p><strong>" + esc(detail.headline) + "</strong></p>";
      if (detail.summary) prose += "<p>" + esc(String(detail.summary).slice(0, 1200)) + "</p>";
      if (detail.instruction) prose += "<p><strong>What to do:</strong> " + esc(String(detail.instruction).slice(0, 600)) + "</p>";
    }
    var human = humanDestination(event);
    var raw = safeUrl(event.officialUrl);
    var links = "";
    if (human) {
      links += '<a href="' + esc(safeUrl(human.url)) + '" target="_blank" rel="noopener">' + esc(human.label) + "</a>";
      if (raw !== "#")
        links += '<a class="quiet" href="' + esc(raw) + '" target="_blank" rel="noopener">Raw ' + esc(event.sourceLabel) + " record (JSON)</a>";
    } else if (raw !== "#") {
      links += '<a href="' + esc(raw) + '" target="_blank" rel="noopener">Open official record</a>';
    }
    return {
      title: event.title,
      color: COLORS[event.family] || "#697B73",
      html: "<dl>" + rows + "</dl>" + (prose ? '<div class="prose">' + prose + "</div>" : "") + (links ? '<p class="links">' + links + "</p>" : "")
    };
  }
  function showCard(card, id) {
    var el = $("detail");
    $("detailTitle").textContent = card.title;
    el.style.setProperty("--c", card.color);
    $("detailBody").innerHTML = card.html;
    el.hidden = false;
    state.selectedId = id || null;
  }
  var lastTrigger = null;
  function closeCard() {
    $("detail").hidden = true;
    state.selectedId = null;
    syncSelection();
    // Give focus back to whatever opened the card, so keyboard readers keep their place.
    if (lastTrigger && doc.contains(lastTrigger) && lastTrigger.focus) lastTrigger.focus();
    lastTrigger = null;
  }
  function selectEventById(id, options) {
    var event = findEvent(id);
    if (!event) return;
    var active = doc.activeElement;
    if (active && active !== doc.body && active.id !== "detailTitle") lastTrigger = active;
    showCard(eventCard(event), id);
    syncSelection();
    var point = pointFor(event.geometry);
    if (state.map && point && !(options && options.noFly)) {
      state.userMoved = true;
      flyTo(point, Math.max(state.map.getZoom(), 3.2));
    }
    if (!(options && options.noFocus)) $("detailTitle").focus();
  }
  function flyTo(point, zoom) {
    if (!state.map) return;
    if (reducedMotion) state.map.jumpTo({ center: point, zoom: zoom });
    else state.map.flyTo({ center: point, zoom: zoom, duration: 1400, essential: false });
  }

  // ---- Map --------------------------------------------------------------------------
  function emptyFC() {
    return { type: "FeatureCollection", features: [] };
  }
  function eventFeatures(events) {
    var points = [];
    var shapes = [];
    events.forEach(function (event) {
      if (!event.geometry) return;
      var color = COLORS[event.family] || "#697B73";
      var eligible = event.mapContext && event.mapContext.eligible;
      var props = { id: event.id, color: color, op: eligible ? 0.78 : 0.28 };
      if (event.geometry.type === "Point") {
        props.r =
          event.family === "earthquake"
            ? Math.max(5, Math.min(18, 5 + (event.magnitude || 0) * 1.5))
            : Math.max(6, Math.min(15, event.score / 8));
        points.push({ type: "Feature", properties: props, geometry: event.geometry });
      } else {
        shapes.push({ type: "Feature", properties: props, geometry: event.geometry });
      }
    });
    return { points: { type: "FeatureCollection", features: points }, shapes: { type: "FeatureCollection", features: shapes } };
  }
  function regionFeatures() {
    var out = [];
    if (!state.data) return emptyFC();
    state.data.map.regions.forEach(function (region) {
      var stage = Number(String(region.effectiveStage).slice(1)) || 0;
      var color = stage >= 4 ? "#BE2618" : stage >= 3 ? "#DE5F26" : stage >= 1 ? "#347FAC" : "#2F7D57";
      var ring = null;
      if (region.center && region.radiusKm) ring = circleRing(region.center[0], region.center[1], region.radiusKm);
      else if (region.bbox) {
        var b = region.bbox;
        ring = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]];
      }
      if (ring) out.push({ type: "Feature", properties: { color: color, label: region.label }, geometry: { type: "Polygon", coordinates: [ring] } });
    });
    return { type: "FeatureCollection", features: out };
  }
  // Dark bands where the sun is below each twilight floor, as the flat map drew them.
  function terminatorFeatures() {
    var sun = subsolarPoint(new Date());
    var rad = Math.PI / 180;
    var features = [];
    [0, -6, -12, -18].forEach(function (floor) {
      var edge = [];
      for (var lon = -180; lon <= 180; lon += 2) {
        var a = Math.sin(sun.lat * rad);
        var b = Math.cos(sun.lat * rad) * Math.cos((lon - sun.lon) * rad);
        var c = Math.sin(floor * rad);
        var mag = Math.hypot(a, b);
        if (mag < 1e-12) continue;
        var ratio = c / mag;
        if (ratio < -1 || ratio > 1) continue;
        var lat = (Math.asin(ratio) - Math.atan2(b, a)) / rad;
        edge.push([lon, Math.max(-85, Math.min(85, lat))]);
      }
      if (edge.length < 3) {
        var dark =
          solarElevationDeg(0, sun.lon, sun) < floor &&
          solarElevationDeg(90, sun.lon, sun) < floor &&
          solarElevationDeg(-90, sun.lon, sun) < floor;
        if (dark) features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, 85], [180, 85], [180, -85], [-180, -85], [-180, 85]]] } });
        return;
      }
      var pole = sun.lat >= 0 ? -85 : 85;
      var ring = edge.slice();
      ring.push([180, pole]);
      ring.push([-180, pole]);
      ring.push(edge[0]);
      features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } });
    });
    return { type: "FeatureCollection", features: features };
  }
  function setData(id, data) {
    var source = state.map && state.map.getSource(id);
    if (source) source.setData(data);
  }
  function syncEvents() {
    if (state.mapState !== "ready") return;
    var built = eventFeatures(selected());
    setData("ev-points", built.points);
    setData("ev-shapes", built.shapes);
    syncSelection();
  }
  function syncSelection() {
    if (state.mapState !== "ready") return;
    var id = state.selectedId || "";
    ["ev-sel-pt", "ev-sel-shape"].forEach(function (layer) {
      if (state.map.getLayer(layer)) state.map.setFilter(layer, ["==", ["get", "id"], id]);
    });
  }
  function syncRegions() {
    if (state.mapState !== "ready") return;
    setData("regions", regionFeatures());
    setVisible(["regions-line", "regions-fill"], state.layers.regions);
  }
  function syncTerminator() {
    if (state.mapState !== "ready") return;
    setData("terminator", terminatorFeatures());
    setVisible(["terminator-fill"], state.layers.dayNight);
  }
  function setVisible(ids, on) {
    ids.forEach(function (id) {
      if (state.map && state.map.getLayer(id)) state.map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    });
  }

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      var script = doc.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      if (integrity) script.integrity = integrity;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("The map library did not load."));
      };
      doc.head.appendChild(script);
    });
  }
  function loadStyle(href, integrity) {
    var link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.crossOrigin = "anonymous";
    if (integrity) link.integrity = integrity;
    doc.head.appendChild(link);
  }
  function webglOk() {
    try {
      var canvas = doc.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch (error) {
      return false;
    }
  }
  // Data-saver and weak devices get the list, not 300 KB of map engine and imagery.
  function lowPowerReason() {
    var nav = window.navigator || {};
    var conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn && conn.saveData) return "Data Saver is on";
    if (conn && /(^|-)2g$/.test(String(conn.effectiveType || ""))) return "the connection is slow";
    try {
      if (window.matchMedia("(prefers-reduced-data: reduce)").matches) return "reduced data is requested";
    } catch (error) {}
    if (nav.deviceMemory && nav.deviceMemory <= 1) return "this device has very little memory";
    if (!webglOk()) return "WebGL is not available";
    return null;
  }
  function showPaused(reason) {
    state.mapState = "paused";
    var box = $("lowPower");
    $("lowPowerReason").textContent = reason;
    box.hidden = false;
    doc.documentElement.setAttribute("data-globe", "paused");
  }

  function startMap(force) {
    if (state.mapState === "loading" || state.mapState === "ready") return;
    var reason = force ? (webglOk() ? null : "WebGL is not available") : lowPowerReason();
    if (reason) {
      showPaused(reason);
      return;
    }
    $("lowPower").hidden = true;
    state.mapState = "loading";
    doc.documentElement.setAttribute("data-globe", "loading");
    setStatus("Loading the globe...");
    loadStyle(CONFIG.mapCss, CONFIG.mapCssIntegrity);
    loadScript(CONFIG.mapJs, CONFIG.mapJsIntegrity)
      .then(buildMap)
      .catch(function (error) {
        state.mapState = "failed";
        doc.documentElement.setAttribute("data-globe", "failed");
        $("lowPower").hidden = false;
        $("lowPowerReason").textContent = String((error && error.message) || error);
      });
  }

  // The zoom at which the whole globe fits the stage (with room for the filter row).
  function fitZoom() {
    var el = $("globe");
    var side = Math.max(240, Math.min(el.clientWidth, el.clientHeight - 150));
    return Math.max(0.6, Math.log((0.92 * side * Math.PI) / 512) / Math.LN2);
  }
  // Leaflet zoom 6 (a region) is about globe zoom 3.4; never zoom out past the whole globe.
  function focusZoom(focus) {
    var fit = fitZoom();
    return focus && isFinite(focus.zoom) ? Math.max(fit, Math.min(4.5, focus.zoom - 2.6)) : fit;
  }

  function buildMap() {
    var ml = window.maplibregl;
    var focus = state.data && state.data.map.focus;
    var center = focus && focus.center ? [focus.center[1], focus.center[0]] : [-98, 39];
    var zoom = focusZoom(focus);
    var map = new ml.Map({
      container: "globe",
      style: {
        version: 8,
        projection: { type: "globe" },
        sources: {
          bluemarble: {
            type: "raster",
            tiles: [GIBS + "BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"],
            tileSize: 256,
            maxzoom: 8,
            attribution: "Imagery: NASA GIBS Blue Marble (public domain)"
          }
        },
        layers: [{ id: "bluemarble", type: "raster", source: "bluemarble", paint: { "raster-fade-duration": 200 } }]
      },
      center: center,
      zoom: zoom,
      minZoom: 0.5,
      maxZoom: 9,
      maxPitch: 55,
      attributionControl: false,
      fadeDuration: 100,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
    });
    state.map = map;
    map.addControl(
      new ml.AttributionControl({
        compact: true,
        customAttribution: CONFIG.attribution || []
      })
    );
    map.addControl(new ml.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
    map.on("error", function (event) {
      var message = event && event.error && event.error.message;
      if (message && /tile|fetch|Failed/i.test(message)) setStatus("Some imagery tiles did not load.");
    });
    map.on("load", function () {
      try {
        // Leave room for the filter row so the globe is not cropped behind it.
        map.setPadding({ top: 44, bottom: 96, left: 0, right: 0 });
        var attrib = doc.querySelector(".maplibregl-ctrl-attrib");
        if (attrib) {
          attrib.classList.remove("maplibregl-compact-show");
          attrib.removeAttribute("open");
        }
      } catch (error) {}
      try {
        map.setSky({
          "sky-color": "#DCE6EE",
          "horizon-color": "#F1F3EF",
          "fog-color": "#F1F3EF",
          "sky-horizon-blend": 0.6,
          "horizon-fog-blend": 0.6,
          "fog-ground-blend": 0.2,
          "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 5, 0.9, 7, 0]
        });
      } catch (error) {}
      map.addSource("terminator", { type: "geojson", data: emptyFC() });
      map.addLayer({ id: "terminator-fill", type: "fill", source: "terminator", paint: { "fill-color": "#0B1B2B", "fill-opacity": 0.06 } });
      map.addSource("regions", { type: "geojson", data: emptyFC() });
      map.addLayer({ id: "regions-fill", type: "fill", source: "regions", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.08 } });
      map.addLayer({ id: "regions-line", type: "line", source: "regions", paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-dasharray": [3, 2] } });
      map.addSource("ev-shapes", { type: "geojson", data: emptyFC() });
      map.addLayer({ id: "ev-fill", type: "fill", source: "ev-shapes", paint: { "fill-color": ["get", "color"], "fill-opacity": ["*", ["get", "op"], 0.28] } });
      map.addLayer({ id: "ev-line", type: "line", source: "ev-shapes", paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-opacity": ["get", "op"] } });
      map.addLayer({ id: "ev-sel-shape", type: "line", source: "ev-shapes", filter: ["==", ["get", "id"], ""], paint: { "line-color": "#1E2A2C", "line-width": 3.5 } });
      map.addSource("ev-points", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "ev-points",
        type: "circle",
        source: "ev-points",
        paint: {
          "circle-radius": ["get", "r"],
          "circle-color": ["get", "color"],
          "circle-opacity": ["get", "op"],
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-opacity": 0.9
        }
      });
      map.addLayer({
        id: "ev-sel-pt",
        type: "circle",
        source: "ev-points",
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": ["+", ["get", "r"], 5], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#1E2A2C", "circle-stroke-width": 2.5 }
      });
      state.mapState = "ready";
      doc.documentElement.setAttribute("data-globe", "ready");
      setStatus("");
      syncEvents();
      syncRegions();
      syncTerminator();
      applyOptionalLayers();
      applyFocus();
    });
    ["ev-points", "ev-fill", "ev-line"].forEach(function (layerId) {
      map.on("click", layerId, function (event) {
        var feature = event.features && event.features[0];
        if (feature) {
          selectEventById(feature.properties.id, { noFocus: false });
        }
      });
      map.on("mouseenter", layerId, function () {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, function () {
        map.getCanvas().style.cursor = "";
      });
    });
    ["movestart", "zoomstart"].forEach(function (name) {
      map.on(name, function (event) {
        if (event.originalEvent) state.userMoved = true;
      });
    });
    startSpin();
  }
  function applyFocus(force) {
    if (!state.map || state.mapState !== "ready" || !state.data) return;
    if (!force && (state.focusApplied || state.userMoved)) return;
    var focus = state.data.map.focus;
    state.focusApplied = true;
    var zoom = focusZoom(focus);
    state.map.jumpTo({ center: [focus.center[1], focus.center[0]], zoom: zoom });
  }

  // Slow idle rotation that yields the moment a person touches the globe.
  var spinTimer = null;
  function startSpin() {
    if (spinTimer || reducedMotion) return;
    spinTimer = setInterval(function () {
      var map = state.map;
      if (!map || state.mapState !== "ready" || !state.layers.spin || state.userMoved || doc.hidden) return;
      if (map.getZoom() > 3) return;
      var c = map.getCenter();
      map.setCenter([c.lng + 0.18, c.lat]);
    }, 50);
  }

  // ---- Optional public layers ------------------------------------------------------
  function setLayerStatus(id, text, tone) {
    var el = $(id);
    if (!el) return;
    el.textContent = text;
    el.setAttribute("data-tone", tone || "");
  }
  function fetchJson(url, label) {
    return fetch(url, { headers: { accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" }).then(function (response) {
      if (!response.ok) throw new Error(label + " returned HTTP " + response.status);
      return response.json();
    });
  }
  function applyOptionalLayers() {
    syncAurora();
    syncSpc();
    syncPorts();
  }
  function syncAurora() {
    if (state.mapState !== "ready") return;
    var map = state.map;
    if (!state.layers.aurora) {
      setVisible(["aurora"], false);
      return;
    }
    function draw() {
      var fc = { type: "FeatureCollection", features: state.aurora.cells };
      if (!map.getSource("aurora")) {
        map.addSource("aurora", { type: "geojson", data: fc });
        map.addLayer(
          {
            id: "aurora",
            type: "heatmap",
            source: "aurora",
            paint: {
              "heatmap-weight": ["interpolate", ["linear"], ["get", "p"], 0, 0, 30, 0.6, 100, 1],
              "heatmap-intensity": 1.2,
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 9, 3, 22, 6, 46],
              "heatmap-opacity": 0.85,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0, "rgba(61,255,176,0)",
                0.25, "rgba(61,255,176,0.35)",
                0.6, "rgba(120,255,120,0.7)",
                1, "rgba(230,255,90,0.9)"
              ]
            }
          },
          "ev-fill"
        );
      } else map.getSource("aurora").setData(fc);
      setVisible(["aurora"], true);
      var kp = latestKp();
      setLayerStatus(
        "auroraStatus",
        "NOAA SWPC OVATION model, forecast " + (state.aurora.forecast || "").replace("T", " ").slice(0, 16) + " UTC" + (kp ? " · latest Kp " + kp : ""),
        "ok"
      );
    }
    if (state.aurora) return draw();
    setLayerStatus("auroraStatus", "Loading the aurora forecast...", "");
    fetchJson(URLS.ovation, "NOAA SWPC")
      .then(function (payload) {
        var rows = payload && payload.coordinates;
        if (!Array.isArray(rows)) throw new Error("NOAA SWPC sent an unexpected aurora document");
        var cells = [];
        rows.forEach(function (r) {
          if (r[2] >= 5) {
            cells.push({ type: "Feature", properties: { p: r[2] }, geometry: { type: "Point", coordinates: [r[0] > 180 ? r[0] - 360 : r[0], r[1]] } });
          }
        });
        state.aurora = { cells: cells, forecast: payload["Forecast Time"] || "" };
        if (state.layers.aurora) draw();
      })
      .catch(function (error) {
        setLayerStatus("auroraStatus", "Aurora forecast unavailable: " + error.message + ". This is not an all-clear.", "error");
      });
  }
  function latestKp() {
    var list = state.data ? state.data.map.nonSpatialSignals || [] : [];
    var best = null;
    list.forEach(function (event) {
      if (event.source.indexOf("swpc_kp") === 0 && (!best || Date.parse(event.eventTime) > Date.parse(best.eventTime))) best = event;
    });
    return best && best.severity ? String(best.severity).replace(/^Kp/, "") : "";
  }
  function syncSpc() {
    if (state.mapState !== "ready") return;
    var map = state.map;
    if (!state.layers.spc) {
      setVisible(["spc-fill", "spc-line"], false);
      return;
    }
    var day = state.spcDay;
    function draw(fc) {
      if (!map.getSource("spc")) {
        map.addSource("spc", { type: "geojson", data: fc });
        var color = [
          "match", ["get", "LABEL"],
          "TSTM", SPC_COLORS.TSTM, "MRGL", SPC_COLORS.MRGL, "SLGT", SPC_COLORS.SLGT,
          "ENH", SPC_COLORS.ENH, "MDT", SPC_COLORS.MDT, "HIGH", SPC_COLORS.HIGH, "#9AA7B4"
        ];
        map.addLayer({ id: "spc-fill", type: "fill", source: "spc", paint: { "fill-color": color, "fill-opacity": 0.32 } }, "ev-fill");
        map.addLayer({ id: "spc-line", type: "line", source: "spc", paint: { "line-color": color, "line-width": 1.6 } }, "ev-fill");
      } else map.getSource("spc").setData(fc);
      setVisible(["spc-fill", "spc-line"], true);
      var labels = {};
      fc.features.forEach(function (f) {
        labels[f.properties.LABEL2 || f.properties.LABEL] = true;
      });
      var names = Object.keys(labels);
      setLayerStatus(
        "spcStatus",
        names.length
          ? "Day " + day + " categories: " + names.join(", ") + ". NOAA SPC outlook, not a warning."
          : "SPC forecasts no categorical thunderstorm areas for day " + day + ".",
        names.length ? "ok" : ""
      );
    }
    if (state.spcData[day]) return draw(state.spcData[day]);
    setLayerStatus("spcStatus", "Loading the SPC outlook...", "");
    fetchJson(URLS.spc(day), "NOAA SPC")
      .then(function (payload) {
        if (!payload || payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) throw new Error("NOAA SPC sent an unexpected outlook document");
        state.spcData[day] = payload;
        if (state.layers.spc && state.spcDay === day) draw(payload);
      })
      .catch(function (error) {
        setLayerStatus("spcStatus", "SPC outlook unavailable: " + error.message + ". This is not an all-clear.", "error");
      });
  }
  function syncPorts() {
    if (state.mapState !== "ready") return;
    var map = state.map;
    if (!state.layers.chokepoints) {
      setVisible(["ports"], false);
      return;
    }
    function draw() {
      var fc = { type: "FeatureCollection", features: state.ports };
      if (!map.getSource("ports")) {
        map.addSource("ports", { type: "geojson", data: fc });
        map.addLayer({
          id: "ports",
          type: "circle",
          source: "ports",
          paint: {
            "circle-radius": ["get", "r"],
            "circle-color": "#347FAC",
            "circle-opacity": 0.5,
            "circle-stroke-color": "#1E2A2C",
            "circle-stroke-width": 1.5
          }
        });
        map.on("click", "ports", function (event) {
          var feature = event.features && event.features[0];
          if (feature) showPort(feature.properties);
        });
        map.on("mouseenter", "ports", function () { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "ports", function () { map.getCanvas().style.cursor = ""; });
      } else map.getSource("ports").setData(fc);
      setVisible(["ports"], true);
      setLayerStatus("portsStatus", state.ports.length + " chokepoints, sized by latest daily transits. IMF PortWatch estimates lag by several days.", "ok");
    }
    if (state.ports) return draw();
    setLayerStatus("portsStatus", "Loading IMF PortWatch...", "");
    var since = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    var q1 = URLS.portPoints + "?" + new URLSearchParams({ where: "1=1", outFields: "portid,portname,lat,lon", returnGeometry: "false", resultRecordCount: "60", f: "json" });
    var q2 =
      URLS.portDaily +
      "?" +
      new URLSearchParams({
        where: "portid LIKE 'chokepoint%' AND date >= '" + since + "'",
        outFields: "date,portid,n_total,n_tanker,n_container",
        returnGeometry: "false",
        resultRecordCount: "1000",
        orderByFields: "date DESC",
        f: "json"
      });
    Promise.all([fetchJson(q1, "IMF PortWatch"), fetchJson(q2, "IMF PortWatch").catch(function () { return null; })])
      .then(function (results) {
        var points = results[0] && results[0].features;
        if (!Array.isArray(points) || !points.length) throw new Error("IMF PortWatch sent no chokepoints");
        var byId = {};
        ((results[1] && results[1].features) || []).forEach(function (f) {
          var a = f.attributes || {};
          (byId[a.portid] = byId[a.portid] || []).push(a);
        });
        state.ports = points
          .filter(function (f) {
            return f.attributes && isFinite(f.attributes.lat) && isFinite(f.attributes.lon);
          })
          .map(function (f) {
            var a = f.attributes;
            var days = (byId[a.portid] || []).sort(function (x, y) {
              return x.date < y.date ? 1 : -1;
            });
            var latest = days[0] || null;
            var avg = days.length
              ? Math.round(
                  days.reduce(function (s, d) {
                    return s + (d.n_total || 0);
                  }, 0) / days.length
                )
              : null;
            var n = latest && isFinite(latest.n_total) ? latest.n_total : 0;
            return {
              type: "Feature",
              properties: {
                id: a.portid,
                name: a.portname,
                date: latest ? latest.date : "",
                total: latest ? latest.n_total : null,
                tankers: latest ? latest.n_tanker : null,
                containers: latest ? latest.n_container : null,
                avg: avg,
                days: days.length,
                r: Math.round(6 + Math.min(14, Math.sqrt(n) * 1))
              },
              geometry: { type: "Point", coordinates: [a.lon, a.lat] }
            };
          });
        if (state.layers.chokepoints) draw();
      })
      .catch(function (error) {
        setLayerStatus("portsStatus", "Chokepoint data unavailable: " + error.message + ".", "error");
      });
  }
  function showPort(p) {
    function n(v) {
      return v == null || v === "null" ? "not reported" : esc(formatNumber(v));
    }
    var html =
      "<dl>" +
      row("Latest day", esc(p.date || "not reported")) +
      row("Vessel transits that day", n(p.total)) +
      row("Tankers", n(p.tankers)) +
      row("Container ships", n(p.containers)) +
      row("Average over recent days", p.avg == null || p.avg === "null" ? "not reported" : n(p.avg) + " (" + esc(p.days) + " days)") +
      "</dl>" +
      '<p class="prose">Estimated from ship position broadcasts (AIS); the count is not a customs record and lags by several days.</p>' +
      '<p class="links"><a href="https://portwatch.imf.org/" target="_blank" rel="noopener">IMF PortWatch</a></p>';
    showCard({ title: p.name + " (shipping chokepoint)", color: "#347FAC", html: html }, null);
  }

  // ---- Events -> everything ----------------------------------------------------------
  function renderAll() {
    renderHeader();
    renderPills();
    renderSignals();
    renderContext();
    syncEvents();
    syncRegions();
    syncTerminator();
    applyFocus();
    var selectedEvent = state.selectedId && findEvent(state.selectedId);
    if (selectedEvent) showCard(eventCard(selectedEvent), state.selectedId);
  }
  function setStatus(text) {
    var el = $("status");
    if (el) el.textContent = text;
  }
  function load() {
    return fetch(URLS.earth, { headers: { accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("Earth data returned HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "Earth data unavailable");
        state.data = data;
        $("error").hidden = true;
        renderAll();
        if (state.mapState === "idle") startMap(false);
      })
      .catch(function (error) {
        $("liveDot").classList.add("stale");
        $("postureChip").textContent = "Unknown";
        $("fresh").textContent = "Official data unavailable";
        $("error").textContent = "Do not interpret this as a clear reading. " + String((error && error.message) || error);
        $("error").hidden = false;
      });
  }

  // ---- Controls ----------------------------------------------------------------------
  function pressedGroup(host, attr, value) {
    Array.prototype.forEach.call(host.querySelectorAll("[" + attr + "]"), function (button) {
      button.setAttribute("aria-pressed", button.getAttribute(attr) === value ? "true" : "false");
    });
  }
  $("windows").innerHTML = WINDOWS.map(function (w) {
    return '<button type="button" data-window="' + w.key + '" aria-pressed="' + (w.key === state.window ? "true" : "false") + '">' + w.label + "</button>";
  }).join("");
  $("windows").addEventListener("click", function (event) {
    var button = event.target.closest("[data-window]");
    if (!button) return;
    state.window = button.getAttribute("data-window");
    pressedGroup($("windows"), "data-window", state.window);
    renderAll();
  });
  $("pills").addEventListener("click", function (event) {
    var button = event.target.closest("[data-hazard]");
    if (!button) return;
    var key = button.getAttribute("data-hazard");
    if (key === "all") state.hazards = [];
    else {
      var at = state.hazards.indexOf(key);
      if (at === -1) state.hazards.push(key);
      else state.hazards.splice(at, 1);
    }
    renderAll();
  });
  $("sourceFilter").addEventListener("change", function (event) {
    state.source = event.target.value;
    renderAll();
  });
  $("signalSort").value = state.sort;
  $("signalSort").addEventListener("change", function (event) {
    state.sort = event.target.value;
    store("earthWatch.signalSort", state.sort);
    renderSignals();
    renderContext();
  });
  function onSignalClick(event) {
    var button = event.target.closest("[data-event-id]");
    if (button) selectEventById(button.getAttribute("data-event-id"));
  }
  $("signalList").addEventListener("click", onSignalClick);
  $("contextList").addEventListener("click", onSignalClick);
  $("detailClose").addEventListener("click", closeCard);
  doc.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !$("detail").hidden) closeCard();
  });
  $("recentre").addEventListener("click", function () {
    state.userMoved = false;
    applyFocus(true);
  });

  function bindToggle(id, key, after) {
    var box = $(id);
    box.checked = Boolean(state.layers[key]);
    box.addEventListener("change", function () {
      state.layers[key] = box.checked;
      after();
    });
  }
  bindToggle("tDayNight", "dayNight", syncTerminator);
  bindToggle("tRegions", "regions", syncRegions);
  bindToggle("tAurora", "aurora", syncAurora);
  bindToggle("tSpc", "spc", syncSpc);
  bindToggle("tPorts", "chokepoints", syncPorts);
  bindToggle("tSpin", "spin", function () {});
  if (reducedMotion) $("tSpin").disabled = true;
  $("spcDay").addEventListener("change", function (event) {
    state.spcDay = Number(event.target.value) || 1;
    syncSpc();
  });

  function toggleRegion(buttonId, panelId, other) {
    $(buttonId).addEventListener("click", function () {
      var panel = $(panelId);
      var open = panel.hidden;
      if (other) {
        $(other.panel).hidden = true;
        $(other.button).setAttribute("aria-expanded", "false");
      }
      panel.hidden = !open;
      $(buttonId).setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
  toggleRegion("layersToggle", "layersPanel", null);
  $("listToggle").addEventListener("click", function () {
    var root = doc.documentElement;
    var hidden = root.getAttribute("data-list") === "hidden";
    root.setAttribute("data-list", hidden ? "shown" : "hidden");
    $("listToggle").setAttribute("aria-expanded", hidden ? "true" : "false");
    if (state.map) setTimeout(function () { state.map.resize(); }, 60);
  });
  $("loadGlobe").addEventListener("click", function () {
    state.mapState = "idle";
    startMap(true);
  });

  // ---- Night watch (ambient edge glow), unchanged from the retired page ---------------
  var AMBIENT_IDLE_MS = 3 * 60 * 1000;
  var ambientIdleTimer = null;
  var ambientEnabled = store("earthNightWatch") !== "off";
  function ambientFamilyLabel(family) {
    if (!family) return "all quiet";
    for (var i = 0; i < FAMILIES.length; i += 1) if (FAMILIES[i].key === family) return FAMILIES[i].label;
    return String(family).replace(/_/g, " ");
  }
  function ambientAgo(hours) {
    if (!isFinite(hours) || hours < 0) return "";
    if (hours < 1) return Math.max(1, Math.round(hours * 60)) + "m ago";
    if (hours < 48) return Math.round(hours) + "h ago";
    return Math.round(hours / 24) + "d ago";
  }
  function applyAmbient() {
    var events = state.data ? allEvents().concat(state.data.map.nonSpatialSignals || []) : [];
    var ids = state.data && state.data.map.focus && state.data.map.focus.eventIds;
    var glow = ambientGlow(events, new Date(), Array.isArray(ids) && ids.length ? ids[0] : null);
    var root = doc.documentElement;
    root.style.setProperty("--ambient-color", glow.color);
    root.style.setProperty("--ambient-alpha", String(glow.alpha));
    root.style.setProperty("--ambient-reach", (4 + 18 * glow.intensity).toFixed(2) + "vmin");
    var el = $("ambientGlow");
    if (el) el.classList.toggle("ambient-pulse", Boolean(glow.pulse));
    var out = $("ambientReadout");
    if (out) {
      var parts = [ambientFamilyLabel(glow.family)];
      var ago = ambientAgo(glow.ageHours);
      if (glow.family && ago) parts.push(ago);
      out.textContent = parts.join("  ·  ");
    }
  }
  function ambientArm() {
    if (ambientIdleTimer) clearTimeout(ambientIdleTimer);
    doc.documentElement.removeAttribute("data-ambient");
    if (!ambientEnabled) return;
    ambientIdleTimer = setTimeout(function () {
      doc.documentElement.setAttribute("data-ambient", "on");
      applyAmbient();
    }, AMBIENT_IDLE_MS);
  }
  ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"].forEach(function (name) {
    window.addEventListener(name, ambientArm, { passive: true });
  });
  var ambientBtn = $("ambientToggle");
  ambientBtn.setAttribute("aria-pressed", ambientEnabled ? "true" : "false");
  ambientBtn.addEventListener("click", function (event) {
    event.stopPropagation();
    ambientEnabled = !ambientEnabled;
    store("earthNightWatch", ambientEnabled ? "on" : "off");
    ambientBtn.setAttribute("aria-pressed", ambientEnabled ? "true" : "false");
    ambientArm();
  });
  applyAmbient();
  setInterval(applyAmbient, 20 * 1000);
  ambientArm();

  // ---- Go --------------------------------------------------------------------------
  doc.documentElement.classList.add("js");
  load();
  setInterval(load, 5 * 60 * 1000);
  setInterval(function () {
    syncTerminator();
    if (state.data) $("fresh").textContent = "Updated " + relative(state.data.generatedAt);
  }, 60 * 1000);
}

/** The function above as browser source. */
export function globeClientSource(): string {
  // esbuild's keepNames (tsx, vitest configurations) wraps nested function
  // declarations in __name(...) calls that do not exist in the browser. tsc never
  // emits them, so the production build is unaffected; the shim keeps the page
  // runnable when it is served from a dev runner.
  return (
    "var __name = function (target) { return target; };\n(" +
    globeClient.toString() +
    ")();"
  );
}
