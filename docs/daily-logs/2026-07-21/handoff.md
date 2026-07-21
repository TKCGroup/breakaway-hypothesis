# Handoff — 2026-07-21

## Live State

- Repo: `TKCGroup/breakaway-hypothesis`
- Current code commit: `d731b6e Clarify dashboard stale gate status`
- GCP project/region: `altbot-486317` / `us-central1`
- Cloud Run service: `breakaway-hypothesis-watcher`
- Live revision: `breakaway-hypothesis-watcher-00011-m4v`, 100% traffic
- Scheduler: `breakaway-watcher-run`, enabled, `*/15 * * * *` America/Chicago
- Notifications: live Slack bot transport to `C0AS8NB0LQY`; `DRY_RUN=false`

## Dashboard

- Dashboard URL: `https://breakaway-hypothesis-watcher-479952073196.us-central1.run.app/dashboard`
- Dashboard API: `https://breakaway-hypothesis-watcher-479952073196.us-central1.run.app/api/dashboard`
- The dashboard is read-only and uses only persisted official-source records from Cloud SQL.
- It exposes source freshness, current cascade stages, active watch windows, recent official events, filtered official events, recent notifications, and baselines.

## Verified

- `pnpm typecheck`
- `pnpm test` (53/53)
- `pnpm build`
- Hosted `/dashboard`, `/api/dashboard`, and `/healthz/` returned HTTP 200 on revision `00011-m4v`.
- Unauthenticated `/run` remained protected, returning HTTP 401 during verification.
- Final revision error-log query returned no errors.

## Watch

- The dashboard currently shows current max stage `S1`, all six scheduled official sources `ok`, and the stale gate as healthy suppression. That means the engine is active, not predicting.
- Exact `/healthz` may still 404 at the Google front end; `/healthz/` and `/` are the verified probe paths.
