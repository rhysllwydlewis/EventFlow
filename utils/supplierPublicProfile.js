'use strict';

const { stripHtml } = require('./helpers');
const { normaliseStoredSupplierTheme } = require('./supplierTheme');

const DEFAULT_MAX_IMAGE_CHARS = 1200000;
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;
const ROOTED_IMAGE_RE = /^\/[^/\\:][^:]*$/;

function text(value, max = 500) {
  if (value === null || value === undefined) {
    return '';
  }
  return stripHtml(String(value)).trim().slice(0, max);
}

function maybeText(value, max = 500) {
  const cleaned = text(value, max);
  return cleaned || null;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bool(value) {
  return value === true;
}

function safeImageUrl(value, max = DEFAULT_MAX_IMAGE_CHARS) {
  const cleaned = text(value, max);
  if (!cleaned) {
    return '';
  }
  if (DATA_IMAGE_RE.test(cleaned)) {
    return '';
  }
  if (ROOTED_IMAGE_RE.test(cleaned)) {
    return cleaned;
  }
  try {
    const parsed = new URL(cleaned);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
  } catch (_err) {
    return '';
  }
}

function safeExternalUrl(value) {
  const cleaned = text(value, 500);
  if (!cleaned) {
    return '';
  }
  try {
    const parsed = new URL(cleaned);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
  } catch (_err) {
    return '';
  }
}

function safePhone(value) {
  const cleaned = text(value, 60);
  return /^[+\d][\d\s().-]{5,}$/.test(cleaned) ? cleaned : '';
}

function safeStringArray(items, maxItems = 12, maxLen = 120) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map(item => text(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function safeSocialLinks(socialLinks = {}) {
  const source = socialLinks && typeof socialLinks === 'object' ? socialLinks : {};
  const allowed = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok'];
  return allowed.reduce((acc, platform) => {
    const safe = safeExternalUrl(source[platform]);
    if (safe) {
      acc[platform] = safe;
    }
    return acc;
  }, {});
}

function safeVerifications(verifications = {}) {
  const source = verifications && typeof verifications === 'object' ? verifications : {};
  return {
    email: { verified: bool(source.email?.verified) },
    phone: { verified: bool(source.phone?.verified) },
    business: { verified: bool(source.business?.verified) },
  };
}

function safeBadgeDetails(badges = []) {
  if (!Array.isArray(badges)) {
    return [];
  }
  return badges
    .map(badge => (badge && typeof badge === 'object' ? badge : {}))
    .map(badge => ({
      id: maybeText(badge.id, 80),
      type: maybeText(badge.type, 80),
      name: maybeText(badge.name, 120),
      description: maybeText(badge.description, 220),
      icon: maybeText(badge.icon, 20),
      displayOrder: numberOrNull(badge.displayOrder),
    }))
    .filter(badge => badge.id || badge.name)
    .slice(0, 24);
}

function safePublicPackage(pkg = {}, resolveImage) {
  const source = pkg && typeof pkg === 'object' ? pkg : {};
  const image =
    typeof resolveImage === 'function' ? resolveImage(source) : source.image || source.imageUrl;
  return {
    id: maybeText(source.id, 100),
    slug: maybeText(source.slug, 120),
    supplierId: maybeText(source.supplierId, 100),
    title: maybeText(source.title || source.name, 160) || 'Package',
    name: maybeText(source.name || source.title, 160),
    description: maybeText(source.description, 800),
    description_short: maybeText(source.description_short || source.descriptionShort, 240),
    price: maybeText(source.price || source.price_display || source.priceDisplay, 80),
    price_display: maybeText(source.price_display || source.priceDisplay || source.price, 80),
    priceDisplay: maybeText(source.priceDisplay || source.price_display || source.price, 80),
    image: safeImageUrl(image),
    imageUrl: safeImageUrl(source.imageUrl || image),
  };
}

function safeTopPackages(packages = []) {
  if (!Array.isArray(packages)) {
    return [];
  }
  return packages
    .filter(pkg => pkg && typeof pkg === 'object')
    .map(pkg => safePublicPackage(pkg))
    .slice(0, 4);
}

function safePublicSupplier(supplier = {}, extras = {}) {
  const source = supplier && typeof supplier === 'object' ? supplier : {};
  const extra = extras && typeof extras === 'object' ? extras : {};
  const bannerUrl = safeImageUrl(source.bannerUrl || source.coverImage);
  const logo = safeImageUrl(source.logo || source.profileImage);
  const profilePhotoUrl = safeImageUrl(
    extra.profilePhotoUrl ||
      source.profilePhotoUrl ||
      source.displayAvatarUrl ||
      source.avatarUrl ||
      source.profileImage ||
      source.profilePhoto ||
      source.photoUrl ||
      source.image ||
      source.logo
  );
  const website = safeExternalUrl(source.website);
  const socialLinks = safeSocialLinks(source.socialLinks);
  const rating = numberOrNull(source.averageRating ?? source.rating);
  const reviewCount = numberOrNull(source.reviewCount);
  const avgResponseTime = numberOrNull(source.avgResponseTime);
  const ownerUserId = maybeText(source.ownerUserId, 100);
  const messagingRecipientId = extra.exposeMessagingRecipient === true ? ownerUserId : '';
  const theme = normaliseStoredSupplierTheme(source);
  return {
    id: maybeText(source.id, 100),
    ...(messagingRecipientId ? { messagingRecipientId } : {}),
    name: maybeText(source.name, 140) || 'Supplier',
    category: maybeText(source.category, 100),
    location: maybeText(source.location, 180),
    postcode: maybeText(source.postcode || source.venuePostcode, 32),
    tagline: maybeText(source.tagline, 220),
    description: maybeText(source.description || source.description_short, 1200),
    description_short: maybeText(source.description_short, 320),
    description_long: maybeText(source.description_long, 5000),
    metaDescription: maybeText(source.metaDescription, 260),
    bannerUrl,
    coverImage: bannerUrl,
    openGraphImage: safeImageUrl(source.openGraphImage || bannerUrl || logo),
    logo,
    profileImage: logo,
    profilePhotoUrl,
    avatarUrl: profilePhotoUrl,
    displayAvatarUrl: profilePhotoUrl,
    resolvedProfileImageUrl: profilePhotoUrl,
    themeMode: theme.themeMode,
    themeColor: theme.themeColor,
    heroPreset: theme.heroPreset,
    priceRange: maybeText(source.priceRange || source.price_display, 80),
    price_display: maybeText(source.price_display || source.priceRange, 80),
    priceHint: maybeText(source.priceHint || source.price_display, 80),
    website,
    phone: safePhone(source.phone),
    maxGuests: numberOrNull(source.maxGuests),
    amenities: safeStringArray(source.amenities, 24, 80),
    highlights: safeStringArray(source.highlights, 5, 80),
    featuredServices: safeStringArray(source.featuredServices, 10, 100),
    socialLinks,
    photosGallery: Array.isArray(source.photosGallery)
      ? source.photosGallery
          .map(item => safeImageUrl(typeof item === 'string' ? item : item?.url || item?.src))
          .filter(Boolean)
          .slice(0, 24)
      : [],
    completedEvents: numberOrNull(source.completedEvents),
    createdAt: maybeText(source.createdAt, 40),
    avgResponseTime,
    rating,
    averageRating: rating,
    reviewCount,
    verified: bool(source.verified || source.approved),
    approved: bool(source.approved),
    emailVerified: bool(source.emailVerified || source.verifications?.email?.verified),
    phoneVerified: bool(source.phoneVerified || source.verifications?.phone?.verified),
    businessVerified: bool(source.businessVerified || source.verifications?.business?.verified),
    verifications: safeVerifications(source.verifications),
    insurance: bool(source.insurance),
    license: maybeText(source.license, 120),
    isFoundingSupplier: bool(source.isFoundingSupplier || source.isFounding || source.founding),
    isFounding: bool(source.isFounding || source.isFoundingSupplier || source.founding),
    founding: bool(source.founding || source.isFoundingSupplier || source.isFounding),
    foundingYear: numberOrNull(source.foundingYear),
    featured: bool(source.featured || extra.featuredSupplier),
    featuredSupplier: bool(extra.featuredSupplier || source.featuredSupplier),
    isPro: bool(extra.isPro || source.isPro),
    subscriptionTier: maybeText(source.subscriptionTier || source.subscription?.tier, 40),
    subscription: source.subscription?.tier
      ? { tier: maybeText(source.subscription.tier, 40) }
      : undefined,
    badges: safeStringArray(source.badges, 24, 80),
    badgeDetails: safeBadgeDetails(extra.badgeDetails || source.badgeDetails),
    topPackages: safeTopPackages(source.topPackages),
    isPreview: bool(extra.isPreview),
  };
}

module.exports = {
  DATA_IMAGE_RE,
  safeExternalUrl,
  safeImageUrl,
  safePublicPackage,
  safePublicSupplier,
};
