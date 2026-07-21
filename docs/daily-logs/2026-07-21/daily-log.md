# Daily Log — 2026-07-21

## Dashboard Shipped

- Added a read-only operator dashboard to the existing Cloud Run worker.
- New routes:
  - `/dashboard` serves the hosted dashboard shell.
  - `/api/dashboard` returns summarized official-source engine state from Cloud SQL.
- Dashboard content:
  - live/dry-run mode and notification channel
  - official source freshness
  - engine pipeline: official ingestion, stale gate, cascade scorer, notification gate
  - configured region cascade stages
  - active space-weather watch windows
  - recent official events and filtered official events
  - recent notification records
  - USGS FDSN region baselines
- `/run` remains POST-only and protected by `X-BREAKAWAY-CRON-KEY`.

## Verification

- Local gates passed:
  - `pnpm typecheck`
  - `pnpm test` (53/53)
  - `pnpm build`
- Commits pushed:
  - `98fe5a9 Add live watcher dashboard`
  - `d731b6e Clarify dashboard stale gate status`
- Cloud Run revision `breakaway-hypothesis-watcher-00011-m4v` is serving 100% traffic.
- `DRY_RUN=false` preserved; Slack bot notification channel remains `C0AS8NB0LQY`.
- Hosted checks at `2026-07-21T05:27:37Z`:
  - `/dashboard` HTTP 200
  - `/api/dashboard` HTTP 200
  - `/healthz/` HTTP 200
  - final revision has no error logs
- API snapshot: six scheduled official sources are `ok`; current max region stage is `S1`.
