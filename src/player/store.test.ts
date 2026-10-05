import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import demoPackage from '../fixtures/demo-package.json';
import { canonicalize } from '../domain/compile';
import type { PublishedPackage } from '../domain/package';
import {
  PLAYER_DATABASE_NAME,
  PlayerStore,
  type PackageMedia,
  type PackageSource,
  type PlayerDatabase,
  type StoredMedia,
  type StoredVersion,
} from './store';

const stores: PlayerStore[] = [];

function createStore(): PlayerStore {
  const store = new PlayerStore(`${PLAYER_DATABASE_NAME}-${crypto.randomUUID()}`);
  stores.push(store);
  return store;
}

async function digest(value: string | Uint8Array): Promise<string> {
  const bytes = new Uint8Array(typeof value === 'string' ? new TextEncoder().encode(value) : value);
  const result = await crypto.subtle.digest('SHA-256', bytes.buffer);
  return [...new Uint8Array(result)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

async function makePackage(
  number: number,
  media: Array<Omit<PackageMedia, 'url'>> = [],
): Promise<PublishedPackage> {
  const packageData = structuredClone(demoPackage) as PublishedPackage;
  packageData.versionNumber = number;
  packageData.publishedAt = '2026-09-30T10:00:00.000Z';
  packageData.media = media;
  const unsigned: Record<string, unknown> = { ...packageData };
  delete unsigned.packageHash;
  packageData.packageHash = await digest(canonicalize(unsigned));
  return packageData;
}

function sourceFor(
  packageData: unknown,
  media: PackageMedia[] = [],
  downloadMedia: (url: string) => Promise<Blob> = async () => {
    throw new Error('Unexpected media download.');
  },
): PackageSource {
  return {
    fetchPackage: vi.fn(async () => ({ package: packageData, media })),
    downloadMedia: vi.fn(downloadMedia),
  };
}

async function addStoredMedia(databaseName: string, media: StoredMedia): Promise<void> {
  const db = await openDB<PlayerDatabase>(databaseName, 1);
  await db.put('media', media);
  db.close();
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

describe('PlayerStore', () => {
  it('validates, downloads, hashes, and atomically activates a package', async () => {
    const store = createStore();
    const bytes = new TextEncoder().encode('verified media');
    const mediaHash = await digest(bytes);
    const media = {
      id: 'media-one',
      sha256: mediaHash,
      bytes: bytes.byteLength,
      mime: 'image/png',
    };
    const packageData = await makePackage(1, [media]);
    const blob = new Blob([bytes], { type: media.mime });
    const source = sourceFor(
      packageData,
      [{ ...media, url: 'https://storage.example/media-one' }],
      async () => blob,
    );

    const result = await store.activate(1, source);

    expect(result.ok).toBe(true);
    expect(await store.getMeta('activeVersion')).toBe(1);
    expect(await store.getMeta('previousVersion')).toBeNull();
    expect((await store.getActivePackage())?.packageHash).toBe(packageData.packageHash);
    const storedMedia = await store.getMedia(mediaHash);
    expect(storedMedia?.bytes).toBe(bytes.byteLength);
    expect(await storedMedia?.blob.text()).toBe('verified media');
  });

  it('re-downloads cached media when its bytes no longer match the manifest hash', async () => {
    const store = createStore();
    const bytes = new TextEncoder().encode('verified media');
    const mediaHash = await digest(bytes);
    const media = {
      id: 'media-one',
      sha256: mediaHash,
      bytes: bytes.byteLength,
      mime: 'image/png',
    };
    const firstPackage = await makePackage(1, [media]);
    const mediaUrl = 'https://storage.example/media-one';
    expect(
      (
        await store.activate(
          1,
          sourceFor(
            firstPackage,
            [{ ...media, url: mediaUrl }],
            async () => new Blob([bytes], { type: media.mime }),
          ),
        )
      ).ok,
    ).toBe(true);
    await addStoredMedia(store.databaseName, {
      sha256: mediaHash,
      blob: new Blob([new Uint8Array(bytes.byteLength).fill(0)], { type: media.mime }),
      mime: media.mime,
      bytes: bytes.byteLength,
    });
    const source = sourceFor(
      await makePackage(2, [media]),
      [{ ...media, url: mediaUrl }],
      async () => new Blob([bytes], { type: media.mime }),
    );

    const result = await store.activate(2, source);

    expect(result.ok).toBe(true);
    expect(source.downloadMedia).toHaveBeenCalledOnce();
    expect(await (await store.getMedia(mediaHash))?.blob.text()).toBe('verified media');
    expect(await store.getMeta('activeVersion')).toBe(2);
  });

  it('rejects an invalid package without changing the active version', async () => {
    const store = createStore();
    const first = await makePackage(1);
    expect((await store.activate(1, sourceFor(first))).ok).toBe(true);

    const result = await store.activate(2, sourceFor({ versionNumber: 2 }));

    expect(result).toEqual({ ok: false, error: 'invalid_package' });
    expect(await store.getMeta('activeVersion')).toBe(1);
    expect(await store.getMeta('lastError')).toBe('invalid_package');
  });

  it('rejects a package with a false canonical hash without changing the active version', async () => {
    const store = createStore();
    const first = await makePackage(1);
    expect((await store.activate(1, sourceFor(first))).ok).toBe(true);
    const wrongHash = { ...(await makePackage(2)), packageHash: '0'.repeat(64) };

    const result = await store.activate(2, sourceFor(wrongHash));

    expect(result).toEqual({ ok: false, error: 'package_hash_mismatch' });
    expect(await store.getMeta('activeVersion')).toBe(1);
    expect(await store.getVersion(2)).toBeUndefined();
  });

  it('keeps the current version when downloaded media has a different SHA-256', async () => {
    const store = createStore();
    const first = await makePackage(1);
    expect((await store.activate(1, sourceFor(first))).ok).toBe(true);
    const expectedBytes = new Uint8Array([1, 2, 3]);
    const media = {
      id: 'media-two',
      sha256: await digest(expectedBytes),
      bytes: expectedBytes.byteLength,
      mime: 'image/png',
    };
    const packageData = await makePackage(2, [media]);
    const source = sourceFor(
      packageData,
      [{ ...media, url: 'https://storage.example/media-two' }],
      async () => new Blob([new Uint8Array([4, 5, 6])], { type: media.mime }),
    );

    const result = await store.activate(2, source);

    expect(result).toEqual({ ok: false, error: 'media_hash_mismatch' });
    expect(await store.getMeta('activeVersion')).toBe(1);
    expect(await store.getVersion(2)).toBeUndefined();
  });

  it('keeps the current version when a media download fails midway', async () => {
    const store = createStore();
    const first = await makePackage(1);
    expect((await store.activate(1, sourceFor(first))).ok).toBe(true);
    const firstBytes = new Uint8Array([1, 2, 3]);
    const secondBytes = new Uint8Array([4, 5, 6]);
    const firstMedia = {
      id: 'media-two',
      sha256: await digest(firstBytes),
      bytes: firstBytes.byteLength,
      mime: 'image/png',
    };
    const secondMedia = {
      id: 'media-three',
      sha256: await digest(secondBytes),
      bytes: secondBytes.byteLength,
      mime: 'image/png',
    };
    const packageData = await makePackage(2, [firstMedia, secondMedia]);
    const source = sourceFor(
      packageData,
      [
        { ...firstMedia, url: 'https://storage.example/media-two' },
        { ...secondMedia, url: 'https://storage.example/media-three' },
      ],
      async (url) => {
        if (url.endsWith('/media-two')) {
          return new Blob([firstBytes], { type: firstMedia.mime });
        }
        throw new TypeError('Network interrupted.');
      },
    );

    const result = await store.activate(2, source);

    expect(result).toEqual({ ok: false, error: 'network_error' });
    expect(await store.getMeta('activeVersion')).toBe(1);
    expect(await store.getVersion(2)).toBeUndefined();
    expect(await store.getMedia(firstMedia.sha256)).toBeUndefined();
  });

  it('purges unreferenced blobs and retries once after a quota error', async () => {
    class QuotaOnceStore extends PlayerStore {
      failNextWrite = false;

      protected override async writeActivation(
        version: StoredVersion,
        media: StoredMedia[],
      ): Promise<void> {
        if (this.failNextWrite) {
          this.failNextWrite = false;
          throw new DOMException('Quota exceeded.', 'QuotaExceededError');
        }
        await super.writeActivation(version, media);
      }
    }

    const store = new QuotaOnceStore(`${PLAYER_DATABASE_NAME}-${crypto.randomUUID()}`);
    stores.push(store);
    const first = await makePackage(1);
    expect((await store.activate(1, sourceFor(first))).ok).toBe(true);
    await addStoredMedia(store.databaseName, {
      sha256: 'f'.repeat(64),
      blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
      mime: 'image/png',
      bytes: 1,
    });
    store.failNextWrite = true;

    const result = await store.activate(2, sourceFor(await makePackage(2)));

    expect(result.ok).toBe(true);
    expect(await store.getMeta('activeVersion')).toBe(2);
    expect(await store.getMeta('previousVersion')).toBe(1);
    expect(await store.getMedia('f'.repeat(64))).toBeUndefined();
  });

  it('preserves the current version when the quota retry also fails', async () => {
    class QuotaStore extends PlayerStore {
      failWrites = false;

      protected override async writeActivation(
        version: StoredVersion,
        media: StoredMedia[],
      ): Promise<void> {
        if (this.failWrites) {
          throw new DOMException('Quota exceeded.', 'QuotaExceededError');
        }
        await super.writeActivation(version, media);
      }
    }

    const store = new QuotaStore(`${PLAYER_DATABASE_NAME}-${crypto.randomUUID()}`);
    stores.push(store);
    expect((await store.activate(1, sourceFor(await makePackage(1)))).ok).toBe(true);
    store.failWrites = true;

    const result = await store.activate(2, sourceFor(await makePackage(2)));

    expect(result).toEqual({ ok: false, error: 'quota_exceeded' });
    expect(await store.getMeta('activeVersion')).toBe(1);
    expect(await store.getVersion(2)).toBeUndefined();
  });

  it('restores the active package after opening a new store instance', async () => {
    const databaseName = `${PLAYER_DATABASE_NAME}-${crypto.randomUUID()}`;
    const firstStore = new PlayerStore(databaseName);
    stores.push(firstStore);
    const packageData = await makePackage(1);
    expect((await firstStore.activate(1, sourceFor(packageData))).ok).toBe(true);
    await firstStore.close();

    const restartedStore = new PlayerStore(databaseName);
    stores.push(restartedStore);

    expect((await restartedStore.getActivePackage())?.packageHash).toBe(packageData.packageHash);
  });

  it('retains two versions and removes media that is no longer referenced', async () => {
    const store = createStore();
    const firstBytes = new Uint8Array([1]);
    const secondBytes = new Uint8Array([2]);
    const firstMedia = {
      id: 'first',
      sha256: await digest(firstBytes),
      bytes: firstBytes.byteLength,
      mime: 'image/png',
    };
    const secondMedia = {
      id: 'second',
      sha256: await digest(secondBytes),
      bytes: secondBytes.byteLength,
      mime: 'image/png',
    };
    const activate = async (number: number, media: typeof firstMedia) => {
      const packageData = await makePackage(number, [media]);
      return store.activate(
        number,
        sourceFor(
          packageData,
          [{ ...media, url: `https://storage.example/${media.id}` }],
          async (url) =>
            new Blob([url.endsWith('/first') ? firstBytes : secondBytes], { type: media.mime }),
        ),
      );
    };

    expect((await activate(1, firstMedia)).ok).toBe(true);
    expect((await activate(2, secondMedia)).ok).toBe(true);
    expect((await store.activate(3, sourceFor(await makePackage(3)))).ok).toBe(true);
    await addStoredMedia(store.databaseName, {
      sha256: 'e'.repeat(64),
      blob: new Blob([new Uint8Array([3])], { type: 'image/png' }),
      mime: 'image/png',
      bytes: 1,
    });
    expect((await store.activate(4, sourceFor(await makePackage(4)))).ok).toBe(true);

    const db = await openDB<PlayerDatabase>(store.databaseName, 1);
    const versions = await db.getAll('versions');
    const media = await db.getAll('media');
    db.close();

    expect(versions.map((version) => version.number).sort()).toEqual([3, 4]);
    expect(media).toEqual([]);
    expect(await store.getMeta('activeVersion')).toBe(4);
    expect(await store.getMeta('previousVersion')).toBe(3);
  });
});
