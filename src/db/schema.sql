-- geospace watcher schema v0.2.0

CREATE TABLE IF NOT EXISTS source_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  records_seen INTEGER DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  region TEXT,
  title TEXT,
  event_time TIMESTAMPTZ NOT NULL,
  source_updated_at TIMESTAMPTZ,
  ingest_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  depth_km DOUBLE PRECISION,
  magnitude DOUBLE PRECISION,
  severity TEXT,
  official_url TEXT,
  raw_json JSONB NOT NULL,
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS space_weather_windows (
  id TEXT PRIMARY KEY,
  trigger_event_id TEXT REFERENCES events(id),
  trigger_type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  kp_max DOUBLE PRECISION,
  flare_class TEXT,
  cme_arrival_time TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  score TEXT,
  score_notes TEXT
);

CREATE TABLE IF NOT EXISTS region_baselines (
  region TEXT NOT NULL,
  metric TEXT NOT NULL,
  window_days INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY(region, metric, window_days)
);

CREATE TABLE IF NOT EXISTS cascade_states (
  id TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  stage TEXT NOT NULL,
  stage_started_at TIMESTAMPTZ NOT NULL,
  latest_event_id TEXT REFERENCES events(id),
  active_window_id TEXT REFERENCES space_weather_windows(id),
  reason TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  stale_gate_passed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  cascade_state_id TEXT REFERENCES cascade_states(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE
);
