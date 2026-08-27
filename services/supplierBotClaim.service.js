'use strict';

const mongo = require('../db');
const { canonicalWebsite } = require('./supplierBotIngestion.service');
const { configuredGraceDays } = require('./supplierBotPackageGrace.service');

let claimIndexesPromise = null;

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeWebsite(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return '';
  }
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return canonicalWebsite(candidate);
  } catch (_error) {
    return '';
  }
}

function claimIdFor(supplierId, userId) {
  const stablePair = `${String(supplierId)}:${String(userId)}`;
  return `clm_bot_${Buffer.from(stablePair, 'utf8').toString('base64url')}`;
}

function isUnclaimedBotSupplier(supplier) {
  return Boolean(
    supplier &&
    supplier.ownershipStatus === 'unclaimed' &&
    supplier.acquisition?.source === 'supplier_bot'
  );
}

// Free/consumer webmail domains are deliberately excluded from the email-domain
// collision signal below. A bot candidate's scraped `website` occasionally ends
// up pointing at a generic platform rather than the business's own domain (e.g.
// a malformed crawl), and matching those against a personal Gmail/Outlook/etc.
// address would let an unrelated signup collide with someone else's listing.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'mail.com',
  'yandex.com',
]);

function emailDomain(email) {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  return at === -1 ? '' : normalized.slice(at + 1);
}

function websiteHostname(value) {
  const normalized = normalizeWebsite(value);
  if (!normalized) {
    return '';
  }
  try {
    return new URL(normalized).hostname;
  } catch (_error) {
    return '';
  }
}

function collisionSignals(user, supplier) {
  const signals = [];
  const userEmail = normalizeEmail(user?.email);
  const supplierEmail = normalizeEmail(supplier?.email);
  if (userEmail && supplierEmail && userEmail === supplierEmail) {
    signals.push('public_email_exact');
  }

  const userWebsite = normalizeWebsite(user?.website);
  const supplierWebsite = normalizeWebsite(supplier?.website);
  if (userWebsite && supplierWebsite && userWebsite === supplierWebsite) {
    signals.push('website_exact');
  }

  // The signup form's website field is optional, so most real claims won't set
  // it. The far more common signal is a business owner simply signing up with
  // their work email — match that email's domain against the listing's own
  // website domain instead of requiring them to retype it.
  const userDomain = emailDomain(user?.email);
  const supplierHostname = websiteHostname(supplier?.website);
  if (
    userDomain &&
    supplierHostname &&
    !FREE_EMAIL_DOMAINS.has(userDomain) &&
    userDomain === supplierHostname
  ) {
    signals.push('email_domain_match');
  }

  return signals;
}

async function ensureSupplierBotClaimIndexes() {
  if (!mongo.isConnected()) {
    return;
  }
  if (!claimIndexesPromise) {
    claimIndexesPromise = (async () => {
      const collection = await mongo.getCollection('supplierClaims');
      await collection.createIndex({ id: 1 }, { unique: true, name: 'uniq_supplier_claim_id' });
      await collection.createIndex(
        { supplierId: 1, requesterUserId: 1 },
        { unique: true, name: 'uniq_supplier_claim_supplier_requester' }
      );
    })().catch(error => {
      claimIndexesPromise = null;
      throw error;
    });
  }
  await claimIndexesPromise;
}

async function findSupplierBotCollision({ dbUnified, user }) {
  if (!dbUnified || !user) {
    return null;
  }

  let suppliers;
  if (typeof dbUnified.find === 'function') {
    suppliers = await dbUnified.find('suppliers', { ownershipStatus: 'unclaimed' });
  } else if (typeof dbUnified.read === 'function') {
    suppliers = await dbUnified.read('suppliers');
  } else {
    return null;
  }
  if (!Array.isArray(suppliers)) {
    return null;
  }

  for (const supplier of suppliers) {
    if (!isUnclaimedBotSupplier(supplier)) {
      continue;
    }
    const signals = collisionSignals(user, supplier);
    if (signals.length > 0) {
      return { supplier, signals };
    }
  }
  return null;
}

async function advanceVerifiedClaim({ dbUnified, claim, user }) {
  if (!claim || user?.verified !== true || claim.status !== 'pending_email_verification') {
    return claim;
  }
  const now = new Date().toISOString();
  const updates = {
    status: 'pending_proof',
    emailVerifiedAt: now,
    updatedAt: now,
  };
  const updated = await dbUnified.updateOne('supplierClaims', { id: claim.id }, { $set: updates });
  if (!updated) {
    throw new Error('Failed to advance verified Supplier Bot claim request');
  }
  return { ...claim, ...updates };
}

async function createSupplierBotClaimRequest({
  dbUnified,
  supplier,
  user,
  signals = [],
  source = 'manual_claim',
}) {
  if (!dbUnified) {
    throw new Error('Database unavailable');
  }
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

  await ensureSupplierBotClaimIndexes();

  const id = claimIdFor(supplier.id, user.id);
  const existing = await dbUnified.findOne('supplierClaims', { id });
  if (existing) {
    return {
      claim: await advanceVerifiedClaim({ dbUnified, claim: existing, user }),
      created: false,
      idempotent: true,
    };
  }

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
    if (inserted) {
      return { claim: inserted, created: true, idempotent: false };
    }
  } catch (error) {
    if (!(error && error.code === 11000)) {
      throw error;
    }
  }

  const afterRace = await dbUnified.findOne('supplierClaims', { id });
  if (afterRace) {
    return {
      claim: await advanceVerifiedClaim({ dbUnified, claim: afterRace, user }),
      created: false,
      idempotent: true,
    };
  }
  throw new Error('Failed to persist Supplier Bot claim request');
}

module.exports = {
  claimIdFor,
  collisionSignals,
  createSupplierBotClaimRequest,
  ensureSupplierBotClaimIndexes,
  findSupplierBotCollision,
  isUnclaimedBotSupplier,
  normalizeWebsite,
};
