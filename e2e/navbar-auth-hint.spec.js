import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

/**
 * The header while the server is still being asked who is signed in.
 *
 * Every page asks /api/v1/auth/me, which takes a moment. The header used to draw "Log in" until it
 * answered and then swap in Account and Dashboard, so a signed-in person saw "Log in" flash up and
 * the nav links jumped sideways (113px at 1440px wide), sometimes under the cursor. navbar.js now
 * remembers the account type (ef_auth_hint) and utils/auth-hint.js, running from <head>, lets
 * navbar.css draw the signed-in header from the first frame.
 *
 * The auth reply is delayed here, and the header is sampled on every animation frame from before
 * the page's scripts run, so a flash that lasts one frame is still caught.
 *
 * The page file is served as it is on disk: the server strips the Dashboard label from the markup
 * it sends to anonymous requests, but a signed-in browser is sent the full header.
 */

// Playwright runs from the repository root.
const PUBLIC_DIR = path.resolve('public');
const PAGE = '/pricing';
const AUTH_DELAY_MS = 900;

/** Page markup as a signed-in browser receives it, and the API answers, for one scenario. */
async function stage(
  page,
  { role = 'customer', delay = AUTH_DELAY_MS, status = 200, onLogout = null, extraCss = '' } = {}
) {
  const session = { on: status === 200 };
  const html = fs
    .readFileSync(path.join(PUBLIC_DIR, 'pricing.html'), 'utf8')
    .replace('</head>', () => `<style>${extraCss}</style></head>`);
  await page.route(`**${PAGE}`, route =>
    route.request().resourceType() === 'document'
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
      : route.fallback()
  );
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (/\/api\/v1\/auth\/me/.test(url)) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return route.fulfill({
        status: session.on ? 200 : 401,
        contentType: 'application/json',
        body: session.on ? JSON.stringify({ user: { id: 'u1', role } }) : '{}',
      });
    }
    if (/\/api\/v1\/auth\/logout/.test(url)) {
      if (onLogout) {
        await onLogout();
      }
      session.on = false;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (/csrf-token/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"csrfToken":"t"}',
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/** Seeds localStorage before any page script runs. */
const seedHint = (page, value) =>
  page.addInitScript(hint => {
    try {
      window.localStorage.setItem('ef_auth_hint', hint);
    } catch {
      // Storage unavailable.
    }
  }, value);

/** Records the header on every animation frame from before the page's scripts run. */
const startSampling = page =>
  page.addInitScript(() => {
    window.__header = [];
    const visible = el => {
      if (!el) {
        return false;
      }
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const frame = () => {
      const auth = document.getElementById('ef-auth-link');
      const nav = document.querySelector('.ef-nav-desktop');
      const link = nav && nav.querySelector('a');
      const bottom = Array.from(document.querySelectorAll('.ef-bottom-nav .ef-bottom-link'))
        .filter(visible)
        .map(el => Math.round(el.getBoundingClientRect().left));
      window.__header.push({
        loginShown: visible(auth) && /log in/i.test(auth.textContent || ''),
        navLeft: visible(nav) && link ? link.getBoundingClientRect().left : null,
        accountShown: visible(document.querySelector('.ef-account-menu')),
        bottom: bottom.join(','),
      });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

const samples = page => page.evaluate(() => window.__header);

test.describe('Header before the server has answered', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a signed-in browser never sees "Log in", and the nav links do not move', async ({
    page,
  }) => {
    await stage(page);
    await seedHint(page, 'customer');
    await startSampling(page);
    await page.goto(PAGE, { waitUntil: 'commit' });
    await expect(page.locator('#ef-account-toggle')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/, { timeout: 5000 });
    await page.waitForTimeout(150);

    const frames = await samples(page);
    expect(frames.length).toBeGreaterThan(20);
    expect(frames.filter(frame => frame.loginShown)).toHaveLength(0);

    const lefts = frames.map(frame => frame.navLeft).filter(left => left !== null);
    expect(lefts.length).toBeGreaterThan(10);
    // Without the hint these moved by 113px; allow a pixel for text rounding.
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(2);
  });

  test('the hint holds for suppliers too', async ({ page }) => {
    await stage(page, { role: 'supplier' });
    await seedHint(page, 'supplier');
    await startSampling(page);
    await page.goto(PAGE, { waitUntil: 'commit' });
    await expect(page.locator('#ef-account-toggle')).toBeVisible();
    const frames = await samples(page);
    expect(frames.filter(frame => frame.loginShown)).toHaveLength(0);
  });

  test('with no hint (a first visit) the header waits as before, so a visitor still sees "Log in"', async ({
    page,
  }) => {
    await stage(page, { status: 401 });
    await startSampling(page);
    await page.goto(PAGE, { waitUntil: 'commit' });
    await expect(page.locator('#ef-auth-link')).toBeVisible();
    await page.waitForTimeout(AUTH_DELAY_MS + 300);
    const frames = await samples(page);
    expect(frames.some(frame => frame.loginShown)).toBe(true);
    expect(frames.every(frame => !frame.accountShown)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('ef_auth_hint'))).toBeNull();
  });

  test('the control: without the hint, a signed-in person does see "Log in" first and the nav moves', async ({
    page,
  }) => {
    await stage(page);
    await startSampling(page);
    await page.goto(PAGE, { waitUntil: 'commit' });
    await expect(page.locator('#ef-account-toggle')).toBeVisible();
    const frames = await samples(page);
    expect(frames.some(frame => frame.loginShown)).toBe(true);
    const lefts = frames.map(frame => frame.navLeft).filter(left => left !== null);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeGreaterThan(50);
  });

  test('a hint left by an ended session is corrected: "Log in" returns and the hint is forgotten', async ({
    page,
  }) => {
    await stage(page, { status: 401, delay: 400 });
    await seedHint(page, 'customer');
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#ef-auth-link')).toBeVisible();
    await expect(page.locator('#ef-auth-link')).toHaveText('Log in');
    await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/);
    expect(await page.evaluate(() => localStorage.getItem('ef_auth_hint'))).toBeNull();
  });

  test('signing in as each kind of account remembers it, and an admin is not remembered', async ({
    page,
  }) => {
    for (const [role, expected] of [
      ['customer', 'customer'],
      ['supplier', 'supplier'],
      ['admin', null],
    ]) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await stage(page, { role, delay: 100 });
      await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#ef-dashboard-link')).toBeVisible();
      // The header draws from the hint first; what is stored changes when the server has answered.
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('ef_auth_hint')))
        .toBe(expected);
    }
  });

  test('only a customer or supplier hint is acted on; anything else is ignored', async ({
    page,
  }) => {
    await stage(page, { status: 401, delay: 600 });
    for (const junk of ['admin', 'partner', '<b>x</b>', 'true', '']) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await stage(page, { status: 401, delay: 600 });
      await page.addInitScript(value => {
        try {
          window.localStorage.setItem('ef_auth_hint', value);
        } catch {
          // Storage unavailable.
        }
      }, junk);
      await page.goto(PAGE, { waitUntil: 'commit' });
      await expect(page.locator('#ef-auth-link')).toBeVisible();
      await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/);
    }
  });

  test('logging out forgets the hint before the request is even sent', async ({ page }) => {
    let storedAtLogout = 'not called';
    await stage(page, {
      delay: 100,
      onLogout: async () => {
        storedAtLogout = await page.evaluate(() => localStorage.getItem('ef_auth_hint'));
      },
    });
    await seedHint(page, 'customer');
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.locator('#ef-account-toggle').click();
    await page.locator('#ef-account-logout').click();
    await page.waitForURL(/\/\?t=/);
    expect(storedAtLogout).toBeNull();
  });

  test('with storage blocked the page still works and shows the signed-in header', async ({
    page,
  }) => {
    await stage(page, { delay: 200 });
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('blocked');
        },
      });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(`${error.message} ${error.stack || ''}`));
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#ef-account-toggle')).toBeVisible();
    // Other scripts on the page may not guard their own storage use; these two must.
    expect(errors.filter(message => /auth-hint\.js|navbar\.js/.test(message))).toEqual([]);
  });

  test('between 1100px and 1279px the signed-in header has no nav row, from the first frame', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await stage(page);
    await seedHint(page, 'customer');
    await startSampling(page);
    await page.goto(PAGE, { waitUntil: 'commit' });
    await expect(page.locator('#ef-dashboard-link')).toBeVisible();
    const frames = await samples(page);
    expect(frames.filter(frame => frame.loginShown)).toHaveLength(0);
    // The desktop nav row is hidden for a signed-in account at this width, and was never drawn.
    expect(frames.filter(frame => frame.navLeft !== null)).toHaveLength(0);
  });
});

test.describe('Bottom tab bar on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  test('a signed-in browser gets its final tabs from the first frame instead of reflowing', async ({
    page,
  }) => {
    await stage(page);
    await seedHint(page, 'customer');
    await startSampling(page);
    await page.goto(PAGE, { waitUntil: 'commit' });
    await expect(page.locator('#ef-bottom-dashboard')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/, { timeout: 5000 });
    await page.waitForTimeout(150);
    const layouts = (await samples(page)).map(frame => frame.bottom).filter(Boolean);
    expect(layouts.length).toBeGreaterThan(10);
    expect(new Set(layouts).size).toBe(1);
  });

  test('the control: without the hint the tabs reflow when the server answers', async ({
    page,
  }) => {
    await stage(page);
    await startSampling(page);
    await page.goto(PAGE, { waitUntil: 'commit' });
    await expect(page.locator('#ef-bottom-dashboard')).toBeVisible();
    await page.waitForTimeout(400);
    const layouts = (await samples(page)).map(frame => frame.bottom).filter(Boolean);
    expect(new Set(layouts).size).toBeGreaterThan(1);
  });
});

test.describe('Reserved width follows the device', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // A device whose fonts make the signed-in buttons wider than in the reference rendering.
  const WIDER_BUTTONS =
    'html body .ef-header .ef-header-actions #ef-dashboard-link{padding-left:34px !important;padding-right:34px !important}';

  test('the page remembers its real width, and the next page reserves exactly that', async ({
    page,
  }) => {
    await stage(page, { delay: 400, extraCss: WIDER_BUTTONS });
    await seedHint(page, 'customer');
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/, { timeout: 5000 });

    const measured = await page.evaluate(() => ({
      stored: Number(localStorage.getItem('ef_auth_hint_w')),
      actual: document.querySelector('.ef-header-actions').getBoundingClientRect().width,
    }));
    // About 40px wider than the 302.28px reference, and exactly what the header measures.
    expect(measured.stored).toBeGreaterThan(330);
    expect(Math.abs(measured.stored - measured.actual)).toBeLessThan(0.1);

    // The next page, on the same device: the reservation is that width, and nothing moves.
    await startSampling(page);
    await page.reload({ waitUntil: 'commit' });
    await expect(page.locator('#ef-account-toggle')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/, { timeout: 5000 });
    const frames = await samples(page);
    expect(frames.filter(frame => frame.loginShown)).toHaveLength(0);
    const lefts = frames.map(frame => frame.navLeft).filter(left => left !== null);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(1.5);
  });

  test('the control: on that device a first visit uses the default and the nav shifts a little', async ({
    page,
  }) => {
    await stage(page, { delay: 400, extraCss: WIDER_BUTTONS });
    await seedHint(page, 'customer');
    await startSampling(page);
    await page.goto(PAGE, { waitUntil: 'commit' });
    await expect(page.locator('#ef-account-toggle')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/, { timeout: 5000 });
    const frames = await samples(page);
    const lefts = frames.map(frame => frame.navLeft).filter(left => left !== null);
    // Still nothing like the 113px of the original problem, but measurably more than with the width.
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeGreaterThan(5);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(40);
  });

  test('a remembered width outside any plausible range is ignored', async ({ page }) => {
    await stage(page, { delay: 400 });
    for (const bad of ['9999', '12', 'abc', '-300']) {
      await page.addInitScript(value => {
        try {
          window.localStorage.setItem('ef_auth_hint_w', value);
        } catch {
          // Storage unavailable.
        }
      }, bad);
    }
    await seedHint(page, 'customer');
    await page.goto(PAGE, { waitUntil: 'commit' });
    await expect(page.locator('html')).toHaveClass(/ef-hint-in/);
    const reserved = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--ef-hint-actions-w')
    );
    expect(reserved).toBe('');
  });

  test('logging out forgets the width as well', async ({ page }) => {
    let atLogout = 'not called';
    await stage(page, {
      delay: 100,
      onLogout: async () => {
        atLogout = await page.evaluate(() => localStorage.getItem('ef_auth_hint_w'));
      },
    });
    await seedHint(page, 'customer');
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/, { timeout: 5000 });
    expect(await page.evaluate(() => localStorage.getItem('ef_auth_hint_w'))).not.toBeNull();
    await page.locator('#ef-account-toggle').click();
    await page.locator('#ef-account-logout').click();
    await page.waitForURL(/\/\?t=/);
    expect(atLogout).toBeNull();
  });
});

test.describe('Failsafe', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('if the header script never loads, "Log in" comes back instead of staying hidden', async ({
    page,
  }) => {
    await stage(page, { status: 401 });
    await page.route('**/assets/js/navbar.js*', route => route.abort());
    await seedHint(page, 'customer');
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    // While the hint holds, "Log in" is hidden; if nothing settles it, it is given up after 6s.
    await expect(page.locator('html')).toHaveClass(/ef-hint-in/);
    await expect(page.locator('#ef-auth-link')).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/, { timeout: 9000 });
    await expect(page.locator('#ef-auth-link')).toBeVisible();
  });
});

test.describe('Version 2 homepage, which has its own header', () => {
  const V2 = '/home-v2.html';

  async function stageV2(page, { status = 200, role = 'customer' } = {}) {
    await page.route('**/api/**', async route => {
      if (/\/api\/v1\/auth\/me/.test(route.request().url())) {
        await new Promise(resolve => setTimeout(resolve, AUTH_DELAY_MS));
        return route.fulfill({
          status,
          contentType: 'application/json',
          body: status === 200 ? JSON.stringify({ user: { id: 'u1', role } }) : '{}',
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  }

  const sampleV2 = page =>
    page.addInitScript(() => {
      window.__v2 = [];
      const visible = el => {
        if (!el) {
          return false;
        }
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      const frame = () => {
        const auth = document.getElementById('hv2-auth-link');
        const link = document.querySelector('.hv2-nav a');
        window.__v2.push({
          loginShown: visible(auth) && /log in|sign in/i.test(auth.textContent || ''),
          navLeft: link && visible(link) ? link.getBoundingClientRect().left : null,
          bottom: Array.from(document.querySelectorAll('.hv2-bottom-link'))
            .filter(visible)
            .map(el => Math.round(el.getBoundingClientRect().left))
            .join(','),
        });
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a signed-in browser never sees "Log in" and the nav does not move', async ({ page }) => {
      await stageV2(page);
      await seedHint(page, 'customer');
      await sampleV2(page);
      await page.goto(V2, { waitUntil: 'commit' });
      await expect(page.locator('.ef-header, .hv2-header').first()).toBeVisible();
      await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/, { timeout: 8000 });
      const frames = await page.evaluate(() => window.__v2);
      expect(frames.length).toBeGreaterThan(10);
      expect(frames.filter(frame => frame.loginShown)).toHaveLength(0);
      const lefts = frames.map(frame => frame.navLeft).filter(left => left !== null);
      expect(lefts.length).toBeGreaterThan(5);
      expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(2);
      expect(await page.evaluate(() => localStorage.getItem('ef_auth_hint'))).toBe('customer');
    });

    test('the control: without the hint the v2 header shows "Log in" first and moves', async ({
      page,
    }) => {
      await stageV2(page);
      await sampleV2(page);
      await page.goto(V2, { waitUntil: 'commit' });
      await expect(page.locator('.hv2-header .hv2-dashboard-link')).toBeVisible({ timeout: 8000 });
      const frames = await page.evaluate(() => window.__v2);
      expect(frames.some(frame => frame.loginShown)).toBe(true);
      const lefts = frames.map(frame => frame.navLeft).filter(left => left !== null);
      expect(Math.max(...lefts) - Math.min(...lefts)).toBeGreaterThan(20);
    });

    test('an ended session corrects the hint: "Log in" returns and the hint is forgotten', async ({
      page,
    }) => {
      await stageV2(page, { status: 401 });
      await seedHint(page, 'customer');
      await page.goto(V2, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#hv2-auth-link')).toBeVisible({ timeout: 8000 });
      await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/);
      expect(await page.evaluate(() => localStorage.getItem('ef_auth_hint'))).toBeNull();
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

    test('the bottom bar has its final tabs from the first frame', async ({ page }) => {
      await stageV2(page);
      await seedHint(page, 'customer');
      await sampleV2(page);
      await page.goto(V2, { waitUntil: 'commit' });
      await expect(page.locator('.ef-header, .hv2-header').first()).toBeVisible();
      await expect(page.locator('html')).not.toHaveClass(/ef-hint-in/, { timeout: 8000 });
      await page.waitForTimeout(150);
      const layouts = (await page.evaluate(() => window.__v2))
        .map(frame => frame.bottom)
        .filter(Boolean);
      expect(layouts.length).toBeGreaterThan(10);
      expect(new Set(layouts).size).toBe(1);
    });
  });
});
