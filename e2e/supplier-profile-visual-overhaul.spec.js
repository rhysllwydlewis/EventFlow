import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const TEST_ID = 'theme-test';
const supplierHtml = fs.readFileSync(path.resolve(process.cwd(), 'public/supplier.html'), 'utf8');

function makeSupplier(overrides = {}) {
  return {
    id: TEST_ID,
    name: 'Alex Example',
    tagline: 'Conference host who brings the room to life.',
    description_long:
      'Alex helps events feel alive, connected and confidently led. The profile copy is intentionally long enough to exercise the polished reading layout on desktop and mobile.',
    category: 'Entertainment',
    location: 'Greater London',
    highlights: [
      '500+ five-star reviews',
      'Hundreds of corporate events hosted',
      'Audiences of up to 1,400',
    ],
    featuredServices: ['Conference MC', 'Awards Host', 'Corporate Event Host'],
    profilePhotoUrl: '/test-assets/supplier-avatar.svg',
    emailVerified: true,
    license: 'Licensed',
    avgResponseTime: 6,
    createdAt: '2022-01-01T00:00:00.000Z',
    bannerUrl: null,
    coverImage: null,
    themeColor: null,
    heroPreset: 'blush',
    ...overrides,
  };
}

async function mockSupplierProfile(page, supplier) {
  await page.route(`**/supplier/${TEST_ID}*`, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: supplierHtml })
  );

  await page.route(`**/api/suppliers/${TEST_ID}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(supplier) })
  );

  await page.route(`**/api/supplier-profile/${TEST_ID}/package-cards**`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'package-1',
            title: 'Signature hosting package',
            description: 'Planning support and confident event hosting from start to finish.',
            priceDisplay: 'From £750',
            imageUrl: '/test-assets/package.svg',
          },
        ],
      }),
    })
  );

  await page.route('**/api/v2/search/suppliers**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { results: [supplier] } }),
    })
  );

  await page.route(`**/api/public/suppliers/${TEST_ID}/avatar`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hasPhoto: true,
        avatarUrl: '/test-assets/supplier-avatar.svg',
        initials: 'AE',
      }),
    })
  );

  await page.route('**/test-assets/supplier-avatar.svg', route =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#f6bfd8"/><circle cx="60" cy="45" r="22" fill="#4b2034"/><path d="M24 112c4-27 18-40 36-40s32 13 36 40" fill="#4b2034"/></svg>',
    })
  );

  await page.route('**/test-assets/package.svg', route =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#f7d7e6"/><circle cx="200" cy="150" r="70" fill="#c2185b" opacity=".5"/></svg>',
    })
  );

  await page.route('**/api/reviews**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reviews: [], total: 0, averageRating: 0 }),
    })
  );
}

async function openProfile(page, supplier) {
  await mockSupplierProfile(page, supplier);
  await page.goto(`/supplier/${TEST_ID}?id=${TEST_ID}`);
  await expect(page.locator('#hero-title')).toHaveText(supplier.name);
  await expect(page.locator('html')).toHaveAttribute('data-sp-theme-ready', 'true');
  await expect(page.locator('#hero-avatar')).toHaveAttribute('data-avatar-status', 'loaded');
}

function luminance(hex) {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    .map(value => Number.parseInt(value, 16) / 255)
    .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

test.describe('Supplier profile visual overhaul', () => {
  test('uses the visible hero preset as the profile accent and preserves the preset hero', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openProfile(page, makeSupplier());

    const appearance = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const button = getComputedStyle(document.getElementById('btn-enquiry'));
      const hero = getComputedStyle(document.querySelector('.hero-media'));
      const highlights = getComputedStyle(document.querySelector('.sp-highlights'));
      return {
        source: document.documentElement.dataset.spThemeSource,
        heroMode: document.documentElement.dataset.spHeroMode,
        accent: root.getPropertyValue('--sp-profile-accent').trim(),
        strong: root.getPropertyValue('--sp-profile-accent-strong').trim(),
        buttonBackground: button.backgroundImage,
        heroBackground: hero.backgroundImage,
        highlightsBorder: highlights.borderTopColor,
      };
    });

    expect(appearance.source).toBe('heroPreset');
    expect(appearance.heroMode).toBe('preset');
    expect(appearance.accent).toBe('#c2185b');
    expect(appearance.strong).not.toBe('#075e56');
    expect(appearance.buttonBackground).not.toContain('rgb(11, 128, 115)');
    expect(appearance.heroBackground).toContain('rgb(194, 24, 91)');
    expect(appearance.highlightsBorder).not.toBe('rgb(169, 222, 213)');
    expect(contrastRatio(appearance.strong, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  test('places a larger supplier photograph beside the identity and polishes sidebar details', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openProfile(page, makeSupplier());

    const avatar = await page.locator('#hero-avatar').boundingBox();
    const title = await page.locator('#hero-title').boundingBox();
    expect(avatar).not.toBeNull();
    expect(title).not.toBeNull();
    expect(avatar.width).toBeGreaterThanOrEqual(108);
    expect(avatar.x + avatar.width).toBeLessThan(title.x + 8);
    expect(Math.abs(avatar.y + avatar.height / 2 - (title.y + title.height / 2))).toBeLessThan(55);

    await expect(page.locator('.sp-cta-card__note')).toHaveText(
      'Typically responds in around 6 hours.'
    );
    const detailIcons = page.locator('.sp-detail-row__icon svg');
    expect(await detailIcons.count()).toBeGreaterThanOrEqual(2);
  });

  test('makes an explicit theme colour authoritative without overriding an explicit hero preset', async ({
    page,
  }) => {
    const supplier = makeSupplier({ themeColor: '#ec4899', heroPreset: 'midnight' });
    await openProfile(page, supplier);

    const state = await page.evaluate(() => ({
      source: document.documentElement.dataset.spThemeSource,
      heroMode: document.documentElement.dataset.spHeroMode,
      accent: getComputedStyle(document.documentElement)
        .getPropertyValue('--sp-profile-accent')
        .trim(),
      heroBackground: getComputedStyle(document.querySelector('.hero-media')).backgroundImage,
    }));

    expect(state.source).toBe('themeColor');
    expect(state.accent).toBe('#ec4899');
    expect(state.heroMode).toBe('preset');
    expect(state.heroBackground).toContain('rgb(15, 52, 96)');
  });

  test('keeps the portrait beside the name and avoids horizontal overflow on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openProfile(page, makeSupplier());

    const layout = await page.evaluate(() => {
      const avatar = document.getElementById('hero-avatar').getBoundingClientRect();
      const title = document.getElementById('hero-title').getBoundingClientRect();
      return {
        avatarWidth: avatar.width,
        avatarRight: avatar.right,
        titleLeft: title.left,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(layout.avatarWidth).toBeGreaterThanOrEqual(72);
    expect(layout.avatarRight).toBeLessThanOrEqual(layout.titleLeft + 8);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    await expect(page.locator('#btn-enquiry')).toBeVisible();
  });
});
