import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  postWithCsrf,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

test.describe('Supplier verification lifecycle against the real backend @backend', () => {
  test.describe.configure({ mode: 'serial' });

  const runId = createRunId('supplier-verification');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  test('protects supplier and admin verification endpoints', async ({ request }) => {
    const supplierStatus = await request.get('/api/supplier/verification/status');
    expect(supplierStatus.status()).toBe(401);

    const pendingQueue = await request.get('/api/admin/suppliers/pending-verification');
    expect(pendingQueue.status()).toBe(401);
  });

  test('runs unverified through changes requested, resubmission and approval', async ({
    page,
    context,
  }) => {
    await loginAs(page, fixtures.users.pendingSupplier);

    const initialResponse = await page.request.get('/api/supplier/verification/status');
    expect(initialResponse.ok()).toBe(true);
    await expect(initialResponse.json()).resolves.toMatchObject({
      verificationStatus: 'unverified',
      verified: false,
    });

    const firstSubmission = await postWithCsrf(page, '/api/supplier/verification/submit');
    expect(firstSubmission.ok()).toBe(true);
    const firstSubmissionBody = await firstSubmission.json();
    expect(firstSubmissionBody.verificationStatus).toBe('pending_review');

    const duplicateSubmission = await postWithCsrf(page, '/api/supplier/verification/submit');
    expect(duplicateSubmission.status()).toBe(409);

    await context.clearCookies();
    await loginAs(page, fixtures.users.admin);

    const pendingResponse = await page.request.get('/api/admin/suppliers/pending-verification');
    expect(pendingResponse.ok()).toBe(true);
    const pendingBody = await pendingResponse.json();
    expect(pendingBody.suppliers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixtures.pendingSupplier.id,
          verificationStatus: 'pending_review',
        }),
      ])
    );

    const missingReason = await postWithCsrf(
      page,
      `/api/admin/suppliers/${encodeURIComponent(fixtures.pendingSupplier.id)}/request-changes`
    );
    expect(missingReason.status()).toBe(400);

    const reason = `Please improve the profile evidence for ${runId}.`;
    const changesResponse = await postWithCsrf(
      page,
      `/api/admin/suppliers/${encodeURIComponent(fixtures.pendingSupplier.id)}/request-changes`,
      { reason }
    );
    expect(changesResponse.ok()).toBe(true);
    await expect(changesResponse.json()).resolves.toMatchObject({
      ok: true,
      supplier: expect.objectContaining({
        verificationStatus: 'needs_changes',
        verified: false,
        verificationNotes: reason,
      }),
    });

    await context.clearCookies();
    await loginAs(page, fixtures.users.pendingSupplier);

    const changesStatus = await page.request.get('/api/supplier/verification/status');
    expect(changesStatus.ok()).toBe(true);
    await expect(changesStatus.json()).resolves.toMatchObject({
      verificationStatus: 'needs_changes',
      verified: false,
      verificationNotes: reason,
    });

    const resubmission = await postWithCsrf(page, '/api/supplier/verification/submit');
    expect(resubmission.ok()).toBe(true);
    await expect(resubmission.json()).resolves.toMatchObject({
      verificationStatus: 'pending_review',
    });

    await context.clearCookies();
    await loginAs(page, fixtures.users.admin);

    const approval = await postWithCsrf(
      page,
      `/api/admin/suppliers/${encodeURIComponent(fixtures.pendingSupplier.id)}/approve`,
      { notes: `Approved by backend E2E ${runId}` }
    );
    expect(approval.ok()).toBe(true);
    await expect(approval.json()).resolves.toMatchObject({
      supplier: expect.objectContaining({
        id: fixtures.pendingSupplier.id,
        approved: true,
        verified: true,
        verificationStatus: 'approved',
      }),
    });

    await context.clearCookies();
    await loginAs(page, fixtures.users.pendingSupplier);

    const approvedStatus = await page.request.get('/api/supplier/verification/status');
    expect(approvedStatus.ok()).toBe(true);
    await expect(approvedStatus.json()).resolves.toMatchObject({
      verificationStatus: 'approved',
      verified: true,
    });

    const legacyProfile = await page.request.get(
      `/supplier?id=${encodeURIComponent(fixtures.pendingSupplier.id)}`,
      { maxRedirects: 0 }
    );
    expect(legacyProfile.status()).toBe(301);
    expect(legacyProfile.headers().location).toMatch(/^\/supplier\//);
  });
});
