from pathlib import Path


def wrap_commonjs_module(path_string):
    path = Path(path_string)
    text = path.read_text()
    marker = "'use strict';\n\n"
    assert marker in text, f'use strict marker missing in {path_string}'
    if marker + '(() => {\n' not in text:
        text = text.replace(marker, marker + '(() => {\n', 1)
    if not text.rstrip().endswith('})();'):
        text = text.rstrip() + '\n\n})();\n'
    path.write_text(text)


runtime_path = Path('services/partnerCashoutOperationsRuntime.js')
runtime = runtime_path.read_text()
decision_anchor = """        const decision = await ops.submissionDecision({
          partnerId: partner.id,
          denominationGbp: Number(req.body?.denominationGbp),
        });"""
replay_guard = """        const idempotencyKey = String(
          req.get('Idempotency-Key') || req.body?.idempotencyKey || ''
        ).trim();
        if (/^[A-Za-z0-9:_-]{8,120}$/.test(idempotencyKey)) {
          const existing = await strictStore.findOne('partner_cashout_requests', {
            partnerId: partner.id,
            idempotencyKey,
          });
          if (existing) return next();
        }

        const decision = await ops.submissionDecision({
          partnerId: partner.id,
          denominationGbp: Number(req.body?.denominationGbp),
        });"""
assert decision_anchor in runtime, 'submission decision anchor missing'
runtime = runtime.replace(decision_anchor, replay_guard, 1)

empty_catch = '.catch(() => {});'
empty_count = runtime.count(empty_catch)
assert empty_count == 4, f'expected 4 empty notification catches, found {empty_count}'
runtime = runtime.replace(
    empty_catch,
    ".catch(error => {\n"
    "          logger.warn('[PARTNER-CASHOUT-OPS] Non-blocking administrator notification failed', {\n"
    "            error: error.message,\n"
    "          });\n"
    "        });",
)
runtime_path.write_text(runtime)
wrap_commonjs_module(runtime_path)
wrap_commonjs_module('services/partnerCashoutOperationsService.js')

middleware_path = Path('middleware/partnerReferralCampaignCapture.js')
middleware = middleware_path.read_text()
index_block = """partnerCashoutOperationsIndexes.ensureIndexes().catch(error => {
  logger.warn('[PARTNER-CASHOUT-OPS] Cashout operations indexes are not ready yet', {
    error: error.message,
  });
});"""
guarded_index_block = """dbUnified
  .initializeDatabase()
  .then(backend => {
    if (backend !== 'mongodb') return null;
    return partnerCashoutOperationsIndexes.ensureIndexes();
  })
  .catch(error => {
    logger.warn('[PARTNER-CASHOUT-OPS] Cashout operations indexes are not ready yet', {
      error: error.message,
    });
  });"""
assert index_block in middleware, 'cashout index startup anchor missing'
middleware = middleware.replace(index_block, guarded_index_block, 1)
middleware_path.write_text(middleware)

lock_path = Path('services/partnerCashoutOperationLockService.js')
lock_service = lock_path.read_text()
stale_delete = """      await strictStore.deleteOne(COLLECTION, {
        id,
        ownerToken: existing.ownerToken,
      })"""
guarded_delete = """      await strictStore.deleteOne(COLLECTION, {
        id,
        ownerToken: existing.ownerToken,
        expiresAt: existing.expiresAt,
      })"""
assert stale_delete in lock_service, 'expired lock delete anchor missing'
lock_service = lock_service.replace(stale_delete, guarded_delete, 1)
lock_path.write_text(lock_service)

runtime_test_path = Path('tests/unit/partner-cashout-operations-runtime.test.js')
runtime_test = runtime_test_path.read_text()
runtime_test_addition = r"""

test('idempotent submission replay bypasses changed cashout limits and reaches the legacy replay handler', async () => {
  mockStrictStore.findOne.mockImplementation(async (collection, query) => {
    if (collection === 'partners' && query.userId === 'user_1') return partnerRecord;
    if (
      collection === 'partner_cashout_requests' &&
      query.partnerId === 'partner_1' &&
      query.idempotencyKey === 'replay-key-123'
    ) {
      return cashoutRequest;
    }
    return null;
  });
  mockOps.submissionDecision.mockResolvedValueOnce({
    allowed: false,
    reason: 'PARTNER_CASHOUT_OPEN_REQUEST_LIMIT',
  });

  const response = await request(partnerApp())
    .post('/api/partner/cashout-requests')
    .set('Idempotency-Key', 'replay-key-123')
    .send({ denominationGbp: 50 });

  expect(response.status).toBe(201);
  expect(mockLegacyPartnerPost).toHaveBeenCalledTimes(1);
  expect(mockOps.submissionDecision).not.toHaveBeenCalled();
});
"""
assert 'idempotent submission replay bypasses changed cashout limits' not in runtime_test
runtime_test_path.write_text(runtime_test.rstrip() + runtime_test_addition + '\n')

startup_test_path = Path('tests/unit/partner-anti-abuse-startup.test.js')
startup_test = startup_test_path.read_text()
startup_test = startup_test.replace(
    "const mockCashoutIndexEnsure = jest.fn(async () => true);",
    "const mockCashoutIndexEnsure = jest.fn(async () => true);\n"
    "const mockInitializeDatabase = jest.fn(async () => 'mongodb');",
    1,
)
startup_test = startup_test.replace(
    "jest.mock('../../db-unified', () => ({ updateOne: jest.fn(async () => ({ modified: 1 })) }));",
    "jest.mock('../../db-unified', () => ({\n"
    "  initializeDatabase: mockInitializeDatabase,\n"
    "  updateOne: jest.fn(async () => ({ modified: 1 })),\n"
    "}));",
    1,
)
first_test_old = """test('the route mounting path installs cashout policy before lock insertion so runtime order becomes lock then policy then legacy handler', () => {
  jest.isolateModules(() => {
    require('../../middleware/partnerReferralCampaignCapture');
  });
  expect(mockInstall).toHaveBeenCalledTimes(1);"""
first_test_new = """beforeEach(() => {
  jest.clearAllMocks();
  mockInitializeDatabase.mockResolvedValue('mongodb');
});

test('the route mounting path installs cashout policy before lock insertion so runtime order becomes lock then policy then legacy handler', async () => {
  jest.isolateModules(() => {
    require('../../middleware/partnerReferralCampaignCapture');
  });
  await Promise.resolve();
  expect(mockInstall).toHaveBeenCalledTimes(1);"""
assert first_test_old in startup_test, 'startup ordering test anchor missing'
startup_test = startup_test.replace(first_test_old, first_test_new, 1)
startup_test_addition = r"""

test('local database mode skips Mongo-only cashout index initialisation', async () => {
  mockInitializeDatabase.mockResolvedValueOnce('local');
  jest.isolateModules(() => {
    require('../../middleware/partnerReferralCampaignCapture');
  });
  await Promise.resolve();

  expect(mockInitializeDatabase).toHaveBeenCalledTimes(1);
  expect(mockCashoutIndexEnsure).not.toHaveBeenCalled();
});
"""
insertion_anchor = "\ntest('the production index routine installs distinct named integrity indexes'"
assert insertion_anchor in startup_test, 'startup index test insertion anchor missing'
startup_test = startup_test.replace(insertion_anchor, startup_test_addition + insertion_anchor, 1)
startup_test_path.write_text(startup_test)

lock_test_path = Path('tests/unit/partner-cashout-operation-lock.test.js')
lock_test = lock_test_path.read_text()
expectation_old = """  expect(mockStrictStore.deleteOne).toHaveBeenCalledWith(service.COLLECTION, {
    id,
    ownerToken: 'expired-owner',
  });"""
expectation_new = """  expect(mockStrictStore.deleteOne).toHaveBeenCalledWith(service.COLLECTION, {
    id,
    ownerToken: 'expired-owner',
    expiresAt: expired.expiresAt,
  });"""
assert expectation_old in lock_test, 'lock expectation anchor missing'
lock_test = lock_test.replace(expectation_old, expectation_new, 1)
lock_test_addition = r"""

test('expired cleanup cannot delete a same-owner lease renewed after the expiry read', async () => {
  const id = 'partner-cashout:partner:partner_1';
  const expired = {
    id,
    scope: 'partner:partner_1',
    ownerToken: 'same-owner',
    expiresAt: new Date(Date.now() - 1000),
  };
  const renewed = {
    ...expired,
    expiresAt: new Date(Date.now() + 60000),
  };
  locks.push(expired);
  mockStrictStore.deleteOne.mockImplementationOnce(async (_collection, query) => {
    locks[0] = renewed;
    const index = locks.findIndex(item => matches(item, query));
    if (index < 0) return false;
    locks.splice(index, 1);
    return true;
  });

  await expect(service._test.removeExpired(id, Date.now(), 'mongodb')).resolves.toBe(false);
  expect(locks).toEqual([renewed]);
});
"""
lock_insert_anchor = "\ntest('an ordinary expired Mongo lock is removed before a new owner is admitted'"
assert lock_insert_anchor in lock_test, 'lock test insertion anchor missing'
lock_test = lock_test.replace(lock_insert_anchor, lock_test_addition + lock_insert_anchor, 1)
lock_test_path.write_text(lock_test)
