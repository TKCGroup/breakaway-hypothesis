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
import {
  antipode,
  feltRings,
  type FeltRing,
  MODEL_MAX_DISTANCE_KM
} from "./logic/feltRadius.js";
import {
  CITY_ATTRIBUTION,
  nearestPopulation,
  type NearestPopulation
} from "./logic/nearestCity.js";
import { solarClientSource } from "./logic/solar.js";
import { ambientClientSource } from "./logic/ambient.js";
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

export interface EarthMapContext {
  eligible: boolean;
  result: "fresh" | "magnitude_extended" | "blocked";
  windowHours: number;
  eventAgeHours: number;
  sourceAgeHours: number;
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
  mapContext: EarthMapContext;
  /** Point on the opposite side of the planet, present whenever the event is a point. */
  antipode?: [number, number];
  /** Observed shaking, straight from the official record. Absent means not reported. */
  shaking?: EarthShakingReport;
  /** Modeled perceptibility rings. Only for earthquakes with a magnitude. */
  feltRings?: FeltRing[];
  /** The issuing agency's own words about this event, when it published any. */
  detail?: EarthEventDetail;
  /**
   * How far this was from people. A magnitude on its own cannot distinguish an
   * M7.7 under open ocean from an M7.7 under a city; this is the missing half.
   */
  population?: NearestPopulation;
}

/**
 * What the agency actually wrote, lifted out of the stored payload.
 *
 * NWS carries the whole warning — what is happening, where, and what to do — in
 * every alert, but publishes no per-alert human page: its `web` field is the
 * literal string "http://www.weather.gov" on every single alert, so linking a
 * reader to "the official record" sent them to raw JSON. The text was already in
 * the database; it just had nowhere to go.
 */
export interface EarthEventDetail {
  /** One-line agency summary, e.g. "Flood Watch issued August 14 at 9:41PM CDT". */
  headline?: string;
  /** The body of the notice — the WHAT / WHERE / IMPACTS narrative. */
  summary?: string;
  /** What the agency tells people to do. Absent on most non-weather sources. */
  instruction?: string;
  /** Issuing office, e.g. "NWS Lincoln IL". */
  issuedBy?: string;
  /** When the notice stops applying, ISO 8601. */
  expiresAt?: string;
  /**
   * NWS forecast/county zone URLs this alert applies to, from `affectedZones`.
   *
   * Roughly a third of NWS alerts ship `geometry: null` and describe their area
   * only as zone references plus a prose `areaDesc`. Those are exactly the events
   * that land in the non-spatial list, and until this field existed the page had
   * nothing to put on a map for them — so their only link was the raw JSON API
   * document. The zone endpoint returns the polygon, so the location IS knowable;
   * it just takes a second request.
   */
  zones?: string[];
  /** The agency's own prose description of the area, e.g. "Big Island Windward Waters". */
  areaDesc?: string;
  /**
   * Human-readable agency pages for this event, from a feed that aggregates other
   * agencies — EONET's `sources` is the case that exists today.
   *
   * EONET's own `link` is its API document for the event, so without this an
   * EONET row's only destination is JSON. Its `sources` point at the issuing
   * agency's actual page (NHC's storm archive, InciWeb, GDACS), which is where a
   * reader wanted to go in the first place.
   */
  sourceLinks?: { id: string; url: string }[];
}

/**
 * What the issuing agency actually observed, as distinct from what the model predicts.
 * Every field is optional because USGS genuinely omits them: only about 5% of events
 * in a given week carry any "Did You Feel It" response at all.
 */
export interface EarthShakingReport {
  /** Number of "Did You Feel It" responses received. */
  feltReports?: number;
  /** Community Decimal Intensity — the maximum intensity people reported. */
  reportedIntensity?: number;
  /** Maximum instrumental intensity from ShakeMap. */
  instrumentalIntensity?: number;
  /** PAGER alert level, when USGS has issued one. */
  pagerAlert?: string;
  /** USGS event id, which is what addresses the ShakeMap contour product. */
  usgsEventId?: string;
  /** True when USGS lists a shakemap product, so official contours can be fetched. */
  hasShakeMap: boolean;
}

export interface EarthMapFocus {
  /**
   * `lead_signal` — the viewport opened on the single most significant eligible event.
   * `us_fallback` — nothing qualified, so the map shows the United States.
   *
   * Was `signal_cluster` until the default became a single-event pick; the name is part
   * of the published payload's description of *how* the viewport was chosen, so it
   * changed with the method rather than outliving it.
   */
  mode: "lead_signal" | "us_fallback";
  center: [number, number];
  zoom: number;
  score: number;
  label: string;
  eventIds: string[];
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
    activeMapSignals: number;
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
    focus: EarthMapFocus;
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
        Number(b.mapContext.eligible) - Number(a.mapContext.eligible) ||
        b.score - a.score ||
        statusRank(b.status) - statusRank(a.status) ||
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
  const activeMapSignals = candidates.filter(isActiveMapEvent).length;

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
      activeMapSignals,
      mappedSignals: spatialEvents.length,
      nonSpatialSignals: nonSpatialSignals.length
    },
    sources: dashboard.sources,
    map: {
      coverage:
        "The initial viewport opens on the single most significant eligible official signal — highest severity first, most recent to break a tie — zoomed to include nearby activity, with a United States fallback when no active signal qualifies.",
      method:
        "Heat indicates eligible official signal load, not disaster probability. Earthquake map context persists by magnitude (under M4: 2h; M4-M5: 24h; M6: 72h; M7+: 7d) without changing the hard notification stale gate. " +
        "Distance-to-population is computed from " + CITY_ATTRIBUTION + "; the seismic run-up chart queries the USGS catalogue directly and is not drawn from this map's own selection.",
      events: spatialEvents,
      nonSpatialSignals,
      regions: earthMapRegions(config.regions, dashboard.regions),
      focus: earthMapFocus(spatialEvents)
    }
  };
}

function dedupeLiveEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const byExactKey = new Map<string, NormalizedEvent>();
  for (const event of events) {
    const key =
      event.eventType === "earthquake"
        ? `earthquake:${event.externalId}`
        : `${event.source}:${event.externalId}`;
    const existing = byExactKey.get(key);
    if (!existing || preferredDuplicate(event, existing) > 0) {
      byExactKey.set(key, event);
    }
  }

  const unique = [...byExactKey.values()];
  const earthquakes = unique.filter(
    (event) => event.eventType === "earthquake"
  );
  const otherEvents = unique.filter(
    (event) => event.eventType !== "earthquake"
  );
  return [...otherEvents, ...dedupeEarthquakeAliases(earthquakes)];
}

function dedupeEarthquakeAliases(
  earthquakes: NormalizedEvent[]
): NormalizedEvent[] {
  const parents = earthquakes.map((_, index) => index);
  const findRoot = (index: number): number => {
    let current = index;
    while (parents[current] !== current) {
      parents[current] = parents[parents[current]!]!;
      current = parents[current]!;
    }
    return current;
  };
  const merge = (left: number, right: number): void => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  const ownerByAlias = new Map<string, number>();
  earthquakes.forEach((event, index) => {
    for (const alias of earthquakeAliases(event)) {
      const owner = ownerByAlias.get(alias);
      if (owner === undefined) {
        ownerByAlias.set(alias, index);
      } else {
        merge(owner, index);
      }
    }
  });

  const byTime = earthquakes
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) => a.event.eventTime.getTime() - b.event.eventTime.getTime()
    );
  for (let left = 0; left < byTime.length; left += 1) {
    for (let right = left + 1; right < byTime.length; right += 1) {
      const timeDifference =
        byTime[right]!.event.eventTime.getTime() -
        byTime[left]!.event.eventTime.getTime();
      if (timeDifference > 90_000) break;
      if (fuzzyEarthquakeMatch(byTime[left]!.event, byTime[right]!.event)) {
        merge(byTime[left]!.index, byTime[right]!.index);
      }
    }
  }

  const preferredByRoot = new Map<number, NormalizedEvent>();
  earthquakes.forEach((event, index) => {
    const root = findRoot(index);
    const existing = preferredByRoot.get(root);
    if (!existing || preferredDuplicate(event, existing) > 0) {
      preferredByRoot.set(root, event);
    }
  });
  return [...preferredByRoot.values()];
}

function earthquakeAliases(event: NormalizedEvent): Set<string> {
  const aliases = new Set<string>([event.externalId]);
  const raw = asObject(event.rawJson);
  const properties = objectField(raw, "properties");
  const ids = properties.ids;
  if (typeof ids === "string") {
    for (const id of ids.split(",")) {
      const normalized = id.trim();
      if (normalized) aliases.add(normalized);
    }
  } else if (Array.isArray(ids)) {
    for (const id of ids) {
      if (typeof id === "string" && id.trim()) aliases.add(id.trim());
    }
  }
  if (typeof raw.id === "string" && raw.id.trim()) {
    aliases.add(raw.id.trim());
  }
  return aliases;
}

function fuzzyEarthquakeMatch(
  left: NormalizedEvent,
  right: NormalizedEvent
): boolean {
  if (
    left.magnitude === undefined ||
    right.magnitude === undefined ||
    left.lat === undefined ||
    left.lon === undefined ||
    right.lat === undefined ||
    right.lon === undefined
  ) {
    return false;
  }
  return (
    Math.abs(
      left.eventTime.getTime() - right.eventTime.getTime()
    ) <= 90_000 &&
    Math.abs(left.magnitude - right.magnitude) <= 0.300_001 &&
    distanceKm([left.lat, left.lon], [right.lat, right.lon]) <= 50
  );
}

function preferredDuplicate(
  candidate: NormalizedEvent,
  existing: NormalizedEvent
): number {
  const sourceDifference =
    earthquakeSourcePriority(candidate.source) -
    earthquakeSourcePriority(existing.source);
  if (sourceDifference !== 0) return sourceDifference;

  if (
    candidate.eventType === "earthquake" &&
    existing.eventType === "earthquake"
  ) {
    const reviewDifference =
      earthquakeReviewPriority(candidate) -
      earthquakeReviewPriority(existing);
    if (reviewDifference !== 0) return reviewDifference;
  }

  const updateDifference =
    candidate.sourceUpdatedAt.getTime() - existing.sourceUpdatedAt.getTime();
  if (updateDifference !== 0) return updateDifference;
  const ingestDifference =
    candidate.ingestTime.getTime() - existing.ingestTime.getTime();
  if (ingestDifference !== 0) return ingestDifference;
  return candidate.id.localeCompare(existing.id);
}

function earthquakeSourcePriority(source: string): number {
  return source === "usgs_earthquake_geojson"
    ? 2
    : source === "usgs_fdsn_backfill"
      ? 1
      : 0;
}

function earthquakeReviewPriority(event: NormalizedEvent): number {
  return /^reviewed$/i.test(event.severity ?? "") ? 1 : 0;
}

function earthMapEvent(
  event: NormalizedEvent,
  cascadeStage: CascadeStage | undefined,
  config: WatcherConfig,
  now: Date
): EarthMapEvent {
  const staleGate = evaluateStaleGate(event, { config, now });
  const mapContext = earthMapContext(event, staleGate, config, now);
  const family = hazardFamily(event);
  const status = eventStatus(event, staleGate.passed, now);
  return {
    id: event.id,
    source: event.source,
    sourceLabel: sourceLabel(event.source),
    externalId: event.externalId,
    eventType: event.eventType,
    family,
    title: event.title.trim(),
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
    staleGateReasons: staleGate.reasons,
    mapContext,
    antipode: antipodeOf(event),
    shaking: shakingReport(event),
    detail: eventDetail(event),
    population:
      family === "earthquake" && validMapPoint(event.lat ?? Number.NaN, event.lon ?? Number.NaN)
        ? nearestPopulation(event.lat as number, event.lon as number)
        : undefined,
    feltRings:
      family === "earthquake" && Number.isFinite(event.magnitude)
        ? feltRings(event.magnitude, event.depthKm)
        : undefined
  };
}

/**
 * The agency's own text for this event, if the stored payload carries any.
 *
 * Deliberately reads the raw payload rather than only `body`: the normaliser keeps
 * `body` to a headline, which is a label, not an explanation. Everything is
 * optional and nothing is defaulted — an alert with no instruction is common and
 * inventing one would be worse than showing none.
 */
function eventDetail(event: NormalizedEvent): EarthEventDetail | undefined {
  const properties = asObject(asObject(event.rawJson).properties);
  const detail: EarthEventDetail = {
    headline: trimmedText(properties.headline) ?? trimmedText(event.body),
    summary: trimmedText(properties.description) ?? trimmedText(event.body),
    instruction: trimmedText(properties.instruction),
    issuedBy: trimmedText(properties.senderName),
    expiresAt: parseDate(properties.expires)?.toISOString(),
    zones: alertZones(properties.affectedZones),
    areaDesc: trimmedText(properties.areaDesc),
    // Read from the payload ROOT, not from properties: EONET is a plain object,
    // not a GeoJSON Feature, so its sources never appear under properties.
    sourceLinks: agencySourceLinks(asObject(event.rawJson).sources)
  };
  // Do not emit a detail block whose only content repeats the title.
  if (detail.headline && detail.summary === detail.headline) delete detail.summary;
  const hasContent = Object.values(detail).some((value) => value !== undefined);
  return hasContent ? detail : undefined;
}

function trimmedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length ? text : undefined;
}

/**
 * The zone URLs an NWS alert applies to, kept only if they are api.weather.gov
 * https URLs.
 *
 * The client fetches whatever comes back from here, so this is a trust boundary,
 * not a formatting step: an arbitrary string from a third-party feed must never
 * become the target of a browser request. The CSP is the second layer and would
 * refuse a foreign host anyway; this is the first.
 */
/**
 * Agency pages carried by an aggregating feed, kept only if https.
 *
 * Same trust boundary as `alertZones`: these become hrefs a reader clicks, and
 * they arrive from a third-party feed. Unlike the zone list this one is not
 * host-pinned, because the whole point is that it links OUT to whichever agency
 * issued the notice — so the protocol check is the guard, and the client passes
 * every one of these through safeUrl as well.
 */
function agencySourceLinks(
  value: unknown
): { id: string; url: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const links: { id: string; url: string }[] = [];
  for (const entry of value) {
    const record = asObject(entry);
    const href = trimmedText(record.url);
    if (!href) continue;
    let parsed: URL;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    if (links.some((link) => link.url === parsed.href)) continue;
    links.push({ id: trimmedText(record.id) ?? parsed.hostname, url: parsed.href });
    if (links.length >= 4) break;
  }
  return links.length ? links : undefined;
}

function alertZones(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const zones: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    if (parsed.hostname !== "api.weather.gov") continue;
    if (!zones.includes(parsed.href)) zones.push(parsed.href);
    // An alert can name dozens of zones. Six is enough to place it on a map, and
    // it bounds how many requests one click can fire.
    if (zones.length >= 6) break;
  }
  return zones.length ? zones : undefined;
}

function antipodeOf(event: NormalizedEvent): [number, number] | undefined {
  if (!validMapPoint(event.lat ?? Number.NaN, event.lon ?? Number.NaN)) return undefined;
  return antipode(event.lat as number, event.lon as number);
}

/**
 * Pull the observed-shaking fields out of the stored USGS payload.
 *
 * These ride along in `rawJson` because the normaliser only lifts the fields the
 * watcher itself needs. Nothing here is required and nothing is defaulted: a missing
 * `felt` means USGS received no reports, which is not the same as zero people feeling
 * it, and a fabricated 0 would read as a measurement.
 */
function shakingReport(event: NormalizedEvent): EarthShakingReport | undefined {
  if (event.eventType !== "earthquake") return undefined;
  const properties = asObject(asObject(event.rawJson).properties);
  if (!Object.keys(properties).length) return undefined;

  const types = typeof properties.types === "string" ? properties.types : "";
  const report: EarthShakingReport = {
    feltReports: reportedNumber(properties.felt),
    reportedIntensity: reportedNumber(properties.cdi),
    instrumentalIntensity: reportedNumber(properties.mmi),
    pagerAlert: typeof properties.alert === "string" ? properties.alert : undefined,
    // `externalId` is the USGS feature id (net + code, e.g. "us6000tkt2"), which is
    // exactly what the FDSN event query and the ShakeMap product path address.
    usgsEventId: event.externalId,
    hasShakeMap: types.includes("shakemap")
  };
  // Returned even when every field is empty. "We read the official record and it
  // reports no shaking" is a real state and a useful one; collapsing it into the
  // same undefined that means "this hazard has no shaking concept at all" would
  // overload one null across two different answers.
  return report;
}

export function earthquakeMapContextWindowHours(
  magnitude: number | undefined
): number {
  const value = magnitude ?? 0;
  if (value >= 7) return 7 * 24;
  if (value >= 6) return 72;
  if (value >= 4) return 24;
  return 2;
}

function earthMapContext(
  event: NormalizedEvent,
  staleGate: ReturnType<typeof evaluateStaleGate>,
  config: WatcherConfig,
  now: Date
): EarthMapContext {
  const eventAgeHours = hoursSince(event.eventTime, now);
  const sourceAgeHours = hoursSince(event.sourceUpdatedAt, now);
  const windowHours =
    event.eventType === "earthquake"
      ? earthquakeMapContextWindowHours(event.magnitude)
      : config.freshness.maxEventAgeHours;
  const withinWindow =
    eventAgeHours >= -1 / 60 &&
    sourceAgeHours >= -1 / 60 &&
    eventAgeHours <= windowHours &&
    sourceAgeHours <= windowHours;

  if (
    staleGate.passed &&
    (event.eventType !== "earthquake" || withinWindow)
  ) {
    return {
      eligible: true,
      result: "fresh",
      windowHours,
      eventAgeHours,
      sourceAgeHours
    };
  }

  const temporalReasonsOnly = staleGate.reasons.every(
    (reason) =>
      reason.startsWith("event_time_outside_max_age:") ||
      reason.startsWith("source_updated_at_stale:")
  );
  const magnitudeExtended =
    event.eventType === "earthquake" &&
    staleGate.sourceOfficial &&
    !staleGate.snippetOnly &&
    staleGate.titleDateConsistent &&
    temporalReasonsOnly &&
    withinWindow;

  return {
    eligible: magnitudeExtended,
    result: magnitudeExtended ? "magnitude_extended" : "blocked",
    windowHours,
    eventAgeHours,
    sourceAgeHours
  };
}

function isActiveMapEvent(event: EarthMapEvent): boolean {
  return (
    event.mapContext.eligible &&
    (event.family === "earthquake" || event.status === "current")
  );
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

/**
 * Like `numberValue`, but treats "the agency reported nothing" as undefined instead
 * of zero.
 *
 * `Number(null)` is 0, and USGS sends `felt: null` on roughly 95% of events in a
 * given week. Routing those through `numberValue` would publish "0 people felt this"
 * — a fabricated measurement that reads exactly like a real one and that no test of
 * the surrounding code would catch.
 */
function reportedNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return numberValue(value);
}

function hoursSince(then: Date, now: Date): number {
  return (now.getTime() - then.getTime()) / 3_600_000;
}

function earthMapFocus(events: EarthMapEvent[]): EarthMapFocus {
  const candidates = events
    .filter(isActiveMapEvent)
    .map((event) => ({
      event,
      point: representativePoint(event.geometry)
    }))
    .filter(
      (
        candidate
      ): candidate is {
        event: EarthMapEvent;
        point: [number, number];
      } => Boolean(candidate.point)
    );

  if (candidates.length === 0) {
    return {
      mode: "us_fallback",
      center: [39.5, -98.35],
      zoom: 4,
      score: 0,
      label: "United States fallback",
      eventIds: []
    };
  }

  // The lead signal is the single most significant eligible event, full stop. Recency
  // only breaks a tie between equals.
  //
  // This deliberately replaced an aggregate "cluster score" (anchor score plus up to +7
  // for neighbours within 650km), which could hand the opening viewport to a smaller
  // event that merely had company: +7 is less than one magnitude step above M6, so an
  // M6.0 with five neighbours outranked a lone M6.5. A reader opening the page is asking
  // "what is the biggest thing happening right now?", and the honest answer to that is
  // never "a quieter place where more is going on".
  //
  // Recency needs no explicit decay here because eligibility already encodes it:
  // `isActiveMapEvent` gates on the magnitude-tiered map-context window (sub-M4 lapses
  // after 2h, M7+ persists 7 days), so anything still in `candidates` is current *for its
  // own size*. Ranking those survivors by score is what makes "latest major" mean the
  // major one that is still happening, rather than the newest blip on the wire.
  const ranked = [...candidates].sort(
    (a, b) =>
      b.event.score - a.event.score ||
      Date.parse(b.event.eventTime) - Date.parse(a.event.eventTime) ||
      a.event.id.localeCompare(b.event.id)
  );
  const lead = ranked[0]!;

  // Neighbours are context for the lead, not competitors with it: they set how far to
  // zoom out so the surrounding activity is visible, and they are named in the label.
  // They no longer influence which event was chosen.
  const neighbours = candidates
    .filter(
      (candidate) =>
        candidate.event.id !== lead.event.id &&
        candidate.event.score >= 35 &&
        distanceKm(lead.point, candidate.point) <= 650
    )
    .sort(
      (a, b) =>
        b.event.score - a.event.score ||
        Date.parse(b.event.eventTime) - Date.parse(a.event.eventTime)
    );

  const maxDistanceKm = neighbours.reduce(
    (largest, neighbour) =>
      Math.max(largest, distanceKm(lead.point, neighbour.point)),
    0
  );
  const zoom =
    maxDistanceKm <= 80
      ? 6
      : maxDistanceKm <= 250
        ? 5
        : maxDistanceKm <= 650
          ? 4
          : 3;

  return {
    mode: "lead_signal",
    center: lead.point,
    zoom,
    // The lead event's own score, not an aggregate. A number on screen next to one
    // event's name has to be that event's number.
    score: Math.min(100, Math.round(lead.event.score)),
    label:
      neighbours.length > 0
        ? `${shortFocusTitle(lead.event.title)} and ${neighbours.length} nearby official signals`
        : shortFocusTitle(lead.event.title),
    eventIds: [lead, ...neighbours].slice(0, 24).map((member) => member.event.id)
  };
}

function shortFocusTitle(title: string): string {
  const maxLength = 96;
  return title.length <= maxLength
    ? title
    : `${title.slice(0, maxLength - 3).trimEnd()}...`;
}

function representativePoint(
  geometry: EarthGeometry | undefined
): [number, number] | undefined {
  if (!geometry) return undefined;
  if (
    geometry.type === "Point" &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length >= 2
  ) {
    const lon = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    return validMapPoint(lat, lon) ? [lat, lon] : undefined;
  }

  const points: Array<[number, number]> = [];
  collectCoordinatePairs(geometry.coordinates, points);
  if (points.length === 0) return undefined;
  const lat = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const lon = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return validMapPoint(lat, lon) ? [lat, lon] : undefined;
}

function collectCoordinatePairs(
  value: unknown,
  points: Array<[number, number]>
): void {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    const lon = value[0];
    const lat = value[1];
    if (validMapPoint(lat, lon)) points.push([lat, lon]);
    return;
  }
  for (const item of value) collectCoordinatePairs(item, points);
}

function validMapPoint(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function distanceKm(
  [latA, lonA]: [number, number],
  [latB, lonB]: [number, number]
): number {
  const toRadians = Math.PI / 180;
  const latARadians = latA * toRadians;
  const latBRadians = latB * toRadians;
  const latDelta = (latB - latA) * toRadians;
  const lonDelta = (lonB - lonA) * toRadians;
  const sinLat = Math.sin(latDelta / 2);
  const sinLon = Math.sin(lonDelta / 2);
  const haversine =
    sinLat * sinLat +
    Math.cos(latARadians) * Math.cos(latBRadians) * sinLon * sinLon;
  const bounded = Math.max(0, Math.min(1, haversine));
  return 6371 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
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
  <title>Earth Watch - official geohazard conditions</title>
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
    .earth-tabs {
      display:flex; width:max-content; margin-top:10px; border:1px solid var(--hair);
      border-radius:4px; overflow:hidden; background:var(--panel);
    }
    .earth-tabs a {
      min-height:36px; display:flex; align-items:center; padding:0 13px; border-right:1px solid var(--hair);
      color:var(--muted); font-family:"Barlow Condensed",sans-serif; font-size:12px; font-weight:600;
      letter-spacing:.07em; text-decoration:none; text-transform:uppercase;
    }
    .earth-tabs a:last-child { border-right:0; }
    .earth-tabs a[aria-current="page"] { background:var(--ink); color:var(--paper); }
    .earth-tabs a:not([aria-current="page"]):hover { background:#F4F7F3; color:var(--ink); }
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
    .legend span.ring::before { border-radius:0; width:9px; height:9px; background:transparent; border:1.5px dashed var(--legend); }

    .stage { position:relative; }
    .stage[data-stage="globe"] #map { display:none; }
    .stage[data-stage="map"] .globe-wrap { display:none; }
    .globe-wrap { position:relative; height:610px; width:100%; background:#05070D; }
    #globe { display:block; width:100%; height:100%; touch-action:none; cursor:grab; }
    #globe:active { cursor:grabbing; }
    .globe-status {
      position:absolute; left:12px; bottom:12px; z-index:5; pointer-events:none;
      font-family:"IBM Plex Mono",monospace; font-size:10.5px; letter-spacing:.03em;
      color:#C6D4E4; background:rgba(5,7,13,.68); border:1px solid rgba(198,212,228,.22);
      border-radius:3px; padding:5px 8px; max-width:min(420px,72%); line-height:1.5;
    }
    .globe-clock {
      position:absolute; right:12px; top:12px; z-index:5; pointer-events:none;
      font-family:"IBM Plex Mono",monospace; font-size:10.5px; color:#C6D4E4;
      background:rgba(5,7,13,.68); border:1px solid rgba(198,212,228,.22);
      border-radius:3px; padding:5px 8px; text-align:right; line-height:1.6;
      white-space:pre-line;
    }
    .globe-tools { position:absolute; left:12px; top:12px; z-index:5; display:flex; gap:6px; }
    .globe-tools button {
      font-family:"IBM Plex Mono",monospace; font-size:10.5px; letter-spacing:.03em;
      color:#C6D4E4; background:rgba(5,7,13,.72); border:1px solid rgba(198,212,228,.28);
      border-radius:3px; padding:5px 8px; cursor:pointer;
    }
    .globe-tools button[aria-pressed="true"] { background:#C6D4E4; color:#05070D; }

    .toggles { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .tgl {
      display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:var(--muted);
      border:1px solid var(--hair); border-radius:4px; padding:6px 9px; background:var(--panel); cursor:pointer;
    }
    .tgl input { margin:0; accent-color:var(--ink); }
    .tgl:has(input:checked) { color:var(--ink); border-color:var(--ink); font-weight:600; }

    .cyclone-controls { margin-top:8px; align-items:center; gap:10px; }
    .cyclone-controls[hidden] { display:none; }
    .cyclone-status { font-size:11.5px; color:var(--muted); }
    .cyclone-status[data-tone="empty"] { color:var(--ink); }
    .cyclone-status[data-tone="error"] { color:#BE2618; font-weight:600; }
    .cyclone-key { display:flex; gap:8px; flex-wrap:wrap; margin-top:7px; }
    .cyclone-key span {
      display:inline-flex; align-items:center; gap:4px; font-size:10.5px; color:var(--muted);
    }
    .cyclone-key i { width:10px; height:10px; border-radius:50%; display:inline-block; }

    .popup-actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:9px; }
    .popup-actions button {
      font-family:inherit; font-size:11px; font-weight:650; color:var(--ink); cursor:pointer;
      background:var(--paper); border:1px solid var(--ink); border-radius:3px; padding:5px 8px;
    }
    .popup-actions button:disabled { opacity:.55; cursor:progress; }
    .popup-note { font-size:10.5px; color:var(--muted); margin-top:7px; line-height:1.45; }
    .popup-note.official { color:#2F7D57; font-weight:600; }
    .shake-scale { display:flex; gap:2px; margin-top:7px; }
    .shake-scale i { flex:1; height:6px; font-style:normal; }
    .sidebar { display:grid; align-content:start; }
    .sec { padding:14px 15px; border-bottom:1px solid var(--hair); }
    .sec:last-child { border-bottom:0; }
    .sec-title {
      display:flex; align-items:baseline; justify-content:space-between; gap:8px;
      font-family:"Barlow Condensed",sans-serif; text-transform:uppercase; letter-spacing:.08em;
      color:var(--muted); font-size:13px; font-weight:600;
    }
    .signal-panel-head { align-items:center; }
    .signal-panel-tools { display:flex; align-items:center; gap:7px; }
    .sort-control { display:flex; align-items:center; gap:5px; white-space:nowrap; }
    .sort-field {
      min-height:30px; max-width:104px; border:1px solid var(--hair); border-radius:3px;
      background:var(--panel); color:var(--ink); padding:0 6px; font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
      font-size:11px; letter-spacing:0; text-transform:none;
    }
    .notable-head { display:block; }
    .notable-head span:last-child { display:block; margin-top:2px; }
    .notable-title { display:block; margin:7px 0 2px; font-size:17px; line-height:1.3; }
    .notable-meta { color:var(--muted); font-size:12px; }
    .scoreline { display:flex; gap:8px; margin-top:9px; flex-wrap:wrap; }
    .score {
      border:1px solid var(--hair); border-radius:3px; padding:4px 8px; font-family:"IBM Plex Mono",monospace; font-size:11px;
    }

    /* Hazard pills. Same visual family as the .score chips on the notable card,
       but these are controls: they toggle, they carry a live count, and they show
       the family colour they filter to. */
    /* Sized for the signal column, which is narrow, so these wrap onto two or
       three rows rather than forcing a horizontal scroll. */
    .hazard-pills { display:flex; gap:5px; flex-wrap:wrap; margin:9px 0 10px; }
    .hz {
      display:inline-flex; align-items:center; gap:4px;
      border:1px solid var(--hair); border-radius:3px; padding:3px 7px;
      font-family:"IBM Plex Mono",monospace; font-size:10.5px;
      background:var(--panel); color:var(--muted); cursor:pointer; line-height:1.25;
    }
    .hz svg { width:11px; height:11px; display:block; flex:0 0 auto; }
    .hz .hz-ico { color:var(--hz,#697B73); }
    .hz .hz-n { font-variant-numeric:tabular-nums; opacity:.7; }
    .hz:hover { border-color:var(--hz,var(--ink)); color:var(--ink); }
    .hz[aria-pressed="true"] {
      color:var(--ink); border-color:var(--hz,var(--ink)); font-weight:600;
      box-shadow:inset 0 0 0 1px var(--hz,var(--ink));
    }
    .hz[data-empty="true"] { opacity:.45; }
    .hz.hz-all { --hz:var(--ink); }
    .signals { display:grid; gap:0; margin-top:5px; }
    .signal {
      width:100%; display:grid; grid-template-columns:7px minmax(0,1fr) auto; gap:9px;
      text-align:left; padding:9px 0; border:0; border-bottom:1px dashed var(--hair);
      background:transparent; color:var(--ink); cursor:pointer; text-decoration:none;
      font:inherit;
      /* stretch, explicitly: the family colour bar is an empty span whose only
         height comes from the grid row stretching. Aligning the row to its start
         instead collapsed the bar to nothing and silently removed the colour
         coding from every signal row. A test pins this. */
      align-items:stretch;
    }
    .alert-notice {
      display:none; margin-top:9px; padding:9px 11px; font-size:12px; line-height:1.45;
      border:1px solid var(--hair); border-left:3px solid #BE2618; border-radius:4px;
      background:var(--panel); color:var(--ink);
    }
    .alert-notice.on { display:block; }
    .alert-notice a { color:var(--ink); }
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
    .leaflet-popup-content { max-height:min(62vh,520px); overflow-y:auto; }
    .popup-title { font-weight:750; line-height:1.3; margin-bottom:6px; }
    .popup-row { font-size:11px; color:var(--muted); margin-top:3px; }
    .popup-row strong { color:var(--ink); }
    .popup-link { display:block; margin-top:8px; font-weight:700; }
    .popup-link.secondary { font-weight:500; font-size:11px; color:var(--muted); margin-top:4px; }
    .popup-detail {
      margin-top:9px; padding:9px 10px; background:var(--paper); border:1px solid var(--hair);
      border-radius:3px; max-height:210px; overflow-y:auto; font-size:11.5px; line-height:1.5;
      white-space:pre-line;
    }
    .popup-detail p { margin:0 0 8px; }
    .popup-detail p:last-child { margin-bottom:0; }
    .detail-headline { font-weight:700; color:var(--ink); }
    .detail-instruction { border-top:1px solid var(--hair); padding-top:7px; }

    .spark-wrap { margin-top:10px; padding-top:9px; border-top:1px solid var(--hair); }
    .spark-head {
      display:flex; justify-content:space-between; align-items:baseline; gap:8px;
      font-family:"Barlow Condensed",sans-serif; text-transform:uppercase; letter-spacing:.07em;
      font-size:11.5px; font-weight:600; color:var(--muted);
    }
    .spark-head .mono { font-size:10px; letter-spacing:.02em; }
    .spark-bars {
      display:flex; align-items:flex-end; gap:1.5px; height:42px; margin-top:6px;
      padding:0 1px; border-bottom:1px solid var(--hair);
    }
    .spark-bar { flex:1; min-width:2px; background:#9BB2C4; border-radius:1px 1px 0 0; }
    .spark-bar.recent { background:#DE5F26; }
    .spark-bar.self { flex:0 0 4px; background:#BE2618; }
    .spark-axis {
      display:flex; justify-content:space-between; margin-top:3px;
      font-family:"IBM Plex Mono",monospace; font-size:9.5px; color:var(--muted);
    }
    .spark-note { margin-top:6px; font-size:10.5px; color:var(--muted); line-height:1.45; }
    .spark-note em { font-style:normal; opacity:.85; }
    body.map-fs { overflow:hidden; }
    .map-card.fs { position:fixed; inset:0; z-index:2000; border:0; border-radius:0; }
    .map-card.fs #map { height:100vh; height:100dvh; }
    .map-card.fs .globe-wrap { height:100vh; height:100dvh; }
    .map-card.fs .maphint { display:none; }
    .fs-btn { font-size:17px; font-weight:700; color:var(--ink); text-decoration:none; cursor:pointer; }
    @media (max-width:920px) {
      .main-grid { grid-template-columns:1fr; }
      #map { height:460px; }
      .globe-wrap { height:460px; }
    }
    @media (max-width:680px) {
      .wrap { padding:15px 12px 42px; }
      .mast { align-items:flex-start; }
      .freshness { text-align:left; }
      .earth-tabs { width:100%; }
      .earth-tabs a { flex:1; justify-content:center; }
      .controls { align-items:stretch; }
      .segmented { width:100%; }
      .segmented button { flex:1; padding:0 7px; }
      .control-actions { width:100%; display:grid; grid-template-columns:1fr 1fr; }
      .control-actions select { grid-column:1 / -1; }
      .signal-panel-head { align-items:flex-start; }
      .signal-panel-tools { align-items:flex-end; flex-direction:column-reverse; gap:4px; }
      .banner { grid-template-columns:1fr; gap:8px; }
      .metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
      #map { height:390px; }
      .globe-wrap { height:390px; }
      .globe-clock { display:none; }
      .metric { min-height:79px; }
    }
    @media (prefers-reduced-motion:no-preference) {
      .dot { animation:pulse 2.4s ease-in-out infinite; }
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }

    /* ── Ambient glow ────────────────────────────────────────────────────────
       A colour-coded edge wash readable from across a dark room with no text.
       Colour = hazard family of the most significant current event (the same
       palette the map legend already teaches). Reach + alpha = how recent and
       how serious. JS only ever sets these three variables.

       Night watch exists because this page is light-only: a near-white page is
       itself a lamp in a dark bedroom, and a subtle glow on white is invisible.
       After a period of no interaction the page dims to near-black so the glow
       becomes the whole signal; any input restores it instantly.
       ──────────────────────────────────────────────────────────────────────── */
    :root {
      --ambient-color:#2F7D57;
      --ambient-alpha:0.08;
      --ambient-reach:4vmin;
    }
    #ambientGlow {
      position:fixed; inset:0; z-index:9998;
      pointer-events:none;
      box-shadow: inset 0 0 var(--ambient-reach) calc(var(--ambient-reach) / 2.5) var(--ambient-color);
      opacity:var(--ambient-alpha);
      transition:opacity 1.6s ease, box-shadow 1.6s ease;
    }
    #ambientScrim {
      position:fixed; inset:0; z-index:9997;
      background:#05070A; opacity:0; pointer-events:none;
      transition:opacity 1.8s ease;
    }
    #ambientReadout {
      position:fixed; left:0; right:0; bottom:9vh; z-index:9999;
      text-align:center; pointer-events:none; opacity:0;
      transition:opacity 1.8s ease;
      font-family:"IBM Plex Mono",ui-monospace,monospace;
      font-size:clamp(11px,1.5vw,15px);
      letter-spacing:.22em; text-transform:uppercase;
      color:var(--ambient-color);
    }
    #ambientToggle {
      position:fixed; right:14px; bottom:14px; z-index:10000;
      background:var(--panel); color:var(--muted);
      border:1px solid var(--hair); border-radius:3px;
      font-family:"IBM Plex Mono",ui-monospace,monospace;
      font-size:10px; letter-spacing:.14em; text-transform:uppercase;
      padding:5px 9px; cursor:pointer; opacity:.55;
      transition:opacity .3s ease, color .3s ease;
    }
    #ambientToggle:hover { opacity:1; color:var(--ink); }
    #ambientToggle[aria-pressed="true"] { color:var(--clear); border-color:var(--clear); }
    html[data-ambient="on"] #ambientScrim { opacity:.955; pointer-events:auto; }
    html[data-ambient="on"] #ambientReadout { opacity:.52; }
    html[data-ambient="on"] #ambientToggle { opacity:.12; }
    @media (prefers-reduced-motion:no-preference) {
      #ambientGlow.ambient-pulse { animation:ambient-breathe 7s ease-in-out infinite; }
    }
    @keyframes ambient-breathe {
      0%,100% { opacity:var(--ambient-alpha); }
      50%     { opacity:calc(var(--ambient-alpha) * 0.42); }
    }
  </style>
</head>
<body>
  <!-- Ambient overlay. Decoration only: aria-hidden, pointer-events:none on the
       glow. The signal feed below carries every fact this conveys. -->
  <div id="ambientScrim" aria-hidden="true"></div>
  <div id="ambientGlow" aria-hidden="true"></div>
  <div id="ambientReadout" aria-hidden="true"></div>
  <button id="ambientToggle" type="button" aria-pressed="false"
          title="Night watch: dim the page after 3 minutes idle so the edge glow reads in a dark room">night watch</button>
  <div class="wrap">
    <header class="mast">
      <div>
        <div class="eyebrow">Official Geohazard Watch</div>
        <h1>Earth Watch</h1>
        <div class="sub">Official-source geology, natural-hazard, and space-weather situational awareness.</div>
      </div>
      <div class="freshness">
        <div><span class="dot" id="liveDot"></span><span id="fresh">Loading official records...</span></div>
        <div class="mono" id="nextCheck" style="margin-top:4px;font-size:11px">15-minute official ingest cadence</div>
      </div>
    </header>

    <nav class="earth-tabs" aria-label="Earth Watch views">
      <a href="/" aria-current="page">Live conditions</a>
      <a href="/visualizations">Visualizations</a>
    </nav>

    <div class="controls">
      <div class="segmented" aria-label="Time window">
        <button type="button" class="active" data-window="now">Now</button>
        <button type="button" data-window="24h">24h</button>
        <button type="button" data-window="7d">7d</button>
        <button type="button" data-window="30d">30d</button>
        <button type="button" data-window="forecast">Forecast</button>
        <button type="button" data-window="all">Everything</button>
      </div>
      <div class="control-actions">
        <select id="sourceFilter" class="field" aria-label="Official source">
          <option value="all">All official sources</option>
          <option value="usgs">USGS</option>
          <option value="nws">NOAA/NWS</option>
          <option value="swpc">NOAA/SWPC</option>
          <option value="nasa">NASA</option>
          <option value="tsunami">NOAA Tsunami</option>
        </select>
        <button type="button" class="pbtn" id="resetFocus">Top activity</button>
        <button type="button" class="pbtn" id="locate">Use my location</button>
      </div>
    </div>


    <div class="controls" style="margin-top:10px">
      <div class="segmented" aria-label="Map projection">
        <button type="button" class="active" data-view="map">Flat map</button>
        <button type="button" data-view="globe">3D globe</button>
      </div>
      <div class="toggles">
        <label class="tgl" for="dayNight"><input type="checkbox" id="dayNight" checked> Day &amp; night</label>
        <label class="tgl" for="antipodeLayer"><input type="checkbox" id="antipodeLayer"> Antipodes</label>
        <label class="tgl" for="cycloneLayer"><input type="checkbox" id="cycloneLayer"> Hurricane tracks</label>
        <label class="tgl" for="tsunamiLayer"><input type="checkbox" id="tsunamiLayer"> Tsunami</label>
        <label class="tgl" for="autoSpin"><input type="checkbox" id="autoSpin" checked> Spin globe</label>
      </div>
    </div>

    <div class="controls cyclone-controls" id="cycloneControls" hidden>
      <select id="cycloneParts" class="field" aria-label="Tropical cyclone layers">
        <option value="all">Track, forecast and cone</option>
        <option value="cone">Forecast cone and warnings only</option>
        <option value="track">Tracks and positions only</option>
        <option value="observed">Observed track only (no forecast)</option>
      </select>
      <span class="cyclone-status" id="cycloneStatus">Loading tropical cyclone advisories&hellip;</span>
      <div class="cyclone-key">
        <span><i style="background:#697B73"></i>Depression</span>
        <span><i style="background:#69A88F"></i>Tropical storm</span>
        <span><i style="background:#D3921F"></i>Cat 1</span>
        <span><i style="background:#DE5F26"></i>Cat 2</span>
        <span><i style="background:#BE2618"></i>Cat 3</span>
        <span><i style="background:#8C1B12"></i>Cat 4</span>
        <span><i style="background:#7A4D91"></i>Cat 5</span>
      </div>
    </div>

    <div class="controls cyclone-controls" id="tsunamiControls" hidden>
      <select id="tsunamiParts" class="field" aria-label="Tsunami layers">
        <option value="all">Active warnings and recorded history</option>
        <option value="live">Active warnings only</option>
        <option value="history">Recorded history only</option>
      </select>
      <span class="cyclone-status" id="tsunamiStatus">Loading tsunami data&hellip;</span>
    </div>

    <section class="intro">
      <p>Use the map to inspect eligible official events, target-region stages, and broader natural-hazard context. The heat layer represents <strong>official signal load</strong>, not the probability of a disaster.</p>
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
      <div class="metric"><div class="value" id="currentCount">-</div><div class="label">Active map signals</div></div>
      <div class="metric"><div class="value" id="quakeCount">-</div><div class="label">Earthquakes in selected window</div></div>
      <div class="metric"><div class="value" id="sourceCount">-</div><div class="label">Official sources healthy</div></div>
      <div class="metric"><div class="value" id="regionCount">-</div><div class="label">Elevated target regions</div></div>
    </section>

    <div class="main-grid">
      <div class="card map-card" id="mapCard">
        <div class="stage" id="stage" data-stage="map">
          <div id="map" role="application" aria-label="Official geohazard map with earthquakes, severe-weather polygons, natural events, aggregate signal heat, configured target regions, and a solar day and night overlay"></div>
          <div class="globe-wrap">
            <canvas id="globe" role="img" aria-label="Rotatable globe showing official geohazard events and the current solar day and night terminator"></canvas>
            <div class="globe-tools">
              <button type="button" id="globeZoomIn" aria-label="Zoom in">+</button>
              <button type="button" id="globeZoomOut" aria-label="Zoom out">&minus;</button>
              <button type="button" id="globeReset">Recentre</button>
              <button type="button" id="globePillars" aria-pressed="true">Pillars</button>
              <button type="button" id="globeFollow" aria-pressed="false">Follow top signal</button>
            </div>
            <div class="globe-clock" id="globeClock"></div>
            <div class="globe-status" id="globeStatus">Loading NASA Blue Marble imagery...</div>
          </div>
        </div>
        <div class="maphint">
          <strong id="mapFocus">Finding the strongest eligible official activity...</strong>
          Select a marker or polygon for official timestamps, notification-gate status, and map-context eligibility. Earthquakes also offer their antipode and a felt-shaking extent. Use the map layer control to separate heat, events, and configured regions.
          <div class="legend">
            <span style="--legend:#347FAC">Earthquake</span>
            <span style="--legend:#BE2618">Severe weather</span>
            <span style="--legend:#DE5F26">Natural event</span>
            <span style="--legend:#7A4D91">Volcano</span>
            <span style="--legend:#2F7D57">Target region</span>
            <span class="ring" style="--legend:#5B6B7C">Antipode</span>
            <span class="ring" style="--legend:#BE2618">Felt shaking</span>
          </div>
          <div class="alert-notice" id="alertNotice"></div>
        </div>
      </div>

      <aside class="card sidebar">
        <section class="sec">
          <div class="sec-title notable-head"><span>Most notable monitored event</span><span id="notablePeriod">-</span></div>
          <div id="notable"><div class="empty">Loading...</div></div>
        </section>
        <section class="sec">
          <div class="sec-title signal-panel-head">
            <span>Signals in selected window</span>
            <span class="signal-panel-tools">
              <label class="sort-control" for="signalSort"><span>Rank</span>
                <select id="signalSort" class="sort-field">
                  <option value="score">Score</option>
                  <option value="lastActive">Last active</option>
                  <option value="magnitude">Magnitude</option>
                </select>
              </label>
              <span class="mono" id="signalCount">0</span>
            </span>
          </div>
          <!-- The pills live with the feed they filter. They were up in the map
               controls, which is off-screen once you have scrolled to the list. -->
          <div class="hazard-pills" id="hazardPills" role="group" aria-label="Filter the feed by hazard family"></div>
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
      <div class="mono">USGS · NOAA/NWS · NOAA/SWPC · NASA · NOAA Tsunami · GeoNames (CC BY 4.0)</div>
    </footer>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js" integrity="sha384-mFKkGiGvT5vo1fEyGCD3hshDdKmW3wzXW/x+fWriYJArD0R3gawT6lMvLboM22c0" crossorigin=""></script>
  <script>
  // Solar geometry, serialised from src/logic/solar.ts so the page and the vitest
  // suite run byte-identical code. Emitted once and shared by both the flat map
  // (classic script, below) and the globe (module script, further down).
  window.__earthSolar = (function() {
    "use strict";
${solarClientSource()}
    return {
      subsolarPoint: subsolarPoint,
      solarElevationDeg: solarElevationDeg,
      nightFraction: nightFraction,
      twilightBand: twilightBand,
      localSolarHour: localSolarHour,
      solarPhaseLabel: solarPhaseLabel,
      geoToVector: geoToVector,
      TWILIGHT_BANDS: TWILIGHT_BANDS
    };
  })();
  </script>
  <script>
  (function() {
    "use strict";
    var solar = window.__earthSolar;
    var state = {
      data:null, window:"now", hazards:[], source:"all", sort:"score",
      layerById:{}, focusApplied:false, view:"map",
      dayNight:true, antipodes:false, spin:true,
      feltEventId:null, feltSource:null, shakeMapCache:{}, sparkCache:{},
      cyclones:false, cycloneParts:"all", cycloneData:null,
      cycloneFetchedAt:0, cycloneState:"idle", cycloneMissing:[],
      tsunami:false, tsunamiParts:"all", tsunamiData:null,
      tsunamiFetchedAt:0, tsunamiState:"idle",
      userMovedMap:false, suppressMoveFlag:false
    };
    try {
      var storedSort = localStorage.getItem("earthWatch.signalSort");
      if (storedSort === "score" || storedSort === "lastActive" || storedSort === "magnitude") {
        state.sort = storedSort;
      }
    } catch (error) {}
    var colors = {
      earthquake:"#347FAC", weather:"#BE2618", natural:"#DE5F26",
      volcano:"#7A4D91", tsunami:"#246B82", space_weather:"#697B73"
    };
    // scrollWheelZoom was off, which made the map feel locked: the wheel is how
    // most people zoom, and with it disabled the only zoom controls were the +/-
    // buttons. The usual argument for disabling it is scroll-jacking on a long
    // page; the map here is a deliberate destination inside its own card and has a
    // full-screen mode, so the trade goes the other way.
    var map = L.map("map", { scrollWheelZoom:true, attributionControl:true }).setView([20,0], 2);
    var topo = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", {
      maxZoom:16, attribution:"USGS The National Map"
    });
    var clean = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom:18, subdomains:"abcd", attribution:"OpenStreetMap and CARTO"
    }).addTo(map);
    var heatLayer = L.layerGroup().addTo(map);
    var eventLayer = L.layerGroup().addTo(map);
    var regionLayer = L.layerGroup().addTo(map);
    var terminatorLayer = L.layerGroup().addTo(map);
    var antipodeLayer = L.layerGroup().addTo(map);
    var feltRingLayer = L.layerGroup().addTo(map);
    // The cone is a separate group from the track on purpose: it is by far the
    // largest geometry on the map and it is the one readers most often misread, so
    // it has to be independently switchable rather than bundled into "storms".
    var cycloneConeLayer = L.layerGroup().addTo(map);
    var cycloneTrackLayer = L.layerGroup().addTo(map);
    // Holds the forecast-zone polygons resolved for a non-spatial alert on demand.
    var alertZoneLayer = L.layerGroup().addTo(map);
    var tsunamiLiveLayer = L.layerGroup().addTo(map);
    var tsunamiHistoryLayer = L.layerGroup().addTo(map);
    L.control.layers(
      {"Global clean map":clean, "USGS US topographic":topo},
      {
        "Aggregate signal heat":heatLayer, "Official events":eventLayer, "Target regions":regionLayer,
        "Day and night":terminatorLayer, "Antipodes":antipodeLayer, "Felt shaking":feltRingLayer,
        "Cyclone forecast cone":cycloneConeLayer, "Cyclone track and positions":cycloneTrackLayer,
        "Alert area":alertZoneLayer,
        "Tsunami warnings (active)":tsunamiLiveLayer, "Tsunami history":tsunamiHistoryLayer
      },
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
    // ─────────────────────────────────────────────────────────────────────────
    // Hazard families
    //
    // These were a single-select dropdown, which could ask for one family or all
    // of them and nothing in between. As pills they are independent toggles, so
    // "earthquakes and volcanoes but not the 672 weather alerts" is now sayable.
    //
    // The icons are stencils rather than emoji: emoji render differently on every
    // platform and carry their own colour, which would fight the family colour
    // these pills exist to show.
    // ─────────────────────────────────────────────────────────────────────────
    var HAZARD_FAMILIES = [
      {key:"earthquake",    label:"Earthquake"},
      {key:"weather",       label:"Severe weather"},
      {key:"volcano",       label:"Volcano"},
      {key:"tsunami",       label:"Tsunami"},
      {key:"natural",       label:"Natural event"},
      {key:"space_weather", label:"Space weather"}
    ];

    function hazardIcon(key) {
      var open = '<svg class="hz-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
      var paths = {
        // A seismogram trace.
        earthquake:'<path d="M1 8h2.2l1.6-4.6L7 12.6l2-7.2 1.5 4.4L12 8h3"/>',
        // Cloud with a bolt through it.
        weather:'<path d="M4.4 11a2.9 2.9 0 0 1 .3-5.8 3.9 3.9 0 0 1 7.4.9A2.6 2.6 0 0 1 12 11"/><path d="M8.6 8.4 6.9 11.6h2.2L7.4 15"/>',
        // Cone with a vent plume.
        volcano:'<path d="M1.6 14h12.8L10.4 6H5.6L1.6 14Z"/><path d="M6.6 6 8 2.2 9.4 6"/><path d="M11.6 3.2 12.8 1.6M4.4 3.2 3.2 1.6"/>',
        // A wave crest over water lines.
        tsunami:'<path d="M1 11.4c2.2-5.6 6-8.2 9.2-6.6 2 1 2.6 3 1.6 4.4-.8 1.1-2.3 1-2.7-.2"/><path d="M1 14.2c1.3 0 1.3-1 2.6-1s1.3 1 2.6 1 1.3-1 2.6-1 1.3 1 2.6 1 1.3-1 2.6-1"/>',
        // A leaf, for the catch-all natural-event family.
        natural:'<path d="M13.6 2.4C7.2 2 3 4.6 3 9.2A4.6 4.6 0 0 0 7.6 13.8c4.6 0 6.4-5 6-11.4Z"/><path d="M2.4 14.4 8 8.8"/>',
        // Sun with flare rays.
        space_weather:'<circle cx="8" cy="8" r="3.1"/><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3.1 3.1l1.3 1.3M11.6 11.6l1.3 1.3M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3"/>',
        // Every family, shown as a stack.
        all:'<path d="M8 1.6 14.6 5 8 8.4 1.4 5 8 1.6Z"/><path d="M1.4 8.4 8 11.8l6.6-3.4"/><path d="M1.4 11.6 8 15l6.6-3.4"/>'
      };
      return open + (paths[key] || paths.all) + "</svg>";
    }

    function hazardSelected(family) {
      // An empty set means everything, which keeps "no filter" and "all families
      // ticked" from being two different states that can drift apart.
      return !state.hazards.length || state.hazards.indexOf(family) !== -1;
    }

    // The family and source test, without the time window. Counting through the
    // same predicate the map uses is what stops a pill's number from disagreeing
    // with what the map draws.
    function passesWindow(event) {
      if (state.window === "all") return true;
      if (state.window === "now") return isActiveMapEvent(event);
      if (state.window === "forecast") return event.status === "forecast";
      var occurredAt = Date.parse(event.eventTime);
      return event.status !== "forecast" && occurredAt >= windowStart() && occurredAt <= Date.now();
    }

    function renderHazardPills() {
      var host = document.getElementById("hazardPills");
      if (!host) return;
      var counts = {};
      var inWindow = 0;
      if (state.data) {
        state.data.map.events.concat(state.data.map.nonSpatialSignals || []).forEach(function(event) {
          if (state.source !== "all" && sourceGroup(event.source) !== state.source) return;
          if (!passesWindow(event)) return;
          inWindow += 1;
          counts[event.family] = (counts[event.family] || 0) + 1;
        });
      }
      var html = '<button type="button" class="hz hz-all" data-hazard="all" aria-pressed="' +
        (state.hazards.length ? "false" : "true") + '">' + hazardIcon("all") +
        '<span>Everything</span><span class="hz-n">' + inWindow + "</span></button>";
      HAZARD_FAMILIES.forEach(function(family) {
        var count = counts[family.key] || 0;
        var on = state.hazards.indexOf(family.key) !== -1;
        html += '<button type="button" class="hz" data-hazard="' + family.key +
          '" style="--hz:' + (colors[family.key] || "#697B73") + '"' +
          ' aria-pressed="' + (on ? "true" : "false") + '"' +
          ' data-empty="' + (count === 0 ? "true" : "false") + '"' +
          ' title="' + esc(family.label) + '">' +
          hazardIcon(family.key) + "<span>" + esc(family.label) +
          '</span><span class="hz-n">' + count + "</span></button>";
      });
      host.innerHTML = html;
      Array.prototype.forEach.call(host.querySelectorAll("[data-hazard]"), function(button) {
        button.addEventListener("click", function() {
          var key = button.getAttribute("data-hazard");
          if (key === "all") {
            state.hazards = [];
          } else {
            var at = state.hazards.indexOf(key);
            if (at === -1) state.hazards.push(key); else state.hazards.splice(at, 1);
          }
          renderMap(); renderContext(); renderHazardPills();
        });
      });
    }

    function selectedEvents() {
      if (!state.data) return [];
      return state.data.map.events.filter(function(event) {
        if (!hazardSelected(event.family)) return false;
        if (state.source !== "all" && sourceGroup(event.source) !== state.source) return false;
        return passesWindow(event);
      });
    }
    function sourceGroup(source) {
      if (source.indexOf("usgs_") === 0) return "usgs";
      if (source === "nws_alerts") return "nws";
      if (source.indexOf("swpc_") === 0) return "swpc";
      if (source.indexOf("nasa_") === 0) return "nasa";
      if (source.indexOf("tsunami_") === 0) return "tsunami";
      return "other";
    }
    function isActiveMapEvent(event) {
      return Boolean(
        event.mapContext &&
        event.mapContext.eligible &&
        (event.family === "earthquake" || event.status === "current")
      );
    }
    function contextWindow(hours) {
      return hours >= 48 && hours % 24 === 0 ? (hours / 24) + "d" : hours + "h";
    }
    function mapContextLabel(event) {
      if (!event.mapContext) return "unavailable";
      if (event.mapContext.result === "magnitude_extended") {
        return "magnitude context (" + contextWindow(event.mapContext.windowHours) + ")";
      }
      return event.mapContext.result + " (" + contextWindow(event.mapContext.windowHours) + ")";
    }
    function popup(event) {
      return '<div class="popup-title">' + esc(event.title) + '</div>' +
        '<div class="popup-row"><strong>Official source:</strong> ' + esc(event.sourceLabel) + '</div>' +
        '<div class="popup-row"><strong>Event time:</strong> ' + esc(fmt(event.eventTime)) + '</div>' +
        '<div class="popup-row"><strong>Source updated:</strong> ' + esc(fmt(event.sourceUpdatedAt)) + '</div>' +
        '<div class="popup-row"><strong>Ingest time:</strong> ' + esc(fmt(event.ingestTime)) + '</div>' +
        '<div class="popup-row"><strong>Region:</strong> ' + esc(event.region || "source-defined / outside configured targets") + '</div>' +
        '<div class="popup-row"><strong>Cascade stage:</strong> ' + esc(event.cascadeStage || "context only") + '</div>' +
        '<div class="popup-row"><strong>Notification stale gate:</strong> ' + esc(event.staleGateResult) + '</div>' +
        (event.staleGateReasons.length ? '<div class="popup-row"><strong>Notification blocked by:</strong> ' + esc(event.staleGateReasons.join(", ")) + '</div>' : '') +
        '<div class="popup-row"><strong>Map context:</strong> ' + esc(mapContextLabel(event)) + '</div>' +
        quakeSizeRows(event) +
        populationRows(event) +
        shakingRows(event) +
        sparklineBlock(event) +
        detailBlock(event) +
        officialLinks(event) +
        quakeActions(event);
    }

    // Some official records are human pages and some are raw machine feeds. Sending
    // a reader to a wall of JSON is not "the official record" in any useful sense,
    // so the agency's own words are rendered inline and the link points somewhere a
    // person can actually read.
    function detailBlock(event) {
      var detail = event.detail;
      if (!detail) return "";
      var rows = "";
      if (detail.issuedBy) {
        rows += '<div class="popup-row"><strong>Issued by:</strong> ' + esc(detail.issuedBy) + '</div>';
      }
      if (detail.expiresAt) {
        rows += '<div class="popup-row"><strong>In effect until:</strong> ' + esc(fmt(detail.expiresAt)) + '</div>';
      }
      var prose = "";
      if (detail.headline) prose += '<p class="detail-headline">' + esc(detail.headline) + '</p>';
      if (detail.summary) prose += '<p>' + esc(detail.summary) + '</p>';
      if (detail.instruction) {
        prose += '<p class="detail-instruction"><strong>What to do:</strong> ' + esc(detail.instruction) + '</p>';
      }
      if (!rows && !prose) return "";
      return rows + (prose ? '<div class="popup-detail">' + prose + '</div>' : "");
    }

    // The human destination per source, chosen because the machine URL is not one.
    function humanDestination(event) {
      var point = pointForGeometry(event.geometry);
      if (event.source === "nws_alerts" && point) {
        // NWS publishes no per-alert page — every alert's own "web" field is the
        // literal string "http://www.weather.gov". Its point-forecast page is the
        // real place: it lists the active hazards for that spot plus the forecast.
        return {
          url:"https://forecast.weather.gov/MapClick.php?lat=" + point[0].toFixed(4) +
            "&lon=" + point[1].toFixed(4),
          label:"NWS forecast and active hazards for this area"
        };
      }
      if (event.source.indexOf("swpc_") === 0) {
        return { url:"https://www.swpc.noaa.gov/products/planetary-k-index", label:"NOAA SWPC space-weather dashboard" };
      }
      if (event.source.indexOf("tsunami_") === 0) {
        return { url:"https://www.tsunami.gov/", label:"NOAA Tsunami Warning Center" };
      }
      // Last resort, and the one that rescues EONET: an aggregating feed whose own
      // link is an API document usually names the issuing agency's real page. This
      // is deliberately source-agnostic — any feed that starts carrying sources
      // gets a readable destination without another branch being added here.
      var agency = (event.detail && event.detail.sourceLinks || [])[0];
      if (agency && agency.url) {
        // No esc() here: every consumer of this label escapes it, and escaping
        // twice would render the entities literally.
        return { url:agency.url, label:agency.id + " page for this event" };
      }
      return null;
    }

    // Anywhere a bare title or row is a link, it must land somewhere readable.
    function readableLink(event) {
      var human = humanDestination(event);
      // Both branches go through safeUrl so every href on the page is checked in
      // one place, even the ones this file builds itself.
      return safeUrl(human ? human.url : event.officialUrl);
    }

    function officialLinks(event) {
      var human = humanDestination(event);
      var raw = safeUrl(event.officialUrl);
      var links = "";
      if (human) {
        links += '<a class="popup-link" href="' + esc(safeUrl(human.url)) + '" target="_blank" rel="noopener">' +
          esc(human.label) + '</a>';
        // Kept, but labelled for what it is rather than promoted as the record.
        if (raw !== "#") {
          links += '<a class="popup-link secondary" href="' + esc(raw) + '" target="_blank" rel="noopener">' +
            'Raw ' + esc(event.sourceLabel) + ' record (JSON)</a>';
        }
        return links;
      }
      return '<a class="popup-link" href="' + esc(raw) + '" target="_blank" rel="noopener">Open official record</a>';
    }

    function formatNumber(value) {
      return Number(value).toLocaleString("en-US");
    }

    // Magnitude and depth together. A shallow M6 does far more at the surface than
    // a deep M7, so the two numbers only mean something side by side.
    function quakeSizeRows(event) {
      if (event.family !== "earthquake") return "";
      var rows = "";
      if (Number.isFinite(event.magnitude)) {
        rows += '<div class="popup-row"><strong>Magnitude:</strong> M' +
          esc(Number(event.magnitude).toFixed(1)) + '</div>';
      }
      if (Number.isFinite(event.depthKm)) {
        var depth = Number(event.depthKm);
        var band = depth < 70 ? "shallow" : depth < 300 ? "intermediate" : "deep";
        rows += '<div class="popup-row"><strong>Depth:</strong> ' +
          esc(depth < 10 ? depth.toFixed(1) : String(Math.round(depth))) + ' km (' + band + ')' +
          '</div>';
      }
      return rows;
    }

    // The reference point a magnitude does not give you.
    function populationRows(event) {
      var population = event.population;
      if (!population) return "";
      var rows = "";
      if (population.nearest) {
        rows += '<div class="popup-row"><strong>Nearest town:</strong> ' + cityPhrase(population.nearest) + '</div>';
      }
      if (population.major) {
        rows += '<div class="popup-row"><strong>Nearest major population:</strong> ' + cityPhrase(population.major) + '</div>';
      }
      return rows;
    }

    function cityPhrase(city) {
      return esc(city.name) + ', ' + esc(city.country) +
        ' &mdash; pop. ' + esc(formatNumber(city.population)) +
        ', ' + esc(formatNumber(city.distanceKm)) + ' km ' + esc(city.bearing);
    }

    // ---- Foreshock / swarm sparkline ----------------------------------------
    // Built from a fresh USGS catalogue query rather than from the events already on
    // this map: the map payload is a scored, capped selection, so counting it would
    // under-report activity and could show a flat run-up where there was a swarm.
    var SPARK_WINDOW_DAYS = 90;
    var SPARK_RADIUS_KM = 300;
    var SPARK_MIN_MAGNITUDE = 2.5;
    var SPARK_BUCKETS = 30;

    function sparklineBlock(event) {
      if (event.family !== "earthquake") return "";
      var point = pointForGeometry(event.geometry);
      if (!point) return "";
      var entry = state.sparkCache[event.id];
      if (!entry) {
        return '<div class="spark-wrap" data-spark-for="' + esc(event.id) + '">' +
          '<div class="spark-head"><span>Seismic run-up</span><span class="mono">loading</span></div>' +
          '<div class="spark-note">Querying the USGS catalogue for the ' + SPARK_WINDOW_DAYS +
          ' days before this event, within ' + SPARK_RADIUS_KM + ' km...</div></div>';
      }
      if (entry.error) {
        return '<div class="spark-wrap"><div class="spark-head"><span>Seismic run-up</span></div>' +
          '<div class="spark-note">USGS catalogue unavailable (' + esc(entry.error) + '). ' +
          'No run-up is shown rather than an empty chart that would read as quiet.</div></div>';
      }
      return renderSpark(event, entry);
    }

    function renderSpark(event, entry) {
      var quakes = entry.quakes;
      var eventTime = Date.parse(event.eventTime);
      var start = eventTime - SPARK_WINDOW_DAYS * 86400000;
      var buckets = [];
      for (var i = 0; i < SPARK_BUCKETS; i += 1) buckets.push({ count:0, maxMag:0 });
      quakes.forEach(function(quake) {
        var index = Math.floor(((quake.time - start) / (eventTime - start)) * SPARK_BUCKETS);
        if (index < 0 || index >= SPARK_BUCKETS) return;
        buckets[index].count += 1;
        if (quake.mag > buckets[index].maxMag) buckets[index].maxMag = quake.mag;
      });
      var peak = Math.max(1, Math.max.apply(null, buckets.map(function(b){ return b.maxMag; })));
      var bars = buckets.map(function(bucket, index) {
        var height = bucket.count ? Math.max(9, Math.round((bucket.maxMag / peak) * 100)) : 0;
        var recent = index >= SPARK_BUCKETS - 3;
        return '<span class="spark-bar' + (recent ? ' recent' : '') + '" style="height:' + height + '%" ' +
          'title="' + esc(bucket.count + (bucket.count === 1 ? " quake" : " quakes") +
            (bucket.maxMag ? ", strongest M" + bucket.maxMag.toFixed(1) : "")) + '"></span>';
      }).join("");

      var strongest = quakes.reduce(function(best, quake) {
        return quake.mag > (best ? best.mag : -Infinity) ? quake : best;
      }, null);
      var summary = quakes.length
        ? formatNumber(quakes.length) + ' quakes M' + SPARK_MIN_MAGNITUDE + '+ within ' +
          SPARK_RADIUS_KM + ' km in the ' + SPARK_WINDOW_DAYS + ' days before' +
          (strongest ? ', strongest M' + strongest.mag.toFixed(1) : '')
        : 'No catalogued quakes M' + SPARK_MIN_MAGNITUDE + '+ within ' + SPARK_RADIUS_KM +
          ' km in the ' + SPARK_WINDOW_DAYS + ' days before';

      return '<div class="spark-wrap">' +
        '<div class="spark-head"><span>Seismic run-up</span>' +
        '<span class="mono">' + SPARK_WINDOW_DAYS + 'd &middot; ' + SPARK_RADIUS_KM + 'km</span></div>' +
        '<div class="spark-bars" role="img" aria-label="' + esc(summary) + '">' + bars +
        '<span class="spark-bar self" style="height:100%" title="' + esc("This event, M" + Number(event.magnitude || 0).toFixed(1)) + '"></span></div>' +
        '<div class="spark-axis"><span>' + SPARK_WINDOW_DAYS + ' days before</span><span>this event</span></div>' +
        '<div class="spark-note">' + esc(summary) + '. Bar height is the strongest magnitude in that ' +
        'interval, not the count. ' +
        '<em>A sparse chart can mean a quiet region or a sparse network &mdash; detection differs by country, ' +
        'so read the shape here, not across regions.</em></div>' +
        '</div>';
    }

    async function loadSparkline(event) {
      var point = pointForGeometry(event.geometry);
      if (!point) return;
      var eventTime = Date.parse(event.eventTime);
      var start = new Date(eventTime - SPARK_WINDOW_DAYS * 86400000).toISOString();
      var end = new Date(eventTime).toISOString();
      var url = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
        "&latitude=" + point[0].toFixed(4) + "&longitude=" + point[1].toFixed(4) +
        "&maxradiuskm=" + SPARK_RADIUS_KM +
        "&starttime=" + encodeURIComponent(start) + "&endtime=" + encodeURIComponent(end) +
        "&minmagnitude=" + SPARK_MIN_MAGNITUDE + "&orderby=time&limit=2000";
      try {
        var response = await fetch(url);
        if (!response.ok) throw new Error("HTTP " + response.status);
        var data = await response.json();
        var quakes = (data.features || []).map(function(feature) {
          return { time:Number(feature.properties.time), mag:Number(feature.properties.mag) };
        }).filter(function(quake) {
          // Drop the event itself and anything without a usable magnitude; the
          // event gets its own highlighted bar at the right-hand end.
          return Number.isFinite(quake.time) && Number.isFinite(quake.mag) && quake.time < eventTime;
        });
        state.sparkCache[event.id] = { quakes:quakes };
      } catch (error) {
        state.sparkCache[event.id] = { error:(error && error.message) ? error.message : String(error) };
      }
      refreshOpenPopup();
    }

    function shakingRows(event) {
      var shaking = event.shaking;
      if (!shaking) return "";
      var rows = "";
      // Absent is not zero. USGS sends no "felt" value at all on most events, and
      // saying "0 people reported feeling it" would be a claim we cannot make.
      if (shaking.feltReports !== undefined) {
        rows += '<div class="popup-row"><strong>Felt reports:</strong> ' + esc(shaking.feltReports) +
          ' submitted to USGS &ldquo;Did You Feel It?&rdquo;</div>';
      }
      if (shaking.reportedIntensity !== undefined) {
        rows += '<div class="popup-row"><strong>Strongest reported shaking:</strong> ' +
          esc(intensityLabel(shaking.reportedIntensity)) + ' (' + esc(shaking.reportedIntensity) + ')</div>';
      }
      if (shaking.instrumentalIntensity !== undefined) {
        rows += '<div class="popup-row"><strong>Strongest instrumental shaking:</strong> ' +
          esc(intensityLabel(shaking.instrumentalIntensity)) + ' (' + esc(shaking.instrumentalIntensity) + ')</div>';
      }
      if (shaking.pagerAlert) {
        rows += '<div class="popup-row"><strong>USGS PAGER alert:</strong> ' + esc(shaking.pagerAlert) + '</div>';
      }
      if (!rows && event.family === "earthquake") {
        rows = '<div class="popup-row"><strong>Felt reports:</strong> none received by USGS</div>';
      }
      return rows;
    }

    function quakeActions(event) {
      if (event.family !== "earthquake") return "";
      var buttons = "";
      if (event.antipode) {
        buttons += '<button type="button" data-earth-action="antipode" data-earth-id="' +
          esc(event.id) + '">Go to antipode</button>';
      }
      if ((event.feltRings && event.feltRings.length) || (event.shaking && event.shaking.hasShakeMap)) {
        buttons += '<button type="button" data-earth-action="felt" data-earth-id="' + esc(event.id) + '"' +
          (state.feltSource === "loading" && state.feltEventId === event.id ? " disabled" : "") +
          '>' + esc(feltButtonLabel(event)) + '</button>';
      }
      if (!buttons) return "";
      var note = "";
      if (state.feltEventId === event.id) {
        if (state.feltSource === "official") {
          note = '<div class="popup-note official">Showing official USGS ShakeMap contours.</div>';
        } else if (state.feltSource === "loading") {
          note = '<div class="popup-note">Checking USGS for a published ShakeMap...</div>';
        } else {
          var cached = state.shakeMapCache[event.id];
          note = '<div class="popup-note">Showing a modeled point-source estimate' +
            (cached && cached.reason ? ' — no official ShakeMap available (' + esc(cached.reason) + ')' : '') +
            '. Large ruptures are felt farther along strike than these circles show.</div>';
        }
      }
      return '<div class="popup-actions">' + buttons + '</div>' + note;
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
        var opacity = event.mapContext && event.mapContext.eligible ? 0.78 : 0.28;
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
        layer.bindPopup(function() { return popup(event); });
        layer._earthEventId = event.id;
        layer.addTo(eventLayer);
        state.layerById[event.id] = layer;
        var heatPoint = pointForGeometry(event.geometry);
        if (heatPoint && isActiveMapEvent(event)) {
          heat.push([heatPoint[0],heatPoint[1],Math.max(.15,event.score/100)]);
        }
      });
      if (heat.length && typeof L.heatLayer === "function") {
        L.heatLayer(heat,{radius:32,blur:24,maxZoom:8,minOpacity:.24,gradient:{.2:"#69A88F",.5:"#D3921F",.75:"#DE5F26",1:"#BE2618"}}).addTo(heatLayer);
      }
      renderSignals(events);
      renderAntipodes();
      renderFeltRings();
      pushGlobe(events);
      document.getElementById("quakeCount").textContent = String(events.filter(function(event){return event.family === "earthquake";}).length);
    }
    // ---- Day and night -------------------------------------------------------
    // Drawn as four nested bands rather than one hard edge, so the reader can see
    // where it is morning, day, evening and night at a glance. Each band is the set
    // of points whose solar elevation is below that band's floor; sampling longitude
    // at a fixed step and solving latitude at each step traces its boundary.
    var TERMINATOR_BANDS = [
      { floor:0,   fill:"#0B1B2B", opacity:.13, label:"Civil twilight — sunrise and sunset" },
      { floor:-6,  fill:"#0B1B2B", opacity:.13, label:"Nautical twilight — dusk and dawn" },
      { floor:-12, fill:"#0B1B2B", opacity:.13, label:"Astronomical twilight" },
      { floor:-18, fill:"#0B1B2B", opacity:.13, label:"Night" }
    ];

    function terminatorLatitude(lon, sun, elevationDeg) {
      // Solve sin(elev) = sin(lat)sin(dec) + cos(lat)cos(dec)cos(dlon) for lat.
      // Written as A*sin(lat) + B*cos(lat) = C, i.e. hypot*sin(lat + atan2(B,A)) = C.
      var rad = Math.PI / 180;
      var a = Math.sin(sun.lat * rad);
      var b = Math.cos(sun.lat * rad) * Math.cos((lon - sun.lon) * rad);
      var c = Math.sin(elevationDeg * rad);
      var magnitude = Math.hypot(a, b);
      if (magnitude < 1e-12) return null;
      var ratio = c / magnitude;
      if (ratio < -1 || ratio > 1) return null;
      return (Math.asin(ratio) - Math.atan2(b, a)) / rad;
    }

    function darkPolygonFor(sun, elevationDeg) {
      // Walk the whole world in longitude collecting the boundary latitude, then
      // close the ring along whichever pole is currently in darkness.
      var step = 2;
      var edge = [];
      var missing = 0;
      for (var lon = -180; lon <= 180; lon += step) {
        var lat = terminatorLatitude(lon, sun, elevationDeg);
        if (lat === null) { missing += 1; continue; }
        edge.push([Math.max(-90, Math.min(90, lat)), lon]);
      }
      // Polar day or polar night: the boundary never crosses this longitude band, so
      // either the whole world is lit or the whole world is dark at this elevation.
      if (edge.length < 3) {
        var everywhereDark = solar.solarElevationDeg(0, sun.lon, sun) < elevationDeg &&
          solar.solarElevationDeg(90, sun.lon, sun) < elevationDeg &&
          solar.solarElevationDeg(-90, sun.lon, sun) < elevationDeg;
        return everywhereDark ? [[90,-180],[90,180],[-90,180],[-90,-180]] : null;
      }
      var darkPole = sun.lat >= 0 ? -90 : 90;
      var ring = edge.slice();
      ring.push([darkPole, 180]);
      ring.push([darkPole, -180]);
      return ring;
    }

    function renderTerminator() {
      terminatorLayer.clearLayers();
      if (!state.dayNight) return;
      var sun = solar.subsolarPoint(new Date());
      TERMINATOR_BANDS.forEach(function(band) {
        var ring = darkPolygonFor(sun, band.floor);
        if (!ring) return;
        L.polygon(ring, {
          stroke:false, fill:true, fillColor:band.fill, fillOpacity:band.opacity,
          interactive:false, className:"terminator-band"
        }).addTo(terminatorLayer);
      });
      // A small marker for the subsolar point makes the overlay legible as solar
      // geometry rather than an unexplained shadow.
      L.circleMarker([sun.lat, sun.lon], {
        radius:5, color:"#B8860B", weight:2, fillColor:"#FFD34D", fillOpacity:.9, interactive:true
      }).bindPopup(
        '<div class="popup-title">Sun overhead</div>' +
        '<div class="popup-row">' + esc(sun.lat.toFixed(2)) + '&deg;, ' + esc(sun.lon.toFixed(2)) + '&deg;</div>' +
        '<div class="popup-row">It is solar noon on this meridian right now.</div>'
      ).addTo(terminatorLayer);
    }

    // ---- Antipodes -----------------------------------------------------------
    function renderAntipodes() {
      antipodeLayer.clearLayers();
      if (!state.antipodes) return;
      selectedEvents().forEach(function(event) {
        if (event.family !== "earthquake" || !event.antipode) return;
        addAntipodeMarker(event);
      });
    }

    function addAntipodeMarker(event) {
      var point = pointForGeometry(event.geometry);
      if (!point || !event.antipode) return null;
      var marker = L.circleMarker(event.antipode, {
        radius:5, color:"#5B6B7C", weight:2, dashArray:"3 2",
        fillColor:"#5B6B7C", fillOpacity:.18
      }).bindPopup(
        '<div class="popup-title">Antipode of ' + esc(event.title) + '</div>' +
        '<div class="popup-row"><strong>Epicentre:</strong> ' + esc(point[0].toFixed(2)) + '&deg;, ' + esc(point[1].toFixed(2)) + '&deg;</div>' +
        '<div class="popup-row"><strong>Antipode:</strong> ' + esc(event.antipode[0].toFixed(2)) + '&deg;, ' + esc(event.antipode[1].toFixed(2)) + '&deg;</div>' +
        '<div class="popup-note">The point directly opposite through the centre of the Earth, about 20,000 km away. Shown as geometry only — no official source claims a relationship between an earthquake and its antipode.</div>'
      );
      marker.addTo(antipodeLayer);
      return marker;
    }

    function showAntipode(eventId) {
      var event = (state.data ? state.data.map.events : []).find(function(candidate) {
        return candidate.id === eventId;
      });
      if (!event || !event.antipode) return;
      if (!map.hasLayer(antipodeLayer)) map.addLayer(antipodeLayer);
      var marker = addAntipodeMarker(event);
      map.setView(event.antipode, Math.max(map.getZoom(), 3));
      if (marker) marker.openPopup();
    }

    // ---- Felt shaking --------------------------------------------------------
    function intensityLabel(value) {
      var numerals = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
      var index = Math.round(value) - 1;
      return numerals[Math.max(0, Math.min(numerals.length - 1, index))];
    }

    function renderFeltRings() {
      feltRingLayer.clearLayers();
      if (!state.feltEventId || !state.data) return;
      var event = state.data.map.events.find(function(candidate) {
        return candidate.id === state.feltEventId;
      });
      if (!event) return;
      var point = pointForGeometry(event.geometry);
      if (!point) return;

      var official = state.shakeMapCache[event.id];
      if (official && official.contours) {
        // Official contours win whenever USGS has published a ShakeMap: they carry
        // the finite fault, directivity and site response that a circle cannot.
        L.geoJSON(official.contours, {
          style:function(feature) {
            return {
              color:(feature.properties && feature.properties.color) || "#BE2618",
              weight:2, opacity:.95, fill:false
            };
          },
          onEachFeature:function(feature, layer) {
            var value = feature.properties && feature.properties.value;
            layer.bindPopup(
              '<div class="popup-title">Shaking intensity ' + esc(intensityLabel(value)) + '</div>' +
              '<div class="popup-row">USGS ShakeMap contour, MMI ' + esc(value) + '</div>' +
              '<div class="popup-note official">Official USGS product — observed and modeled by the issuing agency.</div>'
            );
          },
          interactive:true
        }).addTo(feltRingLayer);
        return;
      }

      (event.feltRings || []).forEach(function(ring) {
        L.circle(point, {
          radius:ring.radiusKm * 1000, color:ring.color, weight:1.5, opacity:.9,
          dashArray:"6 4", fillColor:ring.color, fillOpacity:.05
        }).bindPopup(
          '<div class="popup-title">Modeled intensity ' + esc(ring.numeral) + '</div>' +
          '<div class="popup-row"><strong>' + esc(ring.shaking) + '</strong></div>' +
          '<div class="popup-row">About ' + esc(Math.round(ring.radiusKm)) + ' km from the epicentre' +
            (ring.clamped ? ' (at the edge of the model&rsquo;s published range)' : '') + '</div>' +
          '<div class="popup-note">Projection, not an observation. Point-source estimate from Atkinson &amp; Wald (2007); a long rupture is felt considerably farther along its strike than this circle shows.</div>'
        ).addTo(feltRingLayer);
      });
    }

    function feltButtonLabel(event) {
      if (state.feltEventId !== event.id) return "Felt radius";
      if (state.feltSource === "loading") return "Loading USGS ShakeMap...";
      return "Hide felt radius";
    }

    function toggleFelt(eventId) {
      if (state.feltEventId === eventId) {
        state.feltEventId = null;
        state.feltSource = null;
        renderFeltRings();
        refreshOpenPopup();
        return;
      }
      state.feltEventId = eventId;
      if (!map.hasLayer(feltRingLayer)) map.addLayer(feltRingLayer);
      var event = state.data.map.events.find(function(candidate) { return candidate.id === eventId; });
      if (!event) return;
      var cached = state.shakeMapCache[eventId];
      state.feltSource = cached ? (cached.contours ? "official" : "modeled")
        : (event.shaking && event.shaking.hasShakeMap ? "loading" : "modeled");
      renderFeltRings();
      refreshOpenPopup();
      if (!cached && event.shaking && event.shaking.hasShakeMap) {
        loadShakeMap(event);
      }
    }

    async function loadShakeMap(event) {
      // Two hops, both CORS-open on earthquake.usgs.gov: the event record names the
      // versioned product URL, and that product is the MMI contour GeoJSON. Any
      // failure falls back to the model rather than blanking the panel — but it is
      // recorded as a failure so the label never claims official data it does not have.
      var eventId = event.shaking && event.shaking.usgsEventId;
      if (!eventId) { markShakeMapUnavailable(event, "no USGS event id"); return; }
      try {
        var detail = await fetch(
          "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=" +
          encodeURIComponent(eventId)
        );
        if (!detail.ok) throw new Error("USGS event query returned HTTP " + detail.status);
        var record = await detail.json();
        var products = record && record.properties && record.properties.products;
        var shakemap = products && products.shakemap && products.shakemap[0];
        var contents = shakemap && shakemap.contents;
        var entry = contents && (contents["download/cont_mmi.json"] || contents["download/cont_mi.json"]);
        if (!entry || !entry.url) throw new Error("no MMI contour product published");
        var contourResponse = await fetch(entry.url);
        if (!contourResponse.ok) throw new Error("contour fetch returned HTTP " + contourResponse.status);
        var contours = await contourResponse.json();
        if (!contours || !contours.features || !contours.features.length) {
          throw new Error("contour product was empty");
        }
        state.shakeMapCache[event.id] = { contours:contours };
        if (state.feltEventId === event.id) {
          state.feltSource = "official";
          renderFeltRings();
          refreshOpenPopup();
        }
      } catch (error) {
        markShakeMapUnavailable(event, error && error.message ? error.message : String(error));
      }
    }

    function markShakeMapUnavailable(event, reason) {
      state.shakeMapCache[event.id] = { contours:null, reason:reason };
      if (state.feltEventId !== event.id) return;
      state.feltSource = "modeled";
      renderFeltRings();
      refreshOpenPopup();
    }

    function refreshOpenPopup() {
      var layer = state.layerById[state.feltEventId] || null;
      var openPopup = map._popup;
      if (!openPopup || !openPopup.isOpen()) return;
      var target = openPopup._source;
      if (!target || !target._earthEventId) return;
      var event = state.data.map.events.find(function(candidate) {
        return candidate.id === target._earthEventId;
      });
      if (!event) return;
      openPopup.setContent(popup(event));
      if (layer) { /* keep the reference used by callers above */ }
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
      var rankedEvents = sortSignals(events);
      // The cap used to be 12 with nothing said about it, so the header could
      // read 740 while the list showed a dozen rows and looked complete. It is
      // higher now, and when it does bite it says so.
      var SIGNAL_CAP = 100;
      container.innerHTML = rankedEvents.slice(0,SIGNAL_CAP).map(function(event) {
        var color = colors[event.family] || "#697B73";
        return '<button class="signal" type="button" data-event-id="' + esc(event.id) + '" title="' + esc(signalTooltip(event)) + '">' +
          '<span class="signal-bar" style="--signal:' + color + '"></span>' +
          '<span><span class="signal-name">' + esc(event.title) + '</span><span class="signal-meta">' + esc(event.sourceLabel) + quakeDetails(event) + ' · ' + esc(relative(event.eventTime)) + ' · map ' + esc(mapContextLabel(event)) + ' · alert gate ' + esc(event.staleGateResult) + '</span></span>' +
          '<span class="signal-score">' + esc(event.score) + '</span></button>';
      }).join("") + (rankedEvents.length > SIGNAL_CAP
        ? '<div class="empty">Showing the top ' + SIGNAL_CAP + ' of ' + rankedEvents.length +
          ' signals in this view. Narrow it with the hazard pills or a shorter window.</div>'
        : "");
      Array.prototype.forEach.call(container.querySelectorAll("[data-event-id]"),function(button) {
        button.addEventListener("click",function() {
          var event = rankedEvents.find(function(candidate){ return candidate.id === button.getAttribute("data-event-id"); });
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
    function sortSignals(events) {
      return events.slice().sort(function(left,right) {
        if (state.sort === "lastActive") {
          return Date.parse(right.eventTime) - Date.parse(left.eventTime) ||
            Date.parse(right.sourceUpdatedAt) - Date.parse(left.sourceUpdatedAt) ||
            right.score - left.score ||
            left.id.localeCompare(right.id);
        }
        if (state.sort === "magnitude") {
          var leftMagnitude = Number.isFinite(left.magnitude) ? left.magnitude : -Infinity;
          var rightMagnitude = Number.isFinite(right.magnitude) ? right.magnitude : -Infinity;
          return rightMagnitude - leftMagnitude ||
            right.score - left.score ||
            Date.parse(right.eventTime) - Date.parse(left.eventTime) ||
            left.id.localeCompare(right.id);
        }
        return right.score - left.score ||
          Date.parse(right.eventTime) - Date.parse(left.eventTime) ||
          Date.parse(right.sourceUpdatedAt) - Date.parse(left.sourceUpdatedAt) ||
          left.id.localeCompare(right.id);
      });
    }
    function quakeDetails(event) {
      if (event.family !== "earthquake") return "";
      var details = [];
      if (Number.isFinite(event.magnitude)) details.push("M" + Number(event.magnitude).toFixed(1));
      if (Number.isFinite(event.depthKm)) {
        var depth = Number(event.depthKm);
        details.push((depth < 10 ? depth.toFixed(1) : Math.round(depth)) + " km depth");
      }
      return details.length ? " · " + esc(details.join(" · ")) : "";
    }
    function signalTooltip(event) {
      return "Event time: " + fmt(event.eventTime) + " (" + event.eventTime + ")" +
        " | Source updated: " + fmt(event.sourceUpdatedAt) + " (" + event.sourceUpdatedAt + ")";
    }
    function renderContext() {
      var items = sortSignals(state.data.map.nonSpatialSignals.filter(function(event) {
        if (!hazardSelected(event.family)) return false;
        if (state.source !== "all" && sourceGroup(event.source) !== state.source) return false;
        return passesWindow(event);
      }));
      document.getElementById("contextCount").textContent = String(items.length);
      // These rows used to be anchors straight to event.officialUrl. For an NWS
      // alert that is the raw JSON API document, and this list is by definition the
      // events with no geometry, so humanDestination() — which needs a point —
      // always returned null for exactly the rows that most needed it. The fix is
      // not a better link: it is to go and get the geometry the alert references.
      var CONTEXT_CAP = 8;
      document.getElementById("contextSignals").innerHTML = items.length ? items.slice(0,CONTEXT_CAP).map(function(event) {
        var color = colors[event.family] || "#697B73";
        return '<button type="button" class="signal" data-context-id="' + esc(event.id) + '">' +
          '<span class="signal-bar" style="--signal:' + color + '"></span>' +
          '<span><span class="signal-name">' + esc(event.title) + '</span><span class="signal-meta">' + esc(event.sourceLabel) + ' · ' + esc(relative(event.eventTime)) + ' · map ' + esc(mapContextLabel(event)) + ' · alert gate ' + esc(event.staleGateResult) + '</span></span>' +
          '<span class="signal-score">' + esc(event.score) + '</span></button>';
      }).join("") + (items.length > CONTEXT_CAP
        ? '<div class="empty">Showing ' + CONTEXT_CAP + ' of ' + items.length + '.</div>'
        : "") : '<div class="empty">No non-spatial signal in this view.</div>';
      Array.prototype.forEach.call(
        document.getElementById("contextSignals").querySelectorAll("[data-context-id]"),
        function(button) {
          button.addEventListener("click", function() {
            showNonSpatialOnMap(button.getAttribute("data-context-id"));
          });
        }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Putting a non-spatial alert on the map
    //
    // An NWS alert with geometry:null still says WHERE it applies — as a list of
    // forecast-zone URLs. Resolving those gives real polygons, so "no geometry"
    // turns out to mean "geometry one request away" rather than "unknown place".
    // ─────────────────────────────────────────────────────────────────────────
    function nonSpatialById(id) {
      if (!state.data) return null;
      var list = state.data.map.nonSpatialSignals || [];
      for (var index = 0; index < list.length; index += 1) {
        if (list[index].id === id) return list[index];
      }
      return null;
    }

    async function showNonSpatialOnMap(id) {
      var event = nonSpatialById(id);
      if (!event) return;
      if (state.view !== "map") setView("map");
      alertZoneLayer.clearLayers();

      var detail = event.detail || {};
      var zones = detail.zones || [];
      if (!zones.length) {
        // Nothing to draw. Say why, and hand over the best human page there is
        // rather than silently doing nothing or dumping the reader into JSON.
        showAlertNotice(event, "This alert names no forecast zone, so there is no boundary to draw for it. " +
          "The agency describes its area only as text.");
        return;
      }

      showAlertNotice(event, "Resolving " + zones.length + " forecast " +
        (zones.length === 1 ? "zone" : "zones") + " from the National Weather Service...");

      var results = await Promise.all(zones.map(function(url) {
        return fetch(url, {headers:{accept:"application/geo+json"}})
          .then(function(response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
          })
          .then(function(payload) { return payload && payload.geometry ? payload : null; })
          .catch(function() { return null; });
      }));

      var drawn = 0;
      var bounds = null;
      results.forEach(function(zone) {
        if (!zone || !zone.geometry) return;
        var layer = L.geoJSON(zone, {
          style:function() {
            return {color:"#BE2618", weight:2, opacity:.95, fillColor:"#BE2618", fillOpacity:.12};
          }
        });
        layer.bindPopup(alertPopup(event, zone));
        layer.addTo(alertZoneLayer);
        drawn += 1;
        bounds = bounds ? bounds.extend(layer.getBounds()) : layer.getBounds();
      });

      if (!drawn || !bounds || !bounds.isValid()) {
        // The zones were named but could not be fetched. That is a failed request,
        // and it must not read as "this alert has no location".
        showAlertNotice(event, "The National Weather Service did not return a boundary for " +
          (zones.length === 1 ? "this zone" : "these zones") + ". The alert does have a location; " +
          "this request for it failed.");
        return;
      }

      if (!map.hasLayer(alertZoneLayer)) map.addLayer(alertZoneLayer);
      map.fitBounds(bounds.pad(0.15));
      var missing = zones.length - drawn;
      showAlertNotice(event, "Showing " + drawn + " of " + zones.length + " forecast " +
        (zones.length === 1 ? "zone" : "zones") + " for this alert." +
        (missing > 0 ? " " + missing + " did not resolve." : ""));
    }

    function alertPopup(event, zone) {
      var detail = event.detail || {};
      var zoneName = zone && zone.properties && zone.properties.name;
      var human = humanDestination(event);
      var raw = safeUrl(event.officialUrl);
      var links = "";
      if (human) {
        links += '<a class="popup-link" href="' + esc(safeUrl(human.url)) + '" target="_blank" rel="noopener">' +
          esc(human.label) + "</a>";
      }
      if (raw !== "#") {
        links += '<a class="popup-link secondary" href="' + esc(raw) + '" target="_blank" rel="noopener">' +
          "Raw " + esc(event.sourceLabel) + " record (JSON)</a>";
      }
      return '<div class="popup-title">' + esc(event.title) + "</div>" +
        (zoneName ? '<div class="popup-row"><strong>Zone:</strong> ' + esc(zoneName) + "</div>" : "") +
        (detail.issuedBy ? '<div class="popup-row">Issued by ' + esc(detail.issuedBy) + "</div>" : "") +
        (detail.headline ? '<div class="popup-row">' + esc(detail.headline) + "</div>" : "") +
        (detail.instruction ? '<div class="popup-row"><strong>Instruction:</strong> ' + esc(detail.instruction) + "</div>" : "") +
        '<div class="popup-note">This boundary is the forecast zone the alert names, not a measured ' +
          "footprint of the hazard. The alert itself carried no geometry.</div>" +
        (links ? '<div class="popup-actions">' + links + "</div>" : "");
    }

    function showAlertNotice(event, message) {
      var element = document.getElementById("alertNotice");
      if (!element) return;
      var human = humanDestination(event);
      element.innerHTML = '<strong>' + esc(event.title) + "</strong> &mdash; " + esc(message) +
        (human ? ' <a href="' + esc(safeUrl(human.url)) + '" target="_blank" rel="noopener">' +
          esc(human.label) + "</a>" : "");
      element.classList.add("on");
    }
    function renderNotable() {
      var item = state.data.notableEvent;
      if (!item) {
        document.getElementById("notable").innerHTML = '<div class="empty">No qualifying official event in the 30-day window.</div>';
        return;
      }
      document.getElementById("notablePeriod").textContent = item.periodLabel;
      document.getElementById("notable").innerHTML =
        '<a class="notable-title" href="' + esc(readableLink(item.event)) + '" target="_blank" rel="noopener">' + esc(item.event.title) + '</a>' +
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
      document.getElementById("currentCount").textContent = String(data.summary.activeMapSignals);
      document.getElementById("regionCount").textContent = String(data.map.regions.filter(function(region){ return Number(region.effectiveStage.slice(1)) >= 2; }).length);
      // Keyed on the fallback, not on the signal mode. The inverse ("=== signal mode")
      // silently reported "no eligible global signal" for every mode name it had not
      // been taught — so a rename on the server side would have published a false
      // all-quiet while the map sat on a live M7. Only the one genuine no-signal mode
      // may produce the no-signal sentence.
      document.getElementById("mapFocus").textContent = data.map.focus.mode === "us_fallback" ? "No eligible global signal; showing the United States fallback." : "Leading signal: " + data.map.focus.label + ".";
      document.getElementById("method").textContent = data.map.method + " " + data.map.coverage;
      renderNotable(); renderSources(); renderRegions(); renderTerminator(); renderMap(); renderContext();
      renderHazardPills();
    }

    // ---- Globe bridge --------------------------------------------------------
    // ─────────────────────────────────────────────────────────────────────────
    // Tropical cyclones
    //
    // The geometry is the National Hurricane Center's own advisory product — the
    // same positions, forecast track, error cone and coastal warnings that go out
    // with each advisory — republished by Esri as Active_Hurricanes_v1. NHC's own
    // host sends no access-control-allow-origin and publishes shapefile and KMZ
    // rather than GeoJSON, so a browser cannot read it directly. That makes this
    // one hop from the issuing agency, and the page says so on every popup instead
    // of implying a direct feed.
    // ─────────────────────────────────────────────────────────────────────────
    var CYCLONE_BASE = "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer/";
    var CYCLONE_LAYERS = [
      {id:0, key:"forecastPoints", label:"forecast positions"},
      {id:1, key:"observedPoints", label:"observed positions"},
      {id:2, key:"forecastTrack",  label:"forecast track"},
      {id:3, key:"observedTrack",  label:"observed track"},
      {id:4, key:"cone",           label:"forecast cone"},
      {id:5, key:"warnings",       label:"coastal watches and warnings"}
    ];
    var CYCLONE_REFRESH_MS = 600000;
    var CYCLONE_PROVENANCE = "NOAA National Hurricane Center advisory product, republished by Esri. One hop from the issuing agency, not a direct NHC feed.";

    // A wind speed of null, an empty string, or zero is not a measurement. The
    // reflexive Number(x) turns every one of them into 0, which would publish a
    // calm, confident "tropical depression" for a storm whose intensity simply was
    // not in the record.
    function reportedKt(value) {
      if (value == null || value === "") return null;
      var speed = Number(value);
      if (!isFinite(speed) || speed <= 0) return null;
      return speed;
    }

    function knotsText(value) {
      var speed = reportedKt(value);
      if (speed == null) return "not reported";
      return Math.round(speed) + " kt (" + Math.round(speed * 1.15078) + " mph)";
    }

    // Saffir-Simpson, in knots, as NHC defines it. Below 34 kt is a depression and
    // 34-63 kt a tropical storm: neither is a hurricane, and neither is coloured as
    // one.
    function cycloneCategory(windKt) {
      var speed = reportedKt(windKt);
      if (speed == null) return {label:"Intensity not reported", color:"#697B73"};
      if (speed < 34) return {label:"Tropical depression", color:"#697B73"};
      if (speed < 64) return {label:"Tropical storm", color:"#69A88F"};
      if (speed < 83) return {label:"Category 1 hurricane", color:"#D3921F"};
      if (speed < 96) return {label:"Category 2 hurricane", color:"#DE5F26"};
      if (speed < 113) return {label:"Category 3 hurricane", color:"#BE2618"};
      if (speed < 137) return {label:"Category 4 hurricane", color:"#8C1B12"};
      return {label:"Category 5 hurricane", color:"#7A4D91"};
    }

    // The track layers carry a Saffir-Simpson number and a stage word instead of a
    // wind speed. SS is 0 for everything below hurricane strength, so a bare
    // Number(SS) would paint a tropical storm and a remnant low identically.
    function cycloneStage(ssValue, typeWord) {
      var ss = Number(ssValue);
      if (isFinite(ss) && ss >= 1) {
        var byCategory = {1:"#D3921F", 2:"#DE5F26", 3:"#BE2618", 4:"#8C1B12", 5:"#7A4D91"};
        var index = Math.min(5, Math.max(1, Math.round(ss)));
        return {color:byCategory[index], label:"Category " + index + " hurricane"};
      }
      var word = String(typeWord == null ? "" : typeWord).toLowerCase();
      if (word.indexOf("hurricane") >= 0) return {color:"#BE2618", label:"Hurricane"};
      if (word.indexOf("tropical storm") >= 0 || word === "ts") return {color:"#69A88F", label:"Tropical storm"};
      if (word.indexOf("depression") >= 0 || word === "td") return {color:"#697B73", label:"Tropical depression"};
      if (word.indexOf("disturbance") >= 0) return {color:"#8FA3B0", label:"Disturbance"};
      if (word.indexOf("low") >= 0 || word.indexOf("extratropical") >= 0) return {color:"#8FA3B0", label:"Remnant or non-tropical low"};
      if (!word) return {color:"#697B73", label:"Stage not reported"};
      return {color:"#697B73", label:String(typeWord)};
    }

    function warningStyle(code) {
      var key = String(code == null ? "" : code).toUpperCase();
      if (key === "TWA") return {color:"#D3921F", label:"Tropical storm watch"};
      if (key === "TWR") return {color:"#DE5F26", label:"Tropical storm warning"};
      if (key === "HWA") return {color:"#BE2618", label:"Hurricane watch"};
      if (key === "HWR") return {color:"#7A1810", label:"Hurricane warning"};
      if (!key) return {color:"#347FAC", label:"Coastal watch or warning, type not reported"};
      return {color:"#347FAC", label:"Coastal watch or warning (" + key + ")"};
    }

    function cycloneFeatures(key) {
      var data = state.cycloneData;
      if (!data) return [];
      var value = data[key];
      return value == null ? [] : value;
    }

    function cycloneStormNames() {
      var seen = {};
      var names = [];
      ["observedPoints","forecastPoints","observedTrack","forecastTrack","cone"].forEach(function(key) {
        cycloneFeatures(key).forEach(function(feature) {
          var raw = feature && feature.properties && feature.properties.STORMNAME;
          if (!raw) return;
          var normalised = String(raw).trim().toUpperCase();
          if (!normalised || seen[normalised]) return;
          seen[normalised] = true;
          names.push(String(raw).trim());
        });
      });
      return names;
    }

    async function loadCyclones(force) {
      var now = Date.now();
      if (!force && state.cycloneData && (now - state.cycloneFetchedAt) < CYCLONE_REFRESH_MS) {
        renderCyclones();
        return;
      }
      state.cycloneState = "loading";
      renderCycloneStatus();
      var results = await Promise.all(CYCLONE_LAYERS.map(function(layer) {
        return fetch(CYCLONE_BASE + layer.id + "/query?where=1%3D1&outFields=*&f=geojson")
          .then(function(response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
          })
          .then(function(payload) {
            // ArcGIS reports a rejected query as HTTP 200 with an error object in
            // the body. Checking response.ok alone would read a refusal as an ocean
            // with no storms in it, which is the most reassuring thing this page
            // could possibly get wrong.
            if (payload && payload.error) {
              throw new Error(payload.error.message || "feature service refused the query");
            }
            return {key:layer.key, label:layer.label, features:(payload && payload.features) || []};
          })
          .catch(function(error) {
            return {
              key:layer.key, label:layer.label, features:null,
              error:String((error && error.message) || error)
            };
          });
      }));

      var data = {};
      var missing = [];
      results.forEach(function(result) {
        data[result.key] = result.features;
        if (result.features === null) missing.push(result.label);
      });
      state.cycloneData = data;
      state.cycloneMissing = missing;
      state.cycloneFetchedAt = Date.now();
      state.cycloneState = missing.length === CYCLONE_LAYERS.length ? "error" : "ready";
      renderCyclones();
    }

    function renderCycloneStatus() {
      var element = document.getElementById("cycloneStatus");
      if (!element) return;
      if (!state.cyclones) {
        element.setAttribute("data-tone","normal");
        element.textContent = "";
        return;
      }
      if (state.cycloneState === "loading") {
        element.setAttribute("data-tone","normal");
        element.textContent = "Loading tropical cyclone advisories...";
        return;
      }
      if (state.cycloneState === "error") {
        element.setAttribute("data-tone","error");
        element.textContent = "Tropical cyclone advisories unavailable. This is a failed request, not a quiet ocean.";
        return;
      }
      if (state.cycloneState !== "ready") {
        element.setAttribute("data-tone","normal");
        element.textContent = "";
        return;
      }
      var names = cycloneStormNames();
      if (!names.length) {
        // An empty map and a broken feed look identical, and the empty one reads as
        // reassurance. Say which one this is.
        element.setAttribute("data-tone","empty");
        element.textContent = "No active tropical cyclones in any NHC basin. The feed answered and it was empty.";
        return;
      }
      var partial = state.cycloneMissing.length
        ? " Missing from this view: " + state.cycloneMissing.join(", ") + "."
        : "";
      element.setAttribute("data-tone","normal");
      element.textContent = names.length + " active " +
        (names.length === 1 ? "system" : "systems") + " on the flat map: " +
        names.join(", ") + "." + partial;
    }

    function cyclonePopupHead(props, kicker) {
      var name = (props && props.STORMNAME) || "Tropical cyclone";
      return '<div class="popup-title">' + esc(name) + " &mdash; " + esc(kicker) + "</div>";
    }

    function renderCyclones() {
      cycloneConeLayer.clearLayers();
      cycloneTrackLayer.clearLayers();
      renderCycloneStatus();
      if (!state.cyclones || !state.cycloneData) return;

      var parts = state.cycloneParts;
      var showCone = parts === "all" || parts === "cone";
      var showWarnings = parts === "all" || parts === "cone";
      var showForecast = parts === "all" || parts === "track";
      var showObserved = parts === "all" || parts === "track" || parts === "observed";

      if (showCone) {
        cycloneFeatures("cone").forEach(function(feature) {
          var props = feature.properties || {};
          L.geoJSON(feature, {
            style:function() {
              return {
                color:"#BE2618", weight:1.5, opacity:.85, dashArray:"5 4",
                fillColor:"#BE2618", fillOpacity:.08
              };
            }
          }).bindPopup(
            cyclonePopupHead(props, "forecast cone") +
            (props.ADVISNUM ? '<div class="popup-row">Advisory ' + esc(props.ADVISNUM) + "</div>" : "") +
            '<div class="popup-row">Peak forecast wind in this cone: ' + esc(knotsText(props.MAX_WIND)) + "</div>" +
            '<div class="popup-note"><strong>The cone is not the storm.</strong> It shows where the ' +
              "<em>centre</em> may go, drawn from the National Hurricane Center&rsquo;s own historical " +
              "track errors. The centre stays inside it only about two times in three, and damaging " +
              "wind, surge and rain routinely reach well beyond it. Outside the cone is not the same " +
              "as out of danger, and the cone says nothing about how wide the storm is.</div>" +
            '<div class="popup-note">' + esc(CYCLONE_PROVENANCE) + "</div>"
          ).addTo(cycloneConeLayer);
        });
      }

      if (showWarnings) {
        cycloneFeatures("warnings").forEach(function(feature) {
          var props = feature.properties || {};
          var warning = warningStyle(props.TCWW);
          L.geoJSON(feature, {
            style:function() { return {color:warning.color, weight:5, opacity:.9}; }
          }).bindPopup(
            cyclonePopupHead(props, warning.label) +
            '<div class="popup-row">Issued on this coastline by the National Hurricane Center' +
              (props.ADVISNUM ? " with advisory " + esc(props.ADVISNUM) : "") + ".</div>" +
            '<div class="popup-note">A <strong>warning</strong> means the conditions are expected here; ' +
              "a <strong>watch</strong> means they are possible. Follow your local emergency management " +
              "and the issuing agency, not this map.</div>" +
            '<div class="popup-note">' + esc(CYCLONE_PROVENANCE) + "</div>"
          ).addTo(cycloneConeLayer);
        });
      }

      if (showObserved) {
        cycloneFeatures("observedTrack").forEach(function(feature) {
          var props = feature.properties || {};
          var stage = cycloneStage(props.SS, props.STORMTYPE);
          L.geoJSON(feature, {
            style:function() { return {color:stage.color, weight:3, opacity:.9}; }
          }).bindPopup(
            cyclonePopupHead(props, "track already travelled") +
            '<div class="popup-row">Stage along this segment: <strong>' + esc(stage.label) + "</strong></div>" +
            '<div class="popup-note">Where the centre has already been, as fixed by the issuing agency. ' +
              "This part is observation, not forecast.</div>" +
            '<div class="popup-note">' + esc(CYCLONE_PROVENANCE) + "</div>"
          ).addTo(cycloneTrackLayer);
        });

        cycloneFeatures("observedPoints").forEach(function(feature) {
          var point = cyclonePoint(feature);
          if (!point) return;
          var props = feature.properties || {};
          var stage = cycloneStage(props.SS, props.STORMTYPE);
          L.circleMarker(point, {
            radius:4, color:stage.color, weight:1.5,
            fillColor:stage.color, fillOpacity:.85
          }).bindPopup(
            cyclonePopupHead(props, "observed position") +
            '<div class="popup-row">' + esc(cycloneWhen(props.DTG)) + "</div>" +
            '<div class="popup-row">Stage: <strong>' + esc(stage.label) + "</strong></div>" +
            '<div class="popup-row">Maximum sustained wind: ' + esc(knotsText(props.INTENSITY)) + "</div>" +
            '<div class="popup-row">Central pressure: ' +
              (props.MSLP == null ? "not reported" : esc(props.MSLP) + " mb") + "</div>" +
            '<div class="popup-note">' + esc(CYCLONE_PROVENANCE) + "</div>"
          ).addTo(cycloneTrackLayer);
        });
      }

      if (showForecast) {
        cycloneFeatures("forecastTrack").forEach(function(feature) {
          var props = feature.properties || {};
          L.geoJSON(feature, {
            style:function() { return {color:"#347FAC", weight:2.5, opacity:.9, dashArray:"7 5"}; }
          }).bindPopup(
            cyclonePopupHead(props, "forecast track") +
            (props.FCSTPRD ? '<div class="popup-row">' + esc(props.FCSTPRD) + "-hour forecast period</div>" : "") +
            '<div class="popup-note">A forecast of the centre&rsquo;s path, not a record of it. Read it ' +
              "together with the cone, which is the part that carries the uncertainty.</div>" +
            '<div class="popup-note">' + esc(CYCLONE_PROVENANCE) + "</div>"
          ).addTo(cycloneTrackLayer);
        });

        cycloneFeatures("forecastPoints").forEach(function(feature) {
          var point = cyclonePoint(feature);
          if (!point) return;
          var props = feature.properties || {};
          var category = cycloneCategory(props.MAXWIND);
          L.circleMarker(point, {
            radius:6, color:category.color, weight:2,
            fillColor:category.color, fillOpacity:.35
          }).bindPopup(
            cyclonePopupHead(props, "forecast position") +
            '<div class="popup-row">' +
              (props.FLDATELBL ? esc(props.FLDATELBL) : (props.DATELBL ? esc(props.DATELBL) : "Valid time not reported")) +
              (props.TAU == null ? "" : " (" + esc(props.TAU) + " h out)") + "</div>" +
            '<div class="popup-row">Forecast intensity: <strong>' + esc(category.label) + "</strong></div>" +
            '<div class="popup-row">Maximum sustained wind: ' + esc(knotsText(props.MAXWIND)) +
              ", gusting " + esc(knotsText(props.GUST)) + "</div>" +
            '<div class="popup-note">A forecast, not an observation. Intensity forecasts carry ' +
              "real error, and a category shown here is the agency&rsquo;s expectation rather than a " +
              "measurement.</div>" +
            '<div class="popup-note">' + esc(CYCLONE_PROVENANCE) + "</div>"
          ).addTo(cycloneTrackLayer);
        });
      }
    }

    function cyclonePoint(feature) {
      var geometry = feature && feature.geometry;
      if (!geometry || geometry.type !== "Point") return null;
      var coordinates = geometry.coordinates;
      if (!coordinates || coordinates.length < 2) return null;
      var lon = Number(coordinates[0]);
      var lat = Number(coordinates[1]);
      if (!isFinite(lat) || !isFinite(lon)) return null;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
      return [lat, lon];
    }

    function cycloneWhen(value) {
      if (value == null || value === "") return "Time not reported";
      var when = new Date(Number(value));
      if (isNaN(when.getTime())) return "Time not reported";
      return when.toISOString().replace("T"," ").slice(0,16) + " UTC";
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tsunamis
    //
    // Two things that are not the same and must not look the same.
    //
    // ACTIVE warnings come from NWS and its warning-polygon service. They are
    // empty almost every day, which is the honest answer and not a broken layer.
    //
    // RECORDED HISTORY comes from NCEI's global historical tsunami database. It is
    // what makes this toggle worth having on an ordinary day — but every point is
    // a SOURCE location, not a place that flooded, and its wave height is the
    // largest runup measured anywhere along the affected coast, often hundreds of
    // kilometres from the point being drawn. The popup has to say that, or the map
    // invites a reader to think the marker is where the water was.
    // ─────────────────────────────────────────────────────────────────────────
    var TSUNAMI_HISTORY_URL = "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events?minYear=1900&minMaxWaterHeight=1";
    var TSUNAMI_ALERT_TIERS = ["Tsunami Warning","Tsunami Advisory","Tsunami Watch"];
    var TSUNAMI_WWA_URL = "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/0/query?where=phenom%3D%27TS%27&outFields=*&f=geojson";
    var TSUNAMI_HISTORY_PAGES = 3;
    var TSUNAMI_REFRESH_MS = 600000;

    function tsunamiSeverity(heightMetres) {
      if (heightMetres == null) return {color:"#697B73", label:"Wave height not reported"};
      if (heightMetres < 2) return {color:"#69A88F", label:"Under 2 m"};
      if (heightMetres < 5) return {color:"#D3921F", label:"2 to 5 m"};
      if (heightMetres < 10) return {color:"#DE5F26", label:"5 to 10 m"};
      if (heightMetres < 20) return {color:"#BE2618", label:"10 to 20 m"};
      return {color:"#7A4D91", label:"Over 20 m"};
    }

    function tsunamiNumber(value) {
      if (value == null || value === "") return null;
      var parsed = Number(value);
      return isFinite(parsed) ? parsed : null;
    }

    async function loadTsunami(force) {
      var now = Date.now();
      if (!force && state.tsunamiData && (now - state.tsunamiFetchedAt) < TSUNAMI_REFRESH_MS) {
        renderTsunami();
        return;
      }
      state.tsunamiState = "loading";
      renderTsunamiStatus();

      var historyRequests = [];
      for (var page = 1; page <= TSUNAMI_HISTORY_PAGES; page += 1) {
        historyRequests.push(TSUNAMI_HISTORY_URL + "&page=" + page);
      }

      var alertRequests = TSUNAMI_ALERT_TIERS.map(function(tier) {
        return "https://api.weather.gov/alerts/active?event=" + encodeURIComponent(tier);
      });

      function getJson(url) {
        return fetch(url)
          .then(function(response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
          })
          .then(function(payload) {
            if (payload && payload.error) throw new Error(payload.error.message || "service error");
            return payload;
          })
          .catch(function() { return null; });
      }

      var settled = await Promise.all(
        historyRequests.map(getJson)
          .concat(alertRequests.map(getJson))
          .concat([getJson(TSUNAMI_WWA_URL)])
      );

      var historyPayloads = settled.slice(0, historyRequests.length);
      var alertPayloads = settled.slice(historyRequests.length, historyRequests.length + alertRequests.length);
      var wwaPayload = settled[settled.length - 1];

      var history = [];
      var totalHistory = null;
      var historyFailed = 0;
      historyPayloads.forEach(function(payload) {
        if (!payload) { historyFailed += 1; return; }
        if (totalHistory == null && typeof payload.totalItems === "number") totalHistory = payload.totalItems;
        (payload.items || []).forEach(function(item) { history.push(item); });
      });

      var alerts = [];
      var alertsFailed = 0;
      alertPayloads.forEach(function(payload) {
        if (!payload) { alertsFailed += 1; return; }
        (payload.features || []).forEach(function(feature) { alerts.push(feature); });
      });

      state.tsunamiData = {
        history:history,
        totalHistory:totalHistory,
        historyFailed:historyFailed,
        alerts:alerts,
        alertsFailed:alertsFailed,
        warningPolygons:wwaPayload && wwaPayload.features ? wwaPayload.features : null
      };
      state.tsunamiFetchedAt = Date.now();
      // Only a total wipe-out is an error. A partial result still draws something
      // real, and the status line says exactly how much of it is missing.
      state.tsunamiState =
        (historyFailed === historyRequests.length && alertsFailed === alertRequests.length)
          ? "error" : "ready";
      renderTsunami();
    }

    function renderTsunamiStatus() {
      var element = document.getElementById("tsunamiStatus");
      if (!element) return;
      if (!state.tsunami) { element.textContent = ""; element.setAttribute("data-tone","normal"); return; }
      if (state.tsunamiState === "loading") {
        element.setAttribute("data-tone","normal");
        element.textContent = "Loading tsunami warnings and the NCEI historical record...";
        return;
      }
      if (state.tsunamiState === "error") {
        element.setAttribute("data-tone","error");
        element.textContent = "Tsunami data unavailable. This is a failed request, not an absence of tsunamis.";
        return;
      }
      if (state.tsunamiState !== "ready") { element.textContent = ""; return; }
      var data = state.tsunamiData || {};
      var alertCount = (data.alerts || []).length;
      var shown = (data.history || []).length;
      var total = data.totalHistory;
      var parts = [];
      if (alertCount) {
        element.setAttribute("data-tone","error");
        parts.push(alertCount + " active tsunami " + (alertCount === 1 ? "alert" : "alerts") + " in force.");
      } else {
        element.setAttribute("data-tone","empty");
        // The single most important sentence in this layer.
        parts.push("No active tsunami warning, advisory or watch anywhere in the NWS system. The feed answered and it was empty.");
      }
      if (shown) {
        // Never let a capped list read as the whole record.
        parts.push("Showing " + shown + (total != null && total > shown ? " of " + total : "") +
          " recorded tsunamis since 1900 that produced a wave of at least 1 m.");
      }
      if (data.historyFailed) parts.push(data.historyFailed + " history page(s) failed to load.");
      if (data.alertsFailed) parts.push(data.alertsFailed + " alert feed(s) failed to load.");
      element.textContent = parts.join(" ");
    }

    function renderTsunami() {
      tsunamiLiveLayer.clearLayers();
      tsunamiHistoryLayer.clearLayers();
      renderTsunamiStatus();
      if (!state.tsunami || !state.tsunamiData) return;
      var data = state.tsunamiData;
      var parts = state.tsunamiParts;
      var showLive = parts === "all" || parts === "live";
      var showHistory = parts === "all" || parts === "history";

      if (showLive) {
        (data.warningPolygons || []).forEach(function(feature) {
          if (!feature || !feature.geometry) return;
          L.geoJSON(feature, {
            style:function() { return {color:"#7A1810", weight:2, opacity:.95, fillColor:"#BE2618", fillOpacity:.2}; }
          }).bindPopup(
            '<div class="popup-title">' + esc((feature.properties && feature.properties.event) || "Tsunami warning") + "</div>" +
            '<div class="popup-row">Issued by ' + esc((feature.properties && feature.properties.wfo) || "the National Weather Service") + "</div>" +
            '<div class="popup-note">An active warning polygon from the National Weather Service. ' +
              "Follow your local emergency management and the issuing agency, not this map.</div>"
          ).addTo(tsunamiLiveLayer);
        });

        (data.alerts || []).forEach(function(feature) {
          if (!feature || !feature.geometry) return;
          var properties = feature.properties || {};
          L.geoJSON(feature, {
            style:function() { return {color:"#7A1810", weight:2, opacity:.95, fillColor:"#BE2618", fillOpacity:.2}; }
          }).bindPopup(
            '<div class="popup-title">' + esc(properties.event || "Tsunami alert") + "</div>" +
            '<div class="popup-row">' + esc(properties.areaDesc || "Area not reported") + "</div>" +
            (properties.headline ? '<div class="popup-row">' + esc(properties.headline) + "</div>" : "") +
            '<div class="popup-note">Active National Weather Service alert.</div>'
          ).addTo(tsunamiLiveLayer);
        });
      }

      if (showHistory) {
        (data.history || []).forEach(function(item) {
          var lat = tsunamiNumber(item.latitude);
          var lon = tsunamiNumber(item.longitude);
          if (lat == null || lon == null) return;
          if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
          var height = tsunamiNumber(item.maxWaterHeight);
          var severity = tsunamiSeverity(height);
          var radius = height == null ? 3 : Math.max(3, Math.min(14, 3 + Math.sqrt(height) * 2));
          L.circleMarker([lat, lon], {
            radius:radius, color:severity.color, weight:1.5,
            fillColor:severity.color, fillOpacity:.45
          }).bindPopup(tsunamiHistoryPopup(item, height, severity)).addTo(tsunamiHistoryLayer);
        });
      }
    }

    function tsunamiHistoryPopup(item, height, severity) {
      var when = [item.year, item.month, item.day].filter(function(part) { return part != null; }).join("-");
      var deaths = tsunamiNumber(item.deathsTotal);
      var magnitude = tsunamiNumber(item.eqMagnitude);
      var runups = tsunamiNumber(item.numRunups);
      return '<div class="popup-title">' + esc(item.locationName || item.country || "Tsunami") + "</div>" +
        '<div class="popup-row"><strong>' + esc(when || "Date not reported") + "</strong>" +
          (item.country ? " &middot; " + esc(item.country) : "") + "</div>" +
        '<div class="popup-row">Largest wave measured: <strong>' +
          (height == null ? "not reported" : esc(height) + " m") + "</strong>" +
          (height == null ? "" : " (" + esc(severity.label) + ")") + "</div>" +
        '<div class="popup-row">Triggering earthquake: ' +
          (magnitude == null ? "not reported" : "M " + esc(magnitude)) + "</div>" +
        '<div class="popup-row">Deaths recorded: ' +
          (deaths == null ? "not reported in this record" : esc(formatNumber(deaths))) + "</div>" +
        '<div class="popup-row">Shoreline measurements in the record: ' +
          (runups == null ? "not reported" : esc(formatNumber(runups))) + "</div>" +
        '<div class="popup-note"><strong>This marker is the source, not the flooding.</strong> It sits at ' +
          "the earthquake or landslide that generated the wave. The height above is the largest runup " +
          "measured anywhere along the affected coast, which can be many hundreds of kilometres away " +
          "from this point.</div>" +
        '<div class="popup-note">NOAA NCEI Global Historical Tsunami Database. A blank field means the ' +
          "record does not carry that value, which is not the same as a zero.</div>";
    }

    // The globe lives in a module script (it imports three.js) and publishes itself
    // on window.EarthGlobe when ready. Every call here is guarded: if WebGL is
    // unavailable or three.js fails to load, the flat map keeps working untouched.
    function pushGlobe(events) {
      if (!window.EarthGlobe) return;
      try {
        window.EarthGlobe.setEvents(events || selectedEvents(), {
          antipodes:state.antipodes, colors:colors
        });
      } catch (error) {}
    }

    function syncGlobeSettings() {
      if (!window.EarthGlobe) return;
      try {
        window.EarthGlobe.setDayNight(state.dayNight);
        window.EarthGlobe.setSpin(state.spin);
        window.EarthGlobe.setActive(state.view === "globe");
      } catch (error) {}
    }

    window.addEventListener("earth-globe-ready", function() {
      syncGlobeSettings();
      pushGlobe(state.data ? selectedEvents() : []);
    });

    function setView(view) {
      state.view = view;
      document.getElementById("stage").setAttribute("data-stage", view);
      Array.prototype.forEach.call(document.querySelectorAll("button[data-view]"), function(button) {
        button.classList.toggle("active", button.getAttribute("data-view") === view);
      });
      syncGlobeSettings();
      if (view === "map") setTimeout(function(){ map.invalidateSize(); }, 40);
      else pushGlobe(state.data ? selectedEvents() : []);
    }
    // Never take the map back from a reader who has moved it.
    //
    // state.focusApplied alone was not enough, because it is only set on load()'s
    // SUCCESS path. A failed first fetch — a cold start, a blip — left it false, so
    // the five-minute poll would re-apply the default focus minutes later and yank
    // the view away from wherever the reader had deliberately panned to. The guard
    // that matters is not "have we focused yet" but "has a person touched this".
    function applyDefaultFocus(force) {
      if (!state.data || !state.data.map.focus) return;
      if (state.userMovedMap && force !== true) return;
      state.suppressMoveFlag = true;
      map.setView(state.data.map.focus.center,state.data.map.focus.zoom);
      setTimeout(function(){ state.suppressMoveFlag = false; },0);
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
        if (!state.focusApplied) {
          applyDefaultFocus();
          state.focusApplied = true;
        }
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
        renderMap(); renderContext(); renderHazardPills();
      });
    });
    document.getElementById("sourceFilter").addEventListener("change",function(event) {
      state.source = event.target.value; renderMap(); renderContext(); renderHazardPills();
    });
    document.getElementById("signalSort").value = state.sort;
    document.getElementById("signalSort").addEventListener("change",function(event) {
      state.sort = event.target.value;
      try { localStorage.setItem("earthWatch.signalSort",state.sort); } catch (error) {}
      renderSignals(selectedEvents()); renderContext();
    });
    Array.prototype.forEach.call(document.querySelectorAll("button[data-view]"),function(button) {
      button.addEventListener("click",function() { setView(button.getAttribute("data-view")); });
    });
    document.getElementById("dayNight").addEventListener("change",function(event) {
      state.dayNight = event.target.checked;
      renderTerminator();
      syncGlobeSettings();
    });
    document.getElementById("antipodeLayer").addEventListener("change",function(event) {
      state.antipodes = event.target.checked;
      renderAntipodes();
      pushGlobe();
    });
    document.getElementById("cycloneLayer").addEventListener("change",function(event) {
      state.cyclones = event.target.checked;
      document.getElementById("cycloneControls").hidden = !state.cyclones;
      if (state.cyclones) loadCyclones(false);
      else renderCyclones();
    });
    document.getElementById("cycloneParts").addEventListener("change",function(event) {
      state.cycloneParts = event.target.value;
      renderCyclones();
    });
    document.getElementById("tsunamiLayer").addEventListener("change",function(event) {
      state.tsunami = event.target.checked;
      document.getElementById("tsunamiControls").hidden = !state.tsunami;
      if (state.tsunami) loadTsunami(false);
      else renderTsunami();
    });
    document.getElementById("tsunamiParts").addEventListener("change",function(event) {
      state.tsunamiParts = event.target.value;
      renderTsunami();
    });
    // Any movement the page did not initiate means a person is driving the map.
    map.on("movestart zoomstart",function() {
      if (!state.suppressMoveFlag) state.userMovedMap = true;
    });
    document.getElementById("autoSpin").addEventListener("change",function(event) {
      state.spin = event.target.checked;
      syncGlobeSettings();
    });
    document.getElementById("globeReset").addEventListener("click",function() {
      if (window.EarthGlobe) window.EarthGlobe.recentre();
    });
    document.getElementById("globeZoomIn").addEventListener("click",function() {
      if (window.EarthGlobe) window.EarthGlobe.zoomBy(0.8);
    });
    document.getElementById("globeZoomOut").addEventListener("click",function() {
      if (window.EarthGlobe) window.EarthGlobe.zoomBy(1.25);
    });
    document.getElementById("globePillars").addEventListener("click",function() {
      var pressed = this.getAttribute("aria-pressed") === "true";
      this.setAttribute("aria-pressed", pressed ? "false" : "true");
      if (window.EarthGlobe) window.EarthGlobe.setPillars(!pressed);
    });
    document.getElementById("globeFollow").addEventListener("click",function() {
      if (!window.EarthGlobe || !state.data) return;
      var focus = state.data.map.focus;
      var pressed = this.getAttribute("aria-pressed") === "true";
      this.setAttribute("aria-pressed", pressed ? "false" : "true");
      if (!pressed && focus && focus.center) window.EarthGlobe.lookAt(focus.center[0], focus.center[1]);
    });

    // Popup buttons are rebuilt as HTML strings on every open, so bind once by
    // delegation on the map container rather than per-popup.
    document.getElementById("map").addEventListener("click",function(clickEvent) {
      var button = clickEvent.target.closest ? clickEvent.target.closest("[data-earth-action]") : null;
      if (!button) return;
      clickEvent.preventDefault();
      var action = button.getAttribute("data-earth-action");
      var id = button.getAttribute("data-earth-id");
      if (action === "antipode") showAntipode(id);
      if (action === "felt") toggleFelt(id);
    });

    // The terminator moves about a quarter of a degree a minute; redraw it on a
    // slow tick so the page stays honest between the five-minute data reloads.
    setInterval(function() {
      if (state.dayNight) renderTerminator();
      syncGlobeSettings();
    },60*1000);

    // The run-up chart is fetched on demand, once per event, when its popup opens.
    map.on("popupopen", function(popupEvent) {
      var source = popupEvent.popup && popupEvent.popup._source;
      var id = source && source._earthEventId;
      if (!id || !state.data) return;
      var event = state.data.map.events.find(function(candidate) { return candidate.id === id; });
      if (!event || event.family !== "earthquake") return;
      if (state.sparkCache[event.id]) return;
      loadSparkline(event);
    });

    // Explicitly asking for the default view is the one case that overrides the
    // "do not move a map the reader is driving" rule.
    document.getElementById("resetFocus").addEventListener("click",function() {
      applyDefaultFocus(true);
    });
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
    // ── Ambient glow + night watch ───────────────────────────────────────
    // The severity maths is NOT written here — it is the unit-tested source from
    // src/logic/ambient.ts, interpolated verbatim (same pattern as the solar
    // block) so there is one definition rather than a TS copy and a client copy
    // that drift. Tests: src/tests/ambient.test.ts + earthAmbientPage.test.ts
${ambientClientSource()}

    var AMBIENT_IDLE_MS = 3 * 60 * 1000;
    var ambientIdleTimer = null;
    var ambientEnabled = true;
    try {
      ambientEnabled = window.localStorage.getItem("earthNightWatch") !== "off";
    } catch (e) { /* private mode — default on, never throw */ }

    function ambientFamilyLabel(family) {
      if (!family) return "all quiet";
      for (var i = 0; i < HAZARD_FAMILIES.length; i++) {
        if (HAZARD_FAMILIES[i].key === family) return HAZARD_FAMILIES[i].label;
      }
      return family.replace(/_/g, " ");
    }

    function ambientAgo(hours) {
      if (!isFinite(hours) || hours < 0) return "";
      if (hours < 1) return Math.max(1, Math.round(hours * 60)) + "m ago";
      if (hours < 48) return Math.round(hours) + "h ago";
      return Math.round(hours / 24) + "d ago";
    }

    // Every visible signal the map is currently showing, spatial and not.
    function ambientEvents() {
      if (!state.data || !state.data.map) return [];
      var m = state.data.map;
      var spatial = Array.isArray(m.events) ? m.events : [];
      var flat = Array.isArray(m.nonSpatialSignals) ? m.nonSpatialSignals : [];
      return spatial.concat(flat);
    }

    // The server's own lead-signal pick. Strictly better than re-ranking client
    // side: 457 live weather alerts tie at score 100 (oldest 26 days back) while
    // the real lead was an M7.7 at 98, so raw score alone chose a month-old alert.
    function ambientLeadId() {
      if (!state.data || !state.data.map || !state.data.map.focus) return null;
      var ids = state.data.map.focus.eventIds;
      return Array.isArray(ids) && ids.length ? ids[0] : null;
    }

    function applyAmbient() {
      var glow = ambientGlow(ambientEvents(), new Date(), ambientLeadId());
      var root = document.documentElement;
      root.style.setProperty("--ambient-color", glow.color);
      root.style.setProperty("--ambient-alpha", String(glow.alpha));
      root.style.setProperty("--ambient-reach", (4 + 18 * glow.intensity).toFixed(2) + "vmin");

      var el = document.getElementById("ambientGlow");
      if (el) {
        if (glow.pulse) el.classList.add("ambient-pulse");
        else el.classList.remove("ambient-pulse");
      }

      var out = document.getElementById("ambientReadout");
      if (out) {
        var parts = [ambientFamilyLabel(glow.family)];
        var ago = ambientAgo(glow.ageHours);
        if (glow.family && ago) parts.push(ago);
        out.textContent = parts.join("  ·  ");
      }
    }

    function ambientExit() {
      document.documentElement.removeAttribute("data-ambient");
    }

    function ambientArm() {
      if (ambientIdleTimer) clearTimeout(ambientIdleTimer);
      ambientExit();
      if (!ambientEnabled) return;
      ambientIdleTimer = setTimeout(function () {
        document.documentElement.setAttribute("data-ambient", "on");
        applyAmbient();
      }, AMBIENT_IDLE_MS);
    }

    ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"].forEach(function (evt) {
      window.addEventListener(evt, ambientArm, { passive: true });
    });

    var ambientBtn = document.getElementById("ambientToggle");
    if (ambientBtn) {
      ambientBtn.setAttribute("aria-pressed", ambientEnabled ? "true" : "false");
      ambientBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        ambientEnabled = !ambientEnabled;
        try { window.localStorage.setItem("earthNightWatch", ambientEnabled ? "on" : "off"); } catch (err) {}
        ambientBtn.setAttribute("aria-pressed", ambientEnabled ? "true" : "false");
        ambientArm();
      });
    }

    // Its own cadence, deliberately not hooked into render(): the glow must keep
    // decaying with the lead event's age between the 5-minute data polls, and
    // wrapping someone else's render path is a good way to break it.
    applyAmbient();
    setInterval(applyAmbient, 20 * 1000);
    ambientArm();

    load();
    setInterval(load,5*60*1000);
  })();
  </script>

  <script type="module">
  // 3D globe. Deliberately additive: if three.js or WebGL is unavailable this whole
  // block throws and window.EarthGlobe is never defined, which every caller in the
  // classic script above already guards for. The flat map is never at risk.
  import * as THREE from "/assets/three-0.180.0/three.module.js";

  const solar = window.__earthSolar;
  const canvas = document.getElementById("globe");
  const statusEl = document.getElementById("globeStatus");
  const clockEl = document.getElementById("globeClock");

  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false });
  } catch (error) {
    setStatus("This browser cannot draw the 3D globe. The flat map has the same data.");
    throw error;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070D);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);

  const GLOBE_RADIUS = 1;
  const state = {
    active:false, dayNight:true, spin:true,
    distance:3.35, yaw:0, pitch:0, dragging:false, lastPointer:null, pillars:true,
    events:[], colors:{}, showAntipodes:false, hovered:null
  };

  // ---- Imagery -------------------------------------------------------------
  // NASA GIBS serves EPSG:4326 (plate carree) tiles, which is exactly the projection
  // an equirectangular sphere texture wants — no reprojection needed. Blue Marble
  // Shaded Relief + Bathymetry is a static, public-domain NASA product, and NASA is
  // already one of this page's disclosed official sources.
  //
  // The level geometry below is read from the published WMTS capabilities, NOT from
  // the usual 2^z assumption, because for this TileMatrixSet that assumption is
  // WRONG and wrong in a way that looks fine: levels 1 (3x2) and 2 (5x3) are not
  // 2:1 grids, so pasting them into an equirectangular texture stretches the map and
  // silently displaces every earthquake. Only levels 0, 3, 4, 5+ are exactly 2:1.
  const GIBS_LAYER = "BlueMarble_ShadedRelief_Bathymetry";
  const GIBS_TILE = 512;
  const GIBS_FAST = { level:0, cols:2, rows:1 };   // 1024 x 512, ~52 KB, 2 requests
  const GIBS_SHARP = { level:3, cols:10, rows:5 }; // 5120 x 2560, ~1.6 MB, 50 requests

  function fallbackTexture() {
    // A plain ocean-and-graticule sphere, so a failed image load still yields a
    // usable globe rather than a black ball. Explicitly not a map of anything.
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 512;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#12314A"; ctx.fillRect(0,0,c.width,c.height);
    ctx.strokeStyle = "rgba(198,212,228,.28)"; ctx.lineWidth = 1;
    for (let lon = 0; lon <= 1024; lon += 1024/12) {
      ctx.beginPath(); ctx.moveTo(lon,0); ctx.lineTo(lon,512); ctx.stroke();
    }
    for (let lat = 0; lat <= 512; lat += 512/6) {
      ctx.beginPath(); ctx.moveTo(0,lat); ctx.lineTo(1024,lat); ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  async function loadGibsTexture(grid) {
    const c = document.createElement("canvas");
    c.width = grid.cols * GIBS_TILE;
    c.height = grid.rows * GIBS_TILE;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0B2135";
    ctx.fillRect(0, 0, c.width, c.height);

    let loaded = 0;
    const jobs = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const url = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/" + GIBS_LAYER +
          "/default/500m/" + grid.level + "/" + row + "/" + col + ".jpeg";
        jobs.push(new Promise((resolve) => {
          const image = new Image();
          image.crossOrigin = "anonymous";
          image.onload = () => {
            ctx.drawImage(image, col * GIBS_TILE, row * GIBS_TILE, GIBS_TILE, GIBS_TILE);
            loaded += 1;
            resolve();
          };
          image.onerror = () => resolve();   // a hole is better than a blank globe
          image.src = url;
        }));
      }
    }
    await Promise.all(jobs);
    const total = grid.cols * grid.rows;
    if (!loaded) return { texture:null, loaded:0, total };
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return { texture, loaded, total };
  }

  let sharpRequested = false;
  async function upgradeImagery() {
    // 1.6 MB of tiles is not worth spending on a reader who never opens the globe,
    // so the sharp texture is fetched once, on first activation, in the background.
    if (sharpRequested) return;
    sharpRequested = true;
    const sharp = await loadGibsTexture(GIBS_SHARP);
    if (sharp.texture && sharp.loaded === sharp.total) {
      const previous = globeUniforms.dayMap.value;
      globeUniforms.dayMap.value = sharp.texture;
      if (previous && previous.dispose) previous.dispose();
    }
  }

  // ---- Globe ---------------------------------------------------------------
  const globeUniforms = {
    dayMap:{ value: fallbackTexture() },
    sunDirection:{ value: new THREE.Vector3(1,0,0) },
    dayNightMix:{ value: 1 }
  };

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS, 96, 64),
    new THREE.ShaderMaterial({
      uniforms: globeUniforms,
      vertexShader: [
        "varying vec2 vUv;",
        "varying vec3 vObjectNormal;",
        "void main() {",
        "  vUv = uv;",
        "  vObjectNormal = normalize(normal);",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}"
      ].join("\\n"),
      // The globe never rotates — the camera orbits it — so the object-space normal
      // is also the world-space normal, and can be compared directly against the
      // subsolar direction computed by the same geoToVector the markers use.
      fragmentShader: [
        "uniform sampler2D dayMap;",
        "uniform vec3 sunDirection;",
        "uniform float dayNightMix;",
        "varying vec2 vUv;",
        "varying vec3 vObjectNormal;",
        "void main() {",
        "  vec3 base = texture2D(dayMap, vUv).rgb;",
        "  float cosAngle = clamp(dot(normalize(vObjectNormal), normalize(sunDirection)), -1.0, 1.0);",
        "  float elevation = degrees(asin(cosAngle));",
        // Same 18-degree ramp as nightFraction() in src/logic/solar.ts, so the globe
        // and the flat map agree about where night begins.
        "  float night = clamp(-elevation / 18.0, 0.0, 1.0) * dayNightMix;",
        // Night keeps a third of the daylight value rather than going near-black.
        // Physically the dark side would be almost invisible, but the point of this
        // view is to see what is happening everywhere at once, and half the world is
        // always in darkness — an accurate render would hide half the events.
        "  vec3 nightColor = base * 0.34 + vec3(0.020, 0.034, 0.072);",
        "  vec3 color = mix(base, nightColor, night);",
        "  float twilight = smoothstep(9.0, 0.0, abs(elevation)) * dayNightMix;",
        "  color += vec3(0.30, 0.14, 0.04) * twilight;",
        "  gl_FragColor = vec4(color, 1.0);",
        "}"
      ].join("\\n")
    })
  );
  scene.add(globe);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS * 1.022, 64, 48),
    new THREE.ShaderMaterial({
      transparent:true, side:THREE.BackSide, depthWrite:false, blending:THREE.AdditiveBlending,
      vertexShader: [
        "varying vec3 vNormal;",
        "void main() {",
        "  vNormal = normalize(normalMatrix * normal);",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}"
      ].join("\\n"),
      fragmentShader: [
        "varying vec3 vNormal;",
        "void main() {",
        "  float rim = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);",
        "  gl_FragColor = vec4(0.34, 0.55, 0.85, 1.0) * clamp(rim, 0.0, 1.0) * 0.55;",
        "}"
      ].join("\\n")
    })
  );
  scene.add(atmosphere);

  function discTexture() {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 64;
    const ctx = c.getContext("2d");
    const gradient = ctx.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,"rgba(255,255,255,1)");
    gradient.addColorStop(.45,"rgba(255,255,255,.92)");
    gradient.addColorStop(1,"rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(c);
  }

  const markerGeometry = new THREE.BufferGeometry();
  const markers = new THREE.Points(markerGeometry, new THREE.PointsMaterial({
    size:0.036, map:discTexture(), vertexColors:true, transparent:true,
    sizeAttenuation:true, depthWrite:false, alphaTest:0.04
  }));
  scene.add(markers);

  // Pillars. Two vertices per event — one on the surface, one directly above it
  // along the same radius — so the shaft reads as rising straight out of the
  // planet. Height carries the score, which is what a reader is scanning for:
  // on a sphere a flat dot near the limb is nearly invisible, but a pillar at
  // the limb is a silhouette and reads from any angle.
  const pillarGeometry = new THREE.BufferGeometry();
  const pillars = new THREE.LineSegments(pillarGeometry, new THREE.LineBasicMaterial({
    vertexColors:true, transparent:true, opacity:.85, depthWrite:false
  }));
  scene.add(pillars);

  const antipodeGeometry = new THREE.BufferGeometry();
  const antipodeMarkers = new THREE.Points(antipodeGeometry, new THREE.PointsMaterial({
    size:0.024, map:discTexture(), color:0x9FB2C4, transparent:true, opacity:.75,
    sizeAttenuation:true, depthWrite:false, alphaTest:0.04
  }));
  scene.add(antipodeMarkers);

  const sunMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 16, 12),
    new THREE.MeshBasicMaterial({ color:0xFFD34D })
  );
  scene.add(sunMarker);

  // ---- Interaction ---------------------------------------------------------
  function applyCamera() {
    state.pitch = Math.max(-1.35, Math.min(1.35, state.pitch));
    // Floor was 1.35, which on a unit sphere is barely closer than the default
    // 3.35 and made the globe feel like it would not zoom at all. 1.12 gets the
    // camera close enough to read a single region.
    state.distance = Math.max(1.12, Math.min(7, state.distance));
    const cosPitch = Math.cos(state.pitch);
    camera.position.set(
      state.distance * cosPitch * Math.sin(state.yaw),
      state.distance * Math.sin(state.pitch),
      state.distance * cosPitch * Math.cos(state.yaw)
    );
    camera.lookAt(0,0,0);
  }

  canvas.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.lastPointer = { x:event.clientX, y:event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", (event) => {
    state.dragging = false;
    try { canvas.releasePointerCapture(event.pointerId); } catch (error) {}
  });
  canvas.addEventListener("pointerleave", () => { state.dragging = false; });
  canvas.addEventListener("pointermove", (event) => {
    if (state.dragging && state.lastPointer) {
      state.yaw -= (event.clientX - state.lastPointer.x) * 0.006;
      state.pitch += (event.clientY - state.lastPointer.y) * 0.006;
      state.lastPointer = { x:event.clientX, y:event.clientY };
      applyCamera();
    } else {
      hoverAt(event);
    }
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.distance *= event.deltaY > 0 ? 1.09 : 0.92;
    applyCamera();
  }, { passive:false });

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.022;
  const pointer = new THREE.Vector2();

  function hoverAt(event) {
    if (!state.active || !state.events.length) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(markers);
    // Only accept a hit on the hemisphere facing the camera; without this the ray
    // passes through the globe and labels an event on the far side.
    const visible = hits.filter((hit) => hit.point.clone().normalize().dot(
      camera.position.clone().normalize()
    ) > 0);
    state.hovered = visible.length ? state.events[visible[0].index] || null : null;
    describe();
  }

  // ---- Frame ---------------------------------------------------------------
  function describe() {
    if (!state.events.length) {
      setStatus("No qualifying official signals in this view.");
      return;
    }
    if (state.hovered) {
      const event = state.hovered;
      const detail = [event.sourceLabel];
      if (typeof event.magnitude === "number") detail.push("M" + event.magnitude.toFixed(1));
      if (typeof event.depthKm === "number") detail.push(Math.round(event.depthKm) + " km deep");
      setStatus(event.title + "  ·  " + detail.join("  ·  "));
      return;
    }
    setStatus(
      state.events.length + " official signals plotted  ·  drag to turn, scroll or use +/- to zoom, hover a point to identify it" +
      (state.showAntipodes ? "  ·  grey points are earthquake antipodes" : "")
    );
  }

  function updateSun() {
    const sun = solar.subsolarPoint(new Date());
    const vector = solar.geoToVector(sun.lat, sun.lon);
    globeUniforms.sunDirection.value.set(vector.x, vector.y, vector.z);
    sunMarker.position.set(vector.x * 1.5, vector.y * 1.5, vector.z * 1.5);
    sunMarker.visible = state.dayNight;
    if (clockEl) {
      const now = new Date();
      clockEl.textContent =
        now.toISOString().slice(11,16) + " UTC\\n" +
        "sun overhead " + sun.lat.toFixed(1) + "\\u00B0, " + sun.lon.toFixed(1) + "\\u00B0";
    }
  }

  let lastFrame = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const elapsed = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!state.active) return;
    if (state.spin && !state.dragging) {
      state.yaw += elapsed * 0.045;
      applyCamera();
    }
    updateSun();
    renderer.render(scene, camera);
  }

  function resize() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const width = parent.clientWidth || 1;
    const height = parent.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  if (typeof ResizeObserver === "function") {
    new ResizeObserver(resize).observe(canvas.parentElement);
  }
  window.addEventListener("resize", resize);

  // ---- Public surface ------------------------------------------------------
  window.EarthGlobe = {
    setActive(active) {
      state.active = active;
      if (!active) return;
      resize();
      describe();
      upgradeImagery();
    },
    setDayNight(on) {
      state.dayNight = on;
      globeUniforms.dayNightMix.value = on ? 1 : 0;
    },
    setSpin(on) { state.spin = on; },
    setPillars(on) {
      state.pillars = on;
      // Re-run setEvents so the heights and the marker tips are recomputed from
      // the same source, rather than toggling visibility and leaving the markers
      // floating where the pillar tips used to be.
      window.EarthGlobe.setEvents(state.events, { antipodes:state.showAntipodes, colors:state.colors });
    },
    zoomBy(factor) {
      state.distance *= factor;
      applyCamera();
    },
    recentre() {
      state.yaw = 0; state.pitch = 0; state.distance = 3.35;
      applyCamera();
    },
    lookAt(lat, lon) {
      // Derived from the SAME geoToVector the markers use rather than from a
      // hand-written azimuth formula. applyCamera places the camera at
      // (cos p sin y, sin p, cos p cos y), so inverting that against the target's
      // unit vector is exact and cannot drift away from where the markers sit.
      const target = solar.geoToVector(lat, lon);
      state.pitch = Math.asin(Math.max(-1, Math.min(1, target.y)));
      state.yaw = Math.atan2(target.x, target.z);
      state.distance = 2.3;
      applyCamera();
    },
    setEvents(events, options) {
      const points = (events || []).filter((event) =>
        event.geometry && event.geometry.type === "Point" &&
        Number.isFinite(Number(event.geometry.coordinates[0])) &&
        Number.isFinite(Number(event.geometry.coordinates[1]))
      );
      state.events = points;
      state.colors = (options && options.colors) || state.colors;
      state.showAntipodes = Boolean(options && options.antipodes);

      const positions = new Float32Array(points.length * 3);
      const colors = new Float32Array(points.length * 3);
      // Two vertices per pillar: base on the surface, tip where the marker sits.
      const pillarPositions = new Float32Array(points.length * 6);
      const pillarColors = new Float32Array(points.length * 6);
      const tint = new THREE.Color();
      points.forEach((event, index) => {
        const lon = Number(event.geometry.coordinates[0]);
        const lat = Number(event.geometry.coordinates[1]);
        // Pillar height carries the score. Earthquakes take magnitude instead,
        // because a reader comparing quakes is comparing magnitudes and a scored
        // rank would flatten an M7.7 and an M5.2 that happen to rank alike.
        const magnitude = Number(event.magnitude);
        const strength = event.family === "earthquake" && Number.isFinite(magnitude)
          ? Math.max(0, Math.min(1, (magnitude - 2.5) / 6))
          : Math.max(0, Math.min(1, (event.score || 0) / 100));
        // A visible minimum, so a low-scoring event is still a mark and not a
        // dot that has silently vanished into the surface.
        const height = state.pillars ? 0.035 + strength * 0.34 : 0.012;
        const base = solar.geoToVector(lat, lon, 1.001);
        const vector = solar.geoToVector(lat, lon, 1.001 + height);
        positions[index*3] = vector.x;
        positions[index*3+1] = vector.y;
        positions[index*3+2] = vector.z;
        pillarPositions[index*6] = base.x;
        pillarPositions[index*6+1] = base.y;
        pillarPositions[index*6+2] = base.z;
        pillarPositions[index*6+3] = vector.x;
        pillarPositions[index*6+4] = vector.y;
        pillarPositions[index*6+5] = vector.z;
        tint.set(state.colors[event.family] || "#697B73");
        colors[index*3] = tint.r;
        colors[index*3+1] = tint.g;
        colors[index*3+2] = tint.b;
        // Fade the shaft toward its base so the tip is the thing that reads.
        pillarColors[index*6] = tint.r * 0.35;
        pillarColors[index*6+1] = tint.g * 0.35;
        pillarColors[index*6+2] = tint.b * 0.35;
        pillarColors[index*6+3] = tint.r;
        pillarColors[index*6+4] = tint.g;
        pillarColors[index*6+5] = tint.b;
      });
      markerGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      markerGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      markerGeometry.computeBoundingSphere();
      pillarGeometry.setAttribute("position", new THREE.BufferAttribute(pillarPositions, 3));
      pillarGeometry.setAttribute("color", new THREE.BufferAttribute(pillarColors, 3));
      pillarGeometry.computeBoundingSphere();
      pillars.visible = state.pillars && points.length > 0;

      const anti = state.showAntipodes
        ? points.filter((event) => event.family === "earthquake" && event.antipode)
        : [];
      const antiPositions = new Float32Array(anti.length * 3);
      anti.forEach((event, index) => {
        const vector = solar.geoToVector(event.antipode[0], event.antipode[1], 1.008);
        antiPositions[index*3] = vector.x;
        antiPositions[index*3+1] = vector.y;
        antiPositions[index*3+2] = vector.z;
      });
      antipodeGeometry.setAttribute("position", new THREE.BufferAttribute(antiPositions, 3));
      antipodeGeometry.computeBoundingSphere();
      antipodeMarkers.visible = anti.length > 0;

      state.hovered = null;
      describe();
    }
  };

  applyCamera();
  resize();
  updateSun();
  requestAnimationFrame(frame);
  window.dispatchEvent(new Event("earth-globe-ready"));

  loadGibsTexture(GIBS_FAST).then(({ texture, loaded, total }) => {
    if (texture) globeUniforms.dayMap.value = texture;
    if (loaded < total) {
      setStatus(
        loaded === 0
          ? "NASA imagery unavailable — showing a plain graticule. Event positions are unaffected."
          : "NASA Blue Marble loaded with " + (total - loaded) + " of " + total + " tiles missing."
      );
      setTimeout(describe, 4000);
    } else {
      describe();
    }
  }).catch(() => {
    setStatus("NASA imagery unavailable — showing a plain graticule. Event positions are unaffected.");
  });
  </script>
</body>
</html>`;
}
