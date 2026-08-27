'use strict';

const crypto = require('crypto');
const { VALID_CATEGORIES } = require('../models/Supplier');
const {
  PILOT_SCOPE,
  PUBLIC_UNCLAIMED_SCOPE,
  PUBLISHED_UNCLAIMED_SCOPES,
  isSupplierBotPilotProfile,
} = require('./supplierBotPilotVisibility.util');
const {
  attachSupplierToPilotSlot,
  reserveSupplierBotPilotSlot,
} = require('./supplierBotPilotSlot.service');

const MAX_SOURCE_IMAGES = 12;
const MAX_MEDIA_EVIDENCE = 20;
const MEDIA_KINDS = new Set(['open_graph', 'inline_image', 'picture_source', 'background_image']);

function isSlugCharacter(char) {
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || char === '_';
}

function generateSlug(text) {
  const input = String(text || '')
    .toLowerCase()
    .trim();
  let output = '';
  let separatorPending = false;

  for (const char of input) {
    if (isSlugCharacter(char)) {
      if (separatorPending && output) {
        output += '-';
      }
      output += char;
      separatorPending = false;
      continue;
    }
    if (char === '-' || char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      separatorPending = Boolean(output);
    }
  }
  return output;
}

function supplierIdForCandidate(candidateId) {
  const digest = crypto.createHash('sha256').update(String(candidateId)).digest('hex').slice(0, 24);
  return `sup_bot_${digest}`;
}

function canonicalWebsite(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch (_error) {
    throw new Error('website must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Website must use HTTP or HTTPS');
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

function canonicalMediaUrl(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (value.length > 2048) {
    throw new Error(`${fieldName} must be 2048 characters or fewer`);
  }
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${fieldName} must use HTTP or HTTPS`);
  }
  url.hash = '';
  return url.href;
}

function optionalPositiveInteger(value, fieldName) {
  if (value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > 20000) {
    throw new Error(`${fieldName} must be a positive integer up to 20000`);
  }
  return number;
}

function normalizeSourceMedia(payload) {
  const hasCover =
    payload.coverImage !== undefined && payload.coverImage !== null && payload.coverImage !== '';
  const coverImage = hasCover ? canonicalMediaUrl(payload.coverImage, 'coverImage') : null;

  if (payload.images !== undefined && !Array.isArray(payload.images)) {
    throw new Error('images must be an array');
  }
  if (Array.isArray(payload.images) && payload.images.length > MAX_SOURCE_IMAGES) {
    throw new Error(`images must contain no more than ${MAX_SOURCE_IMAGES} items`);
  }
  const images = Array.isArray(payload.images)
    ? [
        ...new Set(
          payload.images.map((value, index) => canonicalMediaUrl(value, `images[${index}]`))
        ),
      ]
    : [];

  if (payload.mediaEvidence !== undefined && !Array.isArray(payload.mediaEvidence)) {
    throw new Error('mediaEvidence must be an array');
  }
  if (Array.isArray(payload.mediaEvidence) && payload.mediaEvidence.length > MAX_MEDIA_EVIDENCE) {
    throw new Error(`mediaEvidence must contain no more than ${MAX_MEDIA_EVIDENCE} items`);
  }
  const mediaEvidence = Array.isArray(payload.mediaEvidence)
    ? payload.mediaEvidence.map((item, index) => {
        if (!item || typeof item !== 'object') {
          throw new Error(`mediaEvidence[${index}] must be an object`);
        }
        if (!MEDIA_KINDS.has(item.kind)) {
          throw new Error(`mediaEvidence[${index}].kind is unsupported`);
        }
        const alt =
          item.alt === null || item.alt === undefined || item.alt === ''
            ? null
            : String(item.alt).trim();
        if (alt && alt.length > 300) {
          throw new Error(`mediaEvidence[${index}].alt must be 300 characters or fewer`);
        }
        const score = Number(item.score);
        if (!Number.isFinite(score) || score < 0 || score > 100) {
          throw new Error(`mediaEvidence[${index}].score must be between 0 and 100`);
        }
        if (typeof item.sameSite !== 'boolean') {
          throw new Error(`mediaEvidence[${index}].sameSite must be boolean`);
        }
        return {
          url: canonicalMediaUrl(item.url, `mediaEvidence[${index}].url`),
          sourcePageUrl: canonicalMediaUrl(
            item.sourcePageUrl,
            `mediaEvidence[${index}].sourcePageUrl`
          ),
          kind: item.kind,
          alt,
          width: optionalPositiveInteger(item.width, `mediaEvidence[${index}].width`),
          height: optionalPositiveInteger(item.height, `mediaEvidence[${index}].height`),
          score,
          sameSite: item.sameSite,
        };
      })
    : [];

  return { coverImage, images, evidence: mediaEvidence };
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload is required');
  }
  if (!payload.candidateId || typeof payload.candidateId !== 'string') {
    throw new Error('candidateId is required');
  }
  if (!payload.businessName || typeof payload.businessName !== 'string') {
    throw new Error('businessName is required');
  }
  if (payload.businessName.trim().length > 100) {
    throw new Error('businessName must be 100 characters or fewer');
  }
  if (!VALID_CATEGORIES.includes(payload.category)) {
    throw new Error('Unsupported supplier category');
  }
  if (!payload.website) {
    throw new Error('website is required');
  }
  if (payload.description && String(payload.description).length > 5000) {
    throw new Error('description must be 5000 characters or fewer');
  }
  if (payload.publicEmail && String(payload.publicEmail).length > 254) {
    throw new Error('publicEmail must be 254 characters or fewer');
  }
  if (payload.publicPhone && String(payload.publicPhone).length > 20) {
    throw new Error('publicPhone must be 20 characters or fewer');
  }
  if (!Number.isFinite(Number(payload.publicationQuality))) {
    throw new Error('publicationQuality is required');
  }
  if (!Number.isFinite(Number(payload.dataConfidence))) {
    throw new Error('dataConfidence is required');
  }
  if (
    payload.publicationScope !== undefined &&
    payload.publicationScope !== null &&
    payload.publicationScope !== '' &&
    !PUBLISHED_UNCLAIMED_SCOPES.has(payload.publicationScope)
  ) {
    throw new Error('publicationScope is unsupported');
  }
  const website = canonicalWebsite(payload.website);
  const sourceMedia = normalizeSourceMedia(payload);
  const publicationScope = PUBLISHED_UNCLAIMED_SCOPES.has(payload.publicationScope)
    ? payload.publicationScope
    : null;
  return { website, sourceMedia, publicationScope };
}

function isManagedUnclaimedSupplier(supplier) {
  return Boolean(
    supplier &&
    supplier.ownershipStatus === 'unclaimed' &&
    supplier.acquisition?.source === 'supplier_bot'
  );
}

function effectivePublicationScope(existingAcquisition, requestedScope) {
  const existingScope = existingAcquisition?.publicationScope;
  if (PUBLISHED_UNCLAIMED_SCOPES.has(existingScope)) {
    return existingScope;
  }
  return PUBLISHED_UNCLAIMED_SCOPES.has(requestedScope) ? requestedScope : null;
}

function acquisitionFromPayload(payload, validated, existingAcquisition, now) {
  const previous = existingAcquisition && typeof existingAcquisition === 'object'
    ? existingAcquisition
    : {};
  const publicationScope = effectivePublicationScope(previous, validated.publicationScope);
  return {
    ...previous,
    source: 'supplier_bot',
    candidateId: payload.candidateId,
    generatedAt: payload.generatedAt || null,
    generatorVersion: payload.generatorVersion || null,
    publicationQuality: Number(payload.publicationQuality),
    dataConfidence: Number(payload.dataConfidence),
    complianceStatus: payload.complianceStatus || null,
    compliancePolicyVersion: payload.compliancePolicyVersion || null,
    sourcePackages: Array.isArray(payload.packages) ? payload.packages.slice(0, 20) : [],
    advertisedPrices: Array.isArray(payload.advertisedPrices)
      ? payload.advertisedPrices.slice(0, 50)
      : [],
    sourceMedia: validated.sourceMedia,
    ...(publicationScope
      ? {
          publicationScope,
          publishedUnclaimedAt: previous.publishedUnclaimedAt || now,
          ...(publicationScope === PILOT_SCOPE
            ? { pilotPublishedAt: previous.pilotPublishedAt || now }
            : {}),
        }
      : {}),
    ingestedAt: previous.ingestedAt || now,
    refreshedAt: now,
  };
}

function managedRefreshPatch(existing, payload, validated, now) {
  return {
    name: payload.businessName.trim(),
    category: payload.category,
    description: payload.description ? String(payload.description).trim() : '',
    location: payload.location || '',
    phone: payload.publicPhone || '',
    email: payload.publicEmail || '',
    website: validated.website,
    socials: payload.socials && typeof payload.socials === 'object'
      ? payload.socials
      : existing.socials || {},
    tags: Array.isArray(payload.services) ? payload.services.slice(0, 20) : [],
    acquisition: acquisitionFromPayload(payload, validated, existing.acquisition, now),
    updatedAt: now,
  };
}

async function createUnclaimedSupplierFromBot({ dbUnified, payload }) {
  if (!dbUnified) {
    throw new Error('Database unavailable');
  }
  const validated = validatePayload(payload);
  const canonical = validated.website;
  const deterministicId = supplierIdForCandidate(payload.candidateId);
  const suppliers = await dbUnified.read('suppliers');

  const sameCandidate = suppliers.find(
    item =>
      item.id === deterministicId ||
      (item?.acquisition?.source === 'supplier_bot' &&
        item?.acquisition?.candidateId === payload.candidateId)
  );
  if (sameCandidate) {
    if (!isManagedUnclaimedSupplier(sameCandidate)) {
      const error = new Error('Supplier Bot candidate is already owned or no longer bot-managed');
      error.code = 'SUPPLIER_BOT_OWNERSHIP_CONFLICT';
      error.supplierId = sameCandidate.id;
      throw error;
    }
    if (validated.publicationScope === PILOT_SCOPE) {
      await reserveSupplierBotPilotSlot({ dbUnified, candidateId: payload.candidateId });
      await attachSupplierToPilotSlot({
        dbUnified,
        candidateId: payload.candidateId,
        supplierId: sameCandidate.id,
      });
    }

    const now = new Date().toISOString();
    const patch = managedRefreshPatch(sameCandidate, payload, validated, now);
    const wrote = await dbUnified.updateOne('suppliers', { id: sameCandidate.id }, { $set: patch });
    if (!wrote) {
      throw new Error('Failed to refresh existing Supplier Bot profile');
    }
    return {
      supplier: { ...sameCandidate, ...patch },
      created: false,
      idempotent: true,
      refreshed: true,
    };
  }

  const sameWebsite = suppliers.find(item => {
    if (!item.website) {
      return false;
    }
    try {
      return canonicalWebsite(item.website) === canonical;
    } catch (_error) {
      return false;
    }
  });
  if (sameWebsite) {
    const error = new Error('A supplier with this website already exists');
    error.code = 'SUPPLIER_WEBSITE_CONFLICT';
    error.supplierId = sameWebsite.id;
    throw error;
  }

  if (validated.publicationScope === PILOT_SCOPE) {
    await reserveSupplierBotPilotSlot({ dbUnified, candidateId: payload.candidateId });
  }

  const baseSlug = generateSlug(payload.businessName) || deterministicId;
  let slug = baseSlug;
  let suffix = 2;
  while (suppliers.some(item => item.slug === slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const now = new Date().toISOString();
  const supplier = {
    id: deterministicId,
    ownershipStatus: 'unclaimed',
    name: payload.businessName.trim(),
    category: payload.category,
    description: payload.description ? String(payload.description).trim() : '',
    location: payload.location || '',
    postcode: '',
    phone: payload.publicPhone || '',
    email: payload.publicEmail || '',
    website: canonical,
    socials: payload.socials && typeof payload.socials === 'object' ? payload.socials : {},
    logo: '',
    // Supplier Bot media remains provenance-controlled acquisition data. Public
    // unclaimed presentation resolves it through the shared publication-scope
    // presenter rather than copying it into supplier-owned media fields.
    coverImage: '',
    images: [],
    isPro: false,
    proExpiresAt: null,
    subscriptionStatus: 'free',
    trialUsed: false,
    rating: 0,
    reviewCount: 0,
    verified: false,
    status: 'draft',
    slug,
    publishedAt: null,
    metaDescription: '',
    openGraphImage: '',
    tags: Array.isArray(payload.services) ? payload.services.slice(0, 20) : [],
    amenities: [],
    priceRange: '£',
    businessHours: {},
    responseTime: null,
    bookingUrl: '',
    videoUrl: '',
    faqs: [],
    testimonials: [],
    awards: [],
    certifications: [],
    viewCount: 0,
    enquiryCount: 0,
    approved: false,
    approvedAt: null,
    approvedBy: null,
    acquisition: acquisitionFromPayload(payload, validated, null, now),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dbUnified.insertOne('suppliers', supplier);
    if (validated.publicationScope === PILOT_SCOPE) {
      await attachSupplierToPilotSlot({
        dbUnified,
        candidateId: payload.candidateId,
        supplierId: supplier.id,
      });
    }
    return { supplier, created: true, idempotent: false, refreshed: false };
  } catch (error) {
    if (error && error.code === 11000) {
      const current = await dbUnified.read('suppliers');
      const concurrent = current.find(item => item.id === deterministicId);
      if (concurrent) {
        if (!isManagedUnclaimedSupplier(concurrent)) {
          const ownershipError = new Error(
            'Supplier Bot candidate is already owned or no longer bot-managed'
          );
          ownershipError.code = 'SUPPLIER_BOT_OWNERSHIP_CONFLICT';
          ownershipError.supplierId = concurrent.id;
          throw ownershipError;
        }
        return { supplier: concurrent, created: false, idempotent: true, refreshed: false };
      }
      if (validated.publicationScope === PILOT_SCOPE) {
        const existingPilot = current.find(item => isSupplierBotPilotProfile(item));
        if (existingPilot) {
          const pilotError = new Error('The one-profile Supplier Bot pilot is already in use');
          pilotError.code = 'SUPPLIER_BOT_PILOT_LIMIT';
          pilotError.supplierId = existingPilot.id;
          throw pilotError;
        }
      }
    }
    throw error;
  }
}

module.exports = {
  PUBLIC_UNCLAIMED_SCOPE,
  canonicalMediaUrl,
  canonicalWebsite,
  createUnclaimedSupplierFromBot,
  normalizeSourceMedia,
  supplierIdForCandidate,
};
