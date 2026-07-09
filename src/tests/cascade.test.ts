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
