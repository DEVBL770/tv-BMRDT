import type { PublishedPackage } from '../domain/package';
import type { PlayerScheduler, TimerHandle } from './scheduler';
import { PlayerApiError, type SyncRequest, type SyncResponse } from './api';
import { PlayerStore, type PackageBundle, type PackageSource, type PlayerWeather } from './store';

const NORMAL_SYNC_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const CLOCK_ADJUSTMENT_THRESHOLD_MS = 60_000;
const CLOCK_ADJUSTMENT_MAX_AGE_MS = 24 * 60 * 60_000;

export type SyncClient = {
  sync(token: string, request: SyncRequest): Promise<SyncResponse>;
  package(number: number, token: string): Promise<PackageBundle>;
  downloadMedia(url: string): Promise<Blob>;
  weather(token: string): Promise<PlayerWeather>;
};

export type SyncCallbacks = {
  getDisplayedVersion(): number | null;
  getCacheStatus(): string;
  onPackage(packageData: PublishedPackage): void;
  onSyncSuccess(at: string): void;
  onClockOffset(offsetMs: number): void;
  onWeather(weather: PlayerWeather): void;
  onUnauthorized(): void;
  onError(code: string): void;
};

export type SyncOutcome = 'success' | 'error' | 'unauthorized' | 'skipped';

export class SyncBackoff {
  private retryDelayMs = NORMAL_SYNC_MS;

  reset(): void {
    this.retryDelayMs = NORMAL_SYNC_MS;
  }

  nextFailureDelay(): number {
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_BACKOFF_MS);
    return delay;
  }

  nextSuccessDelay(random = Math.random): number {
    this.retryDelayMs = NORMAL_SYNC_MS;
    return Math.round(NORMAL_SYNC_MS - 2_000 + random() * 4_000);
  }
}

function isUnauthorized(error: unknown): boolean {
  return (
    (error instanceof PlayerApiError && error.status === 401) ||
    (typeof error === 'object' && error !== null && 'status' in error && error.status === 401)
  );
}

function errorCode(error: unknown): string {
  return error instanceof PlayerApiError ? error.code : 'sync_failed';
}

function buildHash(): string {
  return import.meta.env.VITE_BUILD_HASH ?? import.meta.env.MODE;
}

export class PlayerSyncController {
  private running = false;
  private unauthorized = false;
  private inFlight = false;
  private timer: TimerHandle | null = null;
  private readonly backoff = new SyncBackoff();

  constructor(
    private readonly store: PlayerStore,
    private readonly client: SyncClient,
    private readonly scheduler: PlayerScheduler,
    private readonly callbacks: SyncCallbacks,
  ) {}

  start(): void {
    if (this.running || this.unauthorized) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  resumeAfterPairing(): void {
    this.unauthorized = false;
    this.backoff.reset();
    this.stop();
    this.start();
  }

  async syncOnce(): Promise<SyncOutcome> {
    if (this.inFlight || this.unauthorized) return 'skipped';
    const token = await this.store.getMeta('deviceToken');
    if (!token) return 'skipped';
    this.inFlight = true;
    try {
      const knownVersion = await this.store.getMeta('activeVersion');
      const lastError = await this.store.getMeta('lastError');
      const clientTimestamp = Date.now();
      const request: SyncRequest = {
        knownVersion,
        displayedVersion: this.callbacks.getDisplayedVersion(),
        clientTime: new Date(clientTimestamp).toISOString(),
        build: buildHash(),
        cacheStatus: this.callbacks.getCacheStatus(),
        lastError,
      };
      const response = await this.client.sync(token, request);
      const serverTimestamp = Date.parse(response.serverTime);
      if (Number.isFinite(serverTimestamp)) {
        const offsetMs = serverTimestamp - clientTimestamp;
        const lastSyncAt = await this.store.getMeta('lastSyncAt');
        const lastSuccessfulSyncAt = lastSyncAt === null ? Number.NaN : Date.parse(lastSyncAt);
        const recentSuccessfulSync =
          Number.isFinite(lastSuccessfulSyncAt) &&
          Date.now() - lastSuccessfulSyncAt < CLOCK_ADJUSTMENT_MAX_AGE_MS;
        if (Math.abs(offsetMs) > CLOCK_ADJUSTMENT_THRESHOLD_MS) {
          if (recentSuccessfulSync) {
            await this.store.setMeta('serverOffsetMs', offsetMs);
            this.callbacks.onClockOffset(offsetMs);
          }
        } else if ((await this.store.getMeta('serverOffsetMs')) !== 0) {
          await this.store.setMeta('serverOffsetMs', 0);
          this.callbacks.onClockOffset(0);
        }
      }

      let activationError: string | null = null;
      if (response.current) {
        const active = await this.store.getActiveVersion();
        if (
          !active ||
          active.number !== response.current.number ||
          active.hash !== response.current.hash
        ) {
          const source: PackageSource = {
            fetchPackage: (number) => this.client.package(number, token),
            downloadMedia: (url) => this.client.downloadMedia(url),
          };
          const activation = await this.store.activate(response.current.number, source);
          if (activation.ok) {
            this.callbacks.onPackage(activation.package);
          } else {
            activationError = activation.error;
            this.callbacks.onError(activation.error);
          }
        }
      }

      if (!activationError) await this.store.setMeta('lastError', null).catch(() => undefined);
      const syncedAt = new Date().toISOString();
      await this.store.setMeta('lastSyncAt', syncedAt);
      this.callbacks.onSyncSuccess(syncedAt);
      return 'success';
    } catch (error) {
      if (isUnauthorized(error)) {
        this.unauthorized = true;
        this.running = false;
        await this.store.clearDeviceToken();
        this.callbacks.onUnauthorized();
        return 'unauthorized';
      }
      const code = errorCode(error);
      await this.store.setMeta('lastError', code).catch(() => undefined);
      this.callbacks.onError(code);
      return 'error';
    } finally {
      this.inFlight = false;
    }
  }

  async refreshWeather(): Promise<void> {
    if (!this.running || this.unauthorized) return;
    const token = await this.store.getMeta('deviceToken');
    if (!token) return;
    try {
      const weather = await this.client.weather(token);
      await this.store.setMeta('lastWeather', weather);
      this.callbacks.onWeather(weather);
    } catch (error) {
      if (isUnauthorized(error)) {
        this.unauthorized = true;
        this.running = false;
        if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
        this.timer = null;
        await this.store.clearDeviceToken();
        this.callbacks.onUnauthorized();
      }
    }
  }

  private schedule(delayMs: number): void {
    this.timer = this.scheduler.timeout(() => {
      this.timer = null;
      void this.runCycle();
    }, delayMs);
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    const outcome = await this.syncOnce();
    if (!this.running || outcome === 'unauthorized' || outcome === 'skipped') return;
    this.schedule(
      outcome === 'success' ? this.backoff.nextSuccessDelay() : this.backoff.nextFailureDelay(),
    );
  }
}
