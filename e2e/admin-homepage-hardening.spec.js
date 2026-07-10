import { test, expect } from '@playwright/test';

function versionSettings(overrides = {}) {
  return {
    collageWidget: {
      enabled: true,
      mediaTypes: { photos: true, videos: true },
      intervalSeconds: 2.5,
      heroVideo: { enabled: true, autoplay: true, muted: true, loop: true, quality: 'hd' },
      transition: { effect: 'fade', duration: 1000 },
      pexelsQueries: {},
      pexelsVideoQueries: {},
    },
    mediaLibrary: {
      mode: 'selected_with_fallback',
      mediaTypes: { photos: true, videos: true },
      fallback: { enabled: true, source: 'pexels', minimumItems: 6 },
      selectedPexels: [],
      selectedUploads: [],
      hero: { mode: 'auto', selectedMediaId: null, order: [] },
    },
    ...overrides,
  };
}

function managerFixture() {
  return {
    activeVersion: 'v1',
    versions: {
      v1: {
        id: 'v1',
        tabName: 'Homepage 1',
        previewPath: '/',
        description: 'Original homepage',
        settings: versionSettings(),
      },
      v2: {
        id: 'v2',
        tabName: 'Homepage 2',
        previewPath: '/home-v2-preview',
        description: 'Photo-led homepage',
        settings: versionSettings(),
      },
      v3: {
        id: 'v3',
        tabName: 'Homepage 3',
        previewPath: '/home-v3-preview',
        description: 'Video-led homepage',
        settings: versionSettings(),
      },
    },
  };
}

async function mockHomepageManager(page) {
  let manager = managerFixture();
  const renamePayloads = [];
  const authBody = JSON.stringify({
    user: { id: 'admin-1', role: 'admin', name: 'Admin', email: 'admin@example.com' },
  });

  for (const pattern of ['**/api/auth/me', '**/api/v1/auth/me']) {
    await page.route(pattern, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: authBody })
    );
  }

  await page.route('**/api/v1/csrf-token', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf' }),
    })
  );

  await page.route('**/api/v1/categories', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    })
  );

  await page.route('**/api/v1/admin/homepage/manager**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === 'GET' && pathname.endsWith('/media-library')) {
      const versions = Object.fromEntries(
        Object.entries(manager.versions).map(([key, value]) => [key, value.settings.mediaLibrary])
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ activeVersion: manager.activeVersion, versions }),
      });
      return;
    }

    if (request.method() === 'GET' && pathname.endsWith('/manager')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ manager }),
      });
      return;
    }

    const versionMatch = pathname.match(/\/manager\/version\/(v[123])$/);
    if (request.method() === 'PUT' && versionMatch) {
      const version = versionMatch[1];
      const payload = request.postDataJSON();
      renamePayloads.push(payload);
      manager = {
        ...manager,
        versions: {
          ...manager.versions,
          [version]: {
            ...manager.versions[version],
            ...payload,
            settings: payload.settings || manager.versions[version].settings,
          },
        },
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ manager, version: manager.versions[version] }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ manager }),
    });
  });

  return { renamePayloads };
}

test.describe('admin homepage manager hardening', () => {
  test('uses a single-column editing workspace at tablet width', async ({ page }) => {
    await mockHomepageManager(page);
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.goto('/admin-homepage.html');
    await expect(page.locator('#selectedHomepageTitle')).toHaveText('Homepage 1');

    const tracks = await page
      .locator('.homepage-manager-layout')
      .evaluate(
        element => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
      );
    expect(tracks).toBe(1);
  });

  test('marks changes dirty and prevents stale publishing', async ({ page }) => {
    await mockHomepageManager(page);
    await page.goto('/admin-homepage.html');
    await expect(page.locator('#selectedHomepageTitle')).toHaveText('Homepage 1');

    await page.locator('#heroIntervalSeconds').fill('7');
    await expect(page.locator('body')).toHaveClass(/is-dirty/);
    await expect(page.locator('#publishSelectedHomepage')).toBeDisabled();
    await expect(page.locator('.homepage-dirty-notice')).toBeVisible();
  });

  test('warns before discarding changes when switching versions', async ({ page }) => {
    await mockHomepageManager(page);
    await page.goto('/admin-homepage.html');
    await expect(page.locator('#selectedHomepageTitle')).toHaveText('Homepage 1');
    await page.locator('#heroIntervalSeconds').fill('8');

    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('unsaved homepage changes');
      await dialog.dismiss();
    });
    await page.locator('[data-select-version="v2"]').click();
    await expect(page.locator('#selectedHomepageTitle')).toHaveText('Homepage 1');
  });

  test('renames the selected homepage through the version API', async ({ page }) => {
    const state = await mockHomepageManager(page);
    await page.goto('/admin-homepage.html');
    await expect(page.locator('#homepageRenameInput')).toHaveValue('Homepage 1');

    await page.locator('#homepageRenameInput').fill('Main Wedding Homepage');
    await page.locator('#homepageRenameSave').click();

    await expect.poll(() => state.renamePayloads.length).toBe(1);
    expect(state.renamePayloads[0]).toEqual({ tabName: 'Main Wedding Homepage' });
  });

  test('traps focus in the category modal and closes it with Escape', async ({ page }) => {
    await mockHomepageManager(page);
    await page.goto('/admin-homepage.html');
    await page.locator('#addCategoryBtn').click();

    const modal = page.locator('#categoryModal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#closeCategoryModal')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });
});
