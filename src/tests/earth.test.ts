import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import type { DashboardSnapshot } from "../dashboard.js";
import { buildEarthWatchData } from "../earth.js";
import { eventFixture, NOW } from "./helpers.js";

describe("Earth Watch data", () => {
  it("maps official events with provenance, geometry, cascade stage, and stale-gate output", () => {
    const snapshot = emptySnapshot();
    snapshot.events = [
      eventFixture({
        id: "quake",
        externalId: "quake",
        title: "M 4.2 - Mount St. Helens region",
        magnitude: 4.2,
        region: "CASCADE_VOLCANOES_ST_HELENS"
      }),
      eventFixture({
        id: "weather",
        source: "nws_alerts",
        externalId: "weather",
        eventType: "weather_alert",
        title: "Tornado Warning: Test County",
        eventTime: new Date("2026-07-08T11:40:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:45:00.000Z"),
        region: undefined,
        lat: undefined,
        lon: undefined,
        magnitude: undefined,
        depthKm: undefined,
        severity: "Extreme/Observed/Immediate",
        officialUrl: "https://api.weather.gov/alerts/test",
        rawJson: {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-97.2, 35.1],
                [-97.0, 35.1],
                [-97.0, 35.3],
                [-97.2, 35.1]
              ]
            ]
          },
          properties: {
            ends: "2026-07-08T13:00:00.000Z"
          }
        }
      }),
      eventFixture({
        id: "eonet",
        source: "nasa_eonet",
        externalId: "EONET_TEST",
        eventType: "natural_event",
        title: "Wildfire test event",
        eventTime: new Date("2026-07-08T11:20:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:20:00.000Z"),
        region: undefined,
        lat: 44.8,
        lon: -121,
        magnitude: undefined,
        depthKm: undefined,
        severity: "Wildfires",
        officialUrl:
          "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_TEST",
        rawJson: {
          closed: null,
          geometry: [
            {
              date: "2026-07-08T11:20:00.000Z",
              type: "Point",
              coordinates: [-121, 44.8]
            }
          ]
        }
      })
    ];
    snapshot.cascadeStates = [
      {
        id: "state",
        region: "CASCADE_VOLCANOES_ST_HELENS",
        stage: "S3",
        stageStartedAt: NOW,
        latestEventId: "quake",
        reason: "fresh local event",
        confidence: 0.75,
        staleGatePassed: true,
        staleGate: {
          passed: true,
          checkedAt: NOW,
          reasons: [],
          sourceOfficial: true,
          eventFresh: true,
          sourceFresh: true,
          titleDateConsistent: true,
          snippetOnly: false
        },
        shouldNotify: true
      }
    ];

    const data = buildEarthWatchData(snapshot, DEFAULT_CONFIG, NOW);

    expect(data.system.officialOnly).toBe(true);
    expect(data.map.events).toHaveLength(3);
    expect(data.map.events.find((event) => event.id === "quake")).toMatchObject({
      source: "usgs_earthquake_geojson",
      geometry: {
        type: "Point",
        coordinates: [-121.76, 46.84]
      },
      cascadeStage: "S3",
      staleGatePassed: true,
      staleGateResult: "passed"
    });
    expect(data.map.events.find((event) => event.id === "weather")).toMatchObject({
      source: "nws_alerts",
      family: "weather",
      status: "current",
      geometry: {
        type: "Polygon"
      },
      staleGatePassed: true
    });
    expect(data.map.events.find((event) => event.id === "eonet")).toMatchObject({
      source: "nasa_eonet",
      family: "natural",
      geometry: {
        type: "Point",
        coordinates: [-121, 44.8]
      },
      staleGatePassed: true
    });
    for (const event of data.map.events) {
      expect(event.eventTime).toBeTruthy();
      expect(event.sourceUpdatedAt).toBeTruthy();
      expect(event.ingestTime).toBeTruthy();
      expect(event.officialUrl).toMatch(/^https:\/\//);
    }
  });

  it("excludes news and backfill while separating non-spatial official context", () => {
    const snapshot = emptySnapshot();
    snapshot.events = [
      eventFixture({
        id: "news",
        source: "news",
        externalId: "news",
        officialUrl: "https://example.invalid/story"
      }),
      eventFixture({
        id: "backfill",
        source: "usgs_fdsn_backfill",
        externalId: "backfill"
      }),
      eventFixture({
        id: "space",
        source: "swpc_kp",
        externalId: "space",
        eventType: "space_weather",
        title: "NOAA SWPC planetary K index",
        eventTime: new Date("2026-07-08T11:30:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:45:00.000Z"),
        region: undefined,
        lat: undefined,
        lon: undefined,
        magnitude: undefined,
        depthKm: undefined,
        officialUrl:
          "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
        rawJson: { kp: 6 }
      })
    ];

    const data = buildEarthWatchData(snapshot, DEFAULT_CONFIG, NOW);

    expect(data.map.events).toEqual([]);
    expect(data.map.nonSpatialSignals).toHaveLength(1);
    expect(data.map.nonSpatialSignals[0]).toMatchObject({
      id: "space",
      family: "space_weather",
      staleGatePassed: true
    });
    expect(
      [...data.map.events, ...data.map.nonSpatialSignals].some(
        (event) => event.source === "news" || event.source === "usgs_fdsn_backfill"
      )
    ).toBe(false);
  });

  it("publishes configured target geometry and omits comparator-only regions", () => {
    const data = buildEarthWatchData(emptySnapshot(), DEFAULT_CONFIG, NOW);

    expect(
      data.map.regions.find(
        (region) => region.id === "CASCADE_VOLCANOES_ST_HELENS"
      )
    ).toMatchObject({
      center: [46.1912, -122.1944],
      radiusKm: 25
    });
    expect(
      data.map.regions.find((region) => region.id === "PNW_CASCADIA_OFFSHORE")
    ).toMatchObject({
      bbox: [-132.5, 40, -122, 52.5]
    });
    expect(
      data.map.regions.some(
        (region) => region.id === "CARIBBEAN_VENEZUELA_COMPARATOR"
      )
    ).toBe(false);
  });
});

function emptySnapshot(): DashboardSnapshot {
  return {
    events: [],
    sourceRuns: [],
    cascadeStates: [],
    notifications: [],
    windows: [],
    baselines: []
  };
}
