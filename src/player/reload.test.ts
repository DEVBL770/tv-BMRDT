import { describe, expect, it } from 'vitest';
import { nextSafeReloadTime } from './reload';

describe('nextSafeReloadTime', () => {
  it('moves a 04:00 reload until thirty minutes after Shabbat ends', () => {
    const now = new Date(2026, 9, 2, 5, 0);
    const shabbat = {
      kind: 'shabbat' as const,
      start: new Date(2026, 9, 2, 16, 0).toISOString(),
      end: new Date(2026, 9, 3, 20, 0).toISOString(),
      label: 'Chabbat',
      labelHe: 'שבת',
    };

    expect(nextSafeReloadTime(now, [shabbat])).toEqual(new Date(2026, 9, 3, 20, 30));
  });

  it('keeps the normal 04:00 time when it is outside a protected period', () => {
    const now = new Date(2026, 9, 2, 3, 0);
    const shabbat = {
      kind: 'shabbat' as const,
      start: new Date(2026, 9, 2, 16, 0).toISOString(),
      end: new Date(2026, 9, 3, 20, 0).toISOString(),
      label: 'Chabbat',
      labelHe: 'שבת',
    };

    expect(nextSafeReloadTime(now, [shabbat])).toEqual(new Date(2026, 9, 2, 4, 0));
  });
});
