import { describe, expect, it } from 'vitest';
import { buildReligiousPeriods, hebrewDateAt, religiousStateAt, themeFor } from './religious';
import { testDay, testPackage } from './test-package';

describe('périodes et état religieux', () => {
  it('fusionne des périodes contiguës de fête et Chabbat', () => {
    const periods = buildReligiousPeriods([
      testDay('2026-10-02', {
        weekday: 5,
        candle: '2026-10-02T16:00:00.000Z',
        holidays: ['Chemini Atseret'],
      }),
      {
        ...testDay('2026-10-03', {
          weekday: 6,
          candle: '2026-10-03T17:01:00.000Z',
          holidays: ['Sim’hat Torah'],
        }),
        holidayKinds: ['yomtov'],
        zmanim: {
          candleLighting: { instant: '2026-10-03T17:01:00.000Z' },
          havdalah: { instant: '2026-10-04T17:00:00.000Z' },
        },
      },
      testDay('2026-10-02', {
        weekday: 5,
        candle: '2026-10-02T16:00:00.000Z',
        holidays: ['Chemini Atseret'],
      }),
      testDay('2026-10-03', { weekday: 6, havdalah: '2026-10-03T17:00:00.000Z' }),
    ]);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      kind: 'yomtov',
      start: '2026-10-02T16:00:00.000Z',
      end: '2026-10-04T17:00:00.000Z',
    });
  });

  it('retourne unknown hors horizon et catégorise les jours ordinaires et de veille', () => {
    const pkg = testPackage();
    expect(religiousStateAt('2026-10-02T12:00:00.000Z', pkg).kind).toBe('erev_shabbat');
    expect(religiousStateAt('2026-10-03T12:00:00.000Z', pkg).kind).toBe('shabbat');
    expect(religiousStateAt('2026-10-04T12:00:00.000Z', pkg).kind).toBe('weekday');
    expect(religiousStateAt('2027-01-01T12:00:00.000Z', pkg).kind).toBe('unknown');
  });

  it('reconnaît les jours de Hol Hamoed et sélectionne un thème stable', () => {
    const pkg = testPackage({
      days: [
        {
          ...testDay('2026-10-02', { weekday: 5, holidays: ['Hol Hamoed Souccot'] }),
          holidayKinds: ['chol_hamoed'],
        },
      ],
      horizon: { firstDate: '2026-10-02', lastDate: '2026-10-02' },
      religiousPeriods: [],
    });
    const state = religiousStateAt('2026-10-02T12:00:00.000Z', pkg);
    expect(state.kind).toBe('chol_hamoed');
    expect(themeFor(state)).toBe('yomtov');
    expect(themeFor('weekday')).toBe('weekday');
  });

  it('bascule la date hébraïque après la shkia configurée', () => {
    const today = testDay('2026-10-02', {
      weekday: 5,
      sunset: '2026-10-02T17:00:00.000Z',
    });
    const tomorrow = testDay('2026-10-03', { weekday: 6 });
    tomorrow.hebrew = {
      fr: '20 Tichri 5787',
      he: 'כ׳ תשרי תשפ״ז',
      day: 20,
      month: 'Tichri',
      year: 5787,
    };
    const pkg = testPackage({
      days: [today, tomorrow],
      horizon: { firstDate: today.date, lastDate: tomorrow.date },
      religiousPeriods: [],
    });
    expect(hebrewDateAt('2026-10-02T16:59:00.000Z', pkg)?.day).toBe(19);
    expect(hebrewDateAt('2026-10-02T17:00:00.000Z', pkg)?.day).toBe(20);
    expect(hebrewDateAt('2026-10-02T18:00:00.000Z', pkg, 'midnight')?.day).toBe(19);
  });
});
