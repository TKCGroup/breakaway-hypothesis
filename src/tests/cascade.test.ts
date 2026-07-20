import { describe, expect, it } from "vitest";
import { compareRegionalRate } from "../logic/baseline.js";
import { createSpaceWeatherWindow, evaluateCascade } from "../logic/cascade.js";
import { eventFixture, NOW } from "./helpers.js";

describe("cascade", () => {
  it("Kp6 alone creates S1 window and sends no alert", () => {
    const kpEvent = eventFixture({
      id: "kp-1",
      source: "swpc_kp",
      externalId: "2026-07-08T10:00:00.000Z:6",
      eventType: "space_weather",
      title: "NOAA/SWPC planetary K-index 6",
      eventTime: new Date("2026-07-08T10:00:00.000Z"),
      sourceUpdatedAt: NOW,
      officialUrl: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
      severity: "Kp6/G2",
      rawJson: { kp: 6 },
      region: undefined
    });

    const window = createSpaceWeatherWindow(kpEvent);
    const state = evaluateCascade({ event: kpEvent, now: NOW });

    expect(window).toBeDefined();
    expect(state.stage).toBe("S1");
    expect(state.shouldNotify).toBe(false);
  });

  it("Kp6 + normal seismic baseline remains S1/no alert", () => {
    const window = {
      id: "w1",
      triggerEventId: "kp-1",
      triggerType: "Kp6/G2",
      startedAt: new Date("2026-07-08T08:00:00.000Z"),
      endsAt: new Date("2026-07-11T08:00:00.000Z"),
      active: true,
      kpMax: 6
    };
    const state = evaluateCascade({
      event: eventFixture({ magnitude: 1.1 }),
      activeWindows: [window],
      baseline: { region: "CASCADE_VOLCANOES_RAINIER", currentCount24h: 3, baselineCount24h: 3, rateMultiple: 1 },
      now: NOW
    });

    expect(state.stage).toBe("S1");
    expect(state.shouldNotify).toBe(false);
  });

  it("Kp6 + 4x regional quake rate promotes to S3", () => {
    const recent = Array.from({ length: 20 }, (_, index) =>
      eventFixture({
        id: `q-${index}`,
        externalId: `q-${index}`,
        eventTime: new Date(NOW.getTime() - index * 60_000)
      })
    );
    const baseline = compareRegionalRate("CASCADE_VOLCANOES_RAINIER", recent, 5, NOW);
    const state = evaluateCascade({
      event: eventFixture(),
      activeWindows: [
        {
          id: "w1",
          triggerEventId: "kp-1",
          triggerType: "Kp6/G2",
          startedAt: new Date("2026-07-08T08:00:00.000Z"),
          endsAt: new Date("2026-07-11T08:00:00.000Z"),
          active: true,
          kpMax: 6
        }
      ],
      baseline,
      now: NOW
    });

    expect(baseline.rateMultiple).toBe(4);
    expect(state.stage).toBe("S3");
    expect(state.shouldNotify).toBe(true);
  });

  it("does not promote official global M5+ earthquakes outside configured regions", () => {
    const outsideEvents = [
      eventFixture({
        id: "us7000t21e",
        externalId: "us7000t21e",
        title: "M 5.0 - south of the Kermadec Islands",
        eventTime: new Date("2026-07-20T20:44:19.902Z"),
        sourceUpdatedAt: new Date("2026-07-20T21:05:24.040Z"),
        ingestTime: new Date("2026-07-20T21:15:07.709Z"),
        region: undefined,
        lat: -32.759,
        lon: -178.0878,
        depthKm: 10,
        magnitude: 5,
        officialUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000t21e"
      }),
      eventFixture({
        id: "us7000t21z",
        externalId: "us7000t21z",
        title: "M 5.6 - northern Mid-Atlantic Ridge",
        eventTime: new Date("2026-07-20T21:28:30.326Z"),
        sourceUpdatedAt: new Date("2026-07-20T21:53:05.069Z"),
        ingestTime: new Date("2026-07-20T22:00:25.776Z"),
        region: undefined,
        lat: 14.5216,
        lon: -45.1002,
        depthKm: 10,
        magnitude: 5.6,
        officialUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000t21z"
      })
    ];

    for (const event of outsideEvents) {
      const state = evaluateCascade({ event, now: new Date("2026-07-20T22:15:00.000Z") });

      expect(state.stage).toBe("S0");
      expect(state.shouldNotify).toBe(false);
      expect(state.reason).toBe("official earthquake outside configured target regions");
    }
  });

  it("does not notify from comparator-only earthquake regions", () => {
    const state = evaluateCascade({
      event: eventFixture({
        id: "us7000t1x5",
        externalId: "us7000t1x5",
        title: "M 4.8 - 14 km NE of Guiria, Venezuela",
        eventTime: new Date("2026-07-20T10:55:00.820Z"),
        sourceUpdatedAt: new Date("2026-07-20T20:40:39.721Z"),
        ingestTime: new Date("2026-07-20T20:45:11.224Z"),
        region: "CARIBBEAN_VENEZUELA_COMPARATOR",
        lat: 10.6707,
        lon: -62.2023,
        depthKm: 66,
        magnitude: 4.8,
        officialUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000t1x5"
      }),
      now: new Date("2026-07-20T22:26:34.000Z")
    });

    expect(state.stage).toBe("S0");
    expect(state.shouldNotify).toBe(false);
    expect(state.reason).toBe("comparator-only earthquake region; stored for baseline comparison");
  });

  it("official HANS elevated volcano immediately promotes to S4", () => {
    const state = evaluateCascade({
      event: eventFixture({
        id: "hans-1",
        source: "usgs_hans",
        externalId: "st-helens-notice-1",
        eventType: "volcano_notice",
        title: "USGS HANS Mount St. Helens: ADVISORY/YELLOW",
        region: "CASCADE_VOLCANOES_ST_HELENS",
        severity: "ADVISORY/YELLOW",
        officialUrl: "https://volcanoes.usgs.gov/hans-public/"
      }),
      now: NOW
    });

    expect(state.stage).toBe("S4");
    expect(state.shouldNotify).toBe(true);
  });

  it("tsunami warning/advisory immediately notifies regardless of solar context", () => {
    const state = evaluateCascade({
      event: eventFixture({
        id: "tsu-1",
        source: "tsunami_ntwc",
        externalId: "ntwc-1",
        eventType: "tsunami",
        title: "Tsunami Warning",
        severity: "warning",
        officialUrl: "https://www.tsunami.gov/events/xml/PAAQAtom.xml",
        region: "PNW_CASCADIA_OFFSHORE"
      }),
      now: NOW
    });

    expect(state.stage).toBe("S5");
    expect(state.shouldNotify).toBe(true);
  });
});
