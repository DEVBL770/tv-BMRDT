import { describe, expect, it } from 'vitest';
import { compileMinyanPlanning, resolveMinyan, type MinyanRule } from './minyan';

const baseRule: MinyanRule = {
  id: 'base',
  office: 'Chaharit',
  time: '08:30',
  priority: 0,
  active: true,
  status: 'to_confirm',
};

describe('résolution des minyanim', () => {
  it('applique une exception le dimanche uniquement et reprend la règle lundi', () => {
    const result = compileMinyanPlanning(
      ['2026-10-04', '2026-10-05'],
      [baseRule],
      [{ id: 'dimanche', date: '2026-10-04', office: 'Chaharit', time: '09:00', cancelled: false }],
    );
    expect(result.map(({ date, time, source }) => [date, time, source])).toEqual([
      ['2026-10-04', '09:00', 'exception'],
      ['2026-10-05', '08:30', 'base'],
    ]);
  });

  it('retourne une annulation explicitement', () => {
    const resolved = resolveMinyan(
      '2026-10-04',
      'Minha',
      [baseRule],
      [{ date: '2026-10-04', office: 'Minha', time: null, cancelled: true }],
    );
    expect(resolved).toMatchObject({ time: null, cancelled: true, source: 'exception' });
  });

  it('préfère une règle de période à une règle hebdomadaire', () => {
    const resolved = resolveMinyan(
      '2026-10-04',
      'Chaharit',
      [
        baseRule,
        {
          id: 'weekly',
          office: 'Chaharit',
          time: '08:00',
          weekdays: [0],
          priority: 5,
          active: true,
          status: 'confirmed',
        },
        {
          id: 'period',
          office: 'Chaharit',
          time: '09:00',
          validFrom: '2026-10-01',
          validTo: '2026-10-10',
          priority: 0,
          active: true,
          status: 'confirmed',
        },
      ],
      [],
    );
    expect(resolved).toMatchObject({ time: '09:00', source: 'period', ruleId: 'period' });
  });

  it('choisit la période la plus courte puis la priorité, en signalant les égalités', () => {
    const rules: MinyanRule[] = [
      {
        id: 'large',
        office: 'Minha',
        time: '18:00',
        validFrom: '2026-10-01',
        validTo: '2026-10-31',
        priority: 10,
        active: true,
        status: 'confirmed',
      },
      {
        id: 'short-low',
        office: 'Minha',
        time: '19:00',
        validFrom: '2026-10-03',
        validTo: '2026-10-05',
        priority: 1,
        active: true,
        status: 'confirmed',
      },
      {
        id: 'short-high',
        office: 'Minha',
        time: '19:30',
        validFrom: '2026-10-03',
        validTo: '2026-10-05',
        priority: 5,
        active: true,
        status: 'confirmed',
      },
      {
        id: 'short-high-copy',
        office: 'Minha',
        time: '19:45',
        validFrom: '2026-10-03',
        validTo: '2026-10-05',
        priority: 5,
        active: true,
        status: 'confirmed',
      },
    ];
    const resolved = resolveMinyan('2026-10-04', 'Minha', rules, []);
    expect(resolved.time).toBe('19:30');
    expect(resolved.conflicts).toEqual([
      { level: 'period', ruleIds: ['short-high', 'short-high-copy'] },
    ]);
  });

  it('garde la modification de Minha limitée à son jour et séparée de la shkia', () => {
    const resolved = resolveMinyan(
      '2026-10-05',
      'Minha',
      [
        { ...baseRule, id: 'minha-base', office: 'Minha', time: '19:00' },
        {
          id: 'minha-dimanche',
          office: 'Minha',
          time: '18:30',
          weekdays: [0],
          priority: 2,
          active: true,
          status: 'confirmed',
        },
      ],
      [{ date: '2026-10-04', office: 'Minha', time: '18:00', cancelled: false }],
    );
    expect(resolved).toMatchObject({ time: '19:00', source: 'base' });
  });
});
