import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

test.describe('Desktop customer and supplier account navigation @backend', () => {
  const runId = createRunId('account-menu');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });
  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  async function open(page, context, baseURL, role, path = `/dashboard/${role}`) {
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, fixtures.users[role]);
    await page.goto(path);
    if (await page.locator('#sdh-guide-dialog[open]').count()) {
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('#ef-account-toggle')).toBeVisible();
  }

  for (const role of ['customer', 'supplier']) {
    test(`${role}: Settings opens the account page and Dashboard stays separate`, async ({
      page,
      context,
      baseURL,
    }) => {
      await open(page, context, baseURL, role);
      const toggle = page.getByRole('button', { name: 'Account', exact: true });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#ef-account-panel')).toBeHidden();
      await expect(page.locator('#ef-auth-link')).toBeHidden();
      await expect(page.locator('#ef-dashboard-link')).toHaveAttribute(
        'href',
        `/dashboard/${role}`
      );
      await expect(page.locator('#ef-dashboard-link')).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#ef-account-panel a, #ef-account-panel button')).toHaveText([
        'Settings',
        'Log out',
      ]);
      await page.locator('#ef-account-settings').click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
      await page.locator('#ef-account-toggle').click();
      await expect(page.locator('#ef-account-settings')).toHaveAttribute('aria-current', 'page');
      await page.locator('#ef-dashboard-link').click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/${role}$`));
    });

    test(`${role}: keyboard opening, tab order, Escape and focus leaving work`, async ({
      page,
      context,
      baseURL,
    }) => {
      await open(page, context, baseURL, role, '/guides');
      const toggle = page.locator('#ef-account-toggle');
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Tab');
      await expect(page.locator('#ef-account-settings')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.locator('#ef-account-logout')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(page.locator('#ef-dashboard-link')).toBeFocused();
      await expect(page.locator('#ef-account-panel')).toBeHidden();
    });

    test(`${role}: outside clicks close the dropdown and the bell still opens`, async ({
      page,
      context,
      baseURL,
    }) => {
      await open(page, context, baseURL, role, '/guides');
      const toggle = page.locator('#ef-account-toggle');
      await toggle.click();
      await toggle.click();
      await expect(page.locator('#ef-account-panel')).toBeHidden();
      await toggle.click();
      await page.locator('main').click({ position: { x: 10, y: 10 } });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await page.locator('#ef-notification-btn').click();
      await expect(page.locator('#ef-account-panel')).toBeHidden();
      await expect(page.locator('#notification-dropdown')).toBeVisible();
    });

    test(`${role}: desktop widths fit, the open menu is accessible, and resize closes it`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      await open(page, context, baseURL, role);
      for (const width of [1100, 1152, 1199, 1200, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        const controls = page.locator(
          '.ef-header-content a:visible, .ef-header-content button:visible'
        );
        const boxes = [];
        for (const control of await controls.all()) {
          const box = await control.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
          boxes.push(box);
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i],
              b = boxes[j];
            expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)).toBeLessThanOrEqual(
              1
            );
          }
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('#ef-account-toggle').click();
      const a11y = await new AxeBuilder({ page }).include('.ef-header').analyze();
      expect(a11y.violations).toEqual([]);
      await testInfo.attach(`${role}-desktop-account-menu`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await page.setViewportSize({ width: 1024, height: 900 });
      await expect(page.locator('#ef-account-toggle')).toBeHidden();
      await expect(page.locator('#ef-account-panel')).toBeHidden();
      await expect(page.locator('#ef-account-toggle')).toHaveAttribute('aria-expanded', 'false');
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.locator('#ef-account-panel')).toBeHidden();
    });

    test(`${role}: desktop Log out clears the real session`, async ({ page, context, baseURL }) => {
      await open(page, context, baseURL, role, '/guides');
      await page.locator('#ef-account-toggle').click();
      const ended = page.waitForResponse(
        r => r.url().includes('/api/v1/auth/logout') && r.request().method() === 'POST'
      );
      await page.locator('#ef-account-logout').click();
      expect((await ended).ok()).toBe(true);
      await expect(page).toHaveURL(/\/?t=/);
      expect((await (await page.request.get('/api/v1/auth/me')).json()).user).toBeNull();
      await expect(page.locator('#ef-account-toggle')).toBeHidden();
    });

    test(`${role}: the hamburger retains Settings and Log out on phones and small laptops`, async ({
      page,
      context,
      baseURL,
    }) => {
      await open(page, context, baseURL, role, '/guides');
      for (const width of [1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator('#ef-account-toggle')).toBeHidden();
        await page.locator('#ef-mobile-toggle').click();
        await expect(page.locator('#ef-mobile-settings')).toBeVisible();
        await expect(page.locator('#ef-mobile-logout')).toBeVisible();
        await page.locator('#ef-mobile-settings').click();
        await expect(page).toHaveURL(/\/settings$/);
        await page.goto('/guides');
      }
      await page.locator('#ef-mobile-toggle').click();
      await page.locator('#ef-mobile-logout').click();
      await expect(page).toHaveURL(/\/?t=/);
      expect((await (await page.request.get('/api/v1/auth/me')).json()).user).toBeNull();
    });
  }

  test('signed-out visitors retain Log in without an Account dropdown', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/guides');
    await expect(page.locator('#ef-auth-link')).toHaveText('Log in');
    await expect(page.locator('#ef-auth-link')).toBeVisible();
    await expect(page.locator('#ef-account-toggle')).toBeHidden();
  });

  test('an admin using the public header retains the existing admin navigation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, fixtures.users.admin);
    await page.goto('/guides');
    await expect(page.locator('#ef-auth-link')).toHaveText('Log out');
    await expect(page.locator('#ef-auth-link')).toBeVisible();
    await expect(page.locator('#ef-dashboard-link')).toHaveAttribute('href', '/admin');
    await expect(page.locator('#ef-account-toggle')).toBeHidden();
  });
});
