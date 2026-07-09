export interface SchedulerOptions {
  pollIntervalMinutes: number;
  runOnce: () => Promise<void>;
  now?: () => Date;
  onError?: (error: unknown) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export class WatcherScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;
  private lastStartedAt: Date | undefined;
  private skippedOverlaps = 0;

  constructor(private readonly options: SchedulerOptions) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.stopped = false;
    void this.tick();
    const intervalMs = this.options.pollIntervalMinutes * 60_000;
    this.timer = (this.options.setIntervalFn ?? setInterval)(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      (this.options.clearIntervalFn ?? clearInterval)(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<"ran" | "skipped_overlap" | "stopped"> {
    if (this.stopped) {
      return "stopped";
    }
    if (this.running) {
      this.skippedOverlaps += 1;
      return "skipped_overlap";
    }

    this.running = true;
    this.lastStartedAt = (this.options.now ?? (() => new Date()))();
    try {
      await this.options.runOnce();
      return "ran";
    } catch (error) {
      this.options.onError?.(error);
      return "ran";
    } finally {
      this.running = false;
    }
  }

  getStatus(): { running: boolean; lastStartedAt?: Date; skippedOverlaps: number } {
    return {
      running: this.running,
      lastStartedAt: this.lastStartedAt,
      skippedOverlaps: this.skippedOverlaps
    };
  }
}
