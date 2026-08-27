'use strict';

const crypto = require('crypto');
const catalogCache = require('./catalogCache');
const {
  isPublishedUnclaimedSupplierBotProfile,
} = require('./supplierBotPilotVisibility.util');

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function packageIdentity(supplierId, title, occurrence) {
  const base = `${String(supplierId)}\u0000${slugify(title) || 'package'}\u0000${occurrence}`;
  const digest = crypto.createHash('sha256').update(base).digest('hex');
  return {
    id: `pkg_bot_${digest.slice(0, 24)}`,
    slug: `${slugify(title) || 'package'}-${digest.slice(0, 8)}`,
    sourcePackageKey: `${slugify(title) || 'package'}:${occurrence}`,
  };
}

function sourcePackageRecords(supplier, now = new Date().toISOString()) {
  const acquisition = supplier?.acquisition || {};
  const sourcePackages = Array.isArray(acquisition.sourcePackages) ? acquisition.sourcePackages : [];
  const sourceMedia = acquisition.sourceMedia || {};
  const mediaImages = [
    ...(Array.isArray(sourceMedia.images) ? sourceMedia.images : []),
    sourceMedia.coverImage,
  ].filter(Boolean);
  const occurrences = new Map();

  return sourcePackages
    .filter(item => item && typeof item === 'object' && (item.name || item.title))
    .map((item, index) => {
      const title = String(item.name || item.title).trim().slice(0, 160);
      const normalizedTitle = slugify(title) || 'package';
      const occurrence = (occurrences.get(normalizedTitle) || 0) + 1;
      occurrences.set(normalizedTitle, occurrence);
      const identity = packageIdentity(supplier.id, title, occurrence);
      const features = Array.isArray(item.features)
        ? item.features.map(value => String(value).trim()).filter(Boolean).slice(0, 30)
        : [];
      const description = String(item.description || features.join(' · ')).trim().slice(0, 2000);
      const priceDisplay = item.price === null || item.price === undefined ? '' : String(item.price).trim();
      const image = mediaImages.length ? mediaImages[index % mediaImages.length] : '';

      return {
        id: identity.id,
        slug: identity.slug,
        supplierId: supplier.id,
        supplierName: supplier.name || supplier.businessName || '',
        title,
        description,
        price: priceDisplay,
        priceDisplay,
        features,
        primaryCategoryKey: slugify(supplier.category),
        categories: supplier.category ? [slugify(supplier.category)] : [],
        eventTypes: [],
        image,
        gallery: image ? [{ url: image }] : [],
        images: image ? [image] : [],
        approved: true,
        isTest: false,
        paused: false,
        acquisition: {
          source: 'supplier_bot',
          candidateId: acquisition.candidateId || null,
          sourcePackageKey: identity.sourcePackageKey,
          managedWhileUnclaimed: true,
        },
        createdAt: now,
        updatedAt: now,
      };
    });
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function syncBotPackages({ dbUnified, supplier, now }) {
  const desired = sourcePackageRecords(supplier, now);
  const allPackages = (await dbUnified.read('packages')) || [];
  const current = allPackages.filter(
    pkg =>
      pkg &&
      String(pkg.supplierId) === String(supplier.id) &&
      pkg.acquisition?.source === 'supplier_bot'
  );
  const currentById = new Map(current.map(pkg => [String(pkg.id), pkg]));
  const desiredIds = new Set(desired.map(pkg => String(pkg.id)));
  let changed = false;

  for (const record of desired) {
    const existing = currentById.get(String(record.id));
    if (!existing) {
      await dbUnified.insertOne('packages', record);
      changed = true;
      continue;
    }

    const patch = {
      slug: existing.slug || record.slug,
      supplierId: record.supplierId,
      supplierName: record.supplierName,
      title: record.title,
      description: record.description,
      price: record.price,
      priceDisplay: record.priceDisplay,
      features: record.features,
      primaryCategoryKey: record.primaryCategoryKey,
      categories: record.categories,
      eventTypes: record.eventTypes,
      image: record.image,
      gallery: record.gallery,
      images: record.images,
      approved: true,
      isTest: false,
      paused: false,
      acquisition: {
        ...(existing.acquisition || {}),
        ...record.acquisition,
      },
    };
    const comparable = Object.fromEntries(Object.keys(patch).map(key => [key, existing[key]]));
    if (!sameValue(comparable, patch)) {
      await dbUnified.updateOne('packages', { id: existing.id }, { $set: { ...patch, updatedAt: now } });
      changed = true;
    }
  }

  for (const existing of current) {
    if (desiredIds.has(String(existing.id)) || existing.approved === false) {
      continue;
    }
    await dbUnified.updateOne(
      'packages',
      { id: existing.id },
      {
        $set: {
          approved: false,
          paused: true,
          retiredAt: now,
          updatedAt: now,
        },
      }
    );
    changed = true;
  }

  return { changed, packageCount: desired.length };
}

async function ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier }) {
  if (!dbUnified || !isPublishedUnclaimedSupplierBotProfile(supplier)) {
    return { supplier, changed: false, packageCount: 0 };
  }

  const now = new Date().toISOString();
  const supplierPatch = {
    approved: true,
    approvedAt: supplier.approvedAt || now,
    approvedBy: supplier.approvedBy || 'supplier_bot_publication',
    publishedAt: supplier.publishedAt || supplier.acquisition?.publishedUnclaimedAt || now,
    ...(supplier.status === 'draft' || !supplier.status ? { status: 'active' } : {}),
  };
  const supplierComparable = Object.fromEntries(
    Object.keys(supplierPatch).map(key => [key, supplier[key]])
  );
  let changed = false;
  let normalizedSupplier = supplier;

  if (!sameValue(supplierComparable, supplierPatch)) {
    const wrote = await dbUnified.updateOne(
      'suppliers',
      { id: supplier.id },
      { $set: { ...supplierPatch, updatedAt: now } }
    );
    if (!wrote) {
      throw new Error(`Failed to publish Supplier Bot marketplace profile ${supplier.id}`);
    }
    normalizedSupplier = { ...supplier, ...supplierPatch, updatedAt: now };
    changed = true;
  }

  const packageSync = await syncBotPackages({ dbUnified, supplier: normalizedSupplier, now });
  changed = changed || packageSync.changed;

  if (changed && catalogCache && typeof catalogCache.invalidate === 'function') {
    await catalogCache.invalidate().catch(() => undefined);
  }

  return {
    supplier: normalizedSupplier,
    changed,
    packageCount: packageSync.packageCount,
  };
}

async function reconcilePublishedUnclaimedMarketplaceState({ dbUnified, logger = console }) {
  if (!dbUnified || typeof dbUnified.read !== 'function') {
    return { checked: 0, changed: 0, packages: 0 };
  }
  const suppliers = (await dbUnified.read('suppliers')) || [];
  const published = suppliers.filter(isPublishedUnclaimedSupplierBotProfile);
  let changed = 0;
  let packages = 0;

  for (const supplier of published) {
    try {
      const result = await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier });
      if (result.changed) changed += 1;
      packages += result.packageCount;
    } catch (error) {
      logger.error('Failed to reconcile published Supplier Bot marketplace profile', {
        supplierId: supplier?.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checked: published.length, changed, packages };
}

module.exports = {
  ensurePublishedUnclaimedMarketplaceState,
  packageIdentity,
  reconcilePublishedUnclaimedMarketplaceState,
  sourcePackageRecords,
};
