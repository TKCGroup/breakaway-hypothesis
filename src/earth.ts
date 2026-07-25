import {
  OFFICIAL_SOURCES,
  type RegionRule,
  type WatcherConfig
} from "./config.js";
import {
  buildDashboardDataFromSnapshot,
  type DashboardData,
  type DashboardSnapshot
} from "./dashboard.js";
import { evaluateStaleGate } from "./logic/staleGate.js";
import type {
  CascadeStage,
  NormalizedEvent,
  OfficialSource
} from "./types.js";

type EarthEventStatus = "current" | "recent" | "forecast";
type HazardFamily =
  | "earthquake"
  | "weather"
  | "natural"
  | "volcano"
  | "tsunami"
  | "space_weather";

interface EarthGeometry {
  type: "Point" | "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

export interface EarthMapEvent {
  id: string;
  source: string;
  sourceLabel: string;
  externalId: string;
  eventType: string;
  family: HazardFamily;
  title: string;
  eventTime: string;
  sourceUpdatedAt: string;
  ingestTime: string;
  region?: string;
  magnitude?: number;
  depthKm?: number;
  severity?: string;
  officialUrl: string;
  geometry?: EarthGeometry;
  score: number;
  status: EarthEventStatus;
  cascadeStage?: CascadeStage;
  staleGatePassed: boolean;
  staleGateResult: "passed" | "blocked";
  staleGateReasons: string[];
}

export interface EarthMapRegion {
  id: string;
  label: string;
  stage: CascadeStage;
  effectiveStage: CascadeStage;
  stageLabel: string;
  summary: string;
  staleGatePassed: boolean;
  confidence: number;
  center?: [number, number];
  radiusKm?: number;
  bbox?: [number, number, number, number];
}

export interface EarthWatchData {
  ok: true;
  generatedAt: string;
  system: DashboardData["system"];
  posture: DashboardData["posture"];
  notableEvent: DashboardData["notableEvent"];
  latestCycle: DashboardData["latestCycle"];
  summary: DashboardData["summary"] & {
    currentFreshSignals: number;
    mappedSignals: number;
    nonSpatialSignals: number;
  };
  sources: DashboardData["sources"];
  map: {
    coverage: string;
    method: string;
    events: EarthMapEvent[];
    nonSpatialSignals: EarthMapEvent[];
    regions: EarthMapRegion[];
  };
}

export function buildEarthWatchData(
  snapshot: DashboardSnapshot,
  config: WatcherConfig,
  now = new Date()
): EarthWatchData {
  const dashboard = buildDashboardDataFromSnapshot(snapshot, config, now);
  const latestStateByEvent = new Map<string, DashboardSnapshot["cascadeStates"][number]>();
  for (const state of snapshot.cascadeStates) {
    const existing = latestStateByEvent.get(state.latestEventId);
    if (!existing || state.stageStartedAt > existing.stageStartedAt) {
      latestStateByEvent.set(state.latestEventId, state);
    }
  }

  const earliest = new Date(now.getTime() - 30 * 86_400_000);
  const latest = new Date(now.getTime() + 30 * 86_400_000);
  const candidates = dedupeLiveEvents(snapshot.events)
    .filter(
      (event) =>
        event.source !== "usgs_fdsn_backfill" &&
        OFFICIAL_SOURCES.has(event.source as OfficialSource) &&
        event.eventTime >= earliest &&
        event.eventTime <= latest
    )
    .map((event) =>
      earthMapEvent(
        event,
        latestStateByEvent.get(event.id)?.stage,
        config,
        now
      )
    )
    .sort(
      (a, b) =>
        statusRank(b.status) - statusRank(a.status) ||
        Number(b.staleGatePassed) - Number(a.staleGatePassed) ||
        b.score - a.score ||
        Date.parse(b.eventTime) - Date.parse(a.eventTime)
    );

  const spatialEvents = candidates
    .filter((event) => event.geometry)
    .slice(0, 700);
  const nonSpatialSignals = candidates
    .filter((event) => !event.geometry)
    .slice(0, 40);
  const currentFreshSignals = candidates.filter(
    (event) => event.status === "current" && event.staleGatePassed
  ).length;

  return {
    ok: true,
    generatedAt: now.toISOString(),
    system: dashboard.system,
    posture: dashboard.posture,
    notableEvent: dashboard.notableEvent,
    latestCycle: dashboard.latestCycle,
    summary: {
      ...dashboard.summary,
      currentFreshSignals,
      mappedSignals: spatialEvents.length,
      nonSpatialSignals: nonSpatialSignals.length
    },
    sources: dashboard.sources,
    map: {
      coverage:
        "United States default view with global official events available by panning or zooming.",
      method:
        "Heat indicates fresh official signal load, not disaster probability. The strongest signal leads; overlap adds visual intensity without converting unlike hazards into a prediction.",
      events: spatialEvents,
      nonSpatialSignals,
      regions: earthMapRegions(config.regions, dashboard.regions)
    }
  };
}

function dedupeLiveEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const byKey = new Map<string, NormalizedEvent>();
  for (const event of events) {
    const key =
      event.eventType === "earthquake"
        ? `earthquake:${event.externalId}`
        : `${event.source}:${event.externalId}`;
    const existing = byKey.get(key);
    if (
      !existing ||
      (event.source === "usgs_earthquake_geojson" &&
        existing.source === "usgs_fdsn_backfill") ||
      event.sourceUpdatedAt > existing.sourceUpdatedAt
    ) {
      byKey.set(key, event);
    }
  }
  return [...byKey.values()];
}

function earthMapEvent(
  event: NormalizedEvent,
  cascadeStage: CascadeStage | undefined,
  config: WatcherConfig,
  now: Date
): EarthMapEvent {
  const staleGate = evaluateStaleGate(event, { config, now });
  const family = hazardFamily(event);
  const status = eventStatus(event, staleGate.passed, now);
  return {
    id: event.id,
    source: event.source,
    sourceLabel: sourceLabel(event.source),
    externalId: event.externalId,
    eventType: event.eventType,
    family,
    title: event.title,
    eventTime: event.eventTime.toISOString(),
    sourceUpdatedAt: event.sourceUpdatedAt.toISOString(),
    ingestTime: event.ingestTime.toISOString(),
    region: event.region,
    magnitude: event.magnitude,
    depthKm: event.depthKm,
    severity: event.severity,
    officialUrl: event.officialUrl,
    geometry: geometryFromEvent(event),
    score: earthSignalScore(event, status),
    status,
    cascadeStage,
    staleGatePassed: staleGate.passed,
    staleGateResult: staleGate.passed ? "passed" : "blocked",
    staleGateReasons: staleGate.reasons
  };
}

function eventStatus(
  event: NormalizedEvent,
  fresh: boolean,
  now: Date
): EarthEventStatus {
  if (
    event.eventType === "weather_alert" &&
    event.eventTime.getTime() > now.getTime() + 60_000
  ) {
    return "forecast";
  }

  if (!fresh) {
    return "recent";
  }

  if (event.eventType === "weather_alert") {
    const properties = objectField(asObject(event.rawJson), "properties");
    const endsAt =
      parseDate(properties.ends) ?? parseDate(properties.expires);
    return endsAt && endsAt > now ? "current" : "recent";
  }

  if (event.eventType === "natural_event") {
    return asObject(event.rawJson).closed === null ? "current" : "recent";
  }

  return "current";
}

function geometryFromEvent(event: NormalizedEvent): EarthGeometry | undefined {
  const raw = asObject(event.rawJson);
  const rawGeometry = supportedGeometry(raw.geometry);
  if (rawGeometry) {
    return rawGeometry;
  }

  if (event.eventType === "natural_event" && Array.isArray(raw.geometry)) {
    const geometries = raw.geometry
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
      .sort(
        (a, b) =>
          dateValue(b.date) - dateValue(a.date)
      );
    const latest = geometries[0];
    const geometry = latest
      ? supportedGeometry({
          type: latest.type,
          coordinates: latest.coordinates
        })
      : undefined;
    if (geometry) {
      return geometry;
    }
  }

  if (event.lat !== undefined && event.lon !== undefined) {
    return {
      type: "Point",
      coordinates: [event.lon, event.lat]
    };
  }
  return undefined;
}

function supportedGeometry(value: unknown): EarthGeometry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const object = value as Record<string, unknown>;
  if (
    (object.type === "Point" ||
      object.type === "Polygon" ||
      object.type === "MultiPolygon") &&
    Array.isArray(object.coordinates)
  ) {
    return {
      type: object.type,
      coordinates: object.coordinates
    };
  }
  return undefined;
}

function earthSignalScore(
  event: NormalizedEvent,
  status: EarthEventStatus
): number {
  let score = 25;
  if (event.eventType === "earthquake") {
    const magnitude = event.magnitude ?? 0;
    score =
      magnitude >= 8
        ? 100
        : magnitude >= 7
          ? 92 + (magnitude - 7) * 8
          : magnitude >= 6
            ? 82 + (magnitude - 6) * 10
            : magnitude >= 5
              ? 68 + (magnitude - 5) * 14
              : Math.max(15, 18 + magnitude * 10);
  } else if (event.eventType === "weather_alert") {
    const severity = event.severity?.split("/")[0] ?? "Unknown";
    score =
      severity === "Extreme"
        ? 94
        : severity === "Severe"
          ? 80
          : severity === "Moderate"
            ? 58
            : 35;
    if (/tornado|hurricane/i.test(event.title)) score += 6;
    if (/flash flood|tropical storm/i.test(event.title)) score += 4;
  } else if (event.eventType === "volcano_notice") {
    score = /RED|WARNING/i.test(event.severity ?? "")
      ? 100
      : /ORANGE|WATCH/i.test(event.severity ?? "")
        ? 90
        : /YELLOW|ADVISORY/i.test(event.severity ?? "")
          ? 74
          : 35;
  } else if (event.eventType === "tsunami") {
    score = /warning/i.test(event.severity ?? "")
      ? 98
      : /advisory/i.test(event.severity ?? "")
        ? 86
        : /watch/i.test(event.severity ?? "")
          ? 72
          : 35;
  } else if (event.eventType === "natural_event") {
    const category = event.severity?.toLowerCase() ?? "";
    score = category.includes("severe storm")
      ? 76
      : category.includes("volcano")
        ? 74
        : category.includes("flood")
          ? 70
          : category.includes("landslide")
            ? 68
            : category.includes("wildfire")
              ? 60
              : 45;
  } else if (event.eventType === "space_weather") {
    const kp = numberValue(asObject(event.rawJson).kp);
    score = kp !== undefined ? 10 + kp * 10 : 48;
  }
  if (status === "current") score += 3;
  if (status === "forecast") score += 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function hazardFamily(event: NormalizedEvent): HazardFamily {
  if (event.eventType === "earthquake") return "earthquake";
  if (event.eventType === "weather_alert") return "weather";
  if (event.eventType === "volcano_notice") return "volcano";
  if (event.eventType === "tsunami") return "tsunami";
  if (event.eventType === "space_weather") return "space_weather";
  return "natural";
}

function earthMapRegions(
  rules: RegionRule[],
  regions: DashboardData["regions"]
): EarthMapRegion[] {
  return regions
    .filter((region) => !region.comparatorOnly)
    .map((region) => {
      const rule = rules.find((candidate) => candidate.id === region.region);
      return {
        id: region.region,
        label: region.label,
        stage: region.stage,
        effectiveStage: region.effectiveStage,
        stageLabel: region.stageLabel,
        summary: region.operatorSummary,
        staleGatePassed: region.staleGatePassed,
        confidence: region.confidence,
        center: rule?.center,
        radiusKm: rule?.radiusKm,
        bbox: rule?.bbox
      };
    });
}

function statusRank(status: EarthEventStatus): number {
  return status === "current" ? 2 : status === "forecast" ? 1 : 0;
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    usgs_earthquake_geojson: "USGS earthquakes",
    usgs_fdsn_backfill: "USGS FDSN backfill",
    usgs_hans: "USGS HANS volcanoes",
    swpc_kp: "NOAA/SWPC Kp",
    swpc_goes_xray: "NOAA/SWPC GOES X-ray",
    swpc_solar_wind: "NOAA/SWPC solar wind",
    swpc_alerts: "NOAA/SWPC alerts",
    nasa_donki: "NASA DONKI",
    nasa_eonet: "NASA EONET",
    nws_alerts: "NOAA/NWS alerts",
    tsunami_ntwc: "NOAA NTWC tsunami",
    tsunami_ptwc: "NOAA PTWC tsunami"
  };
  return labels[source] ?? source;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function objectField(
  value: Record<string, unknown>,
  field: string
): Record<string, unknown> {
  return asObject(value[field]);
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateValue(value: unknown): number {
  return parseDate(value)?.getTime() ?? 0;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function earthWatchHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#F1F3EF">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Earth Watch">
  <title>Earth Watch - official US geohazard conditions</title>
  <meta name="description" content="Official-source earthquake, volcano, tsunami, severe-weather, natural-event, and space-weather situational awareness.">
  <meta property="og:title" content="Earth Watch - official geohazard conditions">
  <meta property="og:description" content="A live official-source view of current geological and natural hazard signals.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://earth.tkcgroup.co/">
  <link rel="canonical" href="https://earth.tkcgroup.co/">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
  <style>
    :root {
      --paper:#F1F3EF; --panel:#FBFCFA; --ink:#1E2A2C; --muted:#5C6A66; --hair:#D4DAD3;
      --clear:#2F7D57; --watch:#D3921F; --high:#DE5F26; --critical:#BE2618; --blue:#347FAC;
    }
    * { box-sizing:border-box; }
    html, body { margin:0; }
    body {
      background:var(--paper); color:var(--ink);
      font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased;
    }
    a { color:#176452; }
    button, select { font:inherit; }
    .wrap { max-width:1240px; margin:0 auto; padding:22px 20px 60px; }
    .mono { font-family:"IBM Plex Mono",ui-monospace,monospace; }
    .eyebrow {
      font-family:"Barlow Condensed",sans-serif; text-transform:uppercase;
      letter-spacing:.2em; font-size:13px; color:var(--muted);
    }
    .mast {
      display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap;
      border-bottom:2px solid var(--ink); padding-bottom:12px;
    }
    .mast h1 {
      font-family:"Barlow Condensed",sans-serif; font-weight:700; font-size:clamp(34px,5vw,52px);
      line-height:.94; margin:.12em 0 .1em; text-transform:uppercase; letter-spacing:.01em;
    }
    .mast .sub { color:var(--muted); font-size:14px; }
    .freshness { text-align:right; font-size:12.5px; color:var(--muted); min-width:190px; }
    .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--clear); margin-right:6px; }
    .dot.stale { background:var(--critical); }
    .controls {
      display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;
      margin-top:15px;
    }
    .segmented { display:flex; border:1px solid var(--hair); border-radius:4px; overflow:hidden; background:var(--panel); }
    .segmented button {
      min-height:40px; border:0; border-right:1px solid var(--hair); background:transparent;
      color:var(--muted); padding:0 14px; cursor:pointer; font-family:"Barlow Condensed",sans-serif;
      text-transform:uppercase; letter-spacing:.06em; font-weight:600;
    }
    .segmented button:last-child { border-right:0; }
    .segmented button.active { background:var(--ink); color:var(--paper); }
    .control-actions { display:flex; gap:8px; flex-wrap:wrap; }
    .field {
      min-height:40px; border:1px solid var(--hair); border-radius:4px; background:var(--panel);
      color:var(--ink); padding:0 12px;
    }
    .pbtn {
      min-height:40px; border:1px solid var(--hair); border-radius:4px; background:var(--panel);
      color:var(--ink); padding:0 14px; cursor:pointer; font-family:"Barlow Condensed",sans-serif;
      text-transform:uppercase; letter-spacing:.06em; font-weight:600;
    }
    .intro {
      margin-top:14px; padding:13px 15px; border:1px solid var(--hair); border-radius:4px;
      background:var(--panel); font-size:13.5px;
    }
    .intro p { margin:0 0 8px; }
    .intro p:last-child { margin:0; }
    .disc { color:#753616; background:#FDF3EC; border:1px solid #F0C8A0; border-radius:3px; padding:8px 11px; }
    .banner {
      --tone:var(--clear); margin-top:16px; border:1px solid var(--hair); border-left:10px solid var(--tone);
      border-radius:4px; background:var(--panel); padding:15px 17px;
      display:grid; grid-template-columns:auto minmax(0,1fr); gap:18px; align-items:center;
    }
    .banner[data-tone="watch"] { --tone:var(--watch); }
    .banner[data-tone="elevated"] { --tone:var(--high); }
    .banner[data-tone="critical"] { --tone:var(--critical); }
    .tierword {
      font-family:"Barlow Condensed",sans-serif; font-weight:700; text-transform:uppercase;
      font-size:clamp(30px,5vw,52px); line-height:.9; color:var(--tone);
    }
    .banner h2 { margin:0; font-size:18px; }
    .banner p { margin:4px 0 0; color:var(--muted); font-size:13px; }
    .metrics {
      display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:1px; background:var(--hair);
      border:1px solid var(--hair); margin-top:14px;
    }
    .metric { background:var(--panel); padding:12px 14px; min-height:86px; }
    .metric .value { font-family:"Barlow Condensed",sans-serif; font-size:30px; font-weight:700; line-height:1; }
    .metric .label { margin-top:7px; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
    .main-grid { display:grid; grid-template-columns:minmax(0,1.65fr) minmax(320px,.75fr); gap:16px; margin-top:16px; }
    .card { background:var(--panel); border:1px solid var(--hair); border-radius:4px; overflow:hidden; }
    #map { height:610px; width:100%; background:#E9ECE8; }
    .maphint { font-size:11.5px; color:var(--muted); padding:8px 12px; border-top:1px solid var(--hair); }
    .legend { display:flex; gap:10px; flex-wrap:wrap; margin-top:6px; }
    .legend span::before { content:""; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; background:var(--legend); }
    .sidebar { display:grid; align-content:start; }
    .sec { padding:14px 15px; border-bottom:1px solid var(--hair); }
    .sec:last-child { border-bottom:0; }
    .sec-title {
      display:flex; align-items:baseline; justify-content:space-between; gap:8px;
      font-family:"Barlow Condensed",sans-serif; text-transform:uppercase; letter-spacing:.08em;
      color:var(--muted); font-size:13px; font-weight:600;
    }
    .notable-head { display:block; }
    .notable-head span:last-child { display:block; margin-top:2px; }
    .notable-title { display:block; margin:7px 0 2px; font-size:17px; line-height:1.3; }
    .notable-meta { color:var(--muted); font-size:12px; }
    .scoreline { display:flex; gap:8px; margin-top:9px; flex-wrap:wrap; }
    .score {
      border:1px solid var(--hair); border-radius:3px; padding:4px 8px; font-family:"IBM Plex Mono",monospace; font-size:11px;
    }
    .signals { display:grid; gap:0; margin-top:5px; }
    .signal {
      width:100%; display:grid; grid-template-columns:7px minmax(0,1fr) auto; gap:9px;
      text-align:left; padding:9px 0; border:0; border-bottom:1px dashed var(--hair);
      background:transparent; color:var(--ink); cursor:pointer; text-decoration:none;
    }
    .signal:last-child { border-bottom:0; }
    .signal-bar { border-radius:4px; background:var(--signal); }
    .signal-name { display:block; font-weight:650; font-size:13px; line-height:1.3; }
    .signal-meta { display:block; color:var(--muted); font-size:11px; margin-top:2px; }
    .signal:hover .signal-name { text-decoration:underline; }
    .signal-score { font-family:"IBM Plex Mono",monospace; font-size:11px; }
    .empty { color:var(--muted); font-size:13px; padding:8px 0; }
    .sources {
      display:flex; gap:7px; flex-wrap:wrap; margin-top:16px; font-family:"IBM Plex Mono",monospace; font-size:11px;
    }
    .src { border:1px solid var(--hair); border-radius:3px; padding:4px 8px; background:var(--panel); }
    .src::before { content:"● "; color:var(--clear); }
    .src.bad::before { color:var(--critical); }
    .method {
      margin-top:16px; border:1px solid var(--hair); border-radius:4px; background:var(--panel);
      padding:13px 15px; color:var(--muted); font-size:12px;
    }
    footer {
      margin-top:20px; border-top:1px solid var(--hair); padding-top:12px; color:var(--muted);
      font-size:12px; display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap;
    }
    .err { display:none; margin-top:16px; padding:12px 14px; border:1px solid var(--critical); background:#FBEDEA; color:#762719; }
    .err.on { display:block; }
    .leaflet-container { font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
    .leaflet-popup-content { min-width:230px; }
    .popup-title { font-weight:750; line-height:1.3; margin-bottom:6px; }
    .popup-row { font-size:11px; color:var(--muted); margin-top:3px; }
    .popup-row strong { color:var(--ink); }
    .popup-link { display:inline-block; margin-top:8px; font-weight:700; }
    body.map-fs { overflow:hidden; }
    .map-card.fs { position:fixed; inset:0; z-index:2000; border:0; border-radius:0; }
    .map-card.fs #map { height:100vh; height:100dvh; }
    .map-card.fs .maphint { display:none; }
    .fs-btn { font-size:17px; font-weight:700; color:var(--ink); text-decoration:none; cursor:pointer; }
    @media (max-width:920px) {
      .main-grid { grid-template-columns:1fr; }
      #map { height:460px; }
    }
    @media (max-width:680px) {
      .wrap { padding:15px 12px 42px; }
      .mast { align-items:flex-start; }
      .freshness { text-align:left; }
      .controls { align-items:stretch; }
      .segmented { width:100%; }
      .segmented button { flex:1; padding:0 7px; }
      .control-actions { width:100%; display:grid; grid-template-columns:1fr 1fr; }
      .control-actions select { grid-column:1 / -1; }
      .banner { grid-template-columns:1fr; gap:8px; }
      .metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
      #map { height:390px; }
      .metric { min-height:79px; }
    }
    @media (prefers-reduced-motion:no-preference) {
      .dot { animation:pulse 2.4s ease-in-out infinite; }
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="mast">
      <div>
        <div class="eyebrow">US Geohazard Watch</div>
        <h1>Earth Watch</h1>
        <div class="sub">Official-source geology, natural-hazard, and space-weather situational awareness.</div>
      </div>
      <div class="freshness">
        <div><span class="dot" id="liveDot"></span><span id="fresh">Loading official records...</span></div>
        <div class="mono" id="nextCheck" style="margin-top:4px;font-size:11px">15-minute official ingest cadence</div>
      </div>
    </header>

    <div class="controls">
      <div class="segmented" aria-label="Time window">
        <button type="button" class="active" data-window="now">Now</button>
        <button type="button" data-window="24h">24h</button>
        <button type="button" data-window="7d">7d</button>
        <button type="button" data-window="30d">30d</button>
        <button type="button" data-window="forecast">Forecast</button>
      </div>
      <div class="control-actions">
        <select id="hazardFilter" class="field" aria-label="Hazard layer">
          <option value="all">All hazard families</option>
          <option value="earthquake">Earthquakes</option>
          <option value="weather">Severe weather</option>
          <option value="natural">Natural events</option>
          <option value="volcano">Volcanoes</option>
          <option value="tsunami">Tsunami</option>
          <option value="space_weather">Space weather</option>
        </select>
        <button type="button" class="pbtn" id="resetUs">Reset US</button>
        <button type="button" class="pbtn" id="locate">Use my location</button>
      </div>
    </div>

    <section class="intro">
      <p>Use the map to inspect fresh official events, target-region stages, and broader natural-hazard context. The heat layer represents <strong>official signal load</strong>, not the probability of a disaster.</p>
      <p class="disc"><strong>Not a prediction or emergency-warning service.</strong> Earthquakes cannot be predicted by this page. For immediate instructions, follow the linked issuing agency and local emergency management.</p>
    </section>

    <div class="err" id="error"></div>

    <section class="banner" id="banner" data-tone="normal">
      <div class="tierword" id="tierword">Loading</div>
      <div>
        <h2 id="headline">Reading the latest official cycle</h2>
        <p id="postureDetail">No news, search, social, or snippet data is used.</p>
      </div>
    </section>

    <section class="metrics">
      <div class="metric"><div class="value" id="currentCount">-</div><div class="label">Fresh current signals</div></div>
      <div class="metric"><div class="value" id="quakeCount">-</div><div class="label">Earthquakes in selected window</div></div>
      <div class="metric"><div class="value" id="sourceCount">-</div><div class="label">Official sources healthy</div></div>
      <div class="metric"><div class="value" id="regionCount">-</div><div class="label">Elevated target regions</div></div>
    </section>

    <div class="main-grid">
      <div class="card map-card" id="mapCard">
        <div id="map" role="application" aria-label="Official geohazard map with earthquakes, severe-weather polygons, natural events, aggregate signal heat, and configured target regions"></div>
        <div class="maphint">
          Select a marker or polygon for official timestamps and stale-gate status. Use the map layer control to separate heat, events, and configured regions.
          <div class="legend">
            <span style="--legend:#347FAC">Earthquake</span>
            <span style="--legend:#BE2618">Severe weather</span>
            <span style="--legend:#DE5F26">Natural event</span>
            <span style="--legend:#7A4D91">Volcano</span>
            <span style="--legend:#2F7D57">Target region</span>
          </div>
        </div>
      </div>

      <aside class="card sidebar">
        <section class="sec">
          <div class="sec-title notable-head"><span>Most notable monitored event</span><span id="notablePeriod">-</span></div>
          <div id="notable"><div class="empty">Loading...</div></div>
        </section>
        <section class="sec">
          <div class="sec-title"><span>Signals in selected window</span><span class="mono" id="signalCount">0</span></div>
          <div class="signals" id="signals"><div class="empty">Loading...</div></div>
        </section>
        <section class="sec">
          <div class="sec-title"><span>Non-spatial context</span><span class="mono" id="contextCount">0</span></div>
          <div class="signals" id="contextSignals"><div class="empty">Loading...</div></div>
        </section>
      </aside>
    </div>

    <div class="sources" id="sources"></div>
    <div class="method" id="method">Loading the disclosed map method...</div>

    <footer>
      <div>Official-source situational awareness. Report-only. earth.tkcgroup.co</div>
      <div class="mono">USGS · NOAA/NWS · NOAA/SWPC · NASA · NOAA Tsunami</div>
    </footer>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js" integrity="sha384-mFKkGiGvT5vo1fEyGCD3hshDdKmW3wzXW/x+fWriYJArD0R3gawT6lMvLboM22c0" crossorigin=""></script>
  <script>
  (function() {
    "use strict";
    var state = { data:null, window:"now", hazard:"all", layerById:{} };
    var colors = {
      earthquake:"#347FAC", weather:"#BE2618", natural:"#DE5F26",
      volcano:"#7A4D91", tsunami:"#246B82", space_weather:"#697B73"
    };
    var map = L.map("map", { scrollWheelZoom:false, attributionControl:true }).setView([39.5,-98.35], 4);
    var topo = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", {
      maxZoom:16, attribution:"USGS The National Map"
    }).addTo(map);
    var clean = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom:18, subdomains:"abcd", attribution:"OpenStreetMap and CARTO"
    });
    var heatLayer = L.layerGroup().addTo(map);
    var eventLayer = L.layerGroup().addTo(map);
    var regionLayer = L.layerGroup().addTo(map);
    L.control.layers(
      {"USGS Topographic":topo, "Clean map":clean},
      {"Aggregate signal heat":heatLayer, "Official events":eventLayer, "Target regions":regionLayer},
      {collapsed:true}
    ).addTo(map);

    var FullscreenControl = L.Control.extend({
      options:{position:"topleft"},
      onAdd:function() {
        var container = L.DomUtil.create("div","leaflet-bar");
        var button = L.DomUtil.create("a","fs-btn",container);
        button.href = "#"; button.title = "Toggle full screen map"; button.setAttribute("aria-label","Toggle full screen map");
        button.textContent = "[]";
        L.DomEvent.on(button,"click",function(event) {
          L.DomEvent.preventDefault(event);
          var card = document.getElementById("mapCard");
          var active = card.classList.toggle("fs");
          document.body.classList.toggle("map-fs",active);
          button.textContent = active ? "X" : "[]";
          setTimeout(function(){ map.invalidateSize(); }, 50);
        });
        return container;
      }
    });
    map.addControl(new FullscreenControl());

    function esc(value) {
      return String(value == null ? "" : value).replace(/[&<>"]/g,function(char) {
        return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char];
      });
    }
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
      var seconds = Math.max(0,Math.round((Date.now()-Date.parse(value))/1000));
      if (seconds < 60) return seconds + "s ago";
      var minutes = Math.round(seconds/60);
      if (minutes < 60) return minutes + "m ago";
      var hours = Math.round(minutes/60);
      if (hours < 48) return hours + "h ago";
      return Math.round(hours/24) + "d ago";
    }
    function fmt(value) {
      if (!value) return "-";
      return new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(value));
    }
    function windowStart() {
      var now = Date.now();
      if (state.window === "24h" || state.window === "now") return now - 86400000;
      if (state.window === "7d") return now - 7*86400000;
      return now - 30*86400000;
    }
    function selectedEvents() {
      if (!state.data) return [];
      return state.data.map.events.filter(function(event) {
        if (state.hazard !== "all" && event.family !== state.hazard) return false;
        if (state.window === "now") return event.status === "current" && event.staleGatePassed;
        if (state.window === "forecast") return event.status === "forecast";
        var occurredAt = Date.parse(event.eventTime);
        return event.status !== "forecast" && occurredAt >= windowStart() && occurredAt <= Date.now();
      });
    }
    function popup(event) {
      return '<div class="popup-title">' + esc(event.title) + '</div>' +
        '<div class="popup-row"><strong>Official source:</strong> ' + esc(event.sourceLabel) + '</div>' +
        '<div class="popup-row"><strong>Event time:</strong> ' + esc(fmt(event.eventTime)) + '</div>' +
        '<div class="popup-row"><strong>Source updated:</strong> ' + esc(fmt(event.sourceUpdatedAt)) + '</div>' +
        '<div class="popup-row"><strong>Ingest time:</strong> ' + esc(fmt(event.ingestTime)) + '</div>' +
        '<div class="popup-row"><strong>Region:</strong> ' + esc(event.region || "source-defined / outside configured targets") + '</div>' +
        '<div class="popup-row"><strong>Cascade stage:</strong> ' + esc(event.cascadeStage || "context only") + '</div>' +
        '<div class="popup-row"><strong>Stale gate:</strong> ' + esc(event.staleGateResult) + '</div>' +
        (event.staleGateReasons.length ? '<div class="popup-row"><strong>Blocked by:</strong> ' + esc(event.staleGateReasons.join(", ")) + '</div>' : '') +
        '<a class="popup-link" href="' + esc(safeUrl(event.officialUrl)) + '" target="_blank" rel="noopener">Open official record</a>';
    }
    function pointForGeometry(geometry) {
      if (!geometry) return null;
      if (geometry.type === "Point") return [Number(geometry.coordinates[1]),Number(geometry.coordinates[0])];
      try {
        var bounds = L.geoJSON({type:"Feature",geometry:geometry,properties:{}}).getBounds();
        if (bounds.isValid()) {
          var center = bounds.getCenter();
          return [center.lat,center.lng];
        }
      } catch (error) {}
      return null;
    }
    function renderMap() {
      eventLayer.clearLayers(); heatLayer.clearLayers(); state.layerById = {};
      var events = selectedEvents();
      var heat = [];
      events.forEach(function(event) {
        var color = colors[event.family] || "#697B73";
        var opacity = event.staleGatePassed ? 0.78 : 0.28;
        var layer;
        if (event.geometry.type === "Point") {
          var point = pointForGeometry(event.geometry);
          if (!point) return;
          var radius = event.family === "earthquake" ? Math.max(5,Math.min(18,5+(event.magnitude || 0)*1.5)) : Math.max(6,Math.min(15,event.score/8));
          layer = L.circleMarker(point,{radius:radius,color:color,weight:2,fillColor:color,fillOpacity:opacity});
        } else {
          layer = L.geoJSON({type:"Feature",geometry:event.geometry,properties:{}},{
            style:{color:color,weight:2,fillColor:color,fillOpacity:opacity*0.28}
          });
        }
        layer.bindPopup(popup(event));
        layer.addTo(eventLayer);
        state.layerById[event.id] = layer;
        var heatPoint = pointForGeometry(event.geometry);
        if (heatPoint && event.status === "current" && event.staleGatePassed) {
          heat.push([heatPoint[0],heatPoint[1],Math.max(.15,event.score/100)]);
        }
      });
      if (heat.length && typeof L.heatLayer === "function") {
        L.heatLayer(heat,{radius:32,blur:24,maxZoom:8,minOpacity:.24,gradient:{.2:"#69A88F",.5:"#D3921F",.75:"#DE5F26",1:"#BE2618"}}).addTo(heatLayer);
      }
      renderSignals(events);
      document.getElementById("quakeCount").textContent = String(events.filter(function(event){return event.family === "earthquake";}).length);
    }
    function renderRegions() {
      regionLayer.clearLayers();
      state.data.map.regions.forEach(function(region) {
        var stageNumber = Number(region.effectiveStage.slice(1)) || 0;
        var color = stageNumber >= 4 ? "#BE2618" : stageNumber >= 3 ? "#DE5F26" : stageNumber >= 1 ? "#347FAC" : "#2F7D57";
        var options = {color:color,weight:2,fillColor:color,fillOpacity:.08,dashArray:"5 4"};
        var layer = null;
        if (region.center && region.radiusKm) {
          layer = L.circle(region.center,{radius:region.radiusKm*1000,color:options.color,weight:options.weight,fillColor:options.fillColor,fillOpacity:options.fillOpacity,dashArray:options.dashArray});
        } else if (region.bbox) {
          layer = L.rectangle([[region.bbox[1],region.bbox[0]],[region.bbox[3],region.bbox[2]]],options);
        }
        if (layer) {
          layer.bindPopup('<div class="popup-title">' + esc(region.label) + '</div>' +
            '<div class="popup-row"><strong>Effective stage:</strong> ' + esc(region.effectiveStage) + '</div>' +
            '<div class="popup-row"><strong>Freshness gate:</strong> ' + esc(region.staleGatePassed ? "passed" : "blocked / no current qualifying signal") + '</div>' +
            '<div class="popup-row"><strong>Confidence:</strong> ' + Math.round(region.confidence*100) + '%</div>' +
            '<div class="popup-row">' + esc(region.summary) + '</div>');
          layer.addTo(regionLayer);
        }
      });
    }
    function renderSignals(events) {
      var container = document.getElementById("signals");
      document.getElementById("signalCount").textContent = String(events.length);
      if (!events.length) {
        container.innerHTML = '<div class="empty">No qualifying official signals in this view.</div>';
        return;
      }
      container.innerHTML = events.slice(0,12).map(function(event) {
        var color = colors[event.family] || "#697B73";
        return '<button class="signal" type="button" data-event-id="' + esc(event.id) + '">' +
          '<span class="signal-bar" style="--signal:' + color + '"></span>' +
          '<span><span class="signal-name">' + esc(event.title) + '</span><span class="signal-meta">' + esc(event.sourceLabel) + ' · ' + esc(relative(event.eventTime)) + ' · gate ' + esc(event.staleGateResult) + '</span></span>' +
          '<span class="signal-score">' + esc(event.score) + '</span></button>';
      }).join("");
      Array.prototype.forEach.call(container.querySelectorAll("[data-event-id]"),function(button) {
        button.addEventListener("click",function() {
          var event = events.find(function(candidate){ return candidate.id === button.getAttribute("data-event-id"); });
          if (!event) return;
          var point = pointForGeometry(event.geometry);
          if (point) map.setView(point,Math.max(map.getZoom(),6));
          var layer = state.layerById[event.id];
          if (layer && layer.openPopup) layer.openPopup();
          if (layer && layer.getLayers) {
            var childLayers = layer.getLayers();
            if (childLayers[0] && childLayers[0].openPopup) childLayers[0].openPopup();
          }
        });
      });
    }
    function renderContext() {
      var items = state.data.map.nonSpatialSignals.filter(function(event) {
        if (state.hazard !== "all" && event.family !== state.hazard) return false;
        if (state.window === "now") return event.status === "current" && event.staleGatePassed;
        if (state.window === "forecast") return event.status === "forecast";
        var occurredAt = Date.parse(event.eventTime);
        return event.status !== "forecast" && occurredAt >= windowStart() && occurredAt <= Date.now();
      });
      document.getElementById("contextCount").textContent = String(items.length);
      document.getElementById("contextSignals").innerHTML = items.length ? items.slice(0,8).map(function(event) {
        var color = colors[event.family] || "#697B73";
        return '<a class="signal" href="' + esc(safeUrl(event.officialUrl)) + '" target="_blank" rel="noopener">' +
          '<span class="signal-bar" style="--signal:' + color + '"></span>' +
          '<span><span class="signal-name">' + esc(event.title) + '</span><span class="signal-meta">' + esc(event.sourceLabel) + ' · ' + esc(relative(event.eventTime)) + ' · gate ' + esc(event.staleGateResult) + '</span></span>' +
          '<span class="signal-score">' + esc(event.score) + '</span></a>';
      }).join("") : '<div class="empty">No non-spatial signal in this view.</div>';
    }
    function renderNotable() {
      var item = state.data.notableEvent;
      if (!item) {
        document.getElementById("notable").innerHTML = '<div class="empty">No qualifying official event in the 30-day window.</div>';
        return;
      }
      document.getElementById("notablePeriod").textContent = item.periodLabel;
      document.getElementById("notable").innerHTML =
        '<a class="notable-title" href="' + esc(safeUrl(item.event.officialUrl)) + '" target="_blank" rel="noopener">' + esc(item.event.title) + '</a>' +
        '<div class="notable-meta">' + esc(item.event.sourceLabel) + ' · ' + esc(fmt(item.occurredAt)) + '</div>' +
        '<div class="scoreline"><span class="score">' + esc(item.score) + '/100</span><span class="score">' +
        (item.comparableCount === 1 ? 'only record' : esc(item.rarityPercentile) + 'th percentile') + '</span></div>' +
        '<div class="notable-meta" style="margin-top:8px">' + esc(item.scoreBreakdown) + '</div>';
    }
    function renderSources() {
      var healthy = state.data.sources.filter(function(source){ return source.status === "ok"; }).length;
      document.getElementById("sourceCount").textContent = healthy + "/" + state.data.sources.length;
      document.getElementById("sources").innerHTML = state.data.sources.map(function(source) {
        return '<span class="src ' + (source.status === "ok" ? "" : "bad") + '">' + esc(source.label) + ' · ' + esc(source.status) + '</span>';
      }).join("");
    }
    function render() {
      var data = state.data;
      document.getElementById("banner").setAttribute("data-tone",data.posture.tone);
      document.getElementById("tierword").textContent = data.posture.stage + " " + data.posture.label;
      document.getElementById("headline").textContent = data.posture.action;
      document.getElementById("postureDetail").textContent = data.posture.detail;
      document.getElementById("fresh").textContent = "Updated " + relative(data.generatedAt);
      document.getElementById("liveDot").classList.toggle("stale",data.posture.sourceHealth !== "healthy");
      document.getElementById("currentCount").textContent = String(data.summary.currentFreshSignals);
      document.getElementById("regionCount").textContent = String(data.map.regions.filter(function(region){ return Number(region.effectiveStage.slice(1)) >= 2; }).length);
      document.getElementById("method").textContent = data.map.method + " " + data.map.coverage;
      renderNotable(); renderSources(); renderRegions(); renderMap(); renderContext();
    }
    async function load() {
      try {
        var response = await fetch("/api/earth");
        if (!response.ok) throw new Error("Earth data returned HTTP " + response.status);
        var data = await response.json();
        if (!data.ok) throw new Error(data.error || "Earth data unavailable");
        state.data = data;
        document.getElementById("error").classList.remove("on");
        render();
      } catch (error) {
        document.getElementById("liveDot").classList.add("stale");
        document.getElementById("fresh").textContent = "Official data unavailable";
        document.getElementById("tierword").textContent = "Unknown";
        document.getElementById("headline").textContent = "Do not interpret this as a clear reading";
        document.getElementById("error").textContent = String(error && error.message ? error.message : error);
        document.getElementById("error").classList.add("on");
      }
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-window]"),function(button) {
      button.addEventListener("click",function() {
        state.window = button.getAttribute("data-window");
        Array.prototype.forEach.call(document.querySelectorAll("[data-window]"),function(item){ item.classList.toggle("active",item === button); });
        renderMap(); renderContext();
      });
    });
    document.getElementById("hazardFilter").addEventListener("change",function(event) {
      state.hazard = event.target.value; renderMap(); renderContext();
    });
    document.getElementById("resetUs").addEventListener("click",function(){ map.setView([39.5,-98.35],4); });
    document.getElementById("locate").addEventListener("click",function() {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(function(position) {
        map.setView([position.coords.latitude,position.coords.longitude],8);
      });
    });
    document.addEventListener("keydown",function(event) {
      if (event.key === "Escape" && document.getElementById("mapCard").classList.contains("fs")) {
        document.getElementById("mapCard").classList.remove("fs");
        document.body.classList.remove("map-fs");
        setTimeout(function(){ map.invalidateSize(); },50);
      }
    });
    window.addEventListener("resize",function(){ setTimeout(function(){ map.invalidateSize(); },50); });
    load();
    setInterval(load,5*60*1000);
  })();
  </script>
</body>
</html>`;
}
