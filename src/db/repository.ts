import { payloadHash } from "../logic/payloadHash.js";
import { stableEventDedupeKey } from "../logic/staleGate.js";
import type {
  CascadeState,
  NormalizedEvent,
  NotificationRecord,
  QuarantineRecord,
  RegionBaseline,
  SourceRun,
  SourceRunCounts,
  WatchWindow
} from "../types.js";

export interface EventUpsertResult {
  event: NormalizedEvent;
  status: "inserted" | "updated" | "unchanged";
}

// Read bounds for the page snapshot. Rows inside [fullSince, fullUntil] by
// event_time, or ingested since recentIngestSince, come back whole. Earthquakes
// older than fullSince but inside historySince come back WITHOUT raw_json: the
// regional activity history needs their time, region and magnitude only, and
// detoasting raw_json for a year of catalogue rows is what ran the instance out
// of memory. A row that qualifies as whole by any rule below is returned
// whole, once. Omit the query to read everything (worker paths).
//
// Also whole: any event a cascade state points at, when that state was written
// since recentIngestSince or is its region's latest. An unchanged event keeps
// its old ingest_time while its state is rewritten every cycle (a volcano
// elevated for months), and the region panel reads that event.
//
// And whole: the newest `newestIngested` live rows by ingest_time in each of
// the two page lists (regional, and region-less or comparator), ties at the
// cut included, because those lists are top-N by ingest_time at any age.
export interface EventQuery {
  fullSince: Date;
  fullUntil: Date;
  recentIngestSince: Date;
  historySince?: Date;
  newestIngested?: number;
}

export interface SourceRunQuery {
  latestPerSource: number;
}

// Every notification sent since `since`, plus the newest `limit` regardless.
export interface NotificationQuery {
  since: Date;
  limit: number;
}

export interface SourceRunResult {
  status: "success" | "error";
  recordsSeen: number;
  counts?: SourceRunCounts;
  error?: string;
  completedAt?: Date;
}

export interface WatcherRepository {
  startSourceRun(source: string, startedAt?: Date): Promise<SourceRun>;
  finishSourceRun(id: string, result: SourceRunResult): Promise<void>;
  listSourceRuns(query?: SourceRunQuery): Promise<SourceRun[]>;
  upsertEvent(event: NormalizedEvent): Promise<EventUpsertResult>;
  listEvents(query?: EventQuery): Promise<NormalizedEvent[]>;
  saveWatchWindow(window: WatchWindow): Promise<void>;
  listWatchWindows(): Promise<WatchWindow[]>;
  saveCascadeState(state: CascadeState): Promise<void>;
  listCascadeStates(): Promise<CascadeState[]>;
  saveNotification(notification: NotificationRecord): Promise<void>;
  listNotifications(query?: NotificationQuery): Promise<NotificationRecord[]>;
  saveRegionBaseline(baseline: RegionBaseline): Promise<void>;
  listRegionBaselines(): Promise<RegionBaseline[]>;
  quarantine(record: QuarantineRecord): Promise<void>;
  listQuarantine(): Promise<QuarantineRecord[]>;
}

export class InMemoryWatcherRepository implements WatcherRepository {
  private readonly eventsBySourceExternalId = new Map<string, NormalizedEvent>();
  private readonly eventDedupeKeys = new Set<string>();
  private readonly windows = new Map<string, WatchWindow>();
  private readonly states = new Map<string, CascadeState>();
  private readonly sourceRuns = new Map<string, SourceRun>();
  private readonly notifications = new Map<string, NotificationRecord>();
  private readonly baselines = new Map<string, RegionBaseline>();
  private readonly quarantined = new Map<string, QuarantineRecord>();

  async startSourceRun(source: string, startedAt = new Date()): Promise<SourceRun> {
    const run: SourceRun = {
      id: `source-run:${source}:${startedAt.toISOString()}`,
      source,
      startedAt,
      status: "running",
      recordsSeen: 0
    };
    this.sourceRuns.set(run.id, run);
    return run;
  }

  async finishSourceRun(id: string, result: SourceRunResult): Promise<void> {
    const existing = this.sourceRuns.get(id);
    if (!existing) {
      throw new Error(`Unknown source run: ${id}`);
    }
    this.sourceRuns.set(id, {
      ...existing,
      completedAt: result.completedAt ?? new Date(),
      status: result.status,
      recordsSeen: result.recordsSeen,
      recordsPersisted: result.counts?.persisted,
      recordsUnchanged: result.counts?.unchanged,
      recordsFailed: result.counts?.failed,
      recordsQuarantined: result.counts?.quarantined,
      error: result.error
    });
  }

  async listSourceRuns(query?: SourceRunQuery): Promise<SourceRun[]> {
    const all = [...this.sourceRuns.values()];
    if (!query) {
      return all;
    }
    const bySource = new Map<string, SourceRun[]>();
    for (const run of all) {
      bySource.set(run.source, [...(bySource.get(run.source) ?? []), run]);
    }
    return [...bySource.values()].flatMap((runs) =>
      runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, query.latestPerSource)
    );
  }

  async upsertEvent(event: NormalizedEvent): Promise<EventUpsertResult> {
    const sourceExternalKey = `${event.source}:${event.externalId}`;
    const sourceUpdatedKey = stableEventDedupeKey(event);
    const existing = this.eventsBySourceExternalId.get(sourceExternalKey);

    if (
      existing &&
      this.eventDedupeKeys.has(sourceUpdatedKey) &&
      payloadHash(existing.rawJson) === payloadHash(event.rawJson)
    ) {
      return { event: existing, status: "unchanged" };
    }

    this.eventsBySourceExternalId.set(sourceExternalKey, event);
    this.eventDedupeKeys.add(sourceUpdatedKey);
    return { event, status: existing ? "updated" : "inserted" };
  }

  async listEvents(query?: EventQuery): Promise<NormalizedEvent[]> {
    const all = [...this.eventsBySourceExternalId.values()];
    if (!query) {
      return all;
    }
    const referenced = stateReferencedEventIds([...this.states.values()], query.recentIngestSince);
    const newestCut = newestIngestCuts(all, query.newestIngested ?? 0);
    return all.flatMap((event) => {
      if (isFullRow(event, query) || referenced.has(event.id) || isNewestIngested(event, newestCut)) {
        return [event];
      }
      if (isHistoryRow(event, query)) {
        return [{ ...event, rawJson: null }];
      }
      return [];
    });
  }

  async saveWatchWindow(window: WatchWindow): Promise<void> {
    this.windows.set(window.id, window);
  }

  async listWatchWindows(): Promise<WatchWindow[]> {
    return [...this.windows.values()];
  }

  async saveCascadeState(state: CascadeState): Promise<void> {
    this.states.set(state.id, state);
  }

  async listCascadeStates(): Promise<CascadeState[]> {
    return [...this.states.values()];
  }

  async saveNotification(notification: NotificationRecord): Promise<void> {
    const existing = this.notifications.get(notification.dedupeKey);
    if (!existing || (existing.channel === "dry_run" && notification.channel !== "dry_run")) {
      this.notifications.set(notification.dedupeKey, notification);
    }
  }

  async listNotifications(query?: NotificationQuery): Promise<NotificationRecord[]> {
    const all = [...this.notifications.values()];
    if (!query) {
      return all;
    }
    const sorted = all.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
    return sorted.filter((notification, index) => index < query.limit || notification.sentAt >= query.since);
  }

  async saveRegionBaseline(baseline: RegionBaseline): Promise<void> {
    this.baselines.set(`${baseline.region}:${baseline.metric}:${baseline.windowDays}`, baseline);
  }

  async listRegionBaselines(): Promise<RegionBaseline[]> {
    return [...this.baselines.values()];
  }

  async quarantine(record: QuarantineRecord): Promise<void> {
    this.quarantined.set(`${record.source}:${record.externalId}:${record.reason}`, record);
  }

  async listQuarantine(): Promise<QuarantineRecord[]> {
    return [...this.quarantined.values()];
  }
}

export function isFullRow(event: NormalizedEvent, query: EventQuery): boolean {
  return (
    (event.eventTime >= query.fullSince && event.eventTime <= query.fullUntil) ||
    event.ingestTime >= query.recentIngestSince
  );
}

export function stateReferencedEventIds(states: CascadeState[], recentSince: Date): Set<string> {
  const latestByRegion = new Map<string, number>();
  for (const state of states) {
    latestByRegion.set(state.region, Math.max(latestByRegion.get(state.region) ?? -Infinity, state.stageStartedAt.getTime()));
  }
  return new Set(
    states
      .filter(
        (state) =>
          state.stageStartedAt >= recentSince || state.stageStartedAt.getTime() === latestByRegion.get(state.region)
      )
      .map((state) => state.latestEventId)
  );
}

export function isRegionlessListEvent(event: NormalizedEvent): boolean {
  return !event.region || event.region === "CARIBBEAN_VENEZUELA_COMPARATOR";
}

function newestIngestCuts(events: NormalizedEvent[], count: number): { regional: number; regionless: number } {
  const cut = (rows: NormalizedEvent[]) => {
    if (count <= 0) return Infinity;
    const times = rows.map((event) => event.ingestTime.getTime()).sort((a, b) => b - a);
    return times.length === 0 ? Infinity : times[Math.min(count, times.length) - 1];
  };
  const live = events.filter((event) => event.source !== "usgs_fdsn_backfill");
  return {
    regional: cut(live.filter((event) => !isRegionlessListEvent(event))),
    regionless: cut(live.filter(isRegionlessListEvent))
  };
}

function isNewestIngested(event: NormalizedEvent, cut: { regional: number; regionless: number }): boolean {
  if (event.source === "usgs_fdsn_backfill") return false;
  return event.ingestTime.getTime() >= (isRegionlessListEvent(event) ? cut.regionless : cut.regional);
}

export function isHistoryRow(event: NormalizedEvent, query: EventQuery): boolean {
  return (
    query.historySince !== undefined &&
    event.eventType === "earthquake" &&
    event.eventTime >= query.historySince &&
    event.eventTime < query.fullSince
  );
}
