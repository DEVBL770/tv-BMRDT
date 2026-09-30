export type Provenance = {
  provider: string;
  method: string;
  params: Record<string, string | number | boolean>;
  fetchedAt: string;
  validUntil: string;
};

export type ProviderResult<T> = { data: T; provenance: Provenance };

export type CalendarEvent = {
  date: string;
  instant?: string;
  title: string;
  titleHe?: string;
  titleOriginal?: string;
  category?: string;
  hebrewDate?: string;
  hebrewDateParts?: { day?: string; month?: string; year?: string };
  yomtov?: boolean;
  erev?: boolean;
  subcategory?: string;
  memo?: string;
  link?: string;
  raw?: Record<string, unknown>;
};

export type ZmanimDay = {
  date: string;
  times: Partial<
    Record<'alotHaShachar' | 'misheyakir' | 'sunrise' | 'chatzot' | 'sunset' | 'tzeit85deg', string>
  >;
};

export type StudyDay = {
  date: string;
  dafYomi?: { title: string; titleHe?: string; link?: string };
  rambam?: { title: string; titleHe?: string; link?: string };
};

export type WeatherSnapshot = {
  temperatureC: number;
  symbol: string;
  fetchedAt: string;
};

export type CalendarProvider = {
  getCalendar(start: string, end: string): Promise<ProviderResult<CalendarEvent[]>>;
};

export type ZmanimProvider = {
  getZmanim(start: string, end: string): Promise<ProviderResult<ZmanimDay[]>>;
};

export type StudyProvider = {
  getStudy(start: string, end: string): Promise<ProviderResult<StudyDay[]>>;
};

export type WeatherProvider = {
  getWeather(): Promise<ProviderResult<WeatherSnapshot>>;
};
