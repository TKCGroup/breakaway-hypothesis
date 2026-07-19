import { loadConfig } from "./config.js";
import { createRepository } from "./db/createRepository.js";
import { InMemoryWatcherRepository, type WatcherRepository } from "./db/repository.js";
import { compareRegionalRate } from "./logic/baseline.js";
import { evaluateCascade } from "./logic/cascade.js";
import { DryRunNotifier, notificationDedupeKey } from "./logic/notifier.js";
import { WatcherScheduler } from "./scheduler.js";
import { fetchDonkiEvents } from "./sources/donki.js";
import { fetchSwpcKp } from "./sources/swpc.js";
import { fetchTsunamiFeed } from "./sources/tsunami.js";
import { fetchUsgsEarthquakeFeed } from "./sources/usgsEarthquake.js";
import { fetchHansElevatedVolcanoes } from "./sources/usgsHans.js";
import type { NormalizedEvent, NotificationRecord, RegionBaseline, RegionId, WatchWindow } from "./types.js";

export async function runOnce(now = new Date(), repo: WatcherRepository = new InMemoryWatcherRepository()): Promise<void> {
  const config = loadConfig();
  const notifier = new DryRunNotifier({
    dryRun: config.dryRun,
    webhookUrl: config.notifyWebhookUrl,
    slackBotToken: config.slackBotToken,
    slackChannelId: config.slackChannelId,
    suppressDuplicateHours: config.notifier.suppressDuplicateHours,
    now
  });

  const sourceTasks = [
    { source: "usgs_earthquake_geojson", run: () => fetchUsgsEarthquakeFeed("all_day", now) },
    { source: "usgs_hans", run: () => fetchHansElevatedVolcanoes(now) },
    { source: "swpc_kp", run: () => fetchSwpcKp(now) },
    { source: "nasa_donki", run: () => fetchDonkiEvents(config.nasaApiKey, now) },
    { source: "tsunami_ntwc", run: () => fetchTsunamiFeed("ntwc", now) },
    { source: "tsunami_ptwc", run: () => fetchTsunamiFeed("ptwc", now) }
  ];

  const batches = await Promise.allSettled(
    sourceTasks.map(async (task) => {
      const run = await repo.startSourceRun(task.source, now);
      try {
        const events = await task.run();
        await repo.finishSourceRun(run.id, {
          status: "success",
          recordsSeen: events.length,
          completedAt: new Date()
        });
        return events;
      } catch (error) {
        await repo.finishSourceRun(run.id, {
          status: "error",
          recordsSeen: 0,
          error: error instanceof Error ? error.message : String(error),
          completedAt: new Date()
        });
        throw error;
      }
    })
  );

  const events: NormalizedEvent[] = [];
  for (const event of batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []))) {
    events.push((await repo.upsertEvent(event)).event);
  }

  const currentWindows: WatchWindow[] = [];
  for (const event of events) {
    const state = evaluateCascade({ event, now, config });
    await repo.saveCascadeState(state);
    if (state.stage !== "S1") {
      continue;
    }
    const window = {
      id: `window:${event.id}`,
      triggerEventId: event.id,
      triggerType: event.severity ?? "space_weather",
      startedAt: event.eventTime,
      endsAt: new Date(event.eventTime.getTime() + 72 * 3_600_000),
      active: true
    };
    await repo.saveWatchWindow(window);
    currentWindows.push(window);
  }

  const windows = await activeWatchWindows(repo, currentWindows, now);
  const baselines = await repo.listRegionBaselines();
  const tsunamiStatus = highestTsunamiStatus(events);
  const previousNotifications = await repo.listNotifications();
  for (const event of events) {
    const state = evaluateCascade({
      event,
      activeWindows: windows,
      baseline: baselineForEvent(event, events, baselines, now),
      now,
      config,
      tsunamiStatus
    });
    await repo.saveCascadeState(state);
    const result = await notifier.notify(event, state, previousNotifications);
    if (result.payload && !result.suppressed) {
      const notification: NotificationRecord = {
        id: `notification:${result.payload.dedupeKey}:${state.stage}`,
        cascadeStateId: state.id,
        sentAt: new Date(),
        channel: result.channel ?? (result.dryRun ? "dry_run" : "webhook"),
        title: result.payload.title,
        body: result.payload.body,
        dedupeKey: notificationDedupeKey(result.payload, state)
      };
      await repo.saveNotification(notification);
      previousNotifications.unshift(notification);
      console.log(JSON.stringify(result, null, 2));
    }
  }

  for (const failed of batches.filter((batch) => batch.status === "rejected")) {
    console.error((failed as PromiseRejectedResult).reason);
  }
}

async function activeWatchWindows(
  repo: WatcherRepository,
  currentWindows: WatchWindow[],
  now: Date
): Promise<WatchWindow[]> {
  const windowsById = new Map<string, WatchWindow>();
  for (const window of await repo.listWatchWindows()) {
    windowsById.set(window.id, window);
  }
  for (const window of currentWindows) {
    windowsById.set(window.id, window);
  }

  const active: WatchWindow[] = [];
  for (const window of windowsById.values()) {
    if (window.active && window.endsAt > now) {
      active.push(window);
      continue;
    }
    if (window.active) {
      await repo.saveWatchWindow({ ...window, active: false });
    }
  }
  return active;
}

function baselineForEvent(
  event: NormalizedEvent,
  events: NormalizedEvent[],
  baselines: RegionBaseline[],
  now: Date
) {
  if (event.eventType !== "earthquake" || !event.region) {
    return undefined;
  }

  const baseline = bestBaselineForRegion(event.region, baselines);
  if (!baseline) {
    return undefined;
  }

  return compareRegionalRate(event.region, events, baseline.value, now);
}

function bestBaselineForRegion(region: RegionId, baselines: RegionBaseline[]): RegionBaseline | undefined {
  return baselines
    .filter((baseline) => baseline.region === region && baseline.metric === "earthquakes_count_24h")
    .sort((a, b) => b.windowDays - a.windowDays)[0];
}

function highestTsunamiStatus(events: NormalizedEvent[]): "none" | "statement" | "watch" | "advisory" | "warning" {
  const rank = { none: 0, statement: 1, watch: 2, advisory: 3, warning: 4 } as const;
  let highest: keyof typeof rank = "none";

  for (const event of events) {
    if (event.eventType !== "tsunami") {
      continue;
    }
    const severity = (event.severity ?? event.title).toLowerCase();
    const status = severity.includes("warning")
      ? "warning"
      : severity.includes("advisory")
        ? "advisory"
        : severity.includes("watch")
          ? "watch"
          : "statement";
    if (rank[status] > rank[highest]) {
      highest = status;
    }
  }

  return highest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const handle = createRepository();
  const run = () => runOnce(new Date(), handle.repo);

  if (process.argv.includes("--loop")) {
    const scheduler = new WatcherScheduler({
      pollIntervalMinutes: config.pollIntervalMinutes,
      runOnce: run,
      onError: (error) => console.error(error)
    });
    scheduler.start();
    const shutdown = () => {
      scheduler.stop();
      void handle.close();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } else {
    run()
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      })
      .finally(() => {
        void handle.close();
      });
  }
}
