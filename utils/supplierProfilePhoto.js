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
  return users.find(user => normalizeId(user?.id) === wanted) || null;
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function findOwnerUserForSupplier(supplier, users = []) {
  if (!supplier || !Array.isArray(users) || users.length === 0) {
    return null;
  }

  const idCandidates = [supplier.ownerUserId, supplier.userId, supplier.createdByUserId];
  for (const id of idCandidates) {
    const user = findUserById(users, id);
    if (user) {
      return user;
    }
  }

  const emailCandidates = [supplier.email, supplier.ownerEmail, supplier.contactEmail]
    .map(normalizeEmail)
    .filter(Boolean);
  if (emailCandidates.length === 0) {
    return null;
  }

  const supplierEmails = new Set(emailCandidates);
  return users.find(user => supplierEmails.has(normalizeEmail(user?.email))) || null;
}

function resolveSupplierProfilePhoto(supplier, ownerUser) {
  const candidates = [
    supplier?.profilePhotoUrl,
    supplier?.displayAvatarUrl,
    supplier?.avatarUrl,
    supplier?.profileImage,
    ownerUser?.avatarUrl,
    supplier?.logo,
  ];

  const imageUrl = candidates.find(isUsableImageUrl);
  return typeof imageUrl === 'string' ? imageUrl.trim() : null;
}

module.exports = {
  isUsableImageUrl,
  findOwnerUserForSupplier,
  resolveSupplierProfilePhoto,
};
