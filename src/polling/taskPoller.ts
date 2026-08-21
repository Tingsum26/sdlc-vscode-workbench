export interface PollIntervals { foregroundMs: number; backgroundMs: number }

export class TaskPoller {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private running = false;
  private failures = 0;

  constructor(
    private readonly refresh: () => Promise<void>,
    private readonly isForeground: () => boolean,
    private readonly intervals: PollIntervals,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async onFocus(): Promise<void> {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.tick();
  }

  private schedule(delay: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, delay);
  }

  private tick(): Promise<void> {
    if (!this.running) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runRefresh();
    return this.inFlight;
  }

  private async runRefresh(): Promise<void> {
    let delay: number;
    try {
      await this.refresh();
      this.failures = 0;
      delay = this.isForeground() ? this.intervals.foregroundMs : this.intervals.backgroundMs;
    } catch {
      this.failures += 1;
      delay = Math.min(this.intervals.foregroundMs * (2 ** this.failures), this.intervals.backgroundMs);
    } finally {
      this.inFlight = undefined;
    }
    this.schedule(delay!);
  }
}
