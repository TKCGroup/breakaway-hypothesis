import { stableEventDedupeKey } from "../logic/staleGate.js";
import type { CascadeState, NormalizedEvent, NotificationRecord, RegionBaseline, SourceRun, WatchWindow } from "../types.js";

export interface EventUpsertResult {
  event: NormalizedEvent;
  status: "inserted" | "updated" | "unchanged";
}

export interface WatcherRepository {
  startSourceRun(source: string, startedAt?: Date): Promise<SourceRun>;
  finishSourceRun(id: string, result: { status: "success" | "error"; recordsSeen: number; error?: string; completedAt?: Date }): Promise<void>;
  listSourceRuns(): Promise<SourceRun[]>;
  upsertEvent(event: NormalizedEvent): Promise<EventUpsertResult>;
  listEvents(): Promise<NormalizedEvent[]>;
  saveWatchWindow(window: WatchWindow): Promise<void>;
  listWatchWindows(): Promise<WatchWindow[]>;
  saveCascadeState(state: CascadeState): Promise<void>;
  listCascadeStates(): Promise<CascadeState[]>;
  saveNotification(notification: NotificationRecord): Promise<void>;
  listNotifications(): Promise<NotificationRecord[]>;
  saveRegionBaseline(baseline: RegionBaseline): Promise<void>;
  listRegionBaselines(): Promise<RegionBaseline[]>;
}

export class InMemoryWatcherRepository implements WatcherRepository {
  private readonly eventsBySourceExternalId = new Map<string, NormalizedEvent>();
  private readonly eventDedupeKeys = new Set<string>();
  private readonly windows = new Map<string, WatchWindow>();
  private readonly states = new Map<string, CascadeState>();
  private readonly sourceRuns = new Map<string, SourceRun>();
  private readonly notifications = new Map<string, NotificationRecord>();
  private readonly baselines = new Map<string, RegionBaseline>();

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

  async finishSourceRun(
    id: string,
    result: { status: "success" | "error"; recordsSeen: number; error?: string; completedAt?: Date }
  ): Promise<void> {
    const existing = this.sourceRuns.get(id);
    if (!existing) {
      throw new Error(`Unknown source run: ${id}`);
    }
    this.sourceRuns.set(id, {
      ...existing,
      completedAt: result.completedAt ?? new Date(),
      status: result.status,
      recordsSeen: result.recordsSeen,
      error: result.error
    });
  }

  async listSourceRuns(): Promise<SourceRun[]> {
    return [...this.sourceRuns.values()];
  }

  async upsertEvent(event: NormalizedEvent): Promise<EventUpsertResult> {
    const sourceExternalKey = `${event.source}:${event.externalId}`;
    const sourceUpdatedKey = stableEventDedupeKey(event);
    const existing = this.eventsBySourceExternalId.get(sourceExternalKey);

    if (existing && this.eventDedupeKeys.has(sourceUpdatedKey)) {
      return { event: existing, status: "unchanged" };
    }

    this.eventsBySourceExternalId.set(sourceExternalKey, event);
    this.eventDedupeKeys.add(sourceUpdatedKey);
    return { event, status: existing ? "updated" : "inserted" };
  }

  async listEvents(): Promise<NormalizedEvent[]> {
    return [...this.eventsBySourceExternalId.values()];
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

  async listNotifications(): Promise<NotificationRecord[]> {
    return [...this.notifications.values()];
  }

  async saveRegionBaseline(baseline: RegionBaseline): Promise<void> {
    this.baselines.set(`${baseline.region}:${baseline.metric}:${baseline.windowDays}`, baseline);
  }

  async listRegionBaselines(): Promise<RegionBaseline[]> {
    return [...this.baselines.values()];
  }
}
