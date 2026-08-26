'use strict';

const DEFAULT_GRACE_DAYS = 30;
const MIN_GRACE_DAYS = 1;
const MAX_GRACE_DAYS = 90;

function configuredGraceDays() {
  const parsed = Number(process.env.SUPPLIER_BOT_PACKAGE_GRACE_DAYS);
  if (!Number.isFinite(parsed)) return DEFAULT_GRACE_DAYS;
  return Math.min(MAX_GRACE_DAYS, Math.max(MIN_GRACE_DAYS, Math.floor(parsed)));
}

function isPackageGraceActive(supplier, now = new Date()) {
  if (!supplier?.supplierBotPackageGraceUntil) return false;
  const end = new Date(supplier.supplierBotPackageGraceUntil);
  return Number.isFinite(end.getTime()) && end > now;
}

async function startSupplierBotPackageGrace({ dbUnified, supplierId, claimedAt = new Date() }) {
  if (!dbUnified) throw new Error('Database unavailable');
  const supplier = await dbUnified.findOne('suppliers', { id: supplierId });
  if (!supplier) throw new Error('Supplier not found');
  if (supplier.acquisition?.source !== 'supplier_bot') {
    throw new Error('Package grace is only available to Supplier Bot-acquired profiles');
  }

  const started = claimedAt instanceof Date ? claimedAt : new Date(claimedAt);
  if (!Number.isFinite(started.getTime())) throw new Error('Invalid claim date');
  const until = new Date(started);
  until.setUTCDate(until.getUTCDate() + configuredGraceDays());
  const updates = {
    supplierBotPackageGraceStartedAt: started.toISOString(),
    supplierBotPackageGraceUntil: until.toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const saved = await dbUnified.updateOne('suppliers', { id: supplierId }, { $set: updates });
  if (!saved) throw new Error('Failed to start Supplier Bot package grace');
  return { ...supplier, ...updates };
}

module.exports = {
  DEFAULT_GRACE_DAYS,
  MAX_GRACE_DAYS,
  MIN_GRACE_DAYS,
  configuredGraceDays,
  isPackageGraceActive,
  startSupplierBotPackageGrace,
};
