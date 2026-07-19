# Handoff — 2026-07-19

## Must Read

- `AGENTS.md`
- `PROGRESS.md`
- `/Volumes/homes/TKC Group/Global_Agent_Memory/00_standards/agents/breakaway.md`
- `/Volumes/homes/TKC Group/Global_Agent_Memory/shards/breakaway.md`
- `fridge/breakaway/`

## Current Priority

Use `from: breakaway` for all future fridge drops. Do not use `from: code`.

Next operational move: get Altbot to redeploy commit `512b953` with the existing Altbot Slack bot secret exposed as `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID=C0AS8NB0LQY`, while keeping `DRY_RUN=true`.

## Open Issues

- `/healthz` returned 404 on the deployed revision Altbot checked.
- Backfill is not done.
- `DRY_RUN=false` remains Tyler-gated.
