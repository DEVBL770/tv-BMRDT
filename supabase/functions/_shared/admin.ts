import { compilePackage } from './domain/compile.ts';
import { stripHebrewMarks, rambamFrenchReference } from './domain/providers/rambamNames.ts';
import { HebcalProvider, ProviderError } from './domain/providers/hebcal.ts';
import { DaySchema, type ContentItem, type Day, type Layout } from './domain/package.ts';
import type { CalendarEvent, ZmanimDay } from './domain/providers/types.ts';
import { addLocalDays, localDateOf, weekdayOf } from './domain/time.ts';
import { HttpError, sha256Hex, type BackendClient } from './backend.ts';

type DatabaseRow = Record<string, unknown>;

type SettingsRow = DatabaseRow & {
  religious_method_status: 'pending' | 'approved';
  religious_method_params: Record<string, unknown>;
  approved_by: string | null;
  approved_at: string | null;
  site_name: string;
  site_address: string;
  logo_media_id: string | null;
  sponsor_margin_before_min: number;
  sponsor_margin_after_min: number;
  hide_commercial_on_chol_hamoed: boolean;
  hebrew_day_change: string;
  updated_at: string;
};

type MinyanRuleRow = DatabaseRow & {
  id: string;
  office: string;
  time: string | null;
  valid_from: string | null;
  valid_to: string | null;
  weekdays: number[];
  day_kinds: string[];
  priority: number;
  active: boolean;
  status: 'to_confirm' | 'confirmed';
  cancelled: boolean;
};

type MinyanExceptionRow = DatabaseRow & {
  id: string;
  local_date: string;
  office: string;
  time: string | null;
  cancelled: boolean;
  status?: 'to_confirm' | 'confirmed';
};

type ContentRow = DatabaseRow & {
  id: string;
  type: ContentItem['type'];
  title: string;
  body: string | null;
  title_he: string | null;
  media_ids: string[];
  qr_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  weekdays: number[];
  time_windows: ContentItem['timeWindows'];
  shabbat_visibility: 'show' | 'hide';
  is_commercial: boolean;
  priority: number;
  duration_sec: number;
  status: 'draft' | 'ready' | 'archived';
};

type LayoutRow = DatabaseRow & {
  mode: Layout['mode'];
  zones: Layout['zones'];
  slides: Layout['slides'];
  options: { banner?: Layout['banner'] } | null;
  updated_at: string;
  updated_by: string | null;
};

type JewishDayRow = DatabaseRow & {
  local_date: string;
  hebrew_date: Day['hebrew'];
  parasha: Day['parasha'] | null;
  holidays: string[];
  holidays_he: string[];
  holiday_kinds: Day['holidayKinds'] | null;
  rosh_hodesh: string | null;
  omer: number | null;
  study: Day['study'];
  zmanim: Day['zmanim'];
};

type StudyEntryRow = {
  local_date: string;
  kind: string;
  reference: string;
  url: string | null;
};

export type DraftSnapshot = {
  settings: SettingsRow;
  rules: MinyanRuleRow[];
  exceptions: MinyanExceptionRow[];
  content: ContentRow[];
  layout: LayoutRow;
};

type Snapshot = DraftSnapshot;

function resultError(error: { message?: string } | null): void {
  if (error) throw new HttpError('database_unavailable', 503);
}

function frenchMonth(value: string): string {
  const month = value.toLocaleLowerCase('en');
  const names: Record<string, string> = {
    tishrei: 'Tichri',
    tishri: 'Tichri',
    heshvan: 'Hechvan',
    cheshvan: 'Hechvan',
    kislev: 'Kislev',
    tevet: 'Tévèt',
    "sh'vat": 'Chevat',
    'sh’vat': 'Chevat',
    shvat: 'Chevat',
    shevat: 'Chevat',
    'adar i': 'Adar I',
    'adar ii': 'Adar II',
    adar: 'Adar',
    nisan: 'Nissan',
    iyar: 'Iyar',
    sivan: 'Sivan',
    tamuz: 'Tamouz',
    av: 'Av',
    elul: 'Eloul',
  };
  return names[month] ?? value.charAt(0).toLocaleUpperCase('fr') + value.slice(1);
}

function normalizedLabel(value: string): string {
  return value.replace(/h\u0332/gu, "'h");
}

function groupEvents(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const result = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    result.set(event.date, [...(result.get(event.date) ?? []), event]);
  }
  return result;
}

function frenchCalendarParts(date: string) {
  const parts = new Intl.DateTimeFormat('fr-FR-u-ca-hebrew', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(new Date(`${date}T12:00:00.000Z`));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: Number(get('day')),
    month: get('month'),
    year: Number(get('year').replace(/\D/g, '')),
  };
}

function toDay(
  date: string,
  eventsByDate: Map<string, CalendarEvent[]>,
  zmanimByDate: Map<string, ZmanimDay>,
  studyEntries: Map<string, StudyEntryRow[]>,
): Day {
  const events = eventsByDate.get(date) ?? [];
  const hebrewDate = events.find((event) => event.category === 'hebdate');
  const englishDate = (hebrewDate?.titleOriginal ?? hebrewDate?.title ?? '')
    .replace(/,/g, '')
    .trim();
  const parsedDate = /^(\d+)\s+(.+?)\s+(\d{4})$/.exec(englishDate);
  const fallback = frenchCalendarParts(date);
  const hebrewParts = hebrewDate?.hebrewDateParts;
  const day = Number(parsedDate?.[1] ?? fallback.day);
  const monthName = parsedDate?.[2] ?? fallback.month;
  const year = Number(parsedDate?.[3] ?? fallback.year);
  const frenchMonthName = frenchMonth(monthName);
  const hebrewText =
    hebrewParts?.day && hebrewParts.month
      ? stripHebrewMarks(
          `${hebrewParts.day} ${hebrewParts.month}${hebrewParts.year ? ` ${hebrewParts.year}` : ''}`,
        )
      : stripHebrewMarks(hebrewDate?.titleHe ?? '');
  const zmanim = zmanimByDate.get(date)?.times ?? {};
  const candle = events.find(
    (event) => event.category === 'candles' || /allumage|candle lighting/i.test(event.title),
  );
  const havdalah = events.find(
    (event) => event.category === 'havdalah' || /havdalah|sortie de chabbat/i.test(event.title),
  );
  const holidayEvents = events.filter((event) =>
    ['holiday', 'major', 'minor'].includes(event.category ?? ''),
  );
  const holidays = holidayEvents.map((event) => normalizedLabel(event.title));
  const holidaysHe = holidayEvents.map((event) => stripHebrewMarks(event.titleHe ?? ''));
  const yomtovEvents = holidayEvents.filter((event) => event.yomtov === true);
  const cholHamoedEvent = holidayEvents.find((event) =>
    /\(CH''M\)/i.test(event.titleOriginal ?? ''),
  );
  const erevYomtov = holidayEvents.some(
    (event) => event.erev === true || /^Erev\b/i.test(event.titleOriginal ?? ''),
  );
  const holidayKinds = [
    ...(yomtovEvents.length ? (['yomtov'] as const) : []),
    ...(cholHamoedEvent ? (['chol_hamoed'] as const) : []),
    ...(erevYomtov ? (['erev_yomtov'] as const) : []),
  ];
  const yomtovLabels = yomtovEvents.map((event) => ({
    fr: normalizedLabel(event.title),
    ...(event.titleHe ? { he: stripHebrewMarks(event.titleHe) } : {}),
  }));
  const cholHamoedLabel = cholHamoedEvent
    ? {
        fr: `Hol Hamoed ${normalizedLabel(
          cholHamoedEvent.title.replace(/\s+(?:I|II|III|IV|V|VI|VII|VIII)\b.*$/iu, ''),
        )}`,
        ...(cholHamoedEvent.titleHe
          ? {
              he: `חול המועד ${stripHebrewMarks(cholHamoedEvent.titleHe)
                .replace(/\s+[א-ת׳״]+\s*\(.*$/u, '')
                .replace(/\s*\(.*$/u, '')}`,
            }
          : {}),
      }
    : undefined;
  const weekday = weekdayOf(date);
  const nextShabbat = addLocalDays(date, (6 - weekday + 7) % 7);
  const shabbatEvents = eventsByDate.get(nextShabbat) ?? [];
  const hasHolidayReading = shabbatEvents.some(
    (event) => event.yomtov === true || /\(CH''M\)/i.test(event.titleOriginal ?? ''),
  );
  const parashaEvent = hasHolidayReading
    ? undefined
    : shabbatEvents.find((event) => event.category === 'parashat');
  const specialShabbatEvent = events.find((event) => event.subcategory === 'shabbat');
  const roshHodesh = events.find((event) => event.category === 'roshchodesh');
  const omerEvent = events.find((event) => event.category === 'omer');
  const dafYomi = events.find((event) => event.category === 'dafyomi');
  const rambam = events.find((event) => event.category?.toLocaleLowerCase('en').includes('rambam'));
  const dafTitle = dafYomi
    ? (dafYomi.titleOriginal ?? dafYomi.title)
        .replace(/^Daf Yomi:\s*/i, '')
        .replace(/^Bechorot\b/i, 'Bekhorot')
    : undefined;
  const rambamTitle = rambam?.titleOriginal ?? rambam?.title;
  const rambamFrench = rambamTitle ? rambamFrenchReference(rambamTitle) : undefined;
  const study = studyEntries.get(date) ?? [];
  const dailyEntry = (kind: string) => study.find((entry) => entry.kind === kind);
  const hayomYom = dailyEntry('hayom_yom');
  const tanya = dailyEntry('tanya');
  const zman = (instant: string | undefined) =>
    instant ? { instant, sourceId: `hebcal:zmanim:${date}`, overridden: false } : undefined;
  const eventInstant = (event: CalendarEvent | undefined) => event?.instant;

  return DaySchema.parse({
    date,
    weekday,
    hebrew: {
      fr: `${day} ${frenchMonthName} ${year}`,
      he: hebrewText,
      day,
      month: frenchMonthName,
      year,
    },
    ...(parashaEvent
      ? {
          parasha: {
            fr: normalizedLabel(
              parashaEvent.title
                .replace(/^Parashat?\s*/i, 'Paracha ')
                .replace(/^Parachah\s*/i, 'Paracha '),
            ),
            ...(parashaEvent.titleHe ? { he: stripHebrewMarks(parashaEvent.titleHe) } : {}),
          },
        }
      : {}),
    holidays,
    ...(holidaysHe.some(Boolean) ? { holidaysHe } : {}),
    ...(holidayKinds.length ? { holidayKinds } : {}),
    ...(yomtovLabels.length ? { yomtovLabels } : {}),
    ...(cholHamoedLabel ? { cholHamoedLabel } : {}),
    ...(specialShabbatEvent
      ? {
          specialShabbat: {
            fr: normalizedLabel(specialShabbatEvent.title),
            ...(specialShabbatEvent.titleHe
              ? { he: stripHebrewMarks(specialShabbatEvent.titleHe) }
              : {}),
          },
        }
      : {}),
    ...(roshHodesh ? { roshHodesh: normalizedLabel(roshHodesh.title) } : {}),
    ...(omerEvent ? { omer: Number(/(\d+)/.exec(omerEvent.title)?.[1]) || undefined } : {}),
    study: {
      ...(dafTitle
        ? {
            dafYomi: {
              fr: dafTitle,
              ...(dafYomi?.titleHe ? { he: stripHebrewMarks(dafYomi.titleHe) } : {}),
            },
          }
        : {}),
      ...(rambamTitle && (rambamFrench || rambam?.titleHe)
        ? {
            rambam: {
              ...(rambamFrench ? { fr: rambamFrench } : {}),
              ...(rambam?.titleHe ? { he: stripHebrewMarks(rambam.titleHe) } : {}),
            },
          }
        : {}),
      ...(hayomYom
        ? {
            hayomYom: {
              reference: hayomYom.reference,
              ...(hayomYom.url ? { url: hayomYom.url } : {}),
            },
          }
        : {}),
      ...(tanya
        ? {
            tanya: {
              reference: tanya.reference,
              ...(tanya.url ? { url: tanya.url } : {}),
            },
          }
        : {}),
    },
    zmanim: {
      ...(zman(zmanim.alotHaShachar) ? { alot: zman(zmanim.alotHaShachar) } : {}),
      ...(zman(zmanim.misheyakir) ? { misheyakir: zman(zmanim.misheyakir) } : {}),
      ...(zman(zmanim.sunrise) ? { sunrise: zman(zmanim.sunrise) } : {}),
      ...(zman(zmanim.chatzot) ? { chatzot: zman(zmanim.chatzot) } : {}),
      ...(zman(zmanim.sunset) ? { sunset: zman(zmanim.sunset) } : {}),
      ...(zman(zmanim.tzeit85deg) ? { tzeit: zman(zmanim.tzeit85deg) } : {}),
      ...(zman(eventInstant(candle)) ? { candleLighting: zman(eventInstant(candle)) } : {}),
      ...(zman(eventInstant(havdalah)) ? { havdalah: zman(eventInstant(havdalah)) } : {}),
    },
  });
}

function dayFromRow(row: JewishDayRow): Day {
  return DaySchema.parse({
    date: row.local_date,
    weekday: weekdayOf(row.local_date),
    hebrew: row.hebrew_date,
    ...(row.parasha ? { parasha: row.parasha } : {}),
    holidays: row.holidays ?? [],
    ...(row.holidays_he?.length ? { holidaysHe: row.holidays_he } : {}),
    ...(row.holiday_kinds?.length ? { holidayKinds: row.holiday_kinds } : {}),
    ...(row.rosh_hodesh ? { roshHodesh: row.rosh_hodesh } : {}),
    ...(row.omer ? { omer: row.omer } : {}),
    study: row.study ?? {},
    zmanim: row.zmanim ?? {},
  });
}

export async function readSnapshot(client: BackendClient): Promise<Snapshot> {
  const [settings, rules, exceptions, content, layout] = await Promise.all([
    client.from('settings').select('*').eq('id', true).maybeSingle(),
    client.from('minyan_rules').select('*').order('priority', { ascending: false }),
    client.from('minyan_exceptions').select('*').order('local_date'),
    client.from('content_items').select('*').order('priority', { ascending: false }),
    client.from('layout_draft').select('*').eq('id', true).maybeSingle(),
  ]);
  for (const result of [settings, rules, exceptions, content, layout]) resultError(result.error);
  if (!settings.data || !layout.data) throw new HttpError('draft_unavailable', 503);
  return {
    settings: settings.data,
    rules: rules.data ?? [],
    exceptions: exceptions.data ?? [],
    content: content.data ?? [],
    layout: layout.data,
  };
}

export async function readCurrentDays(client: BackendClient, now = new Date()): Promise<Day[]> {
  const start = localDateOf(now);
  const end = addLocalDays(start, 400);
  const { data, error } = await client
    .from('jewish_days')
    .select('*')
    .gte('local_date', start)
    .lte('local_date', end)
    .order('local_date');
  resultError(error);
  const rows = data ?? [];
  if (
    rows.length < 401 ||
    rows[0].local_date !== start ||
    rows.at(-1)?.local_date !== end ||
    rows.some((row, index) => row.local_date !== addLocalDays(start, index))
  ) {
    throw new HttpError('calendar_horizon_short', 422, {
      hint: 'Lancez refreshData avant de publier.',
    });
  }
  const days = rows.map(dayFromRow);
  const { data: overrides, error: overridesError } = await client
    .from('source_records')
    .select('id,kind,local_date,override_value,override_expires_at')
    .not('override_value', 'is', null)
    .gte('local_date', start)
    .lte('local_date', end);
  resultError(overridesError);
  const byDate = new Map(days.map((day) => [day.date, day]));
  const zmanimKeys: Record<string, keyof Day['zmanim']> = {
    alot: 'alot',
    alotHaShachar: 'alot',
    misheyakir: 'misheyakir',
    sunrise: 'sunrise',
    chatzot: 'chatzot',
    sunset: 'sunset',
    tzeit: 'tzeit',
    tzeit85deg: 'tzeit',
    candleLighting: 'candleLighting',
    havdalah: 'havdalah',
  };
  const nowMillis = now.getTime();
  for (const record of overrides ?? []) {
    if (
      !record.local_date ||
      (record.override_expires_at && Date.parse(record.override_expires_at) <= nowMillis)
    ) {
      continue;
    }
    const day = byDate.get(record.local_date);
    if (!day) continue;
    if (record.kind === 'zmanim' && typeof record.override_value === 'object') {
      for (const [sourceKey, rawValue] of Object.entries(record.override_value)) {
        const targetKey = zmanimKeys[sourceKey];
        const instant =
          typeof rawValue === 'string'
            ? rawValue
            : typeof rawValue === 'object' &&
                rawValue !== null &&
                'instant' in rawValue &&
                typeof rawValue.instant === 'string'
              ? rawValue.instant
              : undefined;
        if (targetKey && instant) {
          day.zmanim[targetKey] = {
            instant,
            sourceId: record.id,
            overridden: true,
          };
        }
      }
    } else if (record.kind === 'hebdate' && typeof record.override_value === 'object') {
      day.hebrew = record.override_value as Day['hebrew'];
    } else if (record.kind === 'parashat') {
      day.parasha =
        typeof record.override_value === 'string'
          ? { fr: record.override_value }
          : (record.override_value as Day['parasha']);
    } else if (record.kind === 'holiday' && Array.isArray(record.override_value)) {
      day.holidays = record.override_value.filter(
        (value): value is string => typeof value === 'string',
      );
    }
  }
  return days;
}

function contentFromRow(row: ContentRow): ContentItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    ...(row.body ? { body: row.body } : {}),
    ...(row.title_he ? { titleHe: row.title_he } : {}),
    mediaIds: row.media_ids ?? [],
    ...(row.qr_url ? { qrUrl: row.qr_url } : {}),
    ...(row.starts_at ? { startsAt: row.starts_at } : {}),
    ...(row.ends_at ? { endsAt: row.ends_at } : {}),
    ...(row.weekdays?.length ? { weekdays: row.weekdays } : {}),
    ...(row.time_windows?.length ? { timeWindows: row.time_windows } : {}),
    shabbatVisibility: row.shabbat_visibility,
    isCommercial: row.is_commercial,
    priority: row.priority,
    durationSec: row.duration_sec,
  };
}

function rulesFromSnapshot(snapshot: Snapshot) {
  return snapshot.rules.map((row) => ({
    id: row.id,
    office: row.office,
    time: row.time,
    cancelled: row.cancelled,
    ...(row.valid_from ? { validFrom: row.valid_from } : {}),
    ...(row.valid_to ? { validTo: row.valid_to } : {}),
    weekdays: row.weekdays ?? [],
    dayKinds: row.day_kinds ?? [],
    priority: row.priority ?? 0,
    active: row.active,
    status: row.status,
  }));
}

function exceptionsFromSnapshot(snapshot: Snapshot) {
  return snapshot.exceptions.map((row) => ({
    id: row.id,
    date: row.local_date,
    office: row.office,
    time: row.time,
    cancelled: row.cancelled,
    status: row.status,
  }));
}

function layoutFromSnapshot(snapshot: Snapshot): Layout {
  const options = snapshot.layout.options ?? {};
  return {
    mode: snapshot.layout.mode,
    zones: snapshot.layout.zones ?? {},
    slides: snapshot.layout.slides ?? [],
    ...(options.banner ? { banner: options.banner } : {}),
  };
}

async function referencedMedia(
  client: BackendClient,
  content: ContentRow[],
  additionalIds: string[] = [],
): Promise<{
  media: Array<{ id: string; sha256: string; bytes: number; mime: string }>;
  ids: string[];
}> {
  const ids = [...new Set([...content.flatMap((item) => item.media_ids ?? []), ...additionalIds])];
  if (!ids.length) return { media: [], ids: [] };
  const { data, error } = await client
    .from('media_assets')
    .select('id,sha256,bytes,mime,status,storage_path')
    .in('id', ids);
  resultError(error);
  const ready = new Map((data ?? []).map((asset) => [asset.id, asset]));
  const missing: string[] = [];
  for (const id of ids) {
    const asset = ready.get(id);
    if (asset?.status !== 'ready') {
      missing.push(id);
      continue;
    }
    const separator = asset.storage_path.lastIndexOf('/');
    const directory = separator === -1 ? '' : asset.storage_path.slice(0, separator);
    const filename = asset.storage_path.slice(separator + 1);
    const { data: files, error: storageError } = await client.storage
      .from('media')
      .list(directory, { search: filename });
    if (storageError || !files?.some((file) => file.name === filename)) missing.push(id);
  }
  if (missing.length) throw new HttpError('media_not_ready', 422, { mediaIds: missing });
  const media = ids.map((id) => {
    const asset = ready.get(id);
    if (!asset?.sha256) throw new HttpError('media_not_ready', 422, { mediaIds: [id] });
    return { id, sha256: asset.sha256, bytes: asset.bytes, mime: asset.mime };
  });
  return { media, ids };
}

export async function compileSnapshot(
  client: BackendClient,
  snapshot: Snapshot,
  days: Day[],
  versionNumber: number,
  now = new Date(),
) {
  const readyContentRows = snapshot.content.filter((item) => item.status === 'ready');
  const settings = snapshot.settings;
  const { media, ids } = await referencedMedia(
    client,
    readyContentRows,
    settings.logo_media_id ? [settings.logo_media_id] : [],
  );
  const methods = {
    status: settings.religious_method_status,
    params: settings.religious_method_params ?? {},
    ...(settings.approved_by ? { approvedBy: settings.approved_by } : {}),
    ...(settings.approved_at ? { approvedAt: settings.approved_at } : {}),
  };
  const input = {
    settings: {
      site: {
        name: settings.site_name,
        address: settings.site_address,
        timezone: 'Europe/Paris' as const,
        attribution: ['Calendrier : Hebcal.com (CC BY 4.0)', 'Météo : MET Norway'],
        ...(settings.logo_media_id ? { logoMediaId: settings.logo_media_id } : {}),
      },
      methods,
      sponsorMargin: {
        beforeMinutes: settings.sponsor_margin_before_min,
        afterMinutes: settings.sponsor_margin_after_min,
      },
      hideCommercialOnCholHamoed: settings.hide_commercial_on_chol_hamoed,
      hebrewDayChange: settings.hebrew_day_change,
    },
    days,
    rules: rulesFromSnapshot(snapshot),
    exceptions: exceptionsFromSnapshot(snapshot),
    content: readyContentRows.map(contentFromRow),
    layout: layoutFromSnapshot(snapshot),
    media,
    versionNumber,
    now,
  };
  const compiled = await compilePackage(input);
  const manifest = media.map((item) => ({ ...item }));
  if (ids.length !== manifest.length) throw new HttpError('media_not_ready', 422);
  return { ...compiled, manifest };
}

export async function publishCompiled(
  client: BackendClient,
  snapshot: Snapshot,
  compiled: Awaited<ReturnType<typeof compileSnapshot>>,
  source: 'admin' | 'refresh' | 'restore',
  actorId: string | null,
  restoredFrom: string | null = null,
) {
  const { data: state, error: stateError } = await client
    .from('public_state')
    .select('current_version_number')
    .eq('id', true)
    .maybeSingle();
  resultError(stateError);
  const expected = (state?.current_version_number ?? 0) + 1;
  const { data, error } = await client.rpc('publish_package', {
    p_expected_number: expected,
    p_package: compiled.package,
    p_hash: compiled.packageHash,
    p_manifest: compiled.manifest,
    p_snapshot: snapshot,
    p_source: source,
    p_restored_from: restoredFrom,
    p_actor: actorId,
  });
  if (error) {
    if (error.message?.includes('version_conflict')) {
      throw new HttpError('version_conflict', 409);
    }
    throw new HttpError('publish_unavailable', 503);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { id: row?.id as string, versionNumber: row?.version_number as number };
}

async function replaceRows(
  client: BackendClient,
  table: string,
  rows: DatabaseRow[],
): Promise<void> {
  const { error: deleteError } = await client.from(table).delete().not('id', 'is', null);
  resultError(deleteError);
  if (rows.length) {
    const { error } = await client.from(table).insert(rows);
    resultError(error);
  }
}

export async function restoreSnapshot(
  client: BackendClient,
  snapshot: Snapshot,
  actorId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const settings = { ...snapshot.settings, updated_at: now };
  const { error: settingsError } = await client
    .from('settings')
    .upsert(settings, { onConflict: 'id' });
  resultError(settingsError);
  await replaceRows(client, 'minyan_rules', snapshot.rules);
  await replaceRows(client, 'minyan_exceptions', snapshot.exceptions);
  await replaceRows(client, 'content_items', snapshot.content);
  const layout = {
    ...snapshot.layout,
    updated_at: now,
    updated_by: actorId,
  };
  const { error: layoutError } = await client
    .from('layout_draft')
    .upsert(layout, { onConflict: 'id' });
  resultError(layoutError);
}

function dayRecord(
  day: Day,
  calendarProvenance: Record<string, unknown>,
  zmanimProvenance: Record<string, unknown>,
  now: string,
) {
  return {
    local_date: day.date,
    hebrew_date: day.hebrew,
    parasha: day.parasha ?? null,
    holidays: day.holidays,
    holidays_he: day.holidaysHe ?? [],
    holiday_kinds: day.holidayKinds ?? [],
    rosh_hodesh: day.roshHodesh ?? null,
    omer: day.omer ?? null,
    study: day.study,
    zmanim: day.zmanim,
    source_records: { calendar: calendarProvenance, zmanim: zmanimProvenance },
    fetched_at: now,
    valid_until: calendarProvenance.validUntil ?? now,
  };
}

export async function refreshCalendar(
  client: BackendClient,
  actorId: string | null,
): Promise<{ days: number; published?: { id: string; versionNumber: number } }> {
  const now = new Date();
  const today = localDateOf(now);
  const start = addLocalDays(today, -7);
  const end = addLocalDays(today, 400);
  const baseUrl = Deno.env.get('HEBCAL_BASE_URL') ?? 'https://www.hebcal.com';
  const { data: settings, error: settingsError } = await client
    .from('settings')
    .select('rambam_cycle')
    .eq('id', true)
    .maybeSingle();
  resultError(settingsError);
  const provider = new HebcalProvider({ baseUrl, dr1: settings?.rambam_cycle === 'dr1' });
  const [
    { data: events, provenance: calendarProvenance },
    { data: zmanim, provenance: zmanimProvenance },
  ] = await Promise.all([provider.getCalendar(start, end), provider.getZmanim(start, end)]).catch(
    async (error) => {
      const code = error instanceof ProviderError ? error.code : 'invalid_response';
      await client.from('source_health').upsert(
        {
          source: 'hebcal',
          last_failure_at: now.toISOString(),
          last_error_code: code,
          last_error_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: 'source' },
      );
      throw new HttpError('calendar_refresh_failed', 502);
    },
  );
  const { data: studyRows, error: studyError } = await client
    .from('daily_study_entries')
    .select('local_date,kind,reference,url')
    .eq('status', 'ready')
    .gte('local_date', start)
    .lte('local_date', end);
  resultError(studyError);
  const studyEntries = new Map<string, StudyEntryRow[]>();
  for (const entry of studyRows ?? []) {
    studyEntries.set(entry.local_date, [...(studyEntries.get(entry.local_date) ?? []), entry]);
  }
  const eventsByDate = groupEvents(events);
  const zmanimByDate = new Map(zmanim.map((item) => [item.date, item]));
  let days: Day[];
  try {
    days = Array.from({ length: 408 }, (_, offset) =>
      toDay(addLocalDays(start, offset), eventsByDate, zmanimByDate, studyEntries),
    );
  } catch {
    await client.from('source_health').upsert(
      {
        source: 'hebcal',
        last_failure_at: now.toISOString(),
        last_error_code: 'invalid_response',
        last_error_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: 'source' },
    );
    throw new HttpError('calendar_refresh_failed', 502);
  }
  const fetchedAt = calendarProvenance.fetchedAt;
  const sourceRows: Array<Record<string, unknown>> = events.map((event, index) => ({
    provider: 'hebcal',
    kind: event.category ?? 'event',
    local_date: event.date,
    source_id: `${event.category ?? 'event'}:${index}:${event.titleOriginal ?? event.title}`,
    instant: event.instant ?? null,
    value: event.raw ?? event,
    method: { path: '/hebcal', provider: calendarProvenance.provider },
    params: calendarProvenance.params,
    fetched_at: fetchedAt,
    valid_until: calendarProvenance.validUntil,
  }));
  sourceRows.push(
    ...zmanim.map((day) => ({
      provider: 'hebcal',
      kind: 'zmanim',
      local_date: day.date,
      source_id: 'daily',
      value: day.times,
      method: { path: '/zmanim', provider: zmanimProvenance.provider },
      params: zmanimProvenance.params,
      fetched_at: zmanimProvenance.fetchedAt,
      valid_until: zmanimProvenance.validUntil,
    })),
  );
  const daysPayload = days.map((day) =>
    dayRecord(day, calendarProvenance, zmanimProvenance, fetchedAt),
  );
  const dataHash = await sha256Hex(JSON.stringify(days));
  const { data: oldHealth, error: healthError } = await client
    .from('source_health')
    .select('data_hash')
    .eq('source', 'hebcal')
    .maybeSingle();
  resultError(healthError);
  const { error: upsertError } = await client.rpc('upsert_calendar_refresh', {
    p_days: daysPayload,
    p_records: sourceRows,
    p_data_hash: dataHash,
    p_success_at: now.toISOString(),
  });
  if (upsertError) {
    await client.from('source_health').upsert(
      {
        source: 'hebcal',
        last_failure_at: new Date().toISOString(),
        last_error_code: 'invalid_response',
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source' },
    );
    throw new HttpError('calendar_refresh_failed', 502);
  }
  const { data: state, error: stateError } = await client
    .from('public_state')
    .select('current_version_id,current_version_number')
    .eq('id', true)
    .maybeSingle();
  resultError(stateError);
  if (!state?.current_version_id) return { days: days.length };
  const { data: currentVersion, error: versionError } = await client
    .from('published_versions')
    .select('package,draft_snapshot')
    .eq('id', state.current_version_id)
    .single();
  resultError(versionError);
  const lastDate = currentVersion.package?.horizon?.lastDate;
  const horizonShort = typeof lastDate !== 'string' || lastDate < addLocalDays(today, 330);
  if (oldHealth?.data_hash === dataHash && !horizonShort) return { days: days.length };
  const snapshot = currentVersion.draft_snapshot as Snapshot;
  const currentDays = await readCurrentDays(client, now);
  const compiled = await compileSnapshot(
    client,
    snapshot,
    currentDays,
    state.current_version_number + 1,
    now,
  );
  const published = await publishCompiled(client, snapshot, compiled, 'refresh', actorId);
  return { days: days.length, published };
}
