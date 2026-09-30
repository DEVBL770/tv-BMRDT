import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { resolveMinyan, type MinyanException, type MinyanRule } from '../domain/minyan';
import {
  parsePublishedPackage,
  type ContentItem,
  type Layout,
  type PublishedPackage,
} from '../domain/package';
import { addLocalDays, instantFromLocal, localDateOf } from '../domain/time';
import { Display } from '../display/Display';
import { loadDemoPackage } from '../demoPackage';
import {
  createAdminRepository,
  type AdminContentItem,
  type AdminDraft,
  type AdminRepository,
} from '../lib/adminRepository';
import { supabase } from '../lib/supabase';
import { adminErrorMessage, invokeAdmin } from './adminApi';
import { summarizePublicationChanges } from './adminUtils';
import { MediaManager } from './MediaManager';

type AdminView =
  | 'Tableau de bord'
  | 'Horaires'
  | 'Contenus'
  | 'Médias'
  | 'Écran'
  | 'Historique'
  | 'Appareils'
  | 'Sources'
  | 'Réglages';

type Settings = {
  id: true;
  site_name: string;
  site_address: string;
  logo_media_id: string | null;
  sponsor_margin_before_min: number;
  sponsor_margin_after_min: number;
  hide_commercial_on_chol_hamoed: boolean;
  rambam_cycle: 'dr1' | 'dr3';
  religious_method_status: 'pending' | 'approved';
  religious_method_params: Record<string, unknown>;
  approved_by: string | null;
  approved_at: string | null;
  media_active_budget_mb: number;
  updated_at: string;
};

type Version = {
  id: string;
  version_number: number;
  created_at: string;
  source: string;
  created_by: string | null;
  restored_from: string | null;
  package: unknown;
  draft_snapshot: unknown;
};

type Device = {
  id: string;
  device_name: string;
  revoked_at: string | null;
  last_seen: string | null;
  displayed_version: number | null;
  cache_status: string | null;
  clock_skew_seconds: number | null;
  last_error_code: string | null;
  created_at: string;
  build: string | null;
};

type SourceHealth = {
  source: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  data_age_seconds: number | null;
};

export type MediaAsset = {
  id: string;
  storage_path: string;
  original_name_label: string;
  kind: string;
  mime: string;
  bytes: number;
  status: string;
  error_code: string | null;
  parent_id: string | null;
  page_index: number | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  created_at: string;
};

type SourceRecord = {
  id: string;
  provider: string;
  kind: string;
  local_date: string | null;
  source_id: string | null;
  instant: string | null;
  value: unknown;
  method: unknown;
  params: unknown;
  fetched_at: string;
  valid_until: string | null;
  override_value: unknown;
  override_by: string | null;
  override_expires_at: string | null;
  override_reason: string | null;
  status: string;
};

type AuditEvent = {
  id: string;
  table_name: string;
  action: string;
  record_id: string | null;
  before_data: unknown;
  after_data: unknown;
  actor_id: string | null;
  created_at: string;
};

type Workspace = {
  draft: AdminDraft;
  settings: Settings;
  publicState: { current_version_id: string | null; current_version_number: number } | null;
  versions: Version[];
  devices: Device[];
  sourceHealth: SourceHealth[];
  media: MediaAsset[];
};

const emptyDraft: AdminDraft = {
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
  exceptions: [],
  content: [],
  layout: {
    mode: 'fixed',
    zones: { weather: true, study: true, sponsor: true },
    slides: [{ id: 'schedule', kind: 'schedule', durationSec: 30 }],
  },
};

const defaultSettings: Settings = {
  id: true,
  site_name: 'Beth Menahem',
  site_address: 'Paris 19e',
  logo_media_id: null,
  sponsor_margin_before_min: 30,
  sponsor_margin_after_min: 0,
  hide_commercial_on_chol_hamoed: false,
  rambam_cycle: 'dr3',
  religious_method_status: 'pending',
  religious_method_params: {},
  approved_by: null,
  approved_at: null,
  media_active_budget_mb: 500,
  updated_at: new Date().toISOString(),
};

const mainViews: AdminView[] = ['Tableau de bord', 'Horaires', 'Contenus', 'Médias', 'Écran'];
const extraViews: AdminView[] = ['Historique', 'Appareils', 'Sources', 'Réglages'];
const offices = ['Chaharit', 'Min’ha', 'Arvit'];
const weekdays = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const dayKinds = [
  ['weekday', 'Jour de semaine'],
  ['erev_shabbat', 'Veille de Chabbat'],
  ['shabbat', 'Chabbat'],
  ['erev_yomtov', 'Veille de Yom Tov'],
  ['yomtov', 'Yom Tov'],
  ['chol_hamoed', 'Hol Hamoed'],
] as const;
const contentTypes: Array<{ value: ContentItem['type']; label: string }> = [
  { value: 'announcement', label: 'Annonce' },
  { value: 'event', label: 'Cours / événement' },
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function serialize(value: unknown): string {
  return (
    JSON.stringify(value, (_key, child: unknown) => {
      if (typeof child !== 'object' || child === null || Array.isArray(child)) return child;
      return Object.fromEntries(
        Object.entries(child as Record<string, unknown>).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
    }) ?? 'undefined'
  );
}

async function loadWorkspace(
  client: NonNullable<typeof supabase>,
  repository: AdminRepository,
): Promise<Workspace> {
  const [
    draft,
    settingsResult,
    stateResult,
    versionsResult,
    devicesResult,
    healthResult,
    mediaResult,
  ] = await Promise.all([
    repository.loadDraft(emptyDraft),
    client.from('settings').select('*').eq('id', true).maybeSingle(),
    client
      .from('public_state')
      .select('current_version_id,current_version_number')
      .eq('id', true)
      .maybeSingle(),
    client
      .from('published_versions')
      .select('*')
      .order('version_number', { ascending: false })
      .limit(100),
    client
      .from('devices')
      .select(
        'id,device_name,revoked_at,last_seen,displayed_version,cache_status,clock_skew_seconds,last_error_code,created_at,build',
      )
      .order('created_at', { ascending: false }),
    client.from('source_health').select('*').order('source'),
    client.from('media_assets').select('*').order('created_at', { ascending: false }).limit(500),
  ]);
  for (const result of [
    settingsResult,
    stateResult,
    versionsResult,
    devicesResult,
    healthResult,
    mediaResult,
  ]) {
    if (result.error) throw new Error('database_unavailable');
  }
  const settings = (settingsResult.data as unknown as Settings | null) ?? defaultSettings;
  const versions = (versionsResult.data ?? []) as unknown as Version[];
  return {
    draft,
    settings,
    publicState: stateResult.data,
    versions,
    devices: (devicesResult.data ?? []) as Device[],
    sourceHealth: (healthResult.data ?? []) as SourceHealth[],
    media: (mediaResult.data ?? []) as MediaAsset[],
  };
}

async function signedMediaUrls(
  pkg: PublishedPackage,
  assets: MediaAsset[],
  client: typeof supabase,
): Promise<Record<string, string>> {
  if (!client) return {};
  const packageMedia = new Set(pkg.media.map((item) => item.id));
  const entries = await Promise.all(
    assets
      .filter((asset) => packageMedia.has(asset.id) && asset.mime.startsWith('image/'))
      .map(async (asset) => {
        const { data } = await client.storage
          .from('media')
          .createSignedUrl(asset.storage_path, 3600);
        return data?.signedUrl ? ([asset.id, data.signedUrl] as const) : null;
      }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

function previewInstant(date: string, time: string): Date {
  return instantFromLocal(date || localDateOf(new Date()), time || '12:00');
}

function dayKindForDate(date: string, pkg?: PublishedPackage): string | undefined {
  const day = pkg?.days.find((item) => item.date === date);
  if (day?.holidayKinds?.includes('yomtov')) return 'yomtov';
  if (day?.holidayKinds?.includes('erev_yomtov')) return 'erev_yomtov';
  if (day?.holidayKinds?.includes('chol_hamoed')) return 'chol_hamoed';
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 6) return 'shabbat';
  if (weekday === 5) return 'erev_shabbat';
  return 'weekday';
}

function demoPackageWithDraft(
  base: PublishedPackage,
  draft: AdminDraft,
  settings: Settings,
): PublishedPackage {
  const minyanim = base.days.flatMap((day) =>
    offices.map((office) => {
      const resolved = resolveMinyan(
        day.date,
        office,
        draft.rules,
        draft.exceptions,
        dayKindForDate(day.date, base),
      );
      return {
        date: day.date,
        office,
        time: resolved.time,
        cancelled: resolved.cancelled,
        status: resolved.status,
      };
    }),
  );
  return {
    ...base,
    site: {
      ...base.site,
      name: settings.site_name,
      address: settings.site_address,
      ...(settings.logo_media_id ? { logoMediaId: settings.logo_media_id } : {}),
    },
    methods: {
      ...base.methods,
      status: settings.religious_method_status,
    },
    sponsorMargin: {
      beforeMinutes: settings.sponsor_margin_before_min,
      afterMinutes: settings.sponsor_margin_after_min,
    },
    hideCommercialOnCholHamoed: settings.hide_commercial_on_chol_hamoed,
    content: draft.content.filter((item) => item.status === 'ready'),
    layout: draft.layout,
    minyanim,
  };
}

function dayLabel(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function timeSince(value: string | null): string {
  if (!value) return 'Jamais connectée';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function Admin({ demoMode = false }: { demoMode?: boolean }) {
  const repository = useMemo(() => createAdminRepository(demoMode), [demoMode]);
  const [draft, setDraft] = useState<AdminDraft>(emptyDraft);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [demoBase, setDemoBase] = useState<PublishedPackage>();
  const [preview, setPreview] = useState<PublishedPackage>();
  const [previewMediaUrls, setPreviewMediaUrls] = useState<Record<string, string>>({});
  const [historyPreview, setHistoryPreview] = useState<PublishedPackage>();
  const [historyMediaUrls, setHistoryMediaUrls] = useState<Record<string, string>>({});
  const [publicState, setPublicState] = useState<Workspace['publicState']>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sourceHealth, setSourceHealth] = useState<SourceHealth[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [userId, setUserId] = useState('');
  const [activeView, setActiveView] = useState<AdminView>('Tableau de bord');
  const [extraMenuOpen, setExtraMenuOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(repository.mode === 'demo');
  const [authReady, setAuthReady] = useState(repository.mode === 'demo');
  const [loading, setLoading] = useState(repository.mode === 'demo');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [previewDate, setPreviewDate] = useState(localDateOf(new Date()));
  const [previewTime, setPreviewTime] = useState('15:00');
  const [previewSize, setPreviewSize] = useState<'mobile' | 'desktop'>('desktop');
  const savedKey = useRef('');
  const isDemo = repository.mode === 'demo';
  const isDirty = Boolean(savedKey.current) && serialize({ draft, settings }) !== savedKey.current;
  const activeVersion = versions.find((version) => version.id === publicState?.current_version_id);
  const currentPackage = useMemo(() => {
    if (isDemo && demoBase) return demoPackageWithDraft(demoBase, draft, settings);
    return preview;
  }, [demoBase, draft, isDemo, preview, settings]);

  const hydrate = useCallback(async () => {
    if (!supabase) throw new Error('database_unavailable');
    const workspace = await loadWorkspace(supabase, repository);
    setDraft(workspace.draft);
    setSettings(workspace.settings);
    setPublicState(workspace.publicState);
    setVersions(workspace.versions);
    setDevices(workspace.devices);
    setSourceHealth(workspace.sourceHealth);
    setMedia(workspace.media);
    savedKey.current = serialize({ draft: workspace.draft, settings: workspace.settings });
  }, [repository]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        if (repository.mode === 'demo') {
          const packageData = await loadDemoPackage();
          if (!active) return;
          const demoDraft: AdminDraft = {
            ...emptyDraft,
            content: packageData.content.map((item) => ({ ...item, status: 'ready' })),
            layout: packageData.layout,
          };
          const initial = await repository.loadDraft(demoDraft);
          const localSettings = localStorage.getItem('beth-menahem-settings');
          const configuredSettings = localSettings
            ? ({ ...defaultSettings, ...JSON.parse(localSettings) } as Settings)
            : {
                ...defaultSettings,
                site_name: packageData.site.name,
                site_address: packageData.site.address,
                religious_method_status: packageData.methods.status,
                sponsor_margin_before_min: packageData.sponsorMargin.beforeMinutes,
                sponsor_margin_after_min: packageData.sponsorMargin.afterMinutes,
                hide_commercial_on_chol_hamoed: packageData.hideCommercialOnCholHamoed,
              };
          setDemoBase(packageData);
          setDraft(initial);
          setSettings(configuredSettings);
          savedKey.current = serialize({ draft: initial, settings: configuredSettings });
          setLoading(false);
          setAuthReady(true);
          return;
        }
        if (!supabase) {
          setAuthReady(true);
          setLoading(false);
          return;
        }
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!active) return;
        if (sessionError || !data.session) {
          setAuthReady(true);
          setLoading(false);
          return;
        }
        const { data: admin, error: adminError } = await supabase.rpc('is_admin');
        if (!active) return;
        if (adminError || admin !== true) {
          await supabase.auth.signOut();
          setError('Ce compte ne dispose pas des droits administrateur.');
          setAuthReady(true);
          setLoading(false);
          return;
        }
        setUserId(data.session.user.id);
        await hydrate();
        if (!active) return;
        setAuthenticated(true);
        setAuthReady(true);
        setLoading(false);
      } catch {
        if (!active) return;
        setError('Connexion au serveur impossible. Vérifiez la connexion puis réessayez.');
        setAuthReady(true);
        setLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [hydrate, repository]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [isDirty]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setError('');
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !data.session) {
      setError('Adresse e-mail ou mot de passe incorrect.');
      setLoading(false);
      return;
    }
    const { data: admin, error: adminError } = await supabase.rpc('is_admin');
    if (adminError || admin !== true) {
      await supabase.auth.signOut();
      setError('Ce compte ne dispose pas des droits administrateur.');
      setLoading(false);
      return;
    }
    try {
      setUserId(data.session.user.id);
      await hydrate();
      setAuthenticated(true);
      setToast('Connexion réussie.');
    } catch {
      await supabase.auth.signOut();
      setError('Connexion au serveur impossible.');
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft(showToast = true) {
    setSaving(true);
    try {
      await repository.saveDraft(draft);
      if (!isDemo) {
        if (!supabase) throw new Error('database_unavailable');
        const { error: settingsError } = await supabase
          .from('settings')
          .upsert(
            { ...settings, id: true, updated_at: new Date().toISOString() },
            { onConflict: 'id' },
          );
        if (settingsError) throw new Error('database_unavailable');
      } else {
        localStorage.setItem('beth-menahem-settings', JSON.stringify(settings));
      }
      savedKey.current = serialize({ draft, settings });
      setDraftSaved(true);
      if (showToast)
        setToast(
          isDemo ? 'Brouillon enregistré sur cet appareil.' : 'Brouillon enregistré dans Supabase.',
        );
      window.setTimeout(() => setDraftSaved(false), 2500);
      return true;
    } catch (saveError) {
      setToast(adminErrorMessage(saveError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function navigate(view: AdminView) {
    if (view === activeView) {
      setExtraMenuOpen(false);
      return;
    }
    if (
      isDirty &&
      !window.confirm('Des modifications ne sont pas enregistrées. Quitter cette page ?')
    ) {
      return;
    }
    setActiveView(view);
    setExtraMenuOpen(false);
    setError('');
  }

  async function refreshData() {
    if (isDemo || !supabase) return;
    try {
      const result = await invokeAdmin<{ days?: number; published?: { versionNumber: number } }>(
        supabase,
        'refreshData',
      );
      await hydrate();
      setToast(
        result.published
          ? `Sources actualisées · version ${result.published.versionNumber} publiée.`
          : `Sources actualisées · ${result.days ?? 0} jours vérifiés.`,
      );
    } catch (refreshError) {
      setToast(adminErrorMessage(refreshError));
    }
  }

  async function refreshPreview() {
    if (isDemo) {
      if (demoBase) {
        setPreview(demoPackageWithDraft(demoBase, draft, settings));
        setPreviewMediaUrls({});
      }
      return;
    }
    if (!supabase) return;
    if (!(await saveDraft(false))) return;
    try {
      const result = await invokeAdmin<{ package: unknown }>(supabase, 'previewPackage');
      const parsed = parsePublishedPackage(result.package);
      setPreview(parsed);
      setPreviewMediaUrls(await signedMediaUrls(parsed, media, supabase));
      setToast('Aperçu du brouillon actualisé.');
    } catch (previewError) {
      setToast(adminErrorMessage(previewError));
    }
  }

  async function publish() {
    if (isDemo || !supabase) return;
    if (!(await saveDraft(false))) return;
    try {
      const result = await invokeAdmin<{ versionNumber: number }>(supabase, 'publish');
      setShowPublishDialog(false);
      await hydrate();
      setToast(`Publication réussie · version ${result.versionNumber}.`);
    } catch (publishError) {
      const code = publishError instanceof Error ? publishError.message : '';
      if (
        code === 'version_conflict' &&
        window.confirm('Une nouvelle version existe. Recharger le brouillon ?')
      ) {
        await hydrate();
        setToast('Brouillon rechargé depuis la dernière version.');
      } else if (
        code === 'calendar_horizon_short' &&
        window.confirm('Le calendrier doit être actualisé. Lancer l’actualisation des sources ?')
      ) {
        await refreshData();
      } else {
        setToast(adminErrorMessage(publishError));
      }
    }
  }

  async function signOut() {
    if (
      isDirty &&
      !window.confirm('Des modifications ne sont pas enregistrées. Se déconnecter ?')
    ) {
      return;
    }
    if (supabase && !isDemo) await supabase.auth.signOut();
    setAuthenticated(isDemo);
    setAuthReady(isDemo);
    setDraft(emptyDraft);
  }

  const activeChanges = activeVersion
    ? summarizePublicationChanges(draft, activeVersion.draft_snapshot)
    : { rules: 0, exceptions: 0, content: draft.content.length, layoutChanged: true };
  const navProps = { active: activeView, onSelect: navigate };

  if (!authReady || loading) {
    return (
      <main className="login-screen" aria-busy="true">
        <p role="status">Chargement de l’administration…</p>
      </main>
    );
  }

  if (!isDemo && !authenticated) {
    return (
      <main className="login-screen">
        <form className="login-card" onSubmit={signIn}>
          <span className="admin-brand-monogram">ב״ה</span>
          <h1>Administration</h1>
          <p className="page-description">Connectez-vous avec votre compte administrateur.</p>
          <label>
            Adresse e-mail
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Mot de passe
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={loading}>
            Se connecter
          </button>
          <p className="form-note">
            Mot de passe oublié ? Suivez la procédure de récupération dans ADMIN_GUIDE.md.
          </p>
        </form>
      </main>
    );
  }

  return (
    <div className="admin-shell admin-console">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-monogram">ב״ה</span>
          <strong>{settings.site_name || 'Beth Menahem'}</strong>
          <small>Administration</small>
        </div>
        <AdminNav
          {...navProps}
          extraOpen={extraMenuOpen}
          onToggleExtra={() => setExtraMenuOpen((value) => !value)}
        />
        <div className="sidebar-status">
          <span className={isDemo ? 'status-dot demo-dot' : 'status-dot'} />
          {isDemo ? 'Mode démonstration' : 'Mode Supabase'}
        </div>
        <button type="button" className="sidebar-logout" onClick={() => void signOut()}>
          Déconnexion
        </button>
      </aside>
      <div className="admin-content">
        <header className="admin-topbar">
          <div>
            <span className="admin-overline">
              {settings.site_name} · {settings.site_address || 'Paris 19e'}
            </span>
            <h1>{activeView}</h1>
          </div>
          <div className="admin-topbar-actions">
            <span className={isDirty ? 'draft-indicator draft-dirty' : 'draft-indicator'}>
              <span />{' '}
              {isDirty
                ? 'Modifications non enregistrées'
                : isDemo
                  ? 'Brouillon local'
                  : 'Brouillon enregistré'}
            </span>
            <button
              className="primary-button compact-button"
              type="button"
              onClick={() => void saveDraft()}
              disabled={saving || !isDirty}
            >
              {saving ? 'Enregistrement…' : draftSaved ? 'Enregistré' : 'Enregistrer'}
            </button>
          </div>
        </header>
        {isDemo ? (
          <p className="demo-banner" role="note">
            Mode démonstration : les actions qui nécessitent Supabase sont désactivées. Les
            modifications restent sur cet appareil.
          </p>
        ) : null}
        {error ? (
          <p className="form-error global-error" role="alert">
            {error}
          </p>
        ) : null}
        {activeView === 'Tableau de bord' ? (
          <Dashboard
            draft={draft}
            settings={settings}
            publicState={publicState}
            activeVersion={activeVersion}
            devices={devices}
            sourceHealth={sourceHealth}
            isDemo={isDemo}
            changes={activeChanges}
            onNavigate={navigate}
          />
        ) : activeView === 'Horaires' ? (
          <ScheduleEditor draft={draft} setDraft={setDraft} preview={currentPackage} />
        ) : activeView === 'Contenus' ? (
          <ContentEditor draft={draft} setDraft={setDraft} media={media} />
        ) : activeView === 'Médias' ? (
          <MediaManager
            isDemo={isDemo}
            media={media}
            budgetMb={settings.media_active_budget_mb}
            onRefresh={hydrate}
            onToast={setToast}
          />
        ) : activeView === 'Écran' ? (
          <ScreenEditor
            draft={draft}
            setDraft={setDraft}
            preview={currentPackage}
            mediaUrls={previewMediaUrls}
            isDemo={isDemo}
            previewDate={previewDate}
            previewTime={previewTime}
            previewSize={previewSize}
            onDateChange={setPreviewDate}
            onTimeChange={setPreviewTime}
            onSizeChange={setPreviewSize}
            onPreview={() => void refreshPreview()}
            onPublish={() => setShowPublishDialog(true)}
          />
        ) : activeView === 'Historique' ? (
          <History
            isDemo={isDemo}
            versions={versions}
            preview={historyPreview}
            mediaUrls={historyMediaUrls}
            onPreview={async (version) => {
              try {
                const parsed = parsePublishedPackage(version.package);
                setHistoryPreview(parsed);
                setHistoryMediaUrls(await signedMediaUrls(parsed, media, supabase));
              } catch {
                setToast('Le paquet de cette version est illisible.');
              }
            }}
            onRestore={async (version) => {
              if (isDemo || !supabase) return;
              if (
                !window.confirm(
                  `Restaurer la version ${version.version_number} ? Une nouvelle version sera créée.`,
                )
              )
                return;
              try {
                const result = await invokeAdmin<{ versionNumber: number }>(supabase, 'restore', {
                  versionId: version.id,
                });
                setHistoryPreview(undefined);
                setHistoryMediaUrls({});
                await hydrate();
                setToast(
                  `Version ${result.versionNumber} créée à partir de la version ${version.version_number}.`,
                );
              } catch (restoreError) {
                setToast(adminErrorMessage(restoreError));
              }
            }}
            client={supabase}
          />
        ) : activeView === 'Appareils' ? (
          <Devices
            isDemo={isDemo}
            client={supabase}
            devices={devices}
            publicState={publicState}
            onRefresh={hydrate}
            onToast={setToast}
          />
        ) : activeView === 'Sources' ? (
          <Sources
            isDemo={isDemo}
            client={supabase}
            health={sourceHealth}
            userId={userId}
            onRefresh={hydrate}
            onRefreshData={refreshData}
            onToast={setToast}
          />
        ) : (
          <SettingsPanel
            settings={settings}
            setSettings={setSettings}
            isDemo={isDemo}
            client={supabase}
            userId={userId}
            media={media}
            onToast={setToast}
            onSignOut={() => void signOut()}
          />
        )}
      </div>
      <nav className="mobile-nav" aria-label="Navigation administration">
        <AdminNav
          {...navProps}
          extraOpen={extraMenuOpen}
          onToggleExtra={() => setExtraMenuOpen((value) => !value)}
        />
      </nav>
      {showPublishDialog ? (
        <div className="modal-backdrop">
          <section
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-title"
          >
            <h2 id="publish-title">Confirmer la publication</h2>
            <p>Les changements depuis la dernière version :</p>
            <ul>
              <li>{activeChanges.rules} règle(s) d’horaires</li>
              <li>{activeChanges.exceptions} exception(s)</li>
              <li>{activeChanges.content} contenu(s)</li>
              <li>
                {activeChanges.layoutChanged ? 'Mise en page modifiée' : 'Mise en page inchangée'}
              </li>
            </ul>
            {isDemo ? (
              <p className="form-note">La publication est indisponible en mode démonstration.</p>
            ) : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setShowPublishDialog(false)}>
                Annuler
              </button>
              <button
                className="publish-button"
                type="button"
                disabled={isDemo}
                onClick={() => void publish()}
              >
                Publier maintenant
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {toast ? (
        <div className="admin-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function AdminNav({
  active,
  onSelect,
  extraOpen,
  onToggleExtra,
}: {
  active: AdminView;
  onSelect: (view: AdminView) => void;
  extraOpen: boolean;
  onToggleExtra: () => void;
}) {
  return (
    <nav className="admin-nav" aria-label="Navigation">
      {mainViews.map((item) => (
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
      <button
        type="button"
        className={extraViews.includes(active) || extraOpen ? 'active' : ''}
        aria-expanded={extraOpen}
        onClick={onToggleExtra}
      >
        <span className="nav-icon" aria-hidden="true">
          ⋯
        </span>
        <span>Plus</span>
      </button>
      {extraOpen ? (
        <div className="admin-nav-extra">
          {extraViews.map((item) => (
            <button
              type="button"
              key={item}
              className={active === item ? 'active' : ''}
              onClick={() => onSelect(item)}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}

function Dashboard({
  draft,
  settings,
  publicState,
  activeVersion,
  devices,
  sourceHealth,
  isDemo,
  changes,
  onNavigate,
}: {
  draft: AdminDraft;
  settings: Settings;
  publicState: Workspace['publicState'];
  activeVersion?: Version | undefined;
  devices: Device[];
  sourceHealth: SourceHealth[];
  isDemo: boolean;
  changes: ReturnType<typeof summarizePublicationChanges>;
  onNavigate: (view: AdminView) => void;
}) {
  const now = Date.now();
  const horizonDate = activeVersion
    ? asRecord(asRecord(activeVersion.package).horizon).lastDate
    : undefined;
  const horizonDays =
    typeof horizonDate === 'string'
      ? Math.floor((Date.parse(`${horizonDate}T12:00:00Z`) - now) / 86_400_000)
      : null;
  const pendingRules = draft.rules.filter(
    (rule) => rule.status === 'to_confirm' && rule.active,
  ).length;
  const alerts = [
    horizonDays !== null && horizonDays < 330
      ? `Horizon de calendrier : ${horizonDays} jours restants.`
      : '',
    ...devices
      .filter(
        (device) =>
          !device.revoked_at && device.last_seen && now - Date.parse(device.last_seen) > 5 * 60_000,
      )
      .map((device) => `${device.device_name} est hors ligne depuis plus de cinq minutes.`),
    ...devices
      .filter(
        (device) =>
          !device.revoked_at && device.displayed_version !== publicState?.current_version_number,
      )
      .map(
        (device) =>
          `${device.device_name} affiche la version ${device.displayed_version ?? 'inconnue'}, différente de la version courante.`,
      ),
    settings.religious_method_status === 'pending'
      ? 'Les méthodes religieuses sont en attente de validation.'
      : '',
    pendingRules ? `${pendingRules} règle(s) d’horaires restent à confirmer.` : '',
  ].filter(Boolean);
  const hebcal = sourceHealth.find((item) => item.source === 'hebcal');
  const met = sourceHealth.find((item) => item.source === 'met-locationforecast');
  return (
    <section className="admin-page dashboard-page">
      <div className="welcome-panel">
        <span className="admin-overline">Bonjour</span>
        <h2>Votre écran communautaire, simplement.</h2>
        <p>Préparez les horaires et les annonces, puis vérifiez l’aperçu avant publication.</p>
      </div>
      <div className="dashboard-cards">
        {[
          [
            '01',
            'Horaires',
            `${draft.rules.length} règle(s) · ${draft.exceptions.length} exception(s)`,
            'Horaires',
          ],
          [
            '02',
            'Contenus',
            `${draft.content.filter((item) => item.status !== 'archived').length} contenu(s) actif(s)`,
            'Contenus',
          ],
          ['03', 'Écran', 'Aperçu et publication', 'Écran'],
        ].map(([index, title, detail, view]) => (
          <button
            className="dashboard-card"
            type="button"
            key={view}
            onClick={() => onNavigate(view as AdminView)}
          >
            <span className="card-index">{index}</span>
            <strong>{title}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <article className="admin-card">
          <h2>Publication active</h2>
          {activeVersion ? (
            <dl className="detail-list">
              <div>
                <dt>Version</dt>
                <dd>#{activeVersion.version_number}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{timeSince(activeVersion.created_at)}</dd>
              </div>
              <div>
                <dt>Auteur</dt>
                <dd>{activeVersion.created_by ?? 'Système'}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{activeVersion.source}</dd>
              </div>
            </dl>
          ) : (
            <p className="empty-state">Aucune version publiée.</p>
          )}
          <p
            className={
              changes.rules + changes.exceptions + changes.content > 0 || changes.layoutChanged
                ? 'dirty-note'
                : 'form-note'
            }
          >
            {changes.rules + changes.exceptions + changes.content > 0 || changes.layoutChanged
              ? 'Brouillon modifié depuis la dernière publication.'
              : 'Le brouillon correspond à la dernière publication.'}
          </p>
        </article>
        <article className="admin-card">
          <h2>Sources de données</h2>
          <dl className="detail-list">
            <div>
              <dt>Hebcal · dernier succès</dt>
              <dd>{timeSince(hebcal?.last_success_at ?? null)}</dd>
            </div>
            <div>
              <dt>Fin de l’horizon</dt>
              <dd>{typeof horizonDate === 'string' ? horizonDate : 'À actualiser'}</dd>
            </div>
            <div>
              <dt>Météo MET</dt>
              <dd>{timeSince(met?.last_success_at ?? null)}</dd>
            </div>
          </dl>
          <p className="form-note">
            {isDemo
              ? 'Les états de sources réels nécessitent Supabase.'
              : 'La santé est mise à jour après chaque actualisation.'}
          </p>
        </article>
        <article className="admin-card dashboard-device-card">
          <h2>Appareils</h2>
          {devices.length ? (
            devices.map((device) => {
              const seenAt = device.last_seen ? Date.parse(device.last_seen) : 0;
              const online = !device.revoked_at && seenAt > 0 && now - seenAt < 60_000;
              return (
                <div className="device-summary" key={device.id}>
                  <span className={online ? 'device-dot online' : 'device-dot'} />
                  <div>
                    <strong>{device.device_name}</strong>
                    <small>
                      {online ? 'En ligne' : `Dernière vue · ${timeSince(device.last_seen)}`}
                    </small>
                    <small>
                      Version {device.displayed_version ?? '—'} · cache{' '}
                      {device.cache_status ?? 'inconnu'} · écart {device.clock_skew_seconds ?? '—'}{' '}
                      s
                    </small>
                    {device.last_error_code ? (
                      <small className="form-error">
                        Dernière erreur : {device.last_error_code}
                      </small>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="empty-state">Aucun appareil enregistré.</p>
          )}
        </article>
        <article className="admin-card">
          <h2>Alertes</h2>
          {alerts.length ? (
            <ul className="alert-list">
              {alerts.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="success-note">Aucune alerte en cours.</p>
          )}
        </article>
      </div>
    </section>
  );
}

function ScheduleEditor({
  draft,
  setDraft,
  preview,
}: {
  draft: AdminDraft;
  setDraft: (updater: (current: AdminDraft) => AdminDraft) => void;
  preview?: PublishedPackage | undefined;
}) {
  const [editingRule, setEditingRule] = useState<string>();
  const [ruleScope, setRuleScope] = useState<'base' | 'weekly' | 'period'>('base');
  const [office, setOffice] = useState('Chaharit');
  const [time, setTime] = useState('08:30');
  const [from, setFrom] = useState(localDateOf(new Date()));
  const [to, setTo] = useState(addLocalDays(localDateOf(new Date()), 30));
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [priority, setPriority] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [ruleFormError, setRuleFormError] = useState('');
  const [exceptionDate, setExceptionDate] = useState(localDateOf(new Date()));
  const [exceptionOffice, setExceptionOffice] = useState('Min’ha');
  const [exceptionTime, setExceptionTime] = useState('19:00');
  const [exceptionCancelled, setExceptionCancelled] = useState(false);

  function resetRule() {
    setEditingRule(undefined);
    setRuleScope('base');
    setTime('08:30');
    setPriority(0);
    setConfirmed(false);
    setCancelled(false);
    setSelectedDays([]);
    setSelectedKinds([]);
    setRuleFormError('');
  }

  function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRuleFormError('');
    if (ruleScope === 'weekly' && !selectedDays.length) {
      setRuleFormError('Sélectionnez au moins un jour pour cette règle hebdomadaire.');
      return;
    }
    if (ruleScope === 'period' && from > to) {
      setRuleFormError('La date de fin doit être égale ou postérieure à la date de début.');
      return;
    }
    const rule: MinyanRule = {
      id: editingRule ?? crypto.randomUUID(),
      office,
      time: cancelled ? null : time,
      ...(ruleScope === 'period' ? { validFrom: from, validTo: to } : {}),
      ...(ruleScope === 'weekly' && selectedDays.length ? { weekdays: selectedDays } : {}),
      ...(selectedKinds.length ? { dayKinds: selectedKinds } : {}),
      priority,
      active: true,
      status: confirmed ? 'confirmed' : 'to_confirm',
      cancelled,
    };
    setDraft((current) => ({
      ...current,
      rules: editingRule
        ? current.rules.map((item) => (item.id === editingRule ? rule : item))
        : [...current.rules, rule],
    }));
    resetRule();
  }

  function editRule(rule: MinyanRule) {
    setEditingRule(rule.id);
    setOffice(rule.office);
    setTime(rule.time ?? '08:30');
    setRuleScope(
      rule.validFrom && rule.validTo ? 'period' : rule.weekdays?.length ? 'weekly' : 'base',
    );
    setFrom(rule.validFrom ?? localDateOf(new Date()));
    setTo(rule.validTo ?? addLocalDays(localDateOf(new Date()), 30));
    setSelectedDays(rule.weekdays ?? []);
    setSelectedKinds(rule.dayKinds ?? []);
    setPriority(rule.priority);
    setConfirmed(rule.status === 'confirmed');
    setCancelled(rule.cancelled === true);
  }

  function saveException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const exception: MinyanException = {
      id: crypto.randomUUID(),
      date: exceptionDate,
      office: exceptionOffice,
      time: exceptionCancelled ? null : exceptionTime,
      cancelled: exceptionCancelled,
    };
    setDraft((current) => ({
      ...current,
      exceptions: [
        ...current.exceptions.filter(
          (item) => item.date !== exceptionDate || item.office !== exceptionOffice,
        ),
        exception,
      ],
    }));
  }

  function editException(exception: MinyanException) {
    setExceptionDate(exception.date);
    setExceptionOffice(exception.office);
    setExceptionTime(exception.time ?? '19:00');
    setExceptionCancelled(exception.cancelled);
  }

  const dates = Array.from({ length: 14 }, (_, index) =>
    addLocalDays(localDateOf(new Date()), index),
  );

  return (
    <section className="admin-page">
      <div className="page-intro">
        <p>Règles de base, récurrences et exceptions datées.</p>
        <span>Les horaires marqués « à confirmer » restent clairement signalés à l’écran.</span>
      </div>
      <div className="admin-grid-two">
        <article className="admin-card">
          <h2>{editingRule ? 'Modifier une règle' : 'Ajouter une règle d’office'}</h2>
          <form className="admin-form" onSubmit={saveRule}>
            <label>
              Office
              <select value={office} onChange={(event) => setOffice(event.target.value)}>
                {offices.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Type de règle
              <select
                value={ruleScope}
                onChange={(event) => setRuleScope(event.target.value as typeof ruleScope)}
              >
                <option value="base">Base (tous les jours)</option>
                <option value="weekly">Hebdomadaire</option>
                <option value="period">Période datée</option>
              </select>
            </label>
            {ruleScope === 'period' ? (
              <div className="form-row">
                <label>
                  Du
                  <input
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Au
                  <input
                    type="date"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    required
                  />
                </label>
              </div>
            ) : null}
            {ruleScope === 'weekly' ? (
              <fieldset className="weekday-fieldset">
                <legend>Jours de la semaine</legend>
                <div className="weekday-choices">
                  {weekdays.map((label, index) => (
                    <label key={label}>
                      <input
                        type="checkbox"
                        checked={selectedDays.includes(index)}
                        onChange={(event) =>
                          setSelectedDays((current) =>
                            event.target.checked
                              ? [...current, index].sort()
                              : current.filter((item) => item !== index),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <fieldset className="weekday-fieldset">
              <legend>Types de jours (facultatif)</legend>
              <div className="kind-choices">
                {dayKinds.map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={selectedKinds.includes(value)}
                      onChange={(event) =>
                        setSelectedKinds((current) =>
                          event.target.checked
                            ? [...current, value]
                            : current.filter((item) => item !== value),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {!cancelled ? (
              <label>
                Heure
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  required
                />
              </label>
            ) : null}
            <label>
              Priorité
              <input
                type="number"
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value))}
              />
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              Horaire confirmé
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={cancelled}
                onChange={(event) => setCancelled(event.target.checked)}
              />
              Office annulé
            </label>
            {ruleFormError ? (
              <p className="form-error" role="alert">
                {ruleFormError}
              </p>
            ) : null}
            <div className="button-row">
              <button className="primary-button" type="submit">
                {editingRule ? 'Enregistrer la règle' : 'Ajouter la règle'}
              </button>
              {editingRule ? (
                <button type="button" onClick={resetRule}>
                  Annuler
                </button>
              ) : null}
            </div>
          </form>
          <div className="rule-list">
            {draft.rules.length ? (
              draft.rules.map((rule) => (
                <article className="rule-card" key={rule.id}>
                  <div>
                    <strong>{rule.office}</strong>
                    <span>
                      {rule.cancelled ? 'Annulé' : (rule.time ?? '—')} ·{' '}
                      {rule.validFrom
                        ? `${rule.validFrom} → ${rule.validTo}`
                        : rule.weekdays?.length
                          ? rule.weekdays.map((day) => weekdays[day]).join(', ')
                          : 'Base'}
                    </span>
                    <small>
                      {rule.status === 'confirmed' ? 'Confirmé' : 'À confirmer'} · priorité{' '}
                      {rule.priority}
                    </small>
                  </div>
                  <div className="button-row">
                    <button type="button" onClick={() => editRule(rule)}>
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          rules: current.rules.filter((item) => item.id !== rule.id),
                        }))
                      }
                    >
                      Supprimer
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p className="empty-state">Aucune règle enregistrée.</p>
            )}
          </div>
        </article>
        <article className="admin-card">
          <h2>Exception · cette date seulement</h2>
          <form className="admin-form" onSubmit={saveException}>
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
                {offices.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            {!exceptionCancelled ? (
              <label>
                Heure
                <input
                  type="time"
                  value={exceptionTime}
                  onChange={(event) => setExceptionTime(event.target.value)}
                  required
                />
              </label>
            ) : null}
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={exceptionCancelled}
                onChange={(event) => setExceptionCancelled(event.target.checked)}
              />
              Annuler cet office
            </label>
            <button className="primary-button" type="submit">
              Enregistrer l’exception
            </button>
          </form>
          <p className="form-note">Une exception ne modifie que l’office et la date choisis.</p>
          <h3>Exceptions enregistrées</h3>
          {draft.exceptions.length ? (
            draft.exceptions.map((item) => (
              <div className="exception-line" key={`${item.date}-${item.office}`}>
                <span>
                  <strong>{item.date}</strong> · {item.office} ·{' '}
                  {item.cancelled ? 'Annulé' : item.time}
                </span>
                <div className="button-row">
                  <button type="button" onClick={() => editException(item)}>
                    Modifier
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        exceptions: current.exceptions.filter(
                          (entry) => entry.date !== item.date || entry.office !== item.office,
                        ),
                      }))
                    }
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-state">Aucune exception enregistrée.</p>
          )}
        </article>
      </div>
      <article className="admin-card">
        <div className="card-heading-row">
          <div>
            <h2>Horaires résolus · 14 jours</h2>
            <p className="form-note">
              La règle gagnante et les conflits sont indiqués pour chaque office.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setRuleScope('period');
              setFrom(localDateOf(new Date()));
              setTo(addLocalDays(localDateOf(new Date()), 13));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            Créer pour une période
          </button>
        </div>
        <div className="resolved-table">
          {dates.map((date) => (
            <div className="resolved-day" key={date}>
              <div className="resolved-date">
                <strong>{dayLabel(date)}</strong>
                <button
                  type="button"
                  onClick={() => {
                    setExceptionDate(date);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Cette date seulement
                </button>
              </div>
              {offices.map((officeName) => {
                const result = resolveMinyan(
                  date,
                  officeName,
                  draft.rules,
                  draft.exceptions,
                  dayKindForDate(date, preview),
                );
                return (
                  <div className="resolved-office" key={officeName}>
                    <span>{officeName}</span>
                    <strong>{result.cancelled ? 'Annulé' : (result.time ?? '—')}</strong>
                    <small>
                      {result.source} · {result.status === 'confirmed' ? 'confirmé' : 'à confirmer'}
                    </small>
                    {result.conflicts.length ? (
                      <span className="conflict-warning">
                        Conflit :{' '}
                        {result.conflicts.flatMap((conflict) => conflict.ruleIds).join(', ')}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function ContentEditor({
  draft,
  setDraft,
  media,
}: {
  draft: AdminDraft;
  setDraft: (updater: (current: AdminDraft) => AdminDraft) => void;
  media: MediaAsset[];
}) {
  const [editing, setEditing] = useState<string>();
  const [type, setType] = useState<ContentItem['type']>('announcement');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [titleHe, setTitleHe] = useState('');
  const [startsOn, setStartsOn] = useState(localDateOf(new Date()));
  const [endsOn, setEndsOn] = useState(addLocalDays(localDateOf(new Date()), 30));
  const [weekdaysSelected, setWeekdaysSelected] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [priority, setPriority] = useState(20);
  const [shabbatVisibility, setShabbatVisibility] = useState<'show' | 'hide'>('hide');
  const [commercial, setCommercial] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [durationSec, setDurationSec] = useState(20);
  const [status, setStatus] = useState<AdminContentItem['status']>('draft');
  const [selectedMedia, setSelectedMedia] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const activeMedia = media.filter((item) => item.status === 'ready');

  function resetForm() {
    setEditing(undefined);
    setType('announcement');
    setTitle('');
    setBody('');
    setTitleHe('');
    setQrUrl('');
    setSelectedMedia([]);
    setFormError('');
    setStatus('draft');
  }

  function populate(item: AdminContentItem) {
    setEditing(item.id);
    setType(item.type);
    setTitle(item.title);
    setBody(item.body ?? '');
    setTitleHe(item.titleHe ?? '');
    setStartsOn(item.startsAt?.slice(0, 10) ?? '');
    setEndsOn(item.endsAt?.slice(0, 10) ?? '');
    setWeekdaysSelected(item.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
    setTimeFrom(item.timeWindows?.[0]?.from ?? '');
    setTimeTo(item.timeWindows?.[0]?.to ?? '');
    setPriority(item.priority);
    setShabbatVisibility(item.shabbatVisibility);
    setCommercial(item.isCommercial);
    setQrUrl(item.qrUrl ?? '');
    setDurationSec(item.durationSec);
    setStatus(item.status);
    setSelectedMedia(item.mediaIds);
  }

  function submitContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    if (startsOn && endsOn && startsOn > endsOn) {
      setFormError('La date de fin doit être égale ou postérieure à la date de début.');
      return;
    }
    if (type === 'qr') {
      try {
        if (new URL(qrUrl).protocol !== 'https:') throw new Error('https');
      } catch {
        setFormError('Le lien QR doit être une URL complète commençant par https://.');
        return;
      }
    }
    if (timeFrom && timeTo && timeFrom >= timeTo) {
      setFormError('La fin du créneau horaire doit être postérieure au début.');
      return;
    }
    const item: AdminContentItem = {
      id: editing ?? crypto.randomUUID(),
      type,
      title: title.trim(),
      ...(body.trim() ? { body: body.trim() } : {}),
      ...(titleHe.trim() ? { titleHe: titleHe.trim() } : {}),
      mediaIds: selectedMedia,
      ...(type === 'qr' ? { qrUrl } : {}),
      ...(startsOn ? { startsAt: instantFromLocal(startsOn, '00:00').toISOString() } : {}),
      ...(endsOn ? { endsAt: instantFromLocal(endsOn, '23:59').toISOString() } : {}),
      ...(weekdaysSelected.length < 7 ? { weekdays: weekdaysSelected } : {}),
      ...(timeFrom && timeTo ? { timeWindows: [{ from: timeFrom, to: timeTo }] } : {}),
      shabbatVisibility: commercial ? 'hide' : shabbatVisibility,
      isCommercial: commercial,
      priority,
      durationSec,
      status,
    };
    setDraft((current) => ({
      ...current,
      content: editing
        ? current.content.map((existing) => (existing.id === editing ? item : existing))
        : [item, ...current.content],
    }));
    resetForm();
  }

  return (
    <section className="admin-page">
      <div className="page-intro">
        <p>Annonces, cours, événements, souvenirs et médias.</p>
        <span>
          Les sponsors commerciaux sont automatiquement masqués pendant Chabbat et Yom Tov.
        </span>
      </div>
      <div className="admin-grid-two content-editor-grid">
        <article className="admin-card">
          <h2>{editing ? 'Modifier un contenu' : 'Ajouter un contenu'}</h2>
          <form className="admin-form" onSubmit={submitContent}>
            <label>
              Type
              <select
                value={type}
                onChange={(event) => setType(event.target.value as ContentItem['type'])}
              >
                {contentTypes.map((item) => (
                  <option value={item.value} key={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Titre
              <input required value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Texte
              <textarea rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
            <label>
              Texte hébreu (facultatif)
              <input
                dir="rtl"
                value={titleHe}
                onChange={(event) => setTitleHe(event.target.value)}
              />
            </label>
            <div className="form-row">
              <label>
                Du
                <input
                  type="date"
                  value={startsOn}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </label>
              <label>
                Au
                <input
                  type="date"
                  value={endsOn}
                  onChange={(event) => setEndsOn(event.target.value)}
                />
              </label>
            </div>
            <fieldset className="weekday-fieldset">
              <legend>Jours de diffusion</legend>
              <div className="weekday-choices">
                {weekdays.map((label, index) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={weekdaysSelected.includes(index)}
                      onChange={(event) =>
                        setWeekdaysSelected((current) =>
                          event.target.checked
                            ? [...current, index].sort()
                            : current.filter((day) => day !== index),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-row">
              <label>
                De
                <input
                  type="time"
                  value={timeFrom}
                  onChange={(event) => setTimeFrom(event.target.value)}
                />
              </label>
              <label>
                À
                <input
                  type="time"
                  value={timeTo}
                  onChange={(event) => setTimeTo(event.target.value)}
                />
              </label>
            </div>
            <label>
              Priorité
              <input
                type="number"
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value))}
              />
            </label>
            <label>
              Visibilité Chabbat / Yom Tov
              <select
                value={commercial ? 'hide' : shabbatVisibility}
                onChange={(event) => setShabbatVisibility(event.target.value as 'show' | 'hide')}
              >
                <option value="show">Visible</option>
                <option value="hide">Masqué</option>
              </select>
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={commercial}
                onChange={(event) => setCommercial(event.target.checked)}
              />
              Contenu commercial
            </label>
            {commercial ? (
              <p className="form-note sponsor-explanation">
                Le masquage des sponsors commerciaux pendant Chabbat / Yom Tov est automatique.
              </p>
            ) : null}
            {type === 'qr' ? (
              <label>
                URL du QR (HTTPS uniquement)
                <input
                  type="url"
                  value={qrUrl}
                  onChange={(event) => setQrUrl(event.target.value)}
                  placeholder="https://…"
                  required
                />
              </label>
            ) : null}
            <label>
              Médias
              <select
                multiple
                value={selectedMedia}
                onChange={(event) =>
                  setSelectedMedia(
                    Array.from(event.target.selectedOptions, (option) => option.value),
                  )
                }
              >
                {activeMedia.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.original_name_label} · {item.kind}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                Durée en playlist (s)
                <input
                  type="number"
                  min="5"
                  max="300"
                  value={durationSec}
                  onChange={(event) => setDurationSec(Number(event.target.value))}
                />
              </label>
              <label>
                Statut
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as AdminContentItem['status'])}
                >
                  <option value="draft">Brouillon</option>
                  <option value="ready">Prêt</option>
                  <option value="archived">Archivé</option>
                </select>
              </label>
            </div>
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="button-row">
              <button className="primary-button" type="submit">
                {editing ? 'Enregistrer le contenu' : 'Ajouter à la liste'}
              </button>
              {editing ? (
                <button type="button" onClick={resetForm}>
                  Annuler
                </button>
              ) : null}
            </div>
          </form>
        </article>
        <article className="admin-card">
          <h2>Contenus enregistrés</h2>
          {draft.content.length ? (
            <div className="content-list">
              {draft.content.map((item) => (
                <article key={item.id} className="content-list-item">
                  <div>
                    <span className="content-type-tag">
                      {contentTypes.find(({ value }) => value === item.type)?.label} · {item.status}
                    </span>
                    <h3>{item.title}</h3>
                    {item.body ? <p>{item.body}</p> : null}
                    <small>
                      {item.startsAt?.slice(0, 10) ?? 'Sans début'} →{' '}
                      {item.endsAt?.slice(0, 10) ?? 'Sans fin'} · priorité {item.priority} ·{' '}
                      {item.durationSec} s
                    </small>
                  </div>
                  <div className="button-row">
                    <button type="button" onClick={() => populate(item)}>
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          content: [
                            {
                              ...item,
                              id: crypto.randomUUID(),
                              title: `${item.title} (copie)`,
                              status: 'draft',
                            },
                            ...current.content,
                          ],
                        }))
                      }
                    >
                      Dupliquer
                    </button>
                    {item.status !== 'archived' ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            content: current.content.map((entry) =>
                              entry.id === item.id ? { ...entry, status: 'archived' } : entry,
                            ),
                          }))
                        }
                      >
                        Archiver
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">Aucun contenu. Créez une annonce ou un événement.</p>
          )}
        </article>
      </div>
    </section>
  );
}

function ScreenEditor({
  draft,
  setDraft,
  preview,
  mediaUrls,
  isDemo,
  previewDate,
  previewTime,
  previewSize,
  onDateChange,
  onTimeChange,
  onSizeChange,
  onPreview,
  onPublish,
}: {
  draft: AdminDraft;
  setDraft: (updater: (current: AdminDraft) => AdminDraft) => void;
  preview?: PublishedPackage | undefined;
  mediaUrls: Record<string, string>;
  isDemo: boolean;
  previewDate: string;
  previewTime: string;
  previewSize: 'mobile' | 'desktop';
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onSizeChange: (value: 'mobile' | 'desktop') => void;
  onPreview: () => void;
  onPublish: () => void;
}) {
  function moveSlide(index: number, direction: -1 | 1) {
    const slides = [...draft.layout.slides];
    const next = index + direction;
    if (next < 0 || next >= slides.length) return;
    [slides[index], slides[next]] = [slides[next], slides[index]];
    setDraft((current) => ({ ...current, layout: { ...current.layout, slides } }));
  }
  const presets: Array<[string, string, string]> = [
    ['Semaine', localDateOf(new Date()), '10:00'],
    [
      'Vendredi après-midi',
      addLocalDays(localDateOf(new Date()), (5 - new Date().getDay() + 7) % 7),
      '15:00',
    ],
    ['Chabbat', addLocalDays(localDateOf(new Date()), (6 - new Date().getDay() + 7) % 7), '12:00'],
    ['Yom Tov', localDateOf(new Date()), '10:00'],
  ];
  return (
    <section className="admin-page screen-page">
      <div className="page-intro">
        <p>Réglez les zones, les diapositives et la durée de rotation.</p>
        <span>La prévisualisation passe par la compilation du serveur en mode Supabase.</span>
      </div>
      <div className="admin-grid-two">
        <article className="admin-card">
          <h2>Mode et zones</h2>
          <div className="mode-choice">
            <button
              className={draft.layout.mode === 'fixed' ? 'selected' : ''}
              type="button"
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
              className={draft.layout.mode === 'playlist' ? 'selected' : ''}
              type="button"
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
          <div className="zone-switches">
            {[
              ['weather', 'Météo'],
              ['study', 'Étude'],
              ['sponsor', 'Sponsor'],
            ].map(([key, label]) => (
              <label className="checkbox-line" key={key}>
                <input
                  type="checkbox"
                  checked={draft.layout.zones[key] !== false}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      layout: {
                        ...current.layout,
                        zones: { ...current.layout.zones, [key]: event.target.checked },
                      },
                    }))
                  }
                />
                Zone {label}
              </label>
            ))}
          </div>
          <h3>Ordre et durée des diapositives</h3>
          <div className="slide-list">
            {draft.layout.slides.map((slide, index) => (
              <div className="slide-line" key={slide.id}>
                <strong>{slideTitle(slide.kind)}</strong>
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
                {slide.kind === 'content' ? (
                  <label>
                    Contenus diffusés
                    <select
                      multiple
                      aria-label={`Contenus · diapositive ${index + 1}`}
                      value={slide.contentIds ?? []}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          layout: {
                            ...current.layout,
                            slides: current.layout.slides.map((item) =>
                              item.id === slide.id
                                ? {
                                    ...item,
                                    contentIds: Array.from(
                                      event.target.selectedOptions,
                                      (option) => option.value,
                                    ),
                                  }
                                : item,
                            ),
                          },
                        }))
                      }
                    >
                      {draft.content
                        .filter((item) => item.status === 'ready')
                        .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.title}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
                <button
                  aria-label={`Monter ${slideTitle(slide.kind)}`}
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveSlide(index, -1)}
                >
                  ↑
                </button>
                <button
                  aria-label={`Descendre ${slideTitle(slide.kind)}`}
                  type="button"
                  disabled={index === draft.layout.slides.length - 1}
                  onClick={() => moveSlide(index, 1)}
                >
                  ↓
                </button>
                <button
                  aria-label={`Supprimer ${slideTitle(slide.kind)}`}
                  type="button"
                  disabled={draft.layout.slides.length === 1}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      layout: {
                        ...current.layout,
                        slides: current.layout.slides.filter((item) => item.id !== slide.id),
                      },
                    }))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="button-row">
            {(['schedule', 'shabbat', 'content', 'study', 'media', 'qr'] as const).map((kind) => (
              <button
                type="button"
                key={kind}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    layout: {
                      ...current.layout,
                      slides: [
                        ...current.layout.slides,
                        {
                          id: crypto.randomUUID(),
                          kind,
                          durationSec: 30,
                          ...(kind === 'content'
                            ? {
                                contentIds: current.content
                                  .filter((item) => item.status === 'ready')
                                  .map((item) => item.id),
                              }
                            : {}),
                        },
                      ],
                    },
                  }))
                }
              >
                + {slideTitle(kind)}
              </button>
            ))}
          </div>
          <label className="admin-form">
            Bandeau d’information
            <textarea
              rows={2}
              value={draft.layout.banner?.text ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  layout: {
                    ...current.layout,
                    banner: {
                      text: event.target.value,
                      enabled: Boolean(event.target.value.trim()),
                    },
                  },
                }))
              }
            />
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={draft.layout.banner?.enabled ?? false}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  layout: {
                    ...current.layout,
                    banner: {
                      text: current.layout.banner?.text ?? '',
                      enabled: event.target.checked,
                    },
                  },
                }))
              }
            />
            Afficher le bandeau
          </label>
        </article>
        <article className="admin-card preview-controls">
          <h2>Aperçu fidèle</h2>
          <div className="preset-list">
            {presets.map(([label, date, time]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  onDateChange(date);
                  onTimeChange(time);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="preview-date-fields">
            <label>
              Date et heure libres
              <input
                type="date"
                value={previewDate}
                onChange={(event) => onDateChange(event.target.value)}
              />
            </label>
            <label>
              Heure
              <input
                type="time"
                value={previewTime}
                onChange={(event) => onTimeChange(event.target.value)}
              />
            </label>
          </div>
          <div className="mode-choice">
            <button
              className={previewSize === 'desktop' ? 'selected' : ''}
              type="button"
              onClick={() => onSizeChange('desktop')}
            >
              Bureau
            </button>
            <button
              className={previewSize === 'mobile' ? 'selected' : ''}
              type="button"
              onClick={() => onSizeChange('mobile')}
            >
              Téléphone
            </button>
          </div>
          <button className="primary-button" type="button" onClick={onPreview}>
            Actualiser l’aperçu
          </button>
          <div className={`preview-frame ${previewSize === 'mobile' ? 'preview-mobile' : ''}`}>
            <div className="draft-ribbon">BROUILLON</div>
            {preview ? (
              <Display
                packageData={preview}
                mediaUrls={mediaUrls}
                previewInstant={previewInstant(previewDate, previewTime)}
                previewMode
              />
            ) : (
              <p className="empty-state">Actualisez l’aperçu pour compiler le brouillon.</p>
            )}
          </div>
          <div className="admin-actions">
            <button className="publish-button" type="button" disabled={isDemo} onClick={onPublish}>
              Publier
            </button>
            {isDemo ? (
              <span className="form-note">Publication désactivée en démonstration.</span>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}

function History({
  isDemo,
  versions,
  preview,
  mediaUrls,
  onPreview,
  onRestore,
  client,
}: {
  isDemo: boolean;
  versions: Version[];
  preview?: PublishedPackage | undefined;
  mediaUrls: Record<string, string>;
  onPreview: (version: Version) => void;
  onRestore: (version: Version) => void;
  client: typeof supabase;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [tableFilter, setTableFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let active = true;
    async function loadEvents() {
      if (isDemo || !client) return;
      setLoading(true);
      setLoadError('');
      let query = client
        .from('audit_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (tableFilter) query = query.eq('table_name', tableFilter);
      if (dateFilter) {
        query = query
          .gte('created_at', `${dateFilter}T00:00:00`)
          .lte('created_at', `${dateFilter}T23:59:59`);
      }
      const { data, error: queryError } = await query;
      if (!active) return;
      if (queryError) setLoadError('Impossible de charger le journal d’audit.');
      else setEvents((data ?? []) as AuditEvent[]);
      setLoading(false);
    }
    void loadEvents();
    return () => {
      active = false;
    };
  }, [client, dateFilter, isDemo, tableFilter]);
  return (
    <section className="admin-page">
      <div className="admin-grid-two">
        <article className="admin-card">
          <h2>Versions publiées</h2>
          {versions.length ? (
            versions.map((version) => (
              <article className="version-row" key={version.id}>
                <div>
                  <strong>Version {version.version_number}</strong>
                  <small>
                    {timeSince(version.created_at)} · {version.source} ·{' '}
                    {version.created_by ?? 'Système'}
                  </small>
                  {version.restored_from ? (
                    <small>Restaurée depuis {version.restored_from}</small>
                  ) : null}
                </div>
                <div className="button-row">
                  <button type="button" onClick={() => onPreview(version)}>
                    Aperçu
                  </button>
                  <button type="button" disabled={isDemo} onClick={() => onRestore(version)}>
                    Restaurer
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="empty-state">Aucune version publiée.</p>
          )}
          {isDemo ? <p className="form-note">L’historique réel nécessite Supabase.</p> : null}
        </article>
        <article className="admin-card">
          <h2>Aperçu de la version sélectionnée</h2>
          <div className="preview-frame history-preview">
            {preview ? (
              <Display packageData={preview} mediaUrls={mediaUrls} previewMode />
            ) : (
              <p className="empty-state">Choisissez une version pour la prévisualiser.</p>
            )}
          </div>
        </article>
      </div>
      <article className="admin-card">
        <h2>Journal d’audit</h2>
        <div className="filter-row">
          <label>
            Table
            <select value={tableFilter} onChange={(event) => setTableFilter(event.target.value)}>
              <option value="">Toutes</option>
              {[
                'settings',
                'minyan_rules',
                'minyan_exceptions',
                'content_items',
                'layout_draft',
                'media_assets',
                'devices',
                'source_records',
              ].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
            />
          </label>
        </div>
        {isDemo ? (
          <p className="empty-state">Le journal d’audit nécessite Supabase.</p>
        ) : loading ? (
          <p role="status">Chargement du journal…</p>
        ) : loadError ? (
          <p className="form-error" role="alert">
            {loadError}
          </p>
        ) : events.length ? (
          events.map((event) => (
            <details className="audit-row" key={event.id}>
              <summary>
                {timeSince(event.created_at)} · {event.table_name} · {event.action} ·{' '}
                {event.actor_id ?? 'Système'}
              </summary>
              <div className="audit-data">
                <div>
                  <strong>Avant</strong>
                  <pre>{JSON.stringify(event.before_data, null, 2) ?? '—'}</pre>
                </div>
                <div>
                  <strong>Après</strong>
                  <pre>{JSON.stringify(event.after_data, null, 2) ?? '—'}</pre>
                </div>
              </div>
            </details>
          ))
        ) : (
          <p className="empty-state">Aucun événement d’audit pour ces filtres.</p>
        )}
      </article>
    </section>
  );
}

function Devices({
  isDemo,
  client,
  devices,
  publicState,
  onRefresh,
  onToast,
}: {
  isDemo: boolean;
  client: typeof supabase;
  devices: Device[];
  publicState: Workspace['publicState'];
  onRefresh: () => Promise<void>;
  onToast: (value: string) => void;
}) {
  const [deviceName, setDeviceName] = useState('TV salle principale');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string }>();
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [editing, setEditing] = useState<string>();
  const [rename, setRename] = useState('');
  useEffect(() => {
    if (!pairing) return;
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);
  async function createPairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isDemo || !client) return;
    try {
      const result = await invokeAdmin<{ code: string; expiresAt: string }>(
        client,
        'createPairingCode',
        { deviceName },
      );
      setPairing(result);
      onToast('Code de connexion TV créé. Il expire dans dix minutes.');
    } catch (error) {
      onToast(adminErrorMessage(error));
    }
  }
  async function saveRename(id: string) {
    if (!client) return;
    const { error } = await client
      .from('devices')
      .update({ device_name: rename.trim() })
      .eq('id', id);
    if (error) onToast('Impossible de renommer cet appareil.');
    else {
      setEditing(undefined);
      await onRefresh();
      onToast('Nom de l’appareil enregistré.');
    }
  }
  async function revoke(device: Device) {
    if (!client || !window.confirm(`Révoquer l’accès de « ${device.device_name} » ?`)) return;
    try {
      await invokeAdmin(client, 'revokeDevice', { id: device.id });
      await onRefresh();
      onToast('Appareil révoqué.');
    } catch (error) {
      onToast(adminErrorMessage(error));
    }
  }
  return (
    <section className="admin-page">
      <article className="admin-card">
        <h2>Connecter une télévision</h2>
        <form className="inline-form" onSubmit={createPairing}>
          <label>
            Nom de l’appareil
            <input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={isDemo}>
            Créer un code TV
          </button>
        </form>
        {pairing && secondsLeft > 0 ? (
          <div className="pairing-code-card">
            <span>Code à saisir sur la TV</span>
            <strong aria-label={`Code de jumelage ${pairing.code}`}>{pairing.code}</strong>
            <small>
              Expiration dans {Math.floor(secondsLeft / 60)} min {secondsLeft % 60} s
            </small>
          </div>
        ) : null}
        {isDemo ? (
          <p className="form-note">La connexion TV nécessite le backend Supabase.</p>
        ) : null}
      </article>
      <article className="admin-card">
        <h2>
          Appareils enregistrés · version courante {publicState?.current_version_number ?? '—'}
        </h2>
        {devices.length ? (
          devices.map((device) => (
            <article className="device-row" key={device.id}>
              <div className="device-row-title">
                <span
                  className={
                    !device.revoked_at &&
                    device.last_seen &&
                    Date.now() - Date.parse(device.last_seen) < 60_000
                      ? 'device-dot online'
                      : 'device-dot'
                  }
                />
                <div>
                  {editing === device.id ? (
                    <input
                      aria-label="Nom de l’appareil"
                      value={rename}
                      onChange={(event) => setRename(event.target.value)}
                    />
                  ) : (
                    <strong>{device.device_name}</strong>
                  )}
                  <small>
                    {device.revoked_at
                      ? 'Révoqué'
                      : device.last_seen
                        ? `Dernière vue · ${timeSince(device.last_seen)}`
                        : 'Jamais connecté'}
                  </small>
                  <small>
                    Version affichée {device.displayed_version ?? '—'} · cache{' '}
                    {device.cache_status ?? 'inconnu'} · décalage {device.clock_skew_seconds ?? '—'}{' '}
                    s · build {device.build ?? '—'}
                  </small>
                  {device.last_error_code ? (
                    <small className="form-error">{device.last_error_code}</small>
                  ) : null}
                </div>
              </div>
              <div className="button-row">
                {editing === device.id ? (
                  <>
                    <button type="button" onClick={() => void saveRename(device.id)}>
                      Enregistrer
                    </button>
                    <button type="button" onClick={() => setEditing(undefined)}>
                      Annuler
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(device.id);
                      setRename(device.device_name);
                    }}
                  >
                    Renommer
                  </button>
                )}
                {!device.revoked_at ? (
                  <button type="button" disabled={isDemo} onClick={() => void revoke(device)}>
                    Révoquer
                  </button>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <p className="empty-state">Aucun appareil connecté.</p>
        )}
      </article>
    </section>
  );
}

function Sources({
  isDemo,
  client,
  health,
  userId,
  onRefresh,
  onRefreshData,
  onToast,
}: {
  isDemo: boolean;
  client: typeof supabase;
  health: SourceHealth[];
  userId: string;
  onRefresh: () => Promise<void>;
  onRefreshData: () => Promise<void>;
  onToast: (value: string) => void;
}) {
  const [date, setDate] = useState(localDateOf(new Date()));
  const [provider, setProvider] = useState('');
  const [records, setRecords] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SourceRecord>();
  const [overrideValue, setOverrideValue] = useState('');
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState(addLocalDays(localDateOf(new Date()), 30));
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let active = true;
    async function loadRecords() {
      if (isDemo || !client) return;
      setLoading(true);
      let query = client
        .from('source_records')
        .select('*')
        .eq('local_date', date)
        .order('provider')
        .limit(200);
      if (provider) query = query.eq('provider', provider);
      const { data, error } = await query;
      if (!active) return;
      if (error) setLoadError('Impossible de charger les valeurs sources.');
      else {
        setRecords((data ?? []) as SourceRecord[]);
        setLoadError('');
      }
      setLoading(false);
    }
    void loadRecords();
    return () => {
      active = false;
    };
  }, [client, date, isDemo, provider]);
  async function saveOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !client) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(overrideValue);
    } catch {
      parsed = overrideValue;
    }
    const { error } = await client
      .from('source_records')
      .update({
        override_value: parsed,
        override_reason: reason.trim(),
        override_by: userId,
        override_expires_at: instantFromLocal(expires, '23:59').toISOString(),
      })
      .eq('id', selected.id);
    if (error) onToast('Impossible d’enregistrer cette correction.');
    else {
      setSelected(undefined);
      setOverrideValue('');
      setReason('');
      await onRefresh();
      onToast('Correction temporaire enregistrée. La valeur source originale reste conservée.');
    }
  }
  return (
    <section className="admin-page">
      <article className="admin-card">
        <div className="card-heading-row">
          <div>
            <h2>Santé des sources</h2>
            <p className="form-note">
              La date du dernier succès et l’état d’erreur restent visibles.
            </p>
          </div>
          <button type="button" disabled={isDemo} onClick={() => void onRefreshData()}>
            Actualiser maintenant
          </button>
        </div>
        <div className="source-health-grid">
          {health.length ? (
            health.map((item) => (
              <div className="source-health-card" key={item.source}>
                <strong>{item.source === 'hebcal' ? 'Hebcal' : item.source.toUpperCase()}</strong>
                <span>
                  {item.last_error_code ? `Erreur · ${item.last_error_code}` : 'Disponible'}
                </span>
                <small>Dernier succès · {timeSince(item.last_success_at)}</small>
                <small>Dernier échec · {timeSince(item.last_failure_at)}</small>
                {item.data_age_seconds !== null ? (
                  <small>Âge des données · {Math.floor(item.data_age_seconds / 3600)} h</small>
                ) : null}
              </div>
            ))
          ) : (
            <p className="empty-state">Aucun état de source disponible.</p>
          )}
        </div>
        {isDemo ? (
          <p className="form-note">
            Actualisation et sources réelles désactivées en mode démonstration.
          </p>
        ) : null}
      </article>
      <article className="admin-card">
        <h2>Valeurs originales et provenance</h2>
        <div className="filter-row">
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Fournisseur
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="">Tous</option>
              <option value="hebcal">Hebcal</option>
              <option value="met">MET Norway</option>
            </select>
          </label>
        </div>
        {isDemo ? (
          <p className="empty-state">Les relevés sources détaillés nécessitent Supabase.</p>
        ) : loading ? (
          <p role="status">Chargement des valeurs…</p>
        ) : loadError ? (
          <p className="form-error" role="alert">
            {loadError}
          </p>
        ) : records.length ? (
          records.map((record) => (
            <details className="source-record-row" key={record.id}>
              <summary>
                {record.provider} · {record.kind} · {record.local_date ?? '—'} · {record.status}
              </summary>
              <p>Valeur originale</p>
              <pre>{JSON.stringify(record.value, null, 2)}</pre>
              {record.override_value !== null ? (
                <p>
                  Correction active · {record.override_reason ?? 'motif non renseigné'} · expire{' '}
                  {timeSince(record.override_expires_at)}
                </p>
              ) : null}
              <p>
                Provenance · {JSON.stringify(record.method)} · récupéré{' '}
                {timeSince(record.fetched_at)}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelected(record);
                  setOverrideValue(JSON.stringify(record.override_value ?? record.value, null, 2));
                }}
              >
                Créer une correction
              </button>
            </details>
          ))
        ) : (
          <p className="empty-state">Aucune valeur pour cette date.</p>
        )}
      </article>
      {selected ? (
        <div className="modal-backdrop">
          <section
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="override-title"
          >
            <h2 id="override-title">Correction temporaire</h2>
            <p>La valeur originale reste enregistrée et consultable.</p>
            <form className="admin-form" onSubmit={(event) => void saveOverride(event)}>
              <label>
                Valeur de remplacement
                <textarea
                  rows={5}
                  value={overrideValue}
                  onChange={(event) => setOverrideValue(event.target.value)}
                  required
                />
              </label>
              <label>
                Motif
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                />
              </label>
              <label>
                Expire le
                <input
                  type="date"
                  value={expires}
                  onChange={(event) => setExpires(event.target.value)}
                  required
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setSelected(undefined)}>
                  Annuler
                </button>
                <button className="primary-button" type="submit">
                  Enregistrer
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function SettingsPanel({
  settings,
  setSettings,
  isDemo,
  client,
  userId,
  media,
  onToast,
  onSignOut,
}: {
  settings: Settings;
  setSettings: (updater: (current: Settings) => Settings) => void;
  isDemo: boolean;
  client: typeof supabase;
  userId: string;
  media: MediaAsset[];
  onToast: (value: string) => void;
  onSignOut: () => void;
}) {
  const [responsibleName, setResponsibleName] = useState('');
  const [approvalDate, setApprovalDate] = useState(localDateOf(new Date()));
  const [confirmApproval, setConfirmApproval] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [approvalError, setApprovalError] = useState('');
  async function approveMethods(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApprovalError('');
    if (!responsibleName.trim() || !confirmApproval) {
      setApprovalError('Saisissez le nom du responsable et confirmez son approbation.');
      return;
    }
    if (isDemo || !client) {
      setApprovalError('L’approbation officielle nécessite Supabase.');
      return;
    }
    const updated: Settings = {
      ...settings,
      religious_method_status: 'approved',
      religious_method_params: {
        ...settings.religious_method_params,
        approvedResponsibleName: responsibleName.trim(),
        approvedDate: approvalDate,
      },
      approved_by: userId,
      approved_at: instantFromLocal(approvalDate, '12:00').toISOString(),
    };
    const { error } = await client.from('settings').upsert(updated, { onConflict: 'id' });
    if (error) setApprovalError('L’enregistrement de l’approbation a échoué.');
    else {
      setSettings(() => updated);
      onToast(
        'Approbation religieuse enregistrée. La mention en attente disparaîtra après actualisation de l’aperçu.',
      );
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    if (password.length < 12 || password !== passwordAgain) {
      onToast(
        'Le mot de passe doit contenir au moins 12 caractères et les deux champs doivent correspondre.',
      );
      return;
    }
    const { error } = await client.auth.updateUser({ password });
    if (error) onToast('Le changement de mot de passe a échoué.');
    else {
      setPassword('');
      setPasswordAgain('');
      onToast('Mot de passe modifié.');
    }
  }
  async function exportData() {
    if (isDemo || !client) return;
    try {
      const data = await invokeAdmin<unknown>(client, 'export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `beth-menahem-export-${localDateOf(new Date())}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onToast(adminErrorMessage(error));
    }
  }
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }
  const readyMedia = media.filter((item) => item.status === 'ready');
  return (
    <section className="admin-page">
      <article className="admin-card">
        <h2>Identité de la synagogue</h2>
        <div className="admin-form">
          <label>
            Nom affiché
            <input
              value={settings.site_name}
              onChange={(event) => update('site_name', event.target.value)}
            />
          </label>
          <label>
            Adresse
            <input
              value={settings.site_address}
              onChange={(event) => update('site_address', event.target.value)}
            />
          </label>
          <label>
            Logo
            <select
              value={settings.logo_media_id ?? ''}
              onChange={(event) => update('logo_media_id', event.target.value || null)}
            >
              <option value="">Aucun logo · afficher le nom en texte</option>
              {readyMedia
                .filter((item) => item.mime.startsWith('image/'))
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.original_name_label}
                  </option>
                ))}
            </select>
          </label>
          <p className="form-note">
            {settings.logo_media_id
              ? 'Le logo sera affiché à côté du nom.'
              : 'Sans logo, le nom de la synagogue reste affiché en texte.'}
          </p>
        </div>
      </article>
      <article className="admin-card">
        <h2>Réglages d’affichage et de calendrier</h2>
        <div className="admin-form">
          <div className="form-row">
            <label>
              Marge sponsor avant (minutes)
              <input
                type="number"
                min="0"
                value={settings.sponsor_margin_before_min}
                onChange={(event) =>
                  update('sponsor_margin_before_min', Number(event.target.value))
                }
              />
            </label>
            <label>
              Marge après (minutes)
              <input
                type="number"
                min="0"
                value={settings.sponsor_margin_after_min}
                onChange={(event) => update('sponsor_margin_after_min', Number(event.target.value))}
              />
            </label>
          </div>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={settings.hide_commercial_on_chol_hamoed}
              onChange={(event) => update('hide_commercial_on_chol_hamoed', event.target.checked)}
            />
            Masquer les contenus commerciaux pendant Hol Hamoed
          </label>
          <label>
            Cycle Rambam
            <select
              value={settings.rambam_cycle}
              onChange={(event) =>
                update('rambam_cycle', event.target.value as Settings['rambam_cycle'])
              }
            >
              <option value="dr1">Un chapitre par jour (dr1)</option>
              <option value="dr3">Trois chapitres par jour (dr3)</option>
            </select>
          </label>
        </div>
      </article>
      <article className="admin-card">
        <h2>Méthodes religieuses</h2>
        <p className="form-note">
          Paramètres actuellement appliqués · fuseau Europe/Paris · latitude 48,8885 · longitude
          2,3821 · allumage 18 min avant le coucher du soleil.
        </p>
        <p
          className={
            settings.religious_method_status === 'approved' ? 'success-note' : 'dirty-note'
          }
        >
          {settings.religious_method_status === 'approved'
            ? 'Méthodes approuvées.'
            : 'En attente de validation religieuse · mention affichée à l’écran.'}
        </p>
        {settings.religious_method_status !== 'approved' ? (
          <form
            className="admin-form approval-form"
            onSubmit={(event) => void approveMethods(event)}
          >
            <label>
              Nom du responsable religieux
              <input
                required
                value={responsibleName}
                onChange={(event) => setResponsibleName(event.target.value)}
              />
            </label>
            <label>
              Date d’approbation
              <input
                type="date"
                required
                value={approvalDate}
                onChange={(event) => setApprovalDate(event.target.value)}
              />
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={confirmApproval}
                onChange={(event) => setConfirmApproval(event.target.checked)}
              />
              Je confirme que le responsable religieux a validé ces méthodes
            </label>
            {approvalError ? (
              <p className="form-error" role="alert">
                {approvalError}
              </p>
            ) : null}
            <button className="primary-button" type="submit" disabled={isDemo}>
              Enregistrer l’approbation
            </button>
          </form>
        ) : (
          <p className="form-note">
            Responsable · {String(settings.religious_method_params.approvedResponsibleName ?? '—')}{' '}
            · date{' '}
            {String(settings.religious_method_params.approvedDate ?? settings.approved_at ?? '—')}
          </p>
        )}
        {isDemo ? (
          <p className="form-note">
            L’approbation officielle est désactivée en mode démonstration.
          </p>
        ) : null}
      </article>
      <article className="admin-card">
        <h2>Compte et données</h2>
        <form className="admin-form" onSubmit={(event) => void changePassword(event)}>
          <label>
            Nouveau mot de passe
            <input
              type="password"
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Confirmer le mot de passe
            <input
              type="password"
              minLength={12}
              autoComplete="new-password"
              value={passwordAgain}
              onChange={(event) => setPasswordAgain(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={isDemo}>
            Changer le mot de passe
          </button>
        </form>
        <div className="button-row">
          <button type="button" disabled={isDemo} onClick={() => void exportData()}>
            Exporter les données JSON
          </button>
          <button type="button" onClick={onSignOut}>
            Déconnexion
          </button>
        </div>
        {isDemo ? (
          <p className="form-note">
            Export et changement de mot de passe disponibles avec Supabase.
          </p>
        ) : null}
      </article>
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
  const icons: Partial<Record<AdminView, string>> = {
    'Tableau de bord': '⌂',
    Horaires: '◷',
    Contenus: '✳',
    Médias: '▧',
    Écran: '▤',
  };
  return icons[view] ?? '•';
}
