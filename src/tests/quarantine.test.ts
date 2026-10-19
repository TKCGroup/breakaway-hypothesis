import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryWatcherRepository } from "../db/repository.js";
import { FUTURE_TOLERANCE_MS, ingestRejection } from "../logic/ingestGate.js";
import { runOnce } from "../worker.js";
import { eventFixture, NOW } from "./helpers.js";

const DAY = 86_400_000;

describe("ingest gate", () => {
  it("refuses an observation 16 days ahead and keeps clock-skew and NWS onsets", () => {
    const eonet = eventFixture({ source: "nasa_eonet", eventType: "natural_event", eventTime: new Date(NOW.getTime() + 16 * DAY) });
    expect(ingestRejection(eonet, NOW)?.reason).toBe("future_event_time");

    const skew = eventFixture({ eventTime: new Date(NOW.getTime() + 10 * 60_000) });
    expect(ingestRejection(skew, NOW)).toBeUndefined();

    const edge = eventFixture({ eventTime: new Date(NOW.getTime() + FUTURE_TOLERANCE_MS) });
    expect(ingestRejection(edge, NOW)).toBeUndefined();

    const nwsOnset = eventFixture({ source: "nws_alerts", eventType: "weather_alert", eventTime: new Date(NOW.getTime() + 2 * DAY) });
    expect(ingestRejection(nwsOnset, NOW)).toBeUndefined();

    expect(ingestRejection(eventFixture({ eventTime: new Date("not a date") }), NOW)?.reason).toBe("invalid_event_time");
  });
});

describe("worker quarantine", () => {
  const originalFetch = globalThis.fetch;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("earthquake.usgs.gov/earthquakes/feed")) {
        return json({
          features: [
            {
              id: "good-quake",
              properties: {
                mag: 1.2,
                place: "3 km S of Mount Rainier",
                time: NOW.getTime() - 60_000,
                updated: NOW.getTime() - 60_000,
                url: "https://earthquake.usgs.gov/earthquakes/eventpage/good-quake",
                type: "earthquake",
                status: "reviewed"
              },
              geometry: { coordinates: [-121.76, 46.84, 4] }
            },
            {
              id: "no-geometry",
              properties: { mag: 1.0, place: "somewhere", time: NOW.getTime(), updated: NOW.getTime(), url: "https://earthquake.usgs.gov/x", type: "earthquake" },
              geometry: null
            }
          ]
        });
      }
      if (url.includes("eonet.gsfc.nasa.gov")) {
        return json({
          events: [
            {
              id: "EONET_FUTURE",
              title: "Wildfire dated 16 days ahead",
              link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_FUTURE",
              closed: null,
              categories: [{ id: "wildfires", title: "Wildfires" }],
              geometry: [{ date: new Date(NOW.getTime() + 16 * DAY).toISOString(), type: "Point", coordinates: [-121, 44] }]
            }
          ]
        });
      }
      if (url.includes("noaa-planetary-k-index")) {
        return json([
          ["time_tag", "Kp", "a_running", "station_count"],
          ["2026-07-08 09:00:00.000", "2.33", "9", "8"],
          ["garbage", null, null, null]
        ]);
      }
      return new Response("unavailable in this test", { status: 503 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("quarantines one malformed USGS feature instead of failing the source", async () => {
    const repo = new InMemoryWatcherRepository();
    await runOnce(NOW, repo);

    const usgs = (await repo.listSourceRuns()).find((run) => run.source === "usgs_earthquake_geojson");
    expect(usgs).toMatchObject({ status: "success", recordsSeen: 2, recordsPersisted: 1, recordsQuarantined: 1, recordsFailed: 0 });
    const held = (await repo.listQuarantine()).find((record) => record.externalId === "no-geometry");
    expect(held).toMatchObject({ source: "usgs_earthquake_geojson", reason: "parse_error" });
    expect((await repo.listEvents()).map((event) => event.externalId)).toContain("good-quake");
  });

  it("quarantines an EONET observation 16 days ahead and never stores it as an event", async () => {
    const repo = new InMemoryWatcherRepository();
    await runOnce(NOW, repo);

    const eonet = (await repo.listSourceRuns()).find((run) => run.source === "nasa_eonet");
    expect(eonet).toMatchObject({ status: "success", recordsSeen: 1, recordsPersisted: 0, recordsQuarantined: 1 });
    expect((await repo.listQuarantine()).find((record) => record.externalId === "EONET_FUTURE")?.reason).toBe("future_event_time");
    expect((await repo.listEvents()).map((event) => event.externalId)).not.toContain("EONET_FUTURE");
  });

  it("counts and keeps an unreadable SWPC row instead of dropping it", async () => {
    const repo = new InMemoryWatcherRepository();
    await runOnce(NOW, repo);

    const swpc = (await repo.listSourceRuns()).find((run) => run.source === "swpc_kp");
    expect(swpc).toMatchObject({ status: "success", recordsSeen: 2, recordsPersisted: 1, recordsQuarantined: 1 });
    expect((await repo.listQuarantine()).some((record) => record.source === "swpc_kp" && record.reason === "unparseable_row")).toBe(true);
  });
});
