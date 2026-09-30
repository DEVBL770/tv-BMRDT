import type { ContentItem, Layout } from '../domain/package';
import type { MinyanException, MinyanRule } from '../domain/minyan';
import { supabase } from './supabase';

export type AdminDraft = {
  rules: MinyanRule[];
  exceptions: MinyanException[];
  content: ContentItem[];
  layout: Layout;
};

export interface AdminRepository {
  mode: 'demo' | 'supabase';
  loadDraft(defaults: AdminDraft): Promise<AdminDraft>;
  saveDraft(draft: AdminDraft): Promise<void>;
}

export class DemoRepository implements AdminRepository {
  readonly mode = 'demo' as const;

  async loadDraft(defaults: AdminDraft): Promise<AdminDraft> {
    try {
      const stored = localStorage.getItem('beth-menahem-draft');
      return stored ? { ...defaults, ...(JSON.parse(stored) as Partial<AdminDraft>) } : defaults;
    } catch {
      return defaults;
    }
  }

  async saveDraft(draft: AdminDraft): Promise<void> {
    localStorage.setItem('beth-menahem-draft', JSON.stringify(draft));
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function databaseError(error: { message?: string } | null): void {
  if (error) throw new Error('database_unavailable');
}

export class SupabaseRepository implements AdminRepository {
  readonly mode = 'supabase' as const;

  constructor(private readonly client: NonNullable<typeof supabase>) {}

  async loadDraft(defaults: AdminDraft): Promise<AdminDraft> {
    const [rulesResult, exceptionsResult, contentResult, layoutResult] = await Promise.all([
      this.client.from('minyan_rules').select('*').order('priority', { ascending: false }),
      this.client.from('minyan_exceptions').select('*').order('local_date'),
      this.client.from('content_items').select('*').order('priority', { ascending: false }),
      this.client.from('layout_draft').select('*').eq('id', true).maybeSingle(),
    ]);
    for (const result of [rulesResult, exceptionsResult, contentResult, layoutResult]) {
      databaseError(result.error);
    }
    const rules = (rulesResult.data ?? []).map((value) => {
      const row = asRecord(value);
      return {
        id: String(row.id),
        office: String(row.office),
        time: typeof row.time === 'string' ? row.time : null,
        ...(typeof row.valid_from === 'string' ? { validFrom: row.valid_from } : {}),
        ...(typeof row.valid_to === 'string' ? { validTo: row.valid_to } : {}),
        weekdays: asArray<number>(row.weekdays),
        dayKinds: asArray<string>(row.day_kinds),
        priority: Number(row.priority ?? 0),
        active: row.active === true,
        status: row.status === 'confirmed' ? 'confirmed' : 'to_confirm',
      } satisfies MinyanRule;
    });
    const exceptions = (exceptionsResult.data ?? []).map((value) => {
      const row = asRecord(value);
      return {
        id: String(row.id),
        date: String(row.local_date),
        office: String(row.office),
        time: typeof row.time === 'string' ? row.time : null,
        cancelled: row.cancelled === true,
      } satisfies MinyanException;
    });
    const content = (contentResult.data ?? []).map((value) => {
      const row = asRecord(value);
      return {
        id: String(row.id),
        type: row.type as ContentItem['type'],
        title: String(row.title),
        ...(typeof row.body === 'string' ? { body: row.body } : {}),
        ...(typeof row.title_he === 'string' ? { titleHe: row.title_he } : {}),
        mediaIds: asArray<string>(row.media_ids),
        ...(typeof row.qr_url === 'string' ? { qrUrl: row.qr_url } : {}),
        ...(typeof row.starts_at === 'string' ? { startsAt: row.starts_at } : {}),
        ...(typeof row.ends_at === 'string' ? { endsAt: row.ends_at } : {}),
        ...(asArray<number>(row.weekdays).length
          ? { weekdays: asArray<number>(row.weekdays) }
          : {}),
        ...(asArray<NonNullable<ContentItem['timeWindows']>[number]>(row.time_windows).length
          ? {
              timeWindows: asArray<NonNullable<ContentItem['timeWindows']>[number]>(
                row.time_windows,
              ),
            }
          : {}),
        shabbatVisibility: row.shabbat_visibility === 'hide' ? 'hide' : 'show',
        isCommercial: row.is_commercial === true,
        priority: Number(row.priority ?? 0),
        durationSec: Number(row.duration_sec ?? 20),
      } satisfies ContentItem;
    });
    const layoutRow = asRecord(layoutResult.data);
    const options = asRecord(layoutRow.options);
    const layout: Layout = layoutResult.data
      ? {
          mode: layoutRow.mode === 'playlist' ? 'playlist' : 'fixed',
          zones: asRecord(layoutRow.zones),
          slides: asArray<Layout['slides'][number]>(layoutRow.slides),
          ...(options.banner ? { banner: options.banner as NonNullable<Layout['banner']> } : {}),
        }
      : defaults.layout;
    return { rules, exceptions, content, layout };
  }

  async saveDraft(draft: AdminDraft): Promise<void> {
    const rules = draft.rules.map((rule) => ({
      id: rule.id,
      office: rule.office,
      time: rule.time,
      valid_from: rule.validFrom ?? null,
      valid_to: rule.validTo ?? null,
      weekdays: rule.weekdays ?? [],
      day_kinds: rule.dayKinds ?? [],
      priority: rule.priority,
      active: rule.active,
      status: rule.status,
    }));
    const exceptions = draft.exceptions.map((item) => ({
      ...(item.id ? { id: item.id } : {}),
      local_date: item.date,
      office: item.office,
      time: item.time,
      cancelled: item.cancelled,
    }));
    const content = draft.content.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body ?? null,
      title_he: item.titleHe ?? null,
      media_ids: item.mediaIds,
      qr_url: item.qrUrl ?? null,
      starts_at: item.startsAt ?? null,
      ends_at: item.endsAt ?? null,
      weekdays: item.weekdays ?? [],
      time_windows: item.timeWindows ?? [],
      shabbat_visibility: item.shabbatVisibility,
      is_commercial: item.isCommercial,
      priority: item.priority,
      duration_sec: item.durationSec,
      status: 'ready',
    }));

    const { data: existingRules, error: rulesReadError } = await this.client
      .from('minyan_rules')
      .select('id');
    databaseError(rulesReadError);
    const retainedRuleIds = new Set(rules.map((row) => row.id));
    const staleRuleIds = (existingRules ?? [])
      .map((row) => row.id)
      .filter((id) => !retainedRuleIds.has(id));
    if (staleRuleIds.length) {
      const { error } = await this.client.from('minyan_rules').delete().in('id', staleRuleIds);
      databaseError(error);
    }
    if (rules.length) {
      const { error } = await this.client.from('minyan_rules').upsert(rules, { onConflict: 'id' });
      databaseError(error);
    }

    const { data: existingExceptions, error: exceptionsReadError } = await this.client
      .from('minyan_exceptions')
      .select('id');
    databaseError(exceptionsReadError);
    const retainedExceptionIds = new Set(
      exceptions.map((row) => row.id).filter((id): id is string => id !== undefined),
    );
    const staleExceptionIds = (existingExceptions ?? [])
      .map((row) => row.id)
      .filter((id) => !retainedExceptionIds.has(id));
    if (staleExceptionIds.length) {
      const { error } = await this.client
        .from('minyan_exceptions')
        .delete()
        .in('id', staleExceptionIds);
      databaseError(error);
    }
    if (exceptions.length) {
      const { error } = await this.client
        .from('minyan_exceptions')
        .upsert(exceptions, { onConflict: 'local_date,office' });
      databaseError(error);
    }

    const { data: existingContent, error: contentReadError } = await this.client
      .from('content_items')
      .select('id,status');
    databaseError(contentReadError);
    const retainedContentIds = new Set(content.map((row) => row.id));
    const staleContentIds = (existingContent ?? [])
      .map((row) => row.id)
      .filter((id) => !retainedContentIds.has(id));
    if (staleContentIds.length) {
      const { error } = await this.client.from('content_items').delete().in('id', staleContentIds);
      databaseError(error);
    }
    if (content.length) {
      const statuses = new Map<string, string>(
        (existingContent ?? []).map((row) => [row.id, row.status]),
      );
      const savedContent = content.map((row) => ({
        ...row,
        status: statuses.get(row.id) ?? 'ready',
      }));
      const { error } = await this.client
        .from('content_items')
        .upsert(savedContent, { onConflict: 'id' });
      databaseError(error);
    }
    const { error } = await this.client.from('layout_draft').upsert(
      {
        id: true,
        mode: draft.layout.mode,
        zones: draft.layout.zones,
        slides: draft.layout.slides,
        options: draft.layout.banner ? { banner: draft.layout.banner } : {},
      },
      { onConflict: 'id' },
    );
    databaseError(error);
  }
}

export function createAdminRepository(): AdminRepository {
  return supabase ? new SupabaseRepository(supabase) : new DemoRepository();
}
