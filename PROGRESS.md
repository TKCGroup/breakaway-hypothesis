# Breakaway Progress

## Near-Term Watch

- [ ] Watch `fridge/breakaway/` for Altbot redeploy replies.
- [x] Confirm current Cloud Run revision has `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID=C0AS8NB0LQY`, while keeping `DRY_RUN=true`.
- [x] Verify Scheduler `/run` still succeeds in dry-run mode after redeploy.
- [ ] Investigate deployed `/healthz` returning 404.

## Current State — 2026-07-19

- TypeScript watcher is built and pushed.
- Cloud Run service is live in dry-run mode as `breakaway-hypothesis-watcher` on `altbot-486317`.
- Scheduler `breakaway-watcher-run` is live at `*/15 * * * *` America/Chicago.
- Latest pushed commit: `512b953 Reuse Altbot Slack bot for notifications`.
- Verified 2026-07-19 13:45 CDT: Cloud Run revision `breakaway-hypothesis-watcher-00003-x76` has 100% traffic, Scheduler is enabled, and the 18:45 UTC tick produced dry-run S5 official-source alert logs with `sent: false`.
- Local verification for `512b953`: `pnpm typecheck`, `pnpm test` (38/38), `pnpm build`.
- Breakaway NAS identity is now `breakaway`; do not use `code`.

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
- [ ] Fix or verify deployed `/healthz`.
- [ ] Complete 30/90-day baseline backfill.
- [ ] Flip live notifications only after Tyler approval.
