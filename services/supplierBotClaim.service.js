'use strict';

const crypto = require('crypto');
const { canonicalWebsite } = require('./supplierBotIngestion.service');
const { configuredGraceDays } = require('./supplierBotPackageGrace.service');

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeWebsite(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return canonicalWebsite(candidate);
  } catch (_error) {
    return '';
  }
}

function claimIdFor(supplierId, userId) {
  const digest = crypto
    .createHash('sha256')
    .update(`${String(supplierId)}:${String(userId)}`)
    .digest('hex')
    .slice(0, 24);
  return `clm_bot_${digest}`;
}

function isUnclaimedBotSupplier(supplier) {
  return Boolean(
    supplier &&
      supplier.ownershipStatus === 'unclaimed' &&
      supplier.acquisition?.source === 'supplier_bot'
  );
}

function collisionSignals(user, supplier) {
  const signals = [];
  const userEmail = normalizeEmail(user?.email);
  const supplierEmail = normalizeEmail(supplier?.email);
  if (userEmail && supplierEmail && userEmail === supplierEmail) signals.push('public_email_exact');

  const userWebsite = normalizeWebsite(user?.website);
  const supplierWebsite = normalizeWebsite(supplier?.website);
  if (userWebsite && supplierWebsite && userWebsite === supplierWebsite) signals.push('website_exact');
  return signals;
}

async function findSupplierBotCollision({ dbUnified, user }) {
  if (!dbUnified || !user) return null;

  // Prefer the targeted/indexable path in production and in lean service
  // adapters. Fall back to read() only for legacy database implementations.
  let suppliers;
  if (typeof dbUnified.find === 'function') {
    suppliers = await dbUnified.find('suppliers', { ownershipStatus: 'unclaimed' });
  } else if (typeof dbUnified.read === 'function') {
    suppliers = await dbUnified.read('suppliers');
  } else {
    return null;
  }
  if (!Array.isArray(suppliers)) return null;

  for (const supplier of suppliers) {
    if (!isUnclaimedBotSupplier(supplier)) continue;
    const signals = collisionSignals(user, supplier);
    if (signals.length > 0) return { supplier, signals };
  }
  return null;
}

async function createSupplierBotClaimRequest({
  dbUnified,
  supplier,
  user,
  signals = [],
  source = 'manual_claim',
}) {
  if (!dbUnified) throw new Error('Database unavailable');
  if (!isUnclaimedBotSupplier(supplier)) {
    const error = new Error('Supplier is not an unclaimed Supplier Bot profile');
    error.code = 'SUPPLIER_BOT_NOT_CLAIMABLE';
    throw error;
  }
  if (!user?.id || user.role !== 'supplier') {
    const error = new Error('A supplier account is required to request this claim');
    error.code = 'SUPPLIER_BOT_CLAIM_ACCOUNT_REQUIRED';
    throw error;
  }

  const id = claimIdFor(supplier.id, user.id);
  const existing = await dbUnified.findOne('supplierClaims', { id });
  if (existing) return { claim: existing, created: false, idempotent: true };

  const now = new Date().toISOString();
  const claim = {
    id,
    supplierId: supplier.id,
    candidateId: supplier.acquisition?.candidateId || null,
    requesterUserId: user.id,
    requesterEmail: normalizeEmail(user.email),
    status: user.verified === true ? 'pending_proof' : 'pending_email_verification',
    source,
    signals: Array.isArray(signals) ? signals.slice(0, 10) : [],
    packageGraceDaysOnApproval: configuredGraceDays(),
    requestedAt: now,
    updatedAt: now,
    resolvedAt: null,
  };

  try {
    const inserted = await dbUnified.insertOne('supplierClaims', claim);
    if (inserted) return { claim: inserted, created: true, idempotent: false };
  } catch (error) {
    if (!(error && error.code === 11000)) throw error;
  }

  const afterRace = await dbUnified.findOne('supplierClaims', { id });
  if (afterRace) return { claim: afterRace, created: false, idempotent: true };
  throw new Error('Failed to persist Supplier Bot claim request');
}

module.exports = {
  claimIdFor,
  collisionSignals,
  createSupplierBotClaimRequest,
  findSupplierBotCollision,
  isUnclaimedBotSupplier,
  normalizeWebsite,
};
