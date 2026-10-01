import { compileMinyanPlanning, type MinyanException, type MinyanRule } from './minyan';
import { buildReligiousPeriods } from './religious';
import {
  PublishedPackageSchema,
  type ContentItem,
  type Day,
  type Layout,
  type PublishedPackage,
} from './package';
import type { ReligiousDayKind } from './types';
import { addLocalDays, weekdayOf } from './time';

export type CompileSettings = {
  site?: PublishedPackage['site'];
  methods?: PublishedPackage['methods'];
  sponsorMargin?: PublishedPackage['sponsorMargin'];
  hideCommercialOnCholHamoed?: boolean;
  hebrewDayChange?: 'sunset' | 'tzeit' | 'midnight';
};

export type CompilePackageInput = {
  settings: CompileSettings;
  days: Day[];
  rules: MinyanRule[];
  exceptions: MinyanException[];
  content: ContentItem[];
  layout: Layout;
  media: PublishedPackage['media'];
  versionNumber: number;
  now: Date;
};

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

function dayKind(day: Day): ReligiousDayKind {
  if (day.holidayKinds?.includes('yomtov')) return 'yomtov';
  if (day.holidayKinds?.includes('chol_hamoed')) return 'chol_hamoed';
  if (day.holidayKinds?.includes('erev_yomtov')) return 'erev_yomtov';
  if (day.weekday === 6) return 'shabbat';
  if (day.weekday === 5) return 'erev_shabbat';
  return 'weekday';
}

export async function compilePackage(
  input: CompilePackageInput,
): Promise<{ package: PublishedPackage; packageHash: string }> {
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) throw new RangeError('Le paquet doit contenir au moins un jour.');
  const periods = buildReligiousPeriods(days);
  const minyanim = compileMinyanPlanning(
    days.map((day) => ({ date: day.date, dayKind: dayKind(day) })),
    input.rules,
    input.exceptions,
  );
  const firstDate = days[0].date;
  const lastDate = days.at(-1)?.date ?? firstDate;
  const site = input.settings.site ?? {
    name: 'Beth Menahem',
    address: '14 rue de Thionville, 75019 Paris',
    timezone: 'Europe/Paris',
    attribution: ['Calendrier : Hebcal.com (CC BY 4.0)', 'Météo : MET Norway'],
  };
  const valueWithoutHash = {
    schemaVersion: 1 as const,
    versionNumber: input.versionNumber,
    publishedAt: input.now.toISOString(),
    site,
    methods: input.settings.methods ?? { status: 'pending' as const, params: {} },
    horizon: { firstDate, lastDate },
    days,
    religiousPeriods: periods,
    minyanim: minyanim.map(({ date, office, time, cancelled, status }) => ({
      date,
      office,
      time,
      cancelled,
      status,
    })),
    content: input.content,
    layout: input.layout,
    media: input.media,
    sponsorMargin: input.settings.sponsorMargin ?? { beforeMinutes: 30, afterMinutes: 0 },
    hideCommercialOnCholHamoed: input.settings.hideCommercialOnCholHamoed ?? false,
  };
  const bytes = new TextEncoder().encode(canonicalize(valueWithoutHash));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const packageHash = [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
  const parsed = PublishedPackageSchema.parse({ ...valueWithoutHash, packageHash });
  return { package: parsed, packageHash };
}

export { addLocalDays, weekdayOf };
