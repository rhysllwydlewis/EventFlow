import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The Photos page (/gallery) in a real browser against a scripted API: the picker, choosing and
 * uploading photos (a real multipart request, with the CSRF token), deleting through the native
 * dialog, the viewer's keyboard, a phone layout that does not scroll sideways, and accessibility.
 */
const IMAGES = [
  '/assets/images/hero-venue.jpg',
  '/assets/images/collage-photography.webp',
  '/assets/images/collage-catering.jpg',
];
// A real 1x1 PNG, so the browser accepts it as an image.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function openGallery(page, context, baseURL, { photos, onUpload, onDelete, search } = {}) {
  let current = photos || IMAGES.map((url, i) => ({ id: `photo_${i}`, url, thumbnail: url }));
  const calls = [];
  await context.addCookies([
    { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    { name: 'test_auth', value: 'owner', url: baseURL },
  ]);
  await page.route(
    url => !url.href.startsWith(baseURL),
    route => route.abort()
  );
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    calls.push({ method, pathname, headers: request.headers(), body: request.postData() });
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.includes('csrf')) {
      return json({ csrfToken: 'test-token' });
    }
    if (pathname === '/api/v1/auth/me') {
      return json({ user: { id: 'u1', role: 'supplier', email: 'a@b.test' } });
    }
    if (pathname === '/api/me/suppliers') {
      return json({ items: [{ id: 's1', name: 'Romeo Venues' }] });
    }
    if (pathname === '/api/me/packages') {
      return json({ items: [{ id: 'p1', name: 'Wedding day' }] });
    }
    if (pathname === '/api/v2/subscriptions/me') {
      return json({ limits: { maxPhotos: 10 } });
    }
    if (pathname === '/api/photos/upload/batch') {
      current = [...current, { id: 'photo_new', url: IMAGES[0], thumbnail: IMAGES[0] }];
      return onUpload ? onUpload(route) : json({ success: true, uploaded: 1 });
    }
    if (/\/photos(\/[^/]+)?$/.test(pathname) && method === 'DELETE') {
      current = current.slice(0, -1);
      return onDelete ? onDelete(route) : json({ success: true });
    }
    if (/\/photos$/.test(pathname) && method === 'GET') {
      return json({ success: true, photos: current });
    }
    return json({}, 404);
  });
  await page.goto(`/gallery.html${search || '?type=supplier&id=s1'}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('#gallery-grid:not([hidden]), #gallery-empty:not([hidden])').first().waitFor();
  return calls;
}

test.describe('Photos page', () => {
  test('shows the gallery, the picker and how much of the plan is used', async ({
    page,
    context,
    baseURL,
  }) => {
    await openGallery(page, context, baseURL);
    await expect(page.getByRole('heading', { name: 'Photos', level: 1 })).toBeVisible();
    await expect(page.locator('#gallery-grid .gallery-tile')).toHaveCount(3);
    await expect(page.locator('#gallery-target-meta')).toHaveText(
      '3 of 10 photos used on your plan'
    );
    await expect(page.locator('#gallery-target')).toHaveValue('supplier:s1');
    await expect(page.locator('#gallery-upload')).toBeHidden();
  });

  test('switching to a package loads that package and updates the address', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openGallery(page, context, baseURL);
    await page.selectOption('#gallery-target', 'package:p1');
    await expect(page).toHaveURL(/type=package&id=p1/);
    await expect
      .poll(() => calls.some(c => c.pathname === '/api/me/packages/p1/photos'))
      .toBe(true);
  });

  test('uploads chosen photos as a real multipart request with the CSRF token', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openGallery(page, context, baseURL);
    await page.setInputFiles('#gallery-file-input', [
      { name: 'one.png', mimeType: 'image/png', buffer: PNG },
      { name: 'two.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await expect(page.locator('#gallery-staged .gallery-staged__item')).toHaveCount(2);
    await expect(page.locator('#gallery-upload')).toHaveText('Upload 2 photos');

    await page.locator('#gallery-upload').click();
    await expect(page.locator('#gallery-upload-status')).toHaveText('1 photo added.');
    await expect(page.locator('#gallery-staged')).toBeHidden();
    await expect(page.locator('#gallery-grid .gallery-tile')).toHaveCount(4);

    const upload = calls.find(c => c.pathname === '/api/photos/upload/batch');
    expect(upload.method).toBe('POST');
    expect(upload.headers['x-csrf-token']).toBe('test-token');
    expect(upload.headers['content-type']).toMatch(/^multipart\/form-data/);
    expect(upload.body).toContain('name="photos"');
    expect(upload.body).toContain('filename="one.png"');
    expect(upload.body).toContain('filename="two.png"');
  });

  test('a file that is not a photo is refused with its name', async ({
    page,
    context,
    baseURL,
  }) => {
    await openGallery(page, context, baseURL);
    await page.setInputFiles('#gallery-file-input', [
      { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') },
    ]);
    await expect(page.locator('#gallery-upload-status')).toContainText(
      'notes.pdf is not a JPEG, PNG, WebP or GIF image.'
    );
    await expect(page.locator('#gallery-staged')).toBeHidden();
  });

  test('delete asks in a dialog; Escape keeps the photo; confirming removes it', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openGallery(page, context, baseURL);
    const deleteButton = page.getByRole('button', { name: 'Delete photo 3' });
    await deleteButton.click();
    const dialog = page.locator('#gallery-delete-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Photo 3 will be removed from Romeo Venues');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(0);

    await deleteButton.click();
    await page.locator('#gallery-delete-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#gallery-photos-status')).toHaveText('Photo deleted.');
    await expect(page.locator('#gallery-grid .gallery-tile')).toHaveCount(2);
    const del = calls.find(c => c.method === 'DELETE');
    expect(del.pathname).toBe('/api/me/suppliers/s1/photos/photo_2');
    expect(del.headers['x-csrf-token']).toBe('test-token');
  });

  test('a refused delete keeps the dialog open and says why', async ({
    page,
    context,
    baseURL,
  }) => {
    await openGallery(page, context, baseURL, {
      onDelete: route =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Your profile has to be approved first' }),
        }),
    });
    await page.getByRole('button', { name: 'Delete photo 1' }).click();
    await page.locator('#gallery-delete-confirm').click();
    await expect(page.locator('#gallery-delete-error')).toHaveText(
      'Your profile has to be approved first'
    );
    await expect(page.locator('#gallery-delete-dialog')).toBeVisible();
  });

  test('the viewer opens on the photo, the arrow keys move through, and Escape closes it', async ({
    page,
    context,
    baseURL,
  }) => {
    await openGallery(page, context, baseURL);
    const open = page.getByRole('button', { name: 'View photo 2 of 3' });
    await open.click();
    const viewer = page.locator('#gallery-lightbox');
    await expect(viewer).toBeVisible();
    await expect(page.locator('#gallery-lightbox-count')).toHaveText('Photo 2 of 3');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#gallery-lightbox-count')).toHaveText('Photo 3 of 3');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#gallery-lightbox-count')).toHaveText('Photo 1 of 3');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#gallery-lightbox-count')).toHaveText('Photo 3 of 3');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(open).toBeFocused();
  });

  test('an empty gallery says so, and a phone layout does not scroll sideways', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGallery(page, context, baseURL, { photos: [] });
    await expect(page.locator('#gallery-empty-title')).toHaveText('No photos yet');
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflows).toBe(false);
  });

  test('a phone shows the photos two to a row without the label wrapping', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGallery(page, context, baseURL);
    const tiles = await page
      .locator('#gallery-grid .gallery-tile')
      .evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
    expect(tiles[0]).toBe(tiles[1]);
    expect(tiles[2]).toBeGreaterThan(tiles[0]);
    const label = await page.locator('.gallery-tile__label').first().boundingBox();
    expect(label.height).toBeLessThan(24);
  });
});

test.describe('Photos page: accessibility', () => {
  const audit = async (page, selector) => {
    const result = await new AxeBuilder({ page })
      .include(selector)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'])
      .analyze();
    return result.violations.map(
      v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`
    );
  };

  for (const [label, size] of [
    ['desktop', { width: 1280, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ]) {
    test(`no axe violations on a ${label}`, async ({ page, context, baseURL }) => {
      await page.setViewportSize(size);
      await openGallery(page, context, baseURL);
      await page.setInputFiles('#gallery-file-input', [
        { name: 'one.png', mimeType: 'image/png', buffer: PNG },
      ]);
      await expect(page.locator('#gallery-staged .gallery-staged__item')).toHaveCount(1);
      expect(await audit(page, 'main')).toEqual([]);
    });
  }

  test('no axe violations in the delete dialog or the viewer', async ({
    page,
    context,
    baseURL,
  }) => {
    await openGallery(page, context, baseURL);
    await page.getByRole('button', { name: 'Delete photo 1' }).click();
    expect(await audit(page, '#gallery-delete-dialog')).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'View photo 1 of 3' }).click();
    expect(await audit(page, '#gallery-lightbox')).toEqual([]);
  });
});
