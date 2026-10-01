import { afterEach, describe, expect, it, vi } from 'vitest';
import { revokeMediaObjectUrls } from './media';
import { PlayerScheduler } from './scheduler';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PlayerScheduler', () => {
  it('keeps a constant timer count and revokes old media URLs over seven days', async () => {
    vi.useFakeTimers();
    let created = 0;
    const createUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:version-${created++}`);
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const scheduler = new PlayerScheduler();
    let currentUrls = { image: URL.createObjectURL(new Blob(['v0'])) };
    let rotations = 0;
    const cancel = scheduler.every(
      () => {
        const previousUrls = currentUrls;
        currentUrls = { image: URL.createObjectURL(new Blob([`v${rotations + 1}`])) };
        revokeMediaObjectUrls(previousUrls);
        rotations += 1;
      },
      24 * 60 * 60_000,
    );

    expect(scheduler.activeTimerCount).toBe(1);
    await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60_000);

    expect(rotations).toBe(7);
    expect(createUrl).toHaveBeenCalledTimes(8);
    expect(revokeUrl).toHaveBeenCalledTimes(7);
    expect(scheduler.activeTimerCount).toBe(1);
    cancel();
    expect(scheduler.activeTimerCount).toBe(0);
    scheduler.clearAll();
  });
});
