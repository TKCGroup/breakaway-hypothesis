import type { AlertPayload, CascadeState, NormalizedEvent } from "../types.js";

export interface NotificationResult {
  sent: boolean;
  suppressed: boolean;
  dryRun: boolean;
  payload?: AlertPayload;
  reason?: string;
}

export interface NotifierOptions {
  dryRun: boolean;
  webhookUrl?: string;
  suppressDuplicateHours: number;
  now?: Date;
}

interface NotificationRecord {
  stageRank: number;
  sentAt: Date;
}

export class DryRunNotifier {
  private readonly sent = new Map<string, NotificationRecord>();

  constructor(private readonly options: NotifierOptions) {}

  async notify(event: NormalizedEvent, state: CascadeState): Promise<NotificationResult> {
    const now = this.options.now ?? new Date();
    if (!state.shouldNotify) {
      return { sent: false, suppressed: true, dryRun: this.options.dryRun, reason: "state_should_notify_false" };
    }
    if (!state.staleGatePassed) {
      return { sent: false, suppressed: true, dryRun: this.options.dryRun, reason: "stale_gate_failed" };
    }

    const payload = buildAlertPayload(event, state, this.options.dryRun);
    const record = this.sent.get(payload.dedupeKey);
    const currentRank = stageRank(state.stage);
    const suppressMs = this.options.suppressDuplicateHours * 3_600_000;
    if (record && now.getTime() - record.sentAt.getTime() < suppressMs && currentRank <= record.stageRank) {
      return { sent: false, suppressed: true, dryRun: this.options.dryRun, payload, reason: "duplicate_stage" };
    }

    this.sent.set(payload.dedupeKey, { stageRank: currentRank, sentAt: now });

    if (this.options.dryRun) {
      return { sent: false, suppressed: false, dryRun: true, payload, reason: "dry_run" };
    }

    if (!this.options.webhookUrl) {
      throw new Error("NOTIFY_WEBHOOK_URL is required when DRY_RUN=false");
    }

    const response = await fetch(this.options.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`Notification webhook failed: ${response.status} ${response.statusText}`);
    }
    return { sent: true, suppressed: false, dryRun: false, payload };
  }
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
