'use strict';

const { stripHtml } = require('./helpers');

const DEFAULT_MAX_IMAGE_CHARS = 1200000;
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;

function text(value, max = 500) {
  if (value === null || value === undefined) return '';
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
  if (!cleaned) return '';
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith('http://') || DATA_IMAGE_RE.test(cleaned)) {
    return cleaned;
  }
  return '';
}

function safeExternalUrl(value) {
  const cleaned = text(value, 500);
  if (!cleaned) return '';
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
  if (!Array.isArray(items)) return [];
  return items.map(item => text(item, maxLen)).filter(Boolean).slice(0, maxItems);
}

function safeSocialLinks(socialLinks = {}) {
  const allowed = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok'];
  return allowed.reduce((acc, platform) => {
    const safe = safeExternalUrl(socialLinks[platform]);
    if (safe) acc[platform] = safe;
    return acc;
  }, {});
}

function safeVerifications(verifications = {}) {
  return {
    email: { verified: bool(verifications.email?.verified) },
    phone: { verified: bool(verifications.phone?.verified) },
    business: { verified: bool(verifications.business?.verified) },
  };
}

function safeBadgeDetails(badges = []) {
  if (!Array.isArray(badges)) return [];
  return badges
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
  const image = typeof resolveImage === 'function' ? resolveImage(pkg) : pkg.image || pkg.imageUrl;
  return {
    id: maybeText(pkg.id, 100),
    slug: maybeText(pkg.slug, 120),
    supplierId: maybeText(pkg.supplierId, 100),
    title: maybeText(pkg.title || pkg.name, 160) || 'Package',
    name: maybeText(pkg.name || pkg.title, 160),
    description: maybeText(pkg.description, 800),
    description_short: maybeText(pkg.description_short || pkg.descriptionShort, 240),
    price: maybeText(pkg.price || pkg.price_display || pkg.priceDisplay, 80),
    price_display: maybeText(pkg.price_display || pkg.priceDisplay || pkg.price, 80),
    priceDisplay: maybeText(pkg.priceDisplay || pkg.price_display || pkg.price, 80),
    image: safeImageUrl(image),
    imageUrl: safeImageUrl(pkg.imageUrl || image),
  };
}

function safeTopPackages(packages = []) {
  if (!Array.isArray(packages)) return [];
  return packages.map(pkg => safePublicPackage(pkg)).slice(0, 4);
}

function safePublicSupplier(supplier = {}, extras = {}) {
  const bannerUrl = safeImageUrl(supplier.bannerUrl || supplier.coverImage);
  const logo = safeImageUrl(supplier.logo || supplier.profileImage);
  const website = safeExternalUrl(supplier.website);
  const socialLinks = safeSocialLinks(supplier.socialLinks);
  const rating = numberOrNull(supplier.averageRating ?? supplier.rating);
  const reviewCount = numberOrNull(supplier.reviewCount);
  const avgResponseTime = numberOrNull(supplier.avgResponseTime);

  return {
    id: maybeText(supplier.id, 100),
    name: maybeText(supplier.name, 140) || 'Supplier',
    category: maybeText(supplier.category, 100),
    location: maybeText(supplier.location, 180),
    postcode: maybeText(supplier.postcode || supplier.venuePostcode, 32),
    tagline: maybeText(supplier.tagline, 220),
    description: maybeText(supplier.description || supplier.description_short, 1200),
    description_short: maybeText(supplier.description_short, 320),
    description_long: maybeText(supplier.description_long, 5000),
    metaDescription: maybeText(supplier.metaDescription, 260),
    bannerUrl,
    coverImage: bannerUrl,
    openGraphImage: safeImageUrl(supplier.openGraphImage || bannerUrl || logo),
    logo,
    profileImage: logo,
    themeColor: /^#[0-9a-f]{6}$/i.test(String(supplier.themeColor || ''))
      ? String(supplier.themeColor).trim()
      : null,
    priceRange: maybeText(supplier.priceRange || supplier.price_display, 80),
    price_display: maybeText(supplier.price_display || supplier.priceRange, 80),
    priceHint: maybeText(supplier.priceHint || supplier.price_display, 80),
    website,
    phone: safePhone(supplier.phone),
    maxGuests: numberOrNull(supplier.maxGuests),
    amenities: safeStringArray(supplier.amenities, 24, 80),
    highlights: safeStringArray(supplier.highlights, 5, 80),
    featuredServices: safeStringArray(supplier.featuredServices, 10, 100),
    socialLinks,
    photosGallery: Array.isArray(supplier.photosGallery)
      ? supplier.photosGallery
          .map(item => safeImageUrl(typeof item === 'string' ? item : item?.url || item?.src))
          .filter(Boolean)
          .slice(0, 24)
      : [],
    completedEvents: numberOrNull(supplier.completedEvents),
    createdAt: maybeText(supplier.createdAt, 40),
    avgResponseTime,
    rating,
    averageRating: rating,
    reviewCount,
    verified: bool(supplier.verified || supplier.approved),
    approved: bool(supplier.approved),
    emailVerified: bool(supplier.emailVerified || supplier.verifications?.email?.verified),
    phoneVerified: bool(supplier.phoneVerified || supplier.verifications?.phone?.verified),
    businessVerified: bool(supplier.businessVerified || supplier.verifications?.business?.verified),
    verifications: safeVerifications(supplier.verifications),
    insurance: bool(supplier.insurance),
    license: maybeText(supplier.license, 120),
    isFoundingSupplier: bool(supplier.isFoundingSupplier || supplier.isFounding || supplier.founding),
    isFounding: bool(supplier.isFounding || supplier.isFoundingSupplier || supplier.founding),
    founding: bool(supplier.founding || supplier.isFoundingSupplier || supplier.isFounding),
    foundingYear: numberOrNull(supplier.foundingYear),
    featured: bool(supplier.featured || extras.featuredSupplier),
    featuredSupplier: bool(extras.featuredSupplier || supplier.featuredSupplier),
    isPro: bool(extras.isPro || supplier.isPro),
    subscriptionTier: maybeText(supplier.subscriptionTier || supplier.subscription?.tier, 40),
    subscription: supplier.subscription?.tier ? { tier: maybeText(supplier.subscription.tier, 40) } : undefined,
    badges: safeStringArray(supplier.badges, 24, 80),
    badgeDetails: safeBadgeDetails(extras.badgeDetails || supplier.badgeDetails),
    topPackages: safeTopPackages(supplier.topPackages),
    messagingRecipientId: maybeText(supplier.ownerUserId, 120),
    isPreview: bool(extras.isPreview),
  };
}

module.exports = {
  DATA_IMAGE_RE,
  safeExternalUrl,
  safeImageUrl,
  safePublicPackage,
  safePublicSupplier,
};
