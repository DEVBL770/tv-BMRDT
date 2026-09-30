import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  compileMinyanPlanning,
  resolveMinyan,
  type MinyanException,
  type MinyanRule,
} from '../domain/minyan';
import type { ContentItem, Layout, PublishedPackage } from '../domain/package';
import { addLocalDays, instantFromLocal, localDateOf } from '../domain/time';
import { religiousStateAt } from '../domain/religious';
import { Display } from '../display/Display';
import { loadDemoPackage } from '../demoPackage';
import { createAdminRepository } from '../lib/adminRepository';
import { supabase } from '../lib/supabase';

type AdminView = 'Tableau de bord' | 'Horaires' | 'Annonces' | 'Médias' | 'Écran' | 'Plus';
type Draft = {
  rules: MinyanRule[];
  exceptions: MinyanException[];
  content: ContentItem[];
  layout: Layout;
};

const emptyDraft: Draft = {
  rules: [
    {
      id: 'chaharit-base',
      office: 'Chaharit',
      time: '08:30',
      priority: 0,
      active: true,
      status: 'to_confirm',
    },
    {
      id: 'minha-base',
      office: 'Min’ha',
      time: '19:00',
      priority: 0,
      active: true,
      status: 'to_confirm',
    },
    {
      id: 'arvit-base',
      office: 'Arvit',
      time: '20:00',
      priority: 0,
      active: true,
      status: 'to_confirm',
    },
  ],
  exceptions: [
    { id: 'demo-sunday', date: '2026-10-04', office: 'Chaharit', time: '09:00', cancelled: false },
  ],
  content: [],
  layout: {
    mode: 'fixed',
    zones: {},
    slides: [{ id: 'schedule', kind: 'schedule', durationSec: 30 }],
  },
};

const navItems: AdminView[] = [
  'Tableau de bord',
  'Horaires',
  'Annonces',
  'Médias',
  'Écran',
  'Plus',
];
const contentTypes: Array<{ value: ContentItem['type']; label: string }> = [
  { value: 'announcement', label: 'Annonce' },
  { value: 'event', label: 'Événement' },
  { value: 'mazal_tov', label: 'Mazal tov' },
  { value: 'azkara', label: 'Azkara' },
  { value: 'dedication', label: 'Dédicace' },
  { value: 'kiddouch', label: 'Kiddouch' },
  { value: 'bar_mitsva', label: 'Bar-mitsva' },
  { value: 'photo', label: 'Photo' },
  { value: 'pdf', label: 'PDF' },
  { value: 'qr', label: 'QR code' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'sponsor', label: 'Sponsor' },
];

function previewDate(value: string, time: string): Date {
  const [date] = value.split('T');
  return instantFromLocal(date || localDateOf(new Date()), time || '00:00');
}

export function Admin({ demoMode = false }: { demoMode?: boolean }) {
  const repository = useMemo(() => createAdminRepository(demoMode), [demoMode]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [demoPackage, setDemoPackage] = useState<PublishedPackage>();
  const [draftReady, setDraftReady] = useState(false);
  const [authReady, setAuthReady] = useState(repository.mode === 'demo');
  const [authenticated, setAuthenticated] = useState(repository.mode === 'demo');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [view, setView] = useState<AdminView>('Tableau de bord');
  const [screenView, setScreenView] = useState<'editor' | 'preview'>('editor');
  const [saved, setSaved] = useState(false);
  const [exceptionDate, setExceptionDate] = useState('2026-10-04');
  const [exceptionOffice, setExceptionOffice] = useState('Chaharit');
  const [exceptionTime, setExceptionTime] = useState('09:00');
  const [selectedType, setSelectedType] = useState<ContentItem['type']>('announcement');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [startsOn, setStartsOn] = useState('2026-10-01');
  const [endsOn, setEndsOn] = useState('2026-10-31');
  const [contentError, setContentError] = useState('');
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [shabbatVisibility, setShabbatVisibility] = useState<'show' | 'hide'>('hide');
  const [previewDay, setPreviewDay] = useState('2026-10-02');
  const [previewTime, setPreviewTime] = useState('15:00');
  const [draftMessage, setDraftMessage] = useState('');

  useEffect(() => {
    let active = true;
    async function initialize() {
      if (repository.mode === 'demo') {
        const packageData = await loadDemoPackage();
        const initial = await repository.loadDraft({
          ...emptyDraft,
          content: packageData.content,
          layout: packageData.layout,
        });
        if (!active) return;
        setDemoPackage(packageData);
        setDraft(initial);
        setDraftReady(true);
        setAuthReady(true);
        return;
      }
      const client = supabase;
      if (!client) {
        setAuthReady(true);
        return;
      }
      const { data, error } = await client.auth.getSession();
      if (!active) return;
      if (error || !data.session) {
        setAuthReady(true);
        return;
      }
      const { data: admin, error: adminError } = await client.rpc('is_admin');
      if (!active) return;
      if (adminError || admin !== true) {
        await client.auth.signOut();
        setAuthError('Ce compte ne dispose pas des droits administrateur.');
        setAuthReady(true);
        return;
      }
      const initial = await repository.loadDraft(emptyDraft);
      if (!active) return;
      setDraft(initial);
      setDraftReady(true);
      setAuthenticated(true);
      setAuthReady(true);
    }
    void initialize().catch(() => {
      if (!active) return;
      setAuthError('Connexion au serveur impossible.');
      setAuthReady(true);
    });
    return () => {
      active = false;
    };
  }, [repository]);

  useEffect(() => {
    if (draftReady && repository.mode === 'demo') {
      void repository.saveDraft(draft);
    }
  }, [draft, draftReady, repository]);

  const previewPackage = useMemo<PublishedPackage | undefined>(() => {
    if (!demoPackage) return undefined;
    const planning = compileMinyanPlanning(
      demoPackage.days.map(({ date }) => ({
        date,
        dayKind: religiousStateAt(instantFromLocal(date, '12:00'), demoPackage).kind,
      })),
      draft.rules,
      draft.exceptions,
    );
    return {
      ...demoPackage,
      content: draft.content,
      layout: draft.layout,
      minyanim: planning.map(({ date, office, time, cancelled, status }) => ({
        date,
        office,
        time,
        cancelled,
        status,
      })),
    };
  }, [demoPackage, draft]);

  function addException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const item: MinyanException = {
      id: crypto.randomUUID(),
      date: exceptionDate,
      office: exceptionOffice,
      time: exceptionTime || null,
      cancelled: exceptionTime.length === 0,
    };
    setDraft((current) => ({
      ...current,
      exceptions: [
        ...current.exceptions.filter(
          ({ date, office }) => date !== item.date || office !== item.office,
        ),
        item,
      ],
    }));
  }

  function addContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    const commercial = selectedType === 'sponsor';
    if (startsOn && endsOn && startsOn > endsOn) {
      setContentError('La date de fin doit être égale ou postérieure à la date de début.');
      return;
    }
    const item: ContentItem = {
      id: crypto.randomUUID(),
      type: selectedType,
      title: title.trim(),
      ...(body.trim() ? { body: body.trim() } : {}),
      mediaIds: [],
      ...(startsOn ? { startsAt: instantFromLocal(startsOn, '00:00').toISOString() } : {}),
      ...(endsOn ? { endsAt: instantFromLocal(endsOn, '23:59').toISOString() } : {}),
      ...(selectedWeekdays.length > 0 && selectedWeekdays.length < 7
        ? { weekdays: selectedWeekdays }
        : {}),
      shabbatVisibility: commercial ? 'hide' : shabbatVisibility,
      isCommercial: commercial,
      priority: commercial ? 10 : 20,
      durationSec: 20,
    };
    setDraft((current) => ({ ...current, content: [item, ...current.content] }));
    setTitle('');
    setBody('');
    setContentError('');
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setAuthError('');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword,
    });
    if (error || !data.session) {
      setAuthError('Adresse e-mail ou mot de passe incorrect.');
      return;
    }
    const { data: admin, error: adminError } = await supabase.rpc('is_admin');
    if (adminError || admin !== true) {
      await supabase.auth.signOut();
      setAuthError('Ce compte ne dispose pas des droits administrateur.');
      return;
    }
    try {
      setDraft(await repository.loadDraft(emptyDraft));
      setDraftReady(true);
      setAuthenticated(true);
    } catch {
      setAuthError('Connexion au serveur impossible.');
      await supabase.auth.signOut();
    }
  }

  async function saveDraft() {
    try {
      await repository.saveDraft(draft);
      setSaved(true);
      setDraftMessage(
        repository.mode === 'demo'
          ? 'Brouillon enregistré sur cet appareil.'
          : 'Brouillon enregistré dans Supabase.',
      );
      window.setTimeout(() => setSaved(false), 2500);
    } catch {
      setDraftMessage('Enregistrement impossible. Vérifiez la connexion et les droits admin.');
    }
  }

  function moveSlide(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= draft.layout.slides.length) return;
    const slides = [...draft.layout.slides];
    [slides[index], slides[target]] = [slides[target], slides[index]];
    setDraft((current) => ({ ...current, layout: { ...current.layout, slides } }));
  }

  const currentDate = localDateOf(new Date());
  const planning = Array.from({ length: 14 }, (_, index) => addLocalDays(currentDate, index));

  if (!authReady) {
    return <main className="login-screen">Chargement…</main>;
  }
  if (repository.mode === 'supabase' && !authenticated) {
    return (
      <main className="login-screen">
        <form className="login-card" onSubmit={signIn}>
          <span className="admin-brand-monogram">ב״ה</span>
          <h1>Administration</h1>
          <label>
            Adresse e-mail
            <input
              type="email"
              autoComplete="username"
              required
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
            />
          </label>
          <label>
            Mot de passe
            <input
              type="password"
              autoComplete="current-password"
              required
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
            />
          </label>
          {authError ? (
            <p className="form-error" role="alert">
              {authError}
            </p>
          ) : null}
          <button className="primary-button" type="submit">
            Se connecter
          </button>
          <p className="form-note">
            Récupération du mot de passe : procédure console (ADMIN_GUIDE).
          </p>
        </form>
      </main>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-monogram">ב״ה</span>
          <strong>Beth Menahem</strong>
          <small>Administration</small>
        </div>
        <AdminNav active={view} onSelect={setView} />
        <div className="sidebar-status">
          <span className="status-dot" />
          {repository.mode === 'demo' ? 'Mode démonstration' : 'Mode Supabase'}
        </div>
      </aside>
      <div className="admin-content">
        <header className="admin-topbar">
          <div>
            <span className="admin-overline">Beth Menahem · Paris 19e</span>
            <h1>{view === 'Plus' ? 'Paramètres et historique' : view}</h1>
          </div>
          <div className="draft-indicator">
            <span /> {repository.mode === 'demo' ? 'Brouillon local' : 'Brouillon serveur'}
          </div>
        </header>

        {view === 'Tableau de bord' ? (
          <Dashboard draft={draft} onNavigate={setView} />
        ) : view === 'Horaires' ? (
          <section className="admin-page">
            <div className="page-intro">
              <p>Règles de base et exceptions ponctuelles.</p>
              <span>Les horaires de démonstration restent à confirmer.</span>
            </div>
            <div className="admin-card schedule-card">
              <h2>Horaires habituels</h2>
              {draft.rules.map((rule) => (
                <div className="rule-line" key={rule.id}>
                  <span>{rule.office}</span>
                  <strong>{rule.time ?? 'Annulé'}</strong>
                  <small>{rule.status === 'to_confirm' ? 'À confirmer' : 'Confirmé'}</small>
                </div>
              ))}
            </div>
            <div className="admin-card">
              <h2>Ajouter une exception — ce jour seulement</h2>
              <form className="admin-form" onSubmit={addException}>
                <label>
                  Date
                  <input
                    type="date"
                    required
                    value={exceptionDate}
                    onChange={(event) => setExceptionDate(event.target.value)}
                  />
                </label>
                <label>
                  Office
                  <select
                    value={exceptionOffice}
                    onChange={(event) => setExceptionOffice(event.target.value)}
                  >
                    <option>Chaharit</option>
                    <option>Min’ha</option>
                    <option>Arvit</option>
                  </select>
                </label>
                <label>
                  Heure
                  <input
                    type="time"
                    value={exceptionTime}
                    onChange={(event) => setExceptionTime(event.target.value)}
                  />
                  <small>Laisser vide pour annuler l’office.</small>
                </label>
                <button className="primary-button" type="submit">
                  Ajouter l’exception
                </button>
              </form>
              <p className="form-note">Une exception ne modifie ni les autres jours ni la shkia.</p>
              <div className="exception-list">
                {draft.exceptions.map((item) => (
                  <div className="exception-line" key={item.id ?? `${item.date}-${item.office}`}>
                    <strong>{item.date}</strong>
                    <span>
                      {item.office} · {item.cancelled ? 'Annulé' : item.time}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="admin-card">
              <h2>Résultat résolu · 14 jours</h2>
              <div className="resolved-list">
                {planning.map((date) => {
                  const entry = resolveMinyan(date, 'Chaharit', draft.rules, draft.exceptions);
                  return (
                    <div key={date}>
                      <span>
                        {new Intl.DateTimeFormat('fr-FR', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          timeZone: 'UTC',
                        }).format(new Date(`${date}T12:00:00Z`))}
                      </span>
                      <strong>{entry.cancelled ? 'Annulé' : (entry.time ?? '—')}</strong>
                      <small>
                        {entry.source === 'exception'
                          ? 'Exception'
                          : entry.status === 'to_confirm'
                            ? 'À confirmer'
                            : 'Règle'}
                      </small>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : view === 'Annonces' ? (
          <section className="admin-page">
            <div className="page-intro">
              <p>Messages communautaires, programmés sur l’écran.</p>
              <span>Avant publication, vérifiez les autorisations.</span>
            </div>
            <div className="admin-card">
              <h2>Nouvelle annonce</h2>
              <form className="admin-form announcement-form" onSubmit={addContent}>
                <label>
                  Type
                  <select
                    value={selectedType}
                    onChange={(event) => setSelectedType(event.target.value as ContentItem['type'])}
                  >
                    {contentTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Titre
                  <input
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Titre visible à l’écran"
                  />
                </label>
                <label>
                  Message
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={3}
                    placeholder="Détail de l’annonce"
                  />
                </label>
                <div className="form-row">
                  <label>
                    Du
                    <input
                      type="date"
                      required
                      value={startsOn}
                      onChange={(event) => setStartsOn(event.target.value)}
                    />
                  </label>
                  <label>
                    Au
                    <input
                      type="date"
                      required
                      value={endsOn}
                      onChange={(event) => setEndsOn(event.target.value)}
                    />
                  </label>
                </div>
                <fieldset className="weekday-fieldset">
                  <legend>Jours d’affichage</legend>
                  <div className="weekday-choices">
                    {['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map((label, weekday) => (
                      <label key={weekday}>
                        <input
                          type="checkbox"
                          checked={selectedWeekdays.includes(weekday)}
                          onChange={(event) =>
                            setSelectedWeekdays((current) =>
                              event.target.checked
                                ? [...current, weekday].sort((a, b) => a - b)
                                : current.filter((item) => item !== weekday),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <small>Si aucun jour n’est coché, le contenu s’affiche tous les jours.</small>
                </fieldset>
                <label>
                  Visibilité Chabbat / Yom Tov
                  <select
                    value={selectedType === 'sponsor' ? 'hide' : shabbatVisibility}
                    disabled={selectedType === 'sponsor'}
                    onChange={(event) =>
                      setShabbatVisibility(event.target.value as 'show' | 'hide')
                    }
                  >
                    <option value="show">Visible</option>
                    <option value="hide">Masquée</option>
                  </select>
                </label>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={selectedType === 'sponsor'}
                    disabled={selectedType === 'sponsor'}
                    readOnly
                  />{' '}
                  Contenu commercial
                </label>
                {selectedType === 'sponsor' ? (
                  <p className="form-note sponsor-explanation">
                    Un sponsor est commercial par défaut et masqué pendant Chabbat / Yom Tov et les
                    marges définies.
                  </p>
                ) : null}
                <p className="form-note">
                  Pour un nom ou une photo : confirmez l’accord des personnes nommées.
                </p>
                {contentError ? (
                  <p className="form-error" role="alert">
                    {contentError}
                  </p>
                ) : null}
                <button className="primary-button" type="submit">
                  Ajouter à la liste
                </button>
              </form>
            </div>
            <div className="admin-card">
              <h2>Annonces et contenus</h2>
              <div className="content-list">
                {draft.content.map((item) => (
                  <article key={item.id} className="content-list-item">
                    <div>
                      <span className="content-type-tag">
                        {contentTypes.find(({ value }) => value === item.type)?.label}
                      </span>
                      <h3>{item.title}</h3>
                      {item.body ? <p>{item.body}</p> : null}
                    </div>
                    <span className={item.isCommercial ? 'commercial-badge' : 'visibility-badge'}>
                      {item.isCommercial
                        ? 'Commercial · masqué Chabbat'
                        : item.shabbatVisibility === 'show'
                          ? 'Visible Chabbat'
                          : 'Masqué Chabbat'}
                    </span>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : view === 'Écran' ? (
          <section className="admin-page screen-page">
            <div className="screen-subnav">
              <button
                type="button"
                className={screenView === 'editor' ? 'selected' : ''}
                onClick={() => setScreenView('editor')}
              >
                Éditeur de l’écran
              </button>
              <button
                type="button"
                className={screenView === 'preview' ? 'selected' : ''}
                onClick={() => setScreenView('preview')}
              >
                Aperçu
              </button>
            </div>
            {screenView === 'editor' ? (
              <>
                <div className="admin-card">
                  <h2>Mode d’affichage</h2>
                  <div className="mode-choice">
                    <button
                      type="button"
                      className={draft.layout.mode === 'fixed' ? 'selected' : ''}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          layout: { ...current.layout, mode: 'fixed' },
                        }))
                      }
                    >
                      Écran fixe
                    </button>
                    <button
                      type="button"
                      className={draft.layout.mode === 'playlist' ? 'selected' : ''}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          layout: { ...current.layout, mode: 'playlist' },
                        }))
                      }
                    >
                      Playlist
                    </button>
                  </div>
                  <h2>Ordre des diapositives</h2>
                  <div className="slide-list">
                    {draft.layout.slides.map((slide, index) => (
                      <div key={slide.id} className="slide-line">
                        <span>{slideTitle(slide.kind)}</span>
                        <label>
                          Durée (s)
                          <input
                            aria-label={`Durée ${slideTitle(slide.kind)}`}
                            type="number"
                            min="5"
                            max="180"
                            value={slide.durationSec}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                layout: {
                                  ...current.layout,
                                  slides: current.layout.slides.map((item) =>
                                    item.id === slide.id
                                      ? { ...item, durationSec: Number(event.target.value) }
                                      : item,
                                  ),
                                },
                              }))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          aria-label={`Monter ${slideTitle(slide.kind)}`}
                          disabled={index === 0}
                          onClick={() => moveSlide(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Descendre ${slideTitle(slide.kind)}`}
                          disabled={index === draft.layout.slides.length - 1}
                          onClick={() => moveSlide(index, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="admin-actions">
                  <button className="primary-button" type="button" onClick={saveDraft}>
                    {saved ? 'Brouillon enregistré' : 'Enregistrer le brouillon'}
                  </button>
                  <button className="publish-button" type="button" disabled>
                    Publier
                  </button>
                </div>
                <p className="form-note">
                  La publication sera disponible après raccordement au serveur.
                </p>
              </>
            ) : (
              <>
                <div className="admin-card preview-controls">
                  <div className="preview-date-fields">
                    <label>
                      Date de l’aperçu
                      <input
                        type="date"
                        value={previewDay}
                        onChange={(event) => setPreviewDay(event.target.value)}
                      />
                    </label>
                    <label>
                      Heure
                      <input
                        type="time"
                        value={previewTime}
                        onChange={(event) => setPreviewTime(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="preset-list" aria-label="Préréglages de l’aperçu">
                    {[
                      ['Semaine', '2026-10-06', '10:00'],
                      ['Vendredi après-midi', '2026-10-02', '15:00'],
                      ['Chabbat', '2026-10-03', '12:00'],
                      ['Yom Tov', '2026-10-01', '10:00'],
                    ].map(([label, date, time]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          setPreviewDay(date);
                          setPreviewTime(time);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="preview-frame">
                  <div className="draft-ribbon">BROUILLON — non publié</div>
                  {previewPackage ? (
                    <Display
                      packageData={previewPackage}
                      previewInstant={previewDate(previewDay, previewTime)}
                      previewMode
                    />
                  ) : null}
                </div>
                <div className="admin-actions">
                  <button className="primary-button" type="button" onClick={saveDraft}>
                    Enregistrer le brouillon
                  </button>
                  <button className="publish-button" type="button" disabled>
                    Publier
                  </button>
                </div>
                <p className="form-note">
                  La publication sera disponible après raccordement au serveur.
                </p>
              </>
            )}
          </section>
        ) : view === 'Médias' ? (
          <section className="admin-page">
            <div className="admin-card empty-card">
              <h2>Médias</h2>
              <p>
                Les photos et documents pourront être ajoutés après raccordement du stockage
                sécurisé.
              </p>
            </div>
          </section>
        ) : view === 'Plus' ? (
          <section className="admin-page">
            <div className="admin-card">
              <h2>Plus</h2>
              <div className="more-links">
                <button
                  type="button"
                  onClick={() =>
                    setDraftMessage(
                      'Paramètres de démonstration — méthodes religieuses en attente de validation.',
                    )
                  }
                >
                  Paramètres
                </button>
                <button
                  type="button"
                  onClick={() => setDraftMessage('Sources : Hebcal.com et MET Norway.')}
                >
                  Sources
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDraftMessage('Aucune publication disponible en mode démonstration.')
                  }
                >
                  Historique
                </button>
              </div>
              {draftMessage ? <p className="form-note">{draftMessage}</p> : null}
            </div>
          </section>
        ) : null}
      </div>
      <nav className="mobile-nav" aria-label="Navigation administration">
        <AdminNav active={view} onSelect={setView} />
      </nav>
    </div>
  );
}

function AdminNav({
  active,
  onSelect,
}: {
  active: AdminView;
  onSelect: (view: AdminView) => void;
}) {
  return (
    <nav className="admin-nav" aria-label="Navigation">
      {navItems.map((item) => (
        <button
          type="button"
          key={item}
          className={active === item ? 'active' : ''}
          onClick={() => onSelect(item)}
        >
          <span className="nav-icon" aria-hidden="true">
            {navIcon(item)}
          </span>
          <span>{item}</span>
        </button>
      ))}
    </nav>
  );
}

function Dashboard({ draft, onNavigate }: { draft: Draft; onNavigate: (view: AdminView) => void }) {
  return (
    <section className="admin-page dashboard-page">
      <div className="welcome-panel">
        <span className="admin-overline">Bonjour</span>
        <h2>Votre écran communautaire, simplement.</h2>
        <p>Préparez les horaires et annonces avant de les présenter sur la TV.</p>
      </div>
      <div className="dashboard-cards">
        <button className="dashboard-card" type="button" onClick={() => onNavigate('Horaires')}>
          <span className="card-index">01</span>
          <strong>Horaires</strong>
          <small>{draft.exceptions.length} exception(s) enregistrée(s)</small>
        </button>
        <button className="dashboard-card" type="button" onClick={() => onNavigate('Annonces')}>
          <span className="card-index">02</span>
          <strong>Annonces</strong>
          <small>{draft.content.length} contenus en brouillon</small>
        </button>
        <button className="dashboard-card" type="button" onClick={() => onNavigate('Écran')}>
          <span className="card-index">03</span>
          <strong>Écran</strong>
          <small>Aperçu avant publication</small>
        </button>
      </div>
      <div className="admin-card validation-card">
        <span className="status-dot" />
        <div>
          <strong>Méthodes en attente de validation</strong>
          <p>
            Les horaires de zmanim sont indicatifs tant que la méthode locale n’est pas approuvée.
          </p>
        </div>
      </div>
    </section>
  );
}

function slideTitle(kind: Layout['slides'][number]['kind']): string {
  const titles: Record<Layout['slides'][number]['kind'], string> = {
    schedule: 'Horaires',
    shabbat: 'Chabbat',
    content: 'Contenus',
    study: 'Étude',
    media: 'Médias',
    qr: 'Code QR',
  };
  return titles[kind];
}

function navIcon(view: AdminView): string {
  const icons: Record<AdminView, string> = {
    'Tableau de bord': '⌂',
    Horaires: '◷',
    Annonces: '✳',
    Médias: '▧',
    Écran: '▤',
    Plus: '⋯',
  };
  return icons[view];
}
