import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const scenarios = [
  { at: '2026-09-30T10:00', description: 'Hol Hamoed Souccot', sponsor: true },
  { at: '2026-10-01T10:00', description: 'Hol Hamoed diaspora', sponsor: true },
  { at: '2026-10-02T15:00', description: 'vendredi après-midi' },
  { at: '2026-10-02T21:00', description: 'Chemini Atseret et Chabbat', sponsor: false },
  { at: '2026-10-04T12:00', description: 'Sim’hat Torah', sponsor: false },
  { at: '2026-10-06T10:00', description: 'semaine ordinaire', sponsor: true },
  { at: '2026-10-09T15:00', description: 'vendredi ordinaire', sponsor: true },
  { at: '2026-10-10T12:00', description: 'Chabbat ordinaire', sponsor: false },
  { at: '2027-11-01T10:00', description: 'hors horizon', sponsor: false },
];

const playlistScenarios = [
  { at: '2026-10-06T10:00', name: 'weekday', state: 'weekday' },
  { at: '2026-10-10T12:00', name: 'shabbat', state: 'shabbat' },
  { at: '2026-10-03T10:00', name: 'yom-tov', state: 'yomtov' },
];

async function assertTvTextMinimum(page: Page, description: string) {
  const undersizedText = await page.locator('.display-canvas').evaluate((canvas) => {
    return [...canvas.querySelectorAll<HTMLElement>('*')]
      .filter((element) => element.children.length === 0 && element.textContent?.trim())
      .filter((element) => !element.closest('[data-zone="attribution"]'))
      .map((element) => ({
        text: element.textContent?.trim(),
        size: Number.parseFloat(getComputedStyle(element).fontSize),
      }))
      .filter(({ size }) => size < 22);
  });
  expect(undersizedText, `${description}: TV text below 22 design px`).toEqual([]);
}

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
      await expect(page.locator('[data-zone="attribution"]')).toBeVisible();
      await expect(page.locator('[data-zone="attribution"]')).toContainText(
        'Calendrier : Hebcal.com (CC BY 4.0)',
      );
      await expect(page.locator('[data-zone="banner"]')).toContainText('Bienvenue à Beth Menahem');
      await expect(page.locator('[lang="he"][dir="rtl"]').first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        page:
          document.documentElement.scrollHeight <= window.innerHeight &&
          document.documentElement.scrollWidth <= window.innerWidth,
        zones: [...document.querySelectorAll<HTMLElement>('[data-zone]')].flatMap((element) => {
          if (
            element.scrollHeight <= element.clientHeight &&
            element.scrollWidth <= element.clientWidth
          ) {
            return [];
          }
          return [
            {
              zone: element.dataset.zone,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
              children: [...element.children].map((child) => ({
                className: (child as HTMLElement).className,
                height: Math.round(child.getBoundingClientRect().height),
                scrollHeight: (child as HTMLElement).scrollHeight,
                clientHeight: (child as HTMLElement).clientHeight,
              })),
            },
          ];
        }),
      }));
      expect(overflow.page, `${scenario.description}: page scroll`).toBe(true);
      expect(overflow.zones, `${scenario.description}: zone overflow`).toEqual([]);
      await assertTvTextMinimum(page, scenario.description);
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
      if (!scenario.at.startsWith('2027-11')) {
        await expect(page.locator('[data-zone="community"] .content-card')).toHaveCount(1);
        await expect(page.locator('.study-feature')).toHaveCount(1);
        await expect(page.locator('.study-qr-panel .display-qr')).toHaveCount(1);
      }
      if (scenario.at === '2026-10-02T21:00') {
        await expect(page.locator('.day-badge')).toContainText('Chemini Atzéret');
      }
      if (scenario.at.startsWith('2027-11')) {
        await expect(page.locator('[data-zone="unknown"]')).toBeVisible();
        await expect(page.locator('[data-zone="offices"]')).toHaveCount(0);
        await expect(page.locator('[data-zone="zmanim"]')).toHaveCount(0);
        await expect(page.locator('.study-feature')).toHaveCount(0);
        await expect(page.locator('.display-qr')).toHaveCount(0);
        await expect(page.getByText('Horaires à confirmer')).toHaveCount(0);
      }
      await page.screenshot({
        path: resolve(
          `artifacts/screenshots/display-${viewport.name}-fixed-${scenario.at.replace(':', '-')}.png`,
        ),
        fullPage: true,
      });
    }
    expect(consoleErrors, `${viewport.name}: console`).toEqual([]);

    for (const scenario of playlistScenarios) {
      await page.goto(`/display?demo=1&at=${encodeURIComponent(scenario.at)}&mode=playlist`);
      await expect(page.locator('[data-zone="playlist"]')).toBeVisible();
      await expect(page.locator('.display-shell')).toHaveAttribute('data-state', scenario.state);
      await assertTvTextMinimum(page, `playlist ${scenario.name}`);
      await page.screenshot({
        path: resolve(
          `artifacts/screenshots/display-${viewport.name}-playlist-${scenario.name}-${scenario.at.replace(':', '-')}.png`,
        ),
        fullPage: true,
      });
    }
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

  await page.goto('/admin?demo=1');
  await page.getByRole('button', { name: 'Horaires', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Résultat résolu · 14 jours' })).toBeVisible();
  const confirmationPadding = await page
    .locator('.schedule-card .rule-line small')
    .first()
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop));
  expect(confirmationPadding).toBeGreaterThan(0);
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
