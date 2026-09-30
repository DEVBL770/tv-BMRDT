import { describe, expect, it } from 'vitest';
import { isContentVisible } from './filtering';
import { testPackage } from './test-package';
import type { ContentItem } from './package';

const makeItem = (overrides: Partial<ContentItem> = {}): ContentItem => ({
  id: 'content',
  type: 'announcement',
  title: 'Information',
  mediaIds: [],
  shabbatVisibility: 'show',
  isCommercial: false,
  priority: 0,
  durationSec: 20,
  ...overrides,
});

describe('filtrage des contenus', () => {
  const pkg = testPackage();

  it('masque les sponsors avant Chabbat, pendant Chabbat, puis les réaffiche dimanche', () => {
    const sponsor = makeItem({ type: 'sponsor', isCommercial: true });
    expect(isContentVisible(sponsor, '2026-10-02T15:45:00.000Z', pkg)).toBe(false);
    expect(isContentVisible(sponsor, '2026-10-03T12:00:00.000Z', pkg)).toBe(false);
    expect(isContentVisible(sponsor, '2026-10-04T10:00:00.000Z', pkg)).toBe(true);
  });

  it('respecte les marges configurées de part et d’autre des périodes', () => {
    const sponsor = makeItem({ type: 'sponsor', isCommercial: true });
    expect(isContentVisible(sponsor, '2026-10-02T15:29:00.000Z', pkg)).toBe(true);
    expect(isContentVisible(sponsor, '2026-10-02T15:30:00.000Z', pkg)).toBe(false);
    const after = testPackage({
      sponsorMargin: { beforeMinutes: 0, afterMinutes: 30 },
    });
    expect(isContentVisible(sponsor, '2026-10-03T17:29:00.000Z', after)).toBe(false);
    expect(isContentVisible(sponsor, '2026-10-03T17:31:00.000Z', after)).toBe(true);
  });

  it('masque les sponsors hors horizon mais maintient dédicace et kiddouch visibles', () => {
    const sponsor = makeItem({ type: 'sponsor', isCommercial: true });
    const dedication = makeItem({ id: 'dedication', type: 'dedication' });
    const kiddouch = makeItem({ id: 'kiddouch', type: 'kiddouch' });
    expect(isContentVisible(sponsor, '2027-02-01T12:00:00.000Z', pkg)).toBe(false);
    expect(isContentVisible(dedication, '2026-10-03T12:00:00.000Z', pkg)).toBe(true);
    expect(isContentVisible(kiddouch, '2026-10-03T12:00:00.000Z', pkg)).toBe(true);
  });

  it('respecte date, jours autorisés, créneaux nocturnes et visibilité Chabbat', () => {
    const scheduled = makeItem({
      startsAt: '2026-10-02T00:00:00.000Z',
      endsAt: '2026-10-05T00:00:00.000Z',
      weekdays: [5],
      timeWindows: [{ from: '22:00', to: '02:00' }],
    });
    expect(isContentVisible(scheduled, '2026-10-02T21:30:00.000Z', pkg)).toBe(true);
    expect(isContentVisible(scheduled, '2026-10-02T12:00:00.000Z', pkg)).toBe(false);
    expect(isContentVisible(scheduled, '2026-10-03T00:30:00.000Z', pkg)).toBe(false);
    const hidden = makeItem({ shabbatVisibility: 'hide' });
    expect(isContentVisible(hidden, '2026-10-03T12:00:00.000Z', pkg)).toBe(false);
  });

  it('masque des annonces sur les deux jours d’un Yom Tov de diaspora', () => {
    const holidayPackage = testPackage({
      religiousPeriods: [
        {
          kind: 'yomtov',
          start: '2026-10-02T16:00:00.000Z',
          end: '2026-10-04T17:00:00.000Z',
          label: 'Souccot',
          labelHe: 'סוכות',
        },
      ],
    });
    const hidden = makeItem({ shabbatVisibility: 'hide' });
    expect(isContentVisible(hidden, '2026-10-02T17:00:00.000Z', holidayPackage)).toBe(false);
    expect(isContentVisible(hidden, '2026-10-03T12:00:00.000Z', holidayPackage)).toBe(false);
    expect(isContentVisible(hidden, '2026-10-04T18:00:00.000Z', holidayPackage)).toBe(true);
  });
});
