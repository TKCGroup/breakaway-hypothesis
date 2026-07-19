export type OfficialSource =
  | "usgs_earthquake_geojson"
  | "usgs_fdsn_backfill"
  | "usgs_hans"
  | "swpc_kp"
  | "swpc_goes_xray"
  | "swpc_solar_wind"
  | "swpc_alerts"
  | "nasa_donki"
  | "tsunami_ntwc"
  | "tsunami_ptwc";

export type EventType =
  | "earthquake"
  | "volcano_notice"
  | "space_weather"
  | "tsunami"
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
  error?: string;
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
