import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import demoPackage from '../fixtures/demo-package.json';
import { canonicalize } from '../domain/compile';
import type { PublishedPackage } from '../domain/package';
import { PlayerApiError } from './api';
import { PlayerScheduler } from './scheduler';
import { PlayerStore } from './store';
import { PlayerSyncController, SyncBackoff, type SyncCallbacks, type SyncClient } from './sync';

const stores: PlayerStore[] = [];

function createStore(): PlayerStore {
  const store = new PlayerStore(`player-sync-${crypto.randomUUID()}`);
  stores.push(store);
  return store;
}

async function makePackage(number: number): Promise<PublishedPackage> {
  const packageData = structuredClone(demoPackage) as PublishedPackage;
  packageData.versionNumber = number;
  packageData.publishedAt = '2026-09-30T10:00:00.000Z';
  packageData.media = [];
  const value: Record<string, unknown> = { ...packageData };
  delete value.packageHash;
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  packageData.packageHash = [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
  return packageData;
}

function callbacks(overrides: Partial<SyncCallbacks> = {}): SyncCallbacks {
  return {
    getDisplayedVersion: () => 1,
    getCacheStatus: () => 'ready_persistent',
    onPackage: vi.fn(),
    onSyncSuccess: vi.fn(),
    onClockOffset: vi.fn(),
    onWeather: vi.fn(),
    onUnauthorized: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

function client(sync: SyncClient['sync']): SyncClient {
  return {
    sync,
    package: vi.fn(async () => ({ package: null, media: [] })),
    downloadMedia: vi.fn(async () => new Blob()),
    weather: vi.fn(async () => ({
      temperatureC: 18,
      symbol: 'clearsky_day',
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      attribution: 'MET Norway',
    })),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

describe('PlayerSyncController', () => {
  it('backs off exponentially to five minutes and resets after success', () => {
    vi.useFakeTimers();
    const backoff = new SyncBackoff();

    expect([
      backoff.nextFailureDelay(),
      backoff.nextFailureDelay(),
      backoff.nextFailureDelay(),
      backoff.nextFailureDelay(),
      backoff.nextFailureDelay(),
      backoff.nextFailureDelay(),
      backoff.nextFailureDelay(),
    ]).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    expect(backoff.nextSuccessDelay(() => 0)).toBe(13_000);
    expect(backoff.nextFailureDelay()).toBe(15_000);
  });

  it('clears the device token after a 401 and keeps the cached package active', async () => {
    const store = createStore();
    const cachedPackage = await makePackage(1);
    const activated = await store.activate(1, {
      fetchPackage: async () => ({ package: cachedPackage, media: [] }),
      downloadMedia: async () => new Blob(),
    });
    expect(activated.ok).toBe(true);
    await store.setDeviceCredentials(crypto.randomUUID(), 'device-token');
    const scheduler = new PlayerScheduler();
    const onUnauthorized = vi.fn();
    const controller = new PlayerSyncController(
      store,
      client(async () => {
        throw new PlayerApiError('unauthorized', 401);
      }),
      scheduler,
      callbacks({ onUnauthorized }),
    );

    expect(await controller.syncOnce()).toBe('unauthorized');
    expect(await store.getMeta('deviceToken')).toBeNull();
    expect(await store.getMeta('activeVersion')).toBe(1);
    expect((await store.getActivePackage())?.packageHash).toBe(cachedPackage.packageHash);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    scheduler.clearAll();
  });

  it('applies a server clock offset over one minute after a successful sync', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'));
    const store = createStore();
    await store.setDeviceCredentials(crypto.randomUUID(), 'device-token');
    await store.setMeta('lastSyncAt', new Date(Date.now() - 60_000).toISOString());
    const onClockOffset = vi.fn();
    const scheduler = new PlayerScheduler();
    const controller = new PlayerSyncController(
      store,
      client(async () => ({
        serverTime: new Date(Date.now() + 120_000).toISOString(),
        clockSkewSeconds: -120,
        current: null,
      })),
      scheduler,
      callbacks({ onClockOffset }),
    );

    expect(await controller.syncOnce()).toBe('success');
    expect(await store.getMeta('serverOffsetMs')).toBe(120_000);
    expect(onClockOffset).toHaveBeenCalledWith(120_000);
    expect(await store.getMeta('lastSyncAt')).toBe(new Date().toISOString());
    scheduler.clearAll();
  });

  it('does not apply a clock offset when the last successful sync is over 24 hours old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'));
    const store = createStore();
    await store.setDeviceCredentials(crypto.randomUUID(), 'device-token');
    await store.setMeta('lastSyncAt', new Date(Date.now() - 25 * 60 * 60_000).toISOString());
    const onClockOffset = vi.fn();
    const scheduler = new PlayerScheduler();
    const controller = new PlayerSyncController(
      store,
      client(async () => ({
        serverTime: new Date(Date.now() + 120_000).toISOString(),
        clockSkewSeconds: -120,
        current: null,
      })),
      scheduler,
      callbacks({ onClockOffset }),
    );

    expect(await controller.syncOnce()).toBe('success');
    expect(onClockOffset).not.toHaveBeenCalled();
    expect(await store.getMeta('serverOffsetMs')).toBeNull();
    scheduler.clearAll();
  });

  it('reports cached, displayed, build, clock, and error state on each heartbeat', async () => {
    const store = createStore();
    const packageData = await makePackage(1);
    expect(
      (
        await store.activate(1, {
          fetchPackage: async () => ({ package: packageData, media: [] }),
          downloadMedia: async () => new Blob(),
        })
      ).ok,
    ).toBe(true);
    await store.setDeviceCredentials(crypto.randomUUID(), 'device-token');
    await store.setMeta('lastError', 'media_hash_mismatch');
    const sync = vi.fn<SyncClient['sync']>(async () => ({
      serverTime: new Date().toISOString(),
      clockSkewSeconds: 0,
      current: { number: 1, hash: packageData.packageHash },
    }));
    const scheduler = new PlayerScheduler();
    const controller = new PlayerSyncController(store, client(sync), scheduler, callbacks());

    expect(await controller.syncOnce()).toBe('success');
    const [token, request] = sync.mock.calls[0]!;
    expect(token).toBe('device-token');
    expect(request).toMatchObject({
      knownVersion: 1,
      displayedVersion: 1,
      build: expect.any(String),
      cacheStatus: 'ready_persistent',
      lastError: 'media_hash_mismatch',
    });
    expect(Date.parse(request.clientTime)).toBeGreaterThan(0);
    scheduler.clearAll();
  });

  it('sends empty cache versions and error as explicit null heartbeat fields', async () => {
    const store = createStore();
    await store.setDeviceCredentials(crypto.randomUUID(), 'device-token');
    const sync = vi.fn<SyncClient['sync']>(async () => ({
      serverTime: new Date().toISOString(),
      clockSkewSeconds: 0,
      current: null,
    }));
    const scheduler = new PlayerScheduler();
    const controller = new PlayerSyncController(
      store,
      client(sync),
      scheduler,
      callbacks({
        getDisplayedVersion: () => null,
        getCacheStatus: () => 'empty_persistent',
      }),
    );

    expect(await controller.syncOnce()).toBe('success');
    const [, request] = sync.mock.calls[0]!;
    expect(request).toMatchObject({
      knownVersion: null,
      displayedVersion: null,
      cacheStatus: 'empty_persistent',
      lastError: null,
    });
    expect(Date.parse(request.clientTime)).toBeGreaterThan(0);
    expect(request.build).toBeTruthy();
    scheduler.clearAll();
  });

  it('does not run overlapping sync or package activations', async () => {
    const store = createStore();
    await store.setDeviceCredentials(crypto.randomUUID(), 'device-token');
    const packageData = await makePackage(2);
    let releasePackage: ((value: { package: PublishedPackage; media: [] }) => void) | undefined;
    const packagePromise = new Promise<{ package: PublishedPackage; media: [] }>((resolve) => {
      releasePackage = resolve;
    });
    const api = client(async () => ({
      serverTime: new Date().toISOString(),
      clockSkewSeconds: 0,
      current: { number: 2, hash: packageData.packageHash },
    }));
    api.package = vi.fn(async () => packagePromise);
    const scheduler = new PlayerScheduler();
    const controller = new PlayerSyncController(store, api, scheduler, callbacks());

    const first = controller.syncOnce();
    await vi.waitFor(() => expect(api.package).toHaveBeenCalledOnce());
    expect(await controller.syncOnce()).toBe('skipped');
    releasePackage?.({ package: packageData, media: [] });

    expect(await first).toBe('success');
    expect(api.package).toHaveBeenCalledOnce();
    expect(await store.getMeta('activeVersion')).toBe(2);
    scheduler.clearAll();
  });
});
