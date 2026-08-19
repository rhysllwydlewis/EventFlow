'use strict';

const crypto = require('crypto');
const seoEligibility = require('./seoEligibility.service');

const DEFAULT_BASE_URL = 'https://event-flow.co.uk';
const SLUG_TOKEN_LENGTH = 16;
const SEO_BLOCK_MARKER = 'eventflow-supplier-seo';
const CAMPAIGN_QUERY_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
];

function stripMarkup(value) {
  const input = String(value || '');
  let output = '';
  let insideTag = false;

  for (const character of input) {
    if (character === '<') {
      insideTag = true;
      output += ' ';
      continue;
    }
    if (character === '>') {
      insideTag = false;
      output += ' ';
      continue;
    }
    if (!insideTag) {
      output += character;
    }
  }

  return output.replace(/\s+/g, ' ').trim();
}

function supplierDisplayName(supplier) {
  const source = supplier && typeof supplier === 'object' ? supplier : {};
  return stripMarkup(source.name || source.businessName || source.company || '');
}

function slugify(value) {
  return stripMarkup(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

function supplierSlugToken(supplierId) {
  const value = String(supplierId || '').trim();
  if (!value) {
    return '';
  }
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, SLUG_TOKEN_LENGTH);
}

function buildPublicSupplierSlug(supplier) {
  const token = supplierSlugToken(supplier && supplier.id);
  if (!token) {
    return '';
  }
  const namePart = slugify(supplierDisplayName(supplier) || 'supplier') || 'supplier';
  return `${namePart}--${token}`;
}

function extractSlugToken(slug) {
  const match = String(slug || '')
    .toLowerCase()
    .match(/--([a-f0-9]{16})$/);
  return match ? match[1] : '';
}

function cleanCampaignValue(value) {
  const clean = Array.from(String(value || ''))
    .filter(character => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 32 && codePoint !== 127;
    })
    .join('')
    .trim();
  return clean.slice(0, 200);
}

function buildCampaignQuery(input = {}) {
  const output = new URLSearchParams();
  for (const key of CAMPAIGN_QUERY_KEYS) {
    const rawValues = Array.isArray(input[key]) ? input[key] : [input[key]];
    for (const rawValue of rawValues) {
      const value = cleanCampaignValue(rawValue);
      if (value) {
        output.append(key, value);
      }
    }
  }
  return output.toString();
}

/**
 * Whether a supplier's profile page should render publicly at all (200
 * rather than a hard 404/redirect).
 *
 * Delegates to services/seoEligibility.service.js's canBeViewedPublicly —
 * the shared policy that also backs the directory search and the sitemap —
 * so this route can never diverge from what the rest of the platform
 * considers "public" (SEO-002). Being viewable here does not by itself mean
 * the page should carry `index,follow`; see getSupplierIndexEligibility for
 * that separate, stricter decision.
 * @param {Object} supplier Supplier record.
 * @param {Set<string>} validOwnerIds IDs of users that still exist.
 * @returns {boolean} True when the profile should be served.
 */
function isPublicSupplier(supplier, validOwnerIds) {
  return seoEligibility.canBeViewedPublicly(supplier, { validOwnerIds }).eligible;
}

/**
 * The stricter, separate decision of whether a viewable supplier's page
 * should be indexed. A supplier can be `isPublicSupplier() === true` and
 * still fail this — that page must still respond 200, just with
 * `noindex, follow` instead of `index, follow`.
 * @param {Object} supplier Supplier record.
 * @param {Set<string>} validOwnerIds IDs of users that still exist.
 * @returns {{eligible: boolean, reasons: string[]}} Decision with reason codes.
 */
function getSupplierIndexEligibility(supplier, validOwnerIds) {
  return seoEligibility.canBeIndexed(supplier, { validOwnerIds });
}

function resolvePublicSupplierBySlug(suppliers, slug) {
  const token = extractSlugToken(slug);
  if (!token) {
    return null;
  }
  return (
    (suppliers || []).find(supplier => supplierSlugToken(supplier && supplier.id) === token) || null
  );
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeJsonLd(value) {
  const json = JSON.stringify(value);
  let output = '';

  for (const character of json) {
    if (character === '<') {
      output += '\\u003c';
    } else if (character === '>') {
      output += '\\u003e';
    } else if (character === '&') {
      output += '\\u0026';
    } else if (character === '\u2028') {
      output += '\\u2028';
    } else if (character === '\u2029') {
      output += '\\u2029';
    } else {
      output += character;
    }
  }

  return output;
}

function safeBaseUrl(value) {
  try {
    const parsed = new URL(value || DEFAULT_BASE_URL);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'event-flow.co.uk') {
      return DEFAULT_BASE_URL;
    }
    return parsed.origin;
  } catch (_error) {
    return DEFAULT_BASE_URL;
  }
}

function safeImageUrl(value, baseUrl = DEFAULT_BASE_URL) {
  const raw = String(value || '').trim();
  if (!raw) {
    return `${safeBaseUrl(baseUrl)}/assets/images/eventflow-og-image.png?v=3`;
  }
  try {
    const parsed = new URL(raw, safeBaseUrl(baseUrl));
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('unsupported image protocol');
    }
    return parsed.href;
  } catch (_error) {
    return `${safeBaseUrl(baseUrl)}/assets/images/eventflow-og-image.png?v=3`;
  }
}

function truncate(value, maxLength) {
  const clean = stripMarkup(value);
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function numericValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return null;
}

function buildSupplierSeoModel(supplier, options = {}) {
  const baseUrl = safeBaseUrl(options.baseUrl);
  const slug = buildPublicSupplierSlug(supplier);
  const canonicalUrl = `${baseUrl}/supplier/${slug}`;
  const name = supplierDisplayName(supplier) || 'Event supplier';
  const category = stripMarkup(supplier.category || supplier.primaryCategory || '');
  const location = stripMarkup(
    supplier.location || supplier.city || supplier.town || supplier.addressLocality || ''
  );
  const title = truncate([name, category, 'EventFlow'].filter(Boolean).join(' | '), 70);
  const description = truncate(
    supplier.metaDescription ||
      supplier.description_short ||
      supplier.descriptionShort ||
      supplier.tagline ||
      supplier.description ||
      `${name}${location ? ` in ${location}` : ''} on EventFlow.`,
    160
  );
  const image = safeImageUrl(
    supplier.openGraphImage ||
      supplier.bannerUrl ||
      supplier.coverImage ||
      supplier.logo ||
      supplier.profileImage,
    baseUrl
  );

  // The route injects this summary from supplierAnalytics, which is derived from approved reviews.
  const approvedReviewSummary =
    supplier.approvedReviewSummary && typeof supplier.approvedReviewSummary === 'object'
      ? supplier.approvedReviewSummary
      : {};
  const ratingValue = numericValue(approvedReviewSummary.averageRating);
  const reviewCount = numericValue(approvedReviewSummary.reviewCount);

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    '@id': `${canonicalUrl}#supplier`,
    name,
    url: canonicalUrl,
    description,
    image,
  };

  if (category) {
    structuredData.serviceType = category;
  }
  if (location) {
    structuredData.areaServed = { '@type': 'Place', name: location };
  }
  if (supplier.price_display || supplier.priceRange) {
    structuredData.priceRange = stripMarkup(supplier.price_display || supplier.priceRange);
  }
  if (ratingValue > 0 && reviewCount > 0) {
    structuredData.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.min(5, Math.max(0, ratingValue)),
      reviewCount: Math.max(1, Math.floor(reviewCount)),
      bestRating: 5,
      worstRating: 1,
    };
  }

  return {
    slug,
    canonicalUrl,
    title,
    description,
    image,
    structuredData,
  };
}

function removeExistingSupplierSeoTags(html) {
  return String(html || '')
    .replace(
      new RegExp(
        `\\s*<!-- ${SEO_BLOCK_MARKER}:start -->[\\s\\S]*?<!-- ${SEO_BLOCK_MARKER}:end -->`,
        'i'
      ),
      ''
    )
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\b[^>]*(?:name=["']description["']|id=["']meta-description["'])[^>]*>\s*/gi, '')
    .replace(/<meta\b[^>]*(?:name=["']robots["'])[^>]*>\s*/gi, '')
    .replace(/<meta\b[^>]*name=["']ef-public-supplier-id["'][^>]*>\s*/gi, '')
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(
      /<meta\b[^>]*(?:property=["']og:(?:title|description|image|url|type)["'])[^>]*>\s*/gi,
      ''
    )
    .replace(
      /<meta\b[^>]*(?:name=["']twitter:(?:card|url|title|description|image)["'])[^>]*>\s*/gi,
      ''
    )
    .replace(
      /<script\b[^>]*src=["']\/assets\/js\/supplier-route-context\.js["'][^>]*><\/script>\s*/gi,
      ''
    )
    .replace(/<script\b[^>]*id=["']supplier-structured-data["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');
}

/**
 * Render a supplier's public profile HTML, including its head metadata.
 *
 * `indexable` controls only the `robots` directive and whether structured
 * data is emitted — the visible profile itself renders identically either
 * way. A supplier that is publicly viewable but not (yet) complete enough to
 * index must still get a normal 200 page, just with `noindex, follow`
 * instead of `index, follow` — never a hard block.
 * @param {string} templateHtml Supplier page shell.
 * @param {Object} supplier Supplier record.
 * @param {Object} [options] Passed through to buildSupplierSeoModel.
 * @param {boolean} [indexable] Whether this profile should be indexed.
 * @returns {string} Rendered HTML.
 */
function renderSupplierHtml(templateHtml, supplier, options = {}, indexable = true) {
  const seo = buildSupplierSeoModel(supplier, options);
  const cleanTemplate = removeExistingSupplierSeoTags(templateHtml);
  const jsonLd = serializeJsonLd(seo.structuredData);
  const robots = indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow';
  const block = [
    `  <!-- ${SEO_BLOCK_MARKER}:start -->`,
    `  <title>${escapeHtml(seo.title)}</title>`,
    `  <meta name="description" content="${escapeHtml(seo.description)}">`,
    `  <meta name="robots" content="${robots}">`,
    `  <meta name="ef-public-supplier-id" content="${escapeHtml(supplier.id)}">`,
    `  <link rel="canonical" href="${escapeHtml(seo.canonicalUrl)}">`,
    `  <meta property="og:title" content="${escapeHtml(seo.title)}">`,
    `  <meta property="og:description" content="${escapeHtml(seo.description)}">`,
    `  <meta property="og:image" content="${escapeHtml(seo.image)}">`,
    `  <meta property="og:url" content="${escapeHtml(seo.canonicalUrl)}">`,
    '  <meta property="og:type" content="business.business">',
    '  <meta name="twitter:card" content="summary_large_image">',
    `  <meta name="twitter:url" content="${escapeHtml(seo.canonicalUrl)}">`,
    `  <meta name="twitter:title" content="${escapeHtml(seo.title)}">`,
    `  <meta name="twitter:description" content="${escapeHtml(seo.description)}">`,
    `  <meta name="twitter:image" content="${escapeHtml(seo.image)}">`,
    indexable
      ? `  <script type="application/ld+json" id="supplier-structured-data">${jsonLd}</script>`
      : '',
    '  <script src="/assets/js/supplier-route-context.js"></script>',
    `  <!-- ${SEO_BLOCK_MARKER}:end -->`,
  ]
    .filter(Boolean)
    .join('\n');

  if (!/<\/head>/i.test(cleanTemplate)) {
    throw new Error('Supplier template is missing a closing head tag');
  }

  return cleanTemplate.replace(/<\/head>/i, `${block}\n</head>`);
}

module.exports = {
  buildCampaignQuery,
  buildPublicSupplierSlug,
  buildSupplierSeoModel,
  extractSlugToken,
  getSupplierIndexEligibility,
  isPublicSupplier,
  renderSupplierHtml,
  resolvePublicSupplierBySlug,
  serializeJsonLd,
  slugify,
  supplierDisplayName,
  supplierSlugToken,
};
