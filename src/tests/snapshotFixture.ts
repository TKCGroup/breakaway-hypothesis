import type { WatcherRepository } from "../db/repository.js";
import { cascadeFixture, eventFixture, NOW } from "./helpers.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

// One repository holding every shape a bound could get wrong. The bounded
// snapshot must drop rows (or it proves nothing) and both pages built from it
// must be byte-identical to the pages built from the full tables.
export async function populateSnapshotFixture<T extends WatcherRepository>(repo: T): Promise<T> {

  // Inside the 31-day window: whole rows.
  await repo.upsertEvent(eventFixture({ id: "recent-quake", externalId: "recent-quake", eventTime: ago(HOUR), rawJson: { k: "recent" } }));
  for (let index = 0; index < 40; index += 1) {
    await repo.upsertEvent(
      eventFixture({
        id: `quake-${index}`,
        externalId: `quake-${index}`,
        eventTime: ago(index * 6 * HOUR),
        sourceUpdatedAt: ago(index * 6 * HOUR),
        ingestTime: ago(index * 6 * HOUR),
        magnitude: 1 + (index % 4),
        rawJson: { k: index }
      })
    );
  }

  // Catalogue history: older than the window, inside the 365-day baseline.
  for (let index = 0; index < 30; index += 1) {
    await repo.upsertEvent(
      eventFixture({
        id: `backfill-${index}`,
        externalId: `backfill-${index}`,
        source: "usgs_fdsn_backfill",
        eventTime: ago((40 + index * 10) * DAY),
        sourceUpdatedAt: ago((40 + index * 10) * DAY),
        ingestTime: ago(300 * DAY),
        magnitude: 2,
        rawJson: { big: "x".repeat(1000) }
      })
    );
  }

  // Older than every window, and 40 newer regional rows push it out of the
  // newest-ingested list: must not change either page.
  await repo.upsertEvent(
    eventFixture({ id: "ancient", externalId: "ancient", eventTime: ago(500 * DAY), ingestTime: ago(500 * DAY), rawJson: { big: "y" } })
  );
  await repo.upsertEvent(
    eventFixture({
      id: "old-eonet",
      externalId: "old-eonet",
      source: "nasa_eonet",
      eventType: "natural_event",
      eventTime: ago(60 * DAY),
      sourceUpdatedAt: ago(60 * DAY),
      ingestTime: ago(60 * DAY),
      region: undefined
    })
  );

  // An unchanged volcano notice: old event_time AND old ingest_time, but its
  // cascade state is rewritten every cycle and the region panel reads it.
  await repo.upsertEvent(
    eventFixture({
      id: "volcano",
      externalId: "volcano",
      source: "usgs_hans",
      eventType: "volcano_notice",
      title: "Mount Rainier advisory",
      eventTime: ago(120 * DAY),
      sourceUpdatedAt: ago(120 * DAY),
      ingestTime: ago(120 * DAY),
      region: "CASCADE_VOLCANOES_ST_HELENS",
      severity: "ADVISORY",
      rawJson: { alertLevel: "ADVISORY" }
    })
  );
  await repo.saveCascadeState(
    cascadeFixture({ id: "state-volcano", region: "CASCADE_VOLCANOES_ST_HELENS", latestEventId: "volcano", stageStartedAt: ago(5 * 60_000) })
  );
  // A region whose newest state is 90 days old, pointing at a 90-day-old quake.
  await repo.upsertEvent(
    eventFixture({
      id: "yellowstone-old",
      externalId: "yellowstone-old",
      eventTime: ago(90 * DAY),
      sourceUpdatedAt: ago(90 * DAY),
      ingestTime: ago(90 * DAY),
      region: "YELLOWSTONE",
      rawJson: { k: "yellowstone" }
    })
  );
  await repo.saveCascadeState(
    cascadeFixture({ id: "state-yellowstone", region: "YELLOWSTONE", latestEventId: "yellowstone-old", stageStartedAt: ago(90 * DAY) })
  );
  await repo.saveCascadeState(cascadeFixture({ id: "state-recent", latestEventId: "recent-quake", stageStartedAt: ago(5 * 60_000) }));

  for (const windowDays of [30, 365]) {
    await repo.saveRegionBaseline({
      region: "CASCADE_VOLCANOES_RAINIER",
      metric: "earthquakes_count_24h",
      windowDays,
      computedAt: ago(DAY),
      value: 0.5,
      sampleCount: windowDays
    });
  }

  // 300 runs of one source (more than the 200 kept) and a current cycle.
  for (let index = 299; index >= 0; index -= 1) {
    const run = await repo.startSourceRun("usgs_earthquake_geojson", ago(10 * 60_000 + index * 15 * 60_000));
    await repo.finishSourceRun(run.id, { status: "success", recordsSeen: index, completedAt: ago(9 * 60_000 + index * 15 * 60_000) });
  }
  for (const source of ["usgs_hans", "swpc_kp", "nasa_donki", "nws_alerts"]) {
    const run = await repo.startSourceRun(source, ago(10 * 60_000));
    await repo.finishSourceRun(run.id, { status: "success", recordsSeen: 1, completedAt: ago(9 * 60_000) });
  }

  // 600 old notifications plus a few in the last day.
  for (let index = 0; index < 600; index += 1) {
    await repo.saveNotification({
      id: `n-old-${index}`,
      cascadeStateId: "state-recent",
      sentAt: ago((2 + index) * DAY),
      channel: "dry_run",
      title: `old ${index}`,
      body: "b",
      dedupeKey: `old-${index}`
    });
  }
  for (let index = 0; index < 3; index += 1) {
    await repo.saveNotification({
      id: `n-new-${index}`,
      cascadeStateId: "state-recent",
      sentAt: ago(index * HOUR),
      channel: "dry_run",
      title: `new ${index}`,
      body: "b",
      dedupeKey: `new-${index}`
    });
  }
  return repo;
}

