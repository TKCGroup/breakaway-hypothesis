import { describe, expect, it, vi } from "vitest";
import {
  DryRunNotifier,
  buildAlertPayload,
  buildSlackBotPostPayload,
  buildSlackWebhookPayload,
  notificationDedupeKey
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
    expect(payload.body).toContain("*Event:* M 2.4 - 3 km S of Mount Rainier");
    expect(payload.body).toContain("*Magnitude:* M5.5");
    expect(payload.body).toContain("*Depth:* 4.0 km");
  });

  it("formats the outbound webhook body for Slack with all required alert fields", () => {
    const event = eventFixture({ region: "PNW_CASCADIA_OFFSHORE", magnitude: 5.5 });
    const state = cascadeFixture({ region: "PNW_CASCADIA_OFFSHORE", stage: "S5" });
    const payload = buildAlertPayload(event, state, false);
    const webhookPayload = buildSlackWebhookPayload(payload);

    expect(webhookPayload.text).toContain("GEOSPACE WATCH: S5");
    expect(webhookPayload.text).toContain("*Why this fired:*");
    expect(webhookPayload.text).toContain("*Required audit fields*");
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

  it("suppresses distinct microquakes from the same regional-rate episode", async () => {
    const notifier = new DryRunNotifier({ dryRun: true, suppressDuplicateHours: 24, now: NOW });
    const state = cascadeFixture({
      reason: "quake rate 5.0x baseline (5 quakes/24h) during active S1 window"
    });
    const first = await notifier.notify(eventFixture(), state);
    const second = await notifier.notify(
      eventFixture({
        id: "evt-2",
        externalId: "uw-second-microquake",
        title: "M 0.8 - Mount St. Helens",
        region: "CASCADE_VOLCANOES_RAINIER"
      }),
      { ...state, id: "cascade-2", latestEventId: "evt-2" }
    );

    expect(first.payload?.dedupeKey).toBe("CASCADE_VOLCANOES_RAINIER:regional-rate");
    expect(first.payload?.title).toContain("S3 regional-rate watch - Mount Rainier");
    expect(second.suppressed).toBe(true);
    expect(second.reason).toBe("duplicate_stage");
  });

  it("keeps distinct major-event alerts event-specific", async () => {
    const notifier = new DryRunNotifier({ dryRun: true, suppressDuplicateHours: 24, now: NOW });
    const state = cascadeFixture({
      region: "PNW_CASCADIA_OFFSHORE",
      stage: "S5",
      reason: "M5.0 target-region earthquake; tsunami feed status=none"
    });
    const first = await notifier.notify(
      eventFixture({
        id: "major-1",
        externalId: "us-major-1",
        region: "PNW_CASCADIA_OFFSHORE",
        magnitude: 5
      }),
      { ...state, latestEventId: "major-1" }
    );
    const second = await notifier.notify(
      eventFixture({
        id: "major-2",
        externalId: "us-major-2",
        region: "PNW_CASCADIA_OFFSHORE",
        magnitude: 5.6
      }),
      { ...state, id: "cascade-major-2", latestEventId: "major-2" }
    );

    expect(first.suppressed).toBe(false);
    expect(second.suppressed).toBe(false);
    expect(first.payload?.dedupeKey).toContain("us-major-1");
    expect(second.payload?.dedupeKey).toContain("us-major-2");
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
      const body = JSON.parse(init.body as string) as {
        channel: string;
        text: string;
        mrkdwn: boolean;
        unfurl_links: boolean;
      };

      expect(url).toBe("https://slack.com/api/chat.postMessage");
      expect(init.headers).toMatchObject({
        authorization: "Bearer xoxb-test-token",
        "content-type": "application/json"
      });
      expect(result.sent).toBe(true);
      expect(result.channel).toBe("slack_bot");
      expect(body.channel).toBe("C0AS8NB0LQY");
      expect(body.mrkdwn).toBe(true);
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

  it("suppresses persisted live duplicates without calling Slack again", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    globalThis.fetch = fetchMock as typeof fetch;
    const event = eventFixture();
    const state = cascadeFixture();
    const payload = buildAlertPayload(event, state, false);

    try {
      const notifier = new DryRunNotifier({
        dryRun: false,
        slackBotToken: "xoxb-test-token",
        slackChannelId: "C0AS8NB0LQY",
        suppressDuplicateHours: 24,
        now: NOW
      });
      const result = await notifier.notify(event, state, [
        {
          id: "notification-1",
          cascadeStateId: state.id,
          sentAt: new Date(NOW.getTime() - 60_000),
          channel: "slack_bot",
          title: payload.title,
          body: payload.body,
          dedupeKey: notificationDedupeKey(payload, state)
        }
      ]);

      expect(result.sent).toBe(false);
      expect(result.suppressed).toBe(true);
      expect(result.reason).toBe("persistent_duplicate");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("recognizes legacy event-specific records for a regional-rate episode", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    globalThis.fetch = fetchMock as typeof fetch;
    const event = eventFixture({
      id: "evt-new",
      externalId: "uw-new-microquake",
      region: "CASCADE_VOLCANOES_ST_HELENS"
    });
    const state = cascadeFixture({
      id: "cascade-new",
      region: "CASCADE_VOLCANOES_ST_HELENS",
      latestEventId: event.id,
      reason: "quake rate 5.0x baseline (5 quakes/24h) during active S1 window"
    });

    try {
      const notifier = new DryRunNotifier({
        dryRun: false,
        slackBotToken: "xoxb-test-token",
        slackChannelId: "C0AS8NB0LQY",
        suppressDuplicateHours: 24,
        now: NOW
      });
      const result = await notifier.notify(event, state, [
        {
          id: "notification-legacy",
          cascadeStateId: "cascade-old",
          sentAt: new Date(NOW.getTime() - 60_000),
          channel: "slack_bot",
          title: "GEOSPACE WATCH: S3 escalation - M 0.8 - Mount St. Helens",
          body: "*Why this fired:* quake rate 5.0x baseline during active S1 window",
          dedupeKey: "CASCADE_VOLCANOES_ST_HELENS:uw-old-microquake:S3"
        }
      ]);

      expect(result.sent).toBe(false);
      expect(result.reason).toBe("persistent_duplicate");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not let dry-run records suppress the first live Slack send", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, ts: "1770000000.000000" })));
    globalThis.fetch = fetchMock as typeof fetch;
    const event = eventFixture();
    const state = cascadeFixture();
    const payload = buildAlertPayload(event, state, false);

    try {
      const notifier = new DryRunNotifier({
        dryRun: false,
        slackBotToken: "xoxb-test-token",
        slackChannelId: "C0AS8NB0LQY",
        suppressDuplicateHours: 24,
        now: NOW
      });
      const result = await notifier.notify(event, state, [
        {
          id: "notification-1",
          cascadeStateId: state.id,
          sentAt: new Date(NOW.getTime() - 60_000),
          channel: "dry_run",
          title: payload.title,
          body: payload.body,
          dedupeKey: notificationDedupeKey(payload, state)
        }
      ]);

      expect(result.sent).toBe(true);
      expect(result.channel).toBe("slack_bot");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
