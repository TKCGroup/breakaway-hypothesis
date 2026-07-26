# Geospace Geohazard Watcher

Freshness-first TypeScript watcher for official-source-only geospace and geohazard monitoring.

This is a research/monitoring system, not an earthquake prediction engine. Space weather can open an S1 watch window, but danger alerts require current local geology, official volcano/tsunami confirmation, or target-region outcome events.

## Hard Alert Rules

- Never notify from news, search, or social snippets.
- Every notification passes `evaluateStaleGate` first.
- Every notification includes official source, `event_time`, `source_updated_at`, `ingest_time`, region, cascade stage, and stale-gate result.
- `DRY_RUN=true` is the default.
- Live notifications require `DRY_RUN=false`, either `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` or `NOTIFY_WEBHOOK_URL`, and passing tests.

## Commands

```bash
pnpm install
pnpm migrate
pnpm typecheck
pnpm test
pnpm build
pnpm dev        # HTTP service on PORT, default 8080
pnpm dev:once   # one poll, no HTTP server
pnpm start      # built HTTP service
pnpm start:once # built one-shot poll
pnpm start:loop # built local loop mode
```

`pnpm migrate` requires `DATABASE_URL`. Without `DATABASE_URL`, the worker falls back to the in-memory repository for local dry-run development.

## Cloud Run Shape

The production entrypoint is `src/server.ts`:

- `GET /healthz` returns basic service status.
- `GET /dashboard` serves the live operator and engine view.
- `GET /api/dashboard` returns its official-source JSON snapshot.
- `GET /earth` serves the public, mobile-first Earth Watch map.
- `GET /visualizations` serves the interactive visualization gallery.
- `GET /earth/visualizations` is the origin-safe visualization alias.
- `GET /assets/three-0.180.0/*` serves the pinned local Three.js browser runtime.
- `GET /api/earth` returns mapped official events, non-spatial context, target
  regions, event timestamps, source timestamps, ingest timestamps, cascade
  stages, and stale-gate results.
- `POST /run` executes one official-feed poll.
- Concurrent `/run` calls are rejected with `409`.
- `/run` requires `SCHEDULER_SHARED_SECRET` and the `X-BREAKAWAY-CRON-KEY` header.

Deployment scaffolding lives in `deploy/` and targets the Altbot GCP project `altbot-486317`.

## Source Priority

1. USGS real-time earthquake GeoJSON feeds.
2. USGS HANS volcano API.
3. NOAA/SWPC, NASA DONKI, and NOAA tsunami feeds.

NASA EONET natural events and severe/extreme NOAA/NWS CAP alerts provide broader dashboard context. They are persisted as official-source records but intentionally excluded from cascade scoring and Slack notification output.

The Earth Watch heat layer visualizes the relative load of current official
signals. It is not a disaster-probability model, earthquake prediction, or an
emergency-warning service. If Earth Watch cannot load its official data, the
page fails visibly and does not present an empty map as an all-clear.
The public HTML and JSON routes advertise five-minute and one-minute shared-edge
cache lifetimes respectively; the operator dashboard remains `no-store`.

Visualizations are interpretive, interactive context surfaces. Reconstructed
courses, terrain, and landmarks are labeled as approximate and remain fully
isolated from official-source ingestion, cascade scoring, stale-gate decisions,
and notification output.

## Environment

```bash
DATABASE_URL=
NASA_API_KEY=
NOTIFY_WEBHOOK_URL=
SLACK_BOT_TOKEN=
SLACK_CHANNEL_ID=
POLL_INTERVAL_MINUTES=15
MAX_EVENT_AGE_HOURS=12
SPACE_WEATHER_WINDOW_HOURS=72
BASELINE_DAYS_SHORT=30
BASELINE_DAYS_LONG=90
BASELINE_MIN_MAGNITUDE=0
DRY_RUN=true
PORT=8080
SCHEDULER_SHARED_SECRET=
RUN_MIGRATIONS_ON_START=false
```
