import { loadConfig, type RegionRule, type WatcherConfig } from "./config.js";
import { createRepository } from "./db/createRepository.js";
import type { WatcherRepository } from "./db/repository.js";
import { fetchUsgsEarthquakeBackfill } from "./sources/usgsEarthquake.js";
import type { RegionBaseline, RegionId } from "./types.js";

export interface UsgsQueryBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface BaselineBackfillOptions {
  now?: Date;
  config?: WatcherConfig;
  windowDays?: number[];
  minMagnitude?: number;
}

export interface BaselineBackfillRegionSummary {
  region: RegionId;
  windowDays: number;
  eventsMatched: number;
  baselineCount24h: number;
}

export interface BaselineBackfillSummary {
  officialSource: "usgs_fdsn_backfill";
  startedAt: Date;
  completedAt: Date;
  eventsUpserted: number;
  baselinesSaved: number;
  regions: BaselineBackfillRegionSummary[];
}

export async function runBaselineBackfill(
  repo: WatcherRepository,
  options: BaselineBackfillOptions = {}
): Promise<BaselineBackfillSummary> {
  const startedAt = options.now ?? new Date();
  const config = options.config ?? loadConfig();
  const windowDays = options.windowDays ?? baselineWindowDaysFromEnv();
  const minMagnitude = options.minMagnitude ?? Number(process.env.BASELINE_MIN_MAGNITUDE ?? 0);
  const seenEvents = new Set<string>();
  const regions: BaselineBackfillRegionSummary[] = [];
  let eventsUpserted = 0;
  let baselinesSaved = 0;

  for (const days of windowDays) {
    const startTime = new Date(startedAt.getTime() - days * 24 * 3_600_000);

    for (const region of config.regions) {
      const events = await fetchUsgsEarthquakeBackfill(
        {
          ...regionQueryBounds(region),
          startTime,
          endTime: startedAt,
          minMagnitude
        },
        startedAt
      );
      const matched = events.filter((event) => event.region === region.id);

      for (const event of matched) {
        const key = `${event.source}:${event.externalId}`;
        if (seenEvents.has(key)) {
          continue;
        }
        seenEvents.add(key);
        const result = await repo.upsertEvent(event);
        if (result.status !== "unchanged") {
          eventsUpserted += 1;
        }
      }

      const baseline: RegionBaseline = {
        region: region.id,
        metric: "earthquakes_count_24h",
        windowDays: days,
        computedAt: startedAt,
        value: matched.length / days,
        sampleCount: matched.length
      };
      await repo.saveRegionBaseline(baseline);
      baselinesSaved += 1;
      regions.push({
        region: region.id,
        windowDays: days,
        eventsMatched: matched.length,
        baselineCount24h: baseline.value
      });
    }
  }

  return {
    officialSource: "usgs_fdsn_backfill",
    startedAt,
    completedAt: new Date(),
    eventsUpserted,
    baselinesSaved,
    regions
  };
}

export function baselineWindowDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number[] {
  const windows = [
    Number(env.BASELINE_DAYS_SHORT ?? 30),
    Number(env.BASELINE_DAYS_LONG ?? 90)
  ].filter((value) => Number.isFinite(value) && value > 0);
  return [...new Set(windows)].sort((a, b) => a - b);
}

export function regionQueryBounds(region: RegionRule): UsgsQueryBounds {
  if (region.bbox) {
    const [minLon, minLat, maxLon, maxLat] = region.bbox;
    return { minLat, maxLat, minLon, maxLon };
  }

  if (!region.center || !region.radiusKm) {
    throw new Error(`Region ${region.id} requires either bbox or center/radius for backfill`);
  }

  const [lat, lon] = region.center;
  const latDelta = region.radiusKm / 111.32;
  const lonDelta = region.radiusKm / (111.32 * Math.max(0.1, Math.cos(toRadians(lat))));

  return {
    minLat: clamp(lat - latDelta, -90, 90),
    maxLat: clamp(lat + latDelta, -90, 90),
    minLon: clamp(lon - lonDelta, -180, 180),
    maxLon: clamp(lon + lonDelta, -180, 180)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const handle = createRepository();
  runBaselineBackfill(handle.repo)
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await handle.close();
    });
}
