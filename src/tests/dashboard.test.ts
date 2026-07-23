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
    await repo.saveCascadeState(
      cascadeFixture({
        id: "cascade-previous",
        stage: "S1",
        stageStartedAt: new Date(NOW.getTime() - 15 * 60_000),
        shouldNotify: false
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
    expect(data.posture).toMatchObject({
      stage: "S3",
      label: "Elevated watch",
      action: "Review now",
      sourceHealth: "degraded"
    });
    expect(data.latestCycle).toMatchObject({
      officialEventsIngested: 2,
      targetEventsIngested: 1,
      alertsSent: 1,
      sourceFailures: [],
      materialChange: true
    });
    expect(data.latestCycle.stageChanges).toEqual([
      {
        region: "CASCADE_VOLCANOES_RAINIER",
        label: "Mount Rainier",
        fromStage: "S1",
        toStage: "S3"
      }
    ]);
    expect(data.sources.find((source) => source.source === "usgs_earthquake_geojson")).toMatchObject({
      status: "ok",
      recordsSeen: 2
    });
    expect(data.regions.find((region) => region.region === "CASCADE_VOLCANOES_RAINIER")).toMatchObject({
      stage: "S3",
      stageLabel: "Elevated",
      staleGatePassed: true,
      alertThreshold: "M3.5+ | 50 quakes/24h | 4x baseline | depth <= 8 km | HANS above NORMAL",
      latestEvent: {
        externalId: "us7000test",
        source: "usgs_earthquake_geojson"
      }
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

  it("selects a fresh same-cycle state and builds deduplicated USGS activity context", async () => {
    const repo = new InMemoryWatcherRepository();
    const currentEvents = Array.from({ length: 3 }, (_, index) =>
      eventFixture({
        id: `st-helens-current-${index}`,
        externalId: `uw-current-${index}`,
        title: `M 0.${index + 4} - Mount St. Helens`,
        eventTime: new Date(NOW.getTime() - index * 60 * 60_000),
        sourceUpdatedAt: NOW,
        region: "CASCADE_VOLCANOES_ST_HELENS",
        magnitude: 0.4 + index / 10,
        officialUrl: `https://earthquake.usgs.gov/earthquakes/eventpage/uw-current-${index}`
      })
    );
    const priorEvents = Array.from({ length: 5 }, (_, index) =>
      eventFixture({
        id: `st-helens-prior-${index}`,
        source: "usgs_fdsn_backfill",
        externalId: `uw-prior-${index}`,
        title: `M 0.${index + 1} - Mount St. Helens`,
        eventTime: new Date(NOW.getTime() - (72 * 60 + index * 15) * 60_000),
        sourceUpdatedAt: new Date(NOW.getTime() - 72 * 3_600_000),
        ingestTime: NOW,
        region: "CASCADE_VOLCANOES_ST_HELENS",
        magnitude: 0.1 + index / 10,
        officialUrl: `https://earthquake.usgs.gov/earthquakes/eventpage/uw-prior-${index}`
      })
    );
    for (const event of [...currentEvents, ...priorEvents]) {
      await repo.upsertEvent(event);
    }
    await repo.upsertEvent(
      eventFixture({
        id: "st-helens-negative",
        externalId: "uw-negative",
        title: "M -0.3 - Mount St. Helens",
        eventTime: NOW,
        sourceUpdatedAt: NOW,
        region: "CASCADE_VOLCANOES_ST_HELENS",
        magnitude: -0.3,
        officialUrl:
          "https://earthquake.usgs.gov/earthquakes/eventpage/uw-negative"
      })
    );
    await repo.upsertEvent({
      ...currentEvents[0],
      id: "st-helens-current-0-backfill",
      source: "usgs_fdsn_backfill"
    });
    await repo.saveRegionBaseline({
      region: "CASCADE_VOLCANOES_ST_HELENS",
      metric: "earthquakes_count_24h",
      windowDays: 90,
      computedAt: NOW,
      value: 0.77,
      sampleCount: 69
    });
    await repo.saveCascadeState(
      cascadeFixture({
        id: "st-helens-fresh-s3",
        region: "CASCADE_VOLCANOES_ST_HELENS",
        stage: "S3",
        latestEventId: currentEvents[0].id,
        reason: "quake rate 3.0x baseline (3 quakes/24h) during active S1 window"
      })
    );
    await repo.saveCascadeState(
      cascadeFixture({
        id: "st-helens-stale-s5",
        region: "CASCADE_VOLCANOES_ST_HELENS",
        stage: "S5",
        latestEventId: priorEvents[0].id,
        staleGatePassed: false,
        staleGate: {
          ...cascadeFixture().staleGate,
          passed: false,
          eventFresh: false,
          reasons: ["event_time_outside_max_age:72h"]
        },
        shouldNotify: false
      })
    );

    const data = await buildDashboardData(repo, DEFAULT_CONFIG, NOW);
    const region = data.regions.find(
      (item) => item.region === "CASCADE_VOLCANOES_ST_HELENS"
    );

    expect(data.posture.stage).toBe("S3");
    expect(region).toMatchObject({
      stage: "S3",
      effectiveStage: "S3",
      staleGatePassed: true,
      latestEvent: { externalId: "uw-current-0" },
      activity: {
        catalogMinMagnitude: 0,
        currentCount24h: 3,
        baselineCount24h: 0.77,
        rateMultiple: 3,
        previousAtOrAbove: { count: 5 },
        recentPeak: { count: 5 }
      }
    });
    expect(region?.activity?.sparkline).toHaveLength(90);
    expect(region?.activity?.percentile).toBeGreaterThan(90);
    expect(region?.activity?.officialContext).toHaveLength(2);
    expect(region?.activity?.officialContext[0].source).toBe(
      "USGS Cascades Volcano Observatory"
    );
  });

  it("does not promote a stale elevated candidate into the operating posture", async () => {
    const repo = new InMemoryWatcherRepository();
    const event = eventFixture({
      id: "stale-event",
      region: "CASCADE_VOLCANOES_ST_HELENS"
    });
    await repo.upsertEvent(event);
    await repo.saveCascadeState(
      cascadeFixture({
        id: "blocked-candidate",
        region: "CASCADE_VOLCANOES_ST_HELENS",
        stage: "S3",
        latestEventId: event.id,
        activeWindowId: "window-1",
        staleGatePassed: false,
        staleGate: {
          ...cascadeFixture().staleGate,
          passed: false,
          eventFresh: false,
          reasons: ["event_time_outside_max_age:13h"]
        },
        shouldNotify: false
      })
    );

    const data = await buildDashboardData(repo, DEFAULT_CONFIG, NOW);
    const region = data.regions.find(
      (item) => item.region === "CASCADE_VOLCANOES_ST_HELENS"
    );

    expect(data.posture.stage).toBe("S1");
    expect(region).toMatchObject({
      stage: "S3",
      effectiveStage: "S1",
      operatorSummary: "Candidate S3 signal blocked because freshness checks did not pass."
    });
  });
});
