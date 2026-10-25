import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import zlib from 'node:zlib';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

/**
 * The supplier dashboard under conditions the journey tests do not cover: screen sizes and text
 * zoom, forced colours, reduced motion, a dark system theme, right-to-left text, very long or
 * unusual names, other time zones and a connection that drops. Each run asserts the page stays
 * usable (nothing scrolls sideways, nothing is cut off, no accessibility violations) rather than
 * comparing pixels, so it holds on any machine.
 */

// A real, solid-colour PNG (the server checks image dimensions).
function solidPng(size, [r, g, b]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  });
  const crc = buf => {
    let c = 0xffffffff;
    for (const byte of buf) {
      c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill([r, g, b]).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const runId = createRunId('supplier-dashboard-conditions');
let fixtures;

test.describe.configure({ mode: 'serial' });

test.describe('Supplier dashboard: layout, accessibility and unusual conditions @backend', () => {
  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  async function open(page, context, baseURL, user = fixtures.users.supplier) {
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    await loginAs(page, user);
    await page.goto('/dashboard/supplier');
    await expect(page.locator('#welcome-heading')).toBeVisible();
    // The summary has arrived once the page shows the plan card.
    await expect(page.locator('#my-packages')).not.toContainText('Loading');
  }

  async function putAway(page) {
    // A first visit opens the setup guide on top of the page; put it away.
    if (await page.locator('#sdh-guide-dialog[open]').count()) {
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
    }
  }

  /** How far the page overflows sideways, in pixels (0 when it does not). */
  const sidewaysOverflow = page =>
    page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
    );

  /** Elements wider than the screen that are not inside something that scrolls on purpose. */
  const wideElements = page =>
    page.evaluate(() => {
      const limit = document.documentElement.clientWidth + 1;
      return Array.from(document.querySelectorAll('body *'))
        .filter(el => {
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0 || box.right <= limit) {
            return false;
          }
          for (let node = el.parentElement; node; node = node.parentElement) {
            const overflow = getComputedStyle(node).overflowX;
            if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') {
              return false;
            }
          }
          return getComputedStyle(el).position !== 'fixed';
        })
        .slice(0, 5)
        .map(el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${el.className}`);
    });

  for (const [who, label] of [
    ['supplier', 'an approved supplier'],
    ['pendingSupplier', 'a supplier waiting for approval'],
  ]) {
    for (const [name, viewport] of [
      ['desktop', { width: 1440, height: 900 }],
      ['phone', { width: 390, height: 844 }],
    ]) {
      test(`${label} on a ${name} has no accessibility violations`, async ({
        page,
        context,
        baseURL,
      }) => {
        await page.setViewportSize(viewport);
        await open(page, context, baseURL, fixtures.users[who]);
        await putAway(page);
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'])
          .analyze();
        expect(
          result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`)
        ).toEqual([]);
      });
    }
  }

  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    test(`nothing scrolls sideways or is wider than the screen at ${width}px`, async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, context, baseURL);
      await putAway(page);
      expect(await sidewaysOverflow(page)).toBe(0);
      expect(await wideElements(page)).toEqual([]);
    });
  }

  test('text zoomed to 200% and the page reflowed to 320px stay usable', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await open(page, context, baseURL);
    await putAway(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await sidewaysOverflow(page)).toBe(0);
    // The main action is still on the page and can be reached.
    await expect(page.locator('#sdh-next-action')).toBeVisible();
    await page.locator('#toggle-profile-form').scrollIntoViewIfNeeded();
    await expect(page.locator('#toggle-profile-form')).toBeVisible();
  });

  test('forced colours keep every control visible and the page in one column', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, context, baseURL);
    await putAway(page);
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    expect(await sidewaysOverflow(page)).toBe(0);
    for (const selector of ['#toggle-profile-form', '#sdh-next-action', '#sdh-guide-open']) {
      const box = await page.locator(selector).boundingBox();
      expect(box && box.width > 0 && box.height > 0, `${selector} is drawn`).toBe(true);
    }
    // The focus ring survives forced colours (outline, not a box-shadow that is removed).
    await page.locator('#toggle-profile-form').focus();
    const outline = await page
      .locator('#toggle-profile-form')
      .evaluate(el => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('reduced motion stops animation', async ({ page, context, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, context, baseURL);
    await putAway(page);
    const moving = await page.evaluate(() =>
      document
        .getAnimations()
        .filter(animation => animation.playState === 'running')
        .filter(animation => {
          const timing = animation.effect && animation.effect.getComputedTiming();
          return timing && (timing.iterations === Infinity || timing.duration > 400);
        })
        .map(animation => animation.effect.target && animation.effect.target.className)
    );
    expect(moving).toEqual([]);
  });

  test('a dark system theme leaves the page readable (the page has no dark styling of its own)', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, context, baseURL);
    await putAway(page);
    const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(
      result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`)
    ).toEqual([]);
  });

  test('right-to-left text does not break the layout', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, context, baseURL);
    await putAway(page);
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
    });
    expect(await sidewaysOverflow(page)).toBe(0);
    await expect(page.locator('#welcome-heading')).toBeVisible();
  });

  test('very long names, emoji and right-to-left names fit on a phone and nothing is lost', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, context, baseURL);
    const longName = `${'Extraordinarily '.repeat(5)}Long 🎉 Events & Catering Ltd`.slice(0, 100);
    const rtlTitle = 'حزمة الحفلات الكبيرة للمناسبات الخاصة 🎂';
    const longTitle =
      `${'Seven-tier celebration cake with ornate sugar flowers '.repeat(2)}🎂`.slice(0, 118);
    const profile = await page.request.patch(`/api/me/suppliers/${fixtures.supplier.id}`, {
      headers: { 'x-eventflow-e2e': 'backend-suite', 'x-csrf-token': 'backend-e2e-csrf-token' },
      data: { name: longName },
    });
    expect(profile.ok()).toBe(true);
    // The plan allows only a few packages, so the existing ones are renamed rather than added to.
    const existing = (await (await page.request.get('/api/me/packages')).json()).items;
    const titles = [rtlTitle, longTitle];
    for (const [index, title] of titles.entries()) {
      if (!existing[index]) {
        break;
      }
      const renamed = await page.request.put(`/api/me/packages/${existing[index].id}`, {
        headers: { 'x-eventflow-e2e': 'backend-suite', 'x-csrf-token': 'backend-e2e-csrf-token' },
        data: {
          title,
          price: '£1,234.50 per person for the full day including setup and clear down',
          description: 'Details '.repeat(120),
        },
      });
      expect(renamed.status(), await renamed.text()).toBeLessThan(300);
    }
    await page.reload();
    await expect(page.locator('#my-packages')).toContainText(rtlTitle);
    await putAway(page);
    expect(await sidewaysOverflow(page)).toBe(0);
    expect(await wideElements(page)).toEqual([]);
    await expect(page.locator('#welcome-heading')).toBeVisible();
    // The full name is still readable somewhere on the page, not cut to nothing.
    await expect(page.locator('body')).toContainText(longName.slice(0, 40));
  });

  test('a profile with a dozen photos shows them, and the page still fits a phone', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, context, baseURL);
    await page.locator('#toggle-profile-form').click();
    await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();
    const kept = page.locator('#sup-photo-preview .photo-preview-item--existing');
    const removeAll = async () => {
      while ((await kept.count()) > 0) {
        const left = await kept.count();
        await kept.first().locator('.photo-delete-btn').click();
        await page.locator('dialog[open] button', { hasText: /^Remove photo/ }).click();
        await expect(kept).toHaveCount(left - 1);
      }
    };
    await removeAll();
    const files = Array.from({ length: 12 }, (_, i) => ({
      name: `photo-${i}-${runId.slice(-5)}.png`,
      mimeType: 'image/png',
      buffer: solidPng(64, [(i * 20) % 255, 90, 160]),
    }));
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#sup-photo-drop').click(),
    ]);
    await chooser.setFiles(files);
    // More than the plan allows: nothing is half-uploaded, and the supplier is told the limit.
    const toast = page.locator('.sdh-toast, [role="status"], .toast').filter({
      hasText: /maximum of \d+ photos/,
    });
    await expect(toast.first()).toBeVisible({ timeout: 15000 });
    const allowed = Number(/maximum of (\d+) photos/.exec(await toast.first().innerText())[1]);
    expect(await page.locator('#sup-photo-preview .photo-preview-item').count()).toBe(0);

    // As many as the plan allows are all saved and shown, and the page still fits a phone.
    // The picker's own input, used directly (the drop zone is under the warning).
    await page.locator('body > input[type=file]').setInputFiles(files.slice(0, allowed));
    await expect(kept).toHaveCount(allowed, { timeout: 60000 });
    expect(await sidewaysOverflow(page)).toBe(0);
    expect(await wideElements(page)).toEqual([]);
    await page.keyboard.press('Escape');
    const discard = page.locator('dialog[open] button', { hasText: /^Discard/ });
    if (await discard.count()) {
      await discard.first().click();
    }
    // Leave the profile as it was found.
    await page.reload();
    await page.locator('#toggle-profile-form').click();
    await removeAll();
  });

  test('a supplier waiting for approval cannot read enquiries, and the card says why', async ({
    page,
    context,
    baseURL,
  }) => {
    await open(page, context, baseURL, fixtures.users.pendingSupplier);
    const refused = await page.request.get('/api/supplier/enquiries');
    expect(refused.status()).toBe(403);
    expect((await refused.json()).code).toBe('SUPPLIER_NOT_APPROVED');
    await expect(page.locator('#sdh-enquiries')).toContainText(/approved/i);
    await expect(page.locator('#sdh-enquiries-open')).toBeHidden();
  });

  test('an approved supplier reads only their own enquiries', async ({
    page,
    context,
    baseURL,
  }) => {
    await open(page, context, baseURL);
    const mine = await page.request.get('/api/supplier/enquiries');
    expect(mine.status()).toBe(200);
    const other = await page.request.get('/api/supplier/enquiries/qr_not_mine');
    expect(other.status()).toBe(404);
  });

  test('the dashboard, its editors and its drawer load without a single Content-Security-Policy violation', async ({
    page,
    context,
    baseURL,
  }) => {
    // The server sends the production policy; any inline handler, blocked image host or script from
    // somewhere not allowed would show up here as a violation (and would be blocked in production).
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        window.__cspViolations.push(
          `${event.violatedDirective} blocked ${event.blockedURI || 'inline'} (${event.sourceFile || ''}:${event.lineNumber || ''})`
        );
      });
    });
    await open(page, context, baseURL);
    await putAway(page);
    await page.locator('#toggle-profile-form').click();
    await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();
    await page.keyboard.press('Escape');
    const discard = page.locator('dialog[open] button', { hasText: /^Discard/ });
    if (await discard.count()) {
      await discard.first().click();
    }
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    // The button only shows once there is an enquiry; the page's own event opens the same drawer.
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('sdh:open-enquiries')));
    await expect(page.locator('#sdh-enquiries-dialog[open]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.locator('#sdh-guide-open').click();
    await expect(page.locator('#sdh-guide-dialog[open]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  });

  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ]) {
    test(`the page does not jump while it loads, and stays within its weight budget (${name})`, async ({
      page,
      context,
      baseURL,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'layout-shift and size measurements are Chromium APIs');
      await page.setViewportSize(viewport);
      const bytes = { script: 0, stylesheet: 0, requests: 0 };
      page.on('response', async response => {
        try {
          const type = response.request().resourceType();
          bytes.requests += 1;
          if (type === 'script' || type === 'stylesheet') {
            bytes[type] += (await response.body()).length;
          }
        } catch {
          /* a response that was cancelled with the page */
        }
      });
      await page.addInitScript(() => {
        window.__layoutShift = 0;
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              window.__layoutShift += entry.value;
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await open(page, context, baseURL);
      await page.waitForTimeout(2500);
      const shift = await page.evaluate(() => window.__layoutShift);
      // Google's "good" Cumulative Layout Shift is 0.1 or less.
      expect(shift).toBeLessThanOrEqual(0.1);
      // A budget, not a target: today about 1.1 MB of script and 0.4 MB of style in 85 requests.
      expect(bytes.script).toBeLessThan(1.5 * 1024 * 1024);
      expect(bytes.stylesheet).toBeLessThan(0.6 * 1024 * 1024);
      expect(bytes.requests).toBeLessThan(120);
    });
  }

  for (const timezoneId of ['Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata']) {
    test.describe(`in ${timezoneId}`, () => {
      test.use({ timezoneId });

      test('a day picked in the calendar is the day that is filled in', async ({
        page,
        context,
        baseURL,
      }) => {
        await open(page, context, baseURL);
        await putAway(page);
        // The "+" on a day names that day; the form opens on that day whatever the time zone.
        const plus = page.locator('.cal-day-add-btn').nth(20);
        // The label is spoken ("Add entry for Saturday, 17 October 2026", with or without the comma); the cell carries the ISO day.
        const label = await plus.getAttribute('aria-label');
        expect(label).toMatch(/^Add entry for [A-Za-z]+,? \d{1,2} [A-Za-z]+ \d{4}$/);
        const isoDay = await plus.evaluate(element =>
          element.closest('.fc-daygrid-day').getAttribute('data-date')
        );
        expect(isoDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        await plus.evaluate(element => element.click());
        await expect(page.locator('#sup-cal-entry-date')).toHaveValue(isoDay);
      });

      test('the dates on the page are valid dates, not "Invalid Date" or NaN', async ({
        page,
        context,
        baseURL,
      }) => {
        await open(page, context, baseURL);
        await putAway(page);
        const text = await page.locator('body').innerText();
        expect(text).not.toMatch(/Invalid Date|NaN|undefined/);
      });
    });
  }

  test('a connection that drops mid-upload leaves the page usable and works again afterwards', async ({
    page,
    context,
    baseURL,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'network throttling uses the Chrome DevTools protocol');
    await open(page, context, baseURL);
    await putAway(page);

    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    // A slow connection first (3G-like), then none at all while the banner is being uploaded.
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (400 * 1024) / 8,
    });
    await page.locator('#sdh-banner-input').setInputFiles({
      name: 'slow.png',
      mimeType: 'image/png',
      buffer: solidPng(64, [30, 140, 90]),
    });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await page.waitForTimeout(1500);

    // The page did not freeze: it still opens and closes things.
    await page.locator('#toggle-profile-form').click();
    await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();
    await page.keyboard.press('Escape');
    const discard = page.locator('dialog[open] button', { hasText: /^Discard/ });
    if (await discard.count()) {
      await discard.first().click();
    }
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // Back online, the same page works without a reload.
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await page.locator('#toggle-profile-form').click();
    await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();
    await expect(page.locator('#sup-name')).toHaveValue(/\S/);
  });
});
