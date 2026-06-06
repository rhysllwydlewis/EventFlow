import { expect, test } from '@playwright/test';

test.describe('Package routing smoke', () => {
  test('clean package routes and stats endpoint respond without generic 404s', async ({
    request,
  }) => {
    const packageRoute = await request.get('/package/garden-party-package');
    expect(packageRoute.status()).toBe(200);
    await expect(packageRoute.text()).resolves.toContain('Package Details');

    const querySlugRoute = await request.get('/package?slug=garden-party-package');
    expect(querySlugRoute.status()).toBe(200);

    const queryIdRoute = await request.get('/package?id=mock-pkg-1');
    expect(queryIdRoute.status()).toBe(200);

    const unknownRoute = await request.get('/package/definitely-not-a-real-package');
    expect(unknownRoute.status()).toBe(200);
    const unknownHtml = await unknownRoute.text();
    expect(unknownHtml).toContain('Package not found');
    expect(unknownHtml).toContain('Browse suppliers');

    const packageApi = await request.get('/api/packages/garden-party-package');
    expect(packageApi.status()).toBe(200);
    const packageBody = await packageApi.json();
    expect(packageBody.package.title).toBeTruthy();
    expect(packageBody.supplier.name).toBeTruthy();

    const statsApi = await request.get('/api/v1/public/stats');
    expect(statsApi.status()).toBe(200);
    const stats = await statsApi.json();
    expect(stats.suppliersVerified).toBeGreaterThan(0);
    expect(stats.packagesApproved).toBeGreaterThan(0);
  });
});
