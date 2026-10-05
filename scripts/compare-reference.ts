import { HebrewCalendar, flags } from '@hebcal/core';
import { ComplexZmanimCalendar, GeoLocation } from 'kosher-zmanim';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const fixturePath = resolve(root, 'src/fixtures/demo-package.json');
const outputPath = resolve(root, 'docs/VALIDATION_RELIGIEUSE.md');
const snapshotPath = resolve(root, 'src/fixtures/reference-comparison.json');
const dates = [
  { date: '2026-12-18', note: "Vendredi d'hiver" },
  { date: '2027-06-25', note: "Vendredi d'été" },
  { date: '2026-10-25', note: "Passage à l'heure d'hiver" },
  { date: '2027-03-28', note: "Passage à l'heure d'été" },
  { date: '2027-10-01', note: 'Erev Roch Hachana 5788' },
  { date: '2026-09-21', note: 'Kippour 5787' },
  { date: '2026-09-26', note: 'Soukkot I 5787' },
  { date: '2026-10-02', note: "Chemini Atseret / Sim'hat Torah 2026" },
  { date: '2027-04-21', note: "Premier soir de Pessa'h 2027" },
  { date: '2027-05-11', note: 'Chavouot 2027' },
  { date: '2026-12-12', note: "Chabbat de 'Hanouka" },
  { date: '2027-03-23', note: 'Pourim 2027' },
] as const;
const zmanNames = [
  ['candleLighting', 'Allumage'],
  ['havdalah', 'Sortie'],
  ['alot', 'Alot (16,1°)'],
  ['misheyakir', 'Misheyakir (11,5°)'],
  ['sunrise', 'Lever du soleil'],
  ['sunset', 'Chkia'],
  ['tzeit', 'Tsét (8,5°)'],
] as const;
const formatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const location = new GeoLocation('Beth Menahem, Paris', 48.8885, 2.3821, 0, 'Europe/Paris');

type ZmanKey = (typeof zmanNames)[number][0];
type Comparison = {
  date: string;
  note: string;
  hebrewDate: { he: string; fr: string };
  hebcalLabels: string[];
  hebcal: Partial<Record<ZmanKey, string>>;
  independent: Partial<Record<ZmanKey, string>>;
  differences: Partial<Record<ZmanKey, number>>;
  independentCalendar: { hebrewDate: string; labels: string[] };
};

function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function eventTime(instant: string | undefined): string | undefined {
  return instant ? formatter.format(new Date(instant)) : undefined;
}

function dateTime(value: { toJSDate(): Date } | null): Date | undefined {
  return value?.toJSDate();
}

function formatDateTime(value: Date | undefined): string | undefined {
  return value ? formatter.format(value) : undefined;
}

function calendarFor(date: string, references: { candleLighting?: string; havdalah?: string }) {
  const calendar = new ComplexZmanimCalendar(location);
  calendar.setDate(new Date(`${date}T12:00:00Z`));
  const sunset = dateTime(calendar.getSunset());
  if (!sunset) throw new Error(`Kosher-zmanim n'a pas calculé la shkia du ${date}.`);
  const tzeit = dateTime(calendar.getSunsetOffsetByDegrees(98.5));
  const candleLighting = references.candleLighting
    ? Date.parse(references.candleLighting) > sunset.getTime()
      ? tzeit
      : new Date(sunset.getTime() - 18 * 60_000)
    : undefined;
  const havdalah = references.havdalah ? tzeit : undefined;
  const alot = dateTime(calendar.getAlos16Point1Degrees());
  const misheyakir = dateTime(calendar.getMisheyakir11Point5Degrees());
  const sunrise = dateTime(calendar.getSunrise());

  const values: Partial<Record<ZmanKey, Date>> = {
    ...(candleLighting ? { candleLighting } : {}),
    ...(havdalah ? { havdalah } : {}),
    ...(alot ? { alot } : {}),
    ...(misheyakir ? { misheyakir } : {}),
    ...(sunrise ? { sunrise } : {}),
    sunset,
    ...(tzeit ? { tzeit } : {}),
  };
  return values;
}

function differenceMinutes(first: string, second: string): number {
  return Math.round((Math.abs(Date.parse(first) - Date.parse(second)) / 60_000) * 10) / 10;
}

const packageData = JSON.parse(await readFile(fixturePath, 'utf8')) as {
  days: Array<{
    date: string;
    hebrew: { he: string; fr: string };
    holidays: string[];
    parasha?: { fr: string; he?: string };
    specialShabbat?: { fr: string; he?: string };
    cholHamoedLabel?: { fr: string; he?: string };
    yomtovLabels?: Array<{ fr: string; he?: string }>;
    zmanim: Partial<Record<ZmanKey, { instant?: string }>>;
  }>;
};
const dayByDate = new Map(packageData.days.map((day) => [day.date, day]));
const sortedDates = [...dates].sort((first, second) => first.date.localeCompare(second.date));
const independentEvents = HebrewCalendar.calendar({
  start: new Date(`${sortedDates[0].date}T12:00:00Z`),
  end: new Date(`${sortedDates.at(-1)!.date}T12:00:00Z`),
  sedrot: true,
  il: false,
  addHebrewDates: true,
  locale: 'he',
});
const eventsByDate = new Map<string, typeof independentEvents>();
for (const event of independentEvents) {
  const key = toDateKey(event.greg());
  eventsByDate.set(key, [...(eventsByDate.get(key) ?? []), event]);
}

const comparisons: Comparison[] = dates.map(({ date, note }) => {
  const day = dayByDate.get(date);
  if (!day) throw new Error(`Date absente de la fixture Hebcal : ${date}.`);
  const independent = calendarFor(date, {
    ...(day.zmanim.candleLighting?.instant
      ? { candleLighting: day.zmanim.candleLighting.instant }
      : {}),
    ...(day.zmanim.havdalah?.instant ? { havdalah: day.zmanim.havdalah.instant } : {}),
  });
  const hebcalValues: Partial<Record<ZmanKey, string>> = {};
  const independentValues: Partial<Record<ZmanKey, string>> = {};
  const differences: Partial<Record<ZmanKey, number>> = {};

  for (const [key] of zmanNames) {
    const hebcal = eventTime(day.zmanim[key]?.instant);
    const calculated = formatDateTime(independent[key]);
    if (hebcal) hebcalValues[key] = hebcal;
    if (calculated) independentValues[key] = calculated;
    if (hebcal && calculated) {
      differences[key] = differenceMinutes(
        day.zmanim[key]!.instant!,
        independent[key]!.toISOString(),
      );
    }
  }

  const events = eventsByDate.get(date) ?? [];
  const calendarHebrewDate = events.find((event) => event.getFlags() & flags.HEBREW_DATE);
  const calendarLabels = events
    .filter(
      (event) =>
        event.getFlags() &
        (flags.CHAG |
          flags.CHOL_HAMOED |
          flags.EREV |
          flags.PARSHA_HASHAVUA |
          flags.SPECIAL_SHABBAT),
    )
    .map((event) => event.render('he'));
  const labels = [
    ...(day.specialShabbat ? [day.specialShabbat.fr] : []),
    ...(day.cholHamoedLabel ? [day.cholHamoedLabel.fr] : []),
    ...(day.yomtovLabels ?? []).map((label) => label.fr),
    ...(day.parasha ? [day.parasha.fr] : []),
  ];

  return {
    date,
    note,
    hebrewDate: day.hebrew,
    hebcalLabels: labels.length > 0 ? labels : day.holidays,
    hebcal: hebcalValues,
    independent: Object.fromEntries(
      Object.entries(independentValues).map(([key, value]) => [key, value]),
    ),
    differences,
    independentCalendar: {
      hebrewDate: calendarHebrewDate?.render('he') ?? '—',
      labels: calendarLabels,
    },
  };
});

const lines = [
  '# Validation religieuse — référence et comparaison',
  '',
  '> Les méthodes de calcul restent en attente d’approbation du responsable religieux. Ces résultats sont une comparaison technique, pas une validation halakhique. Voir `SOURCES_AND_RIGHTS.md` §1.',
  '',
  'Coordonnées : 48,8885° N, 2,3821° E, Europe/Paris, altitude 0 m ; Hebcal `b=18`, `M=on` (8,5°), `alot=16,1°`, `misheyakir=11,5°`, changement de jour au coucher du soleil.',
  'Les heures sont affichées en heure locale de Paris. Kosher-zmanim utilise le calcul NOAA indépendamment ; allumage = shkia − 18 min, sortie/tsét = soleil à 8,5° sous l’horizon.',
  '',
];

for (const result of comparisons) {
  lines.push(
    `## ${result.date} — ${result.note}`,
    '',
    `Date hébraïque Hebcal : ${result.hebrewDate.he} (${result.hebrewDate.fr})`,
    `Paracha / fête Hebcal : ${result.hebcalLabels.join(' · ') || '—'}`,
    `Référence calendrier @hebcal/core : ${result.independentCalendar.hebrewDate}; ${result.independentCalendar.labels.join(' · ') || '—'}`,
    '',
    '| Repère | Hebcal normalisé | Kosher-zmanim | Écart (min) |',
    '| --- | ---: | ---: | ---: |',
  );
  for (const [key, label] of zmanNames) {
    const hebcal = result.hebcal[key] ?? '—';
    const independent = result.independent[key] ?? '—';
    const difference =
      result.differences[key] === undefined ? '—' : String(result.differences[key]);
    lines.push(`| ${label} | ${hebcal} | ${independent} | ${difference} |`);
    if (result.differences[key] !== undefined && result.differences[key]! > 1) {
      lines.push(
        `| ⚠ Alerte | Écart supérieur à une minute pour ${label} : ${result.differences[key]} min. | | |`,
      );
    }
  }
  lines.push(
    '',
    '| CalJ (relevé manuel) | Chabad.org (relevé manuel) | Validé par / date |',
    '| --- | --- | --- |',
    '|  |  |  |',
    '',
  );
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
await writeFile(snapshotPath, `${JSON.stringify(comparisons, null, 2)}\n`, 'utf8');
console.log(`Comparaison de ${comparisons.length} dates écrite dans ${outputPath}`);
