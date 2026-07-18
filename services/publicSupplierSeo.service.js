'use strict';

const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://event-flow.co.uk';
const SLUG_TOKEN_LENGTH = 10;
const SEO_BLOCK_MARKER = 'eventflow-supplier-seo';

function stripMarkup(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const namePart = slugify(supplier.name || supplier.company || 'supplier') || 'supplier';
  return `${namePart}--${token}`;
}

function extractSlugToken(slug) {
  const match = String(slug || '')
    .toLowerCase()
    .match(/--([a-f0-9]{10})$/);
  return match ? match[1] : '';
}

function isPublicSupplier(supplier, validOwnerIds) {
  if (!supplier || supplier.approved !== true || !supplier.id) {
    return false;
  }
  if (!supplier.ownerUserId) {
    return true;
  }
  return validOwnerIds instanceof Set && validOwnerIds.has(supplier.ownerUserId);
}

function resolvePublicSupplierBySlug(suppliers, slug) {
  const token = extractSlugToken(slug);
  if (!token) {
    return null;
  }
  return (suppliers || []).find(supplier => supplierSlugToken(supplier && supplier.id) === token) || null;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    return `${safeBaseUrl(baseUrl)}/assets/images/eventflow-og-image.png?v=2`;
  }
  try {
    const parsed = new URL(raw, safeBaseUrl(baseUrl));
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('unsupported image protocol');
    }
    return parsed.href;
  } catch (_error) {
    return `${safeBaseUrl(baseUrl)}/assets/images/eventflow-og-image.png?v=2`;
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
  const name = stripMarkup(supplier.name || supplier.company || 'Event supplier');
  const category = stripMarkup(supplier.category || supplier.primaryCategory || '');
  const location = stripMarkup(
    supplier.location || supplier.city || supplier.town || supplier.addressLocality || ''
  );
  const title = truncate([name, category, 'EventFlow'].filter(Boolean).join(' | '), 70);
  const description = truncate(
    supplier.metaDescription ||
      supplier.description_short ||
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

  const ratingValue = numericValue(
    supplier.rating,
    supplier.averageRating,
    supplier.reviewSummary && supplier.reviewSummary.averageRating
  );
  const reviewCount = numericValue(
    supplier.reviewCount,
    supplier.reviewsCount,
    supplier.reviewSummary && supplier.reviewSummary.reviewCount
  );

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
    .replace(new RegExp(`\\s*<!-- ${SEO_BLOCK_MARKER}:start -->[\\s\\S]*?<!-- ${SEO_BLOCK_MARKER}:end -->`, 'i'), '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\b[^>]*(?:name=["']description["']|id=["']meta-description["'])[^>]*>\s*/gi, '')
    .replace(/<meta\b[^>]*(?:name=["']robots["'])[^>]*>\s*/gi, '')
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/<meta\b[^>]*(?:property=["']og:(?:title|description|image|url|type)["'])[^>]*>\s*/gi, '')
    .replace(/<meta\b[^>]*(?:name=["']twitter:(?:card|url|title|description|image)["'])[^>]*>\s*/gi, '')
    .replace(/<script\b[^>]*id=["']supplier-structured-data["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');
}

function renderSupplierHtml(templateHtml, supplier, options = {}) {
  const seo = buildSupplierSeoModel(supplier, options);
  const cleanTemplate = removeExistingSupplierSeoTags(templateHtml);
  const jsonLd = JSON.stringify(seo.structuredData).replace(/</g, '\\u003c');
  const block = [
    `  <!-- ${SEO_BLOCK_MARKER}:start -->`,
    `  <title>${escapeHtml(seo.title)}</title>`,
    `  <meta name="description" content="${escapeHtml(seo.description)}">`,
    '  <meta name="robots" content="index,follow,max-image-preview:large">',
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
    `  <script type="application/ld+json" id="supplier-structured-data">${jsonLd}</script>`,
    `  <!-- ${SEO_BLOCK_MARKER}:end -->`,
  ].join('\n');

  if (!/<\/head>/i.test(cleanTemplate)) {
    throw new Error('Supplier template is missing a closing head tag');
  }

  return cleanTemplate.replace(/<\/head>/i, `${block}\n</head>`);
}

function formatLastModified(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().split('T')[0];
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSupplierSitemap(suppliers, options = {}) {
  const baseUrl = safeBaseUrl(options.baseUrl);
  const entries = (suppliers || [])
    .map(supplier => {
      const slug = buildPublicSupplierSlug(supplier);
      if (!slug) {
        return '';
      }
      const lastmod = formatLastModified(
        supplier.updatedAt || supplier.modifiedAt || supplier.createdAt
      );
      return [
        '  <url>',
        `    <loc>${xmlEscape(`${baseUrl}/supplier/${slug}`)}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : '',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}${entries ? '\n' : ''}</urlset>\n`;
}

module.exports = {
  buildPublicSupplierSlug,
  buildSupplierSeoModel,
  buildSupplierSitemap,
  extractSlugToken,
  isPublicSupplier,
  renderSupplierHtml,
  resolvePublicSupplierBySlug,
  slugify,
  supplierSlugToken,
};
