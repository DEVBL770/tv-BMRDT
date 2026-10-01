import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleDailyReload } from './reload';
import { PlayerScheduler } from './scheduler';

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduleDailyReload', () => {
  it('waits until thirty minutes after a protected holiday before reloading', async () => {
    vi.useFakeTimers();
    const now = new Date(2026, 9, 2, 5, 0);
    vi.setSystemTime(now);
    const scheduler = new PlayerScheduler();
    const reload = vi.fn();
    const shabbat = {
      kind: 'shabbat' as const,
      start: new Date(2026, 9, 2, 16, 0).toISOString(),
      end: new Date(2026, 9, 3, 20, 0).toISOString(),
      label: 'Chabbat',
      labelHe: 'שבת',
    };
    const cancel = scheduleDailyReload(scheduler, () => [shabbat], reload);

    await vi.advanceTimersByTimeAsync(39 * 60 * 60_000);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(reload).toHaveBeenCalledOnce();
    cancel();
    scheduler.clearAll();
  });
});
