export type ReligiousDayKind =
  | 'weekday'
  | 'erev_shabbat'
  | 'shabbat'
  | 'erev_yomtov'
  | 'yomtov'
  | 'chol_hamoed'
  | 'unknown';

export type ReligiousPeriod = {
  kind: 'shabbat' | 'yomtov';
  start: string;
  end: string;
  label: string;
  labelHe: string;
};

export type DayZman = {
  instant?: string;
  sourceId?: string;
  overridden?: boolean;
};

export type JewishDay = {
  date: string;
  weekday: number;
  hebrew: { fr: string; he: string; day: number; month: string; year: number };
  parasha?: { fr: string; he?: string };
  holidays: string[];
  holidaysHe?: string[];
  holidayKinds?: Array<'erev_yomtov' | 'yomtov' | 'chol_hamoed'>;
  yomtovLabels?: Array<{ fr: string; he?: string }>;
  cholHamoedLabel?: { fr: string; he?: string };
  specialShabbat?: { fr: string; he?: string };
  roshHodesh?: string;
  omer?: number;
  study: {
    dafYomi?: { fr: string; he?: string };
    rambam?: { fr?: string; he?: string };
    hayomYom?: { reference: string; url?: string };
    tanya?: { reference: string; url?: string };
  };
  zmanim: {
    alot?: DayZman;
    misheyakir?: DayZman;
    sunrise?: DayZman;
    chatzot?: DayZman;
    sunset?: DayZman;
    tzeit?: DayZman;
    candleLighting?: DayZman;
    havdalah?: DayZman;
  };
};

export type ContentItem = {
  id: string;
  type:
    | 'announcement'
    | 'event'
    | 'mazal_tov'
    | 'azkara'
    | 'dedication'
    | 'kiddouch'
    | 'bar_mitsva'
    | 'photo'
    | 'pdf'
    | 'qr'
    | 'urgent'
    | 'sponsor';
  title: string;
  body?: string;
  titleHe?: string;
  mediaIds: string[];
  qrUrl?: string;
  startsAt?: string;
  endsAt?: string;
  weekdays?: number[];
  timeWindows?: Array<{ from: string; to: string }>;
  shabbatVisibility: 'show' | 'hide';
  isCommercial: boolean;
  priority: number;
  durationSec: number;
};

export type DisplayLayout = {
  mode: 'fixed' | 'playlist';
  zones: Record<string, unknown>;
  slides: Array<{
    id: string;
    kind: 'schedule' | 'shabbat' | 'content' | 'study' | 'media' | 'qr';
    contentIds?: string[];
    durationSec: number;
  }>;
  banner?: { text: string; enabled: boolean };
};

export type MinyanEntry = {
  date: string;
  office: string;
  time: string | null;
  cancelled: boolean;
  status: 'to_confirm' | 'confirmed';
  source: 'exception' | 'period' | 'weekly' | 'base';
  ruleId?: string;
};
