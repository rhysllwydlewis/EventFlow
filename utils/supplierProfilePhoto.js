'use strict';

function isUsableImageUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const url = value.trim();
  return /^(https?:\/\/[^\s]+|\/[^/\\:][^:]*)$/i.test(url);
}

function normalizeId(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function findUserById(users, id) {
  const wanted = normalizeId(id);
  if (!wanted) {
    return null;
  }
  return (
    users.find(user => [user?.id, user?._id].map(normalizeId).filter(Boolean).includes(wanted)) ||
    null
  );
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getSupplierOwnerIdCandidates(supplier = {}) {
  return [
    supplier.ownerUserId,
    supplier.userId,
    supplier.ownerId,
    supplier.accountId,
    supplier.createdByUserId,
    supplier.createdBy,
    supplier.createdById,
  ]
    .map(normalizeId)
    .filter(Boolean);
}

function getSupplierOwnerEmailCandidates(supplier = {}) {
  return [supplier.email, supplier.ownerEmail, supplier.contactEmail]
    .map(normalizeEmail)
    .filter(Boolean);
}

function findOwnerUserForSupplier(supplier, users = []) {
  if (!supplier || !Array.isArray(users) || users.length === 0) {
    return null;
  }

  for (const id of getSupplierOwnerIdCandidates(supplier)) {
    const user = findUserById(users, id);
    if (user) {
      return user;
    }
  }

  const emailCandidates = getSupplierOwnerEmailCandidates(supplier);
  if (emailCandidates.length === 0) {
    return null;
  }

  const supplierEmails = new Set(emailCandidates);
  return users.find(user => supplierEmails.has(normalizeEmail(user?.email))) || null;
}

async function findOwnerUserForSupplierFromDb(supplier, dbUnified, logger = console) {
  if (!supplier || !dbUnified) {
    return null;
  }

  for (const id of getSupplierOwnerIdCandidates(supplier)) {
    try {
      const user = await dbUnified.findOne('users', { id });
      if (user) {
        return user;
      }

      // Some Mongo-backed user records are keyed by `_id` while the supplier
      // record stores that same value in ownerUserId/userId/accountId. The
      // supplier dashboard and settings can still show req.user.avatarUrl in
      // that case, so the public profile must try the same account id against
      // `_id` before falling back to legacy email matching.
      const userByMongoId = await dbUnified.findOne('users', { _id: id });
      if (userByMongoId) {
        return userByMongoId;
      }
    } catch (err) {
      logger.warn?.(
        'supplierProfilePhoto: id-based owner lookup failed for',
        supplier.id,
        err.message
      );
    }
  }

  const emailCandidates = getSupplierOwnerEmailCandidates(supplier);
  if (emailCandidates.length === 0) {
    return null;
  }

  try {
    const users = await dbUnified.read('users');
    return findOwnerUserForSupplier(supplier, users);
  } catch (err) {
    logger.warn?.(
      'supplierProfilePhoto: email-based owner lookup failed for',
      supplier.id,
      err.message
    );
    return null;
  }
}

function getUserImageCandidates(user = {}) {
  const source = user && typeof user === 'object' ? user : {};
  return [
    source.avatarUrl,
    source.profilePhotoUrl,
    source.displayAvatarUrl,
    source.profileImage,
    source.profilePhoto,
    source.photoUrl,
    source.image,
    source.picture,
    source.photo,
    source.avatar,
    source.profile?.avatarUrl,
    source.profile?.photoUrl,
    source.profile?.image,
    source.settings?.avatarUrl,
    source.settings?.profilePhotoUrl,
  ];
}

function resolveSupplierProfilePhoto(supplier, ownerUser) {
  const candidates = [
    // Supplier-specific profile-photo fields are authoritative when present.
    supplier?.profilePhotoUrl,
    supplier?.displayAvatarUrl,
    supplier?.avatarUrl,
    supplier?.profileImage,
    supplier?.profilePhoto,
    supplier?.photoUrl,
    supplier?.image,
    // If older supplier records were not backfilled, keep the public profile in
    // sync with the owning account avatar before falling back to legacy logos.
    ...getUserImageCandidates(ownerUser),
    supplier?.logo,
  ];

  const imageUrl = candidates.find(isUsableImageUrl);
  return typeof imageUrl === 'string' ? imageUrl.trim() : null;
}

function resolveSupplierOwnerUserId(supplier, ownerUser) {
  return (
    normalizeId(supplier?.ownerUserId) || normalizeId(ownerUser?.id) || normalizeId(ownerUser?._id)
  );
}

function hydrateSupplierProfilePhoto(supplier, ownerUser) {
  const profilePhotoUrl = resolveSupplierProfilePhoto(supplier, ownerUser);
  const ownerUserId = resolveSupplierOwnerUserId(supplier, ownerUser);
  return {
    ...supplier,
    ...(ownerUserId ? { ownerUserId } : {}),
    profilePhotoUrl,
    avatarUrl: profilePhotoUrl,
    displayAvatarUrl: profilePhotoUrl,
    resolvedProfileImageUrl: profilePhotoUrl,
  };
}

module.exports = {
  isUsableImageUrl,
  findOwnerUserForSupplier,
  findOwnerUserForSupplierFromDb,
  getSupplierOwnerEmailCandidates,
  getSupplierOwnerIdCandidates,
  getUserImageCandidates,
  hydrateSupplierProfilePhoto,
  resolveSupplierOwnerUserId,
  resolveSupplierProfilePhoto,
};
