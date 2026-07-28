'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

const COLLECTION = 'partner_reward_award_locks';

function numberEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getConfig() {
  return {
    leaseMs: numberEnv('PARTNER_REWARD_AWARD_LOCK_LEASE_MS', 15000, 2000, 60000),
    waitMs: numberEnv('PARTNER_REWARD_AWARD_LOCK_WAIT_MS', 3000, 250, 15000),
    retryMs: numberEnv('PARTNER_REWARD_AWARD_LOCK_RETRY_MS', 50, 10, 500),
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acquire(partnerId) {
  if (!partnerId) throw new Error('partnerId is required for reward award lock');
  const { getDb } = require('../db');
  const db = await getDb();
  const collection = db.collection(COLLECTION);
  const config = getConfig();
  const owner = crypto.randomBytes(16).toString('hex');
  const deadline = Date.now() + config.waitMs;

  while (Date.now() <= deadline) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.leaseMs);
    try {
      const result = await collection.findOneAndUpdate(
        {
          _id: partnerId,
          $or: [{ expiresAt: { $lte: now } }, { owner }],
        },
        {
          $set: { owner, expiresAt, acquiredAt: now },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true, returnDocument: 'after' }
      );
      const document = result?.value || result;
      if (document?.owner === owner) return { db, collection, partnerId, owner, expiresAt };
    } catch (error) {
      // A competing non-expired lock causes the upsert attempt to race the unique _id.
      // That is expected contention, not a database failure.
      if (error?.code !== 11000) throw error;
    }
    await sleep(config.retryMs);
  }

  const error = new Error('Partner reward issuance is busy; retry shortly');
  error.code = 'PARTNER_REWARD_AWARD_LOCK_TIMEOUT';
  throw error;
}

async function release(lock) {
  if (!lock?.collection || !lock.partnerId || !lock.owner) return;
  try {
    await lock.collection.deleteOne({ _id: lock.partnerId, owner: lock.owner });
  } catch (error) {
    logger.warn('[PARTNER-REWARD-INTEGRITY] Failed to release reward award lock', {
      partnerId: lock.partnerId,
      error: error.message,
    });
  }
}

async function withPartnerAwardLock(partnerId, operation) {
  const lock = await acquire(partnerId);
  try {
    return await operation();
  } finally {
    await release(lock);
  }
}

module.exports = {
  withPartnerAwardLock,
  _test: { acquire, release, getConfig, sleep, COLLECTION },
};
