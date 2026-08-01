'use strict';

const crypto = require('crypto');
const strictStore = require('./partnerCashoutStrictStore');

const COLLECTION = 'partner_cashout_operation_locks';
const DEFAULT_TTL_MS = 30000;
const localLocks = new Map();

function lockId(scope) {
  return `partner-cashout:${String(scope || '').trim()}`;
}

function isExpired(lock, now = Date.now()) {
  const expiresAt =
    lock?.expiresAt instanceof Date ? lock.expiresAt.getTime() : Date.parse(lock?.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function storageUnavailableError(message) {
  const error = new Error(message || 'Authoritative cashout lock storage is unavailable.');
  error.code = 'PARTNER_CASHOUT_LOCK_STORAGE_UNAVAILABLE';
  return error;
}

async function ensureLockReady() {
  try {
    const context = await strictStore.ensureAuthoritative();
    return context.backend;
  } catch (error) {
    throw storageUnavailableError(error.message);
  }
}

async function removeExpired(id, now = Date.now(), backend = null) {
  const activeBackend = backend || (await ensureLockReady());
  if (activeBackend !== 'mongodb') {
    const existing = localLocks.get(id);
    if (!existing || !isExpired(existing, now)) return false;
    const current = localLocks.get(id);
    if (!current || current.ownerToken !== existing.ownerToken) return false;
    localLocks.delete(id);
    return true;
  }

  const existing = await strictStore.findOne(COLLECTION, { id });
  if (!existing || !isExpired(existing, now)) return false;

  // Owner-token scoping prevents an ABA race where another process replaces an
  // expired lock between our read and delete and the stale caller deletes the new lock.
  return Boolean(
    await strictStore.deleteOne(COLLECTION, {
      id,
      ownerToken: existing.ownerToken,
    })
  );
}

function buildLock(scope, ttlMs) {
  const id = lockId(scope);
  const safeTtl = Math.max(5000, Math.min(Number(ttlMs) || DEFAULT_TTL_MS, 300000));
  const ownerToken = crypto.randomUUID();
  const now = new Date();
  return {
    id,
    scope: String(scope),
    ownerToken,
    acquiredAt: now,
    expiresAt: new Date(now.getTime() + safeTtl),
    leaseMs: safeTtl,
  };
}

async function acquire(scope, ttlMs = DEFAULT_TTL_MS) {
  if (!String(scope || '').trim()) throw new Error('Cashout operation lock scope is required');
  const backend = await ensureLockReady();
  const lock = buildLock(scope, ttlMs);
  await removeExpired(lock.id, Date.now(), backend);

  if (backend !== 'mongodb') {
    const existing = localLocks.get(lock.id);
    if (existing && !isExpired(existing)) return null;
    localLocks.set(lock.id, lock);
    return lock;
  }

  try {
    await strictStore.insertOne(COLLECTION, lock);
    return lock;
  } catch (error) {
    if (!strictStore.isDuplicateKey(error)) {
      throw storageUnavailableError(
        `Cashout operation lock could not be persisted: ${error.message}`
      );
    }

    // A duplicate is only a normal busy result while a genuine live competing
    // owner can be read from the authoritative store.
    const competing = await strictStore.findOne(COLLECTION, { id: lock.id });
    if (competing && !isExpired(competing)) return null;
    throw storageUnavailableError(
      'Cashout operation lock collided but no live competing owner could be verified.'
    );
  }
}

async function renew(lock, ttlMs = lock?.leaseMs || DEFAULT_TTL_MS) {
  if (!lock?.id || !lock?.ownerToken) return false;
  const backend = await ensureLockReady();
  const safeTtl = Math.max(5000, Math.min(Number(ttlMs) || DEFAULT_TTL_MS, 300000));
  const expiresAt = new Date(Date.now() + safeTtl);

  if (backend !== 'mongodb') {
    const existing = localLocks.get(lock.id);
    if (!existing || existing.ownerToken !== lock.ownerToken) return false;
    existing.expiresAt = expiresAt;
    existing.leaseMs = safeTtl;
    return true;
  }

  return Boolean(
    await strictStore.updateOne(
      COLLECTION,
      { id: lock.id, ownerToken: lock.ownerToken },
      { $set: { expiresAt, renewedAt: new Date() } }
    )
  );
}

async function release(lock) {
  if (!lock?.id || !lock?.ownerToken) return false;
  const backend = await ensureLockReady();

  if (backend !== 'mongodb') {
    const existing = localLocks.get(lock.id);
    if (!existing || existing.ownerToken !== lock.ownerToken) return false;
    localLocks.delete(lock.id);
    return true;
  }

  return Boolean(
    await strictStore.deleteOne(COLLECTION, {
      id: lock.id,
      ownerToken: lock.ownerToken,
    })
  );
}

function resetLocalLocksForTests() {
  localLocks.clear();
}

module.exports = {
  COLLECTION,
  DEFAULT_TTL_MS,
  acquire,
  renew,
  release,
  _test: {
    lockId,
    isExpired,
    removeExpired,
    buildLock,
    ensureLockReady,
    resetLocalLocksForTests,
  },
};
