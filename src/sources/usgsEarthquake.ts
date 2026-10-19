import { createHash } from "node:crypto";
import { matchRegion } from "../logic/regionMatcher.js";
import type { NormalizedEvent, SourceBatch } from "../types.js";

export const USGS_QUAKE_FEEDS = {
  all_hour: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
  all_day: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  all_week: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson",
  significant_month: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson"
} as const;

interface UsgsFeature {
  id: string;
  properties: {
    mag: number | null;
    place: string | null;
    time: number;
    updated: number;
    url: string;
    detail?: string;
    type: string;
    status?: string;
    title?: string;
  };
  geometry: {
    coordinates: [lon: number, lat: number, depthKm: number];
  } | null;
}

interface UsgsCollection {
  features: UsgsFeature[];
}

export async function fetchUsgsEarthquakeFeed(
  feed: keyof typeof USGS_QUAKE_FEEDS = "all_day",
  now = new Date()
): Promise<NormalizedEvent[]> {
  const response = await fetch(USGS_QUAKE_FEEDS[feed], { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`USGS earthquake feed failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as UsgsCollection;
  return data.features.map((feature) => normalizeUsgsEarthquakeFeature(feature, now));
}

// One malformed feature used to throw out of the whole map and fail the
// source's run for every other earthquake in the feed. The worker reads this
// batch form: each feature that will not normalize is returned as rejected.
export async function fetchUsgsEarthquakeBatch(
  feed: keyof typeof USGS_QUAKE_FEEDS = "all_day",
  now = new Date()
): Promise<SourceBatch> {
  const response = await fetch(USGS_QUAKE_FEEDS[feed], { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`USGS earthquake feed failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as UsgsCollection;
  if (!Array.isArray(data?.features)) {
    throw new Error("USGS earthquake feed has no features array");
  }
  const batch: SourceBatch = { events: [], rejected: [] };
  data.features.forEach((feature, index) => {
    try {
      batch.events.push(normalizeUsgsEarthquakeFeature(feature, now));
    } catch (error) {
      batch.rejected.push({
        externalId: typeof feature?.id === "string" && feature.id ? feature.id : `feature-index:${index}`,
        reason: "parse_error",
        detail: error instanceof Error ? error.message : String(error),
        rawJson: feature ?? null
      });
    }
  });
  return batch;
}

export async function fetchUsgsEarthquakeBackfill(
  params: {
    startTime: Date;
    endTime: Date;
    minLat?: number;
    maxLat?: number;
    minLon?: number;
    maxLon?: number;
    minMagnitude?: number;
  },
  now = new Date()
): Promise<NormalizedEvent[]> {
  const response = await fetch(usgsFdsnQueryUrl(params), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`USGS FDSN backfill failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as UsgsCollection;
  return data.features.map((feature) => normalizeUsgsEarthquakeFeature(feature, now, "usgs_fdsn_backfill"));
}

export function normalizeUsgsEarthquakeFeature(
  feature: UsgsFeature,
  ingestTime = new Date(),
  source: "usgs_earthquake_geojson" | "usgs_fdsn_backfill" = "usgs_earthquake_geojson"
): NormalizedEvent {
  if (!feature.geometry) {
    throw new Error(`USGS feature ${feature.id} missing geometry`);
  }
  const [lon, lat, depthKm] = feature.geometry.coordinates;
  const eventTime = new Date(feature.properties.time);
  const sourceUpdatedAt = new Date(feature.properties.updated);
  const title = feature.properties.title ?? `${feature.properties.mag ?? "M?"} - ${feature.properties.place ?? "Unknown"}`;

  return {
    id: stableId(source, feature.id),
    source,
    externalId: feature.id,
    eventType: "earthquake",
    title,
    eventTime,
    sourceUpdatedAt,
    ingestTime,
    region: matchRegion(lat, lon),
    lat,
    lon,
    depthKm,
    magnitude: feature.properties.mag ?? undefined,
    severity: feature.properties.status,
    officialUrl: feature.properties.url,
    rawJson: feature
  };
}

export function usgsFdsnQueryUrl(params: {
  startTime: Date;
  endTime: Date;
  minLat?: number;
  maxLat?: number;
  minLon?: number;
  maxLon?: number;
  minMagnitude?: number;
}): string {
  const query = new URLSearchParams({
    format: "geojson",
    eventtype: "earthquake",
    orderby: "time",
    starttime: params.startTime.toISOString(),
    endtime: params.endTime.toISOString()
  });
  if (params.minLat !== undefined) query.set("minlatitude", String(params.minLat));
  if (params.maxLat !== undefined) query.set("maxlatitude", String(params.maxLat));
  if (params.minLon !== undefined) query.set("minlongitude", String(params.minLon));
  if (params.maxLon !== undefined) query.set("maxlongitude", String(params.maxLon));
  if (params.minMagnitude !== undefined) query.set("minmagnitude", String(params.minMagnitude));
  return `https://earthquake.usgs.gov/fdsnws/event/1/query?${query.toString()}`;
}

function stableId(source: string, externalId: string): string {
  return createHash("sha256").update(`${source}:${externalId}`).digest("hex").slice(0, 24);
}
