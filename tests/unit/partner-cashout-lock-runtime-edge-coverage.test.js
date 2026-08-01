'use strict';

const request = require('supertest');
const EventEmitter = require('events');

const mockStrictStore = { findOne: jest.fn() };
const mockLocks = {
  acquire: jest.fn(),
  renew: jest.fn(),
  release: jest.fn(),
};
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.mock('../../services/partnerCashoutStrictStore', () => mockStrictStore);
jest.mock('../../services/partnerCashoutOperationLockService', () => mockLocks);
jest.mock('../../utils/logger', () => mockLogger);
jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'user_1', role: 'partner' };
    next();
  },
  roleRequired: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));

const runtime = require('../../services/partnerCashoutLockRuntime');

beforeEach(() => {
  jest.clearAllMocks();
  mockStrictStore.findOne.mockResolvedValue(null);
  mockLocks.acquire.mockResolvedValue(null);
  mockLocks.renew.mockResolvedValue(true);
  mockLocks.release.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

function mountLayers(prefix, layers, downstream) {
  const express = require('express');
  const router = express.Router();
  router.stack.push(...layers);
  if (downstream) downstream(router);
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
}

test('partner lock guard rejects a missing partner before acquiring a lock', async () => {
  const app = mountLayers('/partner', runtime._test.buildPartnerLockGuard());
  const response = await request(app).post('/partner/cashout-requests').send({});
  expect(response.status).toBe(403);
  expect(response.body.code).toBe('PARTNER_NOT_FOUND');
  expect(mockLocks.acquire).not.toHaveBeenCalled();
});

test('partner lock guard fails closed when authoritative lookup or acquisition throws', async () => {
  mockStrictStore.findOne.mockRejectedValueOnce(
    Object.assign(new Error('storage down'), { code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE' })
  );
  const app = mountLayers('/partner', runtime._test.buildPartnerLockGuard());
  const response = await request(app).post('/partner/cashout-requests').send({});
  expect(response.status).toBe(503);
  expect(response.body.code).toBe('PARTNER_CASHOUT_STORAGE_UNAVAILABLE');
});

test('admin lock guard passes through a missing request and fails closed on lock errors', async () => {
  const passApp = mountLayers('/admin', runtime._test.buildAdminLockGuard(), router => {
    router.patch('/:id', (_req, res) => res.json({ passed: true }));
  });
  await expect(request(passApp).patch('/admin/missing').send({})).resolves.toMatchObject({
    status: 200,
    body: { passed: true },
  });

  mockStrictStore.findOne.mockRejectedValueOnce(new Error('read failed'));
  const failApp = mountLayers('/admin', runtime._test.buildAdminLockGuard());
  const failed = await request(failApp).patch('/admin/cashout_1').send({});
  expect(failed.status).toBe(503);
  expect(failed.body.code).toBe('PARTNER_CASHOUT_LOCK_UNAVAILABLE');
});

test('admin lock guard returns busy when another request owns the lock', async () => {
  mockStrictStore.findOne.mockResolvedValueOnce({ id: 'cashout_1' });
  mockLocks.acquire.mockResolvedValueOnce(null);
  const app = mountLayers('/admin', runtime._test.buildAdminLockGuard());
  const response = await request(app).patch('/admin/cashout_1').send({});
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PARTNER_CASHOUT_OPERATION_BUSY');
});

test('lease renewal and release failures are logged without double releasing', async () => {
  jest.useFakeTimers();
  const response = new EventEmitter();
  mockLocks.renew.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('renew failed'));
  mockLocks.release.mockRejectedValueOnce(new Error('release failed'));
  const lock = { id: 'lock_1', ownerToken: 'owner_1', leaseMs: 5000 };

  const release = runtime._test.bindRelease(response, lock);
  await jest.advanceTimersByTimeAsync(1700);
  expect(mockLogger.error).toHaveBeenCalledWith(
    '[PARTNER-CASHOUT-OPS] Distributed cashout lock lease could not be renewed',
    { lockId: 'lock_1' }
  );
  await jest.advanceTimersByTimeAsync(1700);
  expect(mockLogger.error).toHaveBeenCalledWith(
    '[PARTNER-CASHOUT-OPS] Distributed cashout lock renewal failed',
    expect.objectContaining({ lockId: 'lock_1', error: 'renew failed' })
  );

  release();
  release();
  await Promise.resolve();
  await Promise.resolve();
  expect(mockLocks.release).toHaveBeenCalledTimes(1);
  expect(mockLogger.error).toHaveBeenCalledWith(
    '[PARTNER-CASHOUT-OPS] Failed to release distributed cashout lock',
    expect.objectContaining({ lockId: 'lock_1', error: 'release failed' })
  );
});

test('audit retention guard blocks physical deletion', async () => {
  const app = mountLayers('/admin', runtime._test.buildAuditRetentionGuard());
  const response = await request(app).delete('/admin/cashout_1');
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PARTNER_CASHOUT_AUDIT_RETENTION_REQUIRED');
});
