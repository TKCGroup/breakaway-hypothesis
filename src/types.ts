export type OfficialSource =
  | "usgs_earthquake_geojson"
  | "usgs_fdsn_backfill"
  | "usgs_hans"
  | "swpc_kp"
  | "swpc_goes_xray"
  | "swpc_solar_wind"
  | "swpc_alerts"
  | "nasa_donki"
  | "nasa_eonet"
  | "nws_alerts"
  | "nhc_current_storms"
  | "tsunami_ntwc"
  | "tsunami_ptwc";

export type EventType =
  | "earthquake"
  | "volcano_notice"
  | "space_weather"
  | "tsunami"
  | "natural_event"
  | "weather_alert"
  | "tropical_cyclone"
  | "source_context";

export type CascadeStage = "S0" | "S1" | "S2" | "S3" | "S4" | "S5";

export type RegionId =
  | "PNW_CASCADIA_OFFSHORE"
  | "WESTERN_WA_SEATTLE_WHIDBEY"
  | "CASCADE_VOLCANOES_RAINIER"
  | "CASCADE_VOLCANOES_ST_HELENS"
  | "CASCADE_VOLCANOES_HOOD_ADAMS_BAKER"
  | "CALIFORNIA_FAULTS"
  | "NORCAL_OFFSHORE_MENDOCINO_BLANCO"
  | "YELLOWSTONE"
  | "CARIBBEAN_VENEZUELA_COMPARATOR";

export interface NormalizedEvent {
  id: string;
  source: OfficialSource | string;
  externalId: string;
  eventType: EventType;
  title: string;
  eventTime: Date;
  sourceUpdatedAt: Date;
  ingestTime: Date;
  region?: RegionId;
  lat?: number;
  lon?: number;
  depthKm?: number;
  magnitude?: number;
  severity?: string;
  officialUrl: string;
  body?: string;
  rawJson: unknown;
}

export interface StaleGateResult {
  passed: boolean;
  checkedAt: Date;
  reasons: string[];
  sourceOfficial: boolean;
  eventFresh: boolean;
  sourceFresh: boolean;
  titleDateConsistent: boolean;
  snippetOnly: boolean;
}

export interface WatchWindow {
  id: string;
  triggerEventId: string;
  triggerType: string;
  startedAt: Date;
  endsAt: Date;
  kpMax?: number;
  flareClass?: string;
  cmeArrivalTime?: Date;
  active: boolean;
  score?: "hit" | "miss" | "noisy" | "stale-invalid";
  scoreNotes?: string;
}

export interface CascadeState {
  id: string;
  region: RegionId;
  stage: CascadeStage;
  stageStartedAt: Date;
  latestEventId: string;
  activeWindowId?: string;
  reason: string;
  confidence: number;
  staleGatePassed: boolean;
  staleGate: StaleGateResult;
  shouldNotify: boolean;
}

export interface AlertPayload {
  title: string;
  body: string;
  dedupeKey: string;
  dryRun: boolean;
  requiredFields: {
    source: string;
    event_time: string;
    source_updated_at: string;
    ingest_time: string;
    region: string;
    cascade_stage: CascadeStage;
    stale_gate_result: string;
  };
}

export type SourceRunStatus = "running" | "success" | "error";

export interface SourceRun {
  id: string;
  source: string;
  startedAt: Date;
  completedAt?: Date;
  status: SourceRunStatus;
  recordsSeen: number;
  // Written by the worker after the persist step. Absent on rows from before
  // 10-19, so read as "not measured", never as zero.
  recordsPersisted?: number;
  recordsUnchanged?: number;
  recordsFailed?: number;
  recordsQuarantined?: number;
  error?: string;
}

export interface SourceRunCounts {
  persisted: number;
  unchanged: number;
  failed: number;
  quarantined?: number;
}

// A record an official source sent that this service will not store as an
// event: unparseable, or with a time the ingest gate refuses. It is kept,
// counted and named, never dropped silently.
export interface RejectedRecord {
  externalId: string;
  reason: string;
  detail?: string;
  rawJson: unknown;
}

export interface SourceBatch {
  events: NormalizedEvent[];
  rejected: RejectedRecord[];
}

export interface QuarantineRecord extends RejectedRecord {
  source: string;
  seenAt: Date;
}

export interface NotificationRecord {
  id: string;
  cascadeStateId: string;
  sentAt: Date;
  channel: "dry_run" | "webhook" | "slack_bot";
  title: string;
  body: string;
  dedupeKey: string;
}

export interface RegionBaseline {
  region: RegionId;
  metric: "earthquakes_count_24h";
  windowDays: number;
  computedAt: Date;
  value: number;
  sampleCount: number;
}
