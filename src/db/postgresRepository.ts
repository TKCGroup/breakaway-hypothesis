import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { stableEventDedupeKey } from "../logic/staleGate.js";
import type {
  CascadeState,
  EventType,
  NormalizedEvent,
  NotificationRecord,
  RegionId,
  SourceRun,
  WatchWindow
} from "../types.js";
import type { EventUpsertResult, WatcherRepository } from "./repository.js";

interface EventRow {
  id: string;
  source: string;
  external_id: string;
  event_type: EventType;
  region: RegionId | null;
  title: string | null;
  event_time: Date;
  source_updated_at: Date | null;
  ingest_time: Date;
  lat: number | null;
  lon: number | null;
  depth_km: number | null;
  magnitude: number | null;
  severity: string | null;
  official_url: string | null;
  raw_json: unknown;
}

interface WatchWindowRow {
  id: string;
  trigger_event_id: string;
  trigger_type: string;
  started_at: Date;
  ends_at: Date;
  kp_max: number | null;
  flare_class: string | null;
  cme_arrival_time: Date | null;
  active: boolean;
  score: WatchWindow["score"] | null;
  score_notes: string | null;
}

interface CascadeStateRow {
  id: string;
  region: RegionId;
  stage: CascadeState["stage"];
  stage_started_at: Date;
  latest_event_id: string;
  active_window_id: string | null;
  reason: string;
  confidence: number;
  stale_gate_passed: boolean;
}

interface NotificationRow {
  id: string;
  cascade_state_id: string;
  sent_at: Date;
  channel: "dry_run" | "webhook" | "slack_bot";
  title: string;
  body: string;
  dedupe_key: string;
}

interface SourceRunRow {
  id: string;
  source: string;
  started_at: Date;
  completed_at: Date | null;
  status: SourceRun["status"];
  records_seen: number;
  error: string | null;
}

export class PostgresWatcherRepository implements WatcherRepository {
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(databaseUrl: string): PostgresWatcherRepository {
    return new PostgresWatcherRepository(new Pool({ connectionString: databaseUrl, max: 5 }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async startSourceRun(source: string, startedAt = new Date()): Promise<SourceRun> {
    const run: SourceRun = {
      id: `source-run:${source}:${startedAt.toISOString()}`,
      source,
      startedAt,
      status: "running",
      recordsSeen: 0
    };
    await this.pool.query(
      `INSERT INTO source_runs (id, source, started_at, status, records_seen)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status, records_seen = EXCLUDED.records_seen, error = NULL`,
      [run.id, run.source, run.startedAt, run.status, run.recordsSeen]
    );
    return run;
  }

  async finishSourceRun(
    id: string,
    result: { status: "success" | "error"; recordsSeen: number; error?: string; completedAt?: Date }
  ): Promise<void> {
    await this.pool.query(
      `UPDATE source_runs
       SET completed_at = $2, status = $3, records_seen = $4, error = $5
       WHERE id = $1`,
      [id, result.completedAt ?? new Date(), result.status, result.recordsSeen, result.error ?? null]
    );
  }

  async listSourceRuns(): Promise<SourceRun[]> {
    return rows(await this.pool.query<SourceRunRow>(`SELECT * FROM source_runs ORDER BY started_at DESC`)).map(
      sourceRunFromRow
    );
  }

  async upsertEvent(event: NormalizedEvent): Promise<EventUpsertResult> {
    const existing = await this.pool.query<EventRow>(
      `SELECT * FROM events WHERE source = $1 AND external_id = $2 LIMIT 1`,
      [event.source, event.externalId]
    );
    const existingEvent = existing.rows[0] ? eventFromRow(existing.rows[0]) : undefined;
    if (existingEvent && stableEventDedupeKey(existingEvent) === stableEventDedupeKey(event)) {
      return { event: existingEvent, status: "unchanged" };
    }

    await this.pool.query(
      `INSERT INTO events (
         id, source, external_id, event_type, region, title, event_time, source_updated_at,
         ingest_time, lat, lon, depth_km, magnitude, severity, official_url, raw_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (source, external_id) DO UPDATE
       SET id = EXCLUDED.id,
           event_type = EXCLUDED.event_type,
           region = EXCLUDED.region,
           title = EXCLUDED.title,
           event_time = EXCLUDED.event_time,
           source_updated_at = EXCLUDED.source_updated_at,
           ingest_time = EXCLUDED.ingest_time,
           lat = EXCLUDED.lat,
           lon = EXCLUDED.lon,
           depth_km = EXCLUDED.depth_km,
           magnitude = EXCLUDED.magnitude,
           severity = EXCLUDED.severity,
           official_url = EXCLUDED.official_url,
           raw_json = EXCLUDED.raw_json`,
      [
        event.id,
        event.source,
        event.externalId,
        event.eventType,
        event.region ?? null,
        event.title,
        event.eventTime,
        event.sourceUpdatedAt,
        event.ingestTime,
        event.lat ?? null,
        event.lon ?? null,
        event.depthKm ?? null,
        event.magnitude ?? null,
        event.severity ?? null,
        event.officialUrl,
        JSON.stringify(event.rawJson)
      ]
    );

    return { event, status: existingEvent ? "updated" : "inserted" };
  }

  async listEvents(): Promise<NormalizedEvent[]> {
    return rows(await this.pool.query<EventRow>(`SELECT * FROM events ORDER BY event_time DESC`)).map(eventFromRow);
  }

  async saveWatchWindow(window: WatchWindow): Promise<void> {
    await this.pool.query(
      `INSERT INTO space_weather_windows (
         id, trigger_event_id, trigger_type, started_at, ends_at, kp_max,
         flare_class, cme_arrival_time, active, score, score_notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE
       SET trigger_event_id = EXCLUDED.trigger_event_id,
           trigger_type = EXCLUDED.trigger_type,
           started_at = EXCLUDED.started_at,
           ends_at = EXCLUDED.ends_at,
           kp_max = EXCLUDED.kp_max,
           flare_class = EXCLUDED.flare_class,
           cme_arrival_time = EXCLUDED.cme_arrival_time,
           active = EXCLUDED.active,
           score = EXCLUDED.score,
           score_notes = EXCLUDED.score_notes`,
      [
        window.id,
        window.triggerEventId,
        window.triggerType,
        window.startedAt,
        window.endsAt,
        window.kpMax ?? null,
        window.flareClass ?? null,
        window.cmeArrivalTime ?? null,
        window.active,
        window.score ?? null,
        window.scoreNotes ?? null
      ]
    );
  }

  async listWatchWindows(): Promise<WatchWindow[]> {
    return rows(await this.pool.query<WatchWindowRow>(`SELECT * FROM space_weather_windows ORDER BY started_at DESC`)).map(
      windowFromRow
    );
  }

  async saveCascadeState(state: CascadeState): Promise<void> {
    await this.pool.query(
      `INSERT INTO cascade_states (
         id, region, stage, stage_started_at, latest_event_id, active_window_id,
         reason, confidence, stale_gate_passed
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE
       SET region = EXCLUDED.region,
           stage = EXCLUDED.stage,
           stage_started_at = EXCLUDED.stage_started_at,
           latest_event_id = EXCLUDED.latest_event_id,
           active_window_id = EXCLUDED.active_window_id,
           reason = EXCLUDED.reason,
           confidence = EXCLUDED.confidence,
           stale_gate_passed = EXCLUDED.stale_gate_passed`,
      [
        state.id,
        state.region,
        state.stage,
        state.stageStartedAt,
        state.latestEventId,
        state.activeWindowId ?? null,
        state.reason,
        state.confidence,
        state.staleGatePassed
      ]
    );
  }

  async listCascadeStates(): Promise<CascadeState[]> {
    return rows(await this.pool.query<CascadeStateRow>(`SELECT * FROM cascade_states ORDER BY stage_started_at DESC`)).map(
      cascadeStateFromRow
    );
  }

  async saveNotification(notification: NotificationRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO notifications (id, cascade_state_id, sent_at, channel, title, body, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        notification.id,
        notification.cascadeStateId,
        notification.sentAt,
        notification.channel,
        notification.title,
        notification.body,
        notification.dedupeKey
      ]
    );
  }

  async listNotifications(): Promise<NotificationRecord[]> {
    return rows(await this.pool.query<NotificationRow>(`SELECT * FROM notifications ORDER BY sent_at DESC`)).map(
      notificationFromRow
    );
  }
}

function rows<T extends QueryResultRow>(result: QueryResult<T>): T[] {
  return result.rows;
}

function eventFromRow(row: EventRow): NormalizedEvent {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    eventType: row.event_type,
    title: row.title ?? "",
    eventTime: row.event_time,
    sourceUpdatedAt: row.source_updated_at ?? row.event_time,
    ingestTime: row.ingest_time,
    region: row.region ?? undefined,
    lat: row.lat ?? undefined,
    lon: row.lon ?? undefined,
    depthKm: row.depth_km ?? undefined,
    magnitude: row.magnitude ?? undefined,
    severity: row.severity ?? undefined,
    officialUrl: row.official_url ?? "",
    rawJson: row.raw_json
  };
}

function windowFromRow(row: WatchWindowRow): WatchWindow {
  return {
    id: row.id,
    triggerEventId: row.trigger_event_id,
    triggerType: row.trigger_type,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    kpMax: row.kp_max ?? undefined,
    flareClass: row.flare_class ?? undefined,
    cmeArrivalTime: row.cme_arrival_time ?? undefined,
    active: row.active,
    score: row.score ?? undefined,
    scoreNotes: row.score_notes ?? undefined
  };
}

function cascadeStateFromRow(row: CascadeStateRow): CascadeState {
  return {
    id: row.id,
    region: row.region,
    stage: row.stage,
    stageStartedAt: row.stage_started_at,
    latestEventId: row.latest_event_id,
    activeWindowId: row.active_window_id ?? undefined,
    reason: row.reason,
    confidence: row.confidence,
    staleGatePassed: row.stale_gate_passed,
    staleGate: {
      passed: row.stale_gate_passed,
      checkedAt: row.stage_started_at,
      reasons: row.stale_gate_passed ? [] : ["not_loaded_from_database"],
      sourceOfficial: row.stale_gate_passed,
      eventFresh: row.stale_gate_passed,
      sourceFresh: row.stale_gate_passed,
      titleDateConsistent: row.stale_gate_passed,
      snippetOnly: false
    },
    shouldNotify: false
  };
}

function notificationFromRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    cascadeStateId: row.cascade_state_id,
    sentAt: row.sent_at,
    channel: row.channel,
    title: row.title,
    body: row.body,
    dedupeKey: row.dedupe_key
  };
}

function sourceRunFromRow(row: SourceRunRow): SourceRun {
  return {
    id: row.id,
    source: row.source,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    status: row.status,
    recordsSeen: row.records_seen,
    error: row.error ?? undefined
  };
}
