import { describe, expect, it } from 'vitest';
import { ContentItemSchema, PublishedPackageSchema } from './package';
import { testPackage } from './test-package';

describe('schéma PublishedPackage', () => {
  it('accepte le paquet schemaVersion 1 conforme à l’architecture', () => {
    expect(PublishedPackageSchema.parse(testPackage()).schemaVersion).toBe(1);
  });

  it('refuse un sponsor non commercial et une date inversée', () => {
    expect(() =>
      ContentItemSchema.parse({
        id: 'sponsor',
        type: 'sponsor',
        title: 'Sponsor',
        mediaIds: [],
        shabbatVisibility: 'hide',
        isCommercial: false,
        priority: 0,
        durationSec: 10,
      }),
    ).toThrow();
    expect(() =>
      ContentItemSchema.parse({
        id: 'news',
        type: 'announcement',
        title: 'Annonce',
        mediaIds: [],
        startsAt: '2026-10-03T00:00:00Z',
        endsAt: '2026-10-02T00:00:00Z',
        shabbatVisibility: 'show',
        isCommercial: false,
        priority: 0,
        durationSec: 10,
      }),
    ).toThrow();
  });
});
