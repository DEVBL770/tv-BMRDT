import { describe, expect, it } from 'vitest';
import { ChabadProvider, CalJProvider } from './disabled';
import { HebcalProvider, ProviderError, chunkHebcalDates } from './hebcal';
import { calendarResponse, zmanimRangeResponse, zmanimResponse } from './fixtures/hebcal-recorded';

const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('HebcalProvider avec réponses enregistrées', () => {
  it('normalise les Adar I/II 5787, Roch Hodech, Omer, fêtes et études', async () => {
    const provider = new HebcalProvider({
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname !== '/hebcal') return reply(zmanimResponse);
        const start = url.searchParams.get('start') ?? '';
        const end = url.searchParams.get('end') ?? '';
        return reply({
          items: calendarResponse.items.filter((item) => {
            const date = item.date.slice(0, 10);
            return date >= start && date <= end;
          }),
        });
      },
      delayMs: 0,
    });
    const calendar = await provider.getCalendar('2026-10-01', '2027-04-30');
    const study = await provider.getStudy('2027-04-22', '2027-04-23');
    const roshHodesh = calendar.data.filter(({ category }) => category === 'roshchodesh');
    expect(roshHodesh.some(({ hebrewDate }) => hebrewDate?.includes('Adar I 5787'))).toBe(true);
    expect(roshHodesh.some(({ hebrewDate }) => hebrewDate?.includes('Adar II 5787'))).toBe(true);
    expect(
      calendar.data.some(({ category, title }) => category === 'omer' && title.includes('Omer')),
    ).toBe(true);
    expect(
      calendar.data.some(({ date, category }) => date === '2026-10-03' && category === 'holiday'),
    ).toBe(true);
    expect(
      calendar.data.some(({ date, category }) => date === '2026-10-04' && category === 'parashat'),
    ).toBe(false);
    expect(calendar.data.filter(({ category }) => category === 'holiday')).toHaveLength(2);
    expect(study.data).toEqual([
      {
        date: '2027-04-23',
        dafYomi: { title: 'Yevamot 2' },
        rambam: { title: 'Kelim 1-3' },
      },
    ]);
  });

  it('conserve les champs de classification et les composantes hébraïques de Hebcal', async () => {
    const provider = new HebcalProvider({
      fetch: async () =>
        reply({
          items: [
            {
              date: '2026-09-25',
              title: '14. Tishrei',
              title_orig: '14 Tishrei 5787',
              category: 'hebdate',
              hebrew: 'י״ד תִּשְׁרֵי',
              hdate: '14 Tishrei 5787',
              heDateParts: { d: 'י״ד', m: 'תשרי', y: 'תשפ״ז' },
            },
            {
              date: '2026-09-25',
              title: 'Erev Soukkot',
              title_orig: 'Erev Sukkot',
              category: 'holiday',
              subcat: 'major',
              hebrew: 'ערב סוכות',
            },
            {
              date: '2026-09-26',
              title: 'Soukkot I',
              title_orig: 'Sukkot I',
              category: 'holiday',
              subcat: 'major',
              yomtov: true,
              hebrew: 'סוכות א׳',
            },
            {
              date: '2026-09-28',
              title: 'Soukkot III (H̲’’M)',
              title_orig: "Sukkot III (CH''M)",
              category: 'holiday',
              subcat: 'major',
              hebrew: 'סוכות ג׳ (חוה״מ)',
            },
          ],
        }),
      delayMs: 0,
    });
    const { data } = await provider.getCalendar('2026-09-25', '2026-09-28');
    expect(data.find(({ category }) => category === 'hebdate')).toMatchObject({
      titleHe: 'י״ד תִּשְׁרֵי',
      hebrewDateParts: { day: 'י״ד', month: 'תשרי', year: 'תשפ״ז' },
    });
    expect(data.find(({ category }) => category === 'hebdate')).toMatchObject({
      titleOriginal: '14 Tishrei 5787',
    });
    expect(data.find(({ titleOriginal }) => titleOriginal === 'Erev Sukkot')).toMatchObject({
      subcategory: 'major',
    });
    expect(data.find(({ date }) => date === '2026-09-26')).toMatchObject({ yomtov: true });
    expect(data.find(({ titleOriginal }) => titleOriginal?.includes("CH''M"))).toMatchObject({
      titleOriginal: "Sukkot III (CH''M)",
      subcategory: 'major',
    });
  });

  it('demande les paramètres Paris/diaspora attendus et découpe les plages à 180 jours', async () => {
    const urls: URL[] = [];
    const provider = new HebcalProvider({
      fetch: async (input) => {
        urls.push(new URL(String(input)));
        return reply(calendarResponse);
      },
      delayMs: 0,
      dr1: true,
    });
    await provider.getCalendar('2026-09-01', '2027-10-06');
    expect(urls).toHaveLength(3);
    for (const url of urls) {
      expect(url.searchParams.get('tzid')).toBe('Europe/Paris');
      expect(url.searchParams.get('latitude')).toBe('48.8885');
      expect(url.searchParams.get('longitude')).toBe('2.3821');
      expect(url.searchParams.get('i')).toBe('off');
      expect(url.searchParams.get('dr1')).toBe('on');
      expect(url.searchParams.get('leyning')).toBe('off');
      expect(url.searchParams.get('M')).toBe('on');
      expect(url.searchParams.get('start')).toBeTruthy();
      expect(url.searchParams.get('end')).toBeTruthy();
    }
    expect(chunkHebcalDates('2026-01-01', '2026-06-30')).toEqual([
      { start: '2026-01-01', end: '2026-06-29' },
      { start: '2026-06-30', end: '2026-06-30' },
    ]);
  });

  it('normalise les zmanim et joint la provenance', async () => {
    const provider = new HebcalProvider({
      fetch: async () => reply(zmanimResponse),
      delayMs: 0,
      now: () => new Date('2026-09-30T10:00:00.000Z'),
    });
    const result = await provider.getZmanim('2026-10-02', '2026-10-02');
    expect(result.data[0].times.alotHaShachar).toBe('2026-10-02T05:40:00+02:00');
    expect(result.provenance).toMatchObject({
      provider: 'Hebcal',
      method: '/zmanim',
      fetchedAt: '2026-09-30T10:00:00.000Z',
    });
  });

  it('normalise les zmanim en plages avec les dates imbriquées de Hebcal', async () => {
    const provider = new HebcalProvider({
      fetch: async () => reply(zmanimRangeResponse),
      delayMs: 0,
    });
    const result = await provider.getZmanim('2026-09-30', '2026-10-01');
    expect(result.data).toEqual([
      {
        date: '2026-09-30',
        times: {
          alotHaShachar: '2026-09-30T06:15:00+02:00',
          misheyakir: '2026-09-30T06:43:00+02:00',
          sunrise: '2026-09-30T07:48:00+02:00',
          chatzot: '2026-09-30T13:40:00+02:00',
          sunset: '2026-09-30T19:32:00+02:00',
          tzeit85deg: '2026-09-30T20:18:00+02:00',
        },
      },
      {
        date: '2026-10-01',
        times: {
          alotHaShachar: '2026-10-01T06:16:00+02:00',
          misheyakir: '2026-10-01T06:45:00+02:00',
          sunrise: '2026-10-01T07:50:00+02:00',
          chatzot: '2026-10-01T13:40:00+02:00',
          sunset: '2026-10-01T19:30:00+02:00',
          tzeit85deg: '2026-10-01T20:16:00+02:00',
        },
      },
    ]);
  });

  it('sérialise les appels concurrents', async () => {
    let active = 0;
    let maximum = 0;
    const provider = new HebcalProvider({
      fetch: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        return reply(calendarResponse);
      },
      delayMs: 0,
    });
    await Promise.all([
      provider.getCalendar('2026-09-01', '2026-09-02'),
      provider.getCalendar('2026-09-03', '2026-09-04'),
    ]);
    expect(maximum).toBe(1);
  });

  it('normalise les réponses HTTP, JSON et schéma invalides', async () => {
    const http = new HebcalProvider({ fetch: async () => reply({}, 429), delayMs: 0 });
    await expect(http.getCalendar('2026-09-01', '2026-09-01')).rejects.toMatchObject({
      code: 'http',
      status: 429,
    });
    const invalid = new HebcalProvider({
      fetch: async () => reply({ items: ['bad'] }),
      delayMs: 0,
    });
    await expect(invalid.getCalendar('2026-09-01', '2026-09-01')).rejects.toBeInstanceOf(
      ProviderError,
    );
    const brokenJson = new HebcalProvider({
      fetch: async () => new Response('{', { status: 200 }),
      delayMs: 0,
    });
    await expect(brokenJson.getCalendar('2026-09-01', '2026-09-01')).rejects.toMatchObject({
      code: 'invalid_json',
    });
  });

  it('désactive CalJ et Chabad tant qu’aucune autorisation écrite n’existe', async () => {
    expect(new ChabadProvider().enabled).toBe(false);
    await expect(new ChabadProvider().getCalendar('2026-01-01', '2026-01-02')).rejects.toThrow(
      'désactivé sans autorisation écrite',
    );
    await expect(new CalJProvider().getCalendar('2026-01-01', '2026-01-02')).rejects.toThrow(
      'désactivé sans autorisation écrite',
    );
  });
});
