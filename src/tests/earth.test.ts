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
        eventTime: new Date(NOW.getTime() - 3.5 * 3_600_000),
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

  it("collapses official USGS aliases to the newest reviewed canonical event", () => {
    const snapshot = emptySnapshot();
    snapshot.events = [
      eventFixture({
        id: "pt-alias",
        externalId: "pt26209004",
        title: "M 7.1 - 4 km SE of Uki, Japan",
        eventTime: new Date("2026-07-08T11:28:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:36:32.000Z"),
        lat: 32.6,
        lon: 130.7,
        magnitude: 7.1,
        severity: "REVIEWED"
      }),
      eventFixture({
        id: "at-alias",
        externalId: "attivjdk",
        title: "M 7.1 - 4 km SE of Uki, Japan",
        eventTime: new Date("2026-07-08T11:27:39.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:07:39.000Z"),
        lat: 32.6,
        lon: 130.7,
        magnitude: 7.1,
        severity: "automatic"
      }),
      eventFixture({
        id: "canonical",
        externalId: "us6000tgb9",
        title: "M 6.8 - Uto, Japan Earthquake",
        eventTime: new Date("2026-07-08T11:24:15.512Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:55:37.000Z"),
        lat: 32.6817,
        lon: 130.7217,
        magnitude: 6.8,
        severity: "reviewed",
        rawJson: {
          id: "us6000tgb9",
          properties: {
            ids: ",attivjdk,pt26209004,us6000tgb9,"
          }
        }
      })
    ];

    const data = buildEarthWatchData(snapshot, DEFAULT_CONFIG, NOW);

    expect(data.map.events).toHaveLength(1);
    expect(data.map.events[0]).toMatchObject({
      id: "canonical",
      externalId: "us6000tgb9",
      magnitude: 6.8,
      severity: "reviewed"
    });
    expect(data.summary.activeMapSignals).toBe(1);
    expect(data.map.focus.eventIds).toEqual(["canonical"]);
  });

  it("uses bounded fuzzy earthquake deduplication without merging near misses", () => {
    const snapshot = emptySnapshot();
    snapshot.events = [
      eventFixture({
        id: "fuzzy-preliminary",
        externalId: "fuzzy-preliminary",
        eventTime: new Date("2026-07-08T11:00:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:05:00.000Z"),
        lat: 32.6,
        lon: 130.7,
        magnitude: 6.9,
        severity: "automatic"
      }),
      eventFixture({
        id: "fuzzy-reviewed",
        externalId: "fuzzy-reviewed",
        eventTime: new Date("2026-07-08T11:01:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:50:00.000Z"),
        lat: 32.68,
        lon: 130.72,
        magnitude: 6.7,
        severity: "reviewed"
      }),
      eventFixture({
        id: "outside-time",
        externalId: "outside-time",
        eventTime: new Date("2026-07-08T11:02:31.000Z"),
        lat: 32.68,
        lon: 130.72,
        magnitude: 6.7
      }),
      eventFixture({
        id: "outside-distance",
        externalId: "outside-distance",
        eventTime: new Date("2026-07-08T11:00:20.000Z"),
        lat: 33.2,
        lon: 130.7,
        magnitude: 6.9
      }),
      eventFixture({
        id: "outside-magnitude",
        externalId: "outside-magnitude",
        eventTime: new Date("2026-07-08T11:00:30.000Z"),
        lat: 32.6,
        lon: 130.7,
        magnitude: 6.3
      })
    ];

    const ids = buildEarthWatchData(
      snapshot,
      DEFAULT_CONFIG,
      NOW
    ).map.events.map((event) => event.id);

    expect(ids).toHaveLength(4);
    expect(ids).toContain("fuzzy-reviewed");
    expect(ids).not.toContain("fuzzy-preliminary");
    expect(ids).toEqual(
      expect.arrayContaining([
        "outside-time",
        "outside-distance",
        "outside-magnitude"
      ])
    );
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

/**
 * Verbatim `properties` from the live USGS all_week feed on 2026-08-14, kept whole
 * rather than trimmed to the fields under test. A fixture that carries only the keys
 * the code reads encodes an assumption about the payload instead of its shape, which
 * is how green tests ship real bugs.
 */
const USGS_FELT_PROPERTIES = {
  mag: 5.9,
  place: "36 km NE of Labuan Bajo, Indonesia",
  time: 1786745630869,
  updated: 1786753365423,
  tz: null,
  url: "https://earthquake.usgs.gov/earthquakes/eventpage/us6000tkta",
  detail: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/us6000tkta.geojson",
  felt: 1,
  cdi: 3.4,
  mmi: 6.722,
  alert: "green",
  status: "reviewed",
  tsunami: 0,
  sig: 536,
  net: "us",
  code: "6000tkta",
  ids: ",us6000tkta,",
  sources: ",us,",
  types: ",dyfi,ground-failure,losspager,origin,phase-data,shakemap,",
  nst: 72,
  dmin: 3.273,
  rms: 1.65,
  gap: 36,
  magType: "mb",
  type: "earthquake",
  title: "M 5.9 - 36 km NE of Labuan Bajo, Indonesia"
};

/** Same source, same day — the far more common case where USGS reports nulls. */
const USGS_UNREPORTED_PROPERTIES = {
  ...USGS_FELT_PROPERTIES,
  mag: 2,
  place: "6 km E of Clam Gulch, Alaska",
  url: "https://earthquake.usgs.gov/earthquakes/eventpage/aka2026qbplzh",
  felt: null,
  cdi: null,
  mmi: null,
  alert: null,
  status: "automatic",
  sig: 62,
  net: "ak",
  code: "a2026qbplzh",
  ids: ",aka2026qbplzh,",
  sources: ",ak,",
  types: ",origin,phase-data,",
  magType: "ml",
  title: "M 2.0 - 6 km E of Clam Gulch, Alaska"
};

/**
 * Verbatim `properties` from a live api.weather.gov active alert on 2026-08-14,
 * newlines and all. The description arrives hard-wrapped mid-sentence, which is
 * exactly the shape the popup has to survive — a fixture with tidy prose would
 * test a payload NWS never sends.
 */
const NWS_ALERT_PROPERTIES = {
  "@id": "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.ea9d6ca966da13a31b954a804353427ddbd4ac4b.002.1",
  id: "urn:oid:2.49.0.1.840.0.ea9d6ca966da13a31b954a804353427ddbd4ac4b.002.1",
  areaDesc: "Knox; Stark; Peoria; Marshall; Woodford; Fulton; Tazewell; McLean",
  sent: "2026-08-14T21:41:00-05:00",
  effective: "2026-08-14T21:41:00-05:00",
  onset: "2026-08-14T22:00:00-05:00",
  expires: "2026-08-15T10:00:00-05:00",
  status: "Actual",
  messageType: "Update",
  severity: "Severe",
  certainty: "Possible",
  urgency: "Future",
  event: "Flood Watch",
  sender: "w-nws.webmaster@noaa.gov",
  senderName: "NWS Lincoln IL",
  headline:
    "Flood Watch issued August 14 at 9:41PM CDT until August 15 at 10:00AM CDT by NWS Lincoln IL",
  description:
    "* WHAT...Flooding caused by excessive rainfall continues to be\npossible.\n\n* WHERE...Portions of central and west central Illinois.",
  instruction:
    "You should monitor later forecasts and be alert for possible Flood\nWarnings.",
  response: "Monitor",
  // Every NWS alert carries this literal value. It is why "open the official
  // record" had to stop meaning "open the machine feed".
  web: "http://www.weather.gov"
};

describe("Earth Watch event detail", () => {
  function alertEvent(rawProperties: unknown) {
    const snapshot = emptySnapshot();
    snapshot.events = [
      eventFixture({
        id: "alert",
        source: "nws_alerts",
        externalId: "alert",
        eventType: "weather_alert",
        title: "Flood Watch: Knox; Stark; Peoria",
        magnitude: undefined,
        depthKm: undefined,
        region: undefined,
        body: "Flood Watch issued August 14 at 9:41PM CDT",
        rawJson: { properties: rawProperties }
      })
    ];
    return buildEarthWatchData(snapshot, DEFAULT_CONFIG, NOW).map.events.find(
      (event) => event.id === "alert"
    )!;
  }

  it("lifts the agency's own words out of the stored alert", () => {
    const detail = alertEvent(NWS_ALERT_PROPERTIES).detail!;
    expect(detail.headline).toContain("Flood Watch issued August 14");
    expect(detail.summary).toContain("WHAT...Flooding caused by excessive rainfall");
    expect(detail.instruction).toContain("monitor later forecasts");
    expect(detail.issuedBy).toBe("NWS Lincoln IL");
    expect(detail.expiresAt).toBe(new Date("2026-08-15T10:00:00-05:00").toISOString());
  });

  it("does not repeat the headline as the summary when they are the same string", () => {
    // The real NWS case: the normaliser sets `body` to the headline, so with no
    // `description` in the payload both fields resolve to the identical sentence
    // and the popup would print it twice in a row.
    const headline = "Flood Watch issued August 14 at 9:41PM CDT";
    const snapshot = emptySnapshot();
    snapshot.events = [
      eventFixture({
        id: "dup",
        source: "nws_alerts",
        externalId: "dup",
        eventType: "weather_alert",
        magnitude: undefined,
        region: undefined,
        body: headline,
        rawJson: { properties: { headline } }
      })
    ];
    const detail = buildEarthWatchData(snapshot, DEFAULT_CONFIG, NOW).map.events.find(
      (event) => event.id === "dup"
    )!.detail!;
    expect(detail.headline).toBe(headline);
    expect(detail.summary).toBeUndefined();
  });

  it("emits no detail block at all when the agency published nothing", () => {
    const snapshot = emptySnapshot();
    snapshot.events = [
      eventFixture({ id: "bare", externalId: "bare", body: undefined, rawJson: {} })
    ];
    const event = buildEarthWatchData(snapshot, DEFAULT_CONFIG, NOW).map.events.find(
      (candidate) => candidate.id === "bare"
    )!;
    expect(event.detail).toBeUndefined();
  });

  it("ignores blank and non-string fields rather than rendering empty rows", () => {
    const detail = alertEvent({
      headline: "   ",
      description: "",
      instruction: 42,
      senderName: null,
      expires: "not-a-date",
      // eventFixture supplies a body, so a summary still survives; the point is
      // that none of the junk above becomes a rendered row.
    }).detail;
    expect(detail?.instruction).toBeUndefined();
    expect(detail?.issuedBy).toBeUndefined();
    expect(detail?.expiresAt).toBeUndefined();
  });
});

describe("Earth Watch shaking, antipodes, and felt rings", () => {
  function quakeWith(rawProperties: unknown, overrides = {}) {
    const snapshot = emptySnapshot();
    snapshot.events = [
      eventFixture({
        id: "quake",
        externalId: "us6000tkta",
        magnitude: 5.9,
        depthKm: 10,
        rawJson: { properties: rawProperties },
        ...overrides
      })
    ];
    return buildEarthWatchData(snapshot, DEFAULT_CONFIG, NOW).map.events.find(
      (event) => event.id === "quake"
    )!;
  }

  it("lifts the observed shaking fields out of the stored USGS payload", () => {
    const event = quakeWith(USGS_FELT_PROPERTIES);
    expect(event.shaking).toMatchObject({
      feltReports: 1,
      reportedIntensity: 3.4,
      instrumentalIntensity: 6.722,
      pagerAlert: "green",
      usgsEventId: "us6000tkta",
      hasShakeMap: true
    });
  });

  it("leaves unreported shaking undefined instead of manufacturing a zero", () => {
    // This is the whole reason `reportedNumber` exists. `Number(null)` is 0, and USGS
    // sends null on roughly 95% of a week's events, so the naive read would publish
    // "0 people felt this" as though it were a measurement.
    const event = quakeWith(USGS_UNREPORTED_PROPERTIES);
    expect(event.shaking!.feltReports).toBeUndefined();
    expect(event.shaking!.reportedIntensity).toBeUndefined();
    expect(event.shaking!.instrumentalIntensity).toBeUndefined();
    expect(event.shaking!.pagerAlert).toBeUndefined();
  });

  it("reports no ShakeMap when USGS has not published one", () => {
    expect(quakeWith(USGS_UNREPORTED_PROPERTIES).shaking!.hasShakeMap).toBe(false);
  });

  it("survives a payload with no properties at all", () => {
    const event = quakeWith(undefined);
    expect(event.shaking).toBeUndefined();
    expect(event.feltRings!.length).toBeGreaterThan(0);
  });

  it("carries the antipode of the epicentre", () => {
    const event = quakeWith(USGS_FELT_PROPERTIES);
    // eventFixture sits at 46.84N 121.76W, whose antipode is 46.84S 58.24E.
    expect(event.antipode![0]).toBeCloseTo(-46.84, 6);
    expect(event.antipode![1]).toBeCloseTo(58.24, 6);
  });

  it("gives earthquakes modeled rings and gives other hazards none", () => {
    expect(quakeWith(USGS_FELT_PROPERTIES).feltRings!.length).toBeGreaterThan(0);

    const snapshot = emptySnapshot();
    snapshot.events = [
      eventFixture({
        id: "weather",
        source: "nws_alerts",
        externalId: "weather",
        eventType: "weather_alert",
        title: "Tornado Warning: Test County",
        magnitude: undefined,
        region: undefined
      })
    ];
    const alert = buildEarthWatchData(snapshot, DEFAULT_CONFIG, NOW).map.events.find(
      (event) => event.id === "weather"
    )!;
    expect(alert.feltRings).toBeUndefined();
    expect(alert.shaking).toBeUndefined();
  });
});
