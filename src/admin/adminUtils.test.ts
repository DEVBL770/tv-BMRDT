import { describe, expect, it } from 'vitest';
import type { AdminDraft } from '../lib/adminRepository';
import { summarizePublicationChanges } from './adminUtils';

describe('résumé des changements avant publication', () => {
  it('compte les règles, exceptions et contenus ajoutés, modifiés ou supprimés', () => {
    const baseline = {
      rules: [
        {
          id: 'rule-1',
          office: 'Min’ha',
          time: '19:00',
          weekdays: [],
          day_kinds: [],
          priority: 0,
          active: true,
          status: 'confirmed',
          cancelled: false,
        },
      ],
      exceptions: [],
      content: [],
      layout: {
        mode: 'fixed',
        zones: {},
        slides: [{ id: 'schedule', kind: 'schedule', durationSec: 30 }],
        options: {},
      },
    };
    const draft: AdminDraft = {
      rules: [
        {
          id: 'rule-1',
          office: 'Min’ha',
          time: '18:30',
          priority: 0,
          active: true,
          status: 'confirmed',
          cancelled: false,
        },
      ],
      exceptions: [
        {
          id: 'exception-1',
          date: '2026-10-04',
          office: 'Min’ha',
          time: '18:00',
          cancelled: false,
        },
      ],
      content: [
        {
          id: 'content-1',
          type: 'announcement',
          title: 'Information',
          mediaIds: [],
          shabbatVisibility: 'hide',
          isCommercial: false,
          priority: 1,
          durationSec: 20,
          status: 'draft',
        },
      ],
      layout: {
        mode: 'playlist',
        zones: {},
        slides: [{ id: 'schedule', kind: 'schedule', durationSec: 30 }],
      },
    };

    expect(summarizePublicationChanges(draft, baseline)).toEqual({
      rules: 1,
      exceptions: 1,
      content: 1,
      layoutChanged: true,
    });
  });
});
