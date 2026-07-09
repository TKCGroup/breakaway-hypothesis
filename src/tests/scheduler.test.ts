import { describe, expect, it } from "vitest";
import { WatcherScheduler } from "../scheduler.js";

describe("watcher scheduler", () => {
  it("skips overlapping ticks while a run is active", async () => {
    let releaseRun: (() => void) | undefined;
    let runCount = 0;
    const scheduler = new WatcherScheduler({
      pollIntervalMinutes: 15,
      runOnce: async () => {
        runCount += 1;
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
      }
    });

    const first = scheduler.tick();
    const second = await scheduler.tick();

    expect(second).toBe("skipped_overlap");
    expect(scheduler.getStatus().skippedOverlaps).toBe(1);
    expect(runCount).toBe(1);

    releaseRun?.();
    expect(await first).toBe("ran");
  });

  it("routes runner errors to onError and unlocks the next tick", async () => {
    const errors: unknown[] = [];
    let runCount = 0;
    const scheduler = new WatcherScheduler({
      pollIntervalMinutes: 15,
      runOnce: async () => {
        runCount += 1;
        if (runCount === 1) {
          throw new Error("source failed");
        }
      },
      onError: (error) => errors.push(error)
    });

    expect(await scheduler.tick()).toBe("ran");
    expect(await scheduler.tick()).toBe("ran");
    expect(errors).toHaveLength(1);
    expect(runCount).toBe(2);
  });
});
