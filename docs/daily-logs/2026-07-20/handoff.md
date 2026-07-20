# Handoff — 2026-07-20

## Live State

- Repo: `TKCGroup/breakaway-hypothesis`
- Current code commit: `9eb9407 Harden live notifications and add USGS backfill`
- GCP project/region: `altbot-486317` / `us-central1`
- Cloud Run service: `breakaway-hypothesis-watcher`
- Live revision: `breakaway-hypothesis-watcher-00005-tj7`, 100% traffic
- Scheduler: `breakaway-watcher-run`, enabled, `*/15 * * * *` America/Chicago
- Notifications: live Slack bot transport to `C0AS8NB0LQY`; `DRY_RUN=false`

## Verified

- `pnpm typecheck`
- `pnpm test` (48/48)
- `pnpm build`
- Cloud Run source deploy rebuilt the Dockerfile gate.
- Cloud Run Job `breakaway-baseline-backfill-x5d5n` completed successfully.
- Manual Scheduler trigger returned HTTP 200 at `2026-07-20T22:10:43Z`; normal scheduled run returned HTTP 200 at `2026-07-20T22:15:11Z`.
- Live logs include successful Slack sends with official USGS source, event time, source updated time, ingest time, region, cascade stage, and stale-gate result.

## Watch

- Exact `/healthz` returns Google front-end 404; `/` and `/healthz/` return `{"ok":true,"dryRun":false}`.
- Manual live trigger after 22:10 UTC returned 200 and emitted no duplicate stdout alert, consistent with persistent duplicate suppression.
- Continue watching normal scheduled runs for DONKI transient 5xx noise; retry is now bounded/nonfatal.
