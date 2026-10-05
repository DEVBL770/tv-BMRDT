export type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

type ScheduledInterval = {
  active: boolean;
  handle: TimerHandle | null;
};

export class PlayerScheduler {
  private readonly timeouts = new Set<TimerHandle>();
  private readonly intervals = new Set<ScheduledInterval>();

  get activeTimerCount(): number {
    return this.timeouts.size;
  }

  timeout(callback: () => void, delayMs: number): TimerHandle {
    const handle = globalThis.setTimeout(() => {
      this.timeouts.delete(handle);
      callback();
    }, delayMs);
    this.timeouts.add(handle);
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    globalThis.clearTimeout(handle);
    this.timeouts.delete(handle);
  }

  every(callback: () => void, delayMs: number): () => void {
    const interval: ScheduledInterval = { active: true, handle: null };
    const tick = () => {
      if (!interval.active) return;
      try {
        callback();
      } finally {
        if (interval.active) interval.handle = this.timeout(tick, delayMs);
      }
    };
    this.intervals.add(interval);
    interval.handle = this.timeout(tick, delayMs);
    return () => this.clearInterval(interval);
  }

  clearAll(): void {
    for (const interval of this.intervals) interval.active = false;
    this.intervals.clear();
    for (const handle of this.timeouts) globalThis.clearTimeout(handle);
    this.timeouts.clear();
  }

  private clearInterval(interval: ScheduledInterval): void {
    interval.active = false;
    this.intervals.delete(interval);
    if (interval.handle !== null) this.clearTimeout(interval.handle);
  }
}
