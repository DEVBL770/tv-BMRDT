import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';
const mockUrl = process.env.MOCK_HEBCAL_URL ?? 'http://127.0.0.1:8765';
const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};
const anonymous = createClient(url, anonKey, clientOptions);
const service = createClient(url, serviceKey, clientOptions);
const adminClient = createClient(url, anonKey, clientOptions);
const nonAdminClient = createClient(url, anonKey, clientOptions);
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
  'devices',
  'device_pairings',
  'source_health',
  'daily_study_entries',
  'weather_cache',
  'rate_limits',
  'app_admin',
  'refresh_locks',
];
const seedContentId = '30000000-0000-4000-8000-000000000001';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0Z8AAAAASUVORK5CYII=',
  'base64',
);

type Device = { id: string; token: string };
type PublishedVersion = {
  id: string;
  version_number: number;
  package: Record<string, unknown>;
  package_hash: string;
  media_manifest: unknown[];
  draft_snapshot: Record<string, unknown>;
};
type Upload = {
  kind: 'image' | 'pdf' | 'pdf_page';
  mime: string;
  name: string;
  bytes: Buffer;
};

let adminToken = '';
let adminId = '';
let memberToken = '';
let memberId = '';
let primaryDevice: Device | null = null;
let pairingCode = '';
let firstPublishedVersion: PublishedVersion | null = null;
let originalContent: { body: string | null; media_ids: string[] } | null = null;
let serviceRunning = false;
const deviceIds: string[] = [];
const uploadedPaths: string[] = [];

async function edge(
  functionName: string,
  input?: Record<string, unknown>,
  options: { token?: string; headers?: Record<string, string>; method?: string } = {},
) {
  const headers: Record<string, string> = {
    apikey: anonKey,
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    ...options.headers,
  };
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    method: options.method ?? 'POST',
    headers: input ? { ...headers, 'content-type': 'application/json' } : headers,
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body: body as Record<string, unknown> };
}

function queryLocalDatabase(sql: string): { rows: Array<Record<string, string>> } {
  const output = execFileSync(
    'pnpm',
    ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
    { encoding: 'utf8' },
  );
  const jsonStart = output.search(/[\[{]/);
  if (jsonStart < 0) throw new Error('Supabase query did not return JSON.');
  const result: unknown = JSON.parse(output.slice(jsonStart));
  const rows = Array.isArray(result)
    ? result
    : typeof result === 'object' && result !== null && 'rows' in result
      ? result.rows
      : undefined;
  if (!Array.isArray(rows)) throw new Error('Supabase query JSON did not contain rows.');
  return { rows: rows as Array<Record<string, string>> };
}

function nextIp() {
  const random = randomUUID().replaceAll('-', '');
  return `2001:db8:${random.slice(0, 4)}:${random.slice(4, 8)}:${random.slice(8, 12)}:${random.slice(12, 16)}:${random.slice(16, 20)}:${random.slice(20, 24)}`;
}

async function setMockMode(mode: 'ok' | 'fail' | 'invalid') {
  const response = await fetch(`${mockUrl}/_mode`, { method: 'POST', body: mode });
  expect(response.status).toBe(204);
}

async function currentState() {
  const { data, error } = await service
    .from('public_state')
    .select('current_version_id,current_version_number')
    .eq('id', true)
    .single();
  expect(error).toBeNull();
  return data!;
}

async function currentVersion() {
  const state = await currentState();
  if (!state.current_version_id) throw new Error('A published version is required for this test.');
  const { data, error } = await service
    .from('published_versions')
    .select('id,version_number,package,package_hash,media_manifest,draft_snapshot')
    .eq('id', state.current_version_id)
    .single();
  expect(error).toBeNull();
  return { state, version: data as PublishedVersion };
}

async function pairDevice(deviceName: string): Promise<Device> {
  const pairing = await edge(
    'admin',
    { action: 'createPairingCode', deviceName },
    { token: adminToken },
  );
  expect(pairing.response.status).toBe(200);
  const paired = await edge(
    'pair',
    { code: pairing.body.code as string, deviceName },
    { headers: { 'x-forwarded-for': nextIp() } },
  );
  expect(paired.response.status).toBe(200);
  const device = { id: String(paired.body.deviceId), token: String(paired.body.token) };
  deviceIds.push(device.id);
  return device;
}

async function uploadAndFinalize(input: Upload) {
  const created = await edge(
    'admin',
    {
      action: 'createUpload',
      kind: input.kind,
      mime: input.mime,
      bytes: input.bytes.byteLength,
      originalName: input.name,
    },
    { token: adminToken },
  );
  expect(created.response.status).toBe(200);
  const path = String(created.body.path);
  uploadedPaths.push(path);
  const stored = await service.storage
    .from('media')
    .uploadToSignedUrl(path, String(created.body.token), input.bytes, {
      contentType: input.mime,
    });
  expect(stored.error).toBeNull();
  const finalized = await edge(
    'admin',
    { action: 'finalizeUpload', mediaId: created.body.mediaId as string },
    { token: adminToken },
  );
  return { created, finalized };
}

describe.sequential('Supabase local integration', () => {
  beforeAll(async () => {
    if (!anonKey || !serviceKey) throw new Error('Supabase local keys are required.');
    const health = await fetch(`${url}/rest/v1/`, { headers: { apikey: anonKey } });
    expect(health.ok).toBe(true);
    const mockHealth = await fetch(`${mockUrl}/_mode`, { method: 'POST', body: 'ok' });
    expect(mockHealth.status).toBe(204);
    serviceRunning = true;

    const email = `admin-${randomUUID()}@example.test`;
    const password = `Integration-${randomUUID()}!`;
    const { data: createdAdmin, error: createAdminError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createAdminError).toBeNull();
    adminId = createdAdmin.user!.id;
    const { error: addAdminError } = await service
      .from('app_admin')
      .insert({ id: true, user_id: adminId });
    expect(addAdminError).toBeNull();
    const { data: signedIn, error: signInError } = await adminClient.auth.signInWithPassword({
      email,
      password,
    });
    expect(signInError).toBeNull();
    adminToken = signedIn.session!.access_token;

    const memberEmail = `member-${randomUUID()}@example.test`;
    const memberPassword = `Member-${randomUUID()}!`;
    const { data: createdMember, error: createMemberError } = await service.auth.admin.createUser({
      email: memberEmail,
      password: memberPassword,
      email_confirm: true,
    });
    expect(createMemberError).toBeNull();
    memberId = createdMember.user!.id;
    const { data: memberLogin, error: memberLoginError } =
      await nonAdminClient.auth.signInWithPassword({
        email: createdMember.user!.email!,
        password: memberPassword,
      });
    expect(memberLoginError).toBeNull();
    memberToken = memberLogin.session!.access_token;

    const { data: content, error: contentError } = await service
      .from('content_items')
      .select('body,media_ids')
      .eq('id', seedContentId)
      .single();
    expect(contentError).toBeNull();
    originalContent = {
      body: content.body,
      media_ids: [...content.media_ids],
    };
  });

  afterAll(async () => {
    if (!serviceRunning) return;
    await setMockMode('ok');
    if (uploadedPaths.length) {
      await service.storage.from('media').remove(uploadedPaths);
      await service.from('media_assets').delete().in('storage_path', uploadedPaths);
    }
    if (deviceIds.length) await service.from('devices').delete().in('id', deviceIds);
    await service
      .from('minyan_exceptions')
      .delete()
      .eq('local_date', '2026-10-04')
      .eq('office', 'Min’ha');
    if (adminId) {
      await service
        .from('source_records')
        .update({
          override_value: null,
          override_by: null,
          override_expires_at: null,
        })
        .eq('override_by', adminId);
      if (originalContent) {
        await service.from('content_items').update(originalContent).eq('id', seedContentId);
      }
      await service.from('app_admin').delete().eq('user_id', adminId);
      await service.auth.admin.deleteUser(adminId);
    }
    if (memberId) await service.auth.admin.deleteUser(memberId);
  });

  it('rejects public email sign-up while allowing administrator password login', async () => {
    const signup = await anonymous.auth.signUp({
      email: `signup-${randomUUID()}@example.test`,
      password: 'Integration-test-password!',
    });
    expect(signup.error).not.toBeNull();
    expect(signup.data.user).toBeNull();
    expect(adminToken).not.toBe('');
  });

  it('grants no table privileges in the public schema to anon', () => {
    const result = queryLocalDatabase(`
      select t.table_name, p.privilege
      from information_schema.tables t
      cross join unnest(array[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ]) p(privilege)
      where t.table_schema = 'public'
        and has_table_privilege(
          'anon',
          format('%I.%I', t.table_schema, t.table_name),
          p.privilege
        )
      order by t.table_name, p.privilege
    `);
    expect(result.rows).toEqual([]);
  });

  it('rejects the service-role key on every admin action', async () => {
    const actions = [
      'createPairingCode',
      'revokeDevice',
      'refreshData',
      'publish',
      'previewPackage',
      'restore',
      'createUpload',
      'finalizeUpload',
      'deleteMedia',
      'export',
    ];
    for (const action of actions) {
      const result = await edge('admin', { action }, { token: serviceKey });
      expect(result.response.status, action).toBe(401);
      expect(result.body, action).toEqual({ error: 'unauthorized' });
    }
  });

  it('denies anonymous and non-admin table and storage access', async () => {
    const results = await Promise.all(
      tables.map(async (table) => ({
        anonymousRead: await anonymous.from(table).select('*').limit(1),
        anonymousInsert: await anonymous.from(table).insert({}),
        memberRead: await nonAdminClient.from(table).select('*').limit(1),
        memberInsert: await nonAdminClient.from(table).insert({}),
      })),
    );
    for (const result of results) {
      expect(result.anonymousRead.error).not.toBeNull();
      expect(result.anonymousInsert.error).not.toBeNull();
      expect(
        result.memberRead.error !== null ||
          (Array.isArray(result.memberRead.data) && result.memberRead.data.length === 0),
      ).toBe(true);
      expect(result.memberInsert.error).not.toBeNull();
    }
    const folder = `integration-access-${randomUUID()}`;
    const privatePath = `${folder}/private.png`;
    const stored = await service.storage
      .from('media')
      .upload(privatePath, png, { contentType: 'image/png' });
    expect(stored.error).toBeNull();
    uploadedPaths.push(privatePath);

    const adminRead = await adminClient.storage.from('media').download(privatePath);
    expect(adminRead.error).toBeNull();
    const adminListing = await adminClient.storage.from('media').list(folder);
    expect(adminListing.data?.some((file) => file.name === 'private.png')).toBe(true);
    const adminPath = `${folder}/admin.png`;
    const adminUpload = await adminClient.storage
      .from('media')
      .upload(adminPath, png, { contentType: 'image/png' });
    expect(adminUpload.error).toBeNull();
    uploadedPaths.push(adminPath);

    const anonymousListing = await anonymous.storage.from('media').list(folder);
    expect(
      anonymousListing.error !== null ||
        !anonymousListing.data?.some((file) => file.name === 'private.png'),
    ).toBe(true);
    expect((await anonymous.storage.from('media').download(privatePath)).error).not.toBeNull();
    expect(
      (
        await anonymous.storage
          .from('media')
          .upload(`${folder}/anonymous.png`, png, { contentType: 'image/png' })
      ).error,
    ).not.toBeNull();

    const memberListing = await nonAdminClient.storage.from('media').list(folder);
    expect(
      memberListing.error !== null ||
        !memberListing.data?.some((file) => file.name === 'private.png'),
    ).toBe(true);
    expect((await nonAdminClient.storage.from('media').download(privatePath)).error).not.toBeNull();
    expect(
      (
        await nonAdminClient.storage
          .from('media')
          .upload(`${folder}/member.png`, png, { contentType: 'image/png' })
      ).error,
    ).not.toBeNull();
  });

  it('allows admin draft CRUD and rejects admin workflows for a non-admin user', async () => {
    const inserted = await adminClient
      .from('minyan_rules')
      .insert({ office: 'Min’ha', time: '17:00', status: 'to_confirm' })
      .select('id')
      .single();
    expect(inserted.error).toBeNull();
    const read = await adminClient
      .from('minyan_rules')
      .select('id')
      .eq('id', inserted.data!.id)
      .single();
    expect(read.error).toBeNull();
    const updated = await adminClient
      .from('minyan_rules')
      .update({ time: '17:15' })
      .eq('id', inserted.data!.id);
    expect(updated.error).toBeNull();
    const deleted = await adminClient.from('minyan_rules').delete().eq('id', inserted.data!.id);
    expect(deleted.error).toBeNull();

    const unauthorized = await edge(
      'admin',
      { action: 'createPairingCode', deviceName: 'Refus non-admin' },
      { token: memberToken },
    );
    expect(unauthorized.response.status).toBe(403);
    expect(unauthorized.body.error).toBe('forbidden');
  });

  it('pairs a valid one-time code and returns a device token', async () => {
    const pairing = await edge(
      'admin',
      { action: 'createPairingCode', deviceName: 'Écran principal' },
      { token: adminToken },
    );
    expect(pairing.response.status).toBe(200);
    pairingCode = String(pairing.body.code);
    const paired = await edge(
      'pair',
      { code: pairingCode, deviceName: 'Écran principal' },
      { headers: { 'x-forwarded-for': nextIp() } },
    );
    expect(paired.response.status).toBe(200);
    primaryDevice = { id: String(paired.body.deviceId), token: String(paired.body.token) };
    deviceIds.push(primaryDevice.id);
    expect(primaryDevice.token.length).toBeGreaterThan(30);
    const { data: row, error } = await service
      .from('devices')
      .select('token_hash')
      .eq('id', primaryDevice.id)
      .single();
    expect(error).toBeNull();
    expect(row.token_hash).not.toBe(primaryDevice.token);
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects reuse of a consumed pairing code', async () => {
    const reused = await edge(
      'pair',
      { code: pairingCode, deviceName: 'Écran principal' },
      { headers: { 'x-forwarded-for': nextIp() } },
    );
    expect(reused.response.status).toBe(401);
  });

  it('rejects an expired pairing code', async () => {
    const expiredCode = `EXP${randomUUID().slice(0, 8)}`;
    const expiredHash = createHash('sha256').update(expiredCode.toUpperCase()).digest('hex');
    const { error } = await service.from('device_pairings').insert({
      code_hash: expiredHash,
      device_name: 'Écran expiré',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      created_by: adminId,
    });
    expect(error).toBeNull();
    const expired = await edge(
      'pair',
      { code: expiredCode, deviceName: 'Écran expiré' },
      { headers: { 'x-forwarded-for': nextIp() } },
    );
    expect(expired.response.status).toBe(401);
  });

  it('rate-limits the sixth pairing attempt in a ten-minute window', async () => {
    const ip = nextIp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await edge(
        'pair',
        { code: 'INVALID1', deviceName: 'Tentative' },
        { headers: { 'x-forwarded-for': ip } },
      );
      expect(failed.response.status).toBe(401);
    }
    const limited = await edge(
      'pair',
      { code: 'INVALID1', deviceName: 'Tentative' },
      { headers: { 'x-forwarded-for': ip } },
    );
    expect(limited.response.status).toBe(429);
  });

  it('rate-limits pairing globally across spoofed IP headers', async () => {
    await service.from('rate_limits').delete().eq('key', 'pair:global');
    const ips = Array.from({ length: 31 }, nextIp);
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const result = await edge(
          'pair',
          { code: 'ABCDEFGH', deviceName: 'Écran de test' },
          { headers: { 'x-forwarded-for': ips[attempt]! } },
        );
        expect(result.response.status).toBe(401);
      }
      const blocked = await edge(
        'pair',
        { code: 'ABCDEFGH', deviceName: 'Écran de test' },
        { headers: { 'x-forwarded-for': ips[30]! } },
      );
      expect(blocked.response.status).toBe(429);
      expect(blocked.body).toEqual({ error: 'rate_limited' });
    } finally {
      await service.from('rate_limits').delete().eq('key', 'pair:global');
    }
  });

  it('rejects unknown player tokens and denies device-token PostgREST access', async () => {
    const unknown = await edge(
      'player',
      { action: 'sync' },
      { headers: { 'x-device-token': 'fake-device-token' } },
    );
    expect(unknown.response.status).toBe(401);
    const rest = await fetch(`${url}/rest/v1/public_state`, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${primaryDevice!.token}`,
      },
    });
    expect(rest.ok).toBe(false);
  });

  it('refreshes the calendar directly from the player background sync', async () => {
    await setMockMode('ok');
    const { error: deleteError } = await service
      .from('source_health')
      .delete()
      .eq('source', 'hebcal');
    expect(deleteError).toBeNull();
    const startedAt = Date.now();
    const device = await pairDevice('TV refresh direct');
    const synced = await edge(
      'player',
      { action: 'sync', clientTime: new Date().toISOString(), cacheStatus: 'empty' },
      { headers: { 'x-device-token': device.token } },
    );
    expect(synced.response.status).toBe(200);

    let lastSuccessAt: string | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const { data, error } = await service
        .from('source_health')
        .select('last_success_at')
        .eq('source', 'hebcal')
        .maybeSingle();
      expect(error).toBeNull();
      lastSuccessAt = data?.last_success_at ?? null;
      if (lastSuccessAt && Date.parse(lastSuccessAt) >= startedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(lastSuccessAt).not.toBeNull();
    expect(Date.parse(lastSuccessAt!)).toBeGreaterThanOrEqual(startedAt);

    let refreshStillRunning = true;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const { data, error } = await service
        .from('refresh_locks')
        .select('lock_name')
        .eq('lock_name', 'calendar-refresh')
        .maybeSingle();
      expect(error).toBeNull();
      refreshStillRunning = data !== null;
      if (!refreshStillRunning) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(refreshStillRunning).toBe(false);
  });

  it('refreshes at least 400 calendar days and records source health success', async () => {
    const refreshed = await edge('admin', { action: 'refreshData' }, { token: adminToken });
    expect(refreshed.response.status).toBe(200);
    const { count, error } = await service
      .from('jewish_days')
      .select('local_date', { count: 'exact', head: true });
    expect(error).toBeNull();
    expect(count).toBeGreaterThanOrEqual(400);
    const { data: health, error: healthError } = await service
      .from('source_health')
      .select('last_success_at,data_hash')
      .eq('source', 'hebcal')
      .single();
    expect(healthError).toBeNull();
    expect(health.last_success_at).toBeTruthy();
    expect(health.data_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('publishes Hebcal gematria and the weekly parasha in the package', async () => {
    await setMockMode('ok');
    const refreshed = await edge('admin', { action: 'refreshData' }, { token: adminToken });
    expect(refreshed.response.status, JSON.stringify(refreshed.body)).toBe(200);
    const published = await edge('admin', { action: 'publish' }, { token: adminToken });
    expect(published.response.status, JSON.stringify(published.body)).toBe(200);

    const current = await currentVersion();
    const days = current.version.package.days as Array<{
      date: string;
      hebrew: { he: string };
      parasha?: { fr: string; he?: string };
    }>;
    const holHamoed = days.find(({ date }) => date === '2026-09-30');
    const bereshit = days.find(({ date }) => date === '2026-10-10');
    expect(holHamoed?.hebrew.he).toBe('י״ט תשרי תשפ״ז');
    expect(bereshit?.parasha).toMatchObject({
      fr: expect.stringMatching(/^Paracha \S/u),
      he: 'פרשת בראשית',
    });
  });

  it('allows admin-only source-record overrides while preserving original values', async () => {
    const { data: sourceRecord, error } = await service
      .from('source_records')
      .select('id,value')
      .eq('kind', 'zmanim')
      .limit(1)
      .single();
    expect(error).toBeNull();
    const override = await adminClient
      .from('source_records')
      .update({
        override_value: sourceRecord.value,
        override_by: adminId,
        override_expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq('id', sourceRecord.id);
    expect(override.error).toBeNull();
    const mutation = await adminClient
      .from('source_records')
      .update({ value: sourceRecord.value })
      .eq('id', sourceRecord.id);
    expect(mutation.error).not.toBeNull();
  });

  it('publishes a version visible to player sync', async () => {
    const published = await edge('admin', { action: 'publish' }, { token: adminToken });
    expect(published.response.status, JSON.stringify(published.body)).toBe(200);
    const current = await currentVersion();
    firstPublishedVersion = current.version;
    const sync = await edge(
      'player',
      {
        action: 'sync',
        knownVersion: Math.max(0, current.state.current_version_number - 1),
        clientTime: new Date().toISOString(),
      },
      { headers: { 'x-device-token': primaryDevice!.token } },
    );
    expect(sync.response.status).toBe(200);
    expect(sync.body.current).toEqual({
      number: current.state.current_version_number,
      hash: current.version.package_hash,
    });
  });

  it('serves only the published package after a draft content change', async () => {
    const current = await currentVersion();
    expect(current.version.id).toBe(firstPublishedVersion!.id);
    const before = await edge(
      'player',
      { action: 'package', number: current.state.current_version_number },
      { headers: { 'x-device-token': primaryDevice!.token } },
    );
    expect(before.response.status).toBe(200);
    expect(before.body.package).toEqual(firstPublishedVersion!.package);
    const update = await adminClient
      .from('content_items')
      .update({ body: `Brouillon ${randomUUID()}` })
      .eq('id', seedContentId);
    expect(update.error).toBeNull();
    const after = await edge(
      'player',
      { action: 'package', number: current.state.current_version_number },
      { headers: { 'x-device-token': primaryDevice!.token } },
    );
    expect(after.body.package).toEqual(firstPublishedVersion!.package);
    const restoredDraft = await adminClient
      .from('content_items')
      .update(originalContent!)
      .eq('id', seedContentId);
    expect(restoredDraft.error).toBeNull();
  });

  it('rate-limits player requests to twelve per device per minute', async () => {
    const device = await pairDevice('Écran limite');
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const allowed = await edge(
        'player',
        { action: 'sync' },
        { headers: { 'x-device-token': device.token } },
      );
      expect(allowed.response.status).toBe(200);
    }
    const limited = await edge(
      'player',
      { action: 'sync' },
      { headers: { 'x-device-token': device.token } },
    );
    expect(limited.response.status).toBe(429);
  });

  it('serves cached weather only to an authenticated device or administrator', async () => {
    const cachedAt = new Date().toISOString();
    const { error } = await service.from('weather_cache').upsert(
      {
        id: true,
        temperature_c: 17.5,
        symbol: 'clearsky_day',
        updated_at: cachedAt,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        attribution: 'Météo : MET Norway',
        payload: {},
      },
      { onConflict: 'id' },
    );
    expect(error).toBeNull();
    const unauthorized = await edge('weather', undefined, { method: 'GET' });
    expect(unauthorized.response.status).toBe(401);
    const device = await pairDevice('Écran météo');
    const weather = await edge('weather', undefined, {
      method: 'GET',
      headers: { 'x-device-token': device.token },
    });
    expect(weather.response.status).toBe(200);
    expect(weather.body.temperatureC).toBe(17.5);
    const adminWeather = await edge('weather', undefined, {
      method: 'GET',
      token: adminToken,
    });
    expect(adminWeather.response.status).toBe(200);
  });

  it('preserves calendar rows and publication after a Hebcal outage', async () => {
    const rowsBefore = await service
      .from('jewish_days')
      .select('local_date,hebrew_date')
      .order('local_date');
    const stateBefore = await currentState();
    await setMockMode('fail');
    const failed = await edge('admin', { action: 'refreshData' }, { token: adminToken });
    expect(failed.response.status, JSON.stringify(failed.body)).toBe(502);
    expect(failed.body.error).toBe('calendar_refresh_failed');
    const rowsAfter = await service
      .from('jewish_days')
      .select('local_date,hebrew_date')
      .order('local_date');
    expect(rowsAfter.data).toEqual(rowsBefore.data);
    expect(await currentState()).toEqual(stateBefore);
    const { data: health } = await service
      .from('source_health')
      .select('last_failure_at,last_error_code')
      .eq('source', 'hebcal')
      .single();
    expect(health.last_failure_at).toBeTruthy();
    expect(health.last_error_code).toBeTruthy();
    await setMockMode('ok');
  });

  it('rejects an invalid Hebcal payload without replacing calendar data or publication', async () => {
    const rowsBefore = await service
      .from('jewish_days')
      .select('local_date,hebrew_date')
      .order('local_date');
    const stateBefore = await currentState();
    await setMockMode('invalid');
    const failed = await edge('admin', { action: 'refreshData' }, { token: adminToken });
    expect(failed.response.status, JSON.stringify(failed.body)).toBe(502);
    expect(failed.body.error).toBe('calendar_refresh_failed');
    const rowsAfter = await service
      .from('jewish_days')
      .select('local_date,hebrew_date')
      .order('local_date');
    expect(rowsAfter.data).toEqual(rowsBefore.data);
    expect(await currentState()).toEqual(stateBefore);
    const { data: health } = await service
      .from('source_health')
      .select('last_failure_at,last_error_code')
      .eq('source', 'hebcal')
      .single();
    expect(health.last_failure_at).toBeTruthy();
    expect(health.last_error_code).toBe('invalid_response');
    await setMockMode('ok');
  });

  it('updates heartbeat time and online status on player sync', async () => {
    const staleTime = new Date(Date.now() - 120_000).toISOString();
    const stale = await service
      .from('devices')
      .update({ last_seen: staleTime })
      .eq('id', primaryDevice!.id);
    expect(stale.error).toBeNull();
    const sync = await edge(
      'player',
      { action: 'sync', clientTime: new Date().toISOString() },
      { headers: { 'x-device-token': primaryDevice!.token } },
    );
    expect(sync.response.status).toBe(200);
    const { data: status, error } = await service
      .from('device_status')
      .select('last_seen,online')
      .eq('id', primaryDevice!.id)
      .single();
    expect(error).toBeNull();
    expect(Date.parse(status.last_seen)).toBeGreaterThan(Date.parse(staleTime));
    expect(status.online).toBe(true);
  });

  it('denies admin edits and direct RPC calls on published versions', async () => {
    const version = firstPublishedVersion!;
    const read = await adminClient
      .from('published_versions')
      .select('id')
      .eq('id', version.id)
      .single();
    expect(read.error).toBeNull();
    const update = await adminClient
      .from('published_versions')
      .update({ package: {} })
      .eq('id', version.id);
    expect(update.error).not.toBeNull();
    const deleted = await adminClient.from('published_versions').delete().eq('id', version.id);
    expect(deleted.error).not.toBeNull();
    const directPublish = await adminClient.rpc('publish_package', {
      p_expected_number: version.version_number + 1,
      p_package: version.package,
      p_hash: version.package_hash,
      p_manifest: version.media_manifest,
      p_snapshot: version.draft_snapshot,
      p_source: 'admin',
      p_restored_from: null,
      p_actor: adminId,
    });
    expect(directPublish.error).not.toBeNull();
  });

  it('allows only one of two concurrent publications for the same expected version', async () => {
    const { state, version } = await currentVersion();
    const expected = state.current_version_number + 1;
    const publishArgs = {
      p_expected_number: expected,
      p_package: version.package,
      p_hash: version.package_hash,
      p_manifest: version.media_manifest,
      p_snapshot: version.draft_snapshot,
      p_source: 'admin',
      p_restored_from: null,
      p_actor: adminId,
    };
    const results = await Promise.all([
      service.rpc('publish_package', publishArgs),
      service.rpc('publish_package', publishArgs),
    ]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(
      results.filter((result) => result.error?.message.includes('version_conflict')),
    ).toHaveLength(1);
  });

  it('changes only Sunday Min’ha planning without altering Monday or sunset', async () => {
    const original = firstPublishedVersion!.package as {
      days: Array<{ date: string; zmanim: { sunset?: { instant?: string } } }>;
    };
    const exception = await adminClient.from('minyan_exceptions').upsert(
      {
        local_date: '2026-10-04',
        office: 'Min’ha',
        time: '16:30',
        cancelled: false,
      },
      { onConflict: 'local_date,office' },
    );
    expect(exception.error).toBeNull();
    const preview = await edge('admin', { action: 'previewPackage' }, { token: adminToken });
    expect(preview.response.status).toBe(200);
    const compiled = preview.body.package as {
      days: Array<{ date: string; zmanim: { sunset?: { instant?: string } } }>;
      minyanim: Array<{ date: string; office: string; time: string | null }>;
    };
    const minyanAt = (date: string) =>
      compiled.minyanim.find((item) => item.date === date && item.office === 'Min’ha')?.time;
    expect(minyanAt('2026-10-04')).toBe('16:30');
    expect(minyanAt('2026-10-05')).toBe('19:00');
    expect(compiled.days.find((day) => day.date === '2026-10-04')?.zmanim.sunset?.instant).toBe(
      original.days.find((day) => day.date === '2026-10-04')?.zmanim.sunset?.instant,
    );
  });

  it('restores a new version while preserving the old package and auditing the action', async () => {
    const beforeRestore = await currentState();
    const original = firstPublishedVersion!;
    const restored = await edge(
      'admin',
      { action: 'restore', versionId: original.id },
      { token: adminToken },
    );
    expect(restored.response.status).toBe(200);
    expect(restored.body.restoredFrom).toBe(original.id);
    expect(restored.body.versionNumber).toBe(beforeRestore.current_version_number + 1);
    const afterRestore = await currentState();
    expect(afterRestore.current_version_number).toBe(beforeRestore.current_version_number + 1);
    const { data: unchanged, error } = await service
      .from('published_versions')
      .select('package,package_hash,version_number')
      .eq('id', original.id)
      .single();
    expect(error).toBeNull();
    expect(unchanged.package).toEqual(original.package);
    expect(unchanged.package_hash).toBe(original.package_hash);
    const { data: audit } = await service
      .from('audit_events')
      .select('id')
      .eq('action', 'restore_draft')
      .eq('record_id', original.id)
      .limit(1);
    expect(audit?.length).toBeGreaterThan(0);
  });

  it('rejects revoked player tokens', async () => {
    const revoked = await edge(
      'admin',
      { action: 'revokeDevice', id: primaryDevice!.id },
      { token: adminToken },
    );
    expect(revoked.response.status).toBe(200);
    const sync = await edge(
      'player',
      { action: 'sync' },
      { headers: { 'x-device-token': primaryDevice!.token } },
    );
    expect(sync.response.status).toBe(401);
  });

  it('omits device and pairing hashes from administrative exports', async () => {
    const exported = await edge('admin', { action: 'export' }, { token: adminToken });
    expect(exported.response.status).toBe(200);
    const exportedTables = exported.body.tables as Record<string, Array<Record<string, unknown>>>;
    expect(exportedTables.devices.find((row) => row.id === primaryDevice!.id)).not.toHaveProperty(
      'token_hash',
    );
    expect(exportedTables.device_pairings[0]).not.toHaveProperty('code_hash');
    expect(JSON.stringify(exported.body)).not.toContain(serviceKey);
  });

  it('rejects restore and republishing when a published media object is missing', async () => {
    const upload = await uploadAndFinalize({
      kind: 'image',
      mime: 'image/png',
      name: 'media.png',
      bytes: png,
    });
    expect(upload.finalized.body.status).toBe('ready');
    const mediaId = String(upload.created.body.mediaId);
    const asset = await service
      .from('media_assets')
      .select('storage_path')
      .eq('id', mediaId)
      .single();
    expect(asset.error).toBeNull();
    const attach = await adminClient
      .from('content_items')
      .update({ media_ids: [mediaId] })
      .eq('id', seedContentId);
    expect(attach.error).toBeNull();
    const publish = await edge('admin', { action: 'publish' }, { token: adminToken });
    expect(publish.response.status).toBe(200);
    const mediaVersion = await currentState();
    const deletion = await edge(
      'admin',
      { action: 'deleteMedia', id: mediaId },
      { token: adminToken },
    );
    expect(deletion.response.status).toBe(409);
    expect(deletion.body.error).toBe('media_in_use');
    const removed = await service.storage.from('media').remove([asset.data.storage_path]);
    expect(removed.error).toBeNull();
    const republish = await edge('admin', { action: 'publish' }, { token: adminToken });
    expect(republish.response.status).toBe(422);
    expect(republish.body.error).toBe('media_not_ready');
    const restore = await edge(
      'admin',
      { action: 'restore', versionId: mediaVersion.current_version_id as string },
      { token: adminToken },
    );
    expect(restore.response.status).toBe(409);
    expect(restore.body.error).toBe('restore_media_missing');
    expect(restore.body.mediaIds).toEqual([mediaId]);
    expect(await currentState()).toEqual(mediaVersion);
  });

  it('rejects uploads above the image size limit', async () => {
    const oversized = await edge(
      'admin',
      {
        action: 'createUpload',
        kind: 'image',
        mime: 'image/png',
        bytes: 8 * 1024 * 1024 + 1,
        originalName: 'oversized.png',
      },
      { token: adminToken },
    );
    expect(oversized.response.status).toBe(413);
  });

  it('generates a safe opaque storage path for hostile filenames', async () => {
    const upload = await uploadAndFinalize({
      kind: 'image',
      mime: 'image/png',
      name: `../../evil.php\u0000${'é'.repeat(200)}`,
      bytes: png,
    });
    expect(upload.finalized.body.status).toBe('ready');
    expect(String(upload.created.body.path)).toMatch(/^uploads\/[0-9a-f-]+\.png$/);
    expect(String(upload.created.body.path)).not.toContain('evil');
    const deleted = await edge(
      'admin',
      { action: 'deleteMedia', id: upload.created.body.mediaId as string },
      { token: adminToken },
    );
    expect(deleted.response.status).toBe(200);
  });

  it('rejects PNG bytes renamed and declared as a PDF', async () => {
    const upload = await uploadAndFinalize({
      kind: 'pdf',
      mime: 'application/pdf',
      name: 'renamed.pdf',
      bytes: png,
    });
    expect(upload.finalized.body.status).toBe('rejected');
  });

  it('rejects text bytes declared as a JPEG', async () => {
    const upload = await uploadAndFinalize({
      kind: 'image',
      mime: 'image/jpeg',
      name: 'text.jpg',
      bytes: Buffer.from('not a JPEG'),
    });
    expect(upload.finalized.body.status).toBe('rejected');
  });

  it('rejects a PDF with seven pages', async () => {
    const upload = await uploadAndFinalize({
      kind: 'pdf',
      mime: 'application/pdf',
      name: 'seven-pages.pdf',
      bytes: Buffer.from(`%PDF-1.7\n${'/Type /Page\n'.repeat(7)}%%EOF`),
    });
    expect(upload.finalized.body.status).toBe('rejected');
  });

  it('keeps service-role credentials out of the browser bundle', async () => {
    const assets = await readdir(join(process.cwd(), 'dist', 'assets'));
    const bundles = await Promise.all(
      assets
        .filter((file) => file.endsWith('.js'))
        .map((file) => readFile(join(process.cwd(), 'dist', 'assets', file), 'utf8')),
    );
    const bundle = bundles.join('\n');
    expect(bundle).not.toContain(serviceKey);
    expect(bundle).not.toContain('service_role');
  });
});
