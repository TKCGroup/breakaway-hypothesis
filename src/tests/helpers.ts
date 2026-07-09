import type { CascadeState, NormalizedEvent, RegionId, StaleGateResult } from "../types.js";

export const NOW = new Date("2026-07-08T12:00:00.000Z");

export function eventFixture(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: "evt-1",
    source: "usgs_earthquake_geojson",
    externalId: "us7000test",
    eventType: "earthquake",
    title: "M 2.4 - 3 km S of Mount Rainier",
    eventTime: new Date("2026-07-08T11:30:00.000Z"),
    sourceUpdatedAt: new Date("2026-07-08T11:45:00.000Z"),
    ingestTime: NOW,
    region: "CASCADE_VOLCANOES_RAINIER",
    lat: 46.84,
    lon: -121.76,
    depthKm: 4,
    magnitude: 2.4,
    officialUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test",
    rawJson: {},
    ...overrides
  };
}

export function passedStaleGate(): StaleGateResult {
  return {
    passed: true,
    checkedAt: NOW,
    reasons: [],
    sourceOfficial: true,
    eventFresh: true,
    sourceFresh: true,
    titleDateConsistent: true,
    snippetOnly: false
  };
}

export function cascadeFixture(overrides: Partial<CascadeState> = {}): CascadeState {
  const region: RegionId = "CASCADE_VOLCANOES_RAINIER";
  return {
    id: "cascade-1",
    region,
    stage: "S3",
    stageStartedAt: NOW,
    latestEventId: "evt-1",
    reason: "quake rate 4.0x baseline during active S1 window",
    confidence: 0.75,
    staleGatePassed: true,
    staleGate: passedStaleGate(),
    shouldNotify: true,
    ...overrides
  };
}
