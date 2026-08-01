'use strict';

const service = require('../../services/partnerCashoutOperationsIndexService');

function createCollectionMock() {
  return { createIndex: jest.fn(async () => 'ok') };
}

test('cashout operations index initializer creates control, audit, policy, ledger, identity and lock indexes', async () => {
  const collections = new Map();
  const db = {
    collection: jest.fn(name => {
      if (!collections.has(name)) collections.set(name, createCollectionMock());
      return collections.get(name);
    }),
  };

  await service._test.createIndexes(db);

  expect(db.collection).toHaveBeenCalledWith('partner_programme_controls');
  expect(db.collection).toHaveBeenCalledWith('partner_cashout_ops_events');
  expect(db.collection).toHaveBeenCalledWith('partner_cashout_requests');
  expect(db.collection).toHaveBeenCalledWith('partner_credit_transactions');
  expect(db.collection).toHaveBeenCalledWith('partners');
  expect(db.collection).toHaveBeenCalledWith('partner_cashout_operation_locks');

  expect(collections.get('partner_programme_controls').createIndex).toHaveBeenCalledWith(
    { id: 1 },
    { name: 'uniq_partner_programme_control', unique: true }
  );
  expect(collections.get('partner_cashout_ops_events').createIndex).toHaveBeenCalledWith(
    { id: 1 },
    { name: 'uniq_partner_cashout_ops_event', unique: true }
  );
  expect(collections.get('partner_cashout_requests').createIndex).toHaveBeenCalledWith(
    { partnerId: 1, status: 1, createdAt: -1 },
    { name: 'partner_cashout_policy_window' }
  );
  expect(collections.get('partner_cashout_requests').createIndex).toHaveBeenCalledWith(
    { idempotencyKey: 1, partnerId: 1 },
    expect.objectContaining({ name: 'uniq_partner_cashout_idempotency', unique: true })
  );
  expect(collections.get('partner_credit_transactions').createIndex).toHaveBeenCalledWith(
    { type: 1, externalRef: 1 },
    {
      name: 'uniq_partner_ledger_external_ref',
      unique: true,
      partialFilterExpression: { externalRef: { $type: 'string' } },
    }
  );
  expect(collections.get('partners').createIndex).toHaveBeenCalledWith(
    { cashoutIdentityStatus: 1, cashoutIdentityVerifiedAt: -1 },
    expect.objectContaining({ name: 'partner_cashout_identity_review' })
  );
  expect(collections.get('partner_cashout_operation_locks').createIndex).toHaveBeenCalledWith(
    { id: 1 },
    { name: 'uniq_partner_cashout_operation_lock', unique: true }
  );
  expect(collections.get('partner_cashout_operation_locks').createIndex).toHaveBeenCalledWith(
    { expiresAt: 1 },
    { name: 'partner_cashout_operation_lock_ttl', expireAfterSeconds: 0 }
  );
});
