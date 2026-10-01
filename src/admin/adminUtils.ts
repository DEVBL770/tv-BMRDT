import type { AdminDraft } from '../lib/adminRepository';
import {
  contentFromRow,
  contentToRow,
  minyanExceptionFromRow,
  minyanExceptionToRow,
  minyanRuleFromRow,
  minyanRuleToRow,
} from '../lib/adminRepository';

type Snapshot = {
  rules?: unknown;
  exceptions?: unknown;
  content?: unknown;
  layout?: unknown;
};

export type PublicationChangeSummary = {
  rules: number;
  exceptions: number;
  content: number;
  layoutChanged: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
    .join(',')}}`;
}

function changedRows<T>(
  current: T[],
  previous: T[],
  toRow: (item: T) => Record<string, unknown>,
  key: (row: Record<string, unknown>) => string,
): number {
  const currentRows = new Map(
    current.map((item) => {
      const row = toRow(item);
      return [key(row), stable(row)];
    }),
  );
  const previousRows = new Map(
    previous.map((item) => {
      const row = toRow(item);
      return [key(row), stable(row)];
    }),
  );
  const ids = new Set([...currentRows.keys(), ...previousRows.keys()]);
  return [...ids].filter((id) => currentRows.get(id) !== previousRows.get(id)).length;
}

export function summarizePublicationChanges(
  current: AdminDraft,
  snapshotValue: unknown,
): PublicationChangeSummary {
  const snapshot = record(snapshotValue) as Snapshot;
  const oldRules = rows(snapshot.rules).map(minyanRuleFromRow);
  const oldExceptions = rows(snapshot.exceptions).map(minyanExceptionFromRow);
  const oldContent = rows(snapshot.content).map(contentFromRow);
  const oldLayout = record(snapshot.layout);
  const layoutOptions = record(oldLayout.options);
  const previousLayout = {
    mode: oldLayout.mode,
    zones: oldLayout.zones,
    slides: oldLayout.slides,
    ...(layoutOptions.banner ? { banner: layoutOptions.banner } : {}),
  };
  return {
    rules: changedRows(current.rules, oldRules, minyanRuleToRow, (row) => String(row.id)),
    exceptions: changedRows(
      current.exceptions,
      oldExceptions,
      minyanExceptionToRow,
      (row) => `${String(row.local_date)}:${String(row.office)}`,
    ),
    content: changedRows(current.content, oldContent, contentToRow, (row) => String(row.id)),
    layoutChanged: stable(current.layout) !== stable(previousLayout),
  };
}
