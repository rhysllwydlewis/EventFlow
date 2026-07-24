import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const TEST_ID = 'profile-photo-lightbox-test';
const supplierHtml = fs.readFileSync(path.resolve(process.cwd(), 'public/supplier.html'), 'utf8');

const supplier = {
  id: TEST_ID,
  name: 'Lightbox Example Supplier',
  tagline: 'A profile used to verify larger photo viewing.',
  description_long: 'Supplier profile lightbox browser fixture.',
  category: 'Photography',
  location: 'London',
  profilePhotoUrl: '/test-assets/lightbox-avatar.svg',
  bannerUrl: null,
  coverImage: null,
  themeMode: 'automatic',
  themeColor: null,
  heroPreset: null,
  approved: true,
};

async function mockProfile(page) {
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
      body: JSON.stringify({ items: [] }),
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
        avatarUrl: '/test-assets/lightbox-avatar.svg',
        initials: 'LE',
      }),
    })
  );
  await page.route('**/test-assets/lightbox-avatar.svg', route =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" fill="#dbeafe"/><circle cx="80" cy="60" r="30" fill="#1a3a5c"/><path d="M30 150c6-36 24-54 50-54s44 18 50 54" fill="#1a3a5c"/></svg>',
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

test('opens the supplier profile photo in an accessible larger view', async ({ page }) => {
  await mockProfile(page);
  await page.goto(`/supplier/${TEST_ID}?id=${TEST_ID}`, { waitUntil: 'domcontentloaded' });

  const avatar = page.locator('#hero-avatar');
  await expect(avatar).toHaveAttribute('data-avatar-status', 'loaded');
  await expect(avatar).toHaveAttribute('role', 'button');
  await expect(avatar).toHaveAttribute('tabindex', '0');
  await expect(avatar).toHaveAttribute(
    'aria-label',
    'View larger profile photo for Lightbox Example Supplier'
  );

  await avatar.click();
  const lightbox = page.locator('.sp-avatar-lightbox');
  await expect(lightbox).toBeVisible();
  await expect(lightbox).toHaveAttribute('role', 'dialog');
  await expect(lightbox).toHaveAttribute('aria-modal', 'true');
  await expect(lightbox.locator('img')).toHaveAttribute('src', '/test-assets/lightbox-avatar.svg');
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await expect(avatar).toBeFocused();

  await avatar.press('Enter');
  await expect(page.locator('.sp-avatar-lightbox')).toBeVisible();
  await page.locator('.sp-avatar-lightbox__close').click();
  await expect(page.locator('.sp-avatar-lightbox')).toHaveCount(0);
  await expect(avatar).toBeFocused();
});
