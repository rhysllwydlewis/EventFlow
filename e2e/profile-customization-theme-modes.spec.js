import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const pageHtml = fs.readFileSync(
  path.resolve(process.cwd(), 'public/supplier/profile-customization.html'),
  'utf8'
);

const PAGE_URL = '/supplier/profile-customization';

async function openPage(page, supplier) {
  const patches = [];
  await page.route(`**${PAGE_URL}`, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml })
  );
  await page.route('**/api/v1/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { id: 'u1', role: 'supplier', email: 's@example.com' } }),
    })
  );
  for (const pattern of ['**/api/csrf-token', '**/api/v1/csrf-token']) {
    await page.route(pattern, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
      })
    );
  }
  await page.route('**/api/me/suppliers', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [{ id: 'sup_1', name: 'Acme Events', ...supplier }] }),
    })
  );
  await page.route('**/api/me/suppliers/sup_1', async route => {
    if (route.request().method() === 'PATCH') {
      patches.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, supplier: { id: 'sup_1' } }),
      });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#preview-name')).toHaveText('Acme Events');
  // The consent banner sits over the bottom save bar until it is answered.
  await page
    .locator('#cookie-consent-reject')
    .click({ timeout: 5000 })
    .catch(() => {});
  return patches;
}

test.describe('Profile customisation theme modes', () => {
  test('a preset supplier opens as its preset and the preview shows its artwork', async ({
    page,
  }) => {
    await openPage(page, { heroPreset: 'midnight', category: 'Venues' });

    await expect(page.locator('input[name="themeMode"][value="preset"]')).toBeChecked();
    await expect(page.locator('#pc-theme-panel-preset')).toBeVisible();
    await expect(page.locator('#pc-theme-panel-custom')).toBeHidden();
    await expect(page.locator('.pc-theme-preset.active')).toHaveText('Midnight');

    const banner = await page
      .locator('#preview-banner')
      .evaluate(el => getComputedStyle(el).backgroundImage);
    // Midnight runs from #1a1a2e to #0f3460; the default teal would be rgb(11, 128, 115).
    expect(banner).toContain('rgb(26, 26, 46)');
    expect(banner).toContain('rgb(15, 52, 96)');
  });

  test('switching modes updates the preview and saves exactly what was chosen', async ({
    page,
  }) => {
    const patches = await openPage(page, { category: 'Photography' });

    await expect(page.locator('input[name="themeMode"][value="automatic"]')).toBeChecked();
    await expect(page.locator('#pc-theme-auto-note')).toContainText('Photography');

    await page.locator('label.pc-theme-mode', { hasText: 'Preset' }).click();
    await page.getByRole('button', { name: 'Ocean' }).click();
    await expect(page.locator('.pc-theme-preset.active')).toHaveText('Ocean');
    await page.locator('#pc-save-bar-save').click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toMatchObject({ themeMode: 'preset', heroPreset: 'ocean' });
    expect(patches[0]).not.toHaveProperty('themeColor');

    await page.locator('label.pc-theme-mode', { hasText: 'Custom' }).click();
    await page.locator('.color-preset[data-color="#EC4899"]').click();
    await expect(page.locator('#sup-theme-color-hex')).toHaveValue('#EC4899');
    await page.locator('#pc-save-bar-save').click();
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1]).toMatchObject({ themeMode: 'custom', themeColor: '#EC4899' });
    expect(patches[1]).not.toHaveProperty('heroPreset');

    await page.locator('label.pc-theme-mode', { hasText: 'Automatic' }).click();
    await page.locator('#pc-save-bar-save').click();
    await expect.poll(() => patches.length).toBe(3);
    expect(patches[2].themeMode).toBe('automatic');
    expect(patches[2]).not.toHaveProperty('themeColor');
    expect(patches[2]).not.toHaveProperty('heroPreset');
  });

  test('the mode picker is usable from the keyboard', async ({ page }) => {
    await openPage(page, { category: 'Venues' });

    const automatic = page.locator('input[name="themeMode"][value="automatic"]');
    await automatic.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('input[name="themeMode"][value="preset"]')).toBeChecked();
    await expect(page.locator('#pc-theme-panel-preset')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/pc-has-unsaved/);
  });
});
