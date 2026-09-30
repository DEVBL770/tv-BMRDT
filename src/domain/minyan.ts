import { weekdayOf } from './time';

export type MinyanRule = {
  id: string;
  office: string;
  time: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  weekdays?: number[];
  dayKinds?: string[];
  priority: number;
  active: boolean;
  status: 'to_confirm' | 'confirmed';
  cancelled?: boolean;
};

export type MinyanException = {
  id?: string;
  date: string;
  office: string;
  time: string | null;
  cancelled: boolean;
  status?: 'to_confirm' | 'confirmed';
};

export type MinyanConflict = {
  level: 'exception' | 'period' | 'weekly' | 'base';
  ruleIds: string[];
};

export type ResolvedMinyan = {
  time: string | null;
  cancelled: boolean;
  source: 'exception' | 'period' | 'weekly' | 'base';
  ruleId?: string;
  status: 'to_confirm' | 'confirmed';
  conflicts: MinyanConflict[];
};

type Candidate = {
  id: string;
  time: string | null;
  cancelled: boolean;
  status: 'to_confirm' | 'confirmed';
};

function dayMatches(rule: MinyanRule, date: string, dayKind?: string): boolean {
  if (rule.weekdays && rule.weekdays.length > 0 && !rule.weekdays.includes(weekdayOf(date))) {
    return false;
  }
  if (rule.dayKinds && rule.dayKinds.length > 0 && dayKind && !rule.dayKinds.includes(dayKind)) {
    return false;
  }
  return true;
}

function result(
  candidate: Candidate | undefined,
  source: ResolvedMinyan['source'],
  conflicts: MinyanConflict[],
): ResolvedMinyan {
  if (!candidate) {
    return { time: null, cancelled: false, source: 'base', status: 'to_confirm', conflicts };
  }
  return {
    time: candidate.time,
    cancelled: candidate.cancelled,
    source,
    ruleId: candidate.id,
    status: candidate.status,
    conflicts,
  };
}

function choose(
  candidates: Candidate[],
  level: MinyanConflict['level'],
  conflicts: MinyanConflict[],
): Candidate | undefined {
  if (candidates.length === 0) return undefined;
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  if (sorted.length > 1) conflicts.push({ level, ruleIds: sorted.map(({ id }) => id) });
  return sorted[0];
}

export function resolveMinyan(
  date: string,
  office: string,
  rules: MinyanRule[],
  exceptions: MinyanException[],
  dayKind?: string,
): ResolvedMinyan {
  const conflicts: MinyanConflict[] = [];
  const matchingExceptions = exceptions
    .filter((item) => item.date === date && item.office === office)
    .map((item, index) => ({
      id: item.id ?? `exception-${index + 1}`,
      time: item.time,
      cancelled: item.cancelled,
      status: item.status ?? 'to_confirm',
    }));
  const exception = choose(matchingExceptions, 'exception', conflicts);
  if (exception) return result(exception, 'exception', conflicts);

  const matching = rules.filter(
    (rule) => rule.active && rule.office === office && dayMatches(rule, date, dayKind),
  );
  const periods = matching.filter(
    (rule) =>
      rule.validFrom != null &&
      rule.validTo != null &&
      date >= rule.validFrom &&
      date <= rule.validTo,
  );
  if (periods.length > 0) {
    const span = (rule: MinyanRule) =>
      Date.parse(`${rule.validTo}T00:00:00Z`) - Date.parse(`${rule.validFrom}T00:00:00Z`);
    periods.sort(
      (a, b) => span(a) - span(b) || b.priority - a.priority || a.id.localeCompare(b.id),
    );
    const best = periods.filter(
      (rule) => span(rule) === span(periods[0]) && rule.priority === periods[0].priority,
    );
    const selected = choose(
      best.map((rule) => ({
        id: rule.id,
        time: rule.time,
        cancelled: rule.cancelled ?? rule.time === null,
        status: rule.status,
      })),
      'period',
      conflicts,
    );
    return result(selected, 'period', conflicts);
  }

  const weekly = matching.filter(
    (rule) =>
      rule.validFrom == null &&
      rule.validTo == null &&
      (rule.weekdays?.length ?? 0) > 0 &&
      rule.weekdays?.includes(weekdayOf(date)),
  );
  if (weekly.length > 0) {
    const bestPriority = Math.max(...weekly.map((rule) => rule.priority));
    const selected = choose(
      weekly
        .filter((rule) => rule.priority === bestPriority)
        .map((rule) => ({
          id: rule.id,
          time: rule.time,
          cancelled: rule.cancelled ?? rule.time === null,
          status: rule.status,
        })),
      'weekly',
      conflicts,
    );
    return result(selected, 'weekly', conflicts);
  }

  const base = matching.filter(
    (rule) => rule.validFrom == null && rule.validTo == null && (rule.weekdays?.length ?? 0) === 0,
  );
  if (base.length > 0) {
    const bestPriority = Math.max(...base.map((rule) => rule.priority));
    const selected = choose(
      base
        .filter((rule) => rule.priority === bestPriority)
        .map((rule) => ({
          id: rule.id,
          time: rule.time,
          cancelled: rule.cancelled ?? rule.time === null,
          status: rule.status,
        })),
      'base',
      conflicts,
    );
    return result(selected, 'base', conflicts);
  }
  return result(undefined, 'base', conflicts);
}

export function compileMinyanPlanning(
  days: Array<string | { date: string; dayKind?: string }>,
  rules: MinyanRule[],
  exceptions: MinyanException[],
): Array<{ date: string; office: string } & ResolvedMinyan> {
  const offices = [
    ...new Set([...rules.map(({ office }) => office), ...exceptions.map(({ office }) => office)]),
  ];
  return days.flatMap((day) => {
    const date = typeof day === 'string' ? day : day.date;
    const dayKind = typeof day === 'string' ? undefined : day.dayKind;
    return offices.map((office) => ({
      date,
      office,
      ...resolveMinyan(date, office, rules, exceptions, dayKind),
    }));
  });
}
