import { describe, expect, it } from 'vitest';
import { compilePackage } from './compile';
import { testDay } from './test-package';
import type { CompilePackageInput } from './compile';

const input = (): CompilePackageInput => ({
  settings: {},
  days: [testDay('2026-10-02'), testDay('2026-10-03')],
  rules: [
    {
      id: 'daily',
      office: 'Chaharit',
      time: '08:30',
      priority: 0,
      active: true,
      status: 'to_confirm',
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
  versionNumber: 1,
  now: new Date('2026-09-30T10:00:00.000Z'),
});

describe('compilation et empreinte du paquet', () => {
  it('compile un paquet valide avec une empreinte SHA-256', async () => {
    const compiled = await compilePackage(input());
    expect(compiled.package.schemaVersion).toBe(1);
    expect(compiled.package.packageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(compiled.package.minyanim).toHaveLength(2);
    expect(compiled.package.minyanim[0]).toMatchObject({
      date: '2026-10-02',
      office: 'Chaharit',
      time: '08:30',
    });
  });

  it('génère une empreinte canonique stable', async () => {
    const first = await compilePackage(input());
    const second = await compilePackage(input());
    expect(first.packageHash).toBe(second.packageHash);
    const changed = input();
    changed.versionNumber = 2;
    expect((await compilePackage(changed)).packageHash).not.toBe(first.packageHash);
  });
});
