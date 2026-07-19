# Breakaway Codex Rules

## Identity

This repo is the Breakaway geospace / geohazard watcher.

- Codename: `breakaway`
- Runtime: Codex in the ChatGPT desktop app
- NAS inbox: `/Volumes/homes/TKC Group/Global_Agent_Memory/fridge/breakaway/`
- NAS shard: `/Volumes/homes/TKC Group/Global_Agent_Memory/shards/breakaway.md`
- Do not sign fridge drops as `code`. `code` is WARDEN, the `/Code` meta-agent.

## Scope

Build and maintain the TypeScript worker for official-source-only geospace and geohazard monitoring.

Hard alert rule: never notify from news, search, social, or snippets. Every alert must include official source, `event_time`, `source_updated_at`, `ingest_time`, region, cascade stage, and stale-gate result.

## Deployment Boundary

Breakaway does not deploy directly. Altbot is the deploy hub for project `altbot-486317`.

For deploys, write a fridge request to:

`/Volumes/homes/TKC Group/Global_Agent_Memory/fridge/altbot/`

Use `from: breakaway` and `sender: breakaway`.

## Live Mode Gate

`DRY_RUN=true` is the default. Do not set `DRY_RUN=false` unless:

- Tyler explicitly approves live notifications.
- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- Notification transport is configured and verified.
- Stale gate remains enforced before notification.

Preferred Slack transport is the existing Altbot Slack bot:

- Workspace: TKC Group
- Channel: `#world-alerts`
- Channel ID: `C0AS8NB0LQY`
- Env: `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID`

## Thread Start

Before substantial work:

1. Read `/Volumes/homes/TKC Group/Global_Agent_Memory/00_standards/AGENT_ONBOARDING.md`.
2. Read `/Volumes/homes/TKC Group/Global_Agent_Memory/00_standards/agents/breakaway.md`.
3. Read `PROGRESS.md`, `MID-TERM.md`, and `LONG-TERM.md`.
4. Check `fridge/breakaway/` and `fridge/all/`.
5. Read the latest section of `shards/breakaway.md`.

## Local Memory

- Current work: `PROGRESS.md`
- Near-term follow-ups: `MID-TERM.md`
- Longer-term ideas: `LONG-TERM.md`
- Daily logs and handoffs: `docs/daily-logs/YYYY-MM-DD/`

These files are recovery infrastructure. Append or make bounded edits; do not wipe them.
