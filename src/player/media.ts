import type { PublishedPackage } from '../domain/package';
import type { PlayerStore } from './store';

export async function createMediaObjectUrls(
  packageData: PublishedPackage,
  store: PlayerStore,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    packageData.media.map(async (media) => {
      const stored = await store.getMedia(media.sha256);
      return stored ? ([media.id, URL.createObjectURL(stored.blob)] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => !!entry));
}

export function revokeMediaObjectUrls(mediaUrls: Record<string, string>): void {
  for (const url of Object.values(mediaUrls)) URL.revokeObjectURL(url);
}
