'use strict';

const { stripHtml } = require('./helpers');
const { normaliseStoredSupplierTheme } = require('./supplierTheme');

const DEFAULT_MAX_IMAGE_CHARS = 1200000;
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;
const ROOTED_IMAGE_RE = /^\/[^/\\:][^:]*$/;
const INTERNAL_TRUST_BADGE_IDS = new Set([
  'public-liability-verified',
  'dbs-checked',
  'licence-verified',
]);

// Fields that must never reach a public (non-owner) API response. Any code
// path that returns a supplier record to the public — search, discovery,
// listings, profile — must strip these first; safePublicSupplier() below
// already does this via its own allowlist, but code paths that spread the
// raw record (e.g. `{ ...supplier, extraField }`) need to strip explicitly.
const PUBLIC_SUPPLIER_PRIVATE_FIELDS = [
  'email',
  'ownerEmail',
  'contactEmail',
  'phone',
  'password',
  'passwordHash',
  'tokens',
  'resetToken',
  'resetPasswordToken',
  'verificationToken',
  'adminNotes',
  'moderationNotes',
  'stripeCustomerId',
];

function stripPublicSupplierPrivateFields(supplier) {
  if (!supplier || typeof supplier !== 'object') {
    return supplier;
  }
  const publicSupplier = { ...supplier };
  for (const field of PUBLIC_SUPPLIER_PRIVATE_FIELDS) {
    delete publicSupplier[field];
  }
  return publicSupplier;
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function text(value, max = 500) {
  if (value === null || value === undefined) {
    return '';
  }
  return stripHtml(String(value)).trim().slice(0, max);
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function maybeText(value, max = 500) {
  const cleaned = text(value, max);
  return cleaned || null;
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function bool(value) {
  return value === true;
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function safeImageUrl(value, max = DEFAULT_MAX_IMAGE_CHARS) {
  const cleaned = text(value, max);
  if (!cleaned) {
    return '';
  }
  // Base64 data URLs are deliberately not exposed publicly. Supplier media must
  // be persisted to the normal image store and referenced by a stable URL.
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

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
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

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function safePhone(value) {
  const cleaned = text(value, 60);
  return /^[+\d][\d\s().-]{5,}$/.test(cleaned) ? cleaned : '';
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function safeStringArray(items, maxItems = 12, maxLen = 120) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map(item => text(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function safeSocialLinks(socialLinks = {}) {
  const source = plainObject(socialLinks);
  const allowed = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok'];
  return allowed.reduce((acc, platform) => {
    const safe = safeExternalUrl(source[platform]);
    if (safe) {
      acc[platform] = safe;
    }
    return acc;
  }, {});
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function mergeSocialLinkSources(legacyValue, canonicalValue) {
  const legacy = plainObject(legacyValue);
  const canonical = plainObject(canonicalValue);
  const merged = { ...legacy };
  for (const [key, value] of Object.entries(canonical)) {
    // A migrated record can contain a blank canonical key alongside a populated
    // legacy value. Blank placeholders must not erase real public profile data.
    if (value || !merged[key]) {
      merged[key] = value;
    }
  }
  return merged;
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function safeGalleryItems(source = {}) {
  // Photos beyond the owner's current plan allowance are hidden (not
  // deleted) by subscriptionService.enforcePhotoGalleryLimit on downgrade —
  // the public profile must honour that the same way it already limits
  // active packages, or "up to N photos" stops being a real difference
  // between plans.
  const canonical = (Array.isArray(source.photosGallery) ? source.photosGallery : []).filter(
    item => !(item && typeof item === 'object' && item.hiddenByPlanLimit)
  );
  const legacy = Array.isArray(source.images) ? source.images : [];
  const seen = new Set();
  const safe = [];

  for (const item of [...canonical, ...legacy]) {
    const raw =
      typeof item === 'string'
        ? item
        : item &&
          (item.url || item.large || item.optimized || item.original || item.thumbnail || item.src);
    const url = safeImageUrl(raw);
    if (url && !seen.has(url)) {
      seen.add(url);
      safe.push(url);
    }
    if (safe.length >= 24) {
      break;
    }
  }

  return safe;
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function safeVerifications(verifications = {}, fallbacks = {}) {
  const source = plainObject(verifications);
  const fallback = plainObject(fallbacks);
  return {
    email: { verified: bool(source.email?.verified) || bool(fallback.emailVerified) },
    phone: { verified: bool(source.phone?.verified) || bool(fallback.phoneVerified) },
    business: { verified: bool(source.business?.verified) || bool(fallback.businessVerified) },
  };
}

/**
 * Public trust credentials are admin-confirmed status only. Never expose
 * reviewer identity, notes, certificate numbers or DBS/document contents.
 *
 * Structured trustVerifications are authoritative. Generic supplier badge APIs
 * cannot create a PLI/DBS/licence public trust claim by merely adding a badge ID.
 */
// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function safeTrustVerifications(trustVerifications = {}) {
  const source = plainObject(trustVerifications);
  return {
    publicLiability: { verified: bool(source.publicLiability?.verified) },
    dbs: { verified: bool(source.dbs?.verified) },
    licence: { verified: bool(source.licence?.verified) },
  };
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
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
    .filter(badge => (badge.id || badge.name) && !INTERNAL_TRUST_BADGE_IDS.has(badge.id))
    .slice(0, 24);
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
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

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function safeTopPackages(packages = []) {
  if (!Array.isArray(packages)) {
    return [];
  }
  return packages
    .filter(pkg => pkg && typeof pkg === 'object')
    .map(pkg => safePublicPackage(pkg))
    .slice(0, 4);
}

// skipcq: JS-0067, JS-R1005 -- CommonJS module scope is intentional; this serializer remains centralised to preserve one fail-closed public contract.
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
  const socialLinks = safeSocialLinks(mergeSocialLinkSources(source.socials, source.socialLinks));
  const rating = numberOrNull(source.averageRating ?? source.rating);
  const reviewCount = numberOrNull(source.reviewCount);
  const avgResponseTime = numberOrNull(source.avgResponseTime);
  const ownerUserId = maybeText(source.ownerUserId, 100);
  const messagingRecipientId = extra.exposeMessagingRecipient === true ? ownerUserId : '';
  const exposedOwnerUserId = extra.exposeOwnerUserId === true ? ownerUserId : '';
  const theme = normaliseStoredSupplierTheme(source);
  // Public approval is fail-closed and follows the same flag used to admit a
  // supplier to the directory. A stale verificationStatus must not create a
  // stronger public trust claim than the authoritative approved flag.
  const profileApproved = bool(source.approved);
  const emailVerified = bool(source.emailVerified) || bool(source.verifications?.email?.verified);
  const phoneVerified = bool(source.phoneVerified) || bool(source.verifications?.phone?.verified);
  const businessVerified =
    bool(source.businessVerified) || bool(source.verifications?.business?.verified);
  // Manual trust badge IDs are internal state only. The public contract exposes
  // structured trustVerifications instead, preventing badge-ID interpretation drift.
  const badges = safeStringArray(source.badges, 24, 80).filter(
    badgeId => !INTERNAL_TRUST_BADGE_IDS.has(badgeId)
  );
  return {
    id: maybeText(source.id, 100),
    ...(messagingRecipientId ? { messagingRecipientId } : {}),
    ...(exposedOwnerUserId ? { ownerUserId: exposedOwnerUserId } : {}),
    isOwner: bool(extra.isOwner),
    name: maybeText(source.name || source.businessName, 140) || 'Supplier',
    category: maybeText(source.category, 100),
    location: maybeText(source.location, 180),
    // Deliberately does NOT fall back to basePostcode: the dashboard promises
    // "your postcode is never shown publicly — only the city it falls in"
    // for travelling suppliers. Only venuePostcode (a venue's real, visitable
    // address) is meant to be public here. `source.postcode` is not a field
    // any supplier-facing form writes — do not "fix" this to basePostcode.
    postcode: maybeText(source.venuePostcode, 32),
    tagline: maybeText(source.tagline, 220),
    description: maybeText(
      source.description_long || source.description_short || source.description || source.blurb,
      1200
    ),
    description_short: maybeText(
      source.description_short || source.description || source.blurb || source.description_long,
      320
    ),
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
    priceRange: maybeText(source.priceRange || source.price_display || source.priceDisplay, 80),
    price_display: maybeText(source.price_display || source.priceRange || source.priceDisplay, 80),
    priceHint: maybeText(
      source.priceHint || source.price_display || source.priceRange || source.priceDisplay,
      80
    ),
    website,
    phone: safePhone(source.phone),
    maxGuests: numberOrNull(source.maxGuests),
    amenities: safeStringArray(source.amenities, 24, 80),
    highlights: safeStringArray(source.highlights, 5, 80),
    featuredServices: safeStringArray(source.featuredServices, 10, 100),
    socialLinks,
    photosGallery: safeGalleryItems(source),
    completedEvents: numberOrNull(source.completedEvents),
    createdAt: maybeText(source.createdAt, 40),
    avgResponseTime,
    rating,
    averageRating: rating,
    reviewCount,
    // The legacy public `verified` alias now mirrors the explicit email fact so
    // stale public clients cannot mistake profile approval for email verification.
    verified: emailVerified,
    approved: profileApproved,
    profileApproved,
    verificationStatus: maybeText(source.verificationStatus, 40),
    emailVerified,
    phoneVerified,
    businessVerified,
    verifications: safeVerifications(source.verifications, {
      emailVerified,
      phoneVerified,
      businessVerified,
    }),
    trustVerifications: safeTrustVerifications(source.trustVerifications),
    // Self-declared insurance/licence values are intentionally not exposed by the
    // safe public profile. Only structured EventFlow-confirmed trust status is public.
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
    badges,
    badgeDetails: safeBadgeDetails(extra.badgeDetails || source.badgeDetails),
    topPackages: safeTopPackages(source.topPackages),
    isPreview: bool(extra.isPreview),
  };
}

module.exports = {
  DATA_IMAGE_RE,
  PUBLIC_SUPPLIER_PRIVATE_FIELDS,
  safeExternalUrl,
  safeImageUrl,
  safePublicPackage,
  safePublicSupplier,
  safeTrustVerifications,
  stripPublicSupplierPrivateFields,
};
