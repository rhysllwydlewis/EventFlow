'use strict';

const crypto = require('crypto');
const { VALID_CATEGORIES } = require('../models/Supplier');

function isSlugCharacter(char) {
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || char === '_';
}

function generateSlug(text) {
  const input = String(text || '').toLowerCase().trim();
  let output = '';
  let separatorPending = false;

  for (const char of input) {
    if (isSlugCharacter(char)) {
      if (separatorPending && output) output += '-';
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

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Payload is required');
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
  if (!payload.website) throw new Error('website is required');
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
  return canonicalWebsite(payload.website);
}

async function createUnclaimedSupplierFromBot({ dbUnified, payload }) {
  if (!dbUnified) throw new Error('Database unavailable');
  const canonical = validatePayload(payload);
  const deterministicId = supplierIdForCandidate(payload.candidateId);
  const suppliers = await dbUnified.read('suppliers');

  const sameCandidate = suppliers.find(
    item =>
      item.id === deterministicId ||
      (item?.acquisition?.source === 'supplier_bot' &&
        item?.acquisition?.candidateId === payload.candidateId)
  );
  if (sameCandidate) {
    return { supplier: sameCandidate, created: false, idempotent: true };
  }

  const sameWebsite = suppliers.find(item => {
    if (!item.website) return false;
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
    acquisition: {
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
      ingestedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dbUnified.insertOne('suppliers', supplier);
    return { supplier, created: true, idempotent: false };
  } catch (error) {
    if (error && error.code === 11000) {
      const current = await dbUnified.read('suppliers');
      const concurrent = current.find(item => item.id === deterministicId);
      if (concurrent) {
        return { supplier: concurrent, created: false, idempotent: true };
      }
    }
    throw error;
  }
}

module.exports = {
  canonicalWebsite,
  createUnclaimedSupplierFromBot,
  supplierIdForCandidate,
};
