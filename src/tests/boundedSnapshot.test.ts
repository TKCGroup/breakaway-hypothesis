import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import { buildDashboardDataFromSnapshot, loadDashboardSnapshot } from "../dashboard.js";
import { InMemoryWatcherRepository } from "../db/repository.js";
import { buildEarthWatchData } from "../earth.js";
import { NOW } from "./helpers.js";
import { populateSnapshotFixture } from "./snapshotFixture.js";

const fixtureRepo = () => populateSnapshotFixture(new InMemoryWatcherRepository());

describe("bounded page snapshot", () => {
  it("reads fewer rows and drops raw_json from catalogue history", async () => {
    const repo = await fixtureRepo();
    const full = await loadDashboardSnapshot(repo, NOW, { bounded: false });
    const bounded = await loadDashboardSnapshot(repo, NOW);

    expect(bounded.events.length).toBeLessThan(full.events.length);
    expect(bounded.events.map((event) => event.id)).not.toContain("ancient");
    // The only region-less row is still one of the 12 newest the page lists.
    expect(bounded.events.find((event) => event.id === "old-eonet")?.rawJson).toEqual({});
    expect(bounded.sourceRuns.length).toBeLessThan(full.sourceRuns.length);
    expect(bounded.notifications.length).toBeLessThan(full.notifications.length);

    const history = bounded.events.find((event) => event.id === "backfill-5");
    expect(history?.rawJson).toBeNull();
    // Rows a state points at come back whole even though they are old.
    expect(bounded.events.find((event) => event.id === "volcano")?.rawJson).toEqual({ alertLevel: "ADVISORY" });
    expect(bounded.events.find((event) => event.id === "yellowstone-old")?.rawJson).toEqual({ k: "yellowstone" });
  });

  it("builds a /api/dashboard identical to the unbounded one", async () => {
    const repo = await fixtureRepo();
    const full = buildDashboardDataFromSnapshot(await loadDashboardSnapshot(repo, NOW, { bounded: false }), DEFAULT_CONFIG, NOW);
    const bounded = buildDashboardDataFromSnapshot(await loadDashboardSnapshot(repo, NOW), DEFAULT_CONFIG, NOW);
    expect(JSON.stringify(bounded)).toBe(JSON.stringify(full));
  });

  it("builds a /api/earth identical to the unbounded one", async () => {
    const repo = await fixtureRepo();
    const full = buildEarthWatchData(await loadDashboardSnapshot(repo, NOW, { bounded: false }), DEFAULT_CONFIG, NOW);
    const bounded = buildEarthWatchData(await loadDashboardSnapshot(repo, NOW), DEFAULT_CONFIG, NOW);
    expect(JSON.stringify(bounded)).toBe(JSON.stringify(full));
  });
});
