import type { Day, PublishedPackage } from './package';
import type { ReligiousDayKind, ReligiousPeriod } from './types';
import { addLocalDays, localDateOf } from './time';

export type ReligiousState = {
  kind: ReligiousDayKind;
  currentPeriod?: ReligiousPeriod;
  nextPeriod?: ReligiousPeriod;
  label?: string;
  labelHe?: string;
};

function instantOf(zman: Day['zmanim'][keyof Day['zmanim']]): number | undefined {
  if (!zman?.instant) return undefined;
  const value = Date.parse(zman.instant);
  return Number.isFinite(value) ? value : undefined;
}

export function buildReligiousPeriods(days: Day[]): ReligiousPeriod[] {
  const daysByDate = new Map(days.map((day) => [day.date, day]));
  const starts = days.flatMap((day) => {
    const start = instantOf(day.zmanim.candleLighting);
    if (start === undefined) return [];
    const isYomtov = day.holidayKinds?.includes('yomtov') ?? false;
    const followingDay = daysByDate.get(addLocalDays(day.date, 1));
    return [
      {
        at: start,
        kind: isYomtov ? ('yomtov' as const) : ('shabbat' as const),
        label: day.holidays[0] ?? followingDay?.holidays[0] ?? (isYomtov ? 'Fête' : 'Chabbat'),
        labelHe:
          day.holidaysHe?.[0] ?? followingDay?.holidaysHe?.[0] ?? (isYomtov ? 'יום טוב' : 'שבת'),
      },
    ];
  });
  const ends = days.flatMap((day) => {
    const end = instantOf(day.zmanim.havdalah);
    return end === undefined ? [] : [{ at: end, day }];
  });
  starts.sort((a, b) => a.at - b.at);
  ends.sort((a, b) => a.at - b.at);

  const ranges = starts.flatMap((start) => {
    const end = ends.find(({ at }) => at > start.at);
    if (!end) return [];
    return [
      {
        kind: start.kind,
        start: start.at,
        end: end.at,
        label: start.label,
        labelHe: start.labelHe,
      },
    ];
  });
  const merged: Array<(typeof ranges)[number]> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 120_000) {
      previous.end = Math.max(previous.end, range.end);
      previous.kind = previous.kind === 'yomtov' || range.kind === 'yomtov' ? 'yomtov' : 'shabbat';
      if (!previous.label.includes(range.label))
        previous.label = `${previous.label} · ${range.label}`;
      if (!previous.labelHe.includes(range.labelHe)) {
        previous.labelHe = `${previous.labelHe} · ${range.labelHe}`;
      }
    } else {
      merged.push({ ...range });
    }
  }
  return merged.map((period) => ({
    kind: period.kind,
    start: new Date(period.start).toISOString(),
    end: new Date(period.end).toISOString(),
    label: period.label,
    labelHe: period.labelHe,
  }));
}

function isWithin(instant: number, period: ReligiousPeriod): boolean {
  return instant >= Date.parse(period.start) && instant < Date.parse(period.end);
}

export function religiousStateAt(
  instant: Date | string | number,
  pkg: PublishedPackage,
): ReligiousState {
  const value = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  if (!Number.isFinite(value)) return { kind: 'unknown' };
  const date = localDateOf(value);
  if (date < pkg.horizon.firstDate || date > pkg.horizon.lastDate) return { kind: 'unknown' };
  const currentPeriod = pkg.religiousPeriods.find((period) => isWithin(value, period));
  const nextPeriod = pkg.religiousPeriods
    .filter((period) => Date.parse(period.start) > value)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  if (currentPeriod) {
    return {
      kind: currentPeriod.kind,
      currentPeriod,
      nextPeriod,
      label: currentPeriod.label,
      labelHe: currentPeriod.labelHe,
    };
  }

  const day = pkg.days.find((item) => item.date === date);
  if (!day) return { kind: 'unknown', nextPeriod };
  if (day.holidayKinds?.includes('chol_hamoed')) {
    return { kind: 'chol_hamoed', nextPeriod, label: day.holidays[0] ?? 'Hol Hamoed' };
  }
  const nextPeriodKind =
    nextPeriod && localDateOf(nextPeriod.start) === date ? nextPeriod.kind : undefined;
  if (nextPeriodKind === 'yomtov') {
    return {
      kind: 'erev_yomtov',
      nextPeriod,
      label: nextPeriod.label,
      labelHe: nextPeriod.labelHe,
    };
  }
  if (nextPeriodKind === 'shabbat' || day.weekday === 5) {
    return {
      kind: 'erev_shabbat',
      nextPeriod,
      label: nextPeriod?.label ?? 'Chabbat',
      labelHe: nextPeriod?.labelHe ?? 'שבת',
    };
  }
  return { kind: 'weekday', nextPeriod };
}

export function themeFor(
  kind: ReligiousDayKind | Pick<ReligiousState, 'kind'>,
): 'weekday' | 'shabbat' | 'yomtov' {
  const state = typeof kind === 'string' ? kind : kind.kind;
  if (state === 'shabbat' || state === 'erev_shabbat') return 'shabbat';
  if (state === 'yomtov' || state === 'erev_yomtov' || state === 'chol_hamoed') return 'yomtov';
  return 'weekday';
}

export function hebrewDateAt(
  instant: Date | string | number,
  pkg: PublishedPackage,
  changeAt: 'sunset' | 'tzeit' | 'midnight' = 'sunset',
): Day['hebrew'] | undefined {
  const value = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  if (!Number.isFinite(value)) return undefined;
  const date = localDateOf(value);
  let targetDate = date;
  if (changeAt !== 'midnight') {
    const day = pkg.days.find((item) => item.date === date);
    const marker = instantOf(changeAt === 'sunset' ? day?.zmanim.sunset : day?.zmanim.tzeit);
    if (marker !== undefined && value >= marker) targetDate = addLocalDays(date, 1);
  }
  return pkg.days.find((item) => item.date === targetDate)?.hebrew;
}
