import { describe, expect, it } from "vitest";
import { DryRunNotifier, buildAlertPayload } from "../logic/notifier.js";
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
});
