import { loadConfig } from "./config.js";
import { createRepository } from "./db/createRepository.js";
import { InMemoryWatcherRepository, type WatcherRepository } from "./db/repository.js";
import { compareRegionalRate } from "./logic/baseline.js";
import { evaluateCascade } from "./logic/cascade.js";
import { DryRunNotifier, notificationDedupeKey } from "./logic/notifier.js";
import { WatcherScheduler } from "./scheduler.js";
import { fetchDonkiEvents } from "./sources/donki.js";
import { fetchEonetEvents } from "./sources/eonet.js";
import { fetchNwsAlerts } from "./sources/nwsAlerts.js";
import { fetchNhcCurrentStorms } from "./sources/nhcCurrentStorms.js";
import { fetchSwpcKpBatch } from "./sources/swpc.js";
import { fetchTsunamiFeed } from "./sources/tsunami.js";
import { fetchUsgsEarthquakeBatch } from "./sources/usgsEarthquake.js";
import { fetchHansElevatedVolcanoes } from "./sources/usgsHans.js";
import { ingestRejection } from "./logic/ingestGate.js";
import type {
  NormalizedEvent,
  NotificationRecord,
  RegionBaseline,
  RegionId,
  RejectedRecord,
  SourceBatch,
  WatchWindow
} from "./types.js";

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
    { source: "usgs_earthquake_geojson", run: () => fetchUsgsEarthquakeBatch("all_day", now) },
    { source: "usgs_hans", run: () => fetchHansElevatedVolcanoes(now) },
    { source: "swpc_kp", run: () => fetchSwpcKpBatch(now) },
    { source: "nasa_donki", run: () => fetchDonkiEvents(config.nasaApiKey, now) },
    { source: "nasa_eonet", run: () => fetchEonetEvents(now) },
    { source: "nws_alerts", run: () => fetchNwsAlerts(now) },
    { source: "nhc_current_storms", run: () => fetchNhcCurrentStorms(now) },
    { source: "tsunami_ntwc", run: () => fetchTsunamiFeed("ntwc", now) },
    { source: "tsunami_ptwc", run: () => fetchTsunamiFeed("ptwc", now) }
  ];

  // A source run is `success` only after its rows are written. It used to be
  // marked success straight after the fetch, before upsertEvent ran, so a
  // failed write still read 96/96 success on the dashboard (10-15 evidence),
  // and one failed write threw out of the whole cycle. Now each source writes
  // its own rows, counts what happened, and a failed write fails only that
  // source's run, loudly, with the counts in the record.
  const batches = await Promise.allSettled(
    sourceTasks.map(async (task) => {
      const run = await repo.startSourceRun(task.source, now);
      let batch: SourceBatch;
      try {
        batch = asBatch(await task.run());
      } catch (error) {
        await repo.finishSourceRun(run.id, {
          status: "error",
          recordsSeen: 0,
          error: error instanceof Error ? error.message : String(error),
          completedAt: new Date()
        });
        throw error;
      }

      const written: NormalizedEvent[] = [];
      const counts = { persisted: 0, unchanged: 0, failed: 0, quarantined: 0 };
      const failures: string[] = [];
      const fetchedCount = batch.events.length + batch.rejected.length;
      const quarantine = async (rejected: RejectedRecord) => {
        try {
          await repo.quarantine({ ...rejected, source: task.source, seenAt: now });
          counts.quarantined += 1;
        } catch (error) {
          counts.failed += 1;
          if (failures.length < 3) {
            failures.push(`quarantine ${rejected.externalId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      };
      for (const rejected of batch.rejected) {
        await quarantine(rejected);
      }
      for (const event of batch.events) {
        const rejection = ingestRejection(event, now);
        if (rejection) {
          await quarantine(rejection);
          continue;
        }
        try {
          const result = await repo.upsertEvent(event);
          if (result.status === "unchanged") {
            counts.unchanged += 1;
          } else {
            counts.persisted += 1;
          }
          written.push(result.event);
        } catch (error) {
          counts.failed += 1;
          if (failures.length < 3) {
            failures.push(`${event.externalId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      await repo.finishSourceRun(run.id, {
        status: counts.failed > 0 ? "error" : "success",
        recordsSeen: fetchedCount,
        counts,
        error:
          counts.failed > 0
            ? `persist failed for ${counts.failed} of ${fetchedCount} records (${failures.join("; ")})`
            : undefined,
        completedAt: new Date()
      });
      return written;
    })
  );

  const events: NormalizedEvent[] = batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));
  const cascadeEvents = events.filter((event) => !isDashboardContextOnly(event));

  const currentWindows: WatchWindow[] = [];
  for (const event of cascadeEvents) {
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
  for (const event of cascadeEvents) {
    const state = evaluateCascade({
      event,
      activeWindows: windows,
      baseline: baselineForEvent(
        event,
        events,
        baselines,
        now,
        config.baselineMinMagnitude
      ),
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

function asBatch(result: NormalizedEvent[] | SourceBatch): SourceBatch {
  return Array.isArray(result) ? { events: result, rejected: [] } : result;
}

function isDashboardContextOnly(event: NormalizedEvent): boolean {
  return (
    event.eventType === "natural_event" ||
    event.eventType === "weather_alert" ||
    event.eventType === "tropical_cyclone"
  );
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
  now: Date,
  minMagnitude: number
) {
  if (event.eventType !== "earthquake" || !event.region) {
    return undefined;
  }

  const baseline = bestBaselineForRegion(event.region, baselines);
  if (!baseline) {
    return undefined;
  }

  return compareRegionalRate(
    event.region,
    events,
    baseline.value,
    now,
    minMagnitude
  );
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
