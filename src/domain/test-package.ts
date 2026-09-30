import { PublishedPackageSchema, type Day, type PublishedPackage } from './package';

export function testDay(
  date: string,
  options: {
    weekday?: number;
    sunset?: string;
    candle?: string;
    havdalah?: string;
    holidays?: string[];
  } = {},
): Day {
  return {
    date,
    weekday: options.weekday ?? new Date(`${date}T00:00:00Z`).getUTCDay(),
    hebrew: { fr: '19 Tichri 5787', he: 'י״ט תשרי תשפ״ז', day: 19, month: 'Tichri', year: 5787 },
    holidays: options.holidays ?? [],
    study: {},
    zmanim: {
      ...(options.sunset ? { sunset: { instant: options.sunset } } : {}),
      ...(options.candle ? { candleLighting: { instant: options.candle } } : {}),
      ...(options.havdalah ? { havdalah: { instant: options.havdalah } } : {}),
    },
  };
}

export function testPackage(overrides: Partial<PublishedPackage> = {}): PublishedPackage {
  return PublishedPackageSchema.parse({
    schemaVersion: 1,
    versionNumber: 1,
    publishedAt: '2026-09-30T10:00:00.000Z',
    packageHash: 'a'.repeat(64),
    site: {
      name: 'Beth Menahem',
      address: 'Paris',
      timezone: 'Europe/Paris',
      attribution: ['Hebcal.com'],
    },
    methods: { status: 'pending', params: {} },
    horizon: { firstDate: '2026-10-02', lastDate: '2026-10-11' },
    days: [
      testDay('2026-10-02', { weekday: 5, sunset: '2026-10-02T17:00:00.000Z' }),
      testDay('2026-10-03', { weekday: 6 }),
      testDay('2026-10-04', { weekday: 0 }),
      testDay('2026-10-05', { weekday: 1 }),
      testDay('2026-10-06', { weekday: 2 }),
      testDay('2026-10-07', { weekday: 3 }),
      testDay('2026-10-08', { weekday: 4 }),
      testDay('2026-10-09', { weekday: 5 }),
      testDay('2026-10-10', { weekday: 6 }),
      testDay('2026-10-11', { weekday: 0 }),
    ],
    religiousPeriods: [
      {
        kind: 'shabbat',
        start: '2026-10-02T16:00:00.000Z',
        end: '2026-10-03T17:00:00.000Z',
        label: 'Chabbat',
        labelHe: 'שבת',
      },
    ],
    minyanim: [],
    content: [],
    layout: {
      mode: 'fixed',
      zones: {},
      slides: [{ id: 'schedule', kind: 'schedule', durationSec: 30 }],
    },
    media: [],
    sponsorMargin: { beforeMinutes: 30, afterMinutes: 0 },
    ...overrides,
  });
}
