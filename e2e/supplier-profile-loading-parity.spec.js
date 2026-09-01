import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const TEST_ID = 'loading-parity-test';
const supplierHtml = fs.readFileSync(path.resolve(process.cwd(), 'public/supplier.html'), 'utf8');

const supplier = {
  id: TEST_ID,
  name: 'Loading Parity Supplier',
  tagline: 'A confident supplier profile with a stable loading experience.',
  description_long:
    'This representative description is long enough to render the final About card at a useful commercial reading length.',
  category: 'Entertainment',
  location: 'Greater London',
  heroPreset: 'midnight',
  highlights: [
    'Experienced event professional',
    'Live and hybrid events',
    'Clear planning support',
    'Responsive communication',
    'Trusted delivery',
  ],
  featuredServices: ['Conference MC', 'Awards Host', 'Corporate Event Host'],
  emailVerified: true,
  license: 'Licensed',
};

test('loading shell reserves the rendered supplier profile geometry', async ({ page }) => {
  let releaseResponses;
  const responseGate = new Promise(resolve => {
    releaseResponses = resolve;
  });

  await page.route(`**/supplier/${TEST_ID}*`, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: supplierHtml })
  );
  await page.route(`**/api/suppliers/${TEST_ID}`, async route => {
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(supplier),
    });
  });
  await page.route(`**/api/supplier-profile/${TEST_ID}/package-cards**`, async route => {
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.route(`**/api/public/suppliers/${TEST_ID}/avatar`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hasPhoto: false, initials: 'LP' }),
    })
  );
  await page.route('**/api/v1/auth/me', route =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/reviews**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reviews: [], total: 0, averageRating: 0 }),
    })
  );

  await page.setViewportSize({ width: 1720, height: 1000 });
  await page.goto(`/supplier/${TEST_ID}?id=${TEST_ID}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.locator('html')).not.toHaveAttribute('data-sp-theme-ready', 'true');
  await expect(page.locator('.supplier-packages-v2--loading')).toBeVisible();

  const loading = await page.evaluate(() => {
    const hero = document.querySelector('.hero-media').getBoundingClientRect();
    const pageGrid = getComputedStyle(document.querySelector('.sp-page-grid'));
    const aside = document.querySelector('.sp-page-aside').getBoundingClientRect();
    const aboutPlaceholder = getComputedStyle(
      document.getElementById('sp-section-about'),
      '::before'
    );
    const sidebarPlaceholder = getComputedStyle(
      document.getElementById('sp-sidebar-enquiry'),
      '::before'
    );
    const packageCard = document.querySelector('.supplier-packages-v2--loading');
    const packageMessage = packageCard.querySelector('.supplier-packages-v2__state');
    // Not `.footer` — eventflow-footer.js (loaded on this page for the
    // standardised rich footer) replaces that class with `ef-footer-premium`
    // once it enhances the element, so `role="contentinfo"` is the only
    // selector that identifies the footer in both its pre- and
    // post-enhancement states.
    const footer = document.querySelector('footer[role="contentinfo"]').getBoundingClientRect();

    const pwa = document.createElement('div');
    pwa.id = 'ef-pwa-install-banner';
    document.body.appendChild(pwa);
    document.body.classList.add('ef-pwa-banner-visible');

    return {
      heroHeight: hero.height,
      heroBackground: getComputedStyle(document.querySelector('.hero-media')).backgroundImage,
      columns: pageGrid.gridTemplateColumns.split(' ').filter(Boolean).length,
      asideWidth: aside.width,
      aboutHeight: Number.parseFloat(aboutPlaceholder.height),
      sidebarHeight: Number.parseFloat(sidebarPlaceholder.height),
      packageHeight: packageCard.getBoundingClientRect().height,
      packageMessageVisibility: getComputedStyle(packageMessage).visibility,
      actionPointerEvents: getComputedStyle(document.querySelector('.hero-actions')).pointerEvents,
      footerTop: footer.top,
      pwaDisplay: getComputedStyle(pwa).display,
      bodyPaddingBottom: Number.parseFloat(getComputedStyle(document.body).paddingBottom) || 0,
    };
  });

  expect(loading.heroHeight).toBeLessThanOrEqual(160);
  expect(loading.heroBackground).toContain('rgb(21, 40, 59)');
  expect(loading.columns).toBe(2);
  expect(loading.asideWidth).toBeGreaterThanOrEqual(280);
  expect(loading.aboutHeight).toBeGreaterThanOrEqual(90);
  expect(loading.sidebarHeight).toBeGreaterThanOrEqual(200);
  expect(loading.packageHeight).toBeGreaterThanOrEqual(280);
  expect(loading.packageMessageVisibility).toBe('hidden');
  expect(loading.actionPointerEvents).toBe('none');
  expect(loading.footerTop).toBeGreaterThan(1000);
  expect(loading.pwaDisplay).toBe('none');
  expect(loading.bodyPaddingBottom).toBe(0);

  releaseResponses();

  await expect(page.locator('html')).toHaveAttribute('data-sp-theme-ready', 'true');
  await expect(page.locator('#hero-title')).toHaveText(supplier.name);
  await expect(page.locator('.sp-highlights')).toBeVisible();

  const loaded = await page.evaluate(() => ({
    pageTopPadding: Number.parseFloat(
      getComputedStyle(document.querySelector('.sp-page')).paddingTop
    ),
    heroHeight: document.querySelector('.hero-media').getBoundingClientRect().height,
    pwaDisplay: getComputedStyle(document.getElementById('ef-pwa-install-banner')).display,
  }));

  expect(loaded.pageTopPadding).toBeLessThanOrEqual(18);
  expect(loaded.heroHeight).toBeLessThanOrEqual(160);
  expect(loaded.pwaDisplay).toBe('none');
});
