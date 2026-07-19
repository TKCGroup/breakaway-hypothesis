import { describe, expect, it, vi } from "vitest";
import {
  DryRunNotifier,
  buildAlertPayload,
  buildSlackBotPostPayload,
  buildSlackWebhookPayload
} from "../logic/notifier.js";
import { cascadeFixture, eventFixture, NOW } from "./helpers.js";

describe("notifier", () => {
  it("includes source, event_time, ingest_time, region, stage, reason, and tsunami status", () => {
    const event = eventFixture({ region: "PNW_CASCADIA_OFFSHORE", magnitude: 5.5 });
    const state = cascadeFixture({
      region: "PNW_CASCADIA_OFFSHORE",
      stage: "S5",
      reason: "M5.5 target-region earthquake; tsunami feed status=none"
    });
    const payload = buildAlertPayload(event, state, true);

    expect(payload.requiredFields.source).toBe("usgs_earthquake_geojson");
    expect(payload.requiredFields.event_time).toBe(event.eventTime.toISOString());
    expect(payload.requiredFields.source_updated_at).toBe(event.sourceUpdatedAt.toISOString());
    expect(payload.requiredFields.ingest_time).toBe(event.ingestTime.toISOString());
    expect(payload.requiredFields.region).toBe("PNW_CASCADIA_OFFSHORE");
    expect(payload.requiredFields.cascade_stage).toBe("S5");
    expect(payload.requiredFields.stale_gate_result).toBe("passed");
    expect(payload.body).toContain("tsunami feed status=none");
  });

  it("formats the outbound webhook body for Slack with all required alert fields", () => {
    const event = eventFixture({ region: "PNW_CASCADIA_OFFSHORE", magnitude: 5.5 });
    const state = cascadeFixture({ region: "PNW_CASCADIA_OFFSHORE", stage: "S5" });
    const payload = buildAlertPayload(event, state, false);
    const webhookPayload = buildSlackWebhookPayload(payload);

    expect(webhookPayload.text).toContain("GEOSPACE WATCH: S5");
    expect(webhookPayload.text).toContain("source: usgs_earthquake_geojson");
    expect(webhookPayload.text).toContain(`event_time: ${event.eventTime.toISOString()}`);
    expect(webhookPayload.text).toContain(`source_updated_at: ${event.sourceUpdatedAt.toISOString()}`);
    expect(webhookPayload.text).toContain(`ingest_time: ${event.ingestTime.toISOString()}`);
    expect(webhookPayload.text).toContain("region: PNW_CASCADIA_OFFSHORE");
    expect(webhookPayload.text).toContain("cascade_stage: S5");
    expect(webhookPayload.text).toContain("stale_gate_result: passed");
  });

  it("formats Slack bot post payloads for the world-alerts channel", () => {
    const event = eventFixture({ region: "PNW_CASCADIA_OFFSHORE", magnitude: 5.5 });
    const state = cascadeFixture({ region: "PNW_CASCADIA_OFFSHORE", stage: "S5" });
    const payload = buildAlertPayload(event, state, false);
    const botPayload = buildSlackBotPostPayload(payload, "C0AS8NB0LQY");

    expect(botPayload.channel).toBe("C0AS8NB0LQY");
    expect(botPayload.unfurl_links).toBe(false);
    expect(botPayload.text).toContain("GEOSPACE WATCH: S5");
    expect(botPayload.text).toContain("source: usgs_earthquake_geojson");
    expect(botPayload.text).toContain("stale_gate_result: passed");
  });

  it("suppresses duplicate notification for same stage/region/event", async () => {
    const notifier = new DryRunNotifier({ dryRun: true, suppressDuplicateHours: 24, now: NOW });
    const event = eventFixture();
    const state = cascadeFixture();

    const first = await notifier.notify(event, state);
    const second = await notifier.notify(event, state);

    expect(first.suppressed).toBe(false);
    expect(first.reason).toBe("dry_run");
    expect(second.suppressed).toBe(true);
    expect(second.reason).toBe("duplicate_stage");
  });

  it("re-notifies only if stage increases or new major event occurs", async () => {
    const notifier = new DryRunNotifier({ dryRun: true, suppressDuplicateHours: 24, now: NOW });
    const event = eventFixture();

    await notifier.notify(event, cascadeFixture({ stage: "S3" }));
    const higherStage = await notifier.notify(event, cascadeFixture({ stage: "S4" }));
    const newEvent = await notifier.notify(
      eventFixture({ id: "evt-2", externalId: "us7000new", magnitude: 5.5 }),
      cascadeFixture({ stage: "S5", latestEventId: "evt-2" })
    );

    expect(higherStage.suppressed).toBe(false);
    expect(newEvent.suppressed).toBe(false);
  });

  it("posts a Slack-compatible webhook body when dry-run is disabled", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const notifier = new DryRunNotifier({
        dryRun: false,
        webhookUrl: "https://hooks.slack.test/services/T/B/C",
        suppressDuplicateHours: 24,
        now: NOW
      });
      const result = await notifier.notify(eventFixture(), cascadeFixture());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string };

      expect(result.sent).toBe(true);
      expect(result.channel).toBe("webhook");
      expect(body.text).toContain("GEOSPACE WATCH");
      expect(body.text).toContain("source: usgs_earthquake_geojson");
      expect(body.text).toContain("event_time:");
      expect(body.text).toContain("source_updated_at:");
      expect(body.text).toContain("ingest_time:");
      expect(body.text).toContain("region:");
      expect(body.text).toContain("cascade_stage:");
      expect(body.text).toContain("stale_gate_result:");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("posts through Slack chat.postMessage when bot token and channel are configured", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, ts: "1770000000.000000" })));
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const notifier = new DryRunNotifier({
        dryRun: false,
        slackBotToken: "xoxb-test-token",
        slackChannelId: "C0AS8NB0LQY",
        suppressDuplicateHours: 24,
        now: NOW
      });
      const result = await notifier.notify(eventFixture(), cascadeFixture());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { channel: string; text: string; unfurl_links: boolean };

      expect(url).toBe("https://slack.com/api/chat.postMessage");
      expect(init.headers).toMatchObject({
        authorization: "Bearer xoxb-test-token",
        "content-type": "application/json"
      });
      expect(result.sent).toBe(true);
      expect(result.channel).toBe("slack_bot");
      expect(body.channel).toBe("C0AS8NB0LQY");
      expect(body.unfurl_links).toBe(false);
      expect(body.text).toContain("source: usgs_earthquake_geojson");
      expect(body.text).toContain("event_time:");
      expect(body.text).toContain("source_updated_at:");
      expect(body.text).toContain("ingest_time:");
      expect(body.text).toContain("region:");
      expect(body.text).toContain("cascade_stage:");
      expect(body.text).toContain("stale_gate_result:");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
