import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import type { Database } from '../src/lib/database.types';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const contentId = '30000000-0000-4000-8000-000000000001';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0Z8AAAAASUVORK5CYII=',
  'base64',
);
const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};
type ServiceClient = ReturnType<typeof createClient<Database>>;

async function edge(
  functionName: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  expect(response.status, `${functionName}: ${JSON.stringify(result)}`).toBe(200);
  return result;
}

async function currentVersion(service: ServiceClient): Promise<number> {
  const { data, error } = await service
    .from('public_state')
    .select('current_version_number')
    .eq('id', true)
    .single();
  expect(error).toBeNull();
  return data!.current_version_number;
}

async function capture(page: Page, name: string) {
  await mkdir(resolve('artifacts/screenshots'), { recursive: true });
  await page.screenshot({
    path: resolve('artifacts/screenshots', name),
    fullPage: true,
  });
}

test('appairage, restauration offline, activation et révocation du player', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  test.skip(
    !supabaseUrl || !anonKey || !serviceRoleKey,
    'Requires local Supabase and Edge Functions.',
  );

  const service = createClient<Database>(supabaseUrl, serviceRoleKey, clientOptions);
  const adminAuth = createClient<Database>(supabaseUrl, anonKey, clientOptions);
  const email = `player-${randomUUID()}@example.test`;
  const password = `Player-${randomUUID()}!`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(created.error).toBeNull();
  const adminId = created.data.user!.id;
  const adminRow = await service.from('app_admin').insert({ id: true, user_id: adminId });
  expect(adminRow.error).toBeNull();
  const login = await adminAuth.auth.signInWithPassword({ email, password });
  expect(login.error).toBeNull();
  const adminToken = login.data.session!.access_token;
  let deviceId: string | null = null;
  let uploadedPath: string | null = null;
  let mediaId: string | null = null;
  let publishedMediaVersion = false;
  let originalContent: { title: string; body: string | null; media_ids: string[] } | null = null;

  try {
    await edge('admin', { action: 'refreshData' }, adminToken);
    await edge('admin', { action: 'publish' }, adminToken);
    const initialVersion = await currentVersion(service);
    const { code } = await edge(
      'admin',
      { action: 'createPairingCode', deviceName: 'TV salle principale' },
      adminToken,
    );

    const content = await service
      .from('content_items')
      .select('title,body,media_ids')
      .eq('id', contentId)
      .single();
    expect(content.error).toBeNull();
    originalContent = {
      title: content.data!.title,
      body: content.data!.body,
      media_ids: [...content.data!.media_ids],
    };

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/display');
    await expect(page.getByRole('heading', { name: 'Connecter cette télévision' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await capture(page, 'player-pairing-1080p.png');
    await page.setViewportSize({ width: 3840, height: 2160 });
    await capture(page, 'player-pairing-4k.png');
    await page.getByLabel('Nom de l’appareil').fill('TV salle principale');
    await page.getByLabel('Code d’appairage').fill(String(code));
    await page.getByRole('button', { name: 'Appairer' }).click();
    await expect(page.locator('.display-shell')).toHaveAttribute(
      'data-version',
      String(initialVersion),
      { timeout: 40_000 },
    );
    const paired = await service
      .from('devices')
      .select('id')
      .eq('device_name', 'TV salle principale')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(paired.error).toBeNull();
    deviceId = paired.data!.id;

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('[data-zone="attribution"]')).toBeVisible();
    await expect(page.locator('[data-zone="attribution"]')).toContainText(
      'Calendrier : Hebcal.com (CC BY 4.0)',
    );
    await capture(page, 'player-online-1080p.png');
    await page.setViewportSize({ width: 3840, height: 2160 });
    await expect(page.locator('[data-zone="attribution"]')).toBeVisible();
    await expect(page.locator('[data-zone="attribution"]')).toContainText(
      'Calendrier : Hebcal.com (CC BY 4.0)',
    );
    await capture(page, 'player-online-4k.png');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(page.locator('.display-shell')).toHaveAttribute(
      'data-version',
      String(initialVersion),
    );
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.display-shell')).toHaveAttribute(
      'data-version',
      String(initialVersion),
    );
    const v2Title = `Player v2 ${randomUUID().slice(0, 6)}`;
    const updatedContent = await service
      .from('content_items')
      .update({ title: v2Title, body: 'Version 2 hors ligne.' })
      .eq('id', contentId);
    expect(updatedContent.error).toBeNull();
    await edge('admin', { action: 'publish' }, adminToken);
    const versionTwo = await currentVersion(service);
    expect(versionTwo).toBeGreaterThan(initialVersion);
    await context.setOffline(false);
    await expect(page.locator('.display-shell')).toHaveAttribute(
      'data-version',
      String(versionTwo),
      { timeout: 40_000 },
    );

    const upload = await edge(
      'admin',
      {
        action: 'createUpload',
        kind: 'image',
        mime: 'image/png',
        bytes: png.byteLength,
        originalName: 'player-e2e.png',
      },
      adminToken,
    );
    uploadedPath = String(upload.path);
    mediaId = String(upload.mediaId);
    const stored = await service.storage
      .from('media')
      .uploadToSignedUrl(
        uploadedPath,
        String(upload.token),
        new Blob([png], { type: 'image/png' }),
        { contentType: 'image/png' },
      );
    expect(stored.error).toBeNull();
    await edge('admin', { action: 'finalizeUpload', mediaId }, adminToken);
    const updatedForMedia = await service
      .from('content_items')
      .update({ title: `Player v3 ${randomUUID().slice(0, 6)}`, media_ids: [mediaId] })
      .eq('id', contentId);
    expect(updatedForMedia.error).toBeNull();
    await edge('admin', { action: 'publish' }, adminToken);
    const versionThree = await currentVersion(service);
    expect(versionThree).toBeGreaterThan(versionTwo);
    publishedMediaVersion = true;
    const corrupted = await service.storage
      .from('media')
      .upload(
        uploadedPath,
        new Blob([new Uint8Array(png.byteLength).fill(0x20)], { type: 'image/png' }),
        {
          upsert: true,
          contentType: 'image/png',
        },
      );
    expect(corrupted.error).toBeNull();
    await expect
      .poll(
        async () => {
          const status = await service
            .from('devices')
            .select('last_error_code')
            .eq('id', deviceId!)
            .single();
          return status.data?.last_error_code;
        },
        { timeout: 60_000, intervals: [1000, 3000, 5000] },
      )
      .toBe('media_hash_mismatch');
    await expect(page.locator('.display-shell')).toHaveAttribute(
      'data-version',
      String(versionTwo),
    );

    const revoked = await edge('admin', { action: 'revokeDevice', id: deviceId }, adminToken);
    expect(revoked.id).toBe(deviceId);
    await expect(page.getByText('Appareil non autorisé')).toBeVisible({ timeout: 40_000 });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.display-shell')).toHaveAttribute(
      'data-version',
      String(versionTwo),
    );
    await page.keyboard.press('Control+Shift+P');
    await expect(page.getByRole('dialog', { name: 'Appairer la télévision' })).toBeVisible();
  } finally {
    await context.setOffline(false).catch(() => undefined);
    if (originalContent) {
      await service.from('content_items').update(originalContent).eq('id', contentId);
    }
    if (publishedMediaVersion) await edge('admin', { action: 'publish' }, adminToken);
    if (deviceId) await service.from('devices').delete().eq('id', deviceId);
    if (uploadedPath) await service.storage.from('media').remove([uploadedPath]);
    if (mediaId) await service.from('media_assets').delete().eq('id', mediaId);
    await service.from('app_admin').delete().eq('id', true);
    await service.auth.admin.deleteUser(adminId);
    await adminAuth.auth.signOut();
  }
});
