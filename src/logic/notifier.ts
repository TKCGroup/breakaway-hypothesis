import type { AlertPayload, CascadeState, NormalizedEvent, NotificationRecord as PersistedNotificationRecord } from "../types.js";

export interface SlackWebhookPayload {
  text: string;
}

export interface SlackBotPostPayload extends SlackWebhookPayload {
  channel: string;
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
      notificationDedupeKey(payload, state),
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
  dedupeKey: string,
  channel: NotificationChannel,
  now: Date,
  suppressDuplicateHours: number
): PersistedNotificationRecord | undefined {
  const suppressMs = suppressDuplicateHours * 3_600_000;
  const channels = channel === "dry_run" ? new Set(["dry_run"]) : new Set(["slack_bot", "webhook"]);
  return notifications.find(
    (notification) =>
      notification.dedupeKey === dedupeKey &&
      channels.has(notification.channel) &&
      now.getTime() - notification.sentAt.getTime() < suppressMs
  );
}

export function buildSlackBotPostPayload(payload: AlertPayload, channel: string): SlackBotPostPayload {
  return {
    ...buildSlackWebhookPayload(payload),
    channel,
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
    text: `${payload.dryRun ? "[DRY RUN] " : ""}${payload.title}\n\n${payload.body}\n\nRequired fields:\n${requiredFields}`
  };
}

export function buildAlertPayload(event: NormalizedEvent, state: CascadeState, dryRun: boolean): AlertPayload {
  const staleGateResult = state.staleGatePassed ? "passed" : `failed:${state.staleGate.reasons.join("|")}`;
  const title = `GEOSPACE WATCH: ${state.stage} ${stageName(state.stage)}`;
  const body = [
    `Region: ${state.region}`,
    `Reason: ${state.reason}`,
    `Official source: ${event.source}`,
    `Official URL: ${event.officialUrl}`,
    `Event time: ${event.eventTime.toISOString()}`,
    `Source updated at: ${event.sourceUpdatedAt.toISOString()}`,
    `Ingest time: ${event.ingestTime.toISOString()}`,
    `Cascade stage: ${state.stage}`,
    `Stale gate: ${staleGateResult}`,
    `Confidence: ${state.confidence.toFixed(2)}`,
    "Risk read: elevated monitoring, not prediction; alert escalates only from official timestamped sources."
  ].join("\n");

  return {
    title,
    body,
    dedupeKey: `${event.region ?? state.region}:${event.externalId}`,
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
