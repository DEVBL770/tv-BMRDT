import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Display } from '../display/Display';
import type { PublishedPackage } from '../domain/package';
import { supabase } from '../lib/supabase';
import { createMediaObjectUrls, revokeMediaObjectUrls } from './media';
import { registerPlayerPwa } from './pwa';
import { PlayerScheduler } from './scheduler';
import { PlayerStore, requestStoragePersistence, type PlayerWeather } from './store';
import { PlayerSyncController, type SyncCallbacks, type SyncClient } from './sync';
import { downloadMedia, fetchPackage, fetchWeather, pairDevice, syncDevice } from './api';

const playerClient: SyncClient = {
  sync: syncDevice,
  package: fetchPackage,
  downloadMedia,
  weather: fetchWeather,
};

type DisplayState = {
  packageData: PublishedPackage;
  mediaUrls: Record<string, string>;
};

function formatClock(instant: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

function PairingPanel({
  code,
  deviceName,
  now,
  error,
  busy,
  fullScreen,
  onCodeChange,
  onNameChange,
  onSubmit,
}: {
  code: string;
  deviceName: string;
  now: Date;
  error: string | null;
  busy: boolean;
  fullScreen: boolean;
  onCodeChange(value: string): void;
  onNameChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  return (
    <form
      className={fullScreen ? 'pairing-screen' : 'pairing-overlay'}
      onSubmit={onSubmit}
      {...(!fullScreen
        ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Appairer la télévision' }
        : {})}
    >
      <div className="pairing-panel">
        <div className="pairing-brand">
          <div className="brand-name">Beth Menahem</div>
          <div className="brand-hebrew" lang="he" dir="rtl">
            <bdi dir="rtl">בית מנחם</bdi>
          </div>
        </div>
        <div className="pairing-clock" aria-label={`Il est ${formatClock(now)}`}>
          {formatClock(now)}
        </div>
        <h1>Connecter cette télévision</h1>
        <p>Entrez le code à usage unique fourni par l’administrateur.</p>
        <label>
          Nom de l’appareil
          <input
            autoComplete="off"
            maxLength={100}
            onChange={(event) => onNameChange(event.currentTarget.value)}
            required
            value={deviceName}
          />
        </label>
        <label>
          Code d’appairage
          <input
            autoComplete="one-time-code"
            autoCapitalize="characters"
            inputMode="text"
            maxLength={8}
            minLength={8}
            onChange={(event) =>
              onCodeChange(event.currentTarget.value.replace(/[^a-z0-9]/giu, '').toUpperCase())
            }
            pattern="[A-Z0-9]{8}"
            required
            value={code}
          />
        </label>
        {error ? (
          <p className="pairing-error" role="alert">
            {error}
          </p>
        ) : null}
        <button disabled={busy || code.length !== 8 || !deviceName.trim()} type="submit">
          {busy ? 'Connexion…' : 'Appairer'}
        </button>
      </div>
    </form>
  );
}

function ConfigurationError() {
  return (
    <div className="player-configuration-error">
      <div className="brand-name">Beth Menahem</div>
      <div className="brand-hebrew" lang="he" dir="rtl">
        <bdi dir="rtl">בית מנחם</bdi>
      </div>
      <p>Configuration du player indisponible.</p>
    </div>
  );
}

function LivePlayer() {
  const store = useMemo(() => new PlayerStore(), []);
  const scheduler = useMemo(() => new PlayerScheduler(), []);
  const [initialized, setInitialized] = useState(false);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState('TV salle principale');
  const [storagePersisted, setStoragePersisted] = useState(false);
  const [display, setDisplay] = useState<DisplayState | null>(null);
  const [weather, setWeather] = useState<PlayerWeather | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [statusNow, setStatusNow] = useState(() => Date.now());
  const [unauthorized, setUnauthorized] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const displayedVersion = useRef<number | null>(null);
  const periodsRef = useRef<PublishedPackage['religiousPeriods']>([]);
  const mediaUrls = useRef<Record<string, string>>({});
  const urlsToRevoke = useRef<Record<string, string>[]>([]);
  const clockOffsetRef = useRef(0);
  const lastClockTick = useRef(Date.now());
  const startedAt = useRef(Date.now());

  const installPackage = useCallback(
    async (packageData: PublishedPackage) => {
      const nextUrls = await createMediaObjectUrls(packageData, store);
      urlsToRevoke.current.push(mediaUrls.current);
      mediaUrls.current = nextUrls;
      displayedVersion.current = packageData.versionNumber;
      setDisplay({ packageData, mediaUrls: nextUrls });
    },
    [store],
  );

  useLayoutEffect(() => {
    const obsolete = urlsToRevoke.current.splice(0);
    for (const urls of obsolete) revokeMediaObjectUrls(urls);
  }, [display]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const persisted = await requestStoragePersistence();
      await store.setMeta('storagePersisted', persisted);
      const [token, savedName, current, syncedAt, savedWeather, offset] = await Promise.all([
        store.getMeta('deviceToken'),
        store.getMeta('deviceName'),
        store.getActiveVersion(),
        store.getMeta('lastSyncAt'),
        store.getMeta('lastWeather'),
        store.getMeta('serverOffsetMs'),
      ]);
      if (!active) return;
      setStoragePersisted(persisted);
      setDeviceToken(token);
      setDeviceName(savedName ?? 'TV salle principale');
      setLastSyncAt(syncedAt);
      setWeather(savedWeather);
      setClockOffsetMs(offset ?? 0);
      if (current) await installPackage(current.package);
      if (active) setInitialized(true);
    })().catch(() => {
      if (active) setInitialized(true);
    });
    return () => {
      active = false;
    };
  }, [installPackage, store]);

  useEffect(() => {
    clockOffsetRef.current = clockOffsetMs;
    setClockNow(new Date(Date.now() + clockOffsetMs));
  }, [clockOffsetMs]);

  periodsRef.current = display?.packageData.religiousPeriods ?? [];

  useEffect(() => registerPlayerPwa(scheduler, () => periodsRef.current), [scheduler]);

  useEffect(() => {
    const cancelClock = scheduler.every(() => {
      lastClockTick.current = Date.now();
      setClockNow(new Date(Date.now() + clockOffsetRef.current));
    }, 1000);
    const cancelWatchdog = scheduler.every(() => {
      if (Date.now() - lastClockTick.current > 60_000) window.location.reload();
    }, 30_000);
    const cancelStatus = scheduler.every(() => setStatusNow(Date.now()), 30_000);
    return () => {
      cancelClock();
      cancelWatchdog();
      cancelStatus();
    };
  }, [scheduler]);

  const callbacks = useMemo<SyncCallbacks>(
    () => ({
      getDisplayedVersion: () => displayedVersion.current,
      getCacheStatus: () => {
        const cache = displayedVersion.current === null ? 'empty' : 'ready';
        return `${cache}_${storagePersisted ? 'persistent' : 'volatile'}`;
      },
      onPackage: (packageData) => {
        void installPackage(packageData).catch(() => undefined);
      },
      onSyncSuccess: (at) => {
        setLastSyncAt(at);
      },
      onClockOffset: setClockOffsetMs,
      onWeather: setWeather,
      onUnauthorized: () => {
        setDeviceToken(null);
        setUnauthorized(true);
      },
      onError: () => undefined,
    }),
    [installPackage, storagePersisted],
  );

  useEffect(() => {
    if (!initialized || !deviceToken) return;
    const controller = new PlayerSyncController(store, playerClient, scheduler, callbacks);
    controller.start();
    void controller.refreshWeather();
    const cancelWeather = scheduler.every(() => void controller.refreshWeather(), 30 * 60_000);
    return () => {
      controller.stop();
      cancelWeather();
    };
  }, [callbacks, deviceToken, initialized, scheduler, store]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPairingOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(
    () => () => {
      scheduler.clearAll();
      revokeMediaObjectUrls(mediaUrls.current);
      for (const urls of urlsToRevoke.current) revokeMediaObjectUrls(urls);
      void store.close();
    },
    [scheduler, store],
  );

  const submitPairing = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (pairingBusy || pairCode.length !== 8) return;
      setPairingBusy(true);
      setPairingError(null);
      try {
        const paired = await pairDevice(pairCode, deviceName.trim());
        await store.setDeviceCredentials(paired.deviceId, paired.token, deviceName.trim());
        setDeviceToken(paired.token);
        setUnauthorized(false);
        setPairingOpen(false);
        setPairCode('');
      } catch {
        setPairingError('Code invalide, expiré ou connexion indisponible.');
      } finally {
        setPairingBusy(false);
      }
    },
    [deviceName, pairCode, pairingBusy, store],
  );

  if (!initialized) {
    return <Display instant={clockNow} scheduler={scheduler} waitingDeviceName={deviceName} />;
  }
  if (!deviceToken && !display) {
    return (
      <PairingPanel
        busy={pairingBusy}
        code={pairCode}
        deviceName={deviceName}
        error={pairingError ?? (unauthorized ? 'Appareil non autorisé.' : null)}
        fullScreen
        now={clockNow}
        onCodeChange={setPairCode}
        onNameChange={setDeviceName}
        onSubmit={submitPairing}
      />
    );
  }

  const lastSuccessAt = lastSyncAt ? Date.parse(lastSyncAt) : null;
  const offline = statusNow - (lastSuccessAt ?? startedAt.current) > 5 * 60_000;

  return (
    <div className="player-root">
      <Display
        instant={clockNow}
        mediaUrls={display?.mediaUrls}
        packageData={display?.packageData}
        scheduler={scheduler}
        waitingDeviceName={deviceName}
        weather={weather}
      />
      <div className="player-indicators">
        {unauthorized ? <span className="unauthorized-badge">Appareil non autorisé</span> : null}
        {offline ? (
          <span className="offline-dot" aria-label="Hors ligne" title="Hors ligne" />
        ) : null}
      </div>
      {pairingOpen && !deviceToken ? (
        <PairingPanel
          busy={pairingBusy}
          code={pairCode}
          deviceName={deviceName}
          error={pairingError}
          fullScreen={false}
          now={clockNow}
          onCodeChange={setPairCode}
          onNameChange={setDeviceName}
          onSubmit={submitPairing}
        />
      ) : null}
    </div>
  );
}

export function Player() {
  if (
    !import.meta.env.VITE_SUPABASE_URL ||
    new URLSearchParams(window.location.search).get('demo') === '1'
  ) {
    return <Display allowDemoFallback />;
  }
  if (!supabase) return <ConfigurationError />;
  return <LivePlayer />;
}
