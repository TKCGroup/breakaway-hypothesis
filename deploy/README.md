# Altbot GCP Deployment

Target project: `altbot-486317`

Recommended shape:

- Cloud Run service runs the HTTP watcher entrypoint.
- Cloud Scheduler sends authenticated `POST /run` every 15 minutes.
- Cloud SQL for PostgreSQL stores events, source runs, windows, cascade states, and notifications.
- Secret Manager stores `DATABASE_URL`, `NASA_API_KEY`, optional `NOTIFY_WEBHOOK_URL`, and `SCHEDULER_SHARED_SECRET`.

## Service

The container exposes:

- `GET /healthz`
- `POST /run`

`POST /run` has an in-process overlap lock and returns `409` if a previous poll is still running. `SCHEDULER_SHARED_SECRET` is required; if unset the service returns `503`. Callers must send:

```text
X-BREAKAWAY-CRON-KEY: <SCHEDULER_SHARED_SECRET>
```

Cloud Run stays private. Cloud Scheduler should use OIDC invoker auth plus the shared secret header.

## One-Time GCP Setup

```bash
gcloud config set project altbot-486317
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com sqladmin.googleapis.com
gcloud artifacts repositories create breakaway-hypothesis --repository-format=docker --location=us-central1
```

Altbot provisioned the core backend:

- Cloud SQL instance: `altbot-486317:us-central1:altbot-depot`
- Database: `breakaway`
- User: `breakaway_app`
- Runtime service account: `swarm-agent@altbot-486317.iam.gserviceaccount.com`
- `DATABASE_URL`: Secret Manager `BREAKAWAY_DATABASE_URL`
- `NASA_API_KEY`: Secret Manager `NASA_API_KEY`
- `SCHEDULER_SHARED_SECRET`: Secret Manager `BREAKAWAY_SCHEDULER_SHARED_SECRET`

`NOTIFY_WEBHOOK_URL` is not provisioned yet. Tyler must provide a Slack incoming webhook, then create `BREAKAWAY_NOTIFY_WEBHOOK_URL` and grant `swarm-agent@altbot-486317.iam.gserviceaccount.com` `roles/secretmanager.secretAccessor`.

Deploy v1 from a machine authenticated as `tkc-v7-dev@altbot-486317.iam.gserviceaccount.com`:

```bash
gcloud run deploy breakaway-hypothesis-watcher \
  --source . \
  --region us-central1 \
  --project altbot-486317 \
  --service-account swarm-agent@altbot-486317.iam.gserviceaccount.com \
  --add-cloudsql-instances altbot-486317:us-central1:altbot-depot \
  --no-allow-unauthenticated \
  --set-secrets DATABASE_URL=BREAKAWAY_DATABASE_URL:latest,NASA_API_KEY=NASA_API_KEY:latest,SCHEDULER_SHARED_SECRET=BREAKAWAY_SCHEDULER_SHARED_SECRET:latest \
  --update-env-vars DRY_RUN=true,RUN_MIGRATIONS_ON_START=true,NODE_ENV=production
```

For later redeploys prefer `--update-env-vars` / `--update-secrets`. Avoid `--set-*` on updates unless intentionally replacing the full set.

Create the Scheduler job after confirming `/healthz`:

```bash
KEY="$(gcloud secrets versions access latest --secret=BREAKAWAY_SCHEDULER_SHARED_SECRET --project=altbot-486317)"
SERVICE_URL="$(gcloud run services describe breakaway-hypothesis-watcher --region us-central1 --project altbot-486317 --format='value(status.url)')"
gcloud run services add-iam-policy-binding breakaway-hypothesis-watcher \
  --region us-central1 \
  --project altbot-486317 \
  --member=serviceAccount:swarm-agent@altbot-486317.iam.gserviceaccount.com \
  --role=roles/run.invoker
gcloud scheduler jobs create http breakaway-watcher-run \
  --location us-central1 \
  --project altbot-486317 \
  --schedule '*/15 * * * *' \
  --time-zone America/Chicago \
  --uri "$SERVICE_URL/run" \
  --http-method POST \
  --headers "X-BREAKAWAY-CRON-KEY=${KEY}" \
  --oidc-service-account-email swarm-agent@altbot-486317.iam.gserviceaccount.com
```

Keep `DRY_RUN=true` until official-feed dry-run output is reviewed and tests pass in CI.
