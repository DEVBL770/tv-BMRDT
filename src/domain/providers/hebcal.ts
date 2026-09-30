import { z } from 'zod';
import { addLocalDays } from '../time';
import type {
  CalendarEvent,
  CalendarProvider,
  ProviderResult,
  Provenance,
  StudyDay,
  StudyProvider,
  ZmanimDay,
  ZmanimProvider,
} from './types';

const BASE_URL = 'https://www.hebcal.com';
const LOCATION = { latitude: 48.8885, longitude: 2.3821, tzid: 'Europe/Paris' };
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const CalendarResponseSchema = z.object({ items: z.array(z.record(z.string(), z.unknown())) });
const ZmanimResponseSchema = z
  .object({
    date: z.union([z.string(), z.object({ start: z.string(), end: z.string() })]).optional(),
    items: z.array(z.record(z.string(), z.unknown())).optional(),
    times: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
  })
  .passthrough()
  .refine((value) => value.items !== undefined || value.times !== undefined, {
    message: 'La réponse zmanim ne contient ni items ni times.',
  });

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'http' | 'network' | 'invalid_json' | 'invalid_response',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type HebcalOptions = {
  fetch?: typeof fetch;
  dr1?: boolean;
  baseUrl?: string;
  delayMs?: number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
};

function chunks(start: string, end: string): Array<{ start: string; end: string }> {
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end) || start > end) {
    throw new RangeError('La période Hebcal doit contenir deux dates ISO valides, dans l’ordre.');
  }
  const result: Array<{ start: string; end: string }> = [];
  let first = start;
  while (first <= end) {
    const last = [addLocalDays(first, 179), end].sort()[0];
    result.push({ start: first, end: last });
    first = addLocalDays(last, 1);
  }
  return result;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function eventDate(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match?.[1];
}

function provenance(
  method: string,
  params: Record<string, string | number | boolean>,
  now: Date,
): Provenance {
  return {
    provider: 'Hebcal',
    method,
    params,
    fetchedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export class HebcalProvider implements CalendarProvider, ZmanimProvider, StudyProvider {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly delayMs: number;
  private readonly getNow: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: HebcalOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (options.baseUrl ?? BASE_URL).replace(/\/$/, '');
    this.delayMs = options.delayMs ?? 125;
    this.getNow = options.now ?? (() => new Date());
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)));
    this.dr1 = options.dr1 ?? false;
  }

  readonly dr1: boolean;

  private async request(url: URL): Promise<unknown> {
    let release: () => void = () => {};
    const previous = this.requestQueue;
    this.requestQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const wait = this.delayMs - (Date.now() - this.lastRequestAt);
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();
      let response: Response;
      try {
        response = await this.fetcher(url);
      } catch (error) {
        throw new ProviderError(
          error instanceof Error ? error.message : 'Échec réseau Hebcal.',
          'network',
        );
      }
      if (!response.ok) {
        throw new ProviderError(
          `Hebcal a répondu HTTP ${response.status}.`,
          'http',
          response.status,
        );
      }
      try {
        return await response.json();
      } catch {
        throw new ProviderError('Hebcal a renvoyé un JSON invalide.', 'invalid_json');
      }
    } finally {
      release();
    }
  }

  private url(path: string, params: URLSearchParams): URL {
    return new URL(`${this.baseUrl}${path}?${params.toString()}`);
  }

  private calendarParams(start: string, end: string): URLSearchParams {
    return new URLSearchParams({
      v: '1',
      cfg: 'json',
      maj: 'on',
      min: 'on',
      nx: 'on',
      mf: 'on',
      ss: 'on',
      s: 'on',
      leyning: 'off',
      c: 'on',
      b: '18',
      M: 'on',
      o: 'on',
      d: 'on',
      F: 'on',
      dr3: 'on',
      ...(this.dr1 ? { dr1: 'on' } : {}),
      i: 'off',
      latitude: String(LOCATION.latitude),
      longitude: String(LOCATION.longitude),
      tzid: LOCATION.tzid,
      lg: 'fr',
      start,
      end,
    });
  }

  private zmanimParams(start: string, end: string): URLSearchParams {
    return new URLSearchParams({
      cfg: 'json',
      latitude: String(LOCATION.latitude),
      longitude: String(LOCATION.longitude),
      tzid: LOCATION.tzid,
      start,
      end,
    });
  }

  async getCalendar(start: string, end: string): Promise<ProviderResult<CalendarEvent[]>> {
    const params = this.calendarParams(start, end);
    const items: CalendarEvent[] = [];
    for (const range of chunks(start, end)) {
      const chunkParams = this.calendarParams(range.start, range.end);
      const raw = await this.request(this.url('/hebcal', chunkParams));
      const parsed = CalendarResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ProviderError(
          'Format de réponse calendrier Hebcal invalide.',
          'invalid_response',
        );
      }
      for (const item of parsed.data.items) {
        const date = eventDate(item.date);
        const title = asString(item.title);
        if (!date || !title) continue;
        const eventInstant =
          typeof item.date === 'string' && item.date.includes('T')
            ? new Date(item.date)
            : undefined;
        const instant =
          eventInstant && Number.isFinite(eventInstant.getTime())
            ? eventInstant.toISOString()
            : undefined;
        const titleHe = asString(item.hebrew);
        const category = asString(item.category);
        const hebrewDate = asString(item.hdate);
        const memo = asString(item.memo);
        const link = asString(item.link);
        items.push({
          date,
          ...(instant ? { instant } : {}),
          title,
          ...(titleHe ? { titleHe } : {}),
          ...(category ? { category } : {}),
          ...(hebrewDate ? { hebrewDate } : {}),
          ...(memo ? { memo } : {}),
          ...(link ? { link } : {}),
        });
      }
    }
    return {
      data: items,
      provenance: provenance('/hebcal', Object.fromEntries(params.entries()), this.getNow()),
    };
  }

  async getZmanim(start: string, end: string): Promise<ProviderResult<ZmanimDay[]>> {
    const params = this.zmanimParams(start, end);
    const result: ZmanimDay[] = [];
    for (const range of chunks(start, end)) {
      const chunkParams = this.zmanimParams(range.start, range.end);
      const raw = await this.request(this.url('/zmanim', chunkParams));
      const parsed = ZmanimResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ProviderError('Format de réponse zmanim Hebcal invalide.', 'invalid_response');
      }
      const records =
        parsed.data.items ?? (Array.isArray(parsed.data.times) ? parsed.data.times : []);
      if (records.length > 0) {
        for (const value of records) {
          if (typeof value !== 'object' || value === null) continue;
          const record = value as Record<string, unknown>;
          const date = eventDate(record.date);
          if (!date) continue;
          const sourceTimes =
            typeof record.times === 'object' && record.times !== null
              ? (record.times as Record<string, unknown>)
              : record;
          result.push({ date, times: this.readZmanim(sourceTimes, date) });
        }
      } else if (parsed.data.times && !Array.isArray(parsed.data.times)) {
        const sourceTimes = parsed.data.times as Record<string, unknown>;
        const dates = this.zmanimDates(sourceTimes, parsed.data.date, range.start);
        for (const date of dates) {
          result.push({ date, times: this.readZmanim(sourceTimes, date) });
        }
      } else {
        throw new ProviderError('Réponse zmanim Hebcal vide ou non reconnue.', 'invalid_response');
      }
    }
    return {
      data: result,
      provenance: provenance('/zmanim', Object.fromEntries(params.entries()), this.getNow()),
    };
  }

  async getStudy(start: string, end: string): Promise<ProviderResult<StudyDay[]>> {
    const { data, provenance: source } = await this.getCalendar(start, end);
    const days = new Map<string, StudyDay>();
    for (const item of data) {
      const current = days.get(item.date) ?? { date: item.date };
      if (item.category === 'dafyomi') current.dafYomi = item.title;
      if (item.category?.toLocaleLowerCase('en').includes('rambam')) {
        current.rambam = item.title;
      }
      if (current.dafYomi || current.rambam) days.set(item.date, current);
    }
    return { data: [...days.values()], provenance: { ...source, method: '/hebcal (études)' } };
  }

  private zmanimDates(
    times: Record<string, unknown>,
    responseDate: string | { start: string; end: string } | undefined,
    fallbackDate: string,
  ): string[] {
    const dates = new Set<string>();
    if (typeof responseDate === 'string' && DATE_PATTERN.test(responseDate))
      dates.add(responseDate);
    for (const value of Object.values(times)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      for (const date of Object.keys(value)) {
        if (DATE_PATTERN.test(date)) dates.add(date);
      }
    }
    if (dates.size === 0) {
      const date = typeof responseDate === 'object' ? responseDate.start : fallbackDate;
      if (DATE_PATTERN.test(date)) dates.add(date);
    }
    return [...dates].sort();
  }

  private readZmanim(record: Record<string, unknown>, date?: string): ZmanimDay['times'] {
    const keys = [
      'alotHaShachar',
      'misheyakir',
      'sunrise',
      'chatzot',
      'sunset',
      'tzeit85deg',
    ] as const;
    return Object.fromEntries(
      keys.flatMap((key) => {
        const value = record[key];
        if (typeof value === 'string') return [[key, value]];
        if (date && typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const atDate = (value as Record<string, unknown>)[date];
          if (typeof atDate === 'string') return [[key, atDate]];
        }
        return [];
      }),
    ) as ZmanimDay['times'];
  }
}

export { chunks as chunkHebcalDates };
