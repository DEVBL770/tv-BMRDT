import type { ReligiousPeriod } from '../domain/types';
import type { PlayerScheduler, TimerHandle } from './scheduler';

const RELOAD_HOUR = 4;
const HOLIDAY_GRACE_MS = 30 * 60_000;

export function nextSafeReloadTime(now: Date, periods: readonly ReligiousPeriod[]): Date {
  const todayReload = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    RELOAD_HOUR,
    0,
    0,
    0,
  );
  const currentPeriod = periods.find(
    (period) => now.getTime() >= Date.parse(period.start) && now.getTime() < Date.parse(period.end),
  );
  const candidate = new Date(todayReload);
  if (candidate.getTime() < now.getTime()) {
    if (currentPeriod) {
      candidate.setTime(Date.parse(currentPeriod.end) + HOLIDAY_GRACE_MS);
    } else {
      candidate.setDate(candidate.getDate() + 1);
    }
  }

  while (true) {
    const protectedPeriod = periods.find(
      (period) =>
        candidate.getTime() >= Date.parse(period.start) &&
        candidate.getTime() < Date.parse(period.end),
    );
    if (!protectedPeriod) return candidate;
    candidate.setTime(Date.parse(protectedPeriod.end) + HOLIDAY_GRACE_MS);
  }
}

export function scheduleDailyReload(
  scheduler: PlayerScheduler,
  getPeriods: () => readonly ReligiousPeriod[],
  reload: () => void,
  now: () => Date = () => new Date(),
): () => void {
  let timer: TimerHandle | null = null;
  let cancelled = false;

  const reloadWhenSafe = () => {
    timer = null;
    if (cancelled) return;
    const instant = now();
    const protectedPeriod = getPeriods().find(
      (period) =>
        instant.getTime() >= Date.parse(period.start) && instant.getTime() < Date.parse(period.end),
    );
    if (protectedPeriod) {
      timer = scheduler.timeout(
        reloadWhenSafe,
        Math.max(0, Date.parse(protectedPeriod.end) + HOLIDAY_GRACE_MS - instant.getTime()),
      );
      return;
    }
    reload();
    if (!cancelled) schedule();
  };

  const schedule = () => {
    const current = now();
    const next = nextSafeReloadTime(current, getPeriods());
    timer = scheduler.timeout(reloadWhenSafe, Math.max(0, next.getTime() - current.getTime()));
  };

  schedule();
  return () => {
    cancelled = true;
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
  };
}
