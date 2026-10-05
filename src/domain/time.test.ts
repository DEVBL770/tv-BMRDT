import { describe, expect, it } from 'vitest';
import { instantFromLocal, localDateOf, localTimeOf } from './time';

describe('temps local Europe/Paris', () => {
  it('convertit les instants en date et heure civiles parisiennes', () => {
    expect(localDateOf('2026-09-30T22:30:00.000Z')).toBe('2026-10-01');
    expect(localTimeOf('2026-09-30T22:30:00.000Z')).toBe('00:30');
  });

  it('avance une heure locale inexistante au premier instant équivalent après le saut', () => {
    const instant = instantFromLocal('2026-03-29', '02:30');
    expect(instant.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(localTimeOf(instant)).toBe('03:30');
  });

  it('choisit la première occurrence d’une heure locale ambiguë', () => {
    const instant = instantFromLocal('2026-10-25', '02:30');
    expect(instant.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(localTimeOf(instant)).toBe('02:30');
  });

  it('rejette les dates et heures locales invalides', () => {
    expect(() => instantFromLocal('2026-02-30', '08:00')).toThrow(RangeError);
    expect(() => instantFromLocal('2026-10-25', '24:00')).toThrow(RangeError);
  });
});
