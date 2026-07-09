import { DEFAULT_CONFIG, type RegionRule, type WatcherConfig } from "../config.js";
import type { RegionId } from "../types.js";

export function matchRegion(lat: number | undefined, lon: number | undefined, config: WatcherConfig = DEFAULT_CONFIG): RegionId | undefined {
  if (lat === undefined || lon === undefined) {
    return undefined;
  }

  const radiusMatch = config.regions.find((region) => {
    if (!region.center || !region.radiusKm) {
      return false;
    }
    return haversineKm(lat, lon, region.center[0], region.center[1]) <= region.radiusKm;
  });

  if (radiusMatch) {
    return radiusMatch.id;
  }

  return config.regions.find((region) => isInsideBbox(lat, lon, region))?.id;
}

export function getRegionRule(regionId: RegionId, config: WatcherConfig = DEFAULT_CONFIG): RegionRule {
  const rule = config.regions.find((region) => region.id === regionId);
  if (!rule) {
    throw new Error(`Unknown region rule: ${regionId}`);
  }
  return rule;
}

export function isInsideBbox(lat: number, lon: number, region: RegionRule): boolean {
  if (!region.bbox) {
    return false;
  }
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
