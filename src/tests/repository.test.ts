import { describe, expect, it } from "vitest";
import { InMemoryWatcherRepository } from "../db/repository.js";
import { eventFixture } from "./helpers.js";

describe("repository", () => {
  it("dedupes unchanged source/external/source_updated_at events", async () => {
    const repo = new InMemoryWatcherRepository();
    const event = eventFixture();

    expect((await repo.upsertEvent(event)).status).toBe("inserted");
    expect((await repo.upsertEvent(event)).status).toBe("unchanged");
    expect(await repo.listEvents()).toHaveLength(1);
  });

  it("updates an event when the official source_updated_at changes", async () => {
    const repo = new InMemoryWatcherRepository();
    const event = eventFixture();
    const updated = eventFixture({
      sourceUpdatedAt: new Date("2026-07-08T11:55:00.000Z"),
      magnitude: 2.5
    });

    await repo.upsertEvent(event);
    expect((await repo.upsertEvent(updated)).status).toBe("updated");
    expect((await repo.listEvents())[0].magnitude).toBe(2.5);
  });

  it("records source run status", async () => {
    const repo = new InMemoryWatcherRepository();
    const run = await repo.startSourceRun("usgs_earthquake_geojson");

    await repo.finishSourceRun(run.id, { status: "success", recordsSeen: 3 });

    const runs = await repo.listSourceRuns();
    expect(runs[0].status).toBe("success");
    expect(runs[0].recordsSeen).toBe(3);

    await expect(repo.finishSourceRun("missing", { status: "error", recordsSeen: 0 })).rejects.toThrow(
      "Unknown source run"
    );
  });

  it("persists notification records by dedupe key", async () => {
    const repo = new InMemoryWatcherRepository();
    await repo.saveNotification({
      id: "notification-1",
      cascadeStateId: "cascade-1",
      sentAt: new Date("2026-07-08T12:00:00.000Z"),
      channel: "dry_run",
      title: "GEOSPACE WATCH: S3 escalation",
      body: "required fields present",
      dedupeKey: "CASCADE_VOLCANOES_RAINIER:us7000test"
    });

    expect(await repo.listNotifications()).toHaveLength(1);
  });

  it("upgrades a dry-run notification record to the first live channel", async () => {
    const repo = new InMemoryWatcherRepository();
    const base = {
      id: "notification-1",
      cascadeStateId: "cascade-1",
      sentAt: new Date("2026-07-08T12:00:00.000Z"),
      title: "GEOSPACE WATCH: S3 escalation",
      body: "required fields present",
      dedupeKey: "CASCADE_VOLCANOES_RAINIER:us7000test:S3"
    };

    await repo.saveNotification({ ...base, channel: "dry_run" });
    await repo.saveNotification({
      ...base,
      id: "notification-2",
      sentAt: new Date("2026-07-08T12:15:00.000Z"),
      channel: "slack_bot"
    });

    const notifications = await repo.listNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].channel).toBe("slack_bot");
    expect(notifications[0].id).toBe("notification-2");
  });
});
