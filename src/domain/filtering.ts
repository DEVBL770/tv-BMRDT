import type { ContentItem, PublishedPackage } from './package';
import { localDateOf, localTimeOf, weekdayOf } from './time';
import { religiousStateAt } from './religious';

function withinTimeWindow(time: string, from: string, to: string): boolean {
  return from <= to ? time >= from && time <= to : time >= from || time <= to;
}

export function isContentVisible(
  item: ContentItem,
  instant: Date | string | number,
  pkg: PublishedPackage,
): boolean {
  const at = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  if (!Number.isFinite(at)) return false;
  if (item.startsAt && at < Date.parse(item.startsAt)) return false;
  if (item.endsAt && at > Date.parse(item.endsAt)) return false;

  const date = localDateOf(at);
  if (item.weekdays && !item.weekdays.includes(weekdayOf(date))) return false;
  if (item.timeWindows && item.timeWindows.length > 0) {
    const time = localTimeOf(at);
    if (!item.timeWindows.some(({ from, to }) => withinTimeWindow(time, from, to))) return false;
  }

  const state = religiousStateAt(at, pkg);
  if (item.isCommercial) {
    if (
      state.kind === 'unknown' ||
      (state.kind === 'chol_hamoed' && pkg.hideCommercialOnCholHamoed)
    ) {
      return false;
    }
    const beforeMs = pkg.sponsorMargin.beforeMinutes * 60_000;
    const afterMs = pkg.sponsorMargin.afterMinutes * 60_000;
    if (
      pkg.religiousPeriods.some(
        (period) =>
          at >= Date.parse(period.start) - beforeMs && at <= Date.parse(period.end) + afterMs,
      )
    ) {
      return false;
    }
  }
  if (item.shabbatVisibility === 'hide' && (state.kind === 'shabbat' || state.kind === 'yomtov')) {
    return false;
  }
  return true;
}

export function visibleContent(
  content: ContentItem[],
  instant: Date | string | number,
  pkg: PublishedPackage,
): ContentItem[] {
  return content
    .filter((item) => isContentVisible(item, instant, pkg))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
