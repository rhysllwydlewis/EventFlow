import { test, expect } from '@playwright/test';

/**
 * The Photos field of the supplier's Edit profile is for the photos shown in the gallery on their
 * public profile. The image at the top of the profile is the banner, so the gallery has no "cover"
 * photo of its own: no badge, no highlighted first tile, no promise in the help text. Photos can
 * still be dragged into the order they appear in.
 */
const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const gallery = ['a', 'b', 'c'].map(id => ({
  id: `photo_${id}`,
  url: pixel,
  thumbnail: pixel,
  large: pixel,
}));

async function openEditor(page, context, baseURL) {
  await context.addCookies([
    { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    { name: 'test_auth', value: 'owner', url: baseURL },
  ]);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.route(
    url => !url.href.startsWith(baseURL) && !url.href.startsWith('data:'),
    route => route.abort()
  );
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    const json = body =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.includes('csrf')) {
      return json({ csrfToken: 'test' });
    }
    if (pathname === '/api/v1/auth/me') {
      return json({ user: { id: 'u1', role: 'supplier', email: 'a@b.test', name: 'Test' } });
    }
    if (pathname.endsWith('/suppliers/s1')) {
      return json({ id: 's1', name: 'Test Venue', photosGallery: gallery });
    }
    return json({});
  });
  await page.goto('/dashboard-supplier.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.loadSupplierGalleryPhotos === 'function');
  await page.evaluate(() => window.loadSupplierGalleryPhotos('s1'));
  await expect(page.locator('#sup-photo-preview .photo-preview-item--existing')).toHaveCount(3);
  await page.evaluate(() => {
    const dialog = document.getElementById('sdh-profile-dialog');
    dialog.showModal();
    document.getElementById('sup-photo-drop').scrollIntoView();
  });
}

test.describe('Supplier Edit profile: Photos', () => {
  test('no photo is marked as a cover photo', async ({ page, context, baseURL }) => {
    await openEditor(page, context, baseURL);
    await expect(page.locator('#sup-photo-preview .photo-first-badge')).toHaveCount(0);
    await expect(page.locator('#sup-photo-preview .photo-preview-item--cover')).toHaveCount(0);
    await expect(page.locator('.sdh-field:has(#sup-photo-drop)')).not.toContainText(/cover/i);
  });

  test('the help text says where the photos show and that they can be reordered', async ({
    page,
    context,
    baseURL,
  }) => {
    await openEditor(page, context, baseURL);
    const help = page.locator(
      '#sup-photo-drop ~ .sdh-help, .sdh-field:has(#sup-photo-drop) .sdh-help'
    );
    await expect(help.first()).toContainText('gallery on your public profile');
    await expect(help.first()).toContainText('Drag to reorder');
  });

  test('photos are still draggable, and a banner is still offered', async ({
    page,
    context,
    baseURL,
  }) => {
    await openEditor(page, context, baseURL);
    await expect(page.locator('#sup-photo-preview .photo-drag-handle')).toHaveCount(3);
    await expect(page.locator('#sdh-banner-upload')).toBeAttached();
  });
});
