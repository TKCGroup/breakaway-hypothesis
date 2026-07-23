import type { NormalizedEvent, RegionId } from "../types.js";

export interface BaselineComparison {
  region: RegionId;
  currentCount24h: number;
  baselineCount24h: number;
  rateMultiple: number;
}

export function compareRegionalRate(
  region: RegionId,
  recentEvents: NormalizedEvent[],
  baselineCount24h: number,
  now = new Date(),
  minMagnitude = 0
): BaselineComparison {
  const dayAgo = now.getTime() - 24 * 3_600_000;
  const currentCount24h = recentEvents.filter(
    (event) =>
      event.region === region &&
      event.eventType === "earthquake" &&
      event.magnitude !== undefined &&
      event.magnitude >= minMagnitude &&
      event.eventTime.getTime() >= dayAgo
  ).length;
  const denominator = Math.max(1, baselineCount24h);

  return {
    region,
    currentCount24h,
    baselineCount24h,
    rateMultiple: currentCount24h / denominator
  };
}
