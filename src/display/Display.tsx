import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import QRCode from 'qrcode';
import { hebrewDateAt, religiousStateAt, themeFor } from '../domain/religious';
import { currentSlideAt } from '../domain/playlist';
import { visibleContent } from '../domain/filtering';
import type { ContentItem, Day, PublishedPackage } from '../domain/package';
import { instantFromLocal, localDateOf } from '../domain/time';
import { loadDemoPackage } from '../demoPackage';
import { PlayerScheduler } from '../player/scheduler';
import type { PlayerWeather } from '../player/store';

type DisplayProps = {
  packageData?: PublishedPackage | undefined;
  mediaUrls?: Record<string, string> | undefined;
  weather?: PlayerWeather | null | undefined;
  instant?: Date;
  clockOffsetMs?: number;
  scheduler?: PlayerScheduler;
  allowDemoFallback?: boolean;
  waitingDeviceName?: string;
  previewInstant?: Date;
  previewMode?: boolean;
};

type CanvasStyle = CSSProperties & { '--canvas-scale': number };

function requestedDemoInstant(): Date | undefined {
  const query = new URLSearchParams(window.location.search);
  const isDemo =
    import.meta.env.VITE_DEMO_MODE === 'true' ||
    query.get('demo') === '1' ||
    query.get('preview') === '1';
  const value = query.get('at');
  if (!isDemo || !value) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (match) return instantFromLocal(match[1], match[2]);
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant : undefined;
}

function formatClock(instant: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

function formatCivilDate(instant: Date): string {
  const result = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(instant);
  return result.charAt(0).toLocaleUpperCase('fr-FR') + result.slice(1);
}

function formatTime(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function currentContentAt(items: ContentItem[], instant: Date): ContentItem | undefined {
  if (items.length === 0) return undefined;
  const duration = items.reduce((sum, item) => sum + item.durationSec * 1000, 0);
  let position = ((instant.getTime() % duration) + duration) % duration;
  for (const item of items) {
    const length = item.durationSec * 1000;
    if (position < length) return item;
    position -= length;
  }
  return items[0];
}

function useDisplayInstant(
  previewInstant: Date | undefined,
  previewMode: boolean,
  scheduler: PlayerScheduler,
  clockOffsetMs: number,
  externallyManaged: boolean,
): Date {
  const fixed = previewInstant ?? requestedDemoInstant();
  const fixedTime = fixed?.getTime();
  const [now, setNow] = useState(() => fixed ?? new Date(Date.now() + clockOffsetMs));
  useEffect(() => {
    if (fixedTime !== undefined || previewMode || externallyManaged) {
      if (fixedTime !== undefined) {
        setNow((current) => (current.getTime() === fixedTime ? current : new Date(fixedTime)));
      }
      return;
    }
    const update = () => setNow(new Date(Date.now() + clockOffsetMs));
    update();
    return scheduler.every(update, 1000);
  }, [clockOffsetMs, externallyManaged, fixedTime, previewMode, scheduler]);
  return fixed ?? now;
}

function useCanvasScale(canvas: RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      setScale(Math.min(width / 1920, height / 1080));
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [canvas]);
  return scale;
}

function WeatherMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className="weather-mark">
      <circle cx="19" cy="17" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M19 3v4M19 27v4M5 17h4m20 0h4M9 7l3 3m14 14 3 3m0-20-3 3M12 24l-3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M11 31h19a5 5 0 0 0 0-10h-1a9 9 0 0 0-17-1 5.5 5.5 0 0 0-1 11Z"
        fill="#fbf7ef"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function QRImage({ url }: { url: string }) {
  const [source, setSource] = useState('');
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(url, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'H',
      color: { dark: '#21180f', light: '#fffdf8' },
    }).then((value) => {
      if (active) setSource(value);
    });
    return () => {
      active = false;
    };
  }, [url]);
  return source ? (
    <img className="display-qr" src={source} alt="Code QR pour l’étude du jour" />
  ) : null;
}

function ContentCard({
  item,
  mediaUrls,
  mediaMimes,
}: {
  item: ContentItem;
  mediaUrls?: Record<string, string> | undefined;
  mediaMimes?: Record<string, string>;
}) {
  const imageIds = item.mediaIds.filter(
    (id) => mediaUrls?.[id] && mediaMimes?.[id]?.startsWith('image/'),
  );
  return (
    <article className={`content-card content-${item.type}`} data-content-id={item.id}>
      <span className="eyebrow">
        {item.type === 'urgent' ? 'À retenir' : contentLabel(item.type)}
      </span>
      <h3>{item.title}</h3>
      {item.body ? <p>{item.body}</p> : null}
      {imageIds.length ? (
        <div className="content-media-gallery" aria-label="Pages du document">
          {imageIds.map((id) => (
            <img className="content-media" key={id} src={mediaUrls![id]} alt={item.title} />
          ))}
        </div>
      ) : null}
      {item.titleHe ? (
        <div className="content-hebrew" lang="he" dir="rtl">
          <bdi dir="rtl">{item.titleHe}</bdi>
        </div>
      ) : null}
    </article>
  );
}

function contentLabel(type: ContentItem['type']): string {
  const labels: Record<ContentItem['type'], string> = {
    announcement: 'Communauté',
    event: 'Événement',
    mazal_tov: 'Mazal tov',
    azkara: 'Souvenir',
    dedication: 'Dédicace',
    kiddouch: 'Kiddouch',
    bar_mitsva: 'Bar-mitsva',
    photo: 'Photo',
    pdf: 'Document',
    qr: 'Étude',
    urgent: 'Important',
    sponsor: 'Partenaire',
  };
  return labels[type];
}

function DayBadge({
  day,
  period,
  festive,
}: {
  day: Day | undefined;
  period: PublishedPackage['religiousPeriods'][number] | undefined;
  festive: boolean;
}) {
  if (!day) return null;
  const erevIndex = day.holidays.findIndex((holiday) => /^Erev\b/i.test(holiday));
  const label =
    festive && period
      ? { fr: period.label, he: period.labelHe }
      : (day.yomtovLabels?.[0] ??
        day.cholHamoedLabel ??
        day.specialShabbat ??
        (erevIndex >= 0
          ? { fr: day.holidays[erevIndex], he: day.holidaysHe?.[erevIndex] }
          : undefined) ??
        (day.roshHodesh ? { fr: day.roshHodesh } : undefined) ??
        (day.parasha ? { fr: day.parasha.fr, he: day.parasha.he } : undefined));
  if (!label) return null;
  return (
    <div className="day-badge">
      <span>{label.fr}</span>
      {label.he ? (
        <span lang="he" dir="rtl">
          <bdi dir="rtl">{label.he}</bdi>
        </span>
      ) : null}
    </div>
  );
}

export function Display({
  packageData,
  mediaUrls,
  weather,
  instant,
  clockOffsetMs = 0,
  scheduler,
  allowDemoFallback = false,
  waitingDeviceName = 'TV salle principale',
  previewInstant,
  previewMode = false,
}: DisplayProps) {
  const ownsScheduler = !scheduler;
  const displayScheduler = useMemo(() => scheduler ?? new PlayerScheduler(), [scheduler]);
  useEffect(
    () => () => {
      if (ownsScheduler) displayScheduler.clearAll();
    },
    [displayScheduler, ownsScheduler],
  );
  const localNow = useDisplayInstant(
    previewInstant,
    previewMode,
    displayScheduler,
    clockOffsetMs,
    instant !== undefined,
  );
  const now = instant ?? localNow;
  const query = new URLSearchParams(window.location.search);
  const useDemoPackage =
    !packageData &&
    (allowDemoFallback ||
      previewMode ||
      import.meta.env.VITE_DEMO_MODE === 'true' ||
      query.get('demo') === '1' ||
      query.get('preview') === '1');
  const [loadedDemoPackage, setLoadedDemoPackage] = useState<PublishedPackage>();
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!useDemoPackage) return;
    let active = true;
    void loadDemoPackage()
      .then((loaded) => {
        if (active) setLoadedDemoPackage(loaded);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [useDemoPackage]);

  const data = packageData ?? loadedDemoPackage;
  if (!data) {
    return (
      <div className="display-shell display-loading" data-theme="weekday" data-state="unknown">
        <div className="display-waiting">
          <div className="brand-name">Beth Menahem</div>
          <div className="brand-hebrew" lang="he" dir="rtl">
            <bdi dir="rtl">בית מנחם</bdi>
          </div>
          <p>{waitingDeviceName}</p>
          <div className="display-waiting-clock">{formatClock(now)}</div>
          <div className="display-empty">
            {loadError ? 'Paquet indisponible' : 'En attente des informations publiées…'}
          </div>
        </div>
      </div>
    );
  }
  return (
    <DisplayCanvas
      packageData={data}
      mediaUrls={mediaUrls}
      weather={weather}
      instant={now}
      scheduler={displayScheduler}
      {...(previewInstant ? { previewInstant } : {})}
      previewMode={previewMode}
    />
  );
}

type DisplayCanvasProps = Omit<DisplayProps, 'packageData' | 'instant'> & {
  packageData: PublishedPackage;
  instant: Date;
};

function DisplayCanvas({
  packageData,
  mediaUrls,
  weather,
  instant,
  previewMode = false,
}: DisplayCanvasProps) {
  const shell = useRef<HTMLDivElement>(null);
  const scale = useCanvasScale(shell);
  const query = new URLSearchParams(window.location.search);
  const forcedPlaylist = query.get('mode') === 'playlist';
  const layout = useMemo(
    () =>
      forcedPlaylist ? { ...packageData.layout, mode: 'playlist' as const } : packageData.layout,
    [forcedPlaylist, packageData.layout],
  );
  const now = instant;
  const date = localDateOf(now);
  const day = packageData.days.find((item) => item.date === date);
  const religiousState = religiousStateAt(now, packageData);
  const isKnown = religiousState.kind !== 'unknown' && day !== undefined;
  const visibleItems = visibleContent(packageData.content, now, packageData);
  const activeContent = currentContentAt(
    visibleItems.filter((item) =>
      isKnown
        ? !item.isCommercial && item.type !== 'qr'
        : !item.isCommercial && (item.type === 'announcement' || item.type === 'urgent'),
    ),
    now,
  );
  const sponsor = isKnown ? visibleItems.find((item) => item.isCommercial) : undefined;
  const hebrewDate = hebrewDateAt(now, packageData, 'sunset');
  const activePeriod = religiousState.currentPeriod ?? religiousState.nextPeriod;
  const minyanim = packageData.minyanim.filter((item) => item.date === date);
  const mode = isKnown ? layout.mode : 'fixed';
  const slide = mode === 'playlist' ? currentSlideAt(now, layout, visibleItems) : undefined;
  const slideContent = slide?.contentIds
    ?.map((id) => visibleItems.find((item) => item.id === id))
    .find((item): item is ContentItem => Boolean(item));
  const mediaMimes = Object.fromEntries(packageData.media.map((media) => [media.id, media.mime]));
  const weatherIsFresh =
    weather?.temperatureC !== null &&
    weather?.temperatureC !== undefined &&
    weather.updatedAt !== null &&
    weather.updatedAt !== undefined &&
    now.getTime() - Date.parse(weather.updatedAt) <= 6 * 60 * 60_000;
  const showWeather = isKnown && (weather === undefined || weatherIsFresh);
  const attribution = packageData.site.attribution.filter(
    (item) => !/MET Norway/i.test(item) || (showWeather && weatherIsFresh),
  );

  return (
    <div
      ref={shell}
      className={`display-shell ${previewMode ? 'display-embedded' : ''}`}
      data-theme={themeFor(religiousState)}
      data-state={religiousState.kind}
      data-version={packageData.versionNumber}
    >
      <div className="display-canvas" style={{ '--canvas-scale': scale } as CanvasStyle}>
        <header className="display-header" data-zone="header">
          <div className="brand-lockup">
            {packageData.site.logoMediaId &&
            mediaUrls?.[packageData.site.logoMediaId] &&
            mediaMimes[packageData.site.logoMediaId]?.startsWith('image/') ? (
              <img
                className="brand-logo"
                src={mediaUrls[packageData.site.logoMediaId]}
                alt={packageData.site.name}
              />
            ) : (
              <div className="brand-name">{packageData.site.name}</div>
            )}
            <div className="brand-hebrew" lang="he" dir="rtl">
              <bdi dir="rtl">בית מנחם</bdi>
            </div>
          </div>
          <div className="header-date">
            <div className="clock" aria-label={`Il est ${formatClock(now)}`}>
              {formatClock(now)}
            </div>
            <div className="civil-date">{formatCivilDate(now)}</div>
            <div className="hebrew-date">
              {hebrewDate ? (
                <>
                  <bdi className="hebrew-date-he" lang="he" dir="rtl">
                    {hebrewDate.he}
                  </bdi>
                  <span className="hebrew-transliteration">{hebrewDate.fr}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="header-aside">
            <span className="b-h" lang="he" dir="rtl">
              <bdi dir="rtl">ב״ה</bdi>
            </span>
            <svg className="shabbat-candle" aria-hidden="true" viewBox="0 0 36 48">
              <path d="M18 2c5 7 4 10 0 14-4-4-5-7 0-14Z" fill="currentColor" />
              <path d="M13 18h10l3 26H10l3-26Z" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M12 27h12M11 36h14" stroke="currentColor" strokeWidth="2" />
            </svg>
            {showWeather ? (
              <div className="weather">
                <WeatherMark />
                <span>
                  <strong>
                    {weatherIsFresh && weather?.temperatureC !== null
                      ? `${Math.round(weather.temperatureC ?? 18)}°`
                      : '18°'}
                  </strong>
                  <small>Paris</small>
                </span>
              </div>
            ) : null}
            <DayBadge
              day={day}
              period={activePeriod}
              festive={religiousState.kind === 'yomtov' || religiousState.kind === 'shabbat'}
            />
          </div>
        </header>

        {mode === 'playlist' ? (
          <main className="playlist-area" data-zone="playlist">
            {slide?.kind === 'schedule' || slide?.kind === undefined ? (
              <ScheduleGrid
                day={day}
                minyanim={minyanim}
                period={activePeriod}
                pkg={packageData}
                known={isKnown}
              />
            ) : slide.kind === 'shabbat' ? (
              <div className="playlist-shabbat">
                <ShabbatFeature
                  period={activePeriod}
                  methodsPending={packageData.methods.status === 'pending'}
                />
              </div>
            ) : slide.kind === 'study' ? (
              <div className="playlist-study">
                <StudyFeature day={day} />
              </div>
            ) : (
              <div className="playlist-content">
                {slideContent ? (
                  <ContentCard item={slideContent} mediaUrls={mediaUrls} mediaMimes={mediaMimes} />
                ) : (
                  <ScheduleFallback />
                )}
                {slideContent?.qrUrl ? <QRImage url={slideContent.qrUrl} /> : null}
              </div>
            )}
          </main>
        ) : (
          <main className="display-grid">
            {isKnown ? (
              <>
                <section
                  className="display-zone office-zone"
                  data-zone="offices"
                  aria-label="Horaires des offices"
                >
                  <SectionHeading number="01" title="Offices" />
                  {['Chaharit', 'Min’ha', 'Arvit'].map((office) => {
                    const entry = minyanim.find((item) => item.office === office);
                    return (
                      <div
                        className={`office-row ${entry?.cancelled ? 'office-cancelled' : ''}`}
                        key={office}
                      >
                        <div className="office-label">{office}</div>
                        <div className="office-time">
                          {entry?.cancelled ? 'Annulé' : (entry?.time ?? '—')}
                        </div>
                      </div>
                    );
                  })}
                  {minyanim.some((item) => item.status === 'to_confirm') ? (
                    <p className="office-status">Horaires à confirmer</p>
                  ) : null}
                </section>
                <section
                  className="display-zone zmanim-zone"
                  data-zone="zmanim"
                  aria-label="Zmanim du jour"
                >
                  <SectionHeading number="02" title="Zmanim du jour" />
                  <div className="zmanim-list">
                    {(
                      [
                        ['Alot Hashahar', day?.zmanim.alot?.instant],
                        ['Téfilin (Misheyakir)', day?.zmanim.misheyakir?.instant],
                        ['Lever du soleil', day?.zmanim.sunrise?.instant],
                        ['Chkia', day?.zmanim.sunset?.instant],
                      ] as Array<[string, string | undefined]>
                    ).map(([label, instant]) => (
                      <div className="zman-row" key={label}>
                        <span>{label}</span>
                        <strong>{formatTime(instant)}</strong>
                      </div>
                    ))}
                  </div>
                  <ShabbatFeature
                    period={activePeriod}
                    methodsPending={packageData.methods.status === 'pending'}
                  />
                </section>
              </>
            ) : (
              <section className="display-zone unknown-zone" data-zone="unknown">
                <SectionHeading number="01" title="Horaires" />
                <p>Les annonces communautaires restent disponibles.</p>
              </section>
            )}
            <section
              className="display-zone community-zone"
              data-zone="community"
              aria-label="Vie communautaire"
            >
              <SectionHeading number="03" title="La vie de la communauté" />
              {activeContent ? (
                <ContentCard item={activeContent} mediaUrls={mediaUrls} mediaMimes={mediaMimes} />
              ) : (
                <ScheduleFallback />
              )}
              {isKnown ? (
                <>
                  {sponsor ? (
                    <article className="sponsor-note" data-content-id={sponsor.id}>
                      <span>Soutien</span>
                      <strong>{sponsor.title}</strong>
                    </article>
                  ) : null}
                  <StudyFeature day={day} />
                </>
              ) : null}
            </section>
          </main>
        )}

        {layout.banner?.enabled ? (
          <div className="display-banner" data-zone="banner">
            {layout.banner.text}
          </div>
        ) : null}
        <footer className="display-footer" data-zone="attribution" aria-label="Attribution">
          {attribution.join(' · ')}
        </footer>
      </div>
    </div>
  );
}

function SectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="section-heading">
      <span>{number}</span>
      <h2>{title}</h2>
    </div>
  );
}

function ScheduleGrid({
  day,
  minyanim,
  period,
  pkg,
  known,
}: {
  day: Day | undefined;
  minyanim: PublishedPackage['minyanim'];
  period: PublishedPackage['religiousPeriods'][number] | undefined;
  pkg: PublishedPackage;
  known: boolean;
}) {
  return known ? (
    <div className="playlist-schedule">
      <div>
        <SectionHeading number="01" title="Offices" />
        {['Chaharit', 'Min’ha', 'Arvit'].map((office) => {
          const entry = minyanim.find((item) => item.office === office);
          return (
            <div className="office-row" key={office}>
              <div className="office-label">{office}</div>
              <div className="office-time">
                {entry?.cancelled ? 'Annulé' : (entry?.time ?? '—')}
              </div>
            </div>
          );
        })}
        {minyanim.some((item) => item.status === 'to_confirm') ? (
          <p className="office-status">Horaires à confirmer</p>
        ) : null}
      </div>
      <div>
        <SectionHeading number="02" title="Zmanim du jour" />
        {[
          ['Alot Hashahar', day?.zmanim.alot?.instant],
          ['Téfilin · Misheyakir', day?.zmanim.misheyakir?.instant],
          ['Lever du soleil', day?.zmanim.sunrise?.instant],
          ['Chkia', day?.zmanim.sunset?.instant],
          ['Tsét hakokhavim', day?.zmanim.tzeit?.instant],
        ].map(([label, instant]) => (
          <div className="zman-row" key={label as string}>
            <span>{label}</span>
            <strong>{formatTime(instant as string | undefined)}</strong>
          </div>
        ))}
        <ShabbatFeature period={period} methodsPending={pkg.methods.status === 'pending'} />
      </div>
    </div>
  ) : (
    <ScheduleFallback />
  );
}

function ShabbatFeature({
  period,
  methodsPending,
}: {
  period: PublishedPackage['religiousPeriods'][number] | undefined;
  methodsPending: boolean;
}) {
  return (
    <div className="shabbat-feature">
      <div className="mini-rule" />
      <div className="feature-title">
        {period?.kind === 'yomtov' ? 'Chabbat / Fête' : 'Chabbat'}
      </div>
      <div className="period-name">{period?.label ?? 'Prochaine entrée'}</div>
      {period?.labelHe ? (
        <div className="period-name-he" lang="he" dir="rtl">
          <bdi dir="rtl">{period.labelHe}</bdi>
        </div>
      ) : null}
      <div className="period-times">
        <span>
          Entrée <strong>{formatTime(period?.start)}</strong>
        </span>
        <span>
          Sortie <strong>{formatTime(period?.end)}</strong>
        </span>
      </div>
      {methodsPending ? <small>Méthode en attente de validation</small> : null}
    </div>
  );
}

function StudyFeature({ day }: { day: Day | undefined }) {
  return (
    <div className="study-feature">
      <div className="study-title">Étude quotidienne</div>
      <div className="study-references">
        <div className="study-reference">
          <span>Daf Yomi</span>
          <strong>{day?.study.dafYomi?.fr ?? 'Référence à venir'}</strong>
          {day?.study.dafYomi?.he ? (
            <span lang="he" dir="rtl">
              <bdi dir="rtl">{day.study.dafYomi.he}</bdi>
            </span>
          ) : null}
        </div>
        {day?.study.rambam ? (
          <div className="study-reference">
            <span>Rambam</span>
            {day.study.rambam.fr ? <strong>{day.study.rambam.fr}</strong> : null}
            {day.study.rambam.he ? (
              <span lang="he" dir="rtl">
                <bdi dir="rtl">{day.study.rambam.he}</bdi>
              </span>
            ) : null}
          </div>
        ) : null}
        {day?.study.hayomYom ? (
          <div className="study-reference">
            <span>Hayom Yom</span>
            <strong>{day.study.hayomYom.reference}</strong>
          </div>
        ) : null}
        {day?.study.tanya ? (
          <div className="study-reference">
            <span>Tanya</span>
            <strong>{day.study.tanya.reference}</strong>
          </div>
        ) : null}
      </div>
      <div className="study-qr-panel">
        <QRImage url="https://www.chabad.org/dailystudy/" />
        <span>Étude du jour</span>
      </div>
    </div>
  );
}

function ScheduleFallback() {
  return (
    <article className="content-card fallback-card">
      <span className="eyebrow">Beth Menahem</span>
      <h3>Bienvenue</h3>
      <p>Horaires et informations de la communauté.</p>
    </article>
  );
}
