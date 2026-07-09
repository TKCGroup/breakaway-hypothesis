# Altbot GCP Deployment

Target project: `altbot-486317`

Recommended shape:

- Cloud Run service runs the HTTP watcher entrypoint.
- Cloud Scheduler sends authenticated `POST /run` every 15 minutes.
- Cloud SQL for PostgreSQL stores events, source runs, windows, cascade states, and notifications.
- Secret Manager stores `DATABASE_URL`, `NASA_API_KEY`, `NOTIFY_WEBHOOK_URL`, and optional `SCHEDULER_SHARED_SECRET`.

## Service

The container exposes:

- `GET /healthz`
- `POST /run`

`POST /run` has an in-process overlap lock and returns `409` if a previous poll is still running. If `SCHEDULER_SHARED_SECRET` is set, callers must send:

```text
Authorization: Bearer <SCHEDULER_SHARED_SECRET>
```

## One-Time GCP Setup

```bash
gcloud config set project altbot-486317
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com sqladmin.googleapis.com
gcloud artifacts repositories create breakaway-hypothesis --repository-format=docker --location=us-central1
```

Create secrets:

```bash
printf '%s' '<postgres-url>' | gcloud secrets create breakaway-database-url --data-file=-
printf '%s' '<nasa-api-key>' | gcloud secrets create breakaway-nasa-api-key --data-file=-
printf '%s' '<dry-run-or-live-webhook>' | gcloud secrets create breakaway-notify-webhook-url --data-file=-
printf '%s' '<random-shared-secret>' | gcloud secrets create breakaway-scheduler-secret --data-file=-
```

Deploy from this repo:

```bash
gcloud builds submit --config deploy/cloudbuild.yaml --project altbot-486317
```

After the first deploy, attach secrets:

```bash
gcloud run services update breakaway-hypothesis-watcher \
  --region us-central1 \
  --set-secrets DATABASE_URL=breakaway-database-url:latest,NASA_API_KEY=breakaway-nasa-api-key:latest,NOTIFY_WEBHOOK_URL=breakaway-notify-webhook-url:latest,SCHEDULER_SHARED_SECRET=breakaway-scheduler-secret:latest \
  --set-env-vars DRY_RUN=true,RUN_MIGRATIONS_ON_START=true
```

Create scheduler job after confirming `/healthz`:

```bash
SERVICE_URL="$(gcloud run services describe breakaway-hypothesis-watcher --region us-central1 --format='value(status.url)')"
gcloud scheduler jobs create http breakaway-hypothesis-watcher-15m \
  --location us-central1 \
  --schedule '*/15 * * * *' \
  --uri "$SERVICE_URL/run" \
  --http-method POST \
  --oidc-service-account-email '<scheduler-invoker-sa>@altbot-486317.iam.gserviceaccount.com'
```

Keep `DRY_RUN=true` until official-feed dry-run output is reviewed and tests pass in CI.
