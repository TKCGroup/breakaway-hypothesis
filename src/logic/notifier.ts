import type { AlertPayload, CascadeState, NormalizedEvent, NotificationRecord as PersistedNotificationRecord } from "../types.js";

export interface SlackWebhookPayload {
  text: string;
}

export interface SlackBotPostPayload extends SlackWebhookPayload {
  channel: string;
  mrkdwn: true;
  unfurl_links: false;
}

export interface NotificationResult {
  sent: boolean;
  suppressed: boolean;
  dryRun: boolean;
  channel?: "dry_run" | "webhook" | "slack_bot";
  payload?: AlertPayload;
  reason?: string;
}

export interface NotifierOptions {
  dryRun: boolean;
  webhookUrl?: string;
  slackBotToken?: string;
  slackChannelId?: string;
  suppressDuplicateHours: number;
  now?: Date;
}

type NotificationChannel = NonNullable<NotificationResult["channel"]>;

interface InMemoryNotificationRecord {
  stageRank: number;
  sentAt: Date;
}

export class DryRunNotifier {
  private readonly sent = new Map<string, InMemoryNotificationRecord>();

  constructor(private readonly options: NotifierOptions) {}

  async notify(
    event: NormalizedEvent,
    state: CascadeState,
    previousNotifications: PersistedNotificationRecord[] = []
  ): Promise<NotificationResult> {
    const now = this.options.now ?? new Date();
    if (!state.shouldNotify) {
      return { sent: false, suppressed: true, dryRun: this.options.dryRun, reason: "state_should_notify_false" };
    }
    if (!state.staleGatePassed) {
      return { sent: false, suppressed: true, dryRun: this.options.dryRun, reason: "stale_gate_failed" };
    }

    const payload = buildAlertPayload(event, state, this.options.dryRun);
    const channel = this.resolveChannel();
    const persistedDuplicate = findRecentPersistedDuplicate(
      previousNotifications,
      payload,
      state,
      channel,
      now,
      this.options.suppressDuplicateHours
    );
    if (persistedDuplicate) {
      return { sent: false, suppressed: true, dryRun: this.options.dryRun, channel, payload, reason: "persistent_duplicate" };
    }

    const record = this.sent.get(payload.dedupeKey);
    const currentRank = stageRank(state.stage);
    const suppressMs = this.options.suppressDuplicateHours * 3_600_000;
    if (record && now.getTime() - record.sentAt.getTime() < suppressMs && currentRank <= record.stageRank) {
      return { sent: false, suppressed: true, dryRun: this.options.dryRun, payload, reason: "duplicate_stage" };
    }

    this.sent.set(payload.dedupeKey, { stageRank: currentRank, sentAt: now });

    if (this.options.dryRun) {
      return { sent: false, suppressed: false, dryRun: true, channel, payload, reason: "dry_run" };
    }

    if (channel === "slack_bot" && this.options.slackBotToken && this.options.slackChannelId) {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.slackBotToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(buildSlackBotPostPayload(payload, this.options.slackChannelId))
      });
      if (!response.ok) {
        throw new Error(`Slack bot notification failed: ${response.status} ${response.statusText}`);
      }
      const slackResult = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!slackResult.ok) {
        throw new Error(`Slack bot notification failed: ${slackResult.error ?? "unknown_error"}`);
      }
      return { sent: true, suppressed: false, dryRun: false, channel, payload };
    }

    if (channel === "webhook" && this.options.webhookUrl) {
      const response = await fetch(this.options.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildSlackWebhookPayload(payload))
      });
      if (!response.ok) {
        throw new Error(`Notification webhook failed: ${response.status} ${response.statusText}`);
      }
      return { sent: true, suppressed: false, dryRun: false, channel, payload };
    }

    throw new Error(
      "SLACK_BOT_TOKEN and SLACK_CHANNEL_ID, or NOTIFY_WEBHOOK_URL, are required when DRY_RUN=false"
    );
  }

  private resolveChannel(): NotificationChannel {
    if (this.options.dryRun) {
      return "dry_run";
    }
    if (this.options.slackBotToken && this.options.slackChannelId) {
      return "slack_bot";
    }
    if (this.options.webhookUrl) {
      return "webhook";
    }
    throw new Error(
      "SLACK_BOT_TOKEN and SLACK_CHANNEL_ID, or NOTIFY_WEBHOOK_URL, are required when DRY_RUN=false"
    );
  }
}

export function notificationDedupeKey(payload: AlertPayload, state: CascadeState): string {
  return `${payload.dedupeKey}:${state.stage}`;
}

function findRecentPersistedDuplicate(
  notifications: PersistedNotificationRecord[],
  payload: AlertPayload,
  state: CascadeState,
  channel: NotificationChannel,
  now: Date,
  suppressDuplicateHours: number
): PersistedNotificationRecord | undefined {
  const suppressMs = suppressDuplicateHours * 3_600_000;
  const channels = channel === "dry_run" ? new Set(["dry_run"]) : new Set(["slack_bot", "webhook"]);
  const dedupeKey = notificationDedupeKey(payload, state);
  const regionalRate = isRegionalRateAlert(state);
  return notifications.find((notification) => {
    const ageMs = now.getTime() - notification.sentAt.getTime();
    if (!channels.has(notification.channel) || ageMs < 0 || ageMs >= suppressMs) {
      return false;
    }
    if (notification.dedupeKey === dedupeKey) {
      return true;
    }
    return (
      regionalRate &&
      notification.dedupeKey.startsWith(`${state.region}:`) &&
      notification.dedupeKey.endsWith(`:${state.stage}`) &&
      notification.body.toLowerCase().includes("quake rate")
    );
  });
}

export function buildSlackBotPostPayload(payload: AlertPayload, channel: string): SlackBotPostPayload {
  return {
    ...buildSlackWebhookPayload(payload),
    channel,
    mrkdwn: true,
    unfurl_links: false
  };
}

export function buildSlackWebhookPayload(payload: AlertPayload): SlackWebhookPayload {
  const required = payload.requiredFields;
  const requiredFields = [
    `source: ${required.source}`,
    `event_time: ${required.event_time}`,
    `source_updated_at: ${required.source_updated_at}`,
    `ingest_time: ${required.ingest_time}`,
    `region: ${required.region}`,
    `cascade_stage: ${required.cascade_stage}`,
    `stale_gate_result: ${required.stale_gate_result}`
  ].join("\n");

  return {
    text: `${payload.dryRun ? "[DRY RUN] " : ""}*${payload.title}*\n\n${payload.body}\n\n*Required audit fields*\n\`\`\`\n${requiredFields}\n\`\`\``
  };
}

export function buildAlertPayload(event: NormalizedEvent, state: CascadeState, dryRun: boolean): AlertPayload {
  const staleGateResult = state.staleGatePassed ? "passed" : `failed:${state.staleGate.reasons.join("|")}`;
  const regionalRate = isRegionalRateAlert(state);
  const title = regionalRate
    ? `GEOSPACE WATCH: ${state.stage} regional-rate watch - ${humanizeRegion(state.region)}`
    : `GEOSPACE WATCH: ${state.stage} ${stageName(state.stage)} - ${event.title}`;
  const body = [
    `*${regionalRate ? "Latest trigger event" : "Event"}:* ${event.title}`,
    `*Region:* ${humanizeRegion(state.region)}`,
    `*Why this fired:* ${state.reason}`,
    ...eventDetailLines(event),
    `*Official source:* ${sourceLabel(event.source)} (${event.source})`,
    `*Official URL:* ${event.officialUrl}`,
    `*Stale gate:* ${staleGateResult}`,
    `*Confidence:* ${state.confidence.toFixed(2)}`,
    "_Monitoring alert, not prediction. Triggered only from official timestamped sources._"
  ].join("\n");

  return {
    title,
    body,
    dedupeKey: regionalRate
      ? `${state.region}:regional-rate`
      : `${event.region ?? state.region}:${event.externalId}`,
    dryRun,
    requiredFields: {
      source: event.source,
      event_time: event.eventTime.toISOString(),
      source_updated_at: event.sourceUpdatedAt.toISOString(),
      ingest_time: event.ingestTime.toISOString(),
      region: state.region,
      cascade_stage: state.stage,
      stale_gate_result: staleGateResult
    }
  };
}

function isRegionalRateAlert(state: CascadeState): boolean {
  return state.stage === "S3" && state.reason.toLowerCase().startsWith("quake rate ");
}

function eventDetailLines(event: NormalizedEvent): string[] {
  const lines = [
    `*Event time:* ${event.eventTime.toISOString()}`,
    `*Source updated:* ${event.sourceUpdatedAt.toISOString()}`
  ];
  if (event.magnitude !== undefined) {
    lines.push(`*Magnitude:* M${event.magnitude.toFixed(1)}`);
  }
  if (event.depthKm !== undefined) {
    lines.push(`*Depth:* ${event.depthKm.toFixed(1)} km`);
  }
  if (event.lat !== undefined && event.lon !== undefined) {
    lines.push(`*Coordinates:* ${event.lat.toFixed(4)}, ${event.lon.toFixed(4)}`);
  }
  if (event.severity) {
    lines.push(`*Official status:* ${event.severity}`);
  }
  return lines;
}

function humanizeRegion(region: string): string {
  const labels: Record<string, string> = {
    CASCADE_VOLCANOES_RAINIER: "Mount Rainier",
    CASCADE_VOLCANOES_ST_HELENS: "Mount St. Helens",
    CASCADE_VOLCANOES_HOOD_ADAMS_BAKER: "Mount Hood / Adams / Baker",
    YELLOWSTONE: "Yellowstone",
    NORCAL_OFFSHORE_MENDOCINO_BLANCO: "Mendocino / Blanco Offshore",
    PNW_CASCADIA_OFFSHORE: "Cascadia Offshore (PNW)",
    WESTERN_WA_SEATTLE_WHIDBEY: "Western Washington / Seattle / Whidbey",
    CALIFORNIA_FAULTS: "California Faults",
    CARIBBEAN_VENEZUELA_COMPARATOR: "Caribbean / Venezuela Comparator"
  };
  if (labels[region]) {
    return labels[region];
  }
  return region
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    usgs_earthquake_geojson: "USGS earthquake feed",
    usgs_fdsn_backfill: "USGS FDSN backfill",
    usgs_hans: "USGS HANS volcano API",
    swpc_kp: "NOAA/SWPC Kp feed",
    swpc_goes_xray: "NOAA/SWPC GOES X-ray",
    swpc_solar_wind: "NOAA/SWPC solar wind",
    swpc_alerts: "NOAA/SWPC alerts",
    nasa_donki: "NASA DONKI",
    nasa_eonet: "NASA EONET",
    nws_alerts: "NOAA/NWS alerts",
    tsunami_ntwc: "NOAA NTWC tsunami feed",
    tsunami_ptwc: "NOAA PTWC tsunami feed"
  };
  return labels[source] ?? source;
}

function stageRank(stage: CascadeState["stage"]): number {
  return Number(stage.slice(1));
}

function stageName(stage: CascadeState["stage"]): string {
  const names: Record<CascadeState["stage"], string> = {
    S0: "baseline",
    S1: "space-weather watch",
    S2: "local response",
    S3: "escalation",
    S4: "official volcanic confirmation",
    S5: "outcome"
  };
  return names[stage];
}
