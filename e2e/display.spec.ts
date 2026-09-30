import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const scenarios = [
  { at: '2026-09-30T10:00', description: 'Hol Hamoed Souccot', sponsor: false },
  { at: '2026-10-01T10:00', description: 'Yom Tov diaspora', sponsor: false },
  { at: '2026-10-02T15:00', description: 'vendredi après-midi' },
  { at: '2026-10-02T21:00', description: 'Chemini Atseret et Chabbat', sponsor: false },
  { at: '2026-10-04T12:00', description: 'Sim’hat Torah', sponsor: false },
  { at: '2026-10-06T10:00', description: 'semaine ordinaire', sponsor: true },
  { at: '2026-10-09T15:00', description: 'vendredi ordinaire', sponsor: true },
  { at: '2026-10-10T12:00', description: 'Chabbat ordinaire', sponsor: false },
  { at: '2027-11-01T10:00', description: 'hors horizon', sponsor: false },
];

for (const viewport of [
  { name: '1080p', width: 1920, height: 1080 },
  { name: '4k', width: 3840, height: 2160 },
]) {
  test(`affichage ${viewport.name} : fêtes, RTL, sponsors et absence de débordement`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    for (const scenario of scenarios) {
      await page.goto(`/display?demo=1&at=${encodeURIComponent(scenario.at)}`);
      await expect(page.locator('.display-header')).toBeVisible();
      await expect(page.locator('[lang="he"][dir="rtl"]').first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        page:
          document.documentElement.scrollHeight <= window.innerHeight &&
          document.documentElement.scrollWidth <= window.innerWidth,
        zones: [...document.querySelectorAll<HTMLElement>('[data-zone]')].every(
          (element) =>
            element.scrollHeight <= element.clientHeight &&
            element.scrollWidth <= element.clientWidth,
        ),
      }));
      expect(overflow.page, `${scenario.description}: page scroll`).toBe(true);
      expect(overflow.zones, `${scenario.description}: zone overflow`).toBe(true);
      expect(
        await page.evaluate(
          () => getComputedStyle(document.querySelector('[lang="he"]')!).direction,
        ),
      ).toBe('rtl');
      if (scenario.sponsor === false) {
        await expect(page.locator('[data-content-id="sponsor-boulangerie"]')).toHaveCount(0);
      }
      if (scenario.sponsor === true) {
        await expect(page.locator('[data-content-id="sponsor-boulangerie"]')).toBeVisible();
      }
      if (scenario.at.startsWith('2027-11')) {
        await expect(page.locator('[data-zone="unknown"]')).toBeVisible();
        await expect(page.locator('[data-zone="offices"]')).toHaveCount(0);
        await expect(page.locator('[data-zone="zmanim"]')).toHaveCount(0);
        await expect(page.locator('.study-feature')).toHaveCount(0);
        await expect(page.locator('.qr-panel')).toHaveCount(0);
        await expect(page.getByText('Horaires à confirmer')).toHaveCount(0);
      }
      if (scenario.at.startsWith('2026-10-06')) {
        await page.screenshot({
          path: resolve(`artifacts/screenshots/display-${viewport.name}-fixed.png`),
          fullPage: true,
        });
      }
    }
    expect(consoleErrors, `${viewport.name}: console`).toEqual([]);

    await page.goto('/display?demo=1&at=2026-10-06T10%3A00&mode=playlist');
    await expect(page.locator('[data-zone="playlist"]')).toBeVisible();
    await page.screenshot({
      path: resolve(`artifacts/screenshots/display-${viewport.name}-playlist.png`),
      fullPage: true,
    });
    expect(consoleErrors, `${viewport.name} playlist: console`).toEqual([]);
  });
}

test('admin mobile 390×844 : horaires, annonces et aperçu avec captures', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Horaires', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Résultat résolu · 14 jours' })).toBeVisible();
  await page.screenshot({
    path: resolve('artifacts/screenshots/admin-iphone-horaires.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Annonces', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nouvelle annonce' })).toBeVisible();
  await page.screenshot({
    path: resolve('artifacts/screenshots/admin-iphone-annonces.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Écran', exact: true }).click();
  await page.getByRole('button', { name: 'Aperçu' }).click();
  await expect(page.getByText('BROUILLON — non publié')).toBeVisible();
  await page.screenshot({
    path: resolve('artifacts/screenshots/admin-iphone-apercu.png'),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
});
