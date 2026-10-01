import { describe, expect, it } from 'vitest';
import { currentSlideAt } from './playlist';
import { testPackage } from './test-package';
import type { ContentItem, Layout } from './package';

describe('playlist déterministe', () => {
  const layout: Layout = {
    mode: 'playlist',
    zones: {},
    slides: [
      { id: 'empty', kind: 'content', contentIds: ['missing'], durationSec: 10 },
      { id: 'schedule', kind: 'schedule', durationSec: 20 },
      { id: 'announcement', kind: 'content', contentIds: ['news'], durationSec: 10 },
    ],
  };
  const visible: ContentItem[] = [
    {
      id: 'news',
      type: 'announcement',
      title: 'Annonce',
      mediaIds: [],
      shabbatVisibility: 'show',
      isCommercial: false,
      priority: 0,
      durationSec: 10,
    },
  ];

  it('saute les slides sans contenu visible et suit un cycle stable', () => {
    expect(currentSlideAt(new Date(0), layout, visible).id).toBe('schedule');
    expect(currentSlideAt(new Date(20_000), layout, visible).id).toBe('announcement');
    expect(currentSlideAt(new Date(30_000), layout, visible).id).toBe('schedule');
  });

  it('retourne les horaires plutôt qu’une slide vide si aucun contenu n’est visible', () => {
    expect(currentSlideAt(new Date(0), layout, []).kind).toBe('schedule');
    expect(currentSlideAt(new Date(Number.NaN), testPackage().layout, []).kind).toBe('schedule');
  });
});
