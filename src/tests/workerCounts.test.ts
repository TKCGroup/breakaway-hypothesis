import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryWatcherRepository, type EventUpsertResult } from "../db/repository.js";
import type { NormalizedEvent } from "../types.js";
import { runOnce } from "../worker.js";
import { NOW } from "./helpers.js";

const USGS_SOURCE = "usgs_earthquake_geojson";

function usgsFeed() {
  return {
    features: ["good-1", "bad-1"].map((id, index) => ({
      id,
      properties: {
        mag: 1.5,
        place: `${index + 1} km S of Mount Rainier`,
        time: NOW.getTime() - index * 60_000,
        updated: NOW.getTime() - index * 60_000,
        url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
        type: "earthquake",
        status: "reviewed"
      },
      geometry: { coordinates: [-121.76, 46.84, 4] }
    }))
  };
}

class FailingWriteRepository extends InMemoryWatcherRepository {
  override async upsertEvent(event: NormalizedEvent): Promise<EventUpsertResult> {
    if (event.externalId === "bad-1") {
      throw new Error("simulated write failure");
    }
    return super.upsertEvent(event);
  }
}

describe("source run is recorded after the write, with counts", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("earthquake.usgs.gov/earthquakes/feed")) {
        return new Response(JSON.stringify(usgsFeed()), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("unavailable in this test", { status: 503 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("marks the run error when a fetched record fails to persist, and the cycle survives", async () => {
    const repo = new FailingWriteRepository();
    await expect(runOnce(NOW, repo)).resolves.toBeUndefined();

    const run = (await repo.listSourceRuns()).find((item) => item.source === USGS_SOURCE);
    expect(run?.status).toBe("error");
    expect(run?.recordsSeen).toBe(2);
    expect(run?.recordsPersisted).toBe(1);
    expect(run?.recordsFailed).toBe(1);
    expect(run?.error).toContain("persist failed for 1 of 2");
    expect((await repo.listEvents()).map((event) => event.externalId)).toEqual(["good-1"]);
  });

  it("counts persisted rows on first sight and unchanged rows on the next cycle", async () => {
    const repo = new InMemoryWatcherRepository();
    await runOnce(NOW, repo);
    await runOnce(new Date(NOW.getTime() + 15 * 60_000), repo);

    const runs = (await repo.listSourceRuns())
      .filter((item) => item.source === USGS_SOURCE)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ status: "success", recordsSeen: 2, recordsPersisted: 2, recordsUnchanged: 0, recordsFailed: 0 });
    expect(runs[1]).toMatchObject({ status: "success", recordsSeen: 2, recordsPersisted: 0, recordsUnchanged: 2, recordsFailed: 0 });
  });
});
