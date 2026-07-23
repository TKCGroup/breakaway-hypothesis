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

## Correction Update — 2026-07-20

- False-positive root cause: unmatched global USGS earthquakes with no configured region were falling back to `PNW_CASCADIA_OFFSHORE` inside cascade scoring. This incorrectly promoted official-but-off-target events `us7000t21e` and `us7000t21z` to S5 Slack alerts.
- Immediate mitigation: Cloud Run was paused with `DRY_RUN=true` before patch deployment.
- Code fixes pushed:
  - `257be2b Suppress off-target earthquakes and improve alerts`
  - `fa8f376 Suppress comparator earthquake alerts`
- Current pushed code commit: `fa8f376 Suppress comparator earthquake alerts`.
- Local gates for the fixed code passed: `pnpm typecheck`, `pnpm test` (50/50), `pnpm build`.
- Dry-run verification revision: `breakaway-hypothesis-watcher-00008-p4n`, 100% traffic. Forced Scheduler run at `2026-07-20T22:29:57Z` returned HTTP 200 and emitted no dry-run notification payloads for `us7000t21e`, `us7000t21z`, or `us7000t1x5`.
- Live revision after verification: `breakaway-hypothesis-watcher-00009-7qm`, 100% traffic, `DRY_RUN=false`.
- Live forced Scheduler run at `2026-07-20T22:31:26Z` returned HTTP 200. Logs for revision `00009-7qm` have no hits for `us7000t21e`, `us7000t21z`, `us7000t1x5`, comparator-only alerts, or outside-target alert attempts.
- Public health verification: `https://breakaway-hypothesis-watcher-479952073196.us-central1.run.app/healthz/` returns `{"ok":true,"dryRun":false}`.

## Dashboard Update — 2026-07-21

- Added a read-only hosted dashboard to the existing Cloud Run worker:
  - UI: `https://breakaway-hypothesis-watcher-479952073196.us-central1.run.app/dashboard`
  - JSON: `https://breakaway-hypothesis-watcher-479952073196.us-central1.run.app/api/dashboard`
- Dashboard shows live/dry-run mode, official source freshness, engine pipeline, configured region stages, active watch windows, recent official events, filtered official events, notification records, and USGS FDSN baselines.
- Hard-rule posture preserved: dashboard reads only persisted official-source database records and does not use news/search/social/snippet data.
- Code commits pushed:
  - `98fe5a9 Add live watcher dashboard`
  - `d731b6e Clarify dashboard stale gate status`
- Local gates passed after final dashboard copy: `pnpm typecheck`, `pnpm test` (53/53), `pnpm build`.
- Current live Cloud Run revision: `breakaway-hypothesis-watcher-00011-m4v`, 100% traffic, `DRY_RUN=false`, Slack bot channel `C0AS8NB0LQY`.
- Hosted verification at `2026-07-21T05:27:37Z`: `/dashboard` HTTP 200, `/api/dashboard` HTTP 200, `/healthz/` HTTP 200, no final-revision error logs.
- Live API snapshot: all six scheduled official sources `ok`, mode `live`, notification channel `slack_bot`, current max stage `S1`, 260 live official events in the last 24h.

## Dashboard Triage Redesign — 2026-07-23

- [x] Add a plain-language operating posture with an explicit operator action.
- [x] Add a latest-cycle change summary for new official events, stage changes, notifications, and source failures.
- [x] Sort target regions by urgency and show latest official event plus configured alert threshold.
- [x] Rename stale-gate and watch-window metrics so suppression and context are understandable at a glance.
- [x] Move healthy source detail and engine internals below the primary triage surface.
- [x] Verify desktop and mobile layouts, then pass `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- [ ] Push the verified change and request production deployment from Altbot.
