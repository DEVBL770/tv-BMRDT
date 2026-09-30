import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePackage } from '../src/domain/compile';
import { addLocalDays, weekdayOf } from '../src/domain/time';
import { HebcalProvider } from '../src/domain/providers/hebcal';
import type { CalendarEvent, ZmanimDay } from '../src/domain/providers/types';
import type { Day } from '../src/domain/package';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const firstDate = '2026-09-01';
const lastDate = addLocalDays(firstDate, 400);
const provider = new HebcalProvider({ dr1: false });

const [calendarResult, zmanimResult] = await Promise.all([
  provider.getCalendar(firstDate, lastDate),
  provider.getZmanim(firstDate, lastDate),
]);
const eventsByDate = groupByDate(calendarResult.data);
const zmanimByDate = new Map(zmanimResult.data.map((item) => [item.date, item]));

const days = Array.from({ length: 401 }, (_, offset) =>
  toDay(addLocalDays(firstDate, offset), eventsByDate, zmanimByDate),
);
const content = [
  {
    id: 'annonce-cours',
    type: 'announcement' as const,
    title: 'Cours de pensée juive — jeudi à 20 h',
    body: 'Un rendez-vous ouvert à tous, suivi d’un moment convivial.',
    mediaIds: [],
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2027-10-06T23:59:59.000Z',
    weekdays: [4],
    shabbatVisibility: 'hide' as const,
    isCommercial: false,
    priority: 40,
    durationSec: 22,
  },
  {
    id: 'kiddouch-famille',
    type: 'kiddouch' as const,
    title: 'Kiddouch offert par la famille Cohen',
    body: 'À l’occasion d’une joyeuse célébration familiale.',
    titleHe: 'קידוש משפחת כהן',
    mediaIds: [],
    shabbatVisibility: 'show' as const,
    isCommercial: false,
    priority: 60,
    durationSec: 24,
  },
  {
    id: 'mazal-tov',
    type: 'mazal_tov' as const,
    title: 'Mazal tov à la famille Lévy !',
    body: 'Une grande sim’ha pour la naissance de leur petite-fille.',
    mediaIds: [],
    shabbatVisibility: 'show' as const,
    isCommercial: false,
    priority: 50,
    durationSec: 22,
  },
  {
    id: 'azkara',
    type: 'azkara' as const,
    title: 'À la mémoire de David ben Moché',
    body: 'Que son souvenir soit une bénédiction.',
    mediaIds: [],
    shabbatVisibility: 'show' as const,
    isCommercial: false,
    priority: 45,
    durationSec: 20,
  },
  {
    id: 'dedicace',
    type: 'dedication' as const,
    title: 'À la mémoire de Rivka bat Yaakov',
    body: 'Dédicace pour l’élévation de son âme.',
    mediaIds: [],
    shabbatVisibility: 'show' as const,
    isCommercial: false,
    priority: 45,
    durationSec: 20,
  },
  {
    id: 'sponsor-boulangerie',
    type: 'sponsor' as const,
    title: 'Boulangerie Le Palais du Pain',
    body: 'Artisan boulanger — 18 rue de Crimée, Paris 19e.',
    mediaIds: [],
    shabbatVisibility: 'hide' as const,
    isCommercial: true,
    priority: 10,
    durationSec: 18,
  },
  {
    id: 'urgent',
    type: 'urgent' as const,
    title: 'Information importante',
    body: 'Merci de vérifier les horaires affichés avant chaque office.',
    mediaIds: [],
    shabbatVisibility: 'show' as const,
    isCommercial: false,
    priority: 100,
    durationSec: 18,
  },
  {
    id: 'qr-etude',
    type: 'qr' as const,
    title: 'Étude quotidienne',
    body: 'Scannez pour accéder à l’étude du jour.',
    mediaIds: [],
    qrUrl: 'https://www.chabad.org/dailystudy/',
    shabbatVisibility: 'show' as const,
    isCommercial: false,
    priority: 30,
    durationSec: 20,
  },
];

const rules = [
  {
    id: 'chaharit-base',
    office: 'Chaharit',
    time: '08:30',
    priority: 0,
    active: true,
    status: 'to_confirm' as const,
  },
  {
    id: 'minha-base',
    office: 'Min’ha',
    time: '19:00',
    priority: 0,
    active: true,
    status: 'to_confirm' as const,
  },
  {
    id: 'arvit-base',
    office: 'Arvit',
    time: '20:00',
    priority: 0,
    active: true,
    status: 'to_confirm' as const,
  },
];
const exceptions = [
  {
    id: 'demo-sunday',
    date: '2026-10-04',
    office: 'Chaharit',
    time: '09:00',
    cancelled: false,
    status: 'to_confirm' as const,
  },
];
const layout = {
  mode: 'fixed' as const,
  zones: {
    header: { enabled: true },
    offices: { enabled: true },
    zmanim: { enabled: true },
    community: { enabled: true },
    study: { enabled: true },
  },
  slides: [
    { id: 'schedule', kind: 'schedule' as const, durationSec: 24 },
    { id: 'shabbat', kind: 'shabbat' as const, durationSec: 18 },
    {
      id: 'content',
      kind: 'content' as const,
      contentIds: content.map(({ id }) => id),
      durationSec: 24,
    },
    { id: 'study', kind: 'study' as const, durationSec: 18 },
    { id: 'qr', kind: 'qr' as const, contentIds: ['qr-etude'], durationSec: 20 },
  ],
  banner: {
    text: 'Calendrier : Hebcal.com (CC BY 4.0) · Météo : MET Norway',
    enabled: true,
  },
};

const { package: compiled } = await compilePackage({
  settings: {
    methods: {
      status: 'pending',
      params: {
        latitude: 48.8885,
        longitude: 2.3821,
        timezone: 'Europe/Paris',
        diaspora: true,
        candleLightingMinutes: 18,
        tzeit: '8.5deg',
      },
    },
    sponsorMargin: { beforeMinutes: 30, afterMinutes: 0 },
  },
  days,
  rules,
  exceptions,
  content,
  layout,
  media: [],
  versionNumber: 1,
  now: new Date('2026-09-30T10:00:00.000Z'),
});

const output = resolve(root, 'src/fixtures/demo-package.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(compiled, null, 2)}\n`, 'utf8');
console.log(`Paquet de démonstration écrit : ${output}`);
console.log(
  `${compiled.days.length} jours, ${compiled.religiousPeriods.length} périodes, hash ${compiled.packageHash}`,
);

function groupByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of events) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
  return grouped;
}

function toDay(
  date: string,
  eventsByDate: Map<string, CalendarEvent[]>,
  zmanimByDate: Map<string, ZmanimDay>,
): Day {
  const events = eventsByDate.get(date) ?? [];
  const calendarDate = new Date(`${date}T12:00:00.000Z`);
  const frenchParts = new Intl.DateTimeFormat('fr-FR-u-ca-hebrew', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(calendarDate);
  const hebrewParts = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(calendarDate);
  const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  const day = Number(part(frenchParts, 'day'));
  const monthName = part(frenchParts, 'month');
  const year = Number(part(frenchParts, 'year').replace(/\D/g, ''));
  const zmanim = zmanimByDate.get(date)?.times ?? {};
  const candle = events.find(
    (event) => event.category === 'candles' || /allumage|candle lighting/i.test(event.title),
  );
  const havdalah = events.find(
    (event) => event.category === 'havdalah' || /havdalah|sortie de chabbat/i.test(event.title),
  );
  const holidays = events
    .filter((event) => ['holiday', 'major', 'minor'].includes(event.category ?? ''))
    .map(({ title }) => title);
  const holidaysHe = events
    .filter((event) => ['holiday', 'major', 'minor'].includes(event.category ?? ''))
    .map(({ titleHe }) => titleHe ?? '');
  const holidayKinds = new Set<'yomtov' | 'chol_hamoed'>();
  const currentHolidayEvents = events.filter((event) =>
    ['holiday', 'major'].includes(event.category ?? ''),
  );
  const nextHolidayEvents = candle
    ? (eventsByDate.get(addLocalDays(date, 1)) ?? []).filter((event) =>
        ['holiday', 'major'].includes(event.category ?? ''),
      )
    : [];
  for (const event of [...currentHolidayEvents, ...nextHolidayEvents]) {
    const normalized = event.title
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('fr')
      .replace(/[’']/g, '');
    if (/hol hamoed|\bhm\b/.test(normalized)) holidayKinds.add('chol_hamoed');
    else if (
      /rosh hashana|roch hachana|yom kipp?our?|soukk?ot|souccot|sukkot|chemini atzeret|shmini atzeret|simc?hat torah|pessah|pesach|paque|chavouot|shavuot/.test(
        normalized,
      )
    ) {
      holidayKinds.add('yomtov');
    }
  }
  const parasha = events.find((event) => event.category === 'parashat');
  const roshHodesh = events.find((event) => event.category === 'roshchodesh');
  const omerEvent = events.find((event) => event.category === 'omer');
  const omer = omerEvent ? Number(/(\d+)/.exec(omerEvent.title)?.[1]) || undefined : undefined;
  const dafYomi = events.find((event) => event.category === 'dafyomi');
  const rambam = events.find((event) => event.category?.toLocaleLowerCase('en').includes('rambam'));
  const zman = (instant: string | undefined) => (instant ? { instant } : undefined);
  const eventInstant = (event: CalendarEvent | undefined) => event?.instant;
  return {
    date,
    weekday: weekdayOf(date),
    hebrew: {
      fr: `${day} ${frenchMonth(monthName)} ${year}`,
      he: hebrewParts.replace(/[\u0591-\u05C7]/g, ''),
      day,
      month: frenchMonth(monthName),
      year,
    },
    ...(parasha
      ? { parasha: { fr: parasha.title, ...(parasha.titleHe ? { he: parasha.titleHe } : {}) } }
      : {}),
    holidays,
    ...(holidaysHe.some(Boolean) ? { holidaysHe } : {}),
    ...(holidayKinds.size > 0 ? { holidayKinds: [...holidayKinds] } : {}),
    ...(roshHodesh ? { roshHodesh: roshHodesh.title } : {}),
    ...(omer ? { omer } : {}),
    study: {
      ...(dafYomi ? { dafYomi: dafYomi.title } : {}),
      ...(rambam ? { rambam: rambam.title } : {}),
      ...(date === '2026-09-30'
        ? {
            hayomYom: {
              reference: 'Hayom Yom — 18 Tichri 5787',
              url: 'https://www.chabad.org/dailystudy/hayomyom.asp',
            },
            tanya: {
              reference: 'Tanya — chapitre 3',
              url: 'https://www.chabad.org/dailystudy/tanya.asp',
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
  };
}

function frenchMonth(month: string): string {
  const normalized = month.toLocaleLowerCase('en');
  const names: Record<string, string> = {
    tishri: 'Tichri',
    heshvan: 'Hechvan',
    cheshvan: 'Hechvan',
    kislev: 'Kislev',
    tevet: 'Tévèt',
    'sh’vat': 'Chevat',
    "sh'vat": 'Chevat',
    shvat: 'Chevat',
    'adar i': 'Adar I',
    'adar ii': 'Adar II',
    nisan: 'Nissan',
    iyar: 'Iyar',
    sivan: 'Sivan',
    tamuz: 'Tamouz',
    av: 'Av',
    elul: 'Eloul',
  };
  return names[normalized] ?? month;
}
