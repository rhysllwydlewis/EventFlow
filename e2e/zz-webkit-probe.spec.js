import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

// TEMPORARY diagnostic: does requestAnimationFrame run on these pages in WebKit?
test.describe('webkit probe @backend', () => {
  const runId = createRunId('wk-probe');
  let fixtures;
  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });
  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  const rafCount = page =>
    page.evaluate(
      () =>
        new Promise(resolve => {
          let n = 0;
          const end = performance.now() + 1500;
          const tick = () => {
            n++;
            if (performance.now() < end) {
              requestAnimationFrame(tick);
            } else {
              resolve(n);
            }
          };
          requestAnimationFrame(tick);
          setTimeout(() => resolve(`stalled at ${n}`), 4000);
        })
    );

  test('probe', async ({ page, context, baseURL, browserName }) => {
    test.skip(browserName !== 'webkit', 'diagnostic for WebKit only');
    const out = {};
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    await loginAs(page, fixtures.users.admin);
    await page.goto('/admin-packages');
    await expect(page.locator('#packagesContainer table')).toBeVisible();
    out.state = await page.evaluate(() => ({
      visibility: document.visibilityState,
      focus: document.hasFocus(),
    }));
    out.admin = await rafCount(page);
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none !important;transition:none !important}',
    });
    out.adminNoAnimations = await rafCount(page);
    await page.evaluate(() => {
      const nav = document.getElementById('adminNavbarMount');
      if (nav) {
        nav.style.display = 'none';
      }
    });
    out.adminNoNavbar = await rafCount(page);
    const t0 = Date.now();
    let click = 'ok';
    try {
      await page.getByRole('button', { name: 'Real Only', exact: true }).click({ timeout: 5000 });
    } catch (error) {
      click = 'failed';
    }
    out.clickAfterChanges = `${click} in ${Date.now() - t0}ms`;

    await page.goto('/admin-packages');
    await expect(page.locator('#packagesContainer table')).toBeVisible();
    out.adminAgain = await rafCount(page);
    await page.mouse.move(300, 300);
    out.adminAfterMouse = await rafCount(page);

    await page.goto('/about');
    out.publicPage = await rafCount(page);
    console.log(`PROBE ${JSON.stringify(out)}`);
  });
});
