# Breakaway Progress

## Near-Term Watch

- [ ] Watch `fridge/breakaway/` for Altbot redeploy replies.
- [x] Confirm current Cloud Run revision has `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID=C0AS8NB0LQY`, while keeping `DRY_RUN=true`.
- [x] Verify Scheduler `/run` still succeeds in dry-run mode after redeploy.
- [x] Investigate deployed `/healthz` returning 404. Root `/` and `/healthz/` work; exact `/healthz` is a Google front-end 404 before the container.

## Current State — 2026-07-19

- TypeScript watcher is built and pushed.
- Cloud Run service is live in dry-run mode as `breakaway-hypothesis-watcher` on `altbot-486317`.
- Scheduler `breakaway-watcher-run` is live at `*/15 * * * *` America/Chicago.
- Latest pushed commit: `512b953 Reuse Altbot Slack bot for notifications`.
- Verified 2026-07-19 13:45 CDT: Cloud Run revision `breakaway-hypothesis-watcher-00003-x76` has 100% traffic, Scheduler is enabled, and the 18:45 UTC tick produced dry-run S5 official-source alert logs with `sent: false`.
- Local verification for `512b953`: `pnpm typecheck`, `pnpm test` (38/38), `pnpm build`.
- Breakaway NAS identity is now `breakaway`; do not use `code`.

## Current State — 2026-07-20

- Latest pushed code commit: `9eb9407 Harden live notifications and add USGS backfill`.
- Local gates for `9eb9407`: `pnpm typecheck`, `pnpm test` (48/48), `pnpm build`.
- Cloud Run service `breakaway-hypothesis-watcher` is live on `altbot-486317`, region `us-central1`.
- Live revision: `breakaway-hypothesis-watcher-00005-tj7`, 100% traffic, image digest `sha256:9bde2e5a3459f1ba60759ffca4161943e6501ad1653984f527938339d303ac5a`.
- `DRY_RUN=false`; notifications use `SLACK_BOT_TOKEN` via Slack `chat.postMessage` and `SLACK_CHANNEL_ID=C0AS8NB0LQY`.
- Scheduler `breakaway-watcher-run` remains enabled at `*/15 * * * *` America/Chicago. Manual trigger at `2026-07-20T22:10:43Z` returned HTTP 200; normal scheduled run at `2026-07-20T22:15:11Z` returned HTTP 200.
- Official USGS FDSN backfill completed in Cloud Run Job `breakaway-baseline-backfill-x5d5n`: 13,191 events upserted, 18 baselines saved.
- Live Slack alert verification: revision `00005-tj7` logged `sent: true`, `channel: slack_bot`, `dryRun: false`, `source: usgs_earthquake_geojson`, `cascade_stage: S5`, `stale_gate_result: passed`.
- Public health probes: `/` and `/healthz/` return `{"ok":true,"dryRun":false}`. Exact `/healthz` returns a Google front-end 404 before app logs; use `/healthz/` or `/`.

## Active Work Items

- [x] Build official-source TypeScript worker.
- [x] Add USGS earthquake ingestion.
- [x] Add USGS HANS ingestion.
- [x] Add NOAA/SWPC and NASA DONKI ingestion.
- [x] Enforce stale gate before notification.
- [x] Add cascade stage scoring.
- [x] Keep dry-run notification path.
- [x] Add Slack-compatible notification formatting.
- [x] Add Slack bot transport for Altbot `#world-alerts`.
- [x] Verify deployed revision has Slack bot env wiring and remains dry-run.
- [x] Fix or verify deployed `/healthz`.
- [x] Complete 30/90-day baseline backfill.
- [x] Flip live notifications only after Tyler approval.
