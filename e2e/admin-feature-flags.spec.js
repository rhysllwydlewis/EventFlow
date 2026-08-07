import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  putWithCsrf,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

const FLAG_KEYS = [
  'registration',
  'supplierApplications',
  'reviews',
  'photoUploads',
  'supportTickets',
  'pexelsCollage',
  'requirePackageApproval',
  'requirePublicCalendarApproval',
  'marketplaceAvailability',
  'quoteBooking',
  'bookingPayments',
];

function writableFlags(flags) {
  return Object.fromEntries(FLAG_KEYS.map(key => [key, flags[key] === true]));
}

test.describe('Admin feature flags against the real backend @backend', () => {
  test.describe.configure({ mode: 'serial' });

  const runId = createRunId('feature-flags');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  test('requires an authenticated administrator', async ({ request }) => {
    const response = await request.get('/api/admin/settings/features');
    expect(response.status()).toBe(401);
  });

  test('rejects attempts to disable locked core features', async ({ page }) => {
    await loginAs(page, fixtures.users.admin);

    const originalResponse = await page.request.get('/api/admin/settings/features');
    expect(originalResponse.ok()).toBe(true);
    const original = await originalResponse.json();
    const baseline = writableFlags(original);

    const registrationOff = await putWithCsrf(page, '/api/admin/settings/features', {
      ...baseline,
      registration: false,
      supplierApplications: false,
    });
    expect(registrationOff.status()).toBe(400);
    await expect(registrationOff.json()).resolves.toMatchObject({
      code: 'CORE_FEATURE_LOCKED_ON',
      fields: ['registration', 'supplierApplications'],
    });

    const persisted = await page.request.get('/api/admin/settings/features');
    expect(persisted.ok()).toBe(true);
    await expect(persisted.json()).resolves.toMatchObject({
      registration: true,
      supplierApplications: true,
    });
  });

  test('renders the current server state in the admin settings UI', async ({ page }) => {
    await loginAs(page, fixtures.users.admin);
    const flagsResponse = await page.request.get('/api/admin/settings/features');
    const flags = await flagsResponse.json();

    await page.goto('/admin-settings');
    await expect(page.locator('#featureRegistration')).toBeDisabled();
    await expect(page.locator('#featureSupplierApply')).toBeDisabled();
    await expect(page.locator('#featureRegistration')).toBeChecked();
    await expect(page.locator('#featureSupplierApply')).toBeChecked();
    expect(flags.registration).toBe(true);
    expect(flags.supplierApplications).toBe(true);
    await expect(page.locator('#saveFeatureFlags')).toBeDisabled();
  });
});
