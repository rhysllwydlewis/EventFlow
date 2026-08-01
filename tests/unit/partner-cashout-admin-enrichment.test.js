'use strict';

const mockStrictStore = {
  read: jest.fn(async () => []),
};
const mockOps = {
  getConfig: jest.fn(() => ({ identityReviewMaxAgeDays: 365 })),
};

jest.mock('../../services/partnerCashoutStrictStore', () => mockStrictStore);
jest.mock('../../services/partnerCashoutOperationsService', () => mockOps);
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const runtime = require('../../services/partnerCashoutAdminEnrichmentRuntime');

test('identity summary makes reviewed identity drift visible to administrators', () => {
  const summary = runtime._test.identitySummary(
    {
      id: 'partner_1',
      status: 'active',
      cashoutIdentityStatus: 'verified',
      cashoutIdentityVerifiedAt: '2026-07-01T12:00:00.000Z',
      cashoutIdentityReviewedAt: '2026-07-01T12:00:00.000Z',
      cashoutIdentityReviewedBy: 'admin_1',
      cashoutIdentityEmailSnapshot: 'reviewed@example.com',
      cashoutIdentityCompanySnapshot: 'Example Events Ltd',
    },
    {
      id: 'user_1',
      email: 'changed@example.com',
      company: 'Example Events Ltd',
      verified: true,
    },
    { identityReviewMaxAgeDays: 365 },
    Date.parse('2026-07-28T12:00:00.000Z')
  );

  expect(summary).toMatchObject({
    status: 'verified',
    eligibleSnapshot: false,
    reason: 'PARTNER_CASHOUT_IDENTITY_CHANGED',
    emailMatches: false,
    companyMatches: true,
    expired: false,
  });
});

test('identity summary marks an otherwise matching review as expired after the configured age', () => {
  const summary = runtime._test.identitySummary(
    {
      id: 'partner_1',
      status: 'active',
      cashoutIdentityStatus: 'verified',
      cashoutIdentityVerifiedAt: '2025-01-01T12:00:00.000Z',
      cashoutIdentityEmailSnapshot: 'partner@example.com',
    },
    { id: 'user_1', email: 'partner@example.com', verified: true },
    { identityReviewMaxAgeDays: 365 },
    Date.parse('2026-07-28T12:00:00.000Z')
  );

  expect(summary).toMatchObject({
    eligibleSnapshot: false,
    expired: true,
    reason: 'PARTNER_CASHOUT_IDENTITY_REVIEW_EXPIRED',
  });
});

test('reconciliation summary exposes persisted issue codes without raw ledger data', () => {
  const summary = runtime._test.reconciliationSummary({
    reconciliationStatus: 'failed',
    reconciledAt: '2026-07-02T10:00:00.000Z',
    reconciledBy: 'admin_1',
    reconciliationRecoveryState: 'none',
    reconciliationIssues: [
      { code: 'CASHOUT_HOLD_AMOUNT_MISMATCH', evidence: { expected: 5000, actual: 10000 } },
    ],
  });

  expect(summary).toEqual({
    status: 'failed',
    reconciledAt: '2026-07-02T10:00:00.000Z',
    reconciledBy: 'admin_1',
    recoveryState: 'none',
    issueCodes: ['CASHOUT_HOLD_AMOUNT_MISMATCH'],
  });
});

test('cashout enrichment keeps existing response fields and adds safety summaries', () => {
  const partners = new Map([
    [
      'partner_1',
      {
        id: 'partner_1',
        userId: 'user_1',
        status: 'active',
        cashoutIdentityStatus: 'verified',
        cashoutIdentityVerifiedAt: '2026-07-01T12:00:00.000Z',
        cashoutIdentityEmailSnapshot: 'partner@example.com',
      },
    ],
  ]);
  const users = new Map([
    ['user_1', { id: 'user_1', email: 'partner@example.com', verified: true }],
  ]);

  const enriched = runtime._test.enrichCashout(
    {
      id: 'cashout_1',
      partnerId: 'partner_1',
      partnerUserId: 'user_1',
      status: 'submitted',
      denominationGbp: 50,
    },
    partners,
    users,
    { identityReviewMaxAgeDays: 365 }
  );

  expect(enriched).toMatchObject({
    id: 'cashout_1',
    denominationGbp: 50,
    cashoutIdentitySummary: { status: 'verified', eligibleSnapshot: true },
    reconciliationSummary: { status: 'not_run', issueCodes: [] },
  });
});

test('read enrichment fails closed before serving incomplete safety state', async () => {
  const express = require('express');
  const request = require('supertest');
  mockStrictStore.read.mockRejectedValueOnce(
    Object.assign(new Error('storage unavailable'), { code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE' })
  );

  const guardRouter = express.Router();
  guardRouter.stack.push(...runtime._test.buildReadEnrichmentGuard());
  guardRouter.get('/', (_req, res) => res.json({ items: [{ id: 'unsafe' }] }));
  const app = express();
  app.use('/cashouts', guardRouter);

  const response = await request(app).get('/cashouts');
  expect(response.status).toBe(503);
  expect(response.body.code).toBe('PARTNER_CASHOUT_STORAGE_UNAVAILABLE');
});
