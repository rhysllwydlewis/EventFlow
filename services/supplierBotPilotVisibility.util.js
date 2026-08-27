'use strict';

const PILOT_SCOPE = 'pilot_unclaimed';
const PUBLIC_UNCLAIMED_SCOPE = 'public_unclaimed';
const PUBLISHED_UNCLAIMED_SCOPES = new Set([PILOT_SCOPE, PUBLIC_UNCLAIMED_SCOPE]);

function supplierBotPublicationScope(record) {
  const source = record && typeof record === 'object' ? record : {};
  if (
    source.ownershipStatus !== 'unclaimed' ||
    !source.acquisition ||
    source.acquisition.source !== 'supplier_bot'
  ) {
    return null;
  }
  const scope = source.acquisition.publicationScope;
  return PUBLISHED_UNCLAIMED_SCOPES.has(scope) ? scope : null;
}

function isPublishedUnclaimedSupplierBotProfile(record) {
  return supplierBotPublicationScope(record) !== null;
}

function isSupplierBotPilotProfile(record) {
  return supplierBotPublicationScope(record) === PILOT_SCOPE;
}

function publishedUnclaimedPresentationSupplier(record) {
  if (!isPublishedUnclaimedSupplierBotProfile(record)) {
    return record;
  }

  const source = record && typeof record === 'object' ? record : {};
  const acquisition =
    source.acquisition && typeof source.acquisition === 'object' ? source.acquisition : {};
  const sourceMedia =
    acquisition.sourceMedia && typeof acquisition.sourceMedia === 'object'
      ? acquisition.sourceMedia
      : {};
  const sourcePackages = Array.isArray(acquisition.sourcePackages)
    ? acquisition.sourcePackages
    : [];
  const advertisedPrices = Array.isArray(acquisition.advertisedPrices)
    ? acquisition.advertisedPrices.filter(Boolean)
    : [];

  const topPackages = sourcePackages.slice(0, 4).map((pkg, index) => {
    const item = pkg && typeof pkg === 'object' ? pkg : {};
    const features = Array.isArray(item.features) ? item.features.filter(Boolean).slice(0, 6) : [];
    return {
      id: `supplier-bot-package-${index + 1}`,
      title: item.name || item.title || `Package ${index + 1}`,
      name: item.name || item.title || `Package ${index + 1}`,
      description: item.description || features.join(' · '),
      price: item.price || item.priceDisplay || item.price_display || '',
      priceDisplay: item.priceDisplay || item.price_display || item.price || '',
    };
  });

  return {
    ...source,
    coverImage: source.coverImage || sourceMedia.coverImage || '',
    bannerUrl: source.bannerUrl || sourceMedia.coverImage || '',
    images:
      Array.isArray(source.images) && source.images.length > 0
        ? source.images
        : Array.isArray(sourceMedia.images)
          ? sourceMedia.images
          : [],
    photosGallery:
      Array.isArray(source.photosGallery) && source.photosGallery.length > 0
        ? source.photosGallery
        : Array.isArray(sourceMedia.images)
          ? sourceMedia.images
          : [],
    featuredServices:
      Array.isArray(source.featuredServices) && source.featuredServices.length > 0
        ? source.featuredServices
        : Array.isArray(source.tags)
          ? source.tags
          : [],
    priceRange:
      advertisedPrices[0] || source.priceRange || source.price_display || source.priceDisplay || '',
    price_display:
      advertisedPrices[0] || source.price_display || source.priceRange || source.priceDisplay || '',
    topPackages:
      Array.isArray(source.topPackages) && source.topPackages.length > 0
        ? source.topPackages
        : topPackages,
  };
}

// Backwards-compatible pilot helper retained while the one-profile pilot is
// still represented in persisted data. New live publications use the generic
// published-unclaimed helper above.
function pilotPresentationSupplier(record) {
  return isSupplierBotPilotProfile(record)
    ? publishedUnclaimedPresentationSupplier(record)
    : record;
}

module.exports = {
  PILOT_SCOPE,
  PUBLIC_UNCLAIMED_SCOPE,
  PUBLISHED_UNCLAIMED_SCOPES,
  isPublishedUnclaimedSupplierBotProfile,
  isSupplierBotPilotProfile,
  pilotPresentationSupplier,
  publishedUnclaimedPresentationSupplier,
  supplierBotPublicationScope,
};
