import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Database } from '../src/lib/database.types';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const localSupabase =
  supabaseUrl.startsWith('http://localhost:') || supabaseUrl.startsWith('http://127.0.0.1:');
const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};
type ServiceClient = ReturnType<typeof createClient<Database>>;
type Snapshot = {
  settings: Database['public']['Tables']['settings']['Row'] | null;
  rules: Database['public']['Tables']['minyan_rules']['Row'][];
  exceptions: Database['public']['Tables']['minyan_exceptions']['Row'][];
  content: Database['public']['Tables']['content_items']['Row'][];
  layout: Database['public']['Tables']['layout_draft']['Row'] | null;
  jewishDays: Database['public']['Tables']['jewish_days']['Row'][];
  sourceRecords: Database['public']['Tables']['source_records']['Row'][];
  sourceHealth: Database['public']['Tables']['source_health']['Row'][];
  dailyStudyEntries: Database['public']['Tables']['daily_study_entries']['Row'][];
  auditEvents: Database['public']['Tables']['audit_events']['Row'][];
};

let service: ServiceClient;
let adminClient: ServiceClient;
let adminId = '';
let email = '';
let password = '';
let adminToken = '';
let initialSnapshot: Snapshot;
let versionBeforeMedia = 0;
let mediaVersionNumber = 0;
const deviceIds: string[] = [];

test.skip(
  !localSupabase || !anonKey || !serviceRoleKey,
  'Requires local Supabase and Edge Functions.',
);

test.describe.configure({ mode: 'serial' });

async function adminAction<T extends Record<string, unknown> = Record<string, unknown>>(
  action: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`${supabaseUrl}/functions/v1/admin`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action, ...input }),
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  expect(response.status, `${action}: ${JSON.stringify(body)}`).toBe(200);
  return body;
}

async function login(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
}

async function navigateTo(page: Page, section: string) {
  const mainLabels: Record<string, string> = {
    'Tableau de bord': 'Accueil',
    Horaires: 'Horaires',
    Contenus: 'Contenus',
    Écran: 'Aperçu / Publier',
    Appareils: 'Appareils',
  };
  if (mainLabels[section]) {
    await page.getByRole('button', { name: mainLabels[section], exact: true }).click();
  } else {
    const advancedButton = page.getByRole('button', { name: 'Avancé', exact: true });
    if ((await advancedButton.getAttribute('aria-expanded')) !== 'true') {
      await advancedButton.click();
    }
    await page.getByRole('button', { name: section, exact: true }).click();
  }
}

async function currentVersion() {
  const { data: state, error: stateError } = await service
    .from('public_state')
    .select('current_version_id,current_version_number,published_at')
    .eq('id', true)
    .single();
  expect(stateError).toBeNull();
  const { data: version, error } = await service
    .from('published_versions')
    .select('id,version_number,package,draft_snapshot')
    .eq('id', state!.current_version_id!)
    .single();
  expect(error).toBeNull();
  return { state: state!, version: version! };
}

async function cleanupQuery(
  errors: string[],
  label: string,
  query: PromiseLike<{ error: { message: string } | null }>,
) {
  const { error } = await query;
  if (error) errors.push(`${label}: ${error.message}`);
}

async function pairTv(context: BrowserContext, deviceName: string, date?: string) {
  const { code } = await adminAction<{ code: string }>('createPairingCode', { deviceName });
  const tv = await context.newPage();
  await tv.setViewportSize({ width: 1920, height: 1080 });
  if (date) {
    const virtualTime = new Date(`${date}T12:00:00.000Z`);
    await tv.clock.setFixedTime(virtualTime);
    await tv.route('**/functions/v1/player', async (route) => {
      const response = await route.fetch();
      if (route.request().postDataJSON()?.action !== 'sync') {
        await route.fulfill({ response });
        return;
      }
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: { ...body, serverTime: virtualTime.toISOString() },
      });
    });
  }
  await tv.goto('/display');
  await expect(tv.getByRole('heading', { name: 'Connecter cette télévision' })).toBeVisible();
  await tv.getByLabel('Nom de l’appareil').fill(deviceName);
  await tv.getByLabel('Code d’appairage').fill(code);
  await tv.getByRole('button', { name: 'Appairer' }).click();
  const current = await currentVersion();
  await expect(tv.locator('.display-shell')).toHaveAttribute(
    'data-version',
    String(current.state.current_version_number),
    { timeout: 40_000 },
  );
  const { data: device, error } = await service
    .from('devices')
    .select('id')
    .eq('device_name', deviceName)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  expect(error).toBeNull();
  deviceIds.push(device!.id);
  return tv;
}

function parisDate(offsetDays = 0): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map(({ type, value }) => [type, value]),
  );
  const value = `${parts.year}-${parts.month}-${parts.day}`;
  const instant = new Date(`${value}T12:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + offsetDays);
  return instant.toISOString().slice(0, 10);
}

function nextWeekday(target: number): string {
  const value = parisDate();
  const instant = new Date(`${value}T12:00:00.000Z`);
  const distance = (target - instant.getUTCDay() + 7) % 7 || 7;
  instant.setUTCDate(instant.getUTCDate() + distance);
  return instant.toISOString().slice(0, 10);
}

function createPdf(pageCount: number): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_, index) => 3 + index * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  );
  for (let index = 0; index < pageCount; index += 1) {
    const pageId = pageIds[index];
    const streamId = pageId + 1;
    const stream = `BT /F1 24 Tf 60 720 Td (Page ${index + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pageCount * 2} 0 R >> >> /Contents ${streamId} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

async function orientationJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#c63434';
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = '#3459c6';
    context.fillRect(1, 0, 1, 1);
    const jpeg = new Uint8Array(
      await new Promise<ArrayBuffer>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) reject(new Error('jpeg_encode_failed'));
            else void blob.arrayBuffer().then(resolve, reject);
          },
          'image/jpeg',
          0.95,
        );
      }),
    );
    const exif = new Uint8Array([
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01,
      0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00,
    ]);
    const length = exif.length + 2;
    const app1 = new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...exif]);
    const result = new Uint8Array(jpeg.length + app1.length);
    result.set(jpeg.subarray(0, 2));
    result.set(app1, 2);
    result.set(jpeg.subarray(2), 2 + app1.length);
    return btoa(String.fromCharCode(...result));
  });
  return Buffer.from(base64, 'base64');
}

test.beforeAll(async () => {
  service = createClient<Database>(supabaseUrl, serviceRoleKey, clientOptions);
  adminClient = createClient<Database>(supabaseUrl, anonKey, clientOptions);
  email = `admin-e2e-${randomUUID()}@example.test`;
  password = `Admin-${randomUUID()}!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(createError).toBeNull();
  adminId = created.user!.id;
  const { error: adminError } = await service
    .from('app_admin')
    .insert({ id: true, user_id: adminId });
  expect(adminError).toBeNull();
  const { data: signedIn, error: signInError } = await adminClient.auth.signInWithPassword({
    email,
    password,
  });
  expect(signInError).toBeNull();
  adminToken = signedIn.session!.access_token;

  const [
    settings,
    rules,
    exceptions,
    content,
    layout,
    jewishDays,
    sourceRecords,
    sourceHealth,
    dailyStudyEntries,
    auditEvents,
  ] = await Promise.all([
    service.from('settings').select('*').eq('id', true).maybeSingle(),
    service.from('minyan_rules').select('*'),
    service.from('minyan_exceptions').select('*'),
    service.from('content_items').select('*'),
    service.from('layout_draft').select('*').eq('id', true).maybeSingle(),
    service.from('jewish_days').select('*'),
    service.from('source_records').select('*'),
    service.from('source_health').select('*'),
    service.from('daily_study_entries').select('*'),
    service.from('audit_events').select('*'),
  ]);
  for (const result of [
    settings,
    rules,
    exceptions,
    content,
    layout,
    jewishDays,
    sourceRecords,
    sourceHealth,
    dailyStudyEntries,
    auditEvents,
  ]) {
    expect(result.error).toBeNull();
  }
  initialSnapshot = {
    settings: settings.data,
    rules: rules.data ?? [],
    exceptions: exceptions.data ?? [],
    content: content.data ?? [],
    layout: layout.data,
    jewishDays: jewishDays.data ?? [],
    sourceRecords: sourceRecords.data ?? [],
    sourceHealth: sourceHealth.data ?? [],
    dailyStudyEntries: dailyStudyEntries.data ?? [],
    auditEvents: auditEvents.data ?? [],
  };
  const mode = await fetch(`${process.env.MOCK_HEBCAL_URL ?? 'http://127.0.0.1:8765'}/_mode`, {
    method: 'POST',
    body: 'ok',
  });
  expect(mode.status).toBe(204);
  await adminAction('refreshData');
  await adminAction('publish');
});

test.afterAll(async () => {
  if (!service) return;
  const cleanupErrors: string[] = [];
  if (deviceIds.length) {
    await cleanupQuery(
      cleanupErrors,
      'delete devices',
      service.from('devices').delete().in('id', deviceIds),
    );
  }
  await cleanupQuery(
    cleanupErrors,
    'delete pairings',
    service.from('device_pairings').delete().eq('created_by', adminId),
  );
  const { data: media } = await service
    .from('media_assets')
    .select('storage_path')
    .eq('created_by', adminId);
  const paths = media?.map((item) => item.storage_path) ?? [];
  if (paths.length) {
    const { error } = await service.storage.from('media').remove(paths);
    if (error) cleanupErrors.push(`remove storage objects: ${error.message}`);
  }
  await cleanupQuery(
    cleanupErrors,
    'delete media assets',
    service.from('media_assets').delete().eq('created_by', adminId),
  );
  if (initialSnapshot) {
    await cleanupQuery(
      cleanupErrors,
      'delete audit events',
      service.from('audit_events').delete().gt('id', 0),
    );
    await cleanupQuery(
      cleanupErrors,
      'clear settings',
      service.from('settings').delete().eq('id', true),
    );
    if (initialSnapshot.settings) {
      await cleanupQuery(
        cleanupErrors,
        'restore settings',
        service.from('settings').insert(initialSnapshot.settings),
      );
    }
    await cleanupQuery(
      cleanupErrors,
      'clear layout',
      service.from('layout_draft').delete().eq('id', true),
    );
    if (initialSnapshot.layout) {
      await cleanupQuery(
        cleanupErrors,
        'restore layout',
        service.from('layout_draft').insert(initialSnapshot.layout),
      );
    }
    await cleanupQuery(
      cleanupErrors,
      'clear content',
      service.from('content_items').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    );
    if (initialSnapshot.content.length) {
      await cleanupQuery(
        cleanupErrors,
        'restore content',
        service.from('content_items').insert(initialSnapshot.content),
      );
    }
    await cleanupQuery(
      cleanupErrors,
      'clear exceptions',
      service.from('minyan_exceptions').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    );
    if (initialSnapshot.exceptions.length) {
      await cleanupQuery(
        cleanupErrors,
        'restore exceptions',
        service.from('minyan_exceptions').insert(initialSnapshot.exceptions),
      );
    }
    await cleanupQuery(
      cleanupErrors,
      'clear rules',
      service.from('minyan_rules').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    );
    if (initialSnapshot.rules.length) {
      await cleanupQuery(
        cleanupErrors,
        'restore rules',
        service.from('minyan_rules').insert(initialSnapshot.rules),
      );
    }
    await cleanupQuery(
      cleanupErrors,
      'clear calendar days',
      service.from('jewish_days').delete().neq('local_date', '0001-01-01'),
    );
    if (initialSnapshot.jewishDays.length) {
      await cleanupQuery(
        cleanupErrors,
        'restore calendar days',
        service.from('jewish_days').insert(initialSnapshot.jewishDays),
      );
    }
    await cleanupQuery(
      cleanupErrors,
      'clear source records',
      service.from('source_records').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    );
    if (initialSnapshot.sourceRecords.length) {
      await cleanupQuery(
        cleanupErrors,
        'restore source records',
        service.from('source_records').insert(initialSnapshot.sourceRecords),
      );
    }
    await cleanupQuery(
      cleanupErrors,
      'clear source health',
      service.from('source_health').delete().neq('source', '__none__'),
    );
    if (initialSnapshot.sourceHealth.length) {
      await cleanupQuery(
        cleanupErrors,
        'restore source health',
        service.from('source_health').insert(initialSnapshot.sourceHealth),
      );
    }
    await cleanupQuery(
      cleanupErrors,
      'clear study entries',
      service
        .from('daily_study_entries')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'),
    );
    if (initialSnapshot.dailyStudyEntries.length) {
      await cleanupQuery(
        cleanupErrors,
        'restore study entries',
        service.from('daily_study_entries').insert(initialSnapshot.dailyStudyEntries),
      );
    }
    await cleanupQuery(
      cleanupErrors,
      'clear generated audit events',
      service.from('audit_events').delete().gt('id', 0),
    );
    if (initialSnapshot.auditEvents.length) {
      await cleanupQuery(
        cleanupErrors,
        'restore audit events',
        service.from('audit_events').insert(
          initialSnapshot.auditEvents.map((event) => ({
            action: event.action,
            actor_id: event.actor_id,
            after_data: event.after_data,
            before_data: event.before_data,
            created_at: event.created_at,
            record_id: event.record_id,
            table_name: event.table_name,
            version_id: event.version_id,
          })),
        ),
      );
    }
  }
  if (adminId) {
    await cleanupQuery(
      cleanupErrors,
      'delete admin role',
      service.from('app_admin').delete().eq('user_id', adminId),
    );
  }
  if (adminClient) {
    const { error: signOutError } = await adminClient.auth.signOut();
    if (signOutError) cleanupErrors.push(`sign out: ${signOutError.message}`);
  }
  expect(cleanupErrors).toEqual([]);
});

test('connexion administrateur par e-mail et mot de passe', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Mode Supabase')).toBeVisible();
});

test('capture l’administration mobile et bureau avec son aperçu fidèle', async ({ page }) => {
  await mkdir(resolve('artifacts/screenshots/v2-visuel'), { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.locator('.admin-toast')).toHaveCount(0, { timeout: 6000 });

  const sections = [
    ['Tableau de bord', 'dashboard'],
    ['Horaires', 'horaires'],
    ['Contenus', 'contenus'],
    ['Médias', 'medias'],
    ['Écran', 'ecran'],
    ['Historique', 'historique'],
    ['Appareils', 'appareils'],
    ['Sources', 'sources'],
    ['Réglages', 'reglages'],
  ] as const;
  for (const [section, slug] of sections) {
    await navigateTo(page, section);
    await expect(page.locator('.admin-topbar h1')).toHaveText(
      section === 'Écran' ? 'Aperçu et publication' : section,
    );
    await expect(page.getByText(/Chargement du journal|Chargement des valeurs/)).toHaveCount(0);
    await page.screenshot({
      path: resolve('artifacts/screenshots', `admin-${slug}-mobile-390x844.png`),
    });
  }

  await navigateTo(page, 'Tableau de bord');
  await expect(page.locator('.admin-topbar h1')).toHaveText('Tableau de bord');
  await page.screenshot({
    path: resolve('artifacts/screenshots/v2-visuel/admin-dashboard-mobile-390x844.png'),
  });
  await navigateTo(page, 'Horaires');
  await expect(page.locator('.admin-topbar h1')).toHaveText('Horaires');
  await page.screenshot({
    path: resolve('artifacts/screenshots/v2-visuel/admin-horaires-mobile-390x844.png'),
  });
  const advancedButton = page.getByRole('button', { name: 'Avancé', exact: true });
  await advancedButton.click();
  await expect(advancedButton).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({
    path: resolve('artifacts/screenshots/v2-visuel/admin-avance-sheet-mobile-390x844.png'),
  });
  await page.getByRole('button', { name: 'Fermer le menu Avancé' }).click();
  await expect(advancedButton).toHaveAttribute('aria-expanded', 'false');
  await navigateTo(page, 'Écran');
  await expect(page.locator('.admin-topbar h1')).toHaveText('Aperçu et publication');
  await page.getByRole('button', { name: 'Actualiser l’aperçu' }).click();
  await expect(page.locator('.preview-frame .display-shell')).toBeVisible();
  await expect(page.locator('.admin-toast')).toHaveText('Aperçu du brouillon actualisé.');
  await expect(page.locator('.admin-toast')).toHaveCount(0, { timeout: 6000 });
  await page.locator('.preview-frame').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const topbar = document.querySelector('.admin-topbar');
    const previewControls = document.querySelector('.preview-controls');
    const scrollRoot = document.scrollingElement;
    if (!topbar || !previewControls || !scrollRoot) return;
    const offset =
      previewControls.getBoundingClientRect().top - topbar.getBoundingClientRect().bottom - 8;
    if (offset < 0) scrollRoot.scrollBy(0, offset);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const topbar = document.querySelector('.admin-topbar');
        const previewControls = document.querySelector('.preview-controls');
        return (
          !!topbar &&
          !!previewControls &&
          previewControls.getBoundingClientRect().top >= topbar.getBoundingClientRect().bottom + 8
        );
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: resolve('artifacts/screenshots/v2-visuel/admin-apercu-mobile-390x844.png'),
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateTo(page, 'Tableau de bord');
  await page.screenshot({
    path: resolve('artifacts/screenshots/v2-visuel/admin-dashboard-desktop-1440x900.png'),
  });
  await navigateTo(page, 'Écran');
  await page.getByRole('button', { name: 'Actualiser l’aperçu' }).click();
  await expect(page.locator('.preview-frame .display-shell')).toBeVisible();
  await expect(page.locator('.admin-toast')).toHaveText('Aperçu du brouillon actualisé.');
  await expect(page.locator('.admin-toast')).toHaveCount(0, { timeout: 6000 });
  await page.locator('.preview-frame').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve('artifacts/screenshots/v2-visuel/admin-apercu-desktop-1440x900.png'),
  });
});

test('exception Min’ha du dimanche publiée sans modifier le lundi et visible sur la TV appairée', async ({
  page,
  context,
}) => {
  await login(page);
  const sunday = nextWeekday(0);
  const mondayInstant = new Date(`${sunday}T12:00:00.000Z`);
  mondayInstant.setUTCDate(mondayInstant.getUTCDate() + 1);
  const monday = mondayInstant.toISOString().slice(0, 10);
  const baseline = await currentVersion();
  const baselineMonday = (
    baseline.version.package as {
      minyanim: Array<{ date: string; office: string; time: string | null }>;
    }
  ).minyanim.find((item) => item.date === monday && item.office === 'Min’ha')?.time;
  const tv = await pairTv(context, `TV dimanche ${randomUUID().slice(0, 5)}`, sunday);
  await navigateTo(page, 'Horaires');
  const exceptionCard = page.locator('.admin-card').filter({
    has: page.getByRole('heading', { name: 'Exception · cette date seulement' }),
  });
  await exceptionCard.getByLabel('Date').fill(sunday);
  await exceptionCard.getByRole('combobox').selectOption({ label: 'Min’ha' });
  await exceptionCard.getByLabel('Heure').fill('18:55');
  await exceptionCard.getByRole('button', { name: 'Enregistrer l’exception' }).click();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.locator('.draft-indicator-label')).toHaveText('Brouillon enregistré');
  await navigateTo(page, 'Écran');
  await expect(
    page.getByRole('heading', { name: 'Aperçu et publication', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Date et heure libres').fill(sunday);
  await page.getByLabel('Heure', { exact: true }).fill('12:00');
  await page.getByRole('button', { name: 'Actualiser l’aperçu' }).click();
  const previewMincha = page
    .locator('[data-zone="offices"] .office-row')
    .filter({ hasText: 'Min’ha' });
  await expect(previewMincha).toContainText('18:55');
  await page.getByRole('button', { name: 'Publier', exact: true }).click();
  await page.getByRole('button', { name: 'Publier maintenant' }).click();
  await expect
    .poll(async () => (await currentVersion()).state.current_version_number, { timeout: 20_000 })
    .toBeGreaterThan(baseline.state.current_version_number);
  const updated = await currentVersion();
  await expect(tv.locator('.display-shell')).toHaveAttribute(
    'data-version',
    String(updated.state.current_version_number),
    { timeout: 40_000 },
  );
  await expect(
    tv.locator('[data-zone="offices"] .office-row').filter({ hasText: 'Min’ha' }),
  ).toContainText('18:55');
  const mondayTime = (
    updated.version.package as {
      minyanim: Array<{ date: string; office: string; time: string | null }>;
    }
  ).minyanim.find((item) => item.date === monday && item.office === 'Min’ha')?.time;
  expect(mondayTime).toBe(baselineMonday);
});

test('un sponsor est visible en semaine et masqué dans l’aperçu de Chabbat', async ({ page }) => {
  await login(page);
  const title = `Sponsor E2E ${randomUUID().slice(0, 6)}`;
  await navigateTo(page, 'Contenus');
  await page.getByLabel('Type').selectOption('sponsor');
  await page.getByLabel('Titre').fill(title);
  await page.getByLabel('Contenu commercial').check();
  await page.getByLabel('Statut').selectOption('ready');
  await page.getByRole('button', { name: 'Ajouter à la liste' }).click();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.locator('.draft-indicator-label')).toHaveText('Brouillon enregistré');
  await navigateTo(page, 'Écran');
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await page.getByRole('button', { name: 'Actualiser l’aperçu' }).click();
  await expect(page.locator('.preview-frame').getByText(title)).toBeVisible();

  const shabbatInstant = new Date(`${nextWeekday(6)}T12:00:00.000Z`);
  shabbatInstant.setUTCDate(shabbatInstant.getUTCDate() + 7);
  const shabbatDate = shabbatInstant.toISOString().slice(0, 10);
  const fridayInstant = new Date(`${shabbatDate}T12:00:00.000Z`);
  fridayInstant.setUTCDate(fridayInstant.getUTCDate() - 1);
  const fridayDate = fridayInstant.toISOString().slice(0, 10);
  const { data: calendarDays, error: calendarError } = await service
    .from('jewish_days')
    .select('local_date,zmanim')
    .in('local_date', [fridayDate, shabbatDate]);
  expect(calendarError).toBeNull();
  const friday = calendarDays?.find((day) => day.local_date === fridayDate);
  const saturday = calendarDays?.find((day) => day.local_date === shabbatDate);
  expect(friday).toBeTruthy();
  expect(saturday).toBeTruthy();
  const fridayZmanim = friday!.zmanim as unknown as Record<string, unknown>;
  const saturdayZmanim = saturday!.zmanim as unknown as Record<string, unknown>;
  const [fridayUpdate, saturdayUpdate] = await Promise.all([
    service
      .from('jewish_days')
      .update({
        zmanim: {
          ...fridayZmanim,
          candleLighting: {
            instant: new Date(`${fridayDate}T16:00:00.000Z`).toISOString(),
            sourceId: 'e2e:shabbat',
            overridden: false,
          },
        },
      })
      .eq('local_date', fridayDate),
    service
      .from('jewish_days')
      .update({
        zmanim: {
          ...saturdayZmanim,
          havdalah: {
            instant: new Date(`${shabbatDate}T18:00:00.000Z`).toISOString(),
            sourceId: 'e2e:shabbat',
            overridden: false,
          },
        },
      })
      .eq('local_date', shabbatDate),
  ]);
  expect(fridayUpdate.error).toBeNull();
  expect(saturdayUpdate.error).toBeNull();

  await page.getByRole('button', { name: 'Chabbat', exact: true }).click();
  await page.getByLabel('Date et heure libres').fill(shabbatDate);
  await page.getByLabel('Heure', { exact: true }).fill('12:00');
  await page.getByRole('button', { name: 'Actualiser l’aperçu' }).click();
  await expect(page.locator('.admin-toast')).toHaveText('Aperçu du brouillon actualisé.');
  await expect(page.locator('.preview-frame .display-shell')).toHaveAttribute(
    'data-state',
    'shabbat',
  );
  await expect(page.locator('.preview-frame').getByText(title)).toHaveCount(0);
});

test('photo EXIF et PDF deux pages : pages prêtes puis affichées sur la TV après publication', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await login(page);
  versionBeforeMedia = (await currentVersion()).state.current_version_number;
  await navigateTo(page, 'Médias');
  await page.locator('.admin-toast').waitFor({ state: 'hidden' });
  const jpeg = await orientationJpeg(page);
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'orientation-6.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'deux-pages.pdf', mimeType: 'application/pdf', buffer: createPdf(2) },
  ]);
  const uploadToast = page.locator('.admin-toast');
  const uploadResult = await Promise.race([
    page
      .getByText('PDF et pages prêts.')
      .waitFor({ timeout: 90_000 })
      .then(() => null),
    uploadToast
      .waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => uploadToast.textContent()),
  ]);
  expect(uploadResult).toBeNull();
  const { data: orientationAsset, error: orientationError } = await service
    .from('media_assets')
    .select('id,width,height,status')
    .eq('original_name_label', 'orientation-6.jpg')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  expect(orientationError).toBeNull();
  expect(orientationAsset!.status).toBe('ready');
  expect(orientationAsset!.width).toBeLessThan(orientationAsset!.height!);

  const { data: parent, error: parentError } = await service
    .from('media_assets')
    .select('id,status,pages')
    .eq('original_name_label', 'deux-pages.pdf')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  expect(parentError).toBeNull();
  expect(parent!.status).toBe('ready');
  expect(parent!.pages).toBe(2);
  const { data: pages, error: pagesError } = await service
    .from('media_assets')
    .select('id,status,page_index')
    .eq('parent_id', parent!.id)
    .order('page_index');
  expect(pagesError).toBeNull();
  expect(pages).toHaveLength(2);
  expect(pages!.every((item) => item.status === 'ready')).toBe(true);

  await navigateTo(page, 'Contenus');
  const contentTitle = `Document E2E ${randomUUID().slice(0, 6)}`;
  await page.getByLabel('Type').selectOption('pdf');
  await page.getByLabel('Titre').fill(contentTitle);
  await page.getByLabel('Visibilité Chabbat / Yom Tov').selectOption('show');
  await page.getByLabel('Médias').selectOption(pages!.map((item) => item.id));
  await page.getByLabel('Statut').selectOption('ready');
  await page.getByRole('button', { name: 'Ajouter à la liste' }).click();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.locator('.draft-indicator-label')).toHaveText('Brouillon enregistré');
  const { data: content, error: contentError } = await service
    .from('content_items')
    .select('id')
    .eq('title', contentTitle)
    .single();
  expect(contentError).toBeNull();

  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateTo(page, 'Écran');
  await page.getByRole('button', { name: 'Playlist', exact: true }).click();
  await page.getByLabel('Contenus · diapositive 3').selectOption(content!.id);
  await page.getByRole('button', { name: 'Supprimer Horaires' }).click();
  await page.getByRole('button', { name: 'Supprimer Chabbat' }).click();
  await page.getByRole('button', { name: 'Supprimer Étude' }).click();
  await page.getByRole('button', { name: 'Actualiser l’aperçu' }).click();
  await expect(page.locator('.preview-frame .content-media-gallery img')).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator('.preview-frame .content-media-gallery img')
        .evaluateAll((images: HTMLImageElement[]) =>
          images.every((image) => image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  const tv = await pairTv(context, `TV PDF ${randomUUID().slice(0, 5)}`);
  await page.getByRole('button', { name: 'Publier', exact: true }).click();
  await page.getByRole('button', { name: 'Publier maintenant' }).click();
  await expect(page.getByText(/Publication réussie/)).toBeVisible();
  const current = await currentVersion();
  mediaVersionNumber = current.state.current_version_number;
  await expect(tv.locator('.display-shell')).toHaveAttribute(
    'data-version',
    String(mediaVersionNumber),
    {
      timeout: 40_000,
    },
  );
  await expect(tv.locator('.content-media-gallery img')).toHaveCount(2);
});

test('un PDF de sept pages est refusé avant le téléversement', async ({ page }) => {
  await login(page);
  await navigateTo(page, 'Médias');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'sept-pages.pdf',
    mimeType: 'application/pdf',
    buffer: createPdf(7),
  });
  await expect(
    page.getByText('Ce PDF contient plus de six pages. Réduisez-le avant de le déposer.'),
  ).toBeVisible({
    timeout: 60_000,
  });
  const { data, error } = await service
    .from('media_assets')
    .select('id')
    .eq('original_name_label', 'sept-pages.pdf');
  expect(error).toBeNull();
  expect(data).toHaveLength(0);
});

test('restaurer la version précédente rétablit l’affichage TV et annonce le nouveau numéro', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await login(page);
  const tv = await pairTv(context, `TV restauration ${randomUUID().slice(0, 5)}`);
  await expect(tv.locator('.content-media-gallery img')).toHaveCount(2, { timeout: 20_000 });
  await navigateTo(page, 'Historique');
  const previous = page
    .locator('.version-row')
    .filter({ hasText: `Version ${versionBeforeMedia}` });
  await expect(previous).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await previous.getByRole('button', { name: 'Restaurer' }).click();
  await expect
    .poll(async () => (await currentVersion()).state.current_version_number)
    .toBeGreaterThan(mediaVersionNumber);
  const restored = await currentVersion();
  await expect(page.locator('.admin-toast')).toHaveText(
    `Version ${restored.state.current_version_number} créée à partir de la version ${versionBeforeMedia}.`,
    { timeout: 15_000 },
  );
  expect(restored.state.current_version_number).toBeGreaterThan(mediaVersionNumber);
  await expect(tv.locator('.display-shell')).toHaveAttribute(
    'data-version',
    String(restored.state.current_version_number),
    { timeout: 40_000 },
  );
  await expect(tv.locator('.content-media-gallery')).toHaveCount(0);
});

test('créer un code TV depuis Appareils puis révoquer la télévision appairée', async ({
  page,
  context,
}) => {
  await login(page);
  const deviceName = `TV Appareils ${randomUUID().slice(0, 5)}`;
  await navigateTo(page, 'Appareils');
  await page.getByLabel('Nom de l’appareil').fill(deviceName);
  await page.getByRole('button', { name: 'Créer un code TV' }).click();
  const code = await page.getByLabel(new RegExp('Code de jumelage')).textContent();
  expect(code?.trim()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  await expect(page.getByText(/Expiration dans (9|10) min/)).toBeVisible();
  const tv = await context.newPage();
  await tv.goto('/display');
  await tv.getByLabel('Nom de l’appareil').fill(deviceName);
  await tv.getByLabel('Code d’appairage').fill(code!.trim());
  await tv.getByRole('button', { name: 'Appairer' }).click();
  await expect(tv.locator('.display-shell')).toBeVisible({ timeout: 40_000 });
  await page.reload();
  await expect(page.locator('.admin-topbar h1')).toHaveText('Tableau de bord');
  await navigateTo(page, 'Appareils');
  const row = page.locator('.device-row').filter({ hasText: deviceName });
  const id = await service.from('devices').select('id').eq('device_name', deviceName).single();
  expect(id.error).toBeNull();
  deviceIds.push(id.data!.id);
  page.once('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Révoquer' }).click();
  await expect(row.getByText('Révoqué')).toBeVisible();
  await expect(tv.getByText('Appareil non autorisé')).toBeVisible({ timeout: 40_000 });
});

test('enregistrer l’approbation religieuse retire la mention en attente de l’aperçu', async ({
  page,
}) => {
  await login(page);
  await navigateTo(page, 'Réglages');
  await expect(
    page.getByText('En attente de validation religieuse · mention affichée à l’écran.'),
  ).toBeVisible();
  await page.getByLabel('Nom du responsable religieux').fill('Rabbin de contrôle E2E');
  await page.getByLabel('Date d’approbation').fill(parisDate());
  await page.getByLabel('Je confirme que le responsable religieux a validé ces méthodes').check();
  await page.getByRole('button', { name: 'Enregistrer l’approbation' }).click();
  await expect(page.getByText('Approbation religieuse enregistrée.')).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.locator('.draft-indicator-label')).toHaveText('Brouillon enregistré');
  await navigateTo(page, 'Écran');
  await page.getByRole('button', { name: 'Chabbat', exact: true }).click();
  await page.getByRole('button', { name: 'Actualiser l’aperçu' }).click();
  await expect(page.locator('.preview-frame .display-shell')).toBeVisible();
  await expect(
    page.locator('.preview-frame').getByText('Méthode en attente de validation'),
  ).toHaveCount(0);
});
