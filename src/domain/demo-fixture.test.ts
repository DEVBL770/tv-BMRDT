import { describe, expect, it } from 'vitest';
import demoPackageData from '../fixtures/demo-package.json';
import { compilePackage } from './compile';
import { isContentVisible } from './filtering';
import { parsePublishedPackage } from './package';
import { rambamFrenchReference, stripHebrewMarks } from './providers/rambamNames';

const demoPackage = parsePublishedPackage(demoPackageData);

function day(date: string) {
  const result = demoPackage.days.find((item) => item.date === date);
  if (!result) throw new Error(`Date absente de la fixture : ${date}`);
  return result;
}

function periodContaining(label: string) {
  const result = demoPackage.religiousPeriods.find((item) => item.label.includes(label));
  if (!result) throw new Error(`Période absente de la fixture : ${label}`);
  return result;
}

describe('fixture religieuse Hebcal', () => {
  it('utilise les dates hébraïques Hebcal, y compris Adar I et Adar II', () => {
    expect(day('2026-09-25').hebrew).toMatchObject({
      fr: '14 Tichri 5787',
      he: 'י״ד תשרי תשפ״ז',
    });

    const adarI = demoPackage.days.find(
      (item) => item.hebrew.day === 1 && item.hebrew.month === 'Adar I',
    );
    const adarII = demoPackage.days.find(
      (item) => item.hebrew.day === 1 && item.hebrew.month === 'Adar II',
    );
    expect(adarI?.hebrew.fr).toBe('1 Adar I 5787');
    expect(adarI?.hebrew.he).toContain('אדר א׳');
    expect(adarII?.hebrew.fr).toBe('1 Adar II 5787');
    expect(adarII?.hebrew.he).toContain('אדר ב׳');
    expect(stripHebrewMarks('י״ד תִּשְׁרֵי־א׳')).toBe('י״ד תשרי־א׳');
  });

  it('classe Erev Yom Tov, Yom Tov et les jours de Hol Hamoed depuis Hebcal', async () => {
    expect(day('2026-09-25').holidayKinds).toContain('erev_yomtov');
    expect(day('2026-09-26').holidayKinds).toContain('yomtov');
    expect(day('2026-09-28').holidayKinds).toContain('chol_hamoed');
    expect(day('2026-09-28').cholHamoedLabel).toEqual({
      fr: 'Hol Hamoed Soukkot',
      he: 'חול המועד סוכות',
    });

    const compiled = await compilePackage({
      settings: {},
      days: [day('2026-09-25'), day('2026-09-26')],
      rules: [
        {
          id: 'eve-rule',
          office: 'Veille',
          time: '17:00',
          priority: 1,
          active: true,
          status: 'confirmed',
          dayKinds: ['erev_yomtov'],
        },
        {
          id: 'holiday-rule',
          office: 'Fête',
          time: '09:00',
          priority: 1,
          active: true,
          status: 'confirmed',
          dayKinds: ['yomtov'],
        },
      ],
      exceptions: [],
      content: [],
      layout: {
        mode: 'fixed',
        zones: {},
        slides: [{ id: 'schedule', kind: 'schedule', durationSec: 30 }],
      },
      media: [],
      versionNumber: 2,
      now: new Date('2026-09-30T10:00:00.000Z'),
    });
    expect(
      compiled.package.minyanim.find(
        ({ date, office }) => date === '2026-09-25' && office === 'Veille',
      )?.time,
    ).toBe('17:00');
    expect(
      compiled.package.minyanim.find(
        ({ date, office }) => date === '2026-09-26' && office === 'Fête',
      )?.time,
    ).toBe('09:00');
    expect(compiled.package.hideCommercialOnCholHamoed).toBe(false);
  });

  it('construit les libellés Chabbat et fête à partir des journées réellement incluses', () => {
    expect(periodContaining('Chabbat Nitzavim-Vayelekh')).toMatchObject({
      label: 'Chabbat Nitzavim-Vayelekh',
      labelHe: 'שבת נצבים־וילך',
    });
    expect(day('2026-09-05').parasha?.fr).toBe('Paracha Nitzavim-Vayelekh');
    expect(day('2026-09-01').parasha?.fr).toBe('Paracha Nitzavim-Vayelekh');
    expect(day('2026-09-19').specialShabbat?.fr).toBe('Chabbat Chouvah');
    expect(periodContaining('Yom Kippour')).toMatchObject({
      label: 'Yom Kippour',
      labelHe: 'יום כיפור',
      kind: 'yomtov',
    });
    expect(periodContaining('Yom Kippour').label).not.toContain('Erev');
    expect(periodContaining('Soukkot I')).toMatchObject({
      label: 'Soukkot I · Chabbat · Soukkot II',
      labelHe: 'סוכות א׳ · שבת · סוכות ב׳',
      kind: 'yomtov',
    });
    expect(periodContaining('Chemini Atzéret')).toMatchObject({
      label: "Chemini Atzéret · Chabbat · Sim'hat Torah",
      labelHe: 'שמיני עצרת · שבת · שמחת תורה',
    });

    const roshHashanah = periodContaining('Roch Hachanah 5788');
    expect(roshHashanah).toMatchObject({
      label: 'Roch Hachanah 5788 · Chabbat · Roch Hachanah II',
      labelHe: 'ראש השנה 5788 · שבת · ראש השנה ב׳',
    });
    const pesachFirst = periodContaining("Pessa'h I");
    const pesachLast = periodContaining("Pessa'h VII");
    expect(pesachFirst).toMatchObject({
      label: "Pessa'h I · Pessa'h II · Chabbat",
      labelHe: 'פסח א׳ · פסח ב׳ · שבת',
    });
    expect(pesachLast).toMatchObject({
      label: "Pessa'h VII · Pessa'h VIII",
      labelHe: 'פסח ז׳ · פסח ח׳',
    });
    expect(periodContaining('Chavou’ot I')).toMatchObject({
      label: 'Chavou’ot I · Chavou’ot II · Chabbat',
      labelHe: 'שבועות א׳ · שבועות ב׳ · שבת',
    });
  });

  it('translittère Rambam, conserve Daf Yomi et masque les sponsors à Hol Hamoed seulement si demandé', () => {
    expect(day('2026-09-25').study.rambam).toMatchObject({
      fr: 'Hilkhot Kelim 18-20',
      he: 'הלכות כלים פרק 18-20',
    });
    expect(day('2026-09-26').study.dafYomi).toMatchObject({
      fr: 'Bekhorot 8',
      he: 'בכורות דף ח׳',
    });
    expect(rambamFrenchReference('Unknown Rambam Section 1-3')).toBeUndefined();

    const sponsor = demoPackage.content.find((item) => item.id === 'sponsor-boulangerie');
    if (!sponsor) throw new Error('Sponsor absent de la fixture.');
    const at = '2026-09-30T10:00:00+02:00';
    expect(isContentVisible(sponsor, at, demoPackage)).toBe(true);
    expect(
      isContentVisible(sponsor, at, { ...demoPackage, hideCommercialOnCholHamoed: true }),
    ).toBe(false);
  });
});
