import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import { buildDashboardDataFromSnapshot, loadDashboardSnapshot } from "../dashboard.js";
import { runMigrations } from "../db/migrations.js";
import { PostgresWatcherRepository } from "../db/postgresRepository.js";
import { InMemoryWatcherRepository } from "../db/repository.js";
import { buildEarthWatchData } from "../earth.js";
import { NOW } from "./helpers.js";
import { populateSnapshotFixture } from "./snapshotFixture.js";

// Runs the real SQL. Set EARTH_PG_TEST_URL to a THROWAWAY database: this test
// drops and recreates every watcher table in it.
const url = process.env.EARTH_PG_TEST_URL;

describe.skipIf(!url)("bounded snapshot against real Postgres", () => {
  let repo: PostgresWatcherRepository;

  beforeAll(async () => {
    repo = PostgresWatcherRepository.fromConnectionString(url!);
    const pool = (repo as unknown as { pool: { query: (sql: string) => Promise<unknown> } }).pool;
    await pool.query(
      "DROP TABLE IF EXISTS notifications, cascade_states, space_weather_windows, region_baselines, events, source_runs CASCADE"
    );
    await runMigrations(url!);
    await runMigrations(url!); // idempotent at boot
    await populateSnapshotFixture(repo);
  });

  afterAll(async () => {
    await repo?.close();
  });

  it("returns the same rows as the in-memory reference for the same bounds", async () => {
    const memory = await populateSnapshotFixture(new InMemoryWatcherRepository());
    const shape = (events: { id: string; rawJson: unknown }[]) =>
      events.map((event) => `${event.id}:${event.rawJson === null ? "history" : "whole"}`).sort();
    const pg = await loadDashboardSnapshot(repo, NOW);
    const mem = await loadDashboardSnapshot(memory, NOW);
    expect(shape(pg.events)).toEqual(shape(mem.events));
    expect(pg.sourceRuns.map((run) => run.id).sort()).toEqual(mem.sourceRuns.map((run) => run.id).sort());
    expect(pg.notifications.map((n) => n.id).sort()).toEqual(mem.notifications.map((n) => n.id).sort());
    expect(pg.events.length).toBeGreaterThan(0);
  });

  it("builds both pages identically from the bounded and the unbounded Postgres reads", async () => {
    const full = await loadDashboardSnapshot(repo, NOW, { bounded: false });
    const bounded = await loadDashboardSnapshot(repo, NOW);
    expect(bounded.events.length).toBeLessThan(full.events.length);
    expect(JSON.stringify(buildDashboardDataFromSnapshot(bounded, DEFAULT_CONFIG, NOW))).toBe(
      JSON.stringify(buildDashboardDataFromSnapshot(full, DEFAULT_CONFIG, NOW))
    );
    expect(JSON.stringify(buildEarthWatchData(bounded, DEFAULT_CONFIG, NOW))).toBe(
      JSON.stringify(buildEarthWatchData(full, DEFAULT_CONFIG, NOW))
    );
  });

  it("creates the time indexes", async () => {
    const pool = (repo as unknown as { pool: { query: (sql: string) => Promise<{ rows: { indexname: string }[] }> } }).pool;
    const names = (await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).rows.map(
      (row) => row.indexname
    );
    for (const index of [
      "events_event_time_idx",
      "events_ingest_time_idx",
      "source_runs_source_started_at_idx",
      "cascade_states_region_started_at_idx",
      "notifications_sent_at_idx"
    ]) {
      expect(names).toContain(index);
    }
  });
});
