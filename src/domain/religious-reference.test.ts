import { describe, expect, it } from 'vitest';
import comparisons from '../fixtures/reference-comparison.json';

describe('comparaison religieuse enregistrée', () => {
  it('couvre les douze dates de référence sans accès réseau', () => {
    expect(comparisons).toHaveLength(12);
    expect(comparisons.map(({ date }) => date)).toEqual([
      '2026-12-18',
      '2027-06-25',
      '2026-10-25',
      '2027-03-28',
      '2027-10-01',
      '2026-09-21',
      '2026-09-26',
      '2026-10-02',
      '2027-04-21',
      '2027-05-11',
      '2026-12-12',
      '2027-03-23',
    ]);
  });

  it('enregistre des écarts au plus égaux à une minute', () => {
    const differences = comparisons.flatMap((comparison) => Object.values(comparison.differences));
    expect(differences.length).toBeGreaterThan(0);
    expect(Math.max(...differences)).toBeLessThanOrEqual(1);
  });
});
