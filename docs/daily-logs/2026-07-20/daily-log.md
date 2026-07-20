# Daily Log — 2026-07-20

## Live Hardening

- Commit `9eb9407 Harden live notifications and add USGS backfill` pushed to `main`.
- Added persistent notification dedupe so live sends suppress against prior live sends, while dry-run rows can upgrade to the first live channel.
- Added official USGS FDSN backfill command and wired stored region baselines into cascade scoring.
- Worker now reloads persisted S1 watch windows across Scheduler ticks.
- Added DONKI transient 5xx retry and normalized health routing tests.

## Verification

- Local gates passed: `pnpm typecheck`, `pnpm test` (48/48), `pnpm build`.
- Cloud Run source deploy rebuilt the Dockerfile gate and deployed dry-run revision `breakaway-hypothesis-watcher-00004-v68`.
- Backfill ran inside Cloud Run Job `breakaway-baseline-backfill-x5d5n`: 13,191 official USGS FDSN events upserted, 18 region baselines saved.
- Cloud Run live revision `breakaway-hypothesis-watcher-00005-tj7` is serving 100% traffic with `DRY_RUN=false`.
- Scheduler `breakaway-watcher-run` is enabled. The manual live trigger at `2026-07-20T22:10:43Z` returned HTTP 200, and the normal scheduled run at `2026-07-20T22:15:11Z` returned HTTP 200.
- Live notification logs show `sent: true`, `channel: slack_bot`, `dryRun: false`, S5 USGS earthquake alerts with required official-source fields and stale gate passed.

## Notes

- Public `/` and `/healthz/` return health JSON. Exact `/healthz` returns a Google front-end 404 before reaching the app; use `/healthz/` or `/` for external probes.

## False-Positive Correction

- Tyler reported two live Slack alerts that were official and stale-gated but region-wrong:
  - `us7000t21e`: official USGS event is south of the Kermadec Islands, not Cascadia.
  - `us7000t21z`: official USGS event is northern Mid-Atlantic Ridge, not Cascadia.
- Root cause: global USGS earthquakes without a configured region fell through to the cascade fallback region `PNW_CASCADIA_OFFSHORE`.
- Paused live delivery by setting Cloud Run `DRY_RUN=true`, then pushed:
  - `257be2b Suppress off-target earthquakes and improve alerts`
  - `fa8f376 Suppress comparator earthquake alerts`
- Added regression coverage for both false-positive IDs and comparator-only `us7000t1x5`.
- Local gates passed after the fix: `pnpm typecheck`, `pnpm test` (50/50), `pnpm build`.
- Dry-run revision `breakaway-hypothesis-watcher-00008-p4n` passed a forced Scheduler run at `2026-07-20T22:29:57Z` with no dry-run alert payloads and no log hits for the bad IDs.
- Live revision `breakaway-hypothesis-watcher-00009-7qm` is serving 100% traffic with `DRY_RUN=false`. Forced live Scheduler run at `2026-07-20T22:31:26Z` returned HTTP 200 with no bad-ID/comparator alert logs.
