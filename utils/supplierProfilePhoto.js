'use strict';

function isUsableImageUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const url = value.trim();
  return /^(https?:\/\/|\/[^:])/i.test(url);
}

function resolveSupplierProfilePhoto(supplier, ownerUser) {
  const candidates = [
    ownerUser?.avatarUrl,
    supplier?.profilePhotoUrl,
    supplier?.avatarUrl,
    supplier?.logo,
  ];

  const imageUrl = candidates.find(isUsableImageUrl);
  return typeof imageUrl === 'string' ? imageUrl.trim() : null;
}

module.exports = {
  isUsableImageUrl,
  resolveSupplierProfilePhoto,
};
