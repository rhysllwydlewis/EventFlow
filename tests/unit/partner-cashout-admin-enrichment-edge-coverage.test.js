'use strict';

const request = require('supertest');
const mockStrictStore = {
  read: jest.fn(async () => []),
};
const mockOps = {
  getConfig: jest.fn(() => ({ identityReviewMaxAgeDays: 365 })),
};
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.mock('../../services/partnerCashoutStrictStore', () => mockStrictStore);
jest.mock('../../services/partnerCashoutOperationsService', () => mockOps);
jest.mock('../../utils/logger', () => mockLogger);

const runtime = require('../../services/partnerCashoutAdminEnrichmentRuntime');

beforeEach(() => {
  jest.clearAllMocks();
  mockStrictStore.read.mockResolvedValue([]);
  mockOps.getConfig.mockReturnValue({ identityReviewMaxAgeDays: 365 });
});

test.each([
  [null, null, 'PARTNER_CASHOUT_IDENTITY_MISSING'],
  [{ id: 'p', status: 'inactive' }, { verified: true }, 'PARTNER_CASHOUT_PARTNER_NOT_ACTIVE'],
  [
    {
      id: 'p',
      status: 'active',
      cashoutIdentityStatus: 'verified',
      cashoutIdentityVerifiedAt: new Date().toISOString(),
    },
    { verified: false },
    'PARTNER_CASHOUT_EMAIL_UNVERIFIED',
  ],
  [
    { id: 'p', status: 'active', cashoutIdentityStatus: 'rejected' },
    { verified: true },
    'PARTNER_CASHOUT_IDENTITY_REJECTED',
  ],
  [
    { id: 'p', status: 'active', cashoutIdentityStatus: 'pending' },
    { verified: true },
    'PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED',
  ],
])('identity summary exposes the expected ineligible reason', (partner, user, reason) => {
  expect(runtime._test.identitySummary(partner, user)).toMatchObject({
    eligibleSnapshot: false,
    reason,
  });
});

test('response enrichment handles item lists, detail responses and pass-through bodies', () => {
  const partner = {
    id: 'partner_1',
    userId: 'user_1',
    status: 'active',
    cashoutIdentityStatus: 'verified',
    cashoutIdentityVerifiedAt: new Date().toISOString(),
    cashoutIdentityEmailSnapshot: 'partner@example.com',
  };
  const user = { id: 'user_1', email: 'partner@example.com', verified: true };
  const maps = {
    partnersById: new Map([[partner.id, partner]]),
    usersById: new Map([[user.id, user]]),
    config: { identityReviewMaxAgeDays: 365 },
  };
  const originalJson = jest.fn(body => body);
  const res = { statusCode: 200, json: originalJson };
  runtime._test.wrapJsonWithEnrichment(res, maps);

  res.json({ items: [{ id: 'cashout_1', partnerId: partner.id }] });
  expect(originalJson).toHaveBeenLastCalledWith(
    expect.objectContaining({
      items: [expect.objectContaining({ cashoutIdentitySummary: expect.any(Object) })],
    })
  );

  res.json({ request: { id: 'cashout_2', partnerId: partner.id } });
  expect(originalJson).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({ reconciliationSummary: expect.any(Object) }),
    })
  );

  res.statusCode = 500;
  res.json({ items: [{ id: 'unchanged' }] });
  expect(originalJson).toHaveBeenLastCalledWith({ items: [{ id: 'unchanged' }] });
  res.statusCode = 200;
  res.json(null);
  expect(originalJson).toHaveBeenLastCalledWith(null);
});

test('the read guard loads authoritative maps and enriches a successful response', async () => {
  const express = require('express');
  mockStrictStore.read
    .mockResolvedValueOnce([
      {
        id: 'partner_1',
        userId: 'user_1',
        status: 'active',
        cashoutIdentityStatus: 'verified',
        cashoutIdentityVerifiedAt: new Date().toISOString(),
      },
    ])
    .mockResolvedValueOnce([{ id: 'user_1', email: 'partner@example.com', verified: true }]);

  const router = express.Router();
  router.stack.push(...runtime._test.buildReadEnrichmentGuard());
  router.get('/', (_req, res) =>
    res.json({ items: [{ id: 'cashout_1', partnerId: 'partner_1', partnerUserId: 'user_1' }] })
  );
  const app = express();
  app.use('/cashouts', router);

  const response = await request(app).get('/cashouts');
  expect(response.status).toBe(200);
  expect(response.body.items[0].cashoutIdentitySummary.eligibleSnapshot).toBe(true);
  expect(mockStrictStore.read).toHaveBeenNthCalledWith(1, 'partners');
  expect(mockStrictStore.read).toHaveBeenNthCalledWith(2, 'users');
});

test('route insertion rejects a router without a supported read route and inserts before a valid route', () => {
  const express = require('express');
  const invalid = express.Router();
  invalid.post('/', (_req, res) => res.sendStatus(204));
  expect(() => runtime._test.insertBeforeFirstCashoutRead(invalid, [])).toThrow(
    'Admin cashout read routes were not found'
  );

  const valid = express.Router();
  valid.get('/:id', (_req, res) => res.json({ ok: true }));
  const marker = { name: 'marker' };
  runtime._test.insertBeforeFirstCashoutRead(valid, [marker]);
  expect(valid.stack[0]).toBe(marker);
});

test('enrichCashout preserves null and non-object values', () => {
  expect(runtime._test.enrichCashout(null, new Map(), new Map(), {})).toBeNull();
  expect(runtime._test.enrichCashout('cashout', new Map(), new Map(), {})).toBe('cashout');
});
