'use strict';

const crypto = require('crypto');
const catalogCache = require('./catalogCache');
const { isPublishedUnclaimedSupplierBotProfile } = require('./supplierBotPilotVisibility.util');

const MAX_PUBLIC_BOT_PACKAGES = 10;
const MIN_PACKAGE_CONFIDENCE = 85;
const PACKAGE_KINDS = new Set(['advertised_package', 'priced_service']);

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

function validSourceUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch (_error) {
    return null;
  }
}

function normalizedEvidenceIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 20);
}

function normalizedPriceDetails(value) {
  if (!value || typeof value !== 'object') return null;
  const amount = value.amount === null || value.amount === undefined ? null : Number(value.amount);
  const maxAmount =
    value.maxAmount === null || value.maxAmount === undefined ? null : Number(value.maxAmount);
  if (
    (amount !== null && (!Number.isFinite(amount) || amount < 0)) ||
    (maxAmount !== null && (!Number.isFinite(maxAmount) || maxAmount < 0))
  ) {
    return null;
  }
  return {
    currency: value.currency === 'GBP' ? 'GBP' : 'GBP',
    amount,
    maxAmount,
    qualifier: ['fixed', 'from', 'range', 'minimum_spend', 'other'].includes(value.qualifier)
      ? value.qualifier
      : 'other',
    unit: [
      'total',
      'per_person',
      'per_hour',
      'per_day',
      'per_event',
      'per_item',
      'per_night',
      'other',
    ].includes(value.unit)
      ? value.unit
      : null,
    vatStatus: ['included', 'excluded', 'unspecified'].includes(value.vatStatus)
      ? value.vatStatus
      : 'unspecified',
  };
}

function normalizePublishableSourcePackage(item) {
  if (!item || typeof item !== 'object' || !(item.name || item.title)) return null;
  const title = String(item.name || item.title).trim().slice(0, 160);
  const priceDisplay = String(item.priceDisplay || item.price || '').trim().slice(0, 120);
  const sourceUrl = validSourceUrl(item.sourceUrl);
  const evidenceIds = normalizedEvidenceIds(item.evidenceIds);
  const confidence = Number(item.extractionConfidence);
  const kind = PACKAGE_KINDS.has(item.kind) ? item.kind : null;
  const sourceObservedAt = item.sourceObservedAt
    ? String(item.sourceObservedAt).slice(0, 80)
    : null;
  const sourceContentHash = item.sourceContentHash
    ? String(item.sourceContentHash).trim().slice(0, 128)
    : null;

  // Fail closed. Legacy or weak AI package data may stay in acquisition history,
  // but it is not materialised into the public marketplace until it carries the
  // new direct commercial-evidence provenance contract.
  if (
    !title ||
    !priceDisplay ||
    !sourceUrl ||
    !evidenceIds.length ||
    !sourceContentHash ||
    !kind ||
    !Number.isFinite(confidence) ||
    confidence < MIN_PACKAGE_CONFIDENCE
  ) {
    return null;
  }

  const features = Array.isArray(item.features)
    ? item.features
        .map(value => String(value).trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];
  return {
    title,
    priceDisplay,
    kind,
    features,
    description: String(item.description || features.join(' · '))
      .trim()
      .slice(0, 2000),
    sourceUrl,
    evidenceIds,
    sourceObservedAt,
    sourceContentHash,
    extractionConfidence: Math.min(100, Math.max(0, confidence)),
    priceDetails: normalizedPriceDetails(item.priceDetails),
    image: validSourceUrl(item.image || item.imageUrl || '') || '',
  };
}

function sourceRefreshKey(supplier) {
  const acquisition = supplier?.acquisition || {};
  return String(
    acquisition.refreshedAt ||
      acquisition.generatedAt ||
      acquisition.publishedUnclaimedAt ||
      supplier?.updatedAt ||
      ''
  );
}

function sourcePackageRecords(supplier, now = new Date().toISOString()) {
  const acquisition = supplier?.acquisition || {};
  const sourcePackages = Array.isArray(acquisition.sourcePackages)
    ? acquisition.sourcePackages
    : [];
  const sourceMedia = acquisition.sourceMedia || {};
  const mediaImages = [
    ...(Array.isArray(sourceMedia.images) ? sourceMedia.images : []),
    sourceMedia.coverImage,
  ].filter(Boolean);
  const occurrences = new Map();
  const refreshKey = sourceRefreshKey(supplier);

  return sourcePackages
    .map(normalizePublishableSourcePackage)
    .filter(Boolean)
    .slice(0, MAX_PUBLIC_BOT_PACKAGES)
    .map((item, index) => {
      const normalizedTitle = slugify(item.title) || 'package';
      const occurrence = (occurrences.get(normalizedTitle) || 0) + 1;
      occurrences.set(normalizedTitle, occurrence);
      const identity = packageIdentity(supplier.id, item.title, occurrence);
      const image =
        item.image || (mediaImages.length ? mediaImages[index % mediaImages.length] : '');

      return {
        id: identity.id,
        slug: identity.slug,
        supplierId: supplier.id,
        supplierName: supplier.name || supplier.businessName || '',
        title: item.title,
        description: item.description,
        price: item.priceDisplay,
        priceDisplay: item.priceDisplay,
        priceDetails: item.priceDetails,
        features: item.features,
        primaryCategoryKey: slugify(supplier.category),
        categories: supplier.category ? [slugify(supplier.category)] : [],
        eventTypes: [],
        image,
        gallery: image ? [{ url: image }] : [],
        images: image ? [image] : [],
        approved: true,
        isTest: false,
        paused: false,
        retiredAt: null,
        acquisition: {
          source: 'supplier_bot',
          candidateId: acquisition.candidateId || null,
          sourcePackageKey: identity.sourcePackageKey,
          sourcePackageKind: item.kind,
          sourceUrl: item.sourceUrl,
          sourceObservedAt: item.sourceObservedAt,
          sourceContentHash: item.sourceContentHash,
          evidenceIds: item.evidenceIds,
          extractionConfidence: item.extractionConfidence,
          managedWhileUnclaimed: true,
          lastSeenAt: now,
          lastSeenSourceRefresh: refreshKey,
          missingCount: 0,
          missingSince: null,
          lastMissingSourceRefresh: null,
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
  const refreshKey = sourceRefreshKey(supplier);
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
      priceDetails: record.priceDetails,
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
      retiredAt: null,
      acquisition: {
        ...(existing.acquisition || {}),
        ...record.acquisition,
      },
    };
    const comparable = Object.fromEntries(Object.keys(patch).map(key => [key, existing[key]]));
    if (!sameValue(comparable, patch)) {
      await dbUnified.updateOne(
        'packages',
        { id: existing.id },
        { $set: { ...patch, updatedAt: now } }
      );
      changed = true;
    }
  }

  for (const existing of current) {
    if (desiredIds.has(String(existing.id)) || existing.approved === false) {
      continue;
    }

    const acquisition = existing.acquisition || {};
    // Reconciliation may run multiple times for the same successful supplier
    // refresh (for example on application restarts). The same source snapshot
    // must never count as multiple misses.
    if (refreshKey && acquisition.lastMissingSourceRefresh === refreshKey) {
      continue;
    }

    const missingCount = Number(acquisition.missingCount || 0);
    if (missingCount < 1) {
      await dbUnified.updateOne(
        'packages',
        { id: existing.id },
        {
          $set: {
            acquisition: {
              ...acquisition,
              missingCount: 1,
              missingSince: acquisition.missingSince || now,
              lastMissingSourceRefresh: refreshKey || now,
            },
            updatedAt: now,
          },
        }
      );
      changed = true;
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
          acquisition: {
            ...acquisition,
            missingCount: missingCount + 1,
            lastMissingSourceRefresh: refreshKey || now,
            confirmedRemovedAt: now,
          },
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
      if (result.changed) {
        changed += 1;
      }
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
  MAX_PUBLIC_BOT_PACKAGES,
  MIN_PACKAGE_CONFIDENCE,
  ensurePublishedUnclaimedMarketplaceState,
  packageIdentity,
  reconcilePublishedUnclaimedMarketplaceState,
  sourcePackageRecords,
};
