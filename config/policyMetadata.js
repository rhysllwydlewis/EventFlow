'use strict';

/**
 * Reviewed policy metadata.
 *
 * These dates are editorial facts, not clocks. Update `lastMaterialUpdate` only
 * when the policy wording or effect changes. Update `lastReviewed` after a
 * documented review, even when that review concludes that no wording needs to
 * change. Dates are kept in ISO form so review tooling can compare them without
 * locale or timezone ambiguity; public pages receive formatted values through
 * `getPolicyPlaceholders()`.
 */
const POLICY_METADATA = Object.freeze({
  legalHub: policy({
    title: 'Legal Hub',
    url: '/legal',
    sourcePath: 'public/legal.html',
    version: '1.2',
    lastMaterialUpdate: '2026-09-03',
    effectiveFrom: '2026-09-03',
    lastReviewed: '2026-09-03',
  }),
  terms: policy({
    title: 'Terms of Use',
    url: '/terms',
    sourcePath: 'public/terms.html',
    version: '1.2',
    lastMaterialUpdate: '2026-09-03',
    effectiveFrom: '2026-09-03',
    lastReviewed: '2026-09-03',
  }),
  privacy: policy({
    title: 'Privacy Notice',
    url: '/privacy',
    sourcePath: 'public/privacy.html',
    version: '1.4',
    lastMaterialUpdate: '2026-09-03',
    effectiveFrom: '2026-09-03',
    lastReviewed: '2026-09-03',
  }),
  dataRights: policy({
    title: 'Data Subject Rights',
    url: '/data-rights',
    sourcePath: 'public/data-rights.html',
    version: '1.1',
    lastMaterialUpdate: '2026-08-06',
    effectiveFrom: '2026-08-06',
    lastReviewed: '2026-09-03',
  }),
  communityGuidelines: policy({
    title: 'Community Guidelines',
    url: '/community/guidelines',
    sourcePath: 'public/community-guidelines.html',
    version: '1.1',
    lastMaterialUpdate: '2026-08-06',
    effectiveFrom: '2026-08-06',
    lastReviewed: '2026-09-03',
  }),
  communityHelp: policy({
    title: 'Community Help and Appeals',
    url: '/community/help',
    sourcePath: 'public/community-help.html',
    version: '1.0',
    lastMaterialUpdate: '2026-08-03',
    effectiveFrom: '2026-08-03',
    lastReviewed: '2026-09-03',
  }),
  cookiePolicy: policy({
    title: 'Cookie Policy',
    url: '/legal#cookies',
    sourcePath: 'public/legal.html',
    version: '1.2',
    lastMaterialUpdate: '2026-09-03',
    effectiveFrom: '2026-09-03',
    lastReviewed: '2026-09-03',
  }),
  acceptableUse: policy({
    title: 'Acceptable Use Policy',
    url: '/legal#acceptable-use',
    sourcePath: 'public/legal.html',
    version: '1.0',
    lastMaterialUpdate: '2026-06-11',
    effectiveFrom: '2026-06-11',
    lastReviewed: '2026-09-03',
  }),
  copyright: policy({
    title: 'Copyright and Intellectual Property Policy',
    url: '/legal#copyright',
    sourcePath: 'public/legal.html',
    version: '1.0',
    lastMaterialUpdate: '2026-06-11',
    effectiveFrom: '2026-06-11',
    lastReviewed: '2026-09-03',
  }),
  supplierTerms: policy({
    title: 'Supplier-Specific Terms',
    url: '/legal#supplier-terms',
    sourcePath: 'public/legal.html',
    version: '1.2',
    lastMaterialUpdate: '2026-09-03',
    effectiveFrom: '2026-09-03',
    lastReviewed: '2026-09-03',
  }),
  unclaimedListings: policy({
    title: 'Unclaimed Listings Policy',
    url: '/legal#unclaimed-listings',
    sourcePath: 'public/legal.html',
    version: '1.0',
    lastMaterialUpdate: '2026-09-03',
    effectiveFrom: '2026-09-03',
    lastReviewed: '2026-09-03',
  }),
  marketplaceTerms: policy({
    title: 'Marketplace Terms',
    url: '/legal#marketplace-terms',
    sourcePath: 'public/legal.html',
    version: '1.0',
    lastMaterialUpdate: '2026-06-11',
    effectiveFrom: '2026-06-11',
    lastReviewed: '2026-09-03',
  }),
});

function policy(metadata) {
  return Object.freeze({ ...metadata });
}

function formatPolicyDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) {
    throw new Error(`Invalid policy date: ${isoDate}`);
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function placeholderPrefix(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function getPolicyPlaceholders() {
  return Object.fromEntries(
    Object.entries(POLICY_METADATA).flatMap(([key, metadata]) => {
      const prefix = `POLICY_${placeholderPrefix(key)}`;
      return [
        [`${prefix}_LAST_UPDATED`, formatPolicyDate(metadata.lastMaterialUpdate)],
        [`${prefix}_EFFECTIVE_DATE`, formatPolicyDate(metadata.effectiveFrom)],
        [`${prefix}_LAST_REVIEWED`, formatPolicyDate(metadata.lastReviewed)],
        [`${prefix}_VERSION`, metadata.version],
      ];
    })
  );
}

function getPublicPolicyMetadata() {
  return Object.entries(POLICY_METADATA).map(([id, metadata]) => ({
    id,
    ...metadata,
    lastMaterialUpdateFormatted: formatPolicyDate(metadata.lastMaterialUpdate),
    effectiveFromFormatted: formatPolicyDate(metadata.effectiveFrom),
    lastReviewedFormatted: formatPolicyDate(metadata.lastReviewed),
  }));
}

module.exports = {
  POLICY_METADATA,
  formatPolicyDate,
  getPolicyPlaceholders,
  getPublicPolicyMetadata,
};
