'use strict';

(() => {
  const logger = require('../utils/logger');

  let ensurePromise = null;

  async function createIndexes(db) {
    const controls = db.collection('partner_programme_controls');
    await controls.createIndex({ id: 1 }, { name: 'uniq_partner_programme_control', unique: true });

    const events = db.collection('partner_cashout_ops_events');
    await events.createIndex({ id: 1 }, { name: 'uniq_partner_cashout_ops_event', unique: true });
    await events.createIndex(
      { requestId: 1, createdAt: -1 },
      {
        name: 'partner_cashout_ops_request_time',
        partialFilterExpression: { requestId: { $type: 'string' } },
      }
    );
    await events.createIndex(
      { partnerId: 1, createdAt: -1 },
      {
        name: 'partner_cashout_ops_partner_time',
        partialFilterExpression: { partnerId: { $type: 'string' } },
      }
    );
    await events.createIndex(
      { action: 1, createdAt: -1 },
      { name: 'partner_cashout_ops_action_time' }
    );

    const requests = db.collection('partner_cashout_requests');
    await requests.createIndex(
      { partnerId: 1, status: 1, createdAt: -1 },
      { name: 'partner_cashout_policy_window' }
    );
    await requests.createIndex(
      { reconciliationStatus: 1, reconciledAt: -1 },
      {
        name: 'partner_cashout_reconciliation_status',
        partialFilterExpression: { reconciliationStatus: { $type: 'string' } },
      }
    );
    // Re-ensure the existing PR1/PR2 idempotency invariant inside the PR3 strict-store
    // bootstrap so money-out safety does not depend on a separate index initializer running first.
    await requests.createIndex(
      { idempotencyKey: 1, partnerId: 1 },
      {
        name: 'uniq_partner_cashout_idempotency',
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      }
    );

    const transactions = db.collection('partner_credit_transactions');
    // This is the same existing ledger invariant used by the broader partner anti-abuse
    // index routine: for a given transaction type an external reference is globally unique.
    // Cashout hold, release and final redeem retries therefore cannot create a second ledger row.
    await transactions.createIndex(
      { type: 1, externalRef: 1 },
      {
        name: 'uniq_partner_ledger_external_ref',
        unique: true,
        partialFilterExpression: { externalRef: { $type: 'string' } },
      }
    );

    const partners = db.collection('partners');
    await partners.createIndex(
      { cashoutIdentityStatus: 1, cashoutIdentityVerifiedAt: -1 },
      {
        name: 'partner_cashout_identity_review',
        partialFilterExpression: { cashoutIdentityStatus: { $type: 'string' } },
      }
    );

    const locks = db.collection('partner_cashout_operation_locks');
    await locks.createIndex(
      { id: 1 },
      { name: 'uniq_partner_cashout_operation_lock', unique: true }
    );
    await locks.createIndex(
      { expiresAt: 1 },
      { name: 'partner_cashout_operation_lock_ttl', expireAfterSeconds: 0 }
    );
  }

  function ensureIndexes() {
    if (ensurePromise) return ensurePromise;
    ensurePromise = (async () => {
      const { getDb } = require('../db');
      const db = await getDb();
      await createIndexes(db);
      logger.info('[PARTNER-CASHOUT-OPS] Cashout operations indexes ensured');
      return true;
    })().catch(error => {
      ensurePromise = null;
      logger.warn('[PARTNER-CASHOUT-OPS] Cashout operations index initialization failed', {
        error: error.message,
      });
      throw error;
    });
    return ensurePromise;
  }

  function resetForTests() {
    ensurePromise = null;
  }

  module.exports = { ensureIndexes, _test: { createIndexes, resetForTests } };
})();
