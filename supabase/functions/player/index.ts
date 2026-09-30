import { z } from 'zod';
import { addLocalDays, localDateOf } from '../_shared/domain/time.ts';
import {
  authenticateDevice,
  consumeRateLimit,
  errorResponse,
  handleCors,
  HttpError,
  jsonResponse,
  requestJson,
  runInBackground,
  serviceClient,
  supabaseUrl,
} from '../_shared/backend.ts';

const SyncRequest = z
  .object({
    action: z.literal('sync'),
    knownVersion: z.number().int().nonnegative().optional(),
    displayedVersion: z.number().int().nonnegative().optional(),
    clientTime: z.union([z.string().max(100), z.number()]).optional(),
    build: z.string().max(100).optional(),
    cacheStatus: z.string().max(40).optional(),
    lastError: z.string().max(200).optional(),
  })
  .strict();
const PackageRequest = z
  .object({ action: z.literal('package'), number: z.number().int().positive() })
  .strict();
const PlayerRequest = z.discriminatedUnion('action', [SyncRequest, PackageRequest]);

type MediaManifestItem = {
  id?: string;
  sha256?: string;
  bytes?: number;
  mime?: string;
};

async function maybeRefreshCalendar(client: ReturnType<typeof serviceClient>): Promise<void> {
  const ownerId = crypto.randomUUID();
  const { data: acquired, error } = await client.rpc('try_acquire_refresh_lock', {
    p_lock_name: 'calendar-refresh',
    p_owner_id: ownerId,
    p_ttl_seconds: 600,
  });
  if (error || acquired !== true) return;
  try {
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!key) return;
    const response = await fetch(`${supabaseUrl()}/functions/v1/admin`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'refreshData' }),
    });
    if (!response.ok) return;
  } finally {
    await client.rpc('release_refresh_lock', {
      p_lock_name: 'calendar-refresh',
      p_owner_id: ownerId,
    });
  }
}

async function handleSync(
  request: Request,
  client: ReturnType<typeof serviceClient>,
  device: { id: string; last_seen: string | null },
  input: z.infer<typeof SyncRequest>,
): Promise<Response> {
  const now = new Date();
  const nowIso = now.toISOString();
  const { data: state, error: stateError } = await client
    .from('public_state')
    .select('current_version_id,current_version_number')
    .eq('id', true)
    .maybeSingle();
  if (stateError) throw new HttpError('sync_unavailable', 503);
  const { data: version, error: versionError } = state?.current_version_id
    ? await client
        .from('published_versions')
        .select('id,package_hash,package')
        .eq('id', state.current_version_id)
        .maybeSingle()
    : { data: null, error: null };
  if (versionError) throw new HttpError('sync_unavailable', 503);

  const clientMillis =
    typeof input.clientTime === 'number'
      ? input.clientTime
      : input.clientTime
        ? Date.parse(input.clientTime)
        : Number.NaN;
  const clockSkew = Number.isFinite(clientMillis)
    ? Math.trunc((clientMillis - now.getTime()) / 1000)
    : null;
  const heartbeatDue = !device.last_seen || Date.parse(device.last_seen) <= now.getTime() - 25_000;
  if (heartbeatDue) {
    const { error } = await client
      .from('devices')
      .update({
        last_seen: nowIso,
        displayed_version: input.displayedVersion ?? null,
        build: input.build ?? null,
        client_time: Number.isFinite(clientMillis) ? new Date(clientMillis).toISOString() : null,
        clock_skew_seconds: clockSkew,
        cache_status: input.cacheStatus ?? null,
        last_error_code: input.lastError ? 'client_error' : null,
        updated_at: nowIso,
      })
      .eq('id', device.id);
    if (error) throw new HttpError('heartbeat_unavailable', 503);
  }

  const horizonEnd =
    version?.package &&
    typeof version.package === 'object' &&
    typeof version.package.horizon?.lastDate === 'string'
      ? version.package.horizon.lastDate
      : null;
  const horizonShort = !horizonEnd || horizonEnd < addLocalDays(localDateOf(now), 330);
  const { data: health, error: healthError } = await client
    .from('source_health')
    .select('last_success_at')
    .eq('source', 'hebcal')
    .maybeSingle();
  if (healthError) throw new HttpError('sync_unavailable', 503);
  const lastSuccess = health?.last_success_at ? Date.parse(health.last_success_at) : 0;
  if (horizonShort || !lastSuccess || now.getTime() - lastSuccess > 24 * 60 * 60 * 1000) {
    runInBackground(maybeRefreshCalendar(client));
  }

  return jsonResponse(request, {
    serverTime: nowIso,
    clockSkewSeconds: clockSkew,
    current:
      version && state
        ? { number: state.current_version_number, hash: version.package_hash }
        : null,
  });
}

async function handlePackage(
  request: Request,
  client: ReturnType<typeof serviceClient>,
  number: number,
): Promise<Response> {
  const { data: version, error } = await client
    .from('published_versions')
    .select('package,media_manifest')
    .eq('version_number', number)
    .maybeSingle();
  if (error) throw new HttpError('package_unavailable', 503);
  if (!version) throw new HttpError('version_not_found', 404);
  const manifest = Array.isArray(version.media_manifest)
    ? (version.media_manifest as MediaManifestItem[])
    : [];
  const ids = manifest.flatMap((item) => (typeof item.id === 'string' ? [item.id] : []));
  const assetsResult = ids.length
    ? await client.from('media_assets').select('id,storage_path').in('id', ids)
    : { data: [], error: null };
  if (assetsResult.error) throw new HttpError('media_unavailable', 503);
  const paths = new Map(
    (assetsResult.data ?? []).map((asset) => [asset.id as string, asset.storage_path as string]),
  );
  const media = await Promise.all(
    manifest.map(async (item) => {
      if (!item.id || !paths.has(item.id)) throw new HttpError('media_unavailable', 503);
      const { data, error: signError } = await client.storage
        .from('media')
        .createSignedUrl(paths.get(item.id)!, 3600);
      if (signError || !data?.signedUrl) throw new HttpError('media_unavailable', 503);
      return {
        id: item.id,
        sha256: item.sha256,
        bytes: item.bytes,
        mime: item.mime,
        url: data.signedUrl,
      };
    }),
  );
  return jsonResponse(request, { package: version.package, media });
}

Deno.serve(async (request) => {
  const cors = handleCors(request);
  if (cors) return cors;
  try {
    if (request.method !== 'POST') throw new HttpError('method_not_allowed', 405);
    const client = serviceClient();
    const device = await authenticateDevice(request, client);
    if (!device) throw new HttpError('unauthorized', 401);
    if (!(await consumeRateLimit(client, `player:${device.id}`, 12, 60))) {
      throw new HttpError('rate_limited', 429);
    }
    const parsed = PlayerRequest.safeParse(await requestJson(request));
    if (!parsed.success) throw new HttpError('invalid_request', 400);
    if (parsed.data.action === 'sync') {
      return await handleSync(request, client, device, parsed.data);
    }
    return await handlePackage(request, client, parsed.data.number);
  } catch (error) {
    return errorResponse(request, error);
  }
});
