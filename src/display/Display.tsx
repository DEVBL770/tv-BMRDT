import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import QRCode from 'qrcode';
import demoPackageData from '../fixtures/demo-package.json';
import { hebrewDateAt, religiousStateAt, themeFor } from '../domain/religious';
import { currentSlideAt } from '../domain/playlist';
import { visibleContent } from '../domain/filtering';
import type { ContentItem, Day, PublishedPackage } from '../domain/package';
import { instantFromLocal, localDateOf } from '../domain/time';

const demoPackage = demoPackageData as PublishedPackage;

type DisplayProps = {
  packageData?: PublishedPackage;
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

function useDisplayInstant(previewInstant?: Date, previewMode = false): Date {
  const fixed = previewInstant ?? requestedDemoInstant();
  const fixedTime = fixed?.getTime();
  const [now, setNow] = useState(() => fixed ?? new Date());
  useEffect(() => {
    if (fixedTime !== undefined || previewMode) {
      if (fixedTime !== undefined) {
        setNow((current) => (current.getTime() === fixedTime ? current : new Date(fixedTime)));
      }
      return;
    }
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [fixedTime, previewMode]);
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
    <img className="display-qr" src={source} alt="Code QR pour l’étude quotidienne" />
  ) : null;
}

function ContentCard({ item }: { item: ContentItem }) {
  return (
    <article className={`content-card content-${item.type}`} data-content-id={item.id}>
      <span className="eyebrow">
        {item.type === 'urgent' ? 'À retenir' : contentLabel(item.type)}
      </span>
      <h3>{item.title}</h3>
      {item.body ? <p>{item.body}</p> : null}
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

function DayBadge({ day }: { day: Day | undefined }) {
  if (!day) return <div className="day-badge">Paris · 19e</div>;
  const label = day.parasha?.fr ?? day.holidays[0] ?? day.roshHodesh;
  if (!label) return <div className="day-badge">Paris · 19e</div>;
  const labelHe = day.parasha?.he ?? (label === day.holidays[0] ? day.holidaysHe?.[0] : undefined);
  return (
    <div className="day-badge">
      <span>{label}</span>
      {labelHe ? (
        <span lang="he" dir="rtl">
          <bdi dir="rtl">{labelHe}</bdi>
        </span>
      ) : null}
    </div>
  );
}

export function Display({
  packageData = demoPackage,
  previewInstant,
  previewMode = false,
}: DisplayProps) {
  const shell = useRef<HTMLDivElement>(null);
  const scale = useCanvasScale(shell);
  const query = new URLSearchParams(window.location.search);
  const forcedPlaylist = query.get('mode') === 'playlist';
  const layout = useMemo(
    () =>
      forcedPlaylist ? { ...packageData.layout, mode: 'playlist' as const } : packageData.layout,
    [forcedPlaylist, packageData.layout],
  );
  const now = useDisplayInstant(previewInstant, previewMode);
  const date = localDateOf(now);
  const day = packageData.days.find((item) => item.date === date);
  const religiousState = religiousStateAt(now, packageData);
  const isKnown = religiousState.kind !== 'unknown' && day !== undefined;
  const visibleItems = visibleContent(packageData.content, now, packageData);
  const activeContent = currentContentAt(
    visibleItems.filter((item) =>
      isKnown
        ? !item.isCommercial
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

  return (
    <div
      ref={shell}
      className={`display-shell ${previewMode ? 'display-embedded' : ''}`}
      data-theme={themeFor(religiousState)}
      data-state={religiousState.kind}
    >
      <div className="display-canvas" style={{ '--canvas-scale': scale } as CanvasStyle}>
        <header className="display-header" data-zone="header">
          <div className="brand-lockup">
            <div className="brand-name">Beth Menahem</div>
            <div className="brand-hebrew" lang="he" dir="rtl">
              <bdi dir="rtl">בית מנחם</bdi>
            </div>
            <div className="brand-address">
              Paris · 19<sup>e</sup>
            </div>
          </div>
          <div className="header-date">
            <div className="clock" aria-label={`Il est ${formatClock(now)}`}>
              {formatClock(now)}
            </div>
            <div className="civil-date">{formatCivilDate(now)}</div>
            <div className="hebrew-date" lang="he" dir="rtl">
              {hebrewDate ? (
                <>
                  <bdi dir="rtl">{hebrewDate.he}</bdi>
                  <span className="hebrew-transliteration">{hebrewDate.fr}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="header-aside">
            <span className="b-h" lang="he" dir="rtl">
              <bdi dir="rtl">ב״ה</bdi>
            </span>
            {isKnown ? (
              <div className="weather">
                <WeatherMark />
                <span>
                  <strong>18°</strong>
                  <small>Paris</small>
                </span>
              </div>
            ) : null}
            <DayBadge day={day} />
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
                now={now}
              />
            ) : slide.kind === 'shabbat' ? (
              <ShabbatFeature
                period={activePeriod}
                methodsPending={packageData.methods.status === 'pending'}
              />
            ) : slide.kind === 'study' ? (
              <StudyFeature day={day} />
            ) : (
              <div className="playlist-content">
                {slideContent ? <ContentCard item={slideContent} /> : <ScheduleFallback />}
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
                        {entry?.status === 'to_confirm' ? (
                          <div className="office-status">Horaires à confirmer</div>
                        ) : null}
                      </div>
                    );
                  })}
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
                        ['Téfilin · Misheyakir', day?.zmanim.misheyakir?.instant],
                        ['Lever du soleil', day?.zmanim.sunrise?.instant],
                        ['Chkia', day?.zmanim.sunset?.instant],
                        ['Tsét hakokhavim', day?.zmanim.tzeit?.instant],
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
              {activeContent ? <ContentCard item={activeContent} /> : <ScheduleFallback />}
              {isKnown ? (
                <>
                  {sponsor ? (
                    <article className="sponsor-note" data-content-id={sponsor.id}>
                      <span>Avec le soutien de</span>
                      <strong>{sponsor.title}</strong>
                    </article>
                  ) : null}
                  <StudyFeature day={day} />
                  <div className="qr-panel">
                    <QRImage url="https://www.chabad.org/dailystudy/" />
                    <span>
                      Étude quotidienne
                      <br />
                      <small>Scannez pour en savoir plus</small>
                    </span>
                  </div>
                </>
              ) : null}
            </section>
          </main>
        )}

        {layout.banner?.enabled ? (
          <footer className="display-footer" data-zone="attribution">
            {layout.banner.text}
          </footer>
        ) : null}
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
  now,
}: {
  day: Day | undefined;
  minyanim: PublishedPackage['minyanim'];
  period: PublishedPackage['religiousPeriods'][number] | undefined;
  pkg: PublishedPackage;
  known: boolean;
  now: Date;
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
        <p className="method-note">
          {pkg.methods.status === 'pending' ? 'Méthode en attente de validation' : period?.label}
        </p>
        <small>{formatCivilDate(now)}</small>
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
      <div className="eyebrow">Étude du jour</div>
      <strong>{day?.study.dafYomi ?? 'Daf Yomi'}</strong>
      {day?.study.rambam ? <span>{day.study.rambam}</span> : null}
      {day?.study.hayomYom ? <span>Hayom Yom · {day.study.hayomYom.reference}</span> : null}
      {day?.study.tanya ? <span>Tanya · {day.study.tanya.reference}</span> : null}
      <span aria-label="Référence et lien d’étude">Référence · Chabad.org</span>
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

export { demoPackage };
