import type { CalendarProvider, ProviderResult, CalendarEvent } from './types.ts';

const DISABLED_MESSAGE = 'désactivé sans autorisation écrite';

export class ChabadProvider implements CalendarProvider {
  readonly enabled = false;

  async getCalendar(_start: string, _end: string): Promise<ProviderResult<CalendarEvent[]>> {
    void _start;
    void _end;
    throw new Error(`ChabadProvider : ${DISABLED_MESSAGE}.`);
  }
}

export class CalJProvider implements CalendarProvider {
  readonly enabled = false;

  async getCalendar(_start: string, _end: string): Promise<ProviderResult<CalendarEvent[]>> {
    void _start;
    void _end;
    throw new Error(`CalJProvider : ${DISABLED_MESSAGE}.`);
  }
}
