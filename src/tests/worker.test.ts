import { describe, expect, it, vi } from "vitest";
import { InMemoryWatcherRepository } from "../db/repository.js";
import { runOnce } from "../worker.js";
import { NOW } from "./helpers.js";

describe("worker", () => {
  it("uses persisted S1 windows and stored baselines on later scheduler ticks", async () => {
    const originalFetch = globalThis.fetch;
    const logMock = vi.spyOn(console, "log").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("earthquake.usgs.gov/earthquakes/feed")) {
        return jsonResponse({
          features: Array.from({ length: 4 }, (_, index) => ({
            id: `uw-rainier-${index}`,
            properties: {
              mag: 1.1,
              place: `${index + 1} km S of Mount Rainier`,
              time: new Date(NOW.getTime() - index * 60_000).getTime(),
              updated: new Date(NOW.getTime() - index * 60_000).getTime(),
              url: `https://earthquake.usgs.gov/earthquakes/eventpage/uw-rainier-${index}`,
              type: "earthquake",
              status: "reviewed"
            },
            geometry: { coordinates: [-121.76, 46.84, 4] }
          }))
        });
      }
      if (url.includes("volcanoes.usgs.gov") || url.includes("api.nasa.gov")) {
        return jsonResponse([]);
      }
      if (url.includes("eonet.gsfc.nasa.gov")) {
        return jsonResponse({
          events: [
            {
              id: "EONET_TEST",
              title: "Test wildfire",
              link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_TEST",
              closed: null,
              categories: [{ id: "wildfires", title: "Wildfires" }],
              geometry: [
                {
                  magnitudeValue: 500,
                  magnitudeUnit: "acres",
                  date: NOW.toISOString(),
                  type: "Point",
                  coordinates: [-121, 44]
                }
              ]
            }
          ]
        });
      }
      if (url.includes("api.weather.gov")) {
        return jsonResponse({
          features: [
            {
              id: "https://api.weather.gov/alerts/test",
              properties: {
                id: "test-alert",
                event: "Flash Flood Warning",
                areaDesc: "Test County",
                sent: NOW.toISOString(),
                effective: NOW.toISOString(),
                onset: NOW.toISOString(),
                expires: new Date(NOW.getTime() + 60 * 60_000).toISOString(),
                severity: "Severe",
                certainty: "Observed",
                urgency: "Immediate",
                "@id": "https://api.weather.gov/alerts/test"
              }
            }
          ]
        });
      }
      if (url.includes("services.swpc.noaa.gov")) {
        return jsonResponse([["time_tag", "Kp"]]);
      }
      if (url.includes("tsunami.gov")) {
        return new Response("<feed></feed>", { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const repo = new InMemoryWatcherRepository();
    await repo.saveWatchWindow({
      id: "window:prior-kp6",
      triggerEventId: "prior-kp6",
      triggerType: "Kp6/G2",
      startedAt: new Date(NOW.getTime() - 60 * 60_000),
      endsAt: new Date(NOW.getTime() + 71 * 60 * 60_000),
      active: true,
      kpMax: 6
    });
    await repo.saveRegionBaseline({
      region: "CASCADE_VOLCANOES_RAINIER",
      metric: "earthquakes_count_24h",
      windowDays: 90,
      computedAt: NOW,
      value: 1,
      sampleCount: 90
    });

    try {
      await runOnce(NOW, repo);

      const states = await repo.listCascadeStates();
      expect(
        states.some(
          (state) =>
            state.region === "CASCADE_VOLCANOES_RAINIER" &&
            state.stage === "S3" &&
            state.reason.includes("quake rate 4.0x baseline")
        )
      ).toBe(true);
      expect(await repo.listNotifications()).not.toHaveLength(0);
      const contextEventIds = (await repo.listEvents())
        .filter((event) => event.eventType === "natural_event" || event.eventType === "weather_alert")
        .map((event) => event.id);
      expect(contextEventIds).toHaveLength(2);
      expect(states.every((state) => !contextEventIds.includes(state.latestEventId))).toBe(true);
    } finally {
      logMock.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
