import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import { baselineWindowDaysFromEnv, regionQueryBounds, runBaselineBackfill } from "../backfill.js";
import { InMemoryWatcherRepository } from "../db/repository.js";
import { usgsFdsnQueryUrl } from "../sources/usgsEarthquake.js";
import { NOW } from "./helpers.js";

describe("baseline backfill", () => {
  it("builds official USGS FDSN earthquake query URLs", () => {
    const url = new URL(
      usgsFdsnQueryUrl({
        startTime: new Date("2026-07-01T00:00:00.000Z"),
        endTime: NOW,
        minLat: 45,
        maxLat: 47,
        minLon: -123,
        maxLon: -121,
        minMagnitude: 0
      })
    );

    expect(url.origin).toBe("https://earthquake.usgs.gov");
    expect(url.pathname).toBe("/fdsnws/event/1/query");
    expect(url.searchParams.get("format")).toBe("geojson");
    expect(url.searchParams.get("eventtype")).toBe("earthquake");
    expect(url.searchParams.get("orderby")).toBe("time");
  });

  it("derives bounded FDSN boxes for radius regions", () => {
    const bounds = regionQueryBounds(DEFAULT_CONFIG.regions[0]);

    expect(bounds.minLat).toBeLessThan(46.8523);
    expect(bounds.maxLat).toBeGreaterThan(46.8523);
    expect(bounds.minLon).toBeLessThan(-121.7603);
    expect(bounds.maxLon).toBeGreaterThan(-121.7603);
  });

  it("uses official FDSN events to save earthquake baselines", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          features: [
            {
              id: "uw-test-backfill",
              properties: {
                mag: 1.2,
                place: "2 km S of Mount Rainier",
                time: new Date("2026-07-07T12:00:00.000Z").getTime(),
                updated: new Date("2026-07-07T12:05:00.000Z").getTime(),
                url: "https://earthquake.usgs.gov/earthquakes/eventpage/uw-test-backfill",
                type: "earthquake",
                status: "reviewed"
              },
              geometry: { coordinates: [-121.76, 46.84, 3.1] }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const repo = new InMemoryWatcherRepository();

    try {
      const summary = await runBaselineBackfill(repo, {
        now: NOW,
        windowDays: [30],
        minMagnitude: 0,
        config: { ...DEFAULT_CONFIG, regions: [DEFAULT_CONFIG.regions[0]] }
      });

      expect(summary.officialSource).toBe("usgs_fdsn_backfill");
      expect(summary.baselinesSaved).toBe(1);
      expect(summary.eventsUpserted).toBe(1);
      expect((await repo.listEvents())[0].source).toBe("usgs_fdsn_backfill");
      expect(await repo.listRegionBaselines()).toMatchObject([
        {
          region: "CASCADE_VOLCANOES_RAINIER",
          metric: "earthquakes_count_24h",
          windowDays: 30,
          value: 1 / 30,
          sampleCount: 1
        }
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("dedupes short and long baseline windows from env", () => {
    expect(baselineWindowDaysFromEnv({ BASELINE_DAYS_SHORT: "30", BASELINE_DAYS_LONG: "30" })).toEqual([30]);
  });
});
