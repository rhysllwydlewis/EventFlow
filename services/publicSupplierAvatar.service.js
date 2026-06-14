'use strict';

const DEFAULT_SUPPLIER_ID = 'sup_wtlrt6uiftxg2y';
const PROFILE_PHOTO_FIELDS = [
  'profilePhotoUrl',
  'displayAvatarUrl',
  'avatarUrl',
  'profileImage',
  'profilePhoto',
  'photoUrl',
  'image',
];

function getInitials(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return words[0].charAt(0).toUpperCase();
  }
  return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
}

function isSafePublicImageUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const url = value.trim();
  if (!url || /^data:/i.test(url) || /^javascript:/i.test(url) || /^\/\//.test(url)) {
    return false;
  }
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_err) {
      return false;
    }
  }
  return /^\/[^/\\:][^:]*$/i.test(url);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function findSupplierOwnerForAvatar(supplier, users = []) {
  if (!supplier || !Array.isArray(users)) {
    return null;
  }
  const ownerId = supplier.ownerUserId || supplier.userId || supplier.createdByUserId;
  if (ownerId) {
    const byId = users.find(user => user && user.id === ownerId);
    if (byId) {
      return byId;
    }
  }
  const supplierEmails = [supplier.email, supplier.ownerEmail, supplier.contactEmail]
    .map(normalizeEmail)
    .filter(Boolean);
  if (!supplierEmails.length) {
    return null;
  }
  return users.find(user => supplierEmails.includes(normalizeEmail(user && user.email))) || null;
}

function firstSafeUrlFrom(object, fields) {
  for (const field of fields) {
    const value = object && object[field];
    if (isSafePublicImageUrl(value)) {
      return String(value).trim();
    }
  }
  return null;
}

function chooseExistingAvatarForBackfill(supplier, ownerUser) {
  return (
    firstSafeUrlFrom(supplier, PROFILE_PHOTO_FIELDS) ||
    firstSafeUrlFrom(ownerUser, ['avatarUrl', 'avatar']) ||
    null
  );
}

function supplierIsPublic(supplier) {
  return Boolean(supplier && (supplier.approved === true || supplier.verified === true));
}

async function getPublicSupplierAvatar(supplierId, options = {}) {
  const db = options.dbUnified || require('../db-unified');
  const supplier = await db.findOne('suppliers', { id: supplierId });
  if (!supplier || !supplierIsPublic(supplier)) {
    return null;
  }
  const avatarUrl = isSafePublicImageUrl(supplier.publicProfileAvatarUrl)
    ? String(supplier.publicProfileAvatarUrl).trim()
    : null;
  return {
    supplierId: supplier.id,
    hasPhoto: Boolean(avatarUrl),
    avatarUrl,
    initials: getInitials(supplier.name || supplier.company || supplier.businessName),
  };
}

async function syncPublicSupplierAvatarForSupplier(supplierId, avatarUrl, options = {}) {
  const db = options.dbUnified || require('../db-unified');
  const now = new Date().toISOString();
  const update = { $set: { updatedAt: now } };
  if (avatarUrl && isSafePublicImageUrl(avatarUrl)) {
    update.$set.publicProfileAvatarUrl = String(avatarUrl).trim();
  } else {
    update.$unset = { publicProfileAvatarUrl: '' };
  }
  return db.updateOne('suppliers', { id: supplierId }, update);
}

async function syncPublicSupplierAvatarForUser(userOrId, avatarUrl, options = {}) {
  const db = options.dbUnified || require('../db-unified');
  const user = typeof userOrId === 'object' && userOrId ? userOrId : { id: userOrId };
  const userId = user.id;
  if (!userId) {
    return { matched: 0 };
  }
  const suppliers = (await db.read('suppliers')) || [];
  const userEmail = normalizeEmail(user.email);
  const matches = suppliers.filter(s => {
    if (!s) {
      return false;
    }
    if (s.ownerUserId === userId || s.userId === userId || s.createdByUserId === userId) {
      return true;
    }
    return Boolean(
      userEmail &&
      [s.email, s.ownerEmail, s.contactEmail].map(normalizeEmail).some(email => email === userEmail)
    );
  });
  for (const supplier of matches) {
    await syncPublicSupplierAvatarForSupplier(supplier.id, avatarUrl, { dbUnified: db });
  }
  return { matched: matches.length };
}

async function repairPublicSupplierAvatars(options = {}) {
  const db = options.dbUnified || require('../db-unified');
  const force = Boolean(options.force);
  const suppliers = (await db.read('suppliers')) || [];
  const users = (await db.read('users')) || [];
  const summary = {
    scanned: suppliers.length,
    repaired: 0,
    skippedExisting: 0,
    skippedNoImage: 0,
    failed: 0,
  };
  for (const supplier of suppliers) {
    try {
      if (!force && isSafePublicImageUrl(supplier.publicProfileAvatarUrl)) {
        summary.skippedExisting += 1;
        continue;
      }
      const ownerUser = findSupplierOwnerForAvatar(supplier, users);
      const chosen = chooseExistingAvatarForBackfill(supplier, ownerUser);
      if (!chosen) {
        summary.skippedNoImage += 1;
        continue;
      }
      await syncPublicSupplierAvatarForSupplier(supplier.id, chosen, { dbUnified: db });
      summary.repaired += 1;
    } catch (_err) {
      summary.failed += 1;
    }
  }
  return summary;
}

async function checkPublicImageReachability(avatarUrl, options = {}) {
  if (!isSafePublicImageUrl(avatarUrl)) {
    return { checked: false, reachable: false, reason: 'unsafe-url' };
  }
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') {
    return { checked: false, reachable: null, reason: 'fetch-unavailable' };
  }
  let target = String(avatarUrl).trim();
  if (target.startsWith('/')) {
    const baseUrl = options.baseUrl || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL;
    if (!baseUrl) {
      return { checked: false, reachable: null, reason: 'base-url-required-for-relative-url' };
    }
    try {
      target = new URL(target, baseUrl).toString();
    } catch (_err) {
      return { checked: false, reachable: false, reason: 'invalid-base-url' };
    }
  }

  try {
    const response = await fetchImpl(target, { method: 'HEAD' });
    const contentType =
      response.headers && response.headers.get ? response.headers.get('content-type') : '';
    return {
      checked: true,
      reachable: response.ok,
      status: response.status,
      contentType: contentType || null,
      imageContentType: typeof contentType === 'string' && /^image\//i.test(contentType),
    };
  } catch (error) {
    return { checked: true, reachable: false, reason: error.message || 'request-failed' };
  }
}

async function diagnoseKnownSupplierAvatar(options = {}) {
  const supplierId = options.supplierId || DEFAULT_SUPPLIER_ID;
  const db = options.dbUnified || require('../db-unified');
  const supplier = await db.findOne('suppliers', { id: supplierId });
  const endpointResult = supplier
    ? await getPublicSupplierAvatar(supplierId, { dbUnified: db })
    : null;
  const reachability =
    options.checkReachability && endpointResult && endpointResult.avatarUrl
      ? await checkPublicImageReachability(endpointResult.avatarUrl, options)
      : { checked: false, reachable: null, reason: 'not-requested' };
  return {
    supplierId,
    exists: Boolean(supplier),
    hasPublicProfileAvatarUrl: Boolean(supplier && supplier.publicProfileAvatarUrl),
    publicProfileAvatarUrlSafe: Boolean(
      supplier && isSafePublicImageUrl(supplier.publicProfileAvatarUrl)
    ),
    endpointHasPhoto: Boolean(endpointResult && endpointResult.hasPhoto),
    imageReachability: reachability,
  };
}

module.exports = {
  getInitials,
  isSafePublicImageUrl,
  findSupplierOwnerForAvatar,
  chooseExistingAvatarForBackfill,
  getPublicSupplierAvatar,
  syncPublicSupplierAvatarForUser,
  syncPublicSupplierAvatarForSupplier,
  repairPublicSupplierAvatars,
  checkPublicImageReachability,
  diagnoseKnownSupplierAvatar,
};
