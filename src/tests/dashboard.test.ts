import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import { buildDashboardData } from "../dashboard.js";
import { InMemoryWatcherRepository } from "../db/repository.js";
import { cascadeFixture, eventFixture, NOW } from "./helpers.js";

describe("dashboard data", () => {
  it("summarizes official-source engine state without raw payloads", async () => {
    const repo = new InMemoryWatcherRepository();
    const run = await repo.startSourceRun("usgs_earthquake_geojson", NOW);
    await repo.finishSourceRun(run.id, {
      status: "success",
      recordsSeen: 2,
      completedAt: NOW
    });
    await repo.upsertEvent(eventFixture());
    await repo.upsertEvent(
      eventFixture({
        id: "evt-outside",
        externalId: "us7000t21z",
        title: "M 5.6 - northern Mid-Atlantic Ridge",
        region: undefined,
        lat: 14.5216,
        lon: -45.1002,
        magnitude: 5.6,
        officialUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000t21z"
      })
    );
    await repo.saveCascadeState(cascadeFixture());
    await repo.saveWatchWindow({
      id: "window-1",
      triggerEventId: "evt-1",
      triggerType: "kp_g1",
      startedAt: NOW,
      endsAt: new Date(NOW.getTime() + 6 * 3_600_000),
      active: true,
      kpMax: 5
    });
    await repo.saveRegionBaseline({
      region: "CASCADE_VOLCANOES_RAINIER",
      metric: "earthquakes_count_24h",
      windowDays: 90,
      computedAt: NOW,
      value: 0.2,
      sampleCount: 90
    });
    await repo.saveNotification({
      id: "notification-1",
      cascadeStateId: "cascade-1",
      sentAt: NOW,
      channel: "slack_bot",
      title: "GEOSPACE WATCH: S3 escalation - M 2.4 - 3 km S of Mount Rainier",
      body: "Official source: USGS",
      dedupeKey: "rainier:test:S3"
    });

    const data = await buildDashboardData(
      repo,
      {
        ...DEFAULT_CONFIG,
        dryRun: false,
        slackBotToken: "configured",
        slackChannelId: "C0AS8NB0LQY"
      },
      NOW
    );

    expect(data.system.mode).toBe("live");
    expect(data.system.officialOnly).toBe(true);
    expect(data.system.notificationChannel).toBe("slack_bot");
    expect(data.sources.find((source) => source.source === "usgs_earthquake_geojson")).toMatchObject({
      status: "ok",
      recordsSeen: 2
    });
    expect(data.regions.find((region) => region.region === "CASCADE_VOLCANOES_RAINIER")).toMatchObject({
      stage: "S3",
      staleGatePassed: true
    });
    expect(data.filteredOfficialEvents[0]).toMatchObject({
      externalId: "us7000t21z",
      region: undefined
    });
    expect(data.recentEvents[0]).not.toHaveProperty("rawJson");
    expect(data.activeWindows).toHaveLength(1);
    expect(data.recentNotifications).toHaveLength(1);
    expect(data.baselines[0]).toMatchObject({ region: "CASCADE_VOLCANOES_RAINIER", windowDays: 90 });
  });
});
