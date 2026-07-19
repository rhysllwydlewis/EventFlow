import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

test.describe('Supplier reviews against the real backend @backend', () => {
  const runId = createRunId('supplier-reviews');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  test('returns approved reviews only from the public supplier review endpoint', async ({
    request,
  }) => {
    const response = await request.get(
      `/api/suppliers/${encodeURIComponent(fixtures.supplier.id)}/reviews?sortBy=date`
    );
    expect(response.ok()).toBe(true);
    const body = await response.json();

    expect(body.pagination).toMatchObject({ total: 1, page: 1 });
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({
      id: fixtures.reviews.approvedId,
      title: 'Excellent and reliable',
      rating: 5,
      approved: true,
      verified: true,
    });
    expect(JSON.stringify(body)).not.toContain('Pending moderation fixture');
  });

  test('keeps the enhanced review API consistent with the public approval boundary', async ({
    request,
  }) => {
    const response = await request.get(
      `/api/reviews/supplier/${encodeURIComponent(fixtures.supplier.id)}`
    );
    expect(response.ok()).toBe(true);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data.pagination.total).toBe(1);
    expect(body.data.analytics).toMatchObject({
      avgRating: 5,
      totalReviews: 1,
      ratingDistribution: [0, 0, 0, 0, 1],
    });
    expect(body.data.reviews[0]).toMatchObject({
      _id: fixtures.reviews.approvedId,
      title: 'Excellent and reliable',
      moderation: expect.objectContaining({ state: 'approved' }),
    });
    expect(JSON.stringify(body)).not.toContain(fixtures.reviews.pendingId);
  });

  test('renders the approved review on the clean supplier profile and hides pending content', async ({
    page,
  }) => {
    await page.goto(fixtures.supplier.path);
    await expect(page.locator('#hero-title')).toHaveText(fixtures.supplier.name);
    await expect(page.locator('#reviews-widget')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#btn-write-review')).toBeVisible();
    await expect(page.locator('#reviews-list')).toContainText('Excellent and reliable', {
      timeout: 15_000,
    });
    await expect(page.locator('#reviews-list')).toContainText(
      `A genuinely excellent service for ${runId}.`
    );
    await expect(page.locator('#reviews-list')).not.toContainText('Pending moderation fixture');
    await expect(page.locator('.review-average-rating')).toHaveText('5.0');
  });

  test('supports deterministic rating and helpful sorting without network-idle waits', async ({
    page,
  }) => {
    await page.goto(fixtures.supplier.path);
    await expect(page.locator('#reviews-list')).toContainText('Excellent and reliable', {
      timeout: 15_000,
    });

    await page.locator('#filter-sort-by').selectOption('rating');
    await expect(page.locator('#reviews-list')).toContainText('Excellent and reliable');
    await page.locator('#filter-sort-by').selectOption('helpful');
    await expect(page.locator('#reviews-list')).toContainText('Excellent and reliable');
  });
});
