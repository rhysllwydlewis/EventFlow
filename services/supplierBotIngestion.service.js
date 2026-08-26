'use strict';

const { VALID_CATEGORIES } = require('../models/Supplier');
const { uid } = require('../store');

function generateSlug(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function canonicalWebsite(value) {
  const url = new URL(String(value));
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
  if (!payload.candidateId || typeof payload.candidateId !== 'string') throw new Error('candidateId is required');
  if (!payload.businessName || typeof payload.businessName !== 'string') throw new Error('businessName is required');
  if (payload.businessName.trim().length > 100) throw new Error('businessName must be 100 characters or fewer');
  if (!VALID_CATEGORIES.includes(payload.category)) throw new Error('Unsupported supplier category');
  if (!payload.website) throw new Error('website is required');
  if (payload.description && String(payload.description).length > 5000) throw new Error('description must be 5000 characters or fewer');
  if (payload.publicEmail && String(payload.publicEmail).length > 254) throw new Error('publicEmail must be 254 characters or fewer');
  if (payload.publicPhone && String(payload.publicPhone).length > 20) throw new Error('publicPhone must be 20 characters or fewer');
  if (!Number.isFinite(Number(payload.publicationQuality))) throw new Error('publicationQuality is required');
  if (!Number.isFinite(Number(payload.dataConfidence))) throw new Error('dataConfidence is required');
  return canonicalWebsite(payload.website);
}

async function createUnclaimedSupplierFromBot({ dbUnified, payload }) {
  if (!dbUnified) throw new Error('Database unavailable');
  const canonical = validatePayload(payload);
  const suppliers = await dbUnified.read('suppliers');

  const sameCandidate = suppliers.find(
    item => item?.acquisition?.source === 'supplier_bot' && item?.acquisition?.candidateId === payload.candidateId
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

  const baseSlug = generateSlug(payload.businessName) || `supplier-${Date.now()}`;
  let slug = baseSlug;
  let suffix = 2;
  while (suppliers.some(item => item.slug === slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const now = new Date().toISOString();
  const supplier = {
    id: uid('sup'),
    ownerUserId: null,
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
      advertisedPrices: Array.isArray(payload.advertisedPrices) ? payload.advertisedPrices.slice(0, 50) : [],
      ingestedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };

  await dbUnified.insertOne('suppliers', supplier);
  return { supplier, created: true, idempotent: false };
}

module.exports = {
  canonicalWebsite,
  createUnclaimedSupplierFromBot,
};
