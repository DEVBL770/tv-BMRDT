import { z } from 'zod';
import {
  compileSnapshot,
  publishCompiled,
  readCurrentDays,
  readSnapshot,
  refreshCalendar,
  restoreSnapshot,
} from '../_shared/admin.ts';
import {
  errorResponse,
  handleCors,
  HttpError,
  isServiceRoleRequest,
  jsonResponse,
  requestJson,
  requireAdmin,
  serviceClient,
  sha256Hex,
} from '../_shared/backend.ts';

const ActionSchema = z.object({ action: z.string().min(1).max(40) });
const CreatePairingSchema = z.object({
  action: z.literal('createPairingCode'),
  deviceName: z.string().trim().min(1).max(100),
});
const RevokeDeviceSchema = z.object({
  action: z.literal('revokeDevice'),
  id: z.uuid(),
});
const RestoreSchema = z.object({
  action: z.literal('restore'),
  versionId: z.uuid(),
});
const UploadSchema = z.object({
  action: z.literal('createUpload'),
  kind: z.enum(['image', 'pdf', 'pdf_page']),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  bytes: z.number().int().positive(),
  originalName: z.string().trim().min(1).max(500),
  parentId: z.uuid().optional(),
  pageIndex: z.number().int().min(1).max(6).optional(),
});
const MediaIdSchema = z.object({ action: z.literal('finalizeUpload'), mediaId: z.uuid() });
const DeleteMediaSchema = z.object({ action: z.literal('deleteMedia'), id: z.uuid() });

const pairingAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function pairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => pairingAlphabet[byte & 31]).join('');
}

function sanitizedName(value: string): string {
  return (
    value
      .normalize('NFC')
      .split(/[\\/]/u)
      .at(-1)
      ?.replace(/[\u0000-\u001f\u007f]/gu, '')
      .replace(/[^\p{L}\p{N} ._()'-]/gu, '_')
      .trim()
      .slice(0, 100) || 'fichier'
  );
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'application/pdf':
      return 'pdf';
    default:
      throw new HttpError('invalid_media', 400);
  }
}

function validateUpload(
  kind: 'image' | 'pdf' | 'pdf_page',
  mime: string,
  bytes: number,
  parentId?: string,
  pageIndex?: number,
): void {
  const image = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
  if ((kind === 'pdf') !== (mime === 'application/pdf') || (kind !== 'pdf' && !image)) {
    throw new HttpError('invalid_media', 400);
  }
  const limit = kind === 'pdf' ? 12 * 1024 * 1024 : 8 * 1024 * 1024;
  if (bytes > limit) throw new HttpError('media_too_large', 413);
  if (kind === 'pdf_page' && (!parentId || !pageIndex)) {
    throw new HttpError('invalid_media', 400);
  }
}

async function createPairingCode(
  client: ReturnType<typeof serviceClient>,
  input: z.infer<typeof CreatePairingSchema>,
  actorId: string,
) {
  const code = pairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await client.from('device_pairings').insert({
    code_hash: await sha256Hex(code),
    device_name: input.deviceName,
    expires_at: expiresAt,
    created_by: actorId,
  });
  if (error) throw new HttpError('pairing_unavailable', 503);
  return { code, expiresAt };
}

async function createUpload(
  client: ReturnType<typeof serviceClient>,
  input: z.infer<typeof UploadSchema>,
  actorId: string,
) {
  validateUpload(input.kind, input.mime, input.bytes, input.parentId, input.pageIndex);
  const id = crypto.randomUUID();
  const path = `uploads/${id}.${extensionForMime(input.mime)}`;
  const { error: insertError } = await client.from('media_assets').insert({
    id,
    storage_path: path,
    kind: input.kind,
    mime: input.mime,
    bytes: input.bytes,
    parent_id: input.parentId ?? null,
    page_index: input.pageIndex ?? null,
    original_name_label: sanitizedName(input.originalName),
    status: 'pending',
    created_by: actorId,
  });
  if (insertError) throw new HttpError('upload_unavailable', 503);
  const { data, error } = await client.storage.from('media').createSignedUploadUrl(path);
  if (error || !data?.signedUrl || !data.token) {
    await client.from('media_assets').delete().eq('id', id);
    throw new HttpError('upload_unavailable', 503);
  }
  return {
    mediaId: id,
    path: data.path,
    url: data.signedUrl,
    token: data.token,
    expiresIn: 7200,
  };
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = view.getUint16(offset);
    if (length < 7 || offset + length > bytes.length) return null;
    if (frameMarkers.has(marker)) {
      return {
        height: view.getUint16(offset + 3),
        width: view.getUint16(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = ascii(12, 4);
  if (chunk === 'VP8X') {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return {
      width: 1 + ((b2 & 0x3f) << 8) + b1,
      height: 1 + ((b4 & 0x0f) << 10) + (b3 << 2) + ((b2 & 0xc0) >> 6),
    };
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  return null;
}

function sniffMedia(
  bytes: Uint8Array,
  mime: string,
): { width?: number; height?: number; pages?: number } | null {
  if (mime === 'image/jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
    const dimensions = readJpegDimensions(bytes);
    return dimensions ? { ...dimensions } : null;
  }
  if (mime === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!signature.every((value, index) => bytes[index] === value)) return null;
    const dimensions = readPngDimensions(bytes);
    return dimensions ? { ...dimensions } : null;
  }
  if (mime === 'image/webp') {
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...bytes.subarray(offset, offset + length));
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return null;
    const dimensions = readWebpDimensions(bytes);
    return dimensions ? { ...dimensions } : null;
  }
  if (mime === 'application/pdf') {
    const header = new TextDecoder().decode(bytes.subarray(0, 8));
    if (!header.startsWith('%PDF-')) return null;
    const pages = new TextDecoder('latin1').decode(bytes).match(/\/Type\s*\/Page\b/gu)?.length ?? 0;
    return pages > 0 ? { pages } : null;
  }
  return null;
}

async function rejectUpload(
  client: ReturnType<typeof serviceClient>,
  asset: { id: string; storage_path: string },
  code: string,
) {
  await client.storage.from('media').remove([asset.storage_path]);
  await client
    .from('media_assets')
    .update({ status: 'rejected', error_code: code, updated_at: new Date().toISOString() })
    .eq('id', asset.id);
  return { mediaId: asset.id, status: 'rejected', error: code };
}

async function finalizeUpload(
  client: ReturnType<typeof serviceClient>,
  input: z.infer<typeof MediaIdSchema>,
) {
  const { data: asset, error } = await client
    .from('media_assets')
    .select('id,storage_path,kind,mime,status')
    .eq('id', input.mediaId)
    .maybeSingle();
  if (error) throw new HttpError('media_unavailable', 503);
  if (!asset || asset.status !== 'pending') throw new HttpError('media_not_found', 404);
  const { data: file, error: downloadError } = await client.storage
    .from('media')
    .download(asset.storage_path);
  if (downloadError || !file) return await rejectUpload(client, asset, 'upload_missing');
  const buffer = new Uint8Array(await file.arrayBuffer());
  const maxBytes = asset.kind === 'pdf' ? 12 * 1024 * 1024 : 8 * 1024 * 1024;
  if (buffer.byteLength > maxBytes) return await rejectUpload(client, asset, 'media_too_large');
  const details = sniffMedia(buffer, asset.mime);
  if (!details) return await rejectUpload(client, asset, 'invalid_media');
  if (
    (details.width !== undefined && (details.width < 1 || details.width > 8000)) ||
    (details.height !== undefined && (details.height < 1 || details.height > 8000))
  ) {
    return await rejectUpload(client, asset, 'media_dimensions_too_large');
  }
  if (details.pages !== undefined && details.pages > 6) {
    return await rejectUpload(client, asset, 'pdf_page_limit');
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const { error: updateError } = await client
    .from('media_assets')
    .update({
      status: 'ready',
      error_code: null,
      bytes: buffer.byteLength,
      sha256,
      width: details.width ?? null,
      height: details.height ?? null,
      pages: details.pages ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', asset.id);
  if (updateError) throw new HttpError('media_unavailable', 503);
  return {
    mediaId: asset.id,
    status: 'ready',
    sha256,
    bytes: buffer.byteLength,
    mime: asset.mime,
    ...details,
  };
}

async function deleteMedia(
  client: ReturnType<typeof serviceClient>,
  input: z.infer<typeof DeleteMediaSchema>,
) {
  const { data: asset, error } = await client
    .from('media_assets')
    .select('id,storage_path')
    .eq('id', input.id)
    .maybeSingle();
  if (error) throw new HttpError('media_unavailable', 503);
  if (!asset) throw new HttpError('media_not_found', 404);
  const { data: versions, error: versionsError } = await client
    .from('published_versions')
    .select('package,media_manifest')
    .order('version_number', { ascending: false })
    .limit(1000);
  if (versionsError) throw new HttpError('media_unavailable', 503);
  const inUse = (versions ?? []).some((version) => {
    const packageMedia = Array.isArray(version.package?.media) ? version.package.media : [];
    const manifest = Array.isArray(version.media_manifest) ? version.media_manifest : [];
    const content = Array.isArray(version.package?.content) ? version.package.content : [];
    return (
      packageMedia.some((item: { id?: string }) => item.id === input.id) ||
      manifest.some((item: { id?: string }) => item.id === input.id) ||
      content.some((item: { mediaIds?: string[] }) => item.mediaIds?.includes(input.id))
    );
  });
  if (inUse) throw new HttpError('media_in_use', 409);
  const { error: storageError } = await client.storage.from('media').remove([asset.storage_path]);
  if (storageError) throw new HttpError('media_unavailable', 503);
  const { error: deleteError } = await client.from('media_assets').delete().eq('id', input.id);
  if (deleteError) throw new HttpError('media_unavailable', 503);
  return { deleted: true };
}

async function selectAllRows(
  client: ReturnType<typeof serviceClient>,
  table: string,
  columns = '*',
) {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .range(offset, offset + pageSize - 1);
    if (error) throw new HttpError('export_unavailable', 503);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

async function exportData(client: ReturnType<typeof serviceClient>) {
  const tables = [
    'settings',
    'minyan_rules',
    'minyan_exceptions',
    'source_records',
    'jewish_days',
    'content_items',
    'media_assets',
    'layout_draft',
    'published_versions',
    'public_state',
    'audit_events',
    'source_health',
    'daily_study_entries',
    'weather_cache',
    'app_admin',
  ];
  const entries = await Promise.all(
    tables.map(async (table) => {
      return [table, await selectAllRows(client, table)] as const;
    }),
  );
  const devices = await selectAllRows(
    client,
    'devices',
    [
      'id',
      'device_name',
      'revoked_at',
      'last_seen',
      'displayed_version',
      'build',
      'client_time',
      'clock_skew_seconds',
      'cache_status',
      'last_error_code',
      'created_at',
      'updated_at',
    ].join(','),
  );
  const pairings = await selectAllRows(
    client,
    'device_pairings',
    ['id', 'device_name', 'expires_at', 'used_at', 'created_by', 'created_at'].join(','),
  );
  const media = await selectAllRows(
    client,
    'media_assets',
    'id,bucket,storage_path,sha256,bytes,mime',
  );
  return {
    exportedAt: new Date().toISOString(),
    tables: {
      ...Object.fromEntries(entries),
      devices,
      device_pairings: pairings,
    },
    mediaPaths: media,
  };
}

Deno.serve(async (request) => {
  const cors = handleCors(request);
  if (cors) return cors;
  try {
    if (request.method !== 'POST') throw new HttpError('method_not_allowed', 405);
    const input = await requestJson(request);
    const action = ActionSchema.safeParse(input);
    if (!action.success) throw new HttpError('invalid_request', 400);
    const client = serviceClient();
    const internalRefresh = action.data.action === 'refreshData' && isServiceRoleRequest(request);
    const actor = internalRefresh ? null : await requireAdmin(request);
    switch (action.data.action) {
      case 'createPairingCode': {
        const parsed = CreatePairingSchema.safeParse(input);
        if (!parsed.success) throw new HttpError('invalid_request', 400);
        return jsonResponse(request, await createPairingCode(client, parsed.data, actor!.id));
      }
      case 'revokeDevice': {
        const parsed = RevokeDeviceSchema.safeParse(input);
        if (!parsed.success) throw new HttpError('invalid_request', 400);
        const now = new Date().toISOString();
        const { data, error } = await client
          .from('devices')
          .update({ revoked_at: now, updated_at: now })
          .eq('id', parsed.data.id)
          .select('id')
          .maybeSingle();
        if (error) throw new HttpError('device_unavailable', 503);
        if (!data) throw new HttpError('device_not_found', 404);
        return jsonResponse(request, { id: data.id, revokedAt: now });
      }
      case 'refreshData': {
        let ownerId: string | null = null;
        if (!internalRefresh) {
          ownerId = crypto.randomUUID();
          const { data: acquired, error } = await client.rpc('try_acquire_refresh_lock', {
            p_lock_name: 'calendar-refresh',
            p_owner_id: ownerId,
            p_ttl_seconds: 600,
          });
          if (error) throw new HttpError('refresh_unavailable', 503);
          if (acquired !== true) throw new HttpError('refresh_in_progress', 409);
        }
        try {
          return jsonResponse(request, await refreshCalendar(client, actor?.id ?? null));
        } finally {
          if (ownerId) {
            await client.rpc('release_refresh_lock', {
              p_lock_name: 'calendar-refresh',
              p_owner_id: ownerId,
            });
          }
        }
      }
      case 'publish':
      case 'previewPackage': {
        const snapshot = await readSnapshot(client);
        const days = await readCurrentDays(client);
        const { data: state, error } = await client
          .from('public_state')
          .select('current_version_number')
          .eq('id', true)
          .maybeSingle();
        if (error) throw new HttpError('publish_unavailable', 503);
        const compiled = await compileSnapshot(
          client,
          snapshot,
          days,
          (state?.current_version_number ?? 0) + 1,
        );
        if (action.data.action === 'previewPackage') {
          return jsonResponse(request, { package: compiled.package, hash: compiled.packageHash });
        }
        const published = await publishCompiled(client, snapshot, compiled, 'admin', actor!.id);
        return jsonResponse(request, published);
      }
      case 'restore': {
        const parsed = RestoreSchema.safeParse(input);
        if (!parsed.success) throw new HttpError('invalid_request', 400);
        const { data: version, error } = await client
          .from('published_versions')
          .select('draft_snapshot')
          .eq('id', parsed.data.versionId)
          .maybeSingle();
        if (error) throw new HttpError('restore_unavailable', 503);
        if (!version) throw new HttpError('version_not_found', 404);
        const snapshot = version.draft_snapshot as Parameters<typeof restoreSnapshot>[1];
        const referencedIds = [
          ...new Set(snapshot.content.flatMap((item) => item.media_ids ?? [])),
        ];
        if (referencedIds.length) {
          const { data: assets, error: assetError } = await client
            .from('media_assets')
            .select('id,status,storage_path')
            .in('id', referencedIds);
          if (assetError) throw new HttpError('restore_unavailable', 503);
          const available = new Set<string>();
          for (const asset of assets ?? []) {
            if (asset.status !== 'ready') continue;
            const separator = asset.storage_path.lastIndexOf('/');
            const directory = separator === -1 ? '' : asset.storage_path.slice(0, separator);
            const filename = asset.storage_path.slice(separator + 1);
            const { data: files, error: storageError } = await client.storage
              .from('media')
              .list(directory, { search: filename });
            if (!storageError && files?.some((file) => file.name === filename)) {
              available.add(asset.id);
            }
          }
          const missing = referencedIds.filter((id) => !available.has(id));
          if (missing.length) {
            throw new HttpError('restore_media_missing', 409, { mediaIds: missing });
          }
        }
        const days = await readCurrentDays(client);
        const { data: state, error: stateError } = await client
          .from('public_state')
          .select('current_version_number')
          .eq('id', true)
          .maybeSingle();
        if (stateError) throw new HttpError('restore_unavailable', 503);
        const compiled = await compileSnapshot(
          client,
          snapshot,
          days,
          (state?.current_version_number ?? 0) + 1,
        );
        const published = await publishCompiled(
          client,
          snapshot,
          compiled,
          'restore',
          actor!.id,
          parsed.data.versionId,
        );
        await restoreSnapshot(client, snapshot, actor!.id);
        const { error: auditError } = await client.from('audit_events').insert({
          actor_id: actor!.id,
          action: 'restore_draft',
          table_name: 'published_versions',
          record_id: parsed.data.versionId,
          after_data: { publishedVersionId: published.id, versionNumber: published.versionNumber },
          version_id: published.id,
        });
        if (auditError) throw new HttpError('restore_unavailable', 503);
        return jsonResponse(request, { ...published, restoredFrom: parsed.data.versionId });
      }
      case 'createUpload': {
        const parsed = UploadSchema.safeParse(input);
        if (!parsed.success) throw new HttpError('invalid_request', 400);
        return jsonResponse(request, await createUpload(client, parsed.data, actor!.id));
      }
      case 'finalizeUpload': {
        const parsed = MediaIdSchema.safeParse(input);
        if (!parsed.success) throw new HttpError('invalid_request', 400);
        return jsonResponse(request, await finalizeUpload(client, parsed.data));
      }
      case 'deleteMedia': {
        const parsed = DeleteMediaSchema.safeParse(input);
        if (!parsed.success) throw new HttpError('invalid_request', 400);
        return jsonResponse(request, await deleteMedia(client, parsed.data));
      }
      case 'export':
        return jsonResponse(request, await exportData(client));
      default:
        throw new HttpError('unknown_action', 400);
    }
  } catch (error) {
    return errorResponse(request, error);
  }
});
