import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import type { DashboardSnapshot } from "../dashboard.js";
import {
  buildEarthWatchData,
  earthquakeMapContextWindowHours
} from "../earth.js";
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
      staleGateResult: "passed",
      mapContext: {
        eligible: true,
        result: "fresh",
        windowHours: 24
      }
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
    expect(data.map.focus).toMatchObject({
      mode: "signal_cluster",
      center: [35.15, -97.1]
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
    expect(data.map.focus).toEqual({
      mode: "us_fallback",
      center: [39.5, -98.35],
      zoom: 4,
      score: 0,
      label: "United States fallback",
      eventIds: []
    });
  });

  it("keeps major earthquakes in map context without bypassing the notification stale gate", () => {
    const snapshot = emptySnapshot();
    snapshot.events = [
      eventFixture({
        id: "japan-major",
        externalId: "japan-major",
        title: "M 7.1 - east of Japan",
        eventTime: new Date("2026-07-07T06:00:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-07T06:30:00.000Z"),
        ingestTime: new Date("2026-07-07T06:35:00.000Z"),
        region: undefined,
        lat: 38.1,
        lon: 142.4,
        magnitude: 7.1
      }),
      eventFixture({
        id: "small-current",
        externalId: "small-current",
        title: "M 2.4 - current United States event"
      })
    ];

    const data = buildEarthWatchData(snapshot, DEFAULT_CONFIG, NOW);
    const major = data.map.events.find((event) => event.id === "japan-major");

    expect(major).toMatchObject({
      staleGatePassed: false,
      staleGateResult: "blocked",
      mapContext: {
        eligible: true,
        result: "magnitude_extended",
        windowHours: 168,
        eventAgeHours: 30,
        sourceAgeHours: 29.5
      }
    });
    expect(major?.staleGateReasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^event_time_outside_max_age:/),
        expect.stringMatching(/^source_updated_at_stale:/)
      ])
    );
    expect(data.summary.currentFreshSignals).toBe(1);
    expect(data.summary.activeMapSignals).toBe(2);
    expect(data.map.focus).toMatchObject({
      mode: "signal_cluster",
      center: [38.1, 142.4],
      eventIds: ["japan-major"]
    });
  });

  it("applies the disclosed magnitude windows at their boundaries", () => {
    expect([
      earthquakeMapContextWindowHours(3.9),
      earthquakeMapContextWindowHours(4),
      earthquakeMapContextWindowHours(5.9),
      earthquakeMapContextWindowHours(6),
      earthquakeMapContextWindowHours(6.9),
      earthquakeMapContextWindowHours(7)
    ]).toEqual([2, 24, 24, 72, 72, 168]);

    const snapshot = emptySnapshot();
    const dateConflict = agedEarthquake("m7-date-conflict", 7.2, 30);
    dateConflict.title = "M 7.2 - conflicting 2025 catalog label";
    snapshot.events = [
      agedEarthquake("m3-expired", 3.9, 3),
      eventFixture({
        id: "m3-feed-updated",
        externalId: "m3-feed-updated",
        title: "M 3.9 - source refreshed after map window",
        eventTime: new Date(NOW.getTime() - 3 * 3_600_000),
        sourceUpdatedAt: NOW,
        magnitude: 3.9,
        region: undefined
      }),
      agedEarthquake("m5-active", 5.9, 23),
      agedEarthquake("m5-expired", 5.9, 25),
      agedEarthquake("m6-active", 6.2, 71),
      agedEarthquake("m7-expired", 7.2, 169),
      dateConflict
    ];

    const byId = new Map(
      buildEarthWatchData(snapshot, DEFAULT_CONFIG, NOW).map.events.map(
        (event) => [event.id, event]
      )
    );
    expect(byId.get("m3-expired")?.mapContext.eligible).toBe(false);
    expect(byId.get("m3-feed-updated")?.staleGatePassed).toBe(true);
    expect(byId.get("m3-feed-updated")?.mapContext.eligible).toBe(false);
    expect(byId.get("m5-active")?.mapContext.result).toBe(
      "magnitude_extended"
    );
    expect(byId.get("m5-expired")?.mapContext.eligible).toBe(false);
    expect(byId.get("m6-active")?.mapContext.result).toBe(
      "magnitude_extended"
    );
    expect(byId.get("m7-expired")?.mapContext.eligible).toBe(false);
    expect(byId.get("m7-date-conflict")?.staleGateReasons).toContain(
      "title_or_body_date_conflicts_with_feed_timestamp"
    );
    expect(byId.get("m7-date-conflict")?.mapContext.eligible).toBe(false);
  });
});

function agedEarthquake(
  id: string,
  magnitude: number,
  ageHours: number
): ReturnType<typeof eventFixture> {
  const occurredAt = new Date(NOW.getTime() - ageHours * 3_600_000);
  return eventFixture({
    id,
    externalId: id,
    title: `M ${magnitude.toFixed(1)} - map context boundary test`,
    eventTime: occurredAt,
    sourceUpdatedAt: occurredAt,
    ingestTime: occurredAt,
    magnitude,
    region: undefined
  });
}

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
