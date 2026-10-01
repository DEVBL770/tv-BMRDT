import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import { canonicalize } from '../domain/compile';
import { PublishedPackageSchema, type PublishedPackage } from '../domain/package';

export const PLAYER_DATABASE_NAME = 'beth-menahem-player';

export type PlayerWeather = {
  temperatureC: number | null;
  symbol: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  attribution: string;
};

export type PlayerMeta = {
  activeVersion: number | null;
  previousVersion: number | null;
  deviceId: string | null;
  deviceName: string | null;
  deviceToken: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  lastWeather: PlayerWeather | null;
  serverOffsetMs: number | null;
  storagePersisted: boolean | null;
};

export type StoredVersion = {
  number: number;
  package: PublishedPackage;
  hash: string;
  storedAt: string;
};

export type StoredMedia = {
  sha256: string;
  blob: Blob;
  mime: string;
  bytes: number;
};

export type PackageMedia = {
  id: string;
  sha256: string;
  bytes: number;
  mime: string;
  url: string;
};

export type PackageBundle = {
  package: unknown;
  media: PackageMedia[];
};

export type PackageSource = {
  fetchPackage(number: number): Promise<PackageBundle>;
  downloadMedia(url: string): Promise<Blob>;
};

export type ActivationResult =
  | { ok: true; package: PublishedPackage }
  | { ok: false; error: string };

export interface PlayerDatabase extends DBSchema {
  versions: {
    key: number;
    value: StoredVersion;
  };
  media: {
    key: string;
    value: StoredMedia;
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
}

export class PlayerStoreError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const PackageMediaSchema = z
  .object({
    id: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative(),
    mime: z.string().min(1),
    url: z.url(),
  })
  .strict();

const PackageBundleSchema = z
  .object({
    package: z.unknown(),
    media: z.array(PackageMediaSchema),
  })
  .strict();

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

async function packageHash(packageData: PublishedPackage): Promise<string> {
  const value: Record<string, unknown> = { ...packageData };
  delete value.packageHash;
  return sha256Hex(new TextEncoder().encode(canonicalize(value)));
}

function isQuotaExceeded(error: unknown): boolean {
  return error instanceof Error && error.name === 'QuotaExceededError';
}

function errorCode(error: unknown): string {
  if (error instanceof PlayerStoreError) return error.code;
  if (error instanceof TypeError) return 'network_error';
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[a-z_]{1,40}$/.test(error.code)
  ) {
    return error.code;
  }
  return 'activation_failed';
}

export async function requestStoragePersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export class PlayerStore {
  private databasePromise: Promise<IDBPDatabase<PlayerDatabase>> | null = null;

  constructor(readonly databaseName = PLAYER_DATABASE_NAME) {}

  private database(): Promise<IDBPDatabase<PlayerDatabase>> {
    this.databasePromise ??= openDB<PlayerDatabase>(this.databaseName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('versions')) {
          db.createObjectStore('versions', { keyPath: 'number' });
        }
        if (!db.objectStoreNames.contains('media')) {
          db.createObjectStore('media', { keyPath: 'sha256' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    });
    return this.databasePromise;
  }

  async close(): Promise<void> {
    const db = await this.databasePromise;
    db?.close();
    this.databasePromise = null;
  }

  async getMeta<K extends keyof PlayerMeta>(key: K): Promise<PlayerMeta[K] | null> {
    const db = await this.database();
    const entry = await db.get('meta', key);
    return (entry?.value as PlayerMeta[K] | undefined) ?? null;
  }

  async setMeta<K extends keyof PlayerMeta>(key: K, value: PlayerMeta[K]): Promise<void> {
    const db = await this.database();
    await db.put('meta', { key, value });
  }

  async setDeviceCredentials(
    deviceId: string,
    deviceToken: string,
    deviceName = 'TV salle principale',
  ): Promise<void> {
    const db = await this.database();
    const tx = db.transaction('meta', 'readwrite');
    await Promise.all([
      tx.store.put({ key: 'deviceId', value: deviceId }),
      tx.store.put({ key: 'deviceName', value: deviceName }),
      tx.store.put({ key: 'deviceToken', value: deviceToken }),
    ]);
    await tx.done;
  }

  async clearDeviceToken(): Promise<void> {
    await this.setMeta('deviceToken', null);
  }

  async getVersion(number: number): Promise<StoredVersion | undefined> {
    const db = await this.database();
    return db.get('versions', number);
  }

  async getActiveVersion(): Promise<StoredVersion | undefined> {
    const number = await this.getMeta('activeVersion');
    return number === null ? undefined : this.getVersion(number);
  }

  async getActivePackage(): Promise<PublishedPackage | undefined> {
    return (await this.getActiveVersion())?.package;
  }

  async getMedia(sha256: string): Promise<StoredMedia | undefined> {
    const db = await this.database();
    return db.get('media', sha256);
  }

  async activate(number: number, source: PackageSource): Promise<ActivationResult> {
    try {
      const rawBundle = await source.fetchPackage(number);
      const bundle = PackageBundleSchema.safeParse(rawBundle);
      if (!bundle.success) throw new PlayerStoreError('invalid_media_manifest');

      const parsedPackage = PublishedPackageSchema.safeParse(bundle.data.package);
      if (!parsedPackage.success) throw new PlayerStoreError('invalid_package');
      const packageData = parsedPackage.data;
      if (packageData.versionNumber !== number) throw new PlayerStoreError('version_mismatch');
      if ((await packageHash(packageData)) !== packageData.packageHash) {
        throw new PlayerStoreError('package_hash_mismatch');
      }

      const mediaById = new Map<string, PackageMedia>();
      for (const media of bundle.data.media) {
        if (mediaById.has(media.id)) throw new PlayerStoreError('invalid_media_manifest');
        mediaById.set(media.id, media);
      }
      const mediaToDownload: PackageMedia[] = [];
      for (const expected of packageData.media) {
        const descriptor = mediaById.get(expected.id);
        if (
          !descriptor ||
          descriptor.sha256 !== expected.sha256 ||
          descriptor.bytes !== expected.bytes ||
          descriptor.mime !== expected.mime
        ) {
          throw new PlayerStoreError('media_manifest_mismatch');
        }
        const cached = await this.getMedia(expected.sha256);
        const cachedHash = cached ? await sha256Hex(await cached.blob.arrayBuffer()) : null;
        if (
          !cached ||
          cached.bytes !== expected.bytes ||
          cached.mime !== expected.mime ||
          cached.blob.size !== expected.bytes ||
          cachedHash !== expected.sha256
        ) {
          mediaToDownload.push(descriptor);
        }
      }
      if (mediaById.size !== packageData.media.length) {
        throw new PlayerStoreError('media_manifest_mismatch');
      }

      const mediaToStore: StoredMedia[] = [];
      for (const media of mediaToDownload) {
        const blob = await source.downloadMedia(media.url);
        if (blob.size !== media.bytes) throw new PlayerStoreError('media_size_mismatch');
        if (blob.type && blob.type.toLowerCase() !== media.mime.toLowerCase()) {
          throw new PlayerStoreError('media_mime_mismatch');
        }
        if ((await sha256Hex(await blob.arrayBuffer())) !== media.sha256) {
          throw new PlayerStoreError('media_hash_mismatch');
        }
        mediaToStore.push({
          sha256: media.sha256,
          blob: blob.type ? blob : new Blob([blob], { type: media.mime }),
          mime: media.mime,
          bytes: media.bytes,
        });
      }

      const version: StoredVersion = {
        number,
        package: packageData,
        hash: packageData.packageHash,
        storedAt: new Date().toISOString(),
      };
      try {
        await this.writeActivation(version, mediaToStore);
      } catch (error) {
        if (!isQuotaExceeded(error)) throw error;
        await this.purgeUnreferencedMedia();
        try {
          await this.writeActivation(version, mediaToStore);
        } catch (retryError) {
          if (isQuotaExceeded(retryError)) throw new PlayerStoreError('quota_exceeded');
          throw retryError;
        }
      }

      await this.purgeToActiveAndPrevious().catch(() => undefined);
      await this.setMeta('lastError', null).catch(() => undefined);
      return { ok: true, package: packageData };
    } catch (error) {
      const code = errorCode(error);
      await this.setMeta('lastError', code).catch(() => undefined);
      return { ok: false, error: code };
    }
  }

  protected async writeActivation(version: StoredVersion, media: StoredMedia[]): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(['versions', 'media', 'meta'], 'readwrite');
    const activeEntry = await tx.objectStore('meta').get('activeVersion');
    const previousEntry = await tx.objectStore('meta').get('previousVersion');
    const oldActive = typeof activeEntry?.value === 'number' ? activeEntry.value : null;
    const oldPrevious = typeof previousEntry?.value === 'number' ? previousEntry.value : null;

    await tx.objectStore('versions').put(version);
    for (const item of media) await tx.objectStore('media').put(item);
    await tx.objectStore('meta').put({
      key: 'previousVersion',
      value: oldActive !== null && oldActive !== version.number ? oldActive : oldPrevious,
    });
    await tx.objectStore('meta').put({ key: 'activeVersion', value: version.number });
    await tx.done;
  }

  private async purgeUnreferencedMedia(): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(['versions', 'media', 'meta'], 'readwrite');
    const active = await tx.objectStore('meta').get('activeVersion');
    const previous = await tx.objectStore('meta').get('previousVersion');
    const referencedVersions = [active?.value, previous?.value].filter(
      (value): value is number => typeof value === 'number',
    );
    const referencedMedia = new Set<string>();
    for (const number of referencedVersions) {
      const version = await tx.objectStore('versions').get(number);
      for (const media of version?.package.media ?? []) referencedMedia.add(media.sha256);
    }
    for (const media of await tx.objectStore('media').getAll()) {
      if (!referencedMedia.has(media.sha256)) await tx.objectStore('media').delete(media.sha256);
    }
    await tx.done;
  }

  private async purgeToActiveAndPrevious(): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(['versions', 'media', 'meta'], 'readwrite');
    const active = await tx.objectStore('meta').get('activeVersion');
    const previous = await tx.objectStore('meta').get('previousVersion');
    const retainedVersions = new Set(
      [active?.value, previous?.value].filter(
        (value): value is number => typeof value === 'number',
      ),
    );
    const referencedMedia = new Set<string>();
    for (const version of await tx.objectStore('versions').getAll()) {
      if (!retainedVersions.has(version.number)) {
        await tx.objectStore('versions').delete(version.number);
        continue;
      }
      for (const media of version.package.media) referencedMedia.add(media.sha256);
    }
    for (const media of await tx.objectStore('media').getAll()) {
      if (!referencedMedia.has(media.sha256)) await tx.objectStore('media').delete(media.sha256);
    }
    await tx.done;
  }
}
