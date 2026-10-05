const TIME_ZONE = 'Europe/Paris';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

type WallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function wallParts(instant: Date): WallParts {
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour') % 24,
    minute: part('minute'),
    second: part('second'),
  };
}

function wallKey(parts: Pick<WallParts, 'year' | 'month' | 'day' | 'hour' | 'minute'>): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function dateKey(parts: Pick<WallParts, 'year' | 'month' | 'day'>): string {
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Date locale invalide : ${date}`);
  const [, yearText, monthText, dayText] = match;
  const value = { year: Number(yearText), month: Number(monthText), day: Number(dayText) };
  const check = new Date(Date.UTC(value.year, value.month - 1, value.day));
  if (
    check.getUTCFullYear() !== value.year ||
    check.getUTCMonth() + 1 !== value.month ||
    check.getUTCDate() !== value.day
  ) {
    throw new RangeError(`Date locale invalide : ${date}`);
  }
  return value;
}

function offsetsNear(target: number): Set<number> {
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = new Date(target + hours * 60 * 60 * 1000);
    const local = wallParts(instant);
    offsets.add(wallKey(local) - Math.floor(instant.getTime() / 60_000) * 60_000);
  }
  return offsets;
}

export function localDateOf(instant: Date | number | string): string {
  const value = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(value.getTime())) throw new RangeError('Instant invalide');
  return dateKey(wallParts(value));
}

export function localTimeOf(instant: Date | number | string): string {
  const value = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(value.getTime())) throw new RangeError('Instant invalide');
  const { hour, minute } = wallParts(value);
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

export function instantFromLocal(date: string, time: string): Date {
  const parsedDate = parseDate(date);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new RangeError(`Heure locale invalide : ${time}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const targetWall = Date.UTC(parsedDate.year, parsedDate.month - 1, parsedDate.day, hour, minute);
  const offsets = offsetsNear(targetWall);
  const candidates = [...offsets]
    .map((offset) => new Date(targetWall - offset))
    .filter((candidate) => {
      const actual = wallParts(candidate);
      return (
        actual.year === parsedDate.year &&
        actual.month === parsedDate.month &&
        actual.day === parsedDate.day &&
        actual.hour === hour &&
        actual.minute === minute
      );
    })
    .sort((a, b) => a.getTime() - b.getTime());

  if (candidates.length > 0) return candidates[0];

  const afterGap = [...offsets]
    .map((offset) => new Date(targetWall - offset))
    .map((candidate) => ({ candidate, wall: wallParts(candidate) }))
    .filter(
      ({ wall }) =>
        dateKey(wall) === date &&
        wallKey(wall) > targetWall &&
        Math.abs(wallKey(wall) - targetWall) <= 3 * 60 * 60 * 1000,
    )
    .sort(
      (a, b) => wallKey(a.wall) - wallKey(b.wall) || a.candidate.getTime() - b.candidate.getTime(),
    );
  if (afterGap.length > 0) return afterGap[0].candidate;
  throw new RangeError(`Impossible de résoudre l’heure locale ${date} ${time}`);
}

export function addLocalDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear().toString().padStart(4, '0')}-${(value.getUTCMonth() + 1).toString().padStart(2, '0')}-${value.getUTCDate().toString().padStart(2, '0')}`;
}

export function weekdayOf(date: string): number {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
