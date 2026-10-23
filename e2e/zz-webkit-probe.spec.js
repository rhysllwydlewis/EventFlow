import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

// TEMPORARY diagnostic (removed before merge): which rule of admin-navbar.css stops
// requestAnimationFrame in WebKit once admin-navbar.js has drawn the bar?
test.describe('webkit probe @backend', () => {
  const runId = createRunId('wk-probe');
  let fixtures;
  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });
  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  // Frames in one second, or "none" when no frame has come after 2 seconds.
  const frames = page =>
    page.evaluate(
      () =>
        new Promise(resolve => {
          let n = 0;
          const started = performance.now();
          const tick = () => {
            n++;
            if (performance.now() - started < 1000) {
              requestAnimationFrame(tick);
            } else {
              resolve(n);
            }
          };
          requestAnimationFrame(tick);
          setTimeout(() => resolve(n ? n : 'none'), 2200);
        })
    );

  async function measure(browser, baseURL, label, css) {
    const context = await browser.newContext({ baseURL });
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    const page = await context.newPage();
    let result;
    try {
      await loginAs(page, fixtures.users.admin);
      await page.route('**/admin-packages', async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace('</head>', `<style>${css}</style></head>`);
        await route.fulfill({ response, body });
      });
      await page.goto('/admin-packages', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(500);
      result = await frames(page);
    } catch (error) {
      result = `error ${String(error.message).split('\n')[0]}`;
    }
    await context.close();
    console.log(`PROBE ${label}: ${result}`);
  }

  test('probe', async ({ browser, baseURL, browserName, request }) => {
    test.skip(browserName !== 'webkit', 'diagnostic for WebKit only');
    test.setTimeout(300000);
    const noAnimation =
      '*,*::before,*::after{animation:none !important;transition:none !important}';
    const noBlur =
      '*,*::before,*::after{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}';
    const noDot = '.db-status-dot,.admin-qnav-spark,.pulse{animation:none !important}';
    await measure(browser, baseURL, 'unchanged', '');
    await measure(browser, baseURL, 'no animations', noAnimation);
    await measure(browser, baseURL, 'no backdrop blur', noBlur);
    await measure(browser, baseURL, 'no animations and no blur', noAnimation + noBlur);
    await measure(browser, baseURL, 'no status dot or spark pulse', noDot);
    await measure(browser, baseURL, 'navbar hidden', '#adminNavbarMount{display:none !important}');
    await measure(
      browser,
      baseURL,
      'navbar invisible but laid out',
      '#adminNavbarMount{visibility:hidden !important}'
    );
    expect(request).toBeTruthy();
  });
});
