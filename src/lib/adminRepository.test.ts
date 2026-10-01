import { describe, expect, it } from 'vitest';
import type { AdminContentItem } from './adminRepository';
import {
  contentFromRow,
  contentToRow,
  minyanExceptionFromRow,
  minyanExceptionToRow,
  minyanRuleFromRow,
  minyanRuleToRow,
} from './adminRepository';

describe('admin repository row mappings', () => {
  it('round-trips a cancelled seasonal minyan rule', () => {
    const rule = {
      id: 'rule-1',
      office: 'Min’ha',
      time: null,
      validFrom: '2026-10-01',
      validTo: '2026-10-31',
      weekdays: [0, 3, 5],
      dayKinds: ['weekday', 'erev_shabbat'],
      priority: 4,
      active: true,
      status: 'confirmed' as const,
      cancelled: true,
    };

    expect(minyanRuleFromRow(minyanRuleToRow(rule))).toEqual(rule);
  });

  it('round-trips a date exception without dropping cancellation', () => {
    const exception = {
      id: 'exception-1',
      date: '2026-10-04',
      office: 'Min’ha',
      time: null,
      cancelled: true,
    };

    expect(minyanExceptionFromRow(minyanExceptionToRow(exception))).toEqual(exception);
  });

  it('round-trips content fields and editorial status', () => {
    const item: AdminContentItem = {
      id: 'content-1',
      type: 'qr',
      title: 'Inscription',
      body: 'Inscrivez-vous en ligne.',
      titleHe: 'הרשמה',
      mediaIds: [],
      qrUrl: 'https://example.org/inscription',
      startsAt: '2026-10-01T08:00:00+02:00',
      endsAt: '2026-10-31T23:00:00+01:00',
      weekdays: [0, 2, 4],
      timeWindows: [{ from: '08:00', to: '20:00' }],
      shabbatVisibility: 'hide',
      isCommercial: false,
      priority: 3,
      durationSec: 25,
      status: 'ready',
    };

    expect(contentFromRow(contentToRow(item))).toEqual(item);
  });
});
