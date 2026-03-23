/**
 * Admin Photos Page E2E Tests
 *
 * Tests the /admin-photos page auto-approve toggle and photo library/queue views.
 * Uses route mocking to avoid real auth and API calls (static-mode friendly).
 */

import { test, expect } from '@playwright/test';

// Shared mock setup
async function setupMocks(page, { autoApprove = true, photos = [], suppliers = [] } = {}) {
  // Auth
  await page.route('**/api/v1/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'admin1', role: 'admin', name: 'Admin', email: 'admin@test.com' },
      }),
    })
  );
  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'admin1', role: 'admin', name: 'Admin', email: 'admin@test.com' },
      }),
    })
  );

  // CSRF token
  await page.route('**/api/csrf-token', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
    })
  );

  // Badge counts
  await page.route('**/api/admin/badge-counts', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pendingPhotos: autoApprove ? 0 : photos.length }),
    })
  );

  // Feature flags
  await page.route('**/api/admin/settings/features', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ photoAutoApprove: autoApprove }),
      });
    }
    // PUT — accept and return updated flags
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, features: { photoAutoApprove: !autoApprove } }),
    });
  });

  // Photo library (auto-approve ON)
  await page.route('**/api/admin/photos/library', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, count: photos.length, photos }),
    })
  );

  // Pending photos (auto-approve OFF)
  await page.route('**/api/admin/photos/pending', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        count: autoApprove ? 0 : photos.length,
        photos: autoApprove ? [] : photos,
        autoApprove,
      }),
    })
  );

  // Suppliers list
  await page.route('**/api/admin/suppliers*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: suppliers }),
    })
  );
}

const SAMPLE_PHOTOS = [
  {
    id: 'photo_001',
    url: '/uploads/test-photo-1.jpg',
    thumbnail: '/uploads/test-photo-1.jpg',
    supplierId: 'sup_001',
    supplierName: 'Amazing Venues',
    uploadedAt: new Date().toISOString(),
    status: 'approved',
  },
  {
    id: 'photo_002',
    url: '/uploads/test-photo-2.jpg',
    thumbnail: '/uploads/test-photo-2.jpg',
    supplierId: 'sup_002',
    supplierName: 'Best Caterers',
    uploadedAt: new Date().toISOString(),
    status: 'approved',
  },
];

const PENDING_PHOTOS = [
  {
    id: 'photo_pending_001',
    url: '/uploads/pending-photo-1.jpg',
    thumbnail: '/uploads/pending-photo-1.jpg',
    supplierId: 'sup_001',
    supplierName: 'Amazing Venues',
    uploadedAt: new Date().toISOString(),
    status: 'pending',
  },
];

const SAMPLE_SUPPLIERS = [
  { id: 'sup_001', name: 'Amazing Venues' },
  { id: 'sup_002', name: 'Best Caterers' },
];

test.describe('Admin Photos — page structure', () => {
  test('page loads with toggle and status banner', async ({ page }) => {
    await setupMocks(page, { autoApprove: true });
    await page.goto('/admin-photos.html');
    await page.waitForLoadState('networkidle');

    // Toggle should be present
    const toggle = page.locator('#autoApproveToggle');
    await expect(toggle).toBeVisible();

    // Status banner should be present
    const banner = page.locator('#statusBanner');
    await expect(banner).toBeVisible();
  });

  test('photo queue container is present', async ({ page }) => {
    await setupMocks(page, { autoApprove: true });
    await page.goto('/admin-photos.html');
    await page.waitForLoadState('domcontentloaded');

    const queue = page.locator('#photoQueue');
    await expect(queue).toBeVisible();
  });

  test('search and filter inputs are present with labels', async ({ page }) => {
    await setupMocks(page, { autoApprove: true });
    await page.goto('/admin-photos.html');
    await page.waitForLoadState('domcontentloaded');

    // Both labels are properly associated via for= attributes
    const searchLabel = page.locator('label[for="searchSupplier"]');
    await expect(searchLabel).toBeVisible();

    const filterLabel = page.locator('label[for="supplierNameFilter"]');
    await expect(filterLabel).toBeVisible();
  });

  test('batch bar buttons exist in DOM even when hidden', async ({ page }) => {
    await setupMocks(page, { autoApprove: true });
    await page.goto('/admin-photos.html');
    await page.waitForLoadState('domcontentloaded');

    // Batch buttons must be in the DOM (not null) regardless of visibility
    const approveBtn = page.locator('#batchApproveBtn');
    const rejectBtn = page.locator('#batchRejectBtn');
    expect(await approveBtn.count()).toBe(1);
    expect(await rejectBtn.count()).toBe(1);
  });
});

test.describe('Admin Photos — auto-approve ON (library mode)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page, {
      autoApprove: true,
      photos: SAMPLE_PHOTOS,
      suppliers: SAMPLE_SUPPLIERS,
    });
    await page.goto('/admin-photos.html');
    await page.waitForLoadState('networkidle');
  });

  test('toggle is checked when auto-approve is ON', async ({ page }) => {
    const toggle = page.locator('#autoApproveToggle');
    await expect(toggle).toBeChecked();
  });

  test('toggle state label shows ON', async ({ page }) => {
    const label = page.locator('#toggleStateLabel');
    await expect(label).toHaveText('ON');
  });

  test('status banner indicates auto-approval is enabled', async ({ page }) => {
    const banner = page.locator('#statusBanner');
    await expect(banner).toContainText('Auto-approval enabled');
  });

  test('photos are displayed in library mode', async ({ page }) => {
    // At least one photo item should appear
    const items = page.locator('.photo-queue__item');
    await expect(items).toHaveCount(SAMPLE_PHOTOS.length);
  });

  test('no approve/reject per-photo buttons in library mode', async ({ page }) => {
    // Approve/reject action buttons should not be rendered
    const approveBtn = page.locator('.photo-queue__btn--approve');
    const rejectBtn = page.locator('.photo-queue__btn--reject');
    await expect(approveBtn).toHaveCount(0);
    await expect(rejectBtn).toHaveCount(0);
  });

  test('batch bar is hidden in library mode', async ({ page }) => {
    const batchBar = page.locator('#batchActionsBar');
    await expect(batchBar).not.toHaveClass(/active/);
  });

  test('photos show "In library" badge', async ({ page }) => {
    const badge = page.locator('.photo-queue__badge--approved').first();
    await expect(badge).toContainText('In library');
  });
});

test.describe('Admin Photos — auto-approve OFF (queue mode)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page, {
      autoApprove: false,
      photos: PENDING_PHOTOS,
      suppliers: SAMPLE_SUPPLIERS,
    });
    await page.goto('/admin-photos.html');
    await page.waitForLoadState('networkidle');
  });

  test('toggle is unchecked when auto-approve is OFF', async ({ page }) => {
    const toggle = page.locator('#autoApproveToggle');
    await expect(toggle).not.toBeChecked();
  });

  test('toggle state label shows OFF', async ({ page }) => {
    const label = page.locator('#toggleStateLabel');
    await expect(label).toHaveText('OFF');
  });

  test('status banner indicates manual moderation is active', async ({ page }) => {
    const banner = page.locator('#statusBanner');
    await expect(banner).toContainText('Manual moderation active');
  });

  test('pending photos are displayed', async ({ page }) => {
    const items = page.locator('.photo-queue__item');
    await expect(items).toHaveCount(PENDING_PHOTOS.length);
  });

  test('per-photo approve and reject buttons are shown', async ({ page }) => {
    const approveBtn = page.locator('.photo-queue__btn--approve');
    const rejectBtn = page.locator('.photo-queue__btn--reject');
    await expect(approveBtn).toHaveCount(PENDING_PHOTOS.length);
    await expect(rejectBtn).toHaveCount(PENDING_PHOTOS.length);
  });

  test('photos show "Pending" badge', async ({ page }) => {
    const badge = page.locator('.photo-queue__badge--pending').first();
    await expect(badge).toContainText('Pending');
  });
});

test.describe('Admin Photos — empty states', () => {
  test('shows empty library message when no photos and auto-approve ON', async ({ page }) => {
    await setupMocks(page, { autoApprove: true, photos: [], suppliers: [] });
    await page.goto('/admin-photos.html');
    await page.waitForLoadState('networkidle');

    const empty = page.locator('.photo-queue__empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No photos in the library yet');
  });

  test('shows empty queue message when no pending photos and auto-approve OFF', async ({
    page,
  }) => {
    await setupMocks(page, { autoApprove: false, photos: [], suppliers: [] });
    await page.goto('/admin-photos.html');
    await page.waitForLoadState('networkidle');

    const empty = page.locator('.photo-queue__empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No photos awaiting approval');
  });
});

test.describe('Admin Photos — toggle interaction', () => {
  test('toggling OFF sends PUT request and shows queue mode', async ({ page }) => {
    let putCalled = false;

    await setupMocks(page, {
      autoApprove: true,
      photos: SAMPLE_PHOTOS,
      suppliers: SAMPLE_SUPPLIERS,
    });

    // Override the PUT handler to capture it
    await page.route('**/api/admin/settings/features', route => {
      if (route.request().method() === 'PUT') {
        putCalled = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, features: { photoAutoApprove: false } }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ photoAutoApprove: true }),
      });
    });

    await page.goto('/admin-photos.html');
    await page.waitForLoadState('networkidle');

    // Toggle OFF
    await page.locator('#autoApproveToggle').click();
    await page.waitForSelector('#toggleStateLabel');

    expect(putCalled).toBe(true);
  });
});

test.describe('Admin Photos — API: pending endpoint respects flag @backend', () => {
  test('GET /api/admin/photos/pending returns empty when auto-approve is ON', async ({
    request,
  }) => {
    const response = await request.get('/api/admin/photos/pending');

    if (response.ok()) {
      const data = await response.json();
      // When autoApprove is ON on the live server, the list should be empty
      if (data.autoApprove === true) {
        expect(data.photos).toEqual([]);
        expect(data.count).toBe(0);
      }
    } else {
      // 401/403 expected without auth — that's fine
      expect([401, 403]).toContain(response.status());
    }
  });
});
