import { describe, expect, it } from "vitest";
import type { RepositoryHandle } from "../db/createRepository.js";
import { postgresPoolConfig, PostgresWatcherRepository, type PostgresRepositoryOptions } from "../db/postgresRepository.js";
import { InMemoryWatcherRepository } from "../db/repository.js";
import { createWatcherServer, type WatcherServerOptions } from "../server.js";
import type { NormalizedEvent } from "../types.js";

// tkc-codex 5d3cb2f6: the default /earth list read every event ever stored, and its
// four-second cap did not bound the response because the route awaited pool.end().

const LOADING = "Loading official signals.";
const DAY = 86_400_000;

function quake(id: string, eventTime: Date): NormalizedEvent {
  return {
    id,
    source: "usgs_earthquake_geojson",
    externalId: id,
    eventType: "earthquake",
    title: `M5.1 ${id}`,
    eventTime,
    sourceUpdatedAt: eventTime,
    ingestTime: eventTime,
    lat: 46.84,
    lon: -121.76,
    magnitude: 5.1,
    officialUrl: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
    rawJson: {}
  };
}

async function getEarth(options: WatcherServerOptions) {
  const server = createWatcherServer(options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  const started = Date.now();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/earth`);
    const body = await response.text();
    return { status: response.status, body, elapsedMs: Date.now() - started };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("GET /earth server-rendered list bounds", () => {
  it("answers at the 4 s default cap while a 6 s read is still in flight (the reviewer's control)", async () => {
    const repo = new InMemoryWatcherRepository();
    let pending: Promise<NormalizedEvent[]> | undefined;
    const slow = () => {
      pending = new Promise((resolve) => setTimeout(() => resolve([]), 6000));
      return pending;
    };
    repo.listEvents = slow;
    repo.listEventsBetween = slow;
    const { status, body, elapsedMs } = await getEarth({
      // close() waits for the in-flight read, exactly like pool.end() on a real handle
      createRepositoryHandle: () => ({ repo, close: async () => { await pending; } })
    });
    expect(status).toBe(200);
    expect(elapsedMs).toBeLessThan(5000);
    expect(elapsedMs).toBeGreaterThanOrEqual(3900);
    expect(body).toContain(LOADING);
  }, 15_000);

  it("never reads the whole events table; asks only for the ±30-day window, capped", async () => {
    const repo = new InMemoryWatcherRepository();
    const now = Date.now();
    await repo.upsertEvent(quake("recent", new Date(now - 60 * 60 * 1000)));
    repo.listEvents = async () => {
      throw new Error("unbounded listEvents() must not be called by /earth");
    };
    const calls: Array<{ from: Date; to: Date; limit: number }> = [];
    const between = repo.listEventsBetween.bind(repo);
    repo.listEventsBetween = (from, to, limit) => {
      calls.push({ from, to, limit });
      return between(from, to, limit);
    };
    const { status, body } = await getEarth({ createRepositoryHandle: () => ({ repo, close: async () => {} }) });
    expect(status).toBe(200);
    expect(body).not.toContain(LOADING);
    expect(body).toContain("M5.1 recent");
    expect(calls).toHaveLength(1);
    expect(calls[0].limit).toBe(20_000);
    expect(Math.abs(now - 30 * DAY - calls[0].from.getTime())).toBeLessThan(60_000);
    expect(Math.abs(now + 30 * DAY - calls[0].to.getTime())).toBeLessThan(60_000);
  });

  it("renders no list (not a partial ranking) when the window reaches the row ceiling", async () => {
    const repo = new InMemoryWatcherRepository();
    const now = Date.now();
    await repo.upsertEvent(quake("a", new Date(now - 2 * 60 * 60 * 1000)));
    await repo.upsertEvent(quake("b", new Date(now - 60 * 60 * 1000)));
    const { body } = await getEarth({
      createRepositoryHandle: () => ({ repo, close: async () => {} }),
      globeList: { maxEventRows: 2 }
    });
    expect(body).toContain(LOADING);
    expect(body).not.toContain("M5.1 a");
  });

  it("opens the list's repository handle with a database-side statement timeout equal to the cap", async () => {
    const seen: Array<PostgresRepositoryOptions | undefined> = [];
    const repo = new InMemoryWatcherRepository();
    await getEarth({
      createRepositoryHandle: (options): RepositoryHandle => {
        seen.push(options);
        return { repo, close: async () => {} };
      },
      globeList: { timeoutMs: 1500 }
    });
    expect(seen).toEqual([{ statementTimeoutMs: 1500 }]);
  });
});

describe("bounded event reads in the repositories", () => {
  it("in-memory: window inclusive at both ends, newest first, limited", async () => {
    const repo = new InMemoryWatcherRepository();
    const t = (h: number) => new Date(Date.UTC(2026, 9, 6, h));
    for (const h of [1, 2, 3, 4, 5]) await repo.upsertEvent(quake(`h${h}`, t(h)));
    const got = await repo.listEventsBetween(t(2), t(4), 10);
    expect(got.map((e) => e.id)).toEqual(["h4", "h3", "h2"]);
    expect((await repo.listEventsBetween(t(1), t(5), 2)).map((e) => e.id)).toEqual(["h5", "h4"]);
  });

  it("postgres: the list query carries WHERE on event_time and a LIMIT, all parameterised", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const fakePool = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        return { rows: [] };
      }
    };
    const repo = new PostgresWatcherRepository(fakePool as never);
    const from = new Date("2026-09-06T00:00:00Z");
    const to = new Date("2026-11-05T00:00:00Z");
    await repo.listEventsBetween(from, to, 20_000);
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/WHERE event_time >= \$1 AND event_time <= \$2 ORDER BY event_time DESC LIMIT \$3/);
    expect(queries[0].values).toEqual([from, to, 20_000]);
  });

  it("postgres: statement_timeout reaches the pool config only when asked for", () => {
    expect(postgresPoolConfig("postgres://x", { statementTimeoutMs: 4000 })).toMatchObject({ statement_timeout: 4000, max: 5 });
    expect(postgresPoolConfig("postgres://x")).not.toHaveProperty("statement_timeout");
  });
});
